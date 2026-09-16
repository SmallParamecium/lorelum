## Why

当前安装器在切换 `lore` 命令入口时不会处理正在运行的旧 Backend。升级虽已完成，但用户第一次 semantic query、index 或 model 操作会命中旧 build 并返回 `backend.incompatible`，使普通升级不能直接恢复可用状态。

本 change 引入新的产品行为：受安装器管理的普通 release 升级在激活新 CLI 前，必须安全完成旧 Backend 的关闭；无法确认关闭时不得把命令入口切换到新版本。

## What Changes

- macOS/Linux 与 Windows 安装器在下载、校验和 archive 验证成功后，识别当前由 Lorelum 管理且版本不同的 CLI 入口。
- 安装器优先直接调用已验证路径中的旧 release executable 执行 `backend stop`；仅在旧 executable 不可用或不能完成安全停止时，使用已验证但尚未激活的新 release executable 做一次受现有认证/protocol 约束的 fallback。
- 只有 stop 已确认成功，安装器才写入新版本目录并原子切换 `lore` 入口。两次安全停止均失败时，安装器报错并保留原入口和旧版本；不得按 PID、端口或进程名终止进程。
- stop 失败只输出受限长度的 CLI 诊断，并给出仍指向旧 release 的恢复后重试动作；不得打印 runtime secret 或未验证的本机状态。
- 首次安装和同版本幂等重装不调用 stop。安装器的验证、下载或 archive 检查失败时也不触碰 Backend。
- 更新双语用户安装文档和 release installer integration tests，说明普通升级已自动交接 Backend；手动 `backend stop` 保留给手工恢复场景。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cli-distribution`: 安装器在激活不同 release 前安全关闭已管理的旧 Backend，并在无法确认停止时保留旧入口。

## Impact

- `install.sh`、`install.ps1` 的升级编排与错误输出。
- `scripts/release/install.integration.test.ts`、`scripts/release/install-ps1.integration.test.ts` 的 release installer acceptance。
- `apps/site/content/docs/installation.mdx` 与 `apps/site/content/docs/installation.zh.mdx` 的升级说明。
- 不改变 Backend 的认证、protocol 或 stop 语义，不增加端口/PID kill、worktree runtime 隔离、MCP 或新的网络接口。
