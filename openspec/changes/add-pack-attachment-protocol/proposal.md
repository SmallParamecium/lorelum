## Why

当前 Pack 的可安装输入只包含 pack.yaml、practices/**/*.md 和可选 decisions.yaml。Registry 物化会忽略其他文件，LocalStore 也只从这部分内容重建 sealed artifact。因此作者即使在源码中放入详细参考资料、交付模板或诊断脚本，安装后的 Pack 既不能可靠保留它们，也不能让 Agent 在已取回 Practice 后安全定位它们。

本 change 引入新的产品行为：Knowledge Pack 可以包含 Pack-native resources。它借鉴 Skill 的渐进加载方式——Practice 先给出独立判断，再按需读取 reference、复制 asset 或显式运行 script——但不把 Pack 变成 Host Skill、Plugin 或执行器。

## What Changes

- 定义 Pack 顶级 resources 目录：references/、assets/、scripts/。它们不需要 attachments.yaml 或每个资源的 descriptor。
- 定义正文中的 Markdown resource target：资源链接使用 resource:<Pack-root-relative-path>，例如 [完整兼容矩阵](resource:references/api-compatibility.md)。它不是普通相对链接，也不是工程 alias。
- 扩展 lore validate、Pack directory decode、Registry materialization、candidate、sealed artifact、install/update/recovery，使 resources 原始字节与 Pack 一起原子保存、验证和版本化。
- 扩展 lore get、lore pack list 与成功的 lore pack install/update JSON result：返回的 packRoot 是公开、可直接读取的 `packs/p-<pack-name>/current` Pack view，而不是内容 digest artifact 目录。SessionStart Hook Catalog 的每个 Pack 条目也返回该 root；query 继续不返回本地路径，Catalog 也不枚举资源。
- 让 install、update、remove、reindex、journal recovery 与旧 Store 的首次 locator 读取共同维护这个 derived current view；active manifest 与 sealed artifact digest 仍是唯一权威，不把 current 变成新的状态源。
- 保持 Practice 检索只使用 canonical Practice 内容。resource 文件本身不参与 query、ranking 或 index；但 Practice 正文中的 resource link 仍是 canonical 内容的一部分。
- 更新 Lorelum generic Skill、Codex Plugin Skill、CLI 说明和双语 site 文档，明确 resource target 的解析、reference/asset/script 的使用边界。
- 在独立 lorelum-packs 仓库更新并发布新的 pack-creator 版本，使 Pack 作者获得资源树、resource links、资源验证和 release 证据的具体 Practice。

**BREAKING for strict response consumers:** lore get 的 source object、lore pack list 的 Pack object，以及成功 lore pack install/update 的 result 增加必填 packRoot 字段。依赖 closed JSON schema 的调用方必须更新其 decoder。

## Capabilities

### New Capabilities

- pack-attachments: 定义 Pack-native resources 的目录、Markdown resource target、按 source 定位与 Agent 消费边界。

### Modified Capabilities

- pack-management: Pack artifact 生命周期将 resources 作为不可变 Pack snapshot 的组成部分，同时区分 resource bytes 变更与 Practice 内容变更。

## Impact

- packages/format 与 lore validate：识别并报告 Practice Markdown 中的 resource targets、同 Pack 资源文件、路径和目录安全问题；不执行或解释资源内容。
- packages/engine：把 resources 放入 candidate、snapshot、projection/rebuild/recovery 与 artifact identity；以 active manifest 派生、校验并恢复公开 current Pack locator。
- packages/cli：扩展 lore get、lore pack list 与 install/update JSON schema/result；query 保持不返回路径，Hook Catalog 返回 Pack-level locator 但不返回资源内容。
- skills/lorelum 和 plugins/lorelum：让宿主理解 resource: target，并优先使用 Catalog、lore get 或显式 Pack list 提供的 Pack locator 按需使用资源。
- apps/site/content/docs：增加完整 Pack format 双语参考，更新最小教程、get reference 和 Agent 使用说明。
- lorelum/lorelum-packs：在独立仓库更新 pack-creator 内容、中文镜像、fixtures、Registry release 和安装验证；本 change 只计划该工作，不在当前仓库实施或发布。
