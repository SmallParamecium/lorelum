---
id: react.query-resource-state
title: React 查询边界与资源状态
stage: query-boundary
tech_stack: [react, typescript]
applies_when: 当界面读取远程列表、开始处理 HTTP 响应、DTO 或状态码，并需要呈现加载、结果或失败时。
severity: warn
---

## 建议

1. 让组件负责搜索输入、触发查询和按状态呈现；把远程读取委托给组件外的查询边界。
2. 在边界发起请求并把传输 DTO 转换为界面可用的数据，不把原始 response 交给组件。
3. 在边界把成功、空结果和可恢复失败翻译为显式资源状态；组件只根据该状态显示反馈。

## 常见反模式

- 在组件内直接调用 HTTP adapter、读取 status 或消费 response body。
- 让组件把 404、503 等传输细节翻译成加载状态。
- 把未转换的传输对象直接放入 React state。
