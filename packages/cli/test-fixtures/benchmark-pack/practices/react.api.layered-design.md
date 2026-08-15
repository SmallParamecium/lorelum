---
id: react.api.layered-design
title: React API 分层设计
stage: api-layer
tech_stack: [react, typescript]
applies_when: 当 React 界面需要调用远程 API，且组件开始处理请求响应、状态码或传输 DTO 时。
severity: warn
---

# React API 分层设计

## 建议

1. 让组件聚焦交互、加载和展示状态；通过 feature API 或领域操作调用远程能力，不直接依赖 HTTP 客户端。
2. 在 API 边界处理请求和响应 DTO，把 API 字段转换成界面需要的领域结果，不让原始响应对象流入组件状态。
3. 在边界把可预期的传输失败转换成领域错误或领域结果；组件只根据该结果更新界面，不解释状态码。

## 常见反模式

- 在组件中直接调用 `fetch`、axios 或项目的 HTTP adapter。
- 把 API 返回的 DTO 或 response 对象直接存入 UI state。
- 让组件根据 401、500 等传输状态决定业务提示。
