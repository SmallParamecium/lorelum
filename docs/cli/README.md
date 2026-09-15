# CLI 文档

Lorelum CLI 的普通机器接口是单行 JSON envelope。成功输出包含 `command`、`ok: true` 和 `data`；失败输出包含 `command`、`ok: false` 和 `error: { code, message }`。stdout 只输出这一行；诊断和模型下载进度写 stderr。`lore hook codex` 是唯一的集成 ABI 例外：它输出 Codex Hook envelope，而不是 Lorelum CLI envelope。

普通命令正常成功退出码为 `0`，可见命令错误为 `2`。调用方应按稳定的 `error.code` 处理结果，不解析 message。`lore describe` 返回当前 protocol 命令和每个 `resultSchema`，可用于动态发现未来新增的普通命令；Codex Hook ABI 使用其专门文档定义的输出。

命令按职责分组：

- [Backend 控制](backend.md)：启动、状态、停止本地 backend。
- [Model 生命周期](model.md)：准备、加载、状态、卸载 embedding 模型。
- [Semantic index](index.md)：查看、构建或替换某个 Store 的 semantic index。
- [Query](query.md)：默认使用本地 semantic query；`--mode keyword` 保留离线 keyword query。
- [Get](get.md)：读取一个已安装 Practice。
- [Pack catalog](list.md)：列出已安装 Pack 或其 Practice 目录。
- [Pack 生命周期](packs.md)：安装、更新或移除某个 Pack。
- [Codex Hook](hook.md)：向 Codex 注入受限的 Installed Pack Catalog。

使用 `lore --version` 查询 CLI 版本；`--help` 和 `--log-level` 是全局选项。需要 Store 的命令支持 `--store-root <path>`；backend/model 命令不读取或修改 LocalStore，传入该选项不会改变它们的模型来源。

## Output formats

JSON remains the default format, including for commands that also support text. Select explicitly with `--format=json|text`; `--json` and `--human` are aliases. `--agent` prefers JSON unless a format was explicitly selected. Format selection does not depend on whether stdout is a terminal or a pipe. Help parsing and rendering are intentionally outside this rollout and remain governed by issue #25. In the current CLI, `-h` / `--help` keeps the existing machine-readable `describe` response; this PR does not add a `lore help` command or fixed-text Help surface. Use `lore describe` for explicit machine-readable capabilities.

In this rollout, explicit text is available for `get`, `pack list`, `pack install`, `query`, and `--version`. Other commands remain JSON-only and reject a text request. Each command documents what its text view contains; for example, `get --format=text` writes only the complete Practice body, while `query --format=text` writes ordered Practice summaries. After text has been selected successfully, ordinary command failures go to stderr; invalid or conflicting format requests use the framework's JSON fallback.

## Protocol versions

CLI envelope 当前为 version 1；backend 内部协议当前为 version 3。内部协议对所有请求使用一致的实例身份和 build 校验。

## Output contract

示例：

```json
{
  "protocolVersion": 1,
  "toolVersion": "…",
  "command": "model.status",
  "ok": true,
  "data": {
    "state": "unloaded",
    "encodingId": "…",
    "device": "cpu",
    "dimensions": 384,
    "threads": 4
  }
}
```

`model load` 的 stdout 在任务最终完成前保持沉默；stderr 使用 `model: resolving`、`model: downloading 50% (attempt 1)`、`model: verifying` 和 `model: starting` 这样的文案，只输出发生变化的阶段、百分比或 attempt。被取消、下载失败或 native 启动失败都以最终失败 envelope 返回，不把 202 接受状态当作命令成功。
