---
id: llm.provider-gateway
title: 供应商接入与用量计费约定
stage: llm-gateway
tech_stack: [typescript]
applies_when: 当项目需要接入多个模型供应商并统一请求、计费与用量观测时。
severity: warn
---

# 供应商接入与用量计费约定

本仓库的模型网关统一按以下约定接入供应商：

1. 定义一个统一的模型客户端契约，请求与响应（回复文本、token 用量）都归一成同一形态；业务和接口层只依赖这个契约，不感知具体供应商。
2. 每个供应商做成独立适配器：OpenAI 兼容类（如 DeepSeek）复用同一个兼容适配器，只靠配置区分地址、模型和 Key；协议不同的（如 Anthropic）单独实现适配器；HTTP 调用只出现在适配器里。
3. 供应商选择由配置/注册表驱动，业务路径不按供应商名写分支。
4. 费用换算与用量/耗时观测集中在边界模块统一做，不在各供应商实现里重复。

反例：业务代码里直接发请求或依赖供应商 SDK、每个供应商各写一套请求与计费路径、把 Anthropic 的 input/output_tokens 当成 prompt/completion_tokens 算钱、把上游原始错误直接抛给调用方。
