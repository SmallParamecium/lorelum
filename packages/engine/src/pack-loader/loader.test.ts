import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

import { createPackLoader } from "./loader.js";
import type { PackDirectoryEntry, PackFileMetadata, PackFileSystem } from "./types.js";

class MemoryFileSystem implements PackFileSystem {
  readonly directories = new Map<string, PackDirectoryEntry[]>();
  readonly files = new Map<string, string>();
  readonly links = new Set<string>();
  readonly reads: string[] = [];

  addDirectory(path: string, entries: PackDirectoryEntry[] = []): void {
    this.directories.set(resolve(path), entries);
  }

  addFile(path: string, content: string): void {
    this.files.set(resolve(path), content);
  }

  async lstat(path: string): Promise<PackFileMetadata> {
    const resolved = resolve(path);
    if (this.links.has(resolved)) return { kind: "symlink", size: 0 };
    if (this.directories.has(resolved)) return { kind: "directory", size: 0 };
    const content = this.files.get(resolved);
    if (content !== undefined) return { kind: "file", size: Buffer.byteLength(content) };
    return { kind: "missing", size: 0 };
  }

  async readDirectory(path: string): Promise<readonly PackDirectoryEntry[]> {
    const entries = this.directories.get(resolve(path));
    if (entries === undefined) throw new Error("missing");
    return entries;
  }

  async readRegularFile(path: string, maxBytes: number): Promise<string> {
    const resolved = resolve(path);
    this.reads.push(resolved);
    if (this.links.has(resolved)) throw new Error("symlink");
    const content = this.files.get(resolved);
    if (content === undefined) throw new Error("missing");
    if (Buffer.byteLength(content) > maxBytes) throw new Error("too large");
    return content;
  }
}

function validFileSystem(): { fileSystem: MemoryFileSystem; root: string } {
  const root = resolve("pack-under-test");
  const practices = join(root, "practices");
  const fileSystem = new MemoryFileSystem();
  fileSystem.addDirectory(root);
  fileSystem.addDirectory(practices, [
    { kind: "file", name: "api.md" },
    { kind: "file", name: "auth.md" },
    { kind: "file", name: "ignored.txt" },
  ]);
  fileSystem.addFile(join(root, "pack.yaml"), "name: test-pack\nversion: 1.0.0\n");
  fileSystem.addFile(
    join(root, "decisions.yaml"),
    `- id: test.entry
  question: Which pattern?
  branches:
    - when: always
      recommend: [test.auth.guard]
      reason: Forward references are valid
`,
  );
  fileSystem.addFile(
    join(practices, "api.md"),
    `---
id: test.api.layer
title: API layer
stage: api
tech_stack: [typescript]
applies_when: building a robust API layer
severity: warn
---
Keep requests behind an API layer.
`,
  );
  fileSystem.addFile(
    join(practices, "auth.md"),
    `---
id: test.auth.guard
title: Guard routes
stage: auth
tech_stack: [typescript]
applies_when: protecting an authenticated route
severity: warn
---
Use a route guard.
`,
  );
  return { fileSystem, root };
}

test("loads only the versioned pack input layout from an explicit directory", async () => {
  const { fileSystem, root } = validFileSystem();
  const input = await createPackLoader(fileSystem).load(root);

  expect(input.pack).toEqual({ name: "test-pack", version: "1.0.0" });
  expect(input.practices).toHaveLength(2);
  expect(input.decisions).toHaveLength(1);
  expect(fileSystem.reads).not.toContain(join(root, "ignored.txt"));
});

test("rejects symlinked pack inputs without exposing the path or file contents", async () => {
  const { fileSystem, root } = validFileSystem();
  fileSystem.links.add(join(root, "pack.yaml"));

  await expect(createPackLoader(fileSystem).load(root)).rejects.toMatchObject({
    code: "pack.unreadable",
    message: "A pack input could not be read.",
  });
});

test("rejects a non-regular Practice Markdown candidate", async () => {
  const { fileSystem, root } = validFileSystem();
  const practices = join(root, "practices");
  fileSystem.directories.set(practices, [{ kind: "symlink", name: "api.md" }]);

  await expect(createPackLoader(fileSystem).load(root)).rejects.toMatchObject({
    code: "pack.unreadable",
  });
});

test("allows 128 input files when decisions.yaml is absent", async () => {
  const { fileSystem, root } = validFileSystem();
  const practices = join(root, "practices");
  const entries = Array.from({ length: 127 }, (_, index) => ({
    kind: "file" as const,
    name: `practice-${index}.md`,
  }));
  fileSystem.files.delete(join(root, "decisions.yaml"));
  fileSystem.directories.set(practices, entries);

  for (const entry of entries) {
    fileSystem.addFile(
      join(practices, entry.name),
      `---\nid: test.${entry.name}\ntitle: Practice\nstage: test\ntech_stack: [typescript]\napplies_when: testing an input limit\n---\nGuidance.\n`,
    );
  }

  const input = await createPackLoader(fileSystem).load(root);
  expect(input.practices).toHaveLength(127);
  expect(input.decisions).toEqual([]);
});

test("normalizes malformed document parsing to a safe diagnostic", async () => {
  const { fileSystem, root } = validFileSystem();
  fileSystem.addFile(join(root, "pack.yaml"), "name: [secret-content\n");

  await expect(createPackLoader(fileSystem).load(root)).rejects.toMatchObject({
    code: "pack.parse_error",
    message: "A pack document could not be parsed.",
  });
});
