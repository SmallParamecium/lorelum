# ADR 0004: Agent-first CLI protocol

- **Date:** 2026-07-23
- **Status:** Proposed
- **Related:** ADR 0002 (Bun + TypeScript toolchain), issue #20 (split from issue #13), issue #25 (Help interaction), issue #29 (command-level JSON/text output)

## Context

Lorelum's first CLI consumers are AI coding agents, CI jobs, and editor integrations. They need a stable process contract to discover commands, distinguish usage errors from completed domain results, and recover without parsing prose. A human-oriented help screen is useful for navigation, but it is not a substitute for machine-readable command metadata.

The CLI therefore has two distinct surfaces: business-command results have a stable machine-readable JSON protocol, with each command declaring its default presentation, while valid Help invocations are a human-facing text interaction. `lore describe [command]` is the explicit machine-discovery interface. Keeping these surfaces distinct avoids making formatted Help prose part of the machine protocol.

The protocol must also preserve the package boundary. Commander, process I/O, output-format negotiation, and exit codes are CLI adapter concerns; format, engine, and MCP must not depend on them.

## Decision

### Business-command JSON protocol

The candidate v1 machine protocol is a compact, single-line JSON envelope for business-command results. In JSON mode, each completed invocation writes exactly one JSON line to stdout; optional diagnostic logs go only to stderr. Each response has `protocolVersion`, `toolVersion`, `command`, `ok`, and exactly one of `data` or `error`. The CLI exports a JSON Schema for the envelope; each command definition supplies the schema for `data`.

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
- Successful `-h` / `--help` and `lore help [command path]` invocations write plain text to stdout, exit `0`, and do not emit a business-result JSON envelope. Valid Help remains text even when `--human` or `--json` is present. Future `--format` or `--agent` support must not turn a successful Help invocation into business JSON. Help parsing, wording, hierarchy, and Help-specific errors are governed by issue #25.
- `lore describe [command]` is the explicit machine-readable command-discovery interface and returns the JSON envelope. Discovery exposes command IDs, arguments/options, output formats/defaults, result schema, visible error codes, and exit behavior.

Malformed invocations are rejected before a static Help or version response can hide the error. Usage messages must not echo raw arguments. Help-specific error presentation follows issue #25; business-command format and error routing follow the sections below.

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
| `get` | JSON, text | Target default is text. Keep JSON as the default until machine callers are pinned to JSON and the compatibility checks pass; then switch to text. |
| `list`, `install`, `--version` | JSON, text | JSON |
| `query` and other commands not yet adapted | JSON | JSON only/default until a separately reviewed text renderer is complete |
| Help invocations | Text | Fixed text, governed by issue #25; not negotiated as a business-result format |

For `get`, text mode writes the complete retrieved lore body to stdout without a JSON envelope, title/header, source or Store metadata, or code fence. It must not truncate or rewrite the body. The JSON `data` remains the complete structured result, including identifiers and metadata. Internal machine callers must pass `--format=json` (or the declared JSON preset) rather than rely on the transitional default. If the compatibility gate cannot be completed, retain JSON as the default for this release instead of silently changing caller behavior.

Use `--format json|text` for explicit selection; `--json` and `--human` are aliases. For business-result commands, precedence is:

1. Explicit `--format`, `--json`, or `--human` selection.
2. `--agent` JSON preference when no explicit format was selected.
3. The command's declared default.

Conflicting explicit format selections and unsupported formats are stable format-negotiation errors; they must not silently fall back to another successful format. Help is a deliberate exception: a successful Help invocation remains text and is not re-rendered through the business-result renderer. TTY detection never selects JSON versus text. Color is independent of format and is outside this ADR's implementation scope; JSON and Agent output must never contain ANSI. An explicit text selection under `--agent` remains uncolored.

Text is a presentation projection of the same completed business result, not a second business semantic. Each command documents which protocol or low-value metadata it omits; task-essential content must remain available. JSON `data` remains the complete machine result. Sensitive values are redacted before either renderer so JSON and text cannot reveal values hidden in only one presentation.

### Errors and exit codes

Exit codes are `0` for success, `1` for a completed result that reports a blocking domain finding, and `2` for usage or runtime failures. Exit code `1` is only used for a completed result; failure envelopes use exit code `2`. Each command's `errorCodes` is the allowlist for visible errors. An undeclared handler error is normalized to `runtime.unexpected`, which every command must declare.

In JSON mode, success and failure envelopes go to stdout. In negotiated text mode, successful output goes to stdout and stable usage/domain diagnostics go to stderr. Format-negotiation failures use one JSON fallback envelope on stdout and exit `2`, so no invocation produces a half-JSON/half-text result. Diagnostic logs go to stderr. Help-specific errors continue to follow issue #25.

Command options model flags, values, defaults, and required presence separately. Commander declarations and discovery text derive from that metadata. Framework options additionally declare whether they apply globally or only to the root invocation; static business responses expose their command and result schema through discovery. Until local argument inheritance is explicitly modeled, a command with child commands cannot declare its own positional arguments or options.

## Consequences

**Positive:** Agents and scripts retain a stable JSON envelope and discoverable schemas; people get direct text Help and a useful text-first `get`; command-specific defaults can evolve without TTY-dependent behavior; domain packages remain independent of CLI process details.

**Negative / accepted risk:** JSON and text require separate rendering tests and explicit compatibility checks when a command default changes. Help is intentionally outside business-result format negotiation, so future global format flags must preserve that exception. A `get` default change is blocked until its machine callers are pinned to JSON and the migration gate passes.

The protocol remains **Proposed** until maintainers accept this ADR during review. No business command needs to be implemented to review or accept the outer protocol contract.

**Follow-ups:** implement registry format metadata and `describe` discovery, add text renderers by command under issue #29, coordinate Help option precedence with issue #25, migrate machine callers before changing the `get` default, and validate the contract with unit, process-level, and compiled-binary tests.
