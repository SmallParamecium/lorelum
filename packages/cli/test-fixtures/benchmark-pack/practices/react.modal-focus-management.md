---
id: react.modal-focus-management
title: React 模态框焦点管理
stage: interaction-accessibility
tech_stack: [react, typescript]
applies_when: 当界面在对话框、确认层或临时浮层中接收键盘输入并需要在打开和关闭后恢复焦点时。
severity: warn
---

## 建议

1. 打开模态框后，将焦点移动到标题或首个可操作控件，并保持键盘操作留在当前对话框内。
2. 关闭时把焦点恢复到触发元素，避免键盘用户失去当前位置。
3. 对话框标题、说明和危险操作要有可访问名称，并让 Escape 和取消操作保持一致。
4. 使用 `aria-modal` 标识对话框，并在打开时为标题关联 `aria-labelledby`，不要把焦点管理交给页面背景。

## 常见反模式

- 打开浮层后焦点仍停留在背景页面。
- 关闭对话框后把焦点丢到 document body。
- 仅依赖鼠标点击，缺少键盘取消和焦点恢复。
