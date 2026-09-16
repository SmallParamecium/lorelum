# ADR 0016: Public Pack current locators

- **Date:** 2026-09-15
- **Status:** Proposed (local implementation)
- **Supersedes:** the locator portion of ADR 0015
- **Related:** ADR 0007, ADR 0014, ADR 0015

## Context

ADR 0007 correctly stores each Pack artifact under a content digest. That internal layout provides immutable snapshots, integrity verification, idempotent installation, atomic publication, and recovery. ADR 0015 then exposed the same digest directory as `packRoot` when Pack-native resources needed a filesystem entry point.

The resulting root is technically valid but is not an appropriate public contract: it is noisy, changes whenever any artifact byte changes, and makes hosts depend on an Engine storage detail. The SessionStart Catalog, `lore get`, and Pack-list commands need a concise, directly readable Pack root. Existing Stores created before this decision have valid manifest entries and artifacts but no such entry point.

## Decision

For every active Pack, Lorelum publishes this public root:

```text
<store-root>/packs/<storageKey>/current
```

On macOS and Linux, `current` is a relative directory symlink to the active digest artifact. On Windows, it is a directory junction to that artifact. The manifest entry `{ storageKey, artifactDigest }` and the digest-verified sealed artifact remain the only authoritative Pack state. `current` is derived data: it is not written into SQLite, the manifest, a projection, or an artifact digest, and it is never used to infer Pack truth.

`lore get`, all `lore pack list` forms, successful `lore pack install`, successful `lore pack update`, and the Codex SessionStart Catalog return this public path as `packRoot`. Query remains path-free; remove returns no root after removing the Pack.

Install, idempotent install, update, remove, reindex, and journal recovery reconcile `current` with the final manifest while holding the mutation lock. A locator-returning read verifies its digest artifact first. If `current` is missing, dangling, or points at a different artifact, it acquires the lock, rebuilds derived locators from the converged manifest, and retries without changing generation, effectiveRevision, retrieval index work, or canonical Pack content. A non-link object occupying `current` is not recursively deleted; the Store fails closed rather than treating unknown contents as Pack state.

`current` is a mutable view, not a historical snapshot pin. A Pack mutation may cause an already-returned path to resolve to newer bytes, or may remove it. Hosts that need to interpret resources against the current selected Practice must rerun `lore get` or `lore pack list` after a relevant mutation; they must not derive the hidden digest path.

## Consequences

Agents and users receive readable paths such as `.../packs/p-agentic-coding/current/references/...` while the Engine retains its immutable digest artifacts and recovery guarantees. Older Stores migrate lazily and safely on their first locator use, without a schema migration or forced index rebuild.

The public path is deliberately not a byte-stable capability. Callers that require historical reproducibility need a separately designed snapshot/export capability; this decision does not retain or expose old Pack roots after update.
