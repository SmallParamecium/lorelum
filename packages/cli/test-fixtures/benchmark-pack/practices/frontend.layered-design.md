---
id: frontend.layered-design
title: 前端分层约定
stage: api-layer
tech_stack: [react, typescript]
applies_when: 当页面接入远程 API 且组件开始处理请求响应、状态码或传输 DTO 时。
severity: warn
---

# 前端分层约定

本仓库前端按职责分层，接入远程 API 的页面请遵守以下约定：

1. 组件只负责交互、加载和展示状态；通过封装的领域操作调用远程能力，不要直接在组件里写 fetch 或依赖 HTTP 客户端。
2. API 边界负责处理请求和响应 DTO，把接口字段转换成界面需要的领域结果，不要让原始响应对象流进组件状态。
3. 在边界把可预期的传输失败（例如 401）转换成领域错误或领域结果；组件只根据该结果更新界面，不解释状态码。

反例：在组件里直接调用 fetch/axios、把 response 对象直接存进 UI state、组件里判断 401/500 决定业务提示。
