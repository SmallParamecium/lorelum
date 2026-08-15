---
id: react.command-domain-boundary
title: React 命令与领域结果边界
stage: command-boundary
tech_stack: [react, typescript]
applies_when: 当界面提交会改变远程资料、设置或成员信息，并开始处理 HTTP 响应、DTO 或状态码时。
severity: warn
---

## 建议

1. 让组件负责表单输入、提交状态和呈现；把远程保存委托给组件外的命令或 API 边界。
2. 在边界发起请求并把传输 DTO 转换为界面可用的领域数据，不把原始 response 交给组件。
3. 在边界把可预期的冲突、校验或认证失败翻译为领域结果；组件只根据该结果显示反馈。

## 常见反模式

- 在组件内直接调用 HTTP adapter、读取 status 或保存 response body。
- 让组件把 409、422 等传输细节翻译成业务文案。
- 把传输对象直接放入 React state。
