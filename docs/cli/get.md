# Read an installed Practice

`lore get <practice-id>` retrieves one complete canonical Practice by its exact
ID from the selected LocalStore. The contract is defined in
[ADR 0011](../adr/0011-get-retrieval-contract.md).

```sh
lore list
lore list --pack agentic-coding
lore query "classify a failing React test"
lore get agentic-coding.testing.classify-failure-before-changing-test
lore --store-root /path/to/isolated-store get agentic-coding.testing.classify-failure-before-changing-test
lore describe get
```

A typical discovery flow is `lore list`, then `lore list --pack <name>`,
followed by `lore get <practice-id>`. The ID must follow the existing dotted
Practice ID format. Lookup is exact:
there is no title matching, prefix completion, or case normalization. The global
`--store-root` option also works after the command; relative paths resolve from
the calling process's working directory. Omitting it selects the user Store.

## Result

The existing protocol envelope contains `command: "get"`, `ok: true`, and:

```text
data: {
  generation,
  effectiveRevision,
  practice: {
    id, title, stage, tech_stack, applies_when,
    severity, body, anti_patterns
  },
  sources: [{ pack, sourcePath }]
}
```

`practice` is the canonical runtime representation defined by ADR 0007. It
includes the complete Markdown body, LF-normalized text, and expanded defaults:
`severity: "warn"`, `body: ""`, `anti_patterns: []`, and `severity: "warn"` on
anti-patterns whose authors omitted severity. Author array order is preserved.
The reserved, undefined anti-pattern `check` field is excluded by canonicalization.

Identical content provided under the same ID by multiple active Packs returns
one Practice with all source claims. `sources` is ordered by Pack name and
source path; each `sourcePath` is relative to its Pack root.

## Store behavior

Each invocation cold-opens the selected LocalStore once and resolves the ID
against that verified snapshot. `generation` and `effectiveRevision` identify
the snapshot used by the response. A healthy read does not advance generation or
effectiveRevision or change installed content. This is not a promise of zero
filesystem writes: opening a missing Store initializes it, and recovering a prior
interrupted operation can write Store state.

Store integrity is checked before reporting absence, including when the requested
ID is unknown. Missing or damaged artifacts and inconsistent SQLite state are
errors. The command does not invoke `reindex` or access a Registry/network.

## Errors and exit codes

Success exits `0`. Failures use `ok: false` with `error: { code, message }` and
exit `2`. Both success and failure write exactly one JSON line to stdout.

| Code                      | Meaning                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `usage.invalid`           | Missing/extra arguments, malformed ID, or invalid options.            |
| `get.unknown_practice`    | Valid ID absent from a healthy Store, including an empty Store.       |
| `store.busy`              | A stable Store snapshot could not be obtained due to concurrent work. |
| `store.recovery-required` | The selected Store could not be opened and recovered normally.        |
| `runtime.unexpected`      | An undeclared internal failure prevented completion.                  |

Invalid IDs fail before opening the Store. Visible errors do not include raw
arguments or internal failure details. Callers should branch on `code` rather
than parsing `message`.

This command does not implement semantic search, batch lookup, Pack/version
selection, runtime translations, or related-Practice expansion. Use `lore query`
for ranked summary retrieval, then pass one returned ID to `lore get`.
