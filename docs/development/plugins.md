# Plugin development

This guide is for maintainers developing the **Lorelum** Codex Plugin from a checkout. It deliberately separates a user's public marketplace installation from a checkout-backed development installation: they share the same public selector, `lorelum@lorelum-plugins`, but must not be enabled together.

## Source and contract boundary

The Plugin source is [`plugins/lorelum`](../../plugins/lorelum). It is outside the Bun workspace and communicates with Lorelum only through the public `lore` CLI. The CLI owns the Codex Hook protocol adapter and Catalog rendering; the Plugin owns lifecycle matching and Skill guidance. Do not import Engine packages, read LocalStore files, duplicate retrieval/ranking logic, or add a local MCP wrapper in the Plugin.

Local MCP is outside the current product and development scope. Do not treat the `packages/mcp` scaffold as a development dependency or a future local Plugin path. MCP may be reconsidered only for a separately approved platform remote-retrieval service.

The Hook defaults to `lore hook codex`; the Lorelum Skill invokes `lore query` and `lore get` when appropriate. A normal installed Plugin requires Lorelum CLI v0.1.0-alpha.2 or later and should use the released `lore` command, not a command built from a temporary worktree. The Hook wrapper degrades safely when an older CLI does not recognize the ABI. To validate current CLI source, use the source-entrypoint workflow in [Local CLI and multiple worktrees](./README.md#local-cli-and-multiple-worktrees).

[Agent integration](../../openspec/specs/agent-integration/spec.md) owns the host Catalog and retrieval-flow contract; [retrieval query](../../openspec/specs/retrieval-query/spec.md), [local model runtime](../../openspec/specs/local-model-runtime/spec.md), and [semantic index](../../openspec/specs/semantic-index/spec.md) own the corresponding CLI lifecycle semantics. [`docs/cli/query.md`](../cli/query.md) is their command reference. `skills/lorelum/SKILL.md` and `plugins/lorelum/skills/lorelum/SKILL.md` are separate host-specific translations: the generic Skill establishes a Catalog when context lacks one, while the Codex Skill uses Hook-injected Catalog metadata. They may intentionally differ in wording, timing, and recovery guidance to suit their host, so do not require text-level synchronization. Review each change against the relevant host behavior, current specs, and the scenarios in [Skill guidance fixtures](skill-guidance-fixtures.md).

## Verify source changes

From the repository root:

```sh
bun test packages/cli/src/hook plugins/lorelum/scripts
python3 "$HOME/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py" plugins/lorelum
```

The validator may require PyYAML in the Python environment. If it is unavailable, use the test suite and JSON/YAML structural checks as a fallback, but do not treat that fallback as a successful validator run.

Smoke-test the Hook against the current CLI source without altering the global `lore` command. Use an isolated Store root for any Store-opening check. This maintainer workflow uses Bun to execute TypeScript source; ordinary Plugin users run the compiled `lore` release only:

```sh
printf '%s\n' '{"hook_event_name":"SessionStart","source":"compact"}' \
  | bun packages/cli/src/main.ts hook codex --store-root /absolute/path/to/isolated-store
```

The result should contain `hookSpecificOutput.additionalContext` headed `Lorelum Installed Pack Catalog`. A `PostCompact` event is intentionally unsupported and should degrade to `{ "continue": true }`: Codex restores the catalog through the supported `SessionStart` source `compact` instead.

## Checkout-backed install and hot reload

The repository marketplace at `.agents/plugins/marketplace.json` is a public marketplace definition, but `codex plugin marketplace add` also accepts the current checkout as a local source. Do not configure that local source alongside the remote `lorelum-plugins` marketplace: both expose `lorelum@lorelum-plugins` and would make the active source ambiguous.

First inspect configured marketplaces. If the public `lorelum-plugins` marketplace is already configured, remove that source before adding the local checkout; remove the installed Plugin first only if Codex requires it:

```sh
codex plugin marketplace list
codex plugin remove lorelum@lorelum-plugins
codex plugin marketplace remove lorelum-plugins
codex plugin marketplace add "$PWD"
```

Install the Plugin from the checkout-backed marketplace:

```sh
codex plugin add lorelum@lorelum-plugins
```

For each local Plugin iteration, update the development-only cachebuster and reinstall. The helper replaces any old suffix with one timestamped suffix; it does not change the public Plugin identity.

```sh
python3 "$HOME/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py" plugins/lorelum
codex plugin add lorelum@lorelum-plugins
```

Start a new Codex task after reinstalling, and re-trust Hooks whenever `hooks/hooks.json` changes. Do not commit the cachebuster version: set the manifest back to the intended release version before committing. To return to the public source, remove the local `lorelum-plugins` marketplace, add `lorelum/lorelum`, and reinstall `lorelum@lorelum-plugins`.
