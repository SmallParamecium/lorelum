# Discover installed Packs with `lore pack list`

`lore pack list` browses Pack data in the selected LocalStore. Use it to see installed Packs, inspect rich Pack metadata for an integration, or narrow to the Practice summaries provided by one Pack before reading a full Practice with `lore get`. The contract is defined in [ADR 0014](../adr/0014-list-catalog-contract.md).

```sh
lore pack list
lore pack list --details
lore pack list
lore pack list agentic-coding
lore get agentic-coding.testing.classify-failure-before-changing-test
lore --store-root /path/to/isolated-store pack list
lore describe pack.list
```

The global `--store-root` option can appear before or after the command. Relative paths resolve from the calling process's working directory. Omitting it selects the user Store. The CLI rejects a missing or empty value; other non-empty path strings are passed to LocalStore without a platform-specific path pre-check.

## Installed Pack catalog

Without an argument, the protocol envelope contains `command: "pack.list"`, `ok: true`, and:

```text
data: {
  generation,
  effectiveRevision,
  packs: [
    { name, version, practiceCount, packRoot }
  ]
}
```

Pack entries are sorted by `name`. `version` comes from the selected Store's verified active manifest. `practiceCount` counts effective Practices for which that Pack has a source claim. If multiple Packs provide the same Practice, each Pack counts it; the values therefore are not a global deduplicated Practice total. `packRoot` is the selected Pack's readable local `current` view, not an internal digest artifact directory. It supports an explicit Pack-level browse or authoring task; it does not cause the CLI to load resource files or Practice bodies into the catalog result.

A fresh Store is a successful response with `packs: []`.

## Rich Pack metadata

`lore pack list --details` returns:

```text
data: {
  generation,
  effectiveRevision,
  packs: [
    {
      name,
      version,
      description?,
      appliesTo,
      packRoot
    }
  ]
}
```

This mode is intended for integrations that build a Pack index. `description` is omitted when the Pack does not declare it. `appliesTo` is always an array; a missing `applies_to` becomes `[]`, meaning that the Pack declares no technology-stack restriction. Rich metadata does not include `practiceCount`.

## Practice catalog

`lore pack list <pack>` returns:

```text
data: {
  generation,
  effectiveRevision,
    pack: { name, version, packRoot },
  practices: [
    { id, title, applies_when }
  ]
}
```

Practice entries are sorted by exact `id`. The returned `id` can be passed directly to `lore get`. Full Practice bodies, anti-patterns, and source details remain part of `get`; compact summaries do not repeat `practicePath` or individual resource paths. An installed Pack with zero Practices is successful and returns an empty `practices` array.

`packRoot` is an absolute `current` locator for the Pack active at this command's Store snapshot. A caller can browse this explicitly selected Pack root, or resolve a Practice resource target such as `resource:references/checklist.md` from it. It must not guess a root from a Pack name or depend on SQLite/projection layout. After install, update, remove, or recovery changes the Pack state, the same path can resolve to newer bytes or disappear; rerun the relevant `lore pack list` command or `lore get` before treating it as the current source.

## Output format

Text is the default for `pack list` and provides the readable catalog view. Pass `--json` to preserve the structured result shapes documented above. Every text mode starts with the Store snapshot. The installed-Pack view shows names and versions (and practice counts for the normal catalog); `--details` shows descriptions and applicability; `pack list <pack>` shows stable Practice IDs, titles, and applicability conditions. Empty Stores and empty Pack catalogs receive explicit messages rather than blank output.

## Errors and boundaries

Success exits `0`; failures exit `2`. With `--json`, success and failure write one JSON line to stdout. In the default text mode, successful catalogs go to stdout and ordinary list errors go to stderr.

| Code | Meaning |
| --- | --- |
| `usage.invalid` | Missing/extra arguments, malformed Pack name, or invalid option combinations. |
| `pack.not-installed` | The requested Pack is not active in the selected Store. |
| `store.busy` | A stable Store snapshot could not be obtained due to concurrent work. |
| `store.recovery-required` | The selected Store could not be opened and recovered normally. |
| `runtime.unexpected` | An undeclared internal failure prevented completion. |

Pack names are validated before the Store is opened. `--details` cannot be combined with a Pack argument. The `pack.not-installed` message does not echo the supplied Pack name. Callers should branch on `error.code` rather than parsing `message`.

`lore pack list` does not search remote Registries, perform semantic ranking, paginate, filter, or return complete Practice bodies. It is a Pack catalog command; `lore query` remains the task-oriented retrieval command, while root `lore list` is reserved for a future cross-resource listing contract.
