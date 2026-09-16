# Manage Knowledge Packs

Pack mutations operate on one LocalStore. Use the global `--store-root <path>` option to select an isolated Store for development or automation; otherwise the CLI uses the user-level default Store.

当前 release 选择、install/update 边界以 [pack-management spec](../../openspec/specs/pack-management/spec.md) 为准；本文说明命令、参数和 JSON result 的使用方式。

```sh
# Install the latest Registry release selected by the Registry contract.
lore pack install agentic-coding
lore pack install agentic-coding

# Install or update one exact release from a chosen Registry repository.
lore pack install agentic-coding@0.1.0 --registry acme/team-packs
lore pack update agentic-coding@0.2.0 --registry acme/team-packs

# Remove one active Pack from the selected Store.
lore --store-root ./tmp/lore-store pack remove agentic-coding

# Browse installed Packs, rich Pack metadata, or one Pack's Practice catalog.
lore pack list
lore pack list --details
lore pack list agentic-coding
```

## Install output format

The adapted `lore pack install` command is text by default; pass `--json` for the machine-readable envelope. Update and remove remain JSON-only. The install text receipt summarizes the resolved Pack/Registry/source, committed Store snapshot, Practice changes, diagnostics, cleanup status, and semantic-index synchronization state. It intentionally omits the machine-oriented artifact digest. Text mode does not change installation behavior or exit codes.

`lore pack install` is idempotent only when the resolved artifact matches the active Pack exactly. If the same Pack name resolves to different content, it returns `pack.update-required` and leaves the Store unchanged. Use `lore pack update` to replace that Pack's sources with the selected release.

`lore pack update` and `lore pack remove` return `pack.not-installed` when the named Pack is not active in the selected Store. All successful mutations return the committed `generation`, `effectiveRevision`, affected Practice `delta`, validation `diagnostics`, and `cleanupPending` state in the normal JSON envelope. Install and update additionally report the resolved Pack version, Registry, Git source, artifact digest, whether the operation was idempotent, and the readable public `packRoot` at `packs/p-<pack-name>/current`. Remove deliberately returns no root because it has removed that current view.

There is no bulk “update every Pack” operation. Each Pack update resolves one explicit Pack release, making Store changes and automation inputs deterministic. Root `lore update` is reserved for Lore's own version-management contract.

For the complete LocalStore-only catalog contract, including `--details` and per-Pack Practice listings, see [Discover installed Packs](./list.md).
