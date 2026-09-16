## Why

本机升级后，新的 Lorelum CLI 会因 build identity 不同而在握手阶段拒绝旧 Backend；这同时阻断了本应可恢复的 `lore backend stop`，迫使用户手动终止进程或找回旧版本 CLI。本次变更只修正 stop 的这项 build 比较，让新 CLI 复用已有的本地安全校验来正常停止旧 daemon。

这是新增的产品行为，不是对既有行为的事实记录。

## What Changes

- 仅对 `backend stop` 放宽“remote build identity 必须等于当前 CLI build identity”的判断。
- `backend stop` 继续使用既有 private runtime record、PID/启动时间、loopback identity proof、runtime secret、内部 protocol compatibility、退出等待和 instance-conditional record cleanup；不新增 record 或恢复机制。
- 保持 `backend start/status`、query、index、model 和其他普通运行时调用当前的 build / protocol compatibility guard。
- 不新增监听地址、端口/PID kill fallback、远程控制或 MCP 接口。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `backend-runtime`: 允许当前 CLI 通过既有受认证本地控制边界停止 protocol-compatible 的不同 build Backend，同时保持普通调用的严格兼容性检查。

## Impact

- `packages/backend/src/client/client.ts` 的 stop 身份检查分支及其单元测试。
- `packages/backend/src/runtime/supervisor.test.ts` 的真实 daemon 升级回归。
- `docs/cli/backend.md` 的 lifecycle 命令说明和本 change 的 backend-runtime delta spec。
