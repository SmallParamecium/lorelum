## Context

动机和可观察合同见 [proposal.md](./proposal.md) 及两份 delta spec。本设计只说明如何在不打断工作、不泄露本地控制凭据的前提下实现它。

**Observed：**source-mode build identity 包含 worktree realpath，因此同一提交的不同 worktree 也会不同（`packages/backend/src/runtime/build-identity.ts`）。Backend client 在读取并验证 nonce-bound identity proof 后，仍把 record identity、调用方 build 和 protocol 的差异统一抛为 `backend.incompatible`；只有 `stop()` 跳过调用方 build 相等检查（`packages/backend/src/client/client.ts`）。

runtime record 已是受保护的本地 ownership 依据：它校验目录/文件私密性、拒绝 symlink 和 hard link，并持有 daemon PID、启动时间、instance ID、secret 与可选 native model 子进程（`packages/backend/src/runtime/runtime-state.ts`）。`isSameProcess` 用 PID 加启动时间防止 PID reuse；daemon 收到 `SIGTERM`/`SIGINT` 会等待 index operation、卸载 embedding 并按 instance ID 清理 record（`packages/backend/src/runtime/process-identity.ts`、`packages/backend/src/runtime/daemon.ts`）。

但现有 `BackendStatus` 只有 daemon/model state，`IndexOperationService` 的 active operation 只留在进程内；没有可跨 build 读取的 activity，也没有 host Agent 的长任务 ownership。因此仅凭 `ready` 自动 stop 会在竞态和长任务下误伤工作。当前本机的旧 CLI 也实际返回了笼统的 `backend.incompatible`，证明这个恢复路径不能靠 Agent 解析 message 补救。

**Required：**Agent 不得因 build/protocol mismatch 把长时程任务停下来询问用户。它必须在能证明另一个 Backend 空闲时自行收敛并重试；活动中或无法证明空闲时继续后台等待。用户明确执行 `lore backend stop` 则是运维动作：新版 CLI 应收敛被精确验证的旧生命周期，不要求旧 CLI 仍存在。

## Goals / Non-Goals

**Goals:**

- 在 proof 与 record ownership 已验证后，以稳定 code 区分 build mismatch 与 protocol mismatch。
- 以私有 activity record 和 task lease 做出“可自动 handoff / 必须 defer”的可验证判断，而不是 message、端口或 `ready` 猜测。
- 让支持的 host Agent 在 `auto` 时无感恢复，在 `defer` 时后台等待重试；两者都不要求用户确认。
- 让显式 `backend stop` 能对 protocol-mismatched 的已验证旧 daemon 完整执行 graceful→force 的生命周期收敛。

**Non-Goals:**

- 不让 query、index、model、start 或 status 隐式 stop/kill 其他 Backend；它们只报告状态或执行自身原有的业务路径。
- 不按端口、进程名、未验证 PID 或外部 listener 选择/终止对象，不发送 runtime secret 给未经验证的服务。
- 不把多个 worktree 变成可共享、可多实例并发的 Backend；本 change 仍只管理固定 loopback authority 的单一受验证实例。
- 不提供远程 control plane、MCP、常驻 helper 或让用户在普通 query 恢复时选择/输入底层 PID、build、协议值。

## Decisions

### 1. 先完成身份验证，再按 protocol、build 分类

identity handshake 保持既有顺序：读取 identity response、校验 schema、校验 nonce-bound proof、比对 runtime record 的 instance/build identity。任何一步失败均是未验证对象，沿用 `backend.port-conflict` 或 `backend.state-invalid`，没有 recovery action，也绝不能发 credential 或发信号。

只有目标已被验证后才分类：

```text
daemon protocol != current protocol  -> backend.protocol-mismatch
daemon build != caller build          -> backend.build-mismatch
otherwise                              -> compatible
```

protocol 优先，因为 data-plane 的 stop 请求不能跨未知 protocol 假定可解析。普通 client request 因此在 credential/business request 前停止；其中不会有 stop side effect。model encoding/profile 的其他 `backend.incompatible` 用途保持原 code，避免把非 lifecycle 的问题错误标成可 handoff。

不采用“保留 `backend.incompatible`，只改文案”：host Agent 无法稳定识别可恢复性，只能再次把决定抛给用户。

### 2. 为 activity 与 host Agent task lease 建立独立的私有 record

不向现有严格的 `instance.json` 随意加字段。新增独立的、同样使用私有目录/非 symlink/非 hard-link 校验和原子 replace 写入的 activity record，以 runtime `instanceId` 绑定，旧 CLI 不理解它时安全地得到 `unknown`。它不属于 Store、不会通过 Backend HTTP 返回，也不进入 query error。

最小内容如下；具体时间预算是实现配置，不在此阶段写死：

```ts
type RuntimeActivity =
  | { readonly state: "idle" }
  | { readonly state: "active"; readonly kind: "model-preparation" | "index-operation" };

interface HostTaskLease {
  readonly leaseId: string; // opaque random token
  readonly owner: { readonly pid: number; readonly startedAt: string };
  readonly heartbeatAt: string;
  readonly expiresAt: string;
}

interface RuntimeActivityRecord {
  readonly schemaVersion: 1;
  readonly instanceId: string;
  readonly activity: RuntimeActivity;
  readonly leases: readonly HostTaskLease[];
}
```

daemon 在模型准备、index operation 的开始/结束处发布 activity；异常退出或无法安全读写时不伪装为 idle。支持的 host 集成为自己启动的、需要 Backend 保持可用的长任务调用 machine-oriented lease acquire/renew/release CLI 操作：任务开始前 acquire，运行中续约，完成/cancel 时 release。lease 只含 opaque token、process identity 与心跳/到期时间，不能包含 prompt、文件路径、query、用户身份或工作内容。

lease 的目的不是让用户手工保活。它是 host Agent runtime 的责任：在可判断的 normal flow 中自动管理，不弹确认框、不把 token 展示给用户。续约失败、过期但 owner 不能精确验证、record 缺失/版本不懂、或 daemon instance 不一致，都归为 `unknown`。`unknown` 的保守处理是 defer，不是 kill。

不采用只读 `BackendStatus.state === "ready"` 的方案：它既看不到 index/model 中的真实后台工作，也无法表达另一个 Agent 的任务 ownership。也不把 activity 写到 public HTTP status：它会泄露本机任务信息，并让旧 protocol 成为自动恢复的依赖。

### 3. 把自动 handoff 限制在 `backend stop --if-idle`，并在 lock 内二次判定

新增受限 lifecycle action `lore backend stop --if-idle`。它先完成和普通 stop 相同的 runtime record、process identity、listener/proof（适用时）验证；然后在既有 lifecycle/startup lock 内重新读取 activity record，确认：

1. runtime record 仍是同一 instance，daemon 与已记录 native child 仍精确匹配；
2. activity 明确为 `idle`；
3. 没有有效 host task lease；
4. activity record 可安全读取、版本可识别且绑定相同 instance。

任一条件不成立，命令返回“未停止”的 machine-readable lifecycle result，且不发 graceful signal、force signal、删除 record 或修改另一任务。这样覆盖“query 报错时 idle、真正 stop 前模型下载或另一个 Agent 任务开始”的竞态。

普通 `lore backend stop` 保持显式运维含义，不受 `--if-idle` 的 activity gate 限制。它可以停止经过验证的其他 build；protocol-compatible 时走 authenticated stop，protocol-mismatched 时走本地进程控制。Agent 的自动恢复路径绝不调用普通 stop。

### 4. host Agent 根据 `recovery.automation` 无感决策，而不是询问用户

semantic query 保持纯观察者：它生成 JSON error，不调用 supervisor stop。failure envelope 对两种 mismatch 都给出：

```json
{
  "action": "backend.stop-if-idle",
  "automation": "auto | defer",
  "reason": "idle | active-long-task | unknown-activity",
  "retry": "original-command"
}
```

支持的 host Agent recovery runner 是唯一的自动编排者：

- `automation: "auto"`：直接执行当前 CLI 的 `lore backend stop --if-idle`。若它确实停止，立刻重试原命令；若 lock 内二次判定变为 active/unknown，则转为 defer。
- `automation: "defer"`：不显示“是否停止”的提问，不调用 stop/kill；保持任务继续运行，并以退避/事件驱动方式在后台重试原命令，直到 activity 变为 idle 或出现一个更具体、非兼容性错误。

这使 Agent 能在确定安全时自动化，也使不确定性只降低恢复速度而不会破坏另一任务。普通 CLI 用户不需要知道 runner 细节；安装器升级已先 stop 旧 Backend，正常升级不会走到该恢复分支。

不采用让 query 自己 stop 的方案：读取请求会变成跨 build 的破坏性动作；它也无法保护并行 Agent 的 task lease。也不采用 `requiresConfirmation`：用户确认并不能消除“当前工作尚活跃”的事实，反而会把每次恢复变成 Agent 中断。

### 5. protocol mismatch 用当前 CLI 的受验证本地 lifecycle control 收敛

显式 `lore backend stop` 在 protocol mismatch 时不发送 runtime credential，也不依赖旧 CLI/data-plane protocol。它在 lifecycle lock 中重新验证私有 record、daemon PID/startedAt 和所有记录 native model child；任何不匹配都拒绝。

验证通过后，当前 CLI 向精确 daemon lifecycle 请求 graceful termination，并在 shutdown deadline 内等待。daemon 已有 signal handler，会停 HTTP、等待 index idle、卸载 embedding 并清理自己的 record。超时仍存活时，CLI 只 force terminate 私有 record 中已经逐个验证的 daemon 与 native child；native child 还必须证明其直接父进程仍是该 daemon。再次确认二者全部退出后，才按 instance ID 条件清理 record。

不按 POSIX process group 或 Windows 的泛化 process-tree 枚举终止：它们可能包含没有写入 runtime record 的同组工作，无法满足“不终止未验证进程”的边界。POSIX 从进程元数据确认 direct parent，Windows 从 `PROCESS_BASIC_INFORMATION` 确认 parent PID；两端都不能由“端口还在”推导 kill target。进程身份、parent 验证和 signal/terminate API 封装在 runtime lifecycle 层，CLI 只调用 supervisor 的稳定 stop use case。

## Risks / Trade-offs

- [增加 activity record 与 lease，存在状态崩溃/过期] → 独立私有 record、instance binding、原子写入、在 lock 内复读；任何缺失、坏格式、过期或身份无法验证一律是 `unknown → defer`。
- [host Agent 的 lease 管理失效] → acquire/renew/release 是支持集成的标准任务生命周期；续约失败不会导致自动 stop，只有明确 idle 才能 handoff。
- [idle 判定和 stop 之间的竞态] → `--if-idle` 在 lifecycle lock 内二次读取，且结果可返回“本次未停止”，runner 按 defer 重试。
- [protocol mismatch 遗留 native child] → daemon lifecycle 与每个记录 child 作为完整、逐一验证的终止单位；macOS/Linux/Windows 做真实进程测试。
- [新 error/recovery 字段影响 JSON consumer] → recovery 为 optional addition，但 build/protocol code 拆分按 alpha breaking contract 发布；更新 `describe`、schema、docs 和 host Skill。
- [普通用户担心后台被关掉] → 只有 idle 且 verified 的自动路径可关；正常安装升级已经先完成 stop；任何 active/unknown 均不动，用户显式 `backend stop` 才是强制收敛入口。

## Migration Plan

1. 在 Backend protocol/client 中完成已验证的 protocol/build 分类；保留未验证 listener/record 的原安全失败。
2. 在 runtime 层实现私有 activity record、模型/index 自动 activity、host task lease 生命周期与 `stop --if-idle` 的 lock 内二次校验；补真实 daemon/native child lifecycle 路径。
3. 扩展 supervisor 的 protocol-mismatch explicit stop：verified graceful→force termination，按平台验证 record 中 daemon/native child 的 PID、启动时间和直接 parent 关系，并条件清理 record。
4. 在 CLI envelope/query mapping 中发布 recovery policy；在支持的 Lorelum host Skill/recovery reference 中实现 lease 管理和 `auto/defer` runner 规则。普通 query 仍不调用 stop。
5. 更新中英文用户文档：解释“会自动恢复或后台等待”的可观察结果、显式 `backend stop` 的恢复能力和安全边界，不让用户处理 build/protocol/PID 细节。
6. 回滚时不删除 runtime/activity record 或杀进程；旧 CLI 只会给出旧的 incompatibility 失败，已运行的 Backend 继续受现有 ownership/cleanup 保护。
