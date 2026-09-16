## Context

见 [proposal.md](./proposal.md) 的动机。当前 POSIX 安装器在 archive 验证后，只检查 `lore` 是否是指向安装根 `versions/*/lore` 的符号链接，再原子替换链接；Windows 安装器只检查 `lore.cmd` 文本包含安装根下的 `versions\\` 路径，随后替换 shim。两者都不会停止旧 Backend。相关现状见 `install.sh:154-174`、`install.ps1:234-258` 和 release installer integration tests。

Backend 自身已拥有安全停止所需的 runtime record、进程身份、nonce-bound proof、protocol 检查、authenticated stop、退出等待与 instance-conditional cleanup；安装器只应调用 `backend stop`，不能复制或绕过这些机制。见 `packages/backend/src/runtime/supervisor.ts:95-118` 与现有 cross-build stop contract。

## Goals / Non-Goals

**Goals:**

- 让普通 release 升级在新入口生效前完成旧 Backend 的安全交接。
- 无法确认 stop 成功时保留旧入口，使用户仍能用原 release 正常工作。
- 在 macOS/Linux 与 Windows 使用同一可观察合同，并以平台安装器 integration tests 验证命令顺序和失败回退。

**Non-Goals:**

- 不支持多个 worktree/build 同时运行，不修改单实例 Backend 设计。
- 不放宽普通 query、index、model、start 或 status 的 build/protocol 兼容性检查。
- 不增加强杀、端口扫描、PID kill、远程控制或新的网络接口。
- 不承诺为已经缺失的历史 CLI 或无法兼容的历史 Backend 绕过现有认证/protocol 边界。

## Decisions

### 1. 以旧受管理 executable 为主、已验证 candidate 为 fallback

升级候选在下载、checksum、archive layout、native manifest、外部入口冲突和目标版本目录一致性检查完成后，尚未写入新入口。若当前入口指向不同 release，安装器从该入口解析旧 executable 的绝对路径，并直接调用：

```text
<old-managed-release>/lore backend stop
```

旧 CLI 最可能与运行中的旧 Backend 具有相同的内部 protocol，因此能覆盖新 CLI 无法跨 protocol 停止的升级路径。若旧 executable 缺失、不能执行或 stop 非零，安装器直接运行已验证 extraction 中的 candidate executable 做一次 fallback；candidate 仍受既有 record、proof 和 protocol 校验保护。

不选择仅调用新 CLI：跨 protocol 升级时新 CLI 按设计会拒绝停止旧 daemon。也不选择只打印一条升级提示：这样新入口会已激活而 Backend 仍是旧 build，无法满足普通用户升级后可直接使用的目标。

### 2. 停止成功是入口切换的前置条件

只有旧 CLI 或 candidate CLI 的 `backend stop` 成功退出，安装器才 materialize 新版本目录并原子更新符号链接或 shim。两者均失败时，脚本以非零退出，旧入口及其旧版本不变，不输出安装成功信息。失败输出保留最后一次 stop 的受限长度诊断，并给出使用旧入口恢复后重试的命令；安装器不输出 runtime record、secret 或自行推断的进程状态。

如果 stop 已成功但随后版本目录移动或入口切换失败，旧入口仍保留，Backend 保持 stopped；旧 CLI 的下一次 semantic 操作可按既有生命周期重新启动 Backend。这比回滚重启未知状态的 daemon 更安全。

### 3. 只执行可验证的安装器管理路径

POSIX 安装器继续只接受安装根 `versions/<version>/lore` 下的 managed link target，并直接执行该 target，而不执行 `lore` 名称或搜索 `PATH`。Windows 安装器必须把当前宽松的“文本包含 `versions\\`”检查拆开：在需要执行旧版本时，仅接受安装器生成的两行 shim 格式，提取其中被引号包裹、位于安装根单个版本目录下的 `lore.exe`，再直接调用 executable。不能安全解析的 shim 不得作为可执行 authority；安装器只可使用 candidate fallback，且 fallback 失败时保留原 shim。

不执行任意 `.cmd` 文本，避免把现有的入口所有权宽松判断扩大为代码执行能力。

### 4. 不打断首次安装与同版本幂等重装

没有受管理入口时没有旧 Backend 可由安装器归属；当前入口已经指向目标 release 时也不是升级。两种情况维持既有安装路径且绝不调用 stop。所有下载或验证失败必须发生在 lifecycle 调用之前。

## Risks / Trade-offs

- [旧 CLI 的配置读取失败，无法发起安全 stop] → 尝试已验证 candidate；仍无法停止则保留旧入口并失败，不以强杀替代。
- [用户级安装目录内的 shim 被手工编辑] → Windows 仅执行严格可解析的 managed executable；不解析则不执行 shim。
- [stop 成功后磁盘写入失败] → 保留旧入口，Backend 可保持 stopped；不宣称升级成功，用户可重试安装或用旧 CLI 重新启动。
- [自动 stop 中断进行中的模型准备或 index operation] → 本阶段仅面向普通 release 升级，且将这一行为明确写入用户文档；实现不扩展到 worktree 并发情形。
- [候选 fallback 与旧 Backend protocol 不兼容] → candidate stop 失败后保持旧入口，提供旧 release 手动恢复方向；不绕过 protocol 校验。

## Migration Plan

1. 在两种安装器中先实现 managed old executable 解析、stop 编排和 candidate fallback，保持现有 archive 与入口验证顺序。
2. 扩展 POSIX 和 Windows release installer integration fixtures，使旧 release executable 能记录 `backend stop` 调用，并验证成功切换、失败保持入口、首次安装及同版本重装不调用。
3. 更新中英文安装文档：普通升级由安装器自动停止旧 Backend；手动 `lore backend stop` 仅作为已切换后的恢复或非安装器路径的操作。
4. 在 release asset validation 中运行两套 installer integration tests；不发布、不推送或修改 release workflow。
