## 1. Narrow stop compatibility fix

- [x] 1.1 在 `packages/backend/src/client/client.ts` 仅为 `BackendClient.stop()` 跳过 remote build identity 与当前 CLI build identity 的相等判断；保留现有 proof、record identity、protocol、loopback 和 Bearer-before-request 校验，并以 `bun test packages/backend/src/client/client.test.ts` 验证。
- [x] 1.2 调整 client 测试：不同 build 的 stop 成功；不同 build 的 status、query 等普通调用仍在发送 credential 前返回 `backend.incompatible`；protocol 不兼容的 stop 仍被拒绝。

## 2. Upgrade regression and documentation

- [x] 2.1 修改 `packages/backend/src/runtime/supervisor.test.ts` 的真实 daemon 不同 build 场景：build B 成功停止 build A，并验证 A 退出、record 清理，且 B 的 status/start 仍为 `backend.incompatible`。
- [x] 2.2 更新 CLI/API reference 与 public site 的 Backend/installation 文档，说明 `backend stop` 可安全停止 protocol-compatible 的不同 build 实例，普通 lifecycle/runtime 请求仍遵守 build compatibility；验证文档不承诺 PID/端口 kill 或跨 protocol 停机。
- [x] 2.3 运行 `openspec validate allow-cross-build-backend-stop --strict`，确认 delta spec 反映上述最小范围。

## 3. Verification

- [x] 3.1 运行 focused client 与 supervisor 测试，随后运行 `bun test packages/backend`；验证不同 build stop 与既有认证/lifecycle 行为均通过。
- [x] 3.2 运行受影响 CLI 测试，随后运行 `bun test packages/cli`；验证 JSON envelope 与 `backend.incompatible` 映射没有回归。
- [x] 3.3 运行 `bun run lint`、`bun run typecheck` 和格式检查；验证输出无新增失败，并在交付中单列环境限制。
