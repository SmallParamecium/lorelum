## 1. Backend 身份、activity 与受验证 lifecycle

- [x] 1.1 在 `packages/backend/src/protocol/errors.ts` 和 client identity handshake 中把已验证的 protocol/build 差异分别映射为 `backend.protocol-mismatch`、`backend.build-mismatch`；为 proof/record identity 失配保留非恢复安全失败，并以 client tests 断言普通请求在发送 runtime credential 前失败。
- [x] 1.2 在 runtime coordination 层新增独立、私有且 instance-bound 的 activity record，复用 runtime record 的权限、非链接、原子写入约束；为缺失、坏格式、过期、instance 不同和并发读写测试 `unknown` 语义及不泄露任务数据。
- [x] 1.3 将模型准备和 index operation 的真实开始/结束接入 activity record，并为 host Agent 提供 machine-oriented task lease acquire/renew/release CLI 生命周期；以 unit tests 验证有效 lease、owner identity/heartbeat、正常 release、过期与续约失败的 active/unknown 判定。
- [x] 1.4 在 Backend supervisor 实现 `stop({ ifIdle: true })` 和 `lore backend stop --if-idle`：在 lifecycle lock 内二次验证 record、进程、activity 和 lease，只有明确 idle 才停止；用 race tests 验证 stop 前开始模型/index/lease 会返回未停止且不发任何 signal。
- [x] 1.5 扩展显式 `lore backend stop` 的 protocol-mismatch recovery：对私有 record、daemon PID/startedAt 与记录 native child 全部匹配、且 child 直接 parent 为 daemon 的 lifecycle 先 graceful terminate、超时 force terminate、确认退出再按 instance 清理；已在 macOS 验证受控 daemon/native child，且 PID reuse、篡改 record、失配 child、无关 listener 均不被终止。Windows 的真实 lifecycle 验证留给后续平台验收，不作为本 change 的 PR gate。

## 2. CLI policy 与 Agent 无感恢复

- [x] 2.1 扩展 CLI error envelope、`CliError`、JSON schema 和 `describe`，为两种 mismatch 发布无敏感信息的 `{ action: "backend.stop-if-idle", automation: "auto" | "defer", reason, retry: "original-command" }`；以 schema/main/discovery tests 验证字段稳定、exit code 为 2 且不含 PID、端口、路径、secret、build hash 或 task 内容。
- [x] 2.2 更新 semantic query error mapping，使它只返回上述 policy、绝不直接调用 supervisor stop 或自动降级 keyword；以 runtime-client/query-command tests 验证仅 `backend.unavailable` 保留既有 start 行为，以及 keyword mode 完全不接触 Backend。
- [x] 2.3 更新 `lore backend stop` command surface、allowlist 和 JSON result：普通 stop 是显式运维收敛，`--if-idle` 是唯一允许自动恢复调用的受限动作；用 CLI tests 验证 active/unknown 不停止、idle 成功停止、stop 前状态变化安全转 defer。
- [x] 2.4 更新 `plugins/lorelum/skills/lorelum/references/semantic-query-recovery.md` 及关联集成测试：支持的 host Agent 对 Lorelum 相关长任务自动 acquire/renew/release lease；对 `automation:auto` 自动运行 `backend stop --if-idle` 并重试，对 `defer` 保持任务运行并后台退避重试，绝不询问用户是否停止或调用普通 stop。

## 3. 用户文档与跨平台验收

- [x] 3.1 更新 `docs/cli/query.md`、`docs/cli/backend.md` 及对应中英文 site 文档，说明 query 会自动恢复或后台等待、用户显式 `backend stop` 可收敛已验证旧 Backend，以及不会按端口/进程名 kill；验证文档示例与 JSON schema/command discovery 一致。
- [x] 3.2 运行并记录聚焦 Backend/CLI/plugin tests（client、runtime state/activity、supervisor、真实 daemon/native child、coordinator、query command/runtime-client、main envelope、hook/Skill）；已在 macOS 执行受控 daemon/native child lifecycle 证明，并运行 `openspec validate differentiate-backend-compatibility-recovery --strict`、`bun test packages/backend`、`bun test packages/cli`、`bun run typecheck`、`bun run lint`、`bun run fmt:check`。Windows 的真实 lifecycle 验证留给后续平台验收，不作为本 change 的 PR gate。
