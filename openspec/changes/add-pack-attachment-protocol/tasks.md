## 1. Pack format and resource-link validation

- [x] 1.1 在 @lorelum/format 定义 Practice Markdown resource: target 的解析与 diagnostics，区分普通 Markdown、inline code 与 code block，并校验 references/、assets/、scripts/ 三类 Pack-root-relative 文件 target。
- [x] 1.2 扩展 lore validate <pack-root> 的 Pack report、CLI errors 和隔离目录测试，使目录安全、预算、非法/缺失 resource target 成为 machine-readable structural diagnostics；validate 不得执行资源。
- [x] 1.3 扩展 Pack directory decoder 的目录扫描、路径安全和全量预算，使三个 resources 目录的普通文件成为 candidate 输入，同时保留 i18n 的既有 source-only 语义。
- [x] 1.4 添加 fixtures 和测试：有效 reference/asset/script、binary asset、未直接链接的 script helper、缺失 target、越界/非法 target、symlink/特殊文件、普通网页链接及 code 示例不被误识别。

## 2. Sealed artifact and Store lifecycle

- [x] 2.1 扩展 Registry Git materialization allowlist、PackCandidate、snapshot writer/codec、sealed projection、artifact verification、rebuild 和 recovery，使 resources raw bytes 按同一 Pack artifact 保存和验证。
- [x] 2.2 添加 install/update/remove/recovery 覆盖：无资源的旧 Pack 保持兼容；resource-only update 更换 artifact 和 generation，但不改变 effectiveRevision、Practice delta 或派生 index。
- [x] 2.3 覆盖 Practice body resource target 改动：它必须改变 contentDigest 并触发既有 retrieval/index revision 行为，避免把旧 descriptor 设计的语义带入新协议。
- [x] 2.4 在 Engine 实现 manifest-derived `packs/<storageKey>/current` locator：保留 digest artifact 为唯一权威，覆盖 POSIX symlink/Windows junction、install/update/idempotent install/remove、reindex、journal recovery、旧 Store 的条件性修复与安全失败，并以隔离 Store lifecycle/recovery tests 验证 tuple 与 retrieval revision 不变。

## 3. CLI locator and host-consumption boundary

- [x] 3.1 由 Engine 在与 Practice/Pack 相同的 verified snapshot 中解析 public current locator，并扩展 lore get 的 sources[].packRoot、lore pack list/--details 的 packs[].packRoot、lore pack list <pack> 的 pack.packRoot 与成功 install/update result；CLI 不得拼接或扫描 Store 私有目录，且 remove 不返回失效 root。
- [x] 3.2 更新 lore get command/schema/integration tests：单 source、multiple sources、busy/recovery、resource-only update 后 `current` path 保持可读但解析到新 bytes、旧 Store 自动修复，以及 strict response consumer 的兼容说明。
- [x] 3.3 更新 lore pack list 的三种 JSON shape、install/update schema/result、Engine ListService 和隔离 Store 测试：每个明确列出的 Pack 返回 `.../current`，Practice summaries 不增加 practicePath/resource paths，idempotent install 修复缺失 locator，remove 清理 locator。
- [x] 3.4 验证 lore query 继续不返回本地路径、资源列表或资源内容；Codex Hook Catalog 必须保留每个 Pack 的 public current packRoot，但不返回 resource 列表、resource 内容或 Practice body，并覆盖 mutation 后重新 get/list 的 current-view 边界。
- [x] 3.5 更新 generic Lorelum Skill 与 Codex Plugin Skill：解释 resource:<path>、优先从 Catalog 的 Pack current root、选定 source.packRoot 或显式 Pack packRoot 解析、reference 按需读取、asset 复制后编辑、script 在当前任务授权下显式运行；说明 current root 是可变 view、resource link 是默认任务路由而非文件访问 allowlist，且不得自动执行。

## 4. Current documentation and Pack-author guidance

- [x] 4.1 更新 docs/cli/get.md、docs/cli/list.md、pack install/update reference 与对应 CLI/site reference，说明 public current locator、sourcePath 的派生关系、多 source 不可静默选择、old Store 自动补建以及 mutation 后重新 get/list 的 current-view 边界。
- [x] 4.2 在 apps/site/content/docs/reference/ 新增 Pack format 的英文与简体中文页面，覆盖完整目录树、pack.yaml/Practice/decisions、resource: link、references/assets/scripts 的选择、lore validate 的结构检查与非执行边界、install/retrieval 边界及 Agent 使用示例；将两种语言的导航 metadata 接入现有 Reference 分组。
- [x] 4.3 更新 site 的 create-pack、reference/get、reference/packs、agents、agent-setup 英文与简体中文页面：最小教程链接到完整格式参考；get/list/install/update 输出与实际 schema 一致；Agent 指令解释 Catalog 提供 Pack current root、resource 按需消费但不把 resource 内容自动注入上下文。
- [ ] 4.4 在独立 lorelum/lorelum-packs 仓库更新 pack-creator：新增 canonical resource tree、显式 resource linking、reference/asset/script 使用边界与 resource integrity 的 Practices；更新 standalone、evaluation、release Practices、README、SOURCES、中文镜像、fixtures 和 release workflow；以新的不可变 Pack version 验证 Registry 到 resource read 的完整路径。
- [x] 4.5 新增 superseding ADR，记录公开 current locator、内部 digest artifact、旧 Store 修复、mutation/recovery 收敛与 Agent current-view boundary；不得改写既有 Accepted ADR 的历史内容。

## 5. Verification and delivery evidence

- [x] 5.1 运行 format、engine、cli 的 focused tests 与 package-wide tests/typechecks，验证 lore validate diagnostics、artifact bytes、current locator 生命周期、旧 Store 修复、retrieval revision、JSON schema、query/Hook locator 边界、错误语义和 source-scoped locator。
- [x] 5.2 对 site 文档运行双语链接检查及 @lorelum/site typecheck/build，确认新格式参考、导航和示例在两种语言中一致。
- [x] 5.3 对更新后的 pack-creator 分别记录：结构/安装证据、内容人工评审、检索选择行为和下游 Agent 行为；不得把 schema 或安装通过报告为语义或 Agent 效果成功。
