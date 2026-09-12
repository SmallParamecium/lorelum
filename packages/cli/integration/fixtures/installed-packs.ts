import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createLocalStore, decodePackDirectory } from "@lorelum/engine";

export const primaryPracticeId = "integration.retrieval.demo";
export const chinesePracticeId = "integration.retrieval.chinese";

export interface InstalledPacksFixture {
  readonly storageRoot: string;
  readonly primaryPracticeId: string;
}

/** Create two persisted Packs through the engine's public LocalStore API. */
export async function createInstalledPacksFixture(
  workingDirectory: string,
): Promise<InstalledPacksFixture> {
  const packDirectory = join(workingDirectory, "fixture-pack");
  const minimalPackDirectory = join(workingDirectory, "minimal-pack");
  const storageRoot = join(workingDirectory, "fixture-store");
  await Promise.all([writeIntegrationPack(packDirectory), writeMinimalPack(minimalPackDirectory)]);

  const [integrationPack, minimalPack] = await Promise.all([
    decodePackDirectory(packDirectory),
    decodePackDirectory(minimalPackDirectory),
  ]);
  const store = createLocalStore();
  await store.install(
    { rootPath: storageRoot },
    integrationPack.candidate,
    integrationPack.diagnostics,
  );
  await store.install({ rootPath: storageRoot }, minimalPack.candidate, minimalPack.diagnostics);

  return { primaryPracticeId, storageRoot };
}

async function writeIntegrationPack(packDirectory: string): Promise<void> {
  await mkdir(join(packDirectory, "practices"), { recursive: true });
  await Promise.all([
    writeFile(
      join(packDirectory, "pack.yaml"),
      [
        "name: integration-pack",
        "version: 1.0.0",
        "description: Process integration fixture.",
        "applies_to: [bun, typescript]",
        "",
      ].join("\n"),
    ),
    writeFile(
      join(packDirectory, "practices", "chinese-query.md"),
      `---
id: ${chinesePracticeId}
title: 中文认证接口
stage: integration
tech_stack: [react, typescript]
applies_when: 在 React 页面接入认证接口时
---
# 中文检索

通过现有认证接口完成页面请求。
`,
    ),
    writeFile(
      join(packDirectory, "practices", "retrieval-demo.md"),
      `---
id: ${primaryPracticeId}
title: Persisted retrieval demo
stage: integration
tech_stack: [bun, typescript]
applies_when: exercising the compiled get command
anti_patterns:
  - id: integration.retrieval.skip
    name: Skip persisted state
    description: Do not bypass the local snapshot.
---
# Persisted guidance

This complete body must survive installation and retrieval.
`,
    ),
  ]);
}

async function writeMinimalPack(packDirectory: string): Promise<void> {
  await mkdir(join(packDirectory, "practices"), { recursive: true });
  await Promise.all([
    writeFile(join(packDirectory, "pack.yaml"), "name: minimal-pack\nversion: 1.0.0\n"),
    writeFile(
      join(packDirectory, "practices", "guidance.md"),
      `---
id: integration.minimal.guidance
title: Minimal integration guidance
stage: integration
tech_stack: [typescript]
applies_when: checking a Pack without optional metadata
---
Optional Pack metadata is intentionally omitted.
`,
    ),
  ]);
}
