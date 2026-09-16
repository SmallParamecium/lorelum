# ADR 0004: Agent-first CLI protocol

- **Date:** 2026-07-23
- **Status:** Accepted
- **Related:** ADR 0002 (Bun + TypeScript toolchain), issue #20 (split from issue #13), issue #167 (command-level JSON/text output)

## Context

Lorelum's first CLI consumers are AI coding agents, CI jobs, and editor integrations. They need a stable process contract to discover commands, distinguish usage errors from completed domain results, and recover without parsing prose. A human-oriented help screen is useful for navigation, but it is not a substitute for machine-readable command metadata.

The CLI therefore has two distinct surfaces: business-command results have a stable machine-readable JSON protocol, with each command declaring its default presentation, while valid Help invocations are a human-facing text interaction. `lore describe [command]` is the explicit machine-discovery interface. Keeping these surfaces distinct avoids making formatted Help prose part of the machine protocol.

The protocol must also preserve the package boundary. Commander, process I/O, output-format negotiation, and exit codes are CLI adapter concerns; format, engine, and MCP must not depend on them.

## Decision

### Business-command JSON protocol

The v1 machine protocol is a compact, single-line JSON envelope for business-command results. In JSON mode, each completed invocation writes exactly one JSON line to stdout; optional diagnostic logs go only to stderr. Each response has `protocolVersion`, `toolVersion`, `command`, `ok`, and exactly one of `data` or `error`. The CLI exports a JSON Schema for the envelope; each command definition supplies the schema for `data`.

```json
{
  "protocolVersion": 1,
  "toolVersion": "0.0.0",
  "command": "describe",
  "ok": true,
  "data": { "name": "lore" }
}
```

```json
{
  "protocolVersion": 1,
  "toolVersion": "0.0.0",
  "command": "unknown",
  "ok": false,
  "error": { "code": "usage.invalid", "message": "The command invocation is invalid." }
}
```

JSON v1 is compact, has no pretty-print mode, and contains no ANSI, spinner, progress, or other non-protocol text. A JSON error is still one envelope line on stdout. Handler results remain structured data; the CLI adapter validates JSON-safe values and owns envelope/text rendering.

### Help and machine discovery

- A bare `lore` invocation retains its existing root capability response; this ADR does not change its no-argument behavior.
- The intended Help surface is a separate, fixed-text interaction: successful `-h` / `--help` and `lore help [command path]` invocations should write plain text to stdout and remain outside the business-result JSON envelope. Its parsing, wording, hierarchy, and Help-specific errors are deferred to a separately tracked Help task. This business-output rollout does not implement that surface; the current CLI retains its existing machine-readable `describe` response for valid `--help` invocations.
- `lore describe [command]` is the explicit machine-readable command-discovery interface and returns the JSON envelope. Discovery exposes command IDs, arguments/options, output formats/defaults, result schema, visible error codes, and exit behavior.

Malformed invocations are rejected before a static Help or version response can hide the error. Usage messages must not echo raw arguments. Help-specific error presentation remains outside this rollout; business-command format and error routing follow the sections below.

### Command-level output formats and defaults

Each business-result command declares the formats it supports and its default in the command registry, for example:

```ts
output: {
  formats: ["json", "text"],
  default: "json"
}
```

The default must be one of the declared formats. The registry is the single source for parser construction, `describe` metadata, result schemas, visible errors, exit behavior, and output-format support. A command must not advertise a format until its renderer and tests are complete.

The v1 rollout matrix is:

| Command | Supported formats | Default / rollout rule |
| --- | --- | --- |
| `describe` | JSON | JSON only |
| `get` | JSON, text | Text by default; pass `--json` for the machine-readable envelope. |
| `pack list`, `pack install`, `--version` | JSON, text | Text by default; pass `--json` for JSON. |
| `query` | JSON, text | Text by default; pass `--json` for JSON. |
| Other commands not yet adapted | JSON | JSON only/default until a separately reviewed text renderer is complete |
| Help invocations | Separate follow-up | Fixed-text Help is outside this rollout and is not negotiated as a business-result format |

For `get`, text mode writes the complete retrieved lore body to stdout without a JSON envelope, title/header, source or Store metadata, or code fence. It must not truncate or rewrite the body. The JSON `data` remains the complete structured result, including identifiers and metadata. Internal machine callers must pass `--json` rather than rely on a command default.

For `query`, text mode presents matched Practice summaries in the engine's result order, retaining their stable IDs, titles, and task-relevant summary fields. An empty result must be stated explicitly rather than rendered as ambiguous blank output. `preparing` and `indexing` results must display their actionable state and preserve the existing exit code `1`. JSON remains the complete machine contract, including fields such as `contentDigest`, semantic `profileId`/`coverage`, and `preparationId`; the text projection must not alter retrieval behavior, ranking, or exit-code semantics.

Use `--json` to explicitly request the machine-readable envelope. Without it, commands that advertise text use their declared text default; JSON-only commands remain JSON-only. The flag is recognized only before `--` and is not inferred from TTY state. A `--json` token consumed as an option value is not treated as a format selector. Future fixed-text Help remains outside business-result format negotiation. Color is independent of format and is outside this ADR's implementation scope.

Text is a presentation projection of the same completed business result, not a second business semantic. Each command documents which protocol or low-value metadata it omits; task-essential content must remain available. JSON `data` remains the complete machine result. Sensitive values are redacted before either renderer so JSON and text cannot reveal values hidden in only one presentation.

### Errors and exit codes

Exit codes are `0` for a ready successful result, `1` for a successfully returned non-ready/action-required result or a completed result with a blocking domain finding, and `2` for usage or runtime failures. For example, semantic `query` may return `ok: true` with `state: "preparing"` and exit `1`; exit `1` does not mean the CLI invocation failed. Failure envelopes use exit code `2`. Each command's `errorCodes` is the allowlist for visible errors. An undeclared handler error is normalized to `runtime.unexpected`, which every command must declare.

With `--json`, success and failure envelopes go to stdout. In the default text mode, successful output goes to stdout and stable usage/domain diagnostics go to stderr. Diagnostic logs go to stderr. JSON-only commands continue to use the JSON envelope. Help-specific errors remain outside this rollout.

Command options model flags, values, defaults, and required presence separately. Commander declarations and discovery text derive from that metadata. Framework options additionally declare whether they apply globally or only to the root invocation; static business responses expose their command and result schema through discovery. Until local argument inheritance is explicitly modeled, a command with child commands cannot declare its own positional arguments or options.

## Consequences

**Positive:** Agents and scripts retain a stable JSON envelope and discoverable schemas through `--json`; people get useful text projections for the adapted commands; JSON-only commands remain predictable; Help remains independently evolvable; command-specific defaults can evolve without TTY-dependent behavior; domain packages remain independent of CLI process details.

**Negative / accepted risk:** JSON and text require separate rendering tests and explicit compatibility checks when a command default changes. Query text rendering must cover ready semantic/keyword results, empty results, the `preparing` variant, and the `indexing` variant without changing its JSON schema or exit code. Help is intentionally outside business-result format negotiation. Commands without a completed renderer remain JSON-only until separately adapted.

**Acceptance:** Maintainers accepted this ADR on 2026-09-14. Acceptance freezes the protocol and compatibility rules; individual command renderers may still roll out separately according to the matrix above.

**Follow-ups:** add text renderers to other commands only when their projection and tests are complete; migrate machine callers before considering a `get` default change; and define Help parsing/rendering in a separate follow-up task. The initial business-result rollout for `get`, `list`, `install`, `query`, and `--version` is implemented and validated in the local worktree; Help parsing/rendering is not part of this rollout. This does not imply that the changes have been merged or released.
