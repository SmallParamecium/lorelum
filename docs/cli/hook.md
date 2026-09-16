# Codex Hook

`lore hook codex` 是 Lorelum CLI 与 Codex Plugin 之间的版本化集成 ABI。它从 stdin 读取 Codex Hook payload，并在 stdout 输出一行 Codex Hook envelope；它不输出普通 Lorelum CLI JSON envelope。

```sh
printf '%s\n' '{"hook_event_name":"SessionStart"}' | lore hook codex
```

成功时，stdout 是包含 `hookSpecificOutput.hookEventName` 和受限 `additionalContext` 的对象。Catalog 包含已安装 Pack 的名称、版本、可选 description、`appliesTo` 与当前 `packRoot`；它只是 Pack-level 的检索路由提示，不是完整 Practice 内容，也不包含 resource 文件清单或内容。`packRoot` 是可直接读取的 `current` view，而不是内部 digest 路径；后续 mutation 后它可能解析到新 bytes 或消失。需要按当前 source 使用资源时运行 `lore get` 或 `lore pack list` 刷新，不要推导 Store 内部路径。

`lore hook codex` 只支持 `SessionStart`。生命周期来源（例如 `compact`）由 Codex Plugin 的 `hooks.json` matcher 决定，CLI 不推断启动、恢复、清理或 compact 时机。它不会主动 query/get Practice、启动 Backend、下载模型、构建 index 或修改 Store。

Hook payload 无效、事件不支持或 Store 读取失败时，命令会向 stderr 写诊断，并在 stdout 输出：

```json
{ "continue": true }
```

这样 Codex 可以继续运行，不把 Lorelum 的本地问题当作会话阻塞。该 Hook 执行路径以退出码 `0` 返回；无效的 CLI 参数仍按普通 CLI 用法错误处理。

需要隔离 Store 时，使用全局选项：

```sh
printf '%s\n' '{"hook_event_name":"SessionStart"}' \
  | lore hook codex --store-root /absolute/path/to/isolated-store
```
