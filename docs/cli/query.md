# Query installed Practices

`lore query <text>` searches the installed Practices in the selected LocalStore and returns a small summary for each match. It defaults to local semantic retrieval; `--mode keyword` retains the offline FTS5 path.

```sh
# Semantic is the default. A normal query starts the Backend and automatically prepares the fixed local model when needed.
lore query "React 登录页接入现有认证接口"
lore query "database migration rollback" --top-k 10

# Explicit zero-configuration, offline keyword retrieval.
lore query "database migration rollback" --mode keyword

# Human-readable Practice summaries; JSON remains the default.
lore query "database migration rollback" --format=text
lore query "request validation" --human

lore --store-root /path/to/isolated-store query "request validation"
lore describe query
```

The positional text is trimmed before validation. It must contain at least one non-whitespace character and may contain at most 4,096 Unicode code points after trimming. `--top-k` is optional, defaults to `5`, and accepts a decimal positive integer from `1` through `50`. `--mode` accepts `semantic` (the default) or `keyword`. The global `--store-root` option follows the same resolution rules as `get`.

## Semantic mode

Semantic mode uses the fixed local Profile and the selected Store's previously built semantic index. When the Backend is stopped, a query starts it. When the index is usable but the model is absent or unloaded, Backend starts or joins the fixed model's configured download and preparation. A query observes that work for a short bounded interval; it never builds an index itself.

For a new machine, install a Pack normally. If model preparation is still running, query returns a machine-readable preparing result rather than waiting for the whole transfer:

```sh
lore --store-root /path/to/store pack install agentic-coding
lore --store-root /path/to/store query "how should I verify this release?"
```

Existing Stores created before automatic install synchronization can use `lore index build` once. After that, ordinary semantic queries need neither `backend start` nor `model load`. If the first query returns preparing, inspect `lore model status` and retry after it becomes ready. Explicit `lore model load` remains useful when a prior download failed and the user wants to wait for its retry.

The successful result includes the Profile identity and how completely the active index covers the Store snapshot:

```json
{
  "mode": "semantic",
  "profileId": "...",
  "coverage": "complete",
  "results": []
}
```

`coverage: "complete"` means the index and Store snapshot are identical. `coverage: "partial"` means the Store changed after the index was built, but Lorelum could use a continuous change history to exclude every affected Practice and safely return results from the remaining vectors. If that safety proof is unavailable, the command fails and asks for an explicit `index build`; it never silently switches to keyword retrieval.

## Keyword mode

`--mode keyword` runs directly in Engine, does not need a Backend or model, and does not access the network. It maintains its own derived FTS5 index at `indexes/keyword/v<index-version>/active.sqlite`. The index is separate from `store.sqlite`; canonical Practice rows remain the source of returned summaries. A missing, corrupt, incompatible, or history-gap keyword index is rebuilt from a consistent Store snapshot.

## Shared result behavior

JSON remains the default for both modes and returns the complete protocol envelope. With `--format=text` / `--human`, the CLI prints the mode (and semantic coverage), then ordered Practice summaries with stable IDs, titles, stage, severity, tech stack, and applicability. Empty results say `No matching Practices.` Text omits internal digests, semantic profile IDs, and preparation IDs; use `lore get <practice-id>` for the complete canonical Practice. Neither output format changes retrieval, ranking, or snapshot behavior.

When automatic preparation has been accepted but is not ready within the observation interval, the JSON result has `ok: true`, exit code `1`, and no results. In text mode the CLI shows the preparing message (not the internal preparation ID) and still exits `1`:

```json
{
  "state": "preparing",
  "preparationId": "<uuid>",
  "message": "The local model is preparing in the background. Check lore model status, then retry this query."
}
```

## Errors and exit codes

Ready query results exit `0`. A successful preparing result exits `1`. Failures exit `2`. JSON mode writes one envelope line to stdout; after text is selected, successful summaries use stdout and ordinary query failures use stderr. Invalid/conflicting format-selection requests use the framework's JSON fallback. Machine callers should use JSON and branch on `data.state` or `error.code`, not parse the message.

| Code | Meaning |
| --- | --- |
| `usage.invalid` | Missing or invalid text, `--top-k`, or `--mode`. Validation happens before a semantic query connects to the Backend. |
| `backend.*` | The automatic Backend start could not safely complete because of incompatibility, a port conflict, busy state, or a deadline. Inspect it with `lore backend ...`. |
| `embedding.*` | Automatic preparation was disabled, failed, or cannot safely continue. Check `lore model status`; fix configuration/resources, then use `lore model load` to retry and wait. |
| `semantic.index-not-ready` | No usable index exists, or Store history cannot safely bridge its age. Run `lore index build`. |
| `semantic.index-incompatible` | The index does not match the fixed Profile or selected Store. Run `lore index rebuild`. |
| `semantic.index-failed` / `semantic.embedding-failed` | The stored index or query embedding violates its contract. Rebuild the index; inspect model status for embedding failures. |
| `query.unavailable` / `query.failed` | The explicit keyword index could not be searched. |
| `store.busy` / `store.recovery-required` | The selected Store kept changing, is mutating, or needs recovery. |
| `runtime.unexpected` | An undeclared internal failure prevented completion. |
