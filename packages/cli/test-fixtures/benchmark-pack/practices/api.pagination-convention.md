---
id: api.pagination-convention
title: 列表接口分页约定
stage: api-pagination
tech_stack: []
applies_when: 当后端列表接口需要统一分页语义时。
severity: warn
---

# 列表分页约定

本仓库的后端列表接口统一按以下约定做分页：

1. 列表查询接口统一接受 page 与 page_size 参数，返回 total、page、page_size 与当前页数据，不返回全量。
2. 排序与过滤在数据层完成，接口层只透传声明好的查询参数，不在接口里做二次过滤。
3. 分页参数有默认值与上限（默认第 1 页、每页 20 条，上限 100），非法值回退默认。
4. 翻页响应统一带 next_cursor 或 offset，方便客户端增量加载，不要求客户端自己算页码。
