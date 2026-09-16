## ADDED Requirements

### Requirement: Semantic query reports safe compatibility recovery
当默认或显式 semantic `lore query` 遇到 `backend.build-mismatch` 或 `backend.protocol-mismatch` 时，CLI MUST 输出 `ok: false` 的 JSON error envelope 并以 exit code 2 结束。除 code 和无敏感信息的 message 外，error MUST 包含 `recovery` 对象：`action` 为 `backend.stop-if-idle`、`automation` 为 `auto` 或 `defer`、`reason` 为 `idle`、`active-long-task` 或 `unknown-activity`，`retry` 为 `original-command`。支持的 host Agent recovery runner MUST 在 `automation: "auto"` 时自动执行当前 CLI 的 `lore backend stop --if-idle` 后重试，不得询问用户；在 `automation: "defer"` 时 MUST 不打断另一任务，而是在后台等待 activity 结束后重试原 query。

build mismatch 的恢复说明 MUST 表明当前 CLI 将对 protocol-compatible 的另一 build 执行 authenticated stop；protocol mismatch 的恢复说明 MUST 表明当前 CLI 能直接收敛经私有 runtime record 和精确进程身份验证的旧 Backend，而不要求用户找回旧 release/worktree。自动 handoff 的 eligibility 必须由 activity/ownership lease 决定；query 本身 MUST 不执行 `backend stop` 或绕过既有 coordinator 的 lifecycle 操作、PID/端口终止，且 MUST 不降级为 keyword retrieval。

#### Scenario: Idle build mismatch is automated without interrupting work
- **WHEN** semantic query 连接到一个 protocol-compatible 的不同-build Backend
- **THEN** 若 activity/ownership 为 idle，CLI MUST 返回 `backend.build-mismatch` 和 `automation: "auto"` 的结构化 recovery；支持的 host Agent recovery runner MUST 自动执行 `lore backend stop --if-idle` 并重试，且 query 本身不得直接调用 stop 或向用户询问确认

#### Scenario: Active or unknown mismatch is deferred rather than interrupted
- **WHEN** semantic query 连接到内部 protocol 不兼容的已验证 Backend
- **THEN** 若 activity/ownership 为 active 或 unknown，CLI MUST 返回 `backend.protocol-mismatch` 和 `automation: "defer"` 的结构化 recovery；host Agent MUST 不终止该 daemon，而应等待/后台重试原 query，直到它成为 idle 或收到更明确的运维指令

#### Scenario: Keyword mode remains offline during another build's runtime conflict
- **WHEN** 另一个 build 的 Backend 正在运行，调用方执行 `lore query <text> --mode keyword`
- **THEN** 命令 MUST 保持 keyword retrieval 的离线路径，不得连接、停止或改变该 Backend
