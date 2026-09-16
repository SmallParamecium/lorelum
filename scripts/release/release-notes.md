## Lorelum __RELEASE_TAG__

> ⚠️ Upgrading from alpha.1? Read the migration steps below before starting the new CLI or Codex task.

This public-alpha prerelease adds project-local Knowledge Packs, shared semantic-cache foundations, Pack-native resources, and the `lorelum-plugins` Codex marketplace. It contains the compiled `lore` CLI and the native runtime required for local semantic retrieval.

## ⚠️ Action required: migrate the Codex Plugin from alpha.1

`__RELEASE_TAG__` renames Lorelum's Codex marketplace from `lorelum` to `lorelum-plugins`. The Plugin itself remains **Lorelum** (`lorelum`), but its selector is now `lorelum@lorelum-plugins`.

**Who is affected:** anyone who installed Lorelum's Codex Plugin in alpha.1.

Before using alpha.2, run this complete migration:

```sh
codex plugin remove lorelum@lorelum
codex plugin marketplace remove lorelum
codex plugin marketplace add lorelum/lorelum
codex plugin add lorelum@lorelum-plugins
```

Then start a **new Codex task** so Codex loads the updated Skill and Hook. Do not keep both the old `lorelum` marketplace and the new `lorelum-plugins` marketplace configured at the same time: both can resolve the same Plugin ID.

Verify the result before continuing:

```sh
codex plugin marketplace list
codex plugin list
```

The final state must contain one Lorelum marketplace, `lorelum-plugins`, and the enabled Plugin selector `lorelum@lorelum-plugins`.

### Let an Agent migrate it

The commands above are the supported migration path. Use one of these prompts only when you want an Agent to perform and report that path for you.

```text
Please migrate my Lorelum Codex Plugin from alpha.1 to alpha.2: remove the legacy `lorelum@lorelum` Plugin and `lorelum` marketplace, add `lorelum/lorelum` again, install `lorelum@lorelum-plugins`, verify that only one Lorelum marketplace is configured, then tell me to start a new Codex task.
```

```text
请把我的 Lorelum Codex Plugin 从 alpha.1 迁移到 alpha.2：移除旧的 `lorelum@lorelum` Plugin 和 `lorelum` marketplace，重新添加 `lorelum/lorelum`，安装 `lorelum@lorelum-plugins`，确认最终只保留一个 Lorelum marketplace，然后提醒我新开一个 Codex task。
```

## Install or upgrade to __RELEASE_TAG__

These commands install this exact release, not whichever version `main` points to later.

### macOS on Apple Silicon and Linux x64

```sh
curl -fsSL https://raw.githubusercontent.com/lorelum/lorelum/__RELEASE_TAG__/install.sh | sh -s -- --version __RELEASE_VERSION__
lore --version
```

### Windows x64 (PowerShell)

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/lorelum/lorelum/__RELEASE_TAG__/install.ps1))) -Version __RELEASE_VERSION__
# If the installer changed Path, open a new terminal, then run:
lore --version
```

Expected version: `__RELEASE_VERSION__`.

The Windows installer now detects supported 64-bit Windows reliably, including x64 packages under ARM64 emulation. If it cannot continue, it reports the detected OS, bitness, and PowerShell details. It updates the user `Path` idempotently and treats shell environment broadcasts as best-effort, so Windows PowerShell 5.1 cannot turn an otherwise successful install into a failure. It also disables PowerShell's expensive download-progress UI while fetching release archives.

## Upgrade official Packs

Pack releases are versioned independently from the CLI. Refresh the Packs that match your work after installing __RELEASE_TAG__.

```sh
# Major engineering-practice update.
lore pack update agentic-coding@0.4.0

# New official Packs.
lore pack install react-web-craft@0.1.0
lore pack install issue-pr-etiquette@0.1.0
```

- **Agentic Coding 0.4.0** substantially refreshes engineering decision guidance. Upgrade it before relying on existing Agent workflows for planning, implementation, verification, recovery, or delivery.
- **Pack Creator 0.2.0 (planned follow-up Pack release)** adds repository-level Pack and ProjectContext authoring guidance. It is not installable until the official Registry publishes an immutable tag and release entry. Once it is published, update it explicitly before creating or revising repository-level Packs.
- **React Web Craft 0.1.0** is a new Pack for React application design and performance across component state, async data flow, loading, rendering, and composition.
- **Issue PR Etiquette 0.1.0** is a new Pack for evidence-grounded Issues, focused pull requests, review communication, and honest AI-assistance disclosure.

## A smoother day-to-day query workflow

alpha.1 could make a normal query feel like error recovery: build an index first, retry a transient `backend.busy`, or guess whether a partial or old artifact was safe. alpha.2 makes normal preparation, progress, and recovery observable instead.

- **Query first; Lorelum prepares what it needs.** A semantic query starts or joins the required Backend, model, and index work. The normal path no longer requires a preliminary `lore index build`, `lore backend start`, or `lore model load`.
- **Preparation is a useful state, not an opaque failure.** While a model is preparing, the command returns `preparing`, a preparation ID, and a message that points to `lore model status`; while an index is building, it returns `indexing`, an operation ID, current counts, and a retry message. Accepted work continues in the background.
- **Use verified results before the full index is ready.** Query can search current rows that have already been verified and reports `coverage`, `indexedPracticeCount`, `totalPracticeCount`, and `operationId`. Use `--require-complete` or `--min-coverage-percent` when automation needs stricter coverage. If that policy cannot be met, Lorelum reports `indexing` without using another query embedding to compete with document indexing for the local model.
- **Waiting is intentional.** `--max-wait-ms 0` means “submit work without waiting for progress,” not a local transport failure. CLI disconnection does not cancel accepted work.
- **Normal concurrency shares work instead of failing unpredictably.** Identical targets join one operation; different targets become observable `queued` work; repeated edits to one source coalesce to its latest target. Store-only and ProjectContext queries now share this same persistent runtime.
- **Small changes do less work and unsafe state falls back safely.** Verified Store history preserves unchanged rows and only re-embeds changed projections. Missing or inconsistent history triggers a safe build rather than stale results or manual cache cleanup.
- **The result describes the context that was actually queried.** Semantic commands give the Backend the command's starting directory, and the Backend resolves and revalidates the final ProjectContext before publishing. This avoids CLI and Backend independently choosing different source layers or reporting mismatched context metadata.
- **Recover without losing usable results.** Source/context changes are revalidated before publication, rapid edits supersede obsolete work, and a failed rebuild retains the last ready artifact. After a daemon restart, verified progress is retained and a `waiting-for-source` operation reattaches when you run query or index again from the same source.
- **One bad local source does not block the rest.** A malformed project config, Pack, or single Practice degrades only the affected source. Valid neighbors and lower-priority fallbacks remain available; use `lore context status` to inspect warnings and `lore validate` for strict diagnostics.
- **Upgrades no longer need to interrupt another task blindly.** If a semantic command finds an authenticated Backend from another Lorelum build or protocol, it returns structured recovery information. The supported Lorelum Agent only runs `lore backend stop --if-idle` and retries after the Backend is proven idle; active or unknown work is left untouched and can continue.

`lore pack install` now commits the canonical Pack before derived-index synchronization. If model preparation or indexing is still running, installation succeeds with `indexSync.state: "pending"` and an operation ID. A failed derived sync does not roll back an installed Pack; it returns a stable recovery state instead.

This does not hide invalid input, unsafe configuration, Store recovery requirements, or actual model failures. Those conditions remain typed errors with stable codes. The improvement is that normal preparation, normal concurrency, and temporary incomplete progress now expose a useful state and a next action instead of looking like unexplained failure.

## What's new

### Project-local Packs and shared semantic cache

Lorelum can now use project-local Knowledge Packs directly from `.lorelum/`, without installing them into the user Store. Run `lore init` in a directory to create a project configuration. `lore query`, `lore get`, and `lore index` automatically discover the current directory's `.lorelum/` layer and its parent layers.

Child Packs can override individual Practices while inheriting unaffected Practices from parent layers or the user Store. Use `inherit: false` to stop parent inheritance and `base: user|none` to control the user Store baseline. One malformed local Practice now degrades that entry instead of blocking valid neighboring Practices and lower-priority fallbacks; inspect the state with `lore context status` or use `lore validate` for strict diagnostics.

Semantic artifacts and embedding vectors now live in a user-level, content-addressed cache. Equivalent directories and Git worktrees can reuse artifacts and vectors without writing derived files into project sources or LocalStore. Use `lore cache status` to inspect this derived state and `lore cache prune` to remove unused derived data safely.

New commands and options include:

- `lore init`
- `lore context status`
- `lore cache status`
- `lore cache prune`
- `--project-root <path>`
- `--no-project`
- `--cache-root <path>`
- `--max-wait-ms <milliseconds>`
- `--min-coverage-percent <percent>`
- `--require-complete`

### Pack resources and stable Pack roots

Knowledge Packs can now ship on-demand `references/`, reusable `assets/`, and explicit `scripts/` alongside Practices. Practices link to them with `resource:` links; Lorelum validates their paths and preserves them through install, update, recovery, and artifact verification. Resources are not indexed or executed automatically.

`lore get`, explicit Pack listing, successful Pack install/update, and the Codex Pack Catalog now return a readable `packRoot` for the selected active Pack. It is a mutable `current` view: refresh it with `lore get` or `lore pack list` after changing a Pack.

## Other breaking changes

### Backend compatibility errors and Agent recovery changed

**Who is affected:** scripts, host integrations, and Agents that previously classified a local lifecycle mismatch as `backend.incompatible`.

When a verified local Backend belongs to another Lorelum build or protocol, lifecycle failures now use `backend.build-mismatch` or `backend.protocol-mismatch` instead of the generic `backend.incompatible` code. Query failures include machine-readable `error.recovery` fields for the action, automation policy, reason, and retry behavior.

Automation must consume that structured recovery data rather than parse the message, ask users to kill a process, or call ordinary `lore backend stop` autonomously. `lore backend stop --if-idle` is the narrow supported Agent action: it stops only a proven-idle, verified Lorelum Backend. Model preparation, semantic indexing, another Agent lease, and unknown activity are deferred without interrupting that work.

### ProjectContext changes the default retrieval corpus

**Who is affected:** users and automation that run `lore query`, `lore get`, or `lore index` from a directory under `.lorelum/`.

If the current directory or an ancestor contains `.lorelum/`, those commands now use the merged ProjectContext by default. Use `--no-project` when an invocation must use only the selected user Store:

```sh
lore --no-project query "..."
lore --no-project get <practice-id>
lore --no-project index build
```

### Semantic query preparation and machine output changed

**Who is affected:** scripts and integrations that require a fully built semantic index before accepting a query result.

Semantic query no longer requires a preliminary `lore index build`. A query may return a complete or policy-compliant partial result with exit code `0`, `data.state: "preparing"` or `data.state: "indexing"` with exit code `1`, or an error envelope with exit code `2`.

Automation must branch on `data.state`, coverage, and `error.code`; it must not assume every successful envelope immediately contains results. Index operations can also report `waiting-for-source` and `queued`. After a Backend restart, rerun query or index from the same project directory to reattach a `waiting-for-source` ProjectContext operation.

### Semantic cache is rebuilt after alpha.1

alpha.1 Store-local semantic indexes are not migrated into the new shared content-addressed cache. The first semantic query after upgrading may rebuild a derived artifact or regenerate embeddings. Canonical Packs, Practices, and LocalStore data do not require a format migration.

The default cache location is `~/.lorelum/cache`; it contains rebuildable artifacts, progress data, and reusable vectors, not project files or Pack source.

### Pack command JSON adds `packRoot`

**Who is affected:** strict consumers of `lore get`, `lore pack list`, and successful Pack mutation JSON results.

Those consumers must accept the new required `packRoot` field. It is the supported local entry point for a selected Pack; do not derive artifact paths from Store internals.

## Fixes and reliability improvements

- After an upgrade, `lore backend stop` can safely release a verified older Backend even when its protocol no longer matches. Supported Agents use the stricter `--if-idle` handoff only when structured recovery proves the Backend is idle; active or unknown work is never stopped automatically.
- Pack resource locators now use a stable readable `current` view and are repaired safely for compatible older Stores.
- On Windows, index publication and LocalStore recovery now release Lorelum-owned SQLite statements before replacing a database file, avoiding false failures caused by a retained file handle.
- The Windows installer now gives actionable platform diagnostics, manages the user `Path` when necessary, avoids slow archive downloads caused by PowerShell progress rendering, and does not report a failed install solely because an optional environment-change notification fails in Windows PowerShell 5.1.
- A valid `--max-wait-ms 0` no longer becomes a transport deadline failure. Concurrent semantic targets are queued, source changes are revalidated before publication, and failed builds preserve a previously ready artifact.

## Downloads

The install commands above are the recommended path. Use these assets for manual or offline installation:

- `lore-__RELEASE_VERSION__-darwin-arm64.tar.gz` — macOS on Apple Silicon
- `lore-__RELEASE_VERSION__-linux-x64.tar.gz` — Linux x64
- `lore-__RELEASE_VERSION__-win32-x64.zip` — Windows x64
- `lore-__RELEASE_VERSION__-darwin-arm64.metadata.json`
- `lore-__RELEASE_VERSION__-linux-x64.metadata.json`
- `lore-__RELEASE_VERSION__-win32-x64.metadata.json`
- `SHA256SUMS` — SHA-256 checksums for every archive and metadata file

macOS on Apple Silicon is Lorelum's priority platform and the most thoroughly validated release target. Linux x64 and Windows x64 archives are available on a best-effort basis; compatibility and performance across all distributions, system builds, hardware, and local security policies are not guaranteed.

## Alpha compatibility

CLI behavior, Pack formats, local Store data, indexes, and retrieval results may change before the first stable release. Automatic migration is not guaranteed. Before evaluating this upgrade in a shared setup, keep a backup or use an isolated `--store-root`.

## Full changelog

[Compare `v0.1.0-alpha.1` to `__RELEASE_TAG__`](https://github.com/lorelum/lorelum/compare/v0.1.0-alpha.1...__RELEASE_TAG__)

## Verification

The release workflow verifies every uploaded checksum, unpacks each archive, checks the CLI and native runtime version commands, and exercises the packaged Backend start/status lifecycle on its matching runner.
