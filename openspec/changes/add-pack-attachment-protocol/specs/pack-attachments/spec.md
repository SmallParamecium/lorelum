## Purpose

为 Knowledge Pack 提供由 Practice 显式路由、随 Pack 原子安装且按需消费的参考资料、交付资产与脚本，同时保持 Practice 检索和宿主执行边界清晰。

## ADDED Requirements

### Requirement: Pack-native resource directories and Markdown targets

Pack MAY 在 Pack root 包含 references/、assets/ 和 scripts/ 三个可选目录。其目录项和文件 MUST 遵守 Pack 的安全路径、深度、数量、单文件和总字节限制；Pack MUST 拒绝 symlink、特殊文件、绝对路径和越界路径。

Practice Markdown 中的链接 target 以 resource: 开头时，系统 MUST 将其识别为 Pack resource target。target 的 path MUST 是 Pack-root-relative path，MUST 以 references/、assets/ 或 scripts/ 开始，并且 MUST 指向同 Pack 中已验证的普通文件。resource target 不得包含绝对路径、父级跳转、query、fragment、控制字符或平台不安全路径段。普通 Markdown URL、普通相对链接、inline code 和 code block MUST NOT 被解释为 resource target。

#### Scenario: A Practice links a reference file from the Pack root

- **WHEN** Practice 包含 [完整兼容矩阵](resource:references/api-compatibility.md)，且该文件位于同 Pack references/ 目录
- **THEN** validate MUST 接受该 target，并将该 reference file 作为 Pack resource 保存

#### Scenario: A resource target is unsafe or missing

- **WHEN** resource target 越出 Pack root、使用不允许的目录前缀、指向 symlink 或特殊文件，或目标文件不存在
- **THEN** validate MUST 返回结构 error，且不得构建可安装的 Pack candidate

#### Scenario: Normal Markdown remains normal Markdown

- **WHEN** Practice 包含 HTTPS 链接、普通相对 Markdown 链接或展示 resource: 字符串的代码示例
- **THEN** validator MUST NOT 把它们当作 Pack resource target

### Requirement: lore validate reports resource-format diagnostics without executing resources

lore validate <pack-root> MUST 扫描 Pack 的 references/、assets/、scripts/ 目录及 Practice Markdown 中的 resource: target，并在现有 machine-readable Pack validation report 中报告目录安全、预算、非法 target 和缺失 target 的结构 errors。结构 error MUST 使该 Pack validation 失败。

lore validate MUST NOT 执行 script、安装依赖、联网、读取凭据、解释资源业务语义或要求每个 resource file 被 Practice 直接链接。未被直接链接的 script helper、模板组成文件或配套 asset SHALL 保持合法。

#### Scenario: Validation accepts a script helper that is not directly linked

- **WHEN** scripts/check-public-api/main.py 被 Practice 链接，且同目录 helpers.py 未被单独链接
- **THEN** lore validate MUST 接受 helpers.py，并在不执行任一脚本的情况下返回有效的 Pack report

#### Scenario: Validation reports a missing resource target

- **WHEN** Practice 的 resource:assets/report.md target 在 Pack root 中不存在
- **THEN** lore validate MUST 返回带 Practice source path 和 target 定位的结构 error，且 Pack report MUST 为无效

### Requirement: Pack locators from lore get and lore pack list

lore get <practice-id> SHALL 在每个返回 source 中提供 packRoot，连同既有 packName 和 sourcePath。lore pack list 与 lore pack list --details SHALL 在每个 Pack entry 中提供 packRoot；lore pack list <pack> SHALL 在其 pack object 中提供 packRoot。每个 packRoot MUST 是相应 Pack 在 selected LocalStore 的绝对 `packs/p-<pack-name>/current` public view，MUST 在 command 返回时解析到该 command 已验证的 active sealed artifact，且 MUST NOT 暴露 artifact digest 目录。

query MUST NOT 返回 packRoot、资源文件清单或资源路径。SessionStart Hook Catalog MUST 在每个已安装 Pack 条目返回 packRoot；它 MUST NOT 返回 resource 文件清单、resource 内容或 Practice 的绝对路径。pack list 的 Practice summaries MUST NOT 增加 practicePath 或 resource paths。resource: target SHALL 表达 Practice 推荐的资源与使用时机，而不是调用方的文件访问 allowlist；调用方可以正常浏览由 Catalog、lore get 或 lore pack list 返回的 packRoot。调用方不得从 Pack name 推导 internal artifact path、SQLite 或 projection；公开 current path 是唯一的本机目录合同。

#### Scenario: Reading a resource after selecting one Practice

- **WHEN** 调用方通过 lore get 取回一个只有一个 source 的 Practice，且正文包含 resource:references/api-compatibility.md
- **THEN** result 的该 source MUST 提供 packRoot，调用方可以以 packRoot 解析这个显式 target，而无需了解 Store 内部目录布局

#### Scenario: Browsing one explicitly selected Pack

- **WHEN** 调用方执行 lore pack list platform-engineering
- **THEN** result 的 pack object MUST 提供 platform-engineering 的 packRoot，而其 practices 仍只返回 Practice summary，不返回每个 Practice 或 resource 的绝对路径

#### Scenario: Discovering installed Pack roots at SessionStart

- **WHEN** Codex SessionStart Hook 注入当前已安装 Pack Catalog
- **THEN** 每个 Pack 条目 MUST 提供其可直接读取的 current packRoot，且 Catalog MUST NOT 注入该 Pack 的 resource 文件清单、resource 内容或 Practice body

#### Scenario: A Practice has multiple Pack sources

- **WHEN** lore get 返回同一 Practice 的多个 active sources
- **THEN** 每个 source MUST 返回自己的 packRoot，且 CLI MUST NOT 默认选择某一个 source 或把多个 Pack 的 resources 合并为一个目录

#### Scenario: A Pack mutation advances a current view

- **WHEN** 调用方取得 packRoot 后，该 Pack 完成 install、update、remove 或 recovery mutation
- **THEN** 原有 current path MAY 随 active Pack 切换为新的 bytes 或在 Pack remove 后不再存在；调用方若需要按新的 Practice/source 解释 resource target MUST 重新执行 lore get 或 lore pack list，且不得将 current view 当作历史 artifact pin

#### Scenario: A legacy Store lacks a current view

- **WHEN** selected LocalStore 的 active manifest 与 sealed artifacts 有效，但它由不创建 current view 的旧客户端写入
- **THEN** 首次需要返回 packRoot 的 Store read MUST 在不改变 generation、effectiveRevision 或 retrieval index 的情况下修复 current view，并返回可读取的 public path

### Requirement: Resources are on-demand materials, not executable authority

reference 只在 Practice 指明需要时供调用方读取；asset SHOULD 先复制到调用方目标后再编辑；script 可以在当前任务授权下由宿主显式运行。Practice resource target 是正常任务的默认路由，不是运行时可执行 allowlist。Pack install、update、validate、format、query、list、get、index 和 recovery MUST NOT 执行 script、安装依赖、读取机密配置或自动联网。

#### Scenario: A Practice offers a diagnostic script

- **WHEN** Practice 链接 scripts/check-public-api/main.py
- **THEN** 安装和 lore get MUST 只保存及定位其 bytes；只有宿主在当前任务授权下明确运行该文件时，脚本才可能执行

### Requirement: Resources do not alter retrieval unless the Practice link changes

resource 文件、目录内容和 resource locator MUST NOT 进入 Practice canonical content、Effective Practice merge、Decision traversal、keyword index、semantic index、query candidate 或 ranking。

resource: target 位于 Practice Markdown body 内，因此新增、删除或修改 target MUST 遵循该 Practice 的既有 canonical contentDigest 与 retrieval revision 语义。只改变被链接 resource 文件的 bytes 而不改变 Practice canonical content 时，Practice contentDigest 和 retrieval result MUST 保持不变。

#### Scenario: A resource file changes without changing the Practice

- **WHEN** 新 release 只修改 references/api-compatibility.md 的 bytes，而关联 Practice 的 canonical content 不变
- **THEN** 后续 lore get MUST 返回解析到含新资源 bytes 的 current packRoot，且该 Practice 的 contentDigest 与 retrieval revision MUST 保持不变

#### Scenario: A Practice changes its resource target

- **WHEN** Practice body 将 resource:references/api-v1.md 改为 resource:references/api-v2.md
- **THEN** 该 Practice MUST 作为 canonical content 变更参与既有 retrieval revision 与 index 更新
