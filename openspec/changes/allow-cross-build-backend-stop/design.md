## Context

见 [proposal.md](./proposal.md) 的动机。当前 `packages/backend/src/client/client.ts` 的 identity handshake 在 proof 验证后，要求 remote build identity 同时匹配 runtime record 和当前 CLI build；所有受保护请求都复用它，因此 stop 也在发送前被阻断。

现有 runtime record、`packages/backend/src/runtime/supervisor.ts` 的 PID/启动时间检查、loopback proof、Bearer 认证、graceful shutdown 和 instance-conditional cleanup 都已满足安全停止的需要。本 change 不修改这些机制。现有 `packages/backend/src/runtime/supervisor.test.ts` 已使用真实 daemon 和两个注入的 build identity，能直接覆盖升级场景。

## Goals / Non-Goals

**Goals:**

- 只让 protocol-compatible 的不同 build daemon 可被 `backend stop` 正常关闭。
- 复用所有现有 record、proof、secret、protocol 和 graceful shutdown 校验。
- 证明普通运行时调用仍严格拒绝不同 build。

**Non-Goals:**

- 不支持跨 protocol 停机，不新增版本化 recovery protocol。
- 不改 runtime record、supervisor 生命周期、服务端 endpoint 或本地认证。
- 不提供 PID/端口 kill fallback、远程控制或 MCP。

## Decisions

### 1. 只在 client 的 stop 请求跳过当前 build 相等性

client 保留其已有的 proof、record instance/build identity 与 protocol 检查。`BackendClient.stop()` 采用一个内部 stop-only 分支，不要求 remote build identity 等于调用 CLI 的 build；status、query、index、model 和其他请求继续使用严格路径。

这是一处局部条件调整，而不是新建恢复层。它仍在发送 Bearer credential 前验证 remote 身份，避免把 secret 交给端口上无关的服务。

替代方案：全局删除 build 检查会削弱普通业务调用；直接根据 PID/端口停止会跳过既有安全和 graceful shutdown，均拒绝。

### 2. 保持 supervisor 和 daemon 行为不变

supervisor 已按 record → PID/启动时间 → authenticated stop → 等待退出 → instance-conditional cleanup 的顺序执行；daemon 已负责模型卸载和退出。本次只让该既有调用链中的 stop HTTP 请求不被 current-build 比较阻断。

## Risks / Trade-offs

- [例外泄漏到其他接口] → 仅由 `BackendClient.stop()` 调用内部 stop 分支，并保留不同 build 的 status/query 等拒绝测试。
- [端口重绑定或错误 record] → 保留 proof、record identity、protocol、PID/启动时间和 listener conflict 的既有验证；失败不发 stop、不删 record。
- [跨 protocol 升级] → 继续返回 `backend.incompatible`；后续若需要，另行设计稳定的跨 protocol 控制合同。

## Migration Plan

1. 修改 client 的 stop identity 条件并更新单元测试。
2. 修改既有真实 daemon 测试，验证 build A 启动后 build B 能 stop，B 的 status/start 仍不兼容。
3. 更新 CLI 文档并运行 backend/CLI 测试、lint、typecheck 和 OpenSpec 校验。
4. 无 runtime data migration；升级用户直接使用原有 private record。
