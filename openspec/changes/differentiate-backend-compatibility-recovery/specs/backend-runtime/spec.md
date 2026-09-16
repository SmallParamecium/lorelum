## ADDED Requirements

### Requirement: Classified authenticated compatibility and explicit lifecycle recovery
在发送 runtime credential 前，Backend client MUST 先验证 runtime record 所描述的 instance ID 与 build identity、nonce-bound identity proof 以及固定 loopback authority。通过这些验证后，若 daemon 的内部 protocol 与调用 CLI 不兼容，client MUST 返回 `backend.protocol-mismatch`；若内部 protocol 兼容、daemon 与 record 的 build identity 一致、但 daemon build 与调用 CLI build 不同，除 `backend stop` 外的普通运行时调用 MUST 返回 `backend.build-mismatch`。这两类 error envelope MUST 不包含 runtime secret、build identity、本机私有路径、PID 或端口。

`backend stop` SHALL 是唯一允许跨 build 收敛既有 Backend 的 lifecycle 调用。protocol-compatible 时，它 MUST 继续验证 record、进程身份、nonce-bound proof 与 daemon/record identity，且只在全部验证通过后发送 authenticated graceful stop 并等待退出。protocol mismatch 时，当前 CLI MUST 不发送 runtime credential，也 MUST 不依赖旧 CLI；它 MUST 仅在私有 runtime record、daemon PID/启动时间及任何记录的 native model 子进程均能精确验证时，终止该 record 所拥有的 Backend 生命周期。该操作 MUST 先请求 graceful termination、在既有 shutdown deadline 内等待；仍未退出时 MUST 强制终止同一已验证生命周期并再次等待。只有全部受控进程退出后，才可按 instance ID 条件清理 record 并报告 stopped。

record identity 不一致、proof 验证失败、PID/启动时间不匹配、无关 listener 或无法验证的子进程 MUST 不得被当成可恢复候选；系统 MUST 拒绝该操作而不按端口、进程名或未经验证的 PID 终止进程。

Backend MUST 在独立于 data-plane protocol 的私有 runtime activity record 中发布自身的长时程 activity（至少包括模型准备与 index operation），并提供 host Agent 的 task lease 生命周期（获取、续约、释放）。支持的 host Agent 集成 MUST 在启动会依赖 Lorelum Backend 持续可用的长时程任务前获取 lease，并在任务运行期间续约；无法确认 lease 是否仍有效时 MUST 将 activity 视为 unknown。lease 只保存 opaque task identity、可验证 owner process identity 与到期信息，不得写入任务内容、路径、query 或用户数据。

`lore backend stop --if-idle` MUST 在 lifecycle lock 内重新读取并验证该 activity record：只有 activity 为 idle、没有有效 host lease 且 Backend ownership 仍可验证时才可执行上述 stop；activity active 或 unknown 时 MUST 不终止任何进程。直接的 `lore backend stop` 仍是用户/明确运维动作，可执行经过验证的 stop；自动恢复路径只能使用 `--if-idle`。

#### Scenario: Compatible other-build daemon rejects a normal runtime call
- **WHEN** 已验证的 runtime record 指向一个 protocol-compatible daemon，daemon build 与 record 一致但与当前 CLI build 不同，调用方执行 query、index、model、`backend start` 或 `backend status`
- **THEN** client MUST 在发送 runtime credential 或业务请求前返回 `backend.build-mismatch`，且不得停止、重启或以其他方式改变该 daemon

#### Scenario: Explicit stop switches a verified compatible build
- **WHEN** 用户或运维调用方以当前 CLI 对 protocol-compatible、经 record 和 nonce-bound proof 验证的不同-build daemon 执行 `lore backend stop`
- **THEN** 命令 MUST 向该精确实例发送 authenticated stop、等待其退出并只清理该 instance 的 record；它 MUST 不因调用 CLI build 不同而返回 `backend.build-mismatch`

#### Scenario: Explicit current CLI stop recovers a verified protocol-mismatched daemon
- **WHEN** 调用方执行当前 CLI 的 `lore backend stop`，且私有 runtime record、daemon PID/启动时间和记录的 native model 子进程都仍精确匹配
- **THEN** 当前 CLI MUST 不依赖旧 CLI 或 daemon data-plane protocol，先 graceful termination、超时后强制终止该已验证生命周期，确认退出并条件清理 record 后返回 stopped

#### Scenario: Idle compatible Backend is eligible for automatic handoff
- **WHEN** 另一 build 的 Backend 通过 identity 验证，私有 activity record 表示 idle 且没有有效 host Agent lease，调用方执行 `lore backend stop --if-idle`
- **THEN** 命令 MUST 在 lock 内再次验证 idle 和 ownership 后停止该 Backend；它 MUST 不要求用户确认，且成功后调用方可重试原命令

#### Scenario: Active or unknown Backend is protected from automatic handoff
- **WHEN** 另一 build 的 Backend 正在模型准备、index operation、有效 host Agent lease 期间运行，或其 activity record 缺失、过期或无法验证
- **THEN** `lore backend stop --if-idle` MUST 返回不执行 stop 的结果，且不得 graceful terminate、强制终止、删除 record 或中断任何长时程任务

#### Scenario: A supported Agent long task holds its Backend lease automatically
- **WHEN** 支持的 host Agent 启动会依赖 Lorelum Backend 持续可用的长时程任务
- **THEN** 集成 MUST 在不询问用户的情况下获取并续约 task lease；该 lease 有效期间，任何其他 build 的 `backend stop --if-idle` MUST 返回不执行 stop 的结果

#### Scenario: Unverified local service is not terminated
- **WHEN** runtime record 与 daemon identity 不一致、identity response 无法验证 nonce-bound proof、PID/启动时间或记录的 native 子进程不匹配，或固定地址由无关服务监听
- **THEN** 系统 MUST 保持既有的安全失败语义，而不得发送 runtime credential、把该服务作为 recovery target，或按端口、进程名或未经验证的 PID 终止它
