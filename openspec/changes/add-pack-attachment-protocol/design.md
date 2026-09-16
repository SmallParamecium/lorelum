## Context

参见 proposal.md 的动机。当前运行链只把 pack.yaml、practices/**/*.md 与可选 decisions.yaml 带入 PackCandidate。packages/cli/src/install/materialize-source.ts 的 Git allowlist 不会物化其他文件；packages/engine/src/local-store/storage/artifacts/snapshot-codec.ts 也只解码这些内容；随后 snapshot writer 从 candidate 重建 sealed artifact。

因此，源码目录中存在某个脚本或参考文档，并不代表它能随安装、升级或恢复存在。现有 lore get 只返回 canonical Practice、contentDigest 与 sources 的 packName/sourcePath；现有 lore pack list 也只返回 Pack metadata。Codex Hook 会把 pack list --details 的摘要注入上下文；本 change 让这个 Catalog 同时注入每个 Pack 的公开 packRoot locator，但不注入 resource 文件清单、resource 内容或 Practice body。

当前 Agent integration 的目的，是要求宿主先用 CLI 发现和读取 Practice，而不是把 SQLite、projection 或私有 Store 布局当成稳定 API。资源协议保持 CLI-first：lore get 和 lore pack list 返回公开的 Pack locator；resource: link 为正常任务提供带使用时机的资源路由。它不是 Agent 的文件访问白名单，也不改变宿主已有的本机文件权限。

## Goals / Non-Goals

**Goals:**

- 让 references/、assets/、scripts/ 作为 Pack artifact 的普通内容，随安装、升级、恢复和 digest 原子保存。
- 让 Practice 用简短、可验证、Pack-root-relative 的链接指出补充材料，而不再维护一个全局附件清单。
- 让 lore validate 在发布前报告 resources 目录与 resource: target 的结构错误，使作者不必等到安装时才发现新格式无效。
- 让 lore get、lore pack list 与 SessionStart Hook Catalog 返回 Pack-level packRoot locator：get 用于 Practice source，list 用于显式 Pack browse，Catalog 用于已安装 Pack 的即时发现；query 不返回文件系统目录，Hook 也不枚举资源。
- 保持 Practice 独立可用、资源按需加载、脚本不自动执行，以及 retrieval/index 对 resource 文件内容保持中立。
- 把规范、Host Skill、site 文档和 pack-creator 作者指导一起作为交付物，避免协议存在而作者与 Agent 不知道如何使用。

**Non-Goals:**

- 不定义 SKILL.md、Host Skill 注册、MCP、script runner、sandbox、依赖安装、自动联网、权限 DSL 或脚本可信声明。
- 不提供 lore pack resource list/get/export，不把 Pack 资源作为独立检索对象，也不在 query 输出资源路径，不在 Hook Catalog 输出 resource 路径、resource 清单或 resource 内容。
- 不引入 attachments.yaml、每资源 descriptor、entrypoint schema、resource id、跨 Pack resource reference 或独立资源版本。
- 不修改已 Accepted ADR 的历史正文；实现前以新的 ADR 记录对 ADR 0003、0008、0009、0007 的补充或 supersession。

## Decisions

### 1. Pack 的 resources 是三类固定目录，而不是 descriptor bundles

运行时 Pack root 的完整目录语义为：

```text
<pack-root>/
├── pack.yaml
├── practices/
│   └── **/*.md
├── decisions.yaml                 # 可选
├── references/                    # 可选
├── assets/                        # 可选
├── scripts/                       # 可选
└── i18n/                          # 既有 authoring-only 协议
```

references、assets 与 scripts 中可包含嵌套普通文件。每一个文件均受 Pack 的既有目录深度、条目数、单文件和总字节预算约束；symlink、特殊文件、绝对路径和越界路径仍被拒绝。i18n 保持既有 source-only/localization 合同，不因本 change 进入运行时 artifact。

没有 attachments.yaml 的理由是：目录第一段已经给出资源类别；Practice body 才是“什么时候使用”的唯一可信路由。一个全局清单会重复目录事实，也会产生已声明却没有任何 Practice 解释何时使用的死资源。

lore validate 是作者检查这一格式的入口。它扫描三个资源目录，识别 Practice Markdown links 中的 resource: target，并把不安全路径、缺失 target、symlink、特殊文件和预算超限报告为 Pack validation errors。它不执行 script、不安装依赖、不联网、不读取凭据、不判断脚本逻辑，也不要求每个 resources 文件都被某个 Practice 直接链接：script helper、模板组成文件和同目录配套资产可以合法地未被直接引用。现有 lore format 只需保留这种标准 Markdown link，不需要把它改写成新的文件路径或执行说明。

### 2. 使用标准 Markdown link 和 resource: target

Practice 通过 Markdown 链接引用 resource，例如：

```markdown
需要完整字段定义时，阅读 [API 兼容矩阵](resource:references/api-compatibility.md)。

需要输出评审结论时，从 [变更报告模板](resource:assets/api-change-report.md) 复制一份到工作区。

需要诊断当前改动时，按本 Practice 指定的命令运行 [API 检查脚本](resource:scripts/check-public-api/main.py)。
```

resource: 不是外部 URL，也不是工程模块 import。其 path 从 Pack root 解析，必须以 references/、assets/ 或 scripts/ 开始，并命中同 Pack 的普通文件。代码块、inline code、普通网页链接和普通 Markdown 相对链接不触发 resource 解析。

不采用 @/：它通常由 TypeScript、bundler 或 workspace config 定义，无法表达 @ 是 Pack root 而非项目根，也无法表明该路径需要 Pack 资源安全校验。此前提出的双中括号标记同样不采用：它不是 Skill 既有写法，也没有标准 Markdown link 的人类可读性。

### 3. Practice 保留判断，resource 只提供补充材料

Practice 正文必须仍包含触发条件、行动、直接原因、例外和停止条件。reference 只能承载深入背景、字段表、兼容矩阵或证据材料；asset 是复制到工作区后再编辑的模板、样板或静态文件；script 是由当前 Practice 明确说明输入、预期输出和使用时机的辅助程序。

资源文件的内容不进入 canonical Practice、Effective Practice merge、Decision traversal、keyword index、semantic index 或 query result。相反，resource: link 位于 Practice body，因此新增、删除或修改这个 link 会改变 canonical Practice contentDigest，并遵循既有 effectiveRevision/index 更新语义。只改变 resource 文件的 bytes 时，Practice contentDigest 和 retrieval revision 保持不变。

### 4. lore get、pack list 与 Pack mutation 返回公开 current packRoot

lore get 的每个 source 从：

```text
{ packName, sourcePath }
```

扩展为：

```text
{ packName, sourcePath, packRoot }
```

packRoot 是由 active manifest 派生的公开根目录：

```text
<store-root>/packs/<storageKey>/current
```

它不是 `<artifactDigest>` 目录，artifactDigest 仍只用于 Engine 的 sealed artifact 校验、promotion、GC 与 recovery。sourcePath 已经是 Pack-root-relative Practice 文件路径，因此不另返回重复的 practicePath；Practice 的完整 canonical body 已经在同一 result 中，也不需要调用方再次读它。

在 macOS/Linux，current 是指向同目录 active artifact 的相对目录 symlink；在 Windows，它是指向绝对 artifact 目录的 directory junction。两者都由 Engine 创建，位于 digest artifact 外部，因而不进入 artifact digest、projection 或 Pack 的 symlink 验证范围。Engine 总是先从 manifest 验证实际 artifact，再确认 current 在该次返回前解析到这个 artifact；CLI 只投影 Engine 值，不得通过 packName、Store root 或私有目录布局自行拼接。

lore pack list 与 lore pack list --details 必须在每个 Pack entry 返回 packRoot；lore pack list <pack> 必须在其 pack object 返回 packRoot；成功 lore pack install 与 lore pack update 也返回刚刚激活的 packRoot。Practice summary 不增加 practicePath 或 resource paths：完整 Practice 仍由 lore get 读取，资源仍由 Practice 的 resource: link 路由。pack list 的 locator 用于调用方已经明确选择某个 Pack 后的 Pack-level browse、诊断或作者工具，不代表自动读取该 Pack 的所有内容。remove 不返回一个已经失效的 root。

install/update 在 journal 保护下先发布目标 manifest、同步目标 current locator、再提交 SQLite 并清理 journal；remove 以最终 manifest 为准移除 locator，再进行 artifact GC。idempotent install 同样同步 locator。journal recovery 与 reindex 在已经选定最终 manifest 后重建所有 current locator；旧 Store 首次 locator read 发现缺失、dangling 或指错的 link 时，短暂获取 mutation lock，收敛后重试原 read。健康 Store 仍完全 lock-free，locator 修复不是 canonical mutation，因此不改 generation、effectiveRevision 或 index。

一个 Practice 可能有多个 active source。每个 source 都保留自己的 packRoot，调用方不应把不同 Pack 的 resources 假装合并成一个目录；lore pack list <pack> 是一个显式 Pack 选择，可为后续 resource resolution 提供来源。若当前任务无法选择来源，Host 应保留来源差异，而不是无提示地把排序第一项说成唯一来源。packRoot 是当前可变 view，不是跨机器、跨版本或历史 bytes 的 capability；Pack mutation 后路径字符串可能仍相同但解析到新 artifact，Host 若需按新 source 使用资源必须重新 get/list，而不得猜测私有 artifact 路径或把 current 当成 snapshot pin。

### 5. Resource lifecycle 与读取责任

实现链路为：

```text
Registry Git tree 或 local Pack directory
  -> 允许的 Pack root 文件与三个 resources 目录
  -> decoder 扫描、link 校验、candidate
  -> snapshot writer 保留原始 bytes
  -> sealed projection 与 artifact digest
  -> install/update/remove/recovery/reindex 收敛 public current view
  -> lore get、lore pack list 或 install/update 返回 Pack packRoot
  -> Host 解析 Practice 的 resource: target
  -> read reference / copy asset / explicitly run script
```

resources 的 raw bytes 是 artifact identity 的组成部分。Registry materialization 必须保留三个允许目录，snapshot decoder/writer/rebuild/recovery 必须复用同一安全规则。资源单独变化时，Pack artifactDigest 与 Store generation 更新，但 Effective Practice sources、effectiveRevision、keyword index 和 semantic index 不更新。

安装、validate、format、query、list、get、index 与 recovery 永不执行 Pack script、安装依赖、读取凭据或自动联网。Host 在当前用户任务授权下才可运行 script；Practice 的 resource: link 是默认的任务路由，但不是运行时 allowlist。asset 通常复制到工作区或其他调用方目标后编辑，避免把 installed Pack root 当成可写工作目录。

### 6. 作者与 Agent 的文档是协议交付的一部分

当前 site 的 Create a Pack 页面只适合最小 Pack 入门；新增双语 Pack format reference 将是目录、resource link、安全边界、lore get locator 和兼容规则的权威用户文档。Create a Pack 保持教学用途并链接该 reference。get reference、Agent instructions、generic Skill 与 Codex Plugin Skill 负责说明实际消费顺序。

pack-creator 属于独立 lorelum-packs 仓库。它需要新增资源树、resource linking 与 Agent 使用的 authoring Practices，更新 standalone/evaluation/release Practices，更新 README、中文镜像、fixtures 与 release evidence，并作为新的不可变 Pack version 发布。当前 change 只把这些工作纳入任务和验收边界。

## Risks / Trade-offs

- 宿主直接使用 packRoot 可能把实现细节误当作 API。→ public contract 固定为 current view，SessionStart Catalog 会主动提供每个已安装 Pack 的当前 root；调用方仍不得从 Pack name 拼接 digest artifact 路径或读取 SQLite/projection。current 的解析内容可在后续 mutation 改变；需要按当前 source 使用资源时重新执行 lore get 或 lore pack list。
- 资源内容可能很大、是二进制或不适合直接注入上下文。→ 目录和字节预算在 intake 时强制，且 resources 永不自动进入 query/get body；由 Host 按类型和任务按需处理。
- script 容易被误解为 Pack 自动化权限。→ 没有执行器、effect metadata 或授权声明；正文说明和当前任务授权是唯一运行条件。
- resource-only update 不刷新索引，调用方可能持有先前的 Practice 内容。→ current root 会切换到新 artifact；Host 在 Pack mutation 后重新 get/list 以获得当前 source，绝不把旧 get result 与新的 current bytes 假装为同一 snapshot。
- current link/junction 可能被移动、删除或被外部节点占用。→ manifest 与 digest artifact 永远优先；缺失、dangling 或错误 link 在锁内自动重建，不能安全替换的非链接节点 fail closed，不递归删除未知内容。
- 旧 CLI 不会 materialize 新目录。→ 新 Pack release 不得把 resource 放成 Practice 的唯一安全事实；pack-creator release guidance 要求用支持该协议的 CLI 验证完整 install path。

## Migration Plan

1. 新客户端将没有三个资源目录的旧 Pack 视为 resources 为空，保持现有读取与 retrieval 行为。
2. 含 resource: link 或 resources 的 Pack 必须以新版本发布。link 改动是 Practice 内容改动；仅 resource bytes 改动仍必须发布新的 immutable Pack artifact。
3. 新客户端先从有效 manifest 与 digest artifact 补建旧 Store 缺失的 current view，不改 canonical revision；随后实现 install/update/remove/recovery/reindex 的一致维护，再更新 Host Skill、CLI/site docs 与 pack-creator；在官方 Pack 使用 resources 前，先以 isolated Store 验证 Registry 到 resource read 的完整链路。
4. 实施完成后新增 ADR 记录格式、artifact 与 Agent integration 的补充决定；不改写既有 Accepted ADR。
