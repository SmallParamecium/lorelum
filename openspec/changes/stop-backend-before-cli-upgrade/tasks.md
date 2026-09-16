## 1. POSIX upgrade handoff

- [x] 1.1 更新 `install.sh`：在所有下载、checksum、archive、外部入口和目标版本目录验证通过后，识别不同 release 的 managed old executable，先执行其 `backend stop`，必要时执行已验证 candidate fallback；仅在 stop 成功后切换链接，并验证失败路径保持旧入口。
- [x] 1.2 扩展 `scripts/release/install.integration.test.ts` 的可执行 release fixtures：验证不同版本升级按“旧 CLI stop → 新入口”顺序执行、old/candidate 均失败时不切换、首次安装及同版本重装不调用 stop，以及 archive/入口验证失败时不调用 stop。

## 2. Windows upgrade handoff

- [ ] 2.1 更新 `install.ps1`：严格解析安装器生成的 managed shim 以得到旧 `lore.exe`，绝不执行任意 shim 或 PATH 命令；实现与 POSIX 相同的 old executable 优先、candidate fallback、stop 失败保留旧 shim 行为，并验证 PowerShell 错误信息可执行。
- [ ] 2.2 扩展 `scripts/release/install-ps1.integration.test.ts`：用可运行的受控 fixture 验证 Windows 升级成功、fallback、失败回退、首次/同版本不停止，并覆盖伪造或附加命令的 shim 不会被执行。

## 3. 用户升级说明

- [x] 3.1 更新 `apps/site/content/docs/installation.mdx` 与 `apps/site/content/docs/installation.zh.mdx`：说明普通安装器升级会在激活新 CLI 前自动安全关闭旧 Backend；保留手工 stop 的恢复边界，验证两种语言的命令、链接和行为一致。

## 4. 验证

- [ ] 4.1 运行 `bun test scripts/release/install.integration.test.ts`，并在 Windows 环境运行 `bun test scripts/release/install-ps1.integration.test.ts`；记录无法在当前平台执行的验证限制。
- [x] 4.2 运行 `openspec validate stop-backend-before-cli-upgrade --strict`、相关脚本格式/静态检查与 `git diff --check`，确认 delta spec、任务状态和改动范围一致。
