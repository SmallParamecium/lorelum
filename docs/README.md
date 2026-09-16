# 文档导航

Lorelum 的文档按“当前合同、接口参考、决策原因、开发证据、未来计划、历史资料”分层。普通实现或排障先读当前合同与任务范围，不要从历史设计或已归档 change 推断当前架构。

## 当前合同

- [OpenSpec specs](../openspec/specs/)：已审阅并同步的 capability contract。检索与运行时能力为 [retrieval query](../openspec/specs/retrieval-query/spec.md)、[semantic index](../openspec/specs/semantic-index/spec.md)、[local model runtime](../openspec/specs/local-model-runtime/spec.md)、[backend runtime](../openspec/specs/backend-runtime/spec.md) 和 [practice read](../openspec/specs/practice-read/spec.md)。
- 工程分发与集成能力为 [pack management](../openspec/specs/pack-management/spec.md)、[agent integration](../openspec/specs/agent-integration/spec.md)、[plugin distribution](../openspec/specs/plugin-distribution/spec.md)、[CLI distribution](../openspec/specs/cli-distribution/spec.md)、[native runtime artifact](../openspec/specs/native-runtime-artifact/spec.md) 和 [native development cache](../openspec/specs/native-development-cache/spec.md)。
- Web 当前边界为 [web design system](../openspec/specs/web-design-system/spec.md) 和 [site feature architecture](../openspec/specs/site-feature-architecture/spec.md)。
- [documentation governance](../openspec/specs/documentation-governance/spec.md)：设计资料的权威顺序、archive 读取规则和迁移完整性。
- [OpenSpec changes](../openspec/changes/)：当前明确选中的变更；它描述提议的差异，不会自动取代其他 current spec。

## 参考与证据

- [Backend API](api/README.md)、[配置实现说明](configuration/README.md)：内部 HTTP、配置包与运行时细节；公开命令、安装和配置说明只在[文档站](https://lorelum.com/zh/docs)维护，不创建另一套行为规范。
- [ADRs](adr/README.md)：已接受架构决定的原因和 supersession 状态。Proposed ADR 不是当前合同。
- [开发指南](development/README.md)：worktree、构建、验证与 benchmark 证据。
- [研究资料](research/)：技术选择与实验记录，不直接构成产品要求。

## 历史与未来工作

- `openspec/changes/archive/`：已完成 change 的过程记录，只在需要 provenance 时显式读取，并重新核验 current spec、ADR、代码和 tests。
- future roadmap 或未批准设计在获得明确产品/架构授权后，以新的 active OpenSpec change 记录；它们不在 current specs 中占位。
