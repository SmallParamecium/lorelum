## MODIFIED Requirements

### Requirement: Private loopback lifecycle
Backend SHALL 仅监听固定 loopback authority `127.0.0.1:26186`。`lore backend start` MUST 安全复用兼容实例或启动新实例，`lore backend status` MUST 保持只读，`lore backend stop` MUST 仅在 daemon 实际进入停止流程后报告成功；这些命令 MUST 不使用 `--store-root` 选择模型、配置或服务地址。

当 `backend stop` 发现既有当前用户受保护 runtime record 所描述的存活实例与调用 CLI 的 build 不同时，MUST 不得仅因 build 不兼容拒绝该操作。它 MUST 继续验证既有 record、record 中 PID 与启动时间、固定 loopback identity proof、record 的 instance ID 和 build identity，以及当前内部 protocol compatibility；验证通过后才向该实例发送 authenticated stop，并等待 daemon 退出后仅清理仍属于该 instance ID 的 record。不存在的记录进程可安全收敛为 stopped；无效 record、PID 已复用、identity 不匹配、protocol 不兼容或由无关进程占用端口时，MUST 拒绝停止且不得删除 record 或终止任何发现到的进程。

#### Scenario: Repeated lifecycle control
- **WHEN** 调用方对已运行或已停止的 Backend 重复执行 start、status 或 stop
- **THEN** 命令 MUST 返回与实际 lifecycle 状态一致的 JSON 结果，且 MUST 不按端口号或进程名终止未经认证的进程

#### Scenario: New CLI stops a verified different-build daemon
- **WHEN** build B 的 `lore backend stop` 读取到由 build A 启动、内部 protocol 仍兼容且受当前用户私有 runtime record 精确描述的 daemon
- **THEN** 命令 MUST 在验证 record、进程身份与 nonce-bound identity 后向 A 发送 authenticated stop，等待其正常退出并只清理该实例的 record，而不得返回 `backend.incompatible`

#### Scenario: Unsafe recovery candidate is refused
- **WHEN** `backend stop` 读取到无效或不私有的 record、PID/启动时间不匹配、identity proof 或 identity 字段不匹配、protocol 不兼容，或 record 指向的进程不存在但固定端口被无关进程监听
- **THEN** 命令 MUST 失败而不发送 stop、不终止该进程且不删除该 record

### Requirement: Authenticated local control boundary
对于 query、index、model、`backend start`、`backend status` 和其他普通运行时调用，Backend client MUST 先验证 nonce-bound instance identity、调用方 build identity 和内部协议兼容性，随后才向受保护接口发送 runtime credential。`backend stop` 是唯一 build-identity 例外：它仍 MUST 用 record secret 验证 nonce-bound identity proof，并要求 remote 的 instance ID 与 build identity 匹配既有 runtime record、protocol 与当前调用方兼容；只有全部相符后，才可向该精确实例发送 runtime credential 和 stop 请求。该例外 MUST 不得复用于其他接口。

Backend MUST 拒绝不符合 loopback authority、Host、Origin、body-size 与认证边界的请求，且 MUST 不向响应泄露 runtime secret、本机私有路径、native 私有端口或原始 Practice/query 输入。

#### Scenario: Untrusted local HTTP request
- **WHEN** HTTP 请求缺少有效认证、携带 Origin、使用错误 authority 或超过 body 限制
- **THEN** Backend MUST 拒绝该请求，且响应 MUST 不泄露 daemon runtime detail

#### Scenario: Incompatible build cannot use normal runtime APIs
- **WHEN** 调用 CLI 的 build identity 或 protocol version 与运行 daemon 不兼容，且调用 query、index、model、start 或 status 等普通 runtime API
- **THEN** client MUST 在发送 runtime credential 或业务请求前拒绝该调用，并报告既有的不兼容结果

#### Scenario: Stop keeps protocol and record identity checks
- **WHEN** 调用方以不同 build 执行 `backend stop`，但 remote 的 instance ID、build identity、protocol version 或 nonce proof 任一不满足既有校验
- **THEN** client MUST 拒绝请求，且不得发送 runtime credential 或 stop
