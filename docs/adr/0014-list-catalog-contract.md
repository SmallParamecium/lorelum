# ADR 0014: LocalStore-backed lore list catalog contract

- **Date:** 2026-09-08
- **Status:** Proposed (local implementation)
- **Related:** ADR 0003 (Practice format), ADR 0004 (agent-first CLI protocol), ADR 0007 (LocalStore), ADR 0011 (LocalStore point-read and query boundary), ADR 0012 (persistent keyword index), ADR 0013 (incremental LocalStore projection writes)

## Context

`install`, `query`, and `get` make an installed LocalStore useful only after the caller already knows a Pack name or Practice id. A new conversation often has neither. The owner has confirmed the missing entry point: an agent first discovers installed knowledge, then narrows to one Pack's Practice catalog, and finally uses `lore get` for the full Practice.

The target workflow is:

```text
lore list                  # discover installed Packs
lore list packs            # read Pack metadata for an integration
lore list --pack <name>    # inspect that Pack's Practice summaries
lore get <practice-id>     # retrieve the complete Practice
```

`list` is therefore a catalog command, not a task-retrieval command. `query` remains the entry point for finding Practices from task text. An explicit Pack path or Registry lookup would recreate discovery outside LocalStore and split the runtime source of truth.

This ADR defines the CLI/engine catalog contract, including the Pack metadata shape required by an integration that invokes `lore list packs`. It does not define how an Agent learns that Lorelum exists or when a Skill, Plugin, Hook, or MCP adapter should invoke the command; those lifecycle contracts remain separate.

## Decision

### Command surface

```text
lore list [--store-root <path>]
lore list packs [--store-root <path>]
lore list --pack <name> [--store-root <path>]
```

The optional positional scope accepts only `packs`. The three supported modes are:

- no scope and no `--pack`: the existing Pack catalog;
- positional scope `packs`: the rich Pack metadata catalog;
- `--pack <name>`: the selected Pack's Practice catalog.

`packs` is a selector handled by the existing `list` command, not a dotted `list.packs` registry command. This preserves the current registry constraint that a command with local options cannot also own child commands. All modes honor the global `--store-root` option through the same invocation Store resolution as `install`, `query`, and `get`. The response envelope `command` remains `"list"` in every mode.

### Application boundary

`@lorelum/engine` exposes a List application service and deterministic pure projections:

- `LocalStore.open()` includes a minimal `InstalledPackSummary[]` (`name`, `version`) from the verified active manifest;
- `createLocalStore()` exposes the verified Pack metadata capability `readInstalledPackDetails()` without changing `OpenResult.packs`; the base `LocalStore` contract remains usable by existing implementations that only support the original catalog operations;
- Pack version is owned by the active-manifest Pack summary. `EffectivePractice.sources[]` carries the Practice-to-Pack provenance (`packName`, source path, and digests) and intentionally does not repeat Pack version;
- `retrievePacks()` combines those summaries with Effective Practice source claims;
- the rich Pack projection reads `description` and `applies_to` from the sealed Pack projection, not from the manifest or Effective Practices;
- `retrievePackPractices()` returns only Practices for which the selected Pack has a source claim, or `null` when the Pack is not active;
- `createListService()` reads the selected Store once per invocation, projects one of the three catalogs, and converts a missing Pack to `UnknownPackError`.
- The rich catalog requires the metadata capability at runtime. An injected Store without that capability fails explicitly with an Engine typed error; existing `list` and `list --pack` calls remain available.

The CLI adapter performs Pack-name syntax validation, Store-root resolution, service dispatch, and error mapping. It never reads `installed-packs.json`, queries SQLite, scans artifacts, or computes the domain catalog itself. A future MCP tool must validate its own input shape before calling the service.

### Result

Pack-list mode returns LocalStore `generation`, `effectiveRevision`, and `packs[]`. Each Pack contains only:

- `name`;
- `version`;
- `practiceCount`.

`practiceCount` counts effective Practices for which that Pack has at least one source claim. Multiple Packs may claim the same effective Practice; each Pack counts it, so Pack counts do not necessarily sum to the global deduplicated Practice total.

Practice-catalog mode returns `generation`, `effectiveRevision`, `pack`, and `practices[]`. The Pack summary contains `name` and `version`. Each Practice contains only:

- `id`;
- `title`;
- `applies_when`.

The id can be passed directly to `lore get`. Body and anti-pattern content remains intentionally deferred to `get`.

Rich Pack metadata mode (`lore list packs`) returns `generation`, `effectiveRevision`, and `packs[]`. Each Pack contains:

- `name`;
- `version`;
- `description` when the Pack declares it; absent otherwise;
- `appliesTo`, always an array.

The CLI maps the format/Engine field `applies_to` to the integration field `appliesTo`. When `applies_to` is absent, `appliesTo` is `[]`, meaning that the Pack declares no technology-stack restriction; it does not mean that the Pack applies to zero stacks. Rich metadata mode does not include `practiceCount`.

Pack entries sort by `name`; Practice entries sort by `id`. Both comparisons use UTF-16 code units and do not depend on process locale.

### Errors and empty state

A fresh Store is a successful Pack-list or rich Pack metadata result with `packs: []`. A format-valid but uninstalled Pack raises `UnknownPackError`, which the CLI maps to `list.pack-not-found` with exit code 2. This distinguishes an uninstalled Pack from an installed Pack with zero Practices, whose catalog is successful and empty.

The CLI validates `--pack` against `PACK_NAME_REGEX` before Store dispatch and returns `usage.invalid` for malformed input. Unknown positional scopes and `lore list packs --pack <name>` also return `usage.invalid` before service dispatch. Engine ListService does not duplicate the Pack-name format-schema validation. The CLI's `list.pack-not-found` message is generic and does not echo the supplied Pack name; `registry.pack-not-found` remains the separate Registry-install error.

LocalStore `StoreBusyError` and `StoreRecoveryRequiredError` keep their existing CLI mappings.

### Non-goals

Registry search, remote installable Pack discovery, semantic retrieval, ranking, fuzzy matching, pagination, filters, full Practice bodies, MCP wiring, registry parent/child command refactoring, and new Store tables or derived indexes are deferred. Cross-command snapshot consistency is not promised: `list`, `list packs`, `list --pack`, and `get` are separate invocations and may observe different Store revisions.

## Consequences

Once the caller knows the Lorelum CLI entry point, Agents can discover local knowledge without prior Pack knowledge while keeping LocalStore as the sole runtime source. This ADR does not claim automatic discovery of Lorelum itself. The dedicated metadata read API avoids widening `OpenResult.packs`; existing callers continue to receive only the minimal `name` / `version` summary. Artifact digests, storage keys, and install timestamps remain private.

Source-claim counting preserves provenance but means counts are not a global uniqueness metric. The catalog keeps each item to three fields, so an unpaginated Pack can remain useful until observed catalog sizes justify a pagination contract.

**Follow-ups:**

- Keep the equivalent Plugin parser fixture aligned with the consuming integration contract if that contract changes.
- User documentation must distinguish browsing (`list`) from task retrieval (`query`).
- A future MCP adapter must define its own input schema and error mapping before exposing this service.
