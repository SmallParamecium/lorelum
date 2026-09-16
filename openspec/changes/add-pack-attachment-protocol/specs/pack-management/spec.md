## ADDED Requirements

### Requirement: Resource-aware Pack artifact lifecycle

当 Pack 包含 references/、assets/ 或 scripts/ 时，Registry materialization、local directory decode、candidate construction、snapshot write/decode、seal、install、update、uninstall 和 recovery MUST 将这三个目录中的已验证普通文件作为同一个 Pack artifact 的组成部分。resources MUST 按其已验证 relative path 保存原始 bytes，artifact identity MUST 随任一 resource file 的 bytes 或路径变化而变化。

resources 单独变化的 update MUST 原子替换 active Pack artifact 并更新 Pack generation，但 MUST NOT 改变未变 Practice 的 source、Effective Practice delta、effectiveRevision 或触发 keyword/semantic index work。Pack install/update MUST NOT 因 resource 存在而执行 script、安装依赖或注册宿主功能。

#### Scenario: A resource-only update replaces the active Pack artifact

- **WHEN** 同名 Pack 的 selected release 只改变 assets/、references/ 或 scripts/ 下的内容，而所有 canonical Practice 内容保持不变
- **THEN** lore pack update MUST 原子激活新的 artifact identity，且后续 lore get source locator 不得把新 Practice 与旧 resource bytes 混合

#### Scenario: A resource-only update leaves retrieval revision unchanged

- **WHEN** resource-only update 完成且所有 Practice canonical content 保持不变
- **THEN** Store MUST 保持 effectiveRevision 与 Practice delta 不变，且不得因此构建或同步派生 retrieval index

#### Scenario: An existing Pack has no resource directories

- **WHEN** 新客户端安装或恢复一个只包含既有 Pack 文件的 release
- **THEN** 系统 MUST 将其视为 resources 为空，并保持该 Pack 原有 artifact 和 retrieval 行为

### Requirement: Public current Pack locator lifecycle

每个 active Pack MUST 有一个相对于 selected LocalStore 的公开 `packs/<storageKey>/current` locator。它是由 active manifest 的 Pack entry 派生出的可重建 current view，而不是 manifest、SQLite、sealed projection 或 artifact digest 的替代权威。install、idempotent install、update、remove、reindex 和 journal recovery MUST 使 current locator 与最终 active manifest 收敛；成功的 lore pack install 与 lore pack update result MUST 返回其 packRoot。remove result MUST NOT 返回已经不再存在的 packRoot。

健康 Store 的读取 MUST 保持 lock-free。locator-returning read 发现 current locator 缺失、dangling 或没有解析到 manifest 指定 artifact 时，MUST 在受 mutation lock 保护的恢复路径中修复并重试读取；该修复 MUST NOT 改变 generation、effectiveRevision、Practice delta 或 index work。manifest 指向的 artifact 缺失或 digest 不匹配仍 MUST 使用既有 recovery-required 语义，且 current locator MUST NOT 被当作替代输入。

#### Scenario: Installing and updating a Pack publishes its current root

- **WHEN** lore pack install 或 lore pack update 成功激活一个 Pack artifact
- **THEN** 其 result MUST 包含可读取的 packRoot，且该 path MUST 是该 Pack 的 public current view，而不是 artifact digest 目录

#### Scenario: Idempotent install repairs a missing locator

- **WHEN** 已安装 Pack 的 artifactDigest 与 install candidate 相同，但该 Pack 的 current locator 缺失
- **THEN** lore pack install MUST 成功保留既有 Pack state、修复 locator 并返回 packRoot，且不得增加 generation 或 effectiveRevision

#### Scenario: Recovery selects the authoritative current locator

- **WHEN** interrupted Pack mutation 的 journal recovery 根据 SQLite tuple 选择 old 或 target manifest
- **THEN** 系统 MUST 使 current locator 收敛到被选择 manifest 的 active artifact，而不得根据 mutation 前残留的 locator 推断 Pack state

#### Scenario: Removing a Pack removes its current root

- **WHEN** lore pack remove 成功移除一个 active Pack
- **THEN** 该 Pack 的 current locator MUST 不再可用，且同名 Pack 的后续 install 可以发布新的 current view
