## MODIFIED Requirements

### Requirement: Atomic and non-invasive installation
安装器 SHALL 将版本内容安装到用户可写目录，并仅在完整验证后原子切换 `lore` 命令入口。安装器 MUST 不要求 Bun、Node 或 sudo，MUST 不修改 shell startup 文件，也 MUST 不覆盖或删除外部管理的同名入口；失败、取消或损坏 archive MUST 不产生半安装状态。

当已存在由安装器管理、且目标为不同 release 的命令入口时，安装器 MUST 在激活新入口前确认旧 Backend 已通过 `backend stop` 正常退出。安装器 MUST 优先从受管理入口解析并直接调用旧 release executable，不得通过 `PATH`、PID、端口或进程名定位或终止进程。旧 executable 无法完成该操作时，安装器 MAY 使用已验证但尚未激活的新 release executable 再尝试一次现有的受认证 stop；两次尝试均未成功时，安装器 MUST 失败并保持旧命令入口不变，且不得报告安装成功。失败输出 MUST 包含受限长度的 stop 诊断和一个使用旧入口恢复后重试的可执行下一步，但不得泄露 runtime secret 或未验证的本机状态。

首次安装及同 release 的幂等重装 MUST 不调用 `backend stop`。下载、校验、archive、目标版本目录或外部入口检查失败时，安装器 MUST 不触碰任何 Backend。

#### Scenario: Existing external command
- **WHEN** 安装目标位置已有不是 Lorelum 安装器管理的命令
- **THEN** 安装器 MUST 停止并说明冲突，而不得覆盖该命令

#### Scenario: Upgrade closes a managed old Backend before activation
- **WHEN** 用户升级到不同 release，且当前入口可安全解析为 Lorelum 安装器管理的旧 release executable
- **THEN** 安装器 MUST 在切换入口前调用该旧 executable 的 `backend stop`，并仅在该命令确认成功后激活新 release

#### Scenario: Old executable cannot stop but verified candidate can
- **WHEN** 不同 release 的升级中旧 executable 缺失、不可执行或其 `backend stop` 未能成功，而已验证的新 release executable 成功完成受认证 stop
- **THEN** 安装器 MUST 仅在 candidate stop 成功后切换入口，并且不得通过旧入口脚本或 `PATH` 执行任意命令

#### Scenario: Backend cannot be safely closed
- **WHEN** 不同 release 的升级中旧 executable 与已验证 candidate 都不能确认 `backend stop` 成功
- **THEN** 安装器 MUST 失败、保留旧入口及旧 release，并向用户说明新版本尚未激活、最后一次 stop 的受限诊断及恢复后重试的命令；它 MUST NOT 按 PID、端口或进程名终止进程

#### Scenario: First install and same-release reinstall preserve the Backend
- **WHEN** 用户首次安装，或重跑安装器且受管理入口已经指向目标 release
- **THEN** 安装器 MUST 不执行 `backend stop`，并保持现有的验证和幂等安装行为
