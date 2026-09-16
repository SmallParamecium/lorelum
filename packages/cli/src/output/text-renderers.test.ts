import { expect, test } from "bun:test";

import {
  renderGetText,
  renderPackInstallText,
  renderPackListText,
  renderQueryText,
  renderVersionText,
} from "./text-renderers.js";

const practiceHit = {
  practiceId: "sample.react-auth",
  title: "Use the existing authentication service",
  stage: "implementation",
  techStack: ["react", "typescript"],
  appliesWhen: "adding authentication to a React page",
  severity: "warn",
  contentDigest: "a".repeat(64),
};

test("get text is only the complete Practice body", () => {
  const body = "Use the shared authentication service.\nDo not create a parallel token flow.";
  expect(
    renderGetText({
      practice: { id: "sample.auth", body, title: "Auth" },
      contentDigest: "a".repeat(64),
      sources: [{ packName: "team", sourcePath: "practices/auth.md" }],
    }),
  ).toBe(body);
});

test("query text preserves relevance order and task-relevant fields, not machine metadata", () => {
  const text = renderQueryText({
    mode: "semantic",
    profileId: "p".repeat(64),
    coverage: "partial",
    results: [practiceHit, { ...practiceHit, practiceId: "sample.next", title: "Next" }],
  });
  expect(text).toContain("Query mode: semantic (coverage: partial)");
  expect(text.indexOf("sample.react-auth")).toBeLessThan(text.indexOf("sample.next"));
  expect(text).toContain("Stage: implementation");
  expect(text).toContain("Severity: warn");
  expect(text).toContain("Tech stack: react, typescript");
  expect(text).toContain("Applies when: adding authentication to a React page");
  expect(text).not.toContain("profileId");
  expect(text).not.toContain("contentDigest");
});

test("query text handles empty, keyword, preparing, and indexing results explicitly", () => {
  expect(renderQueryText({ mode: "keyword", results: [] })).toBe(
    "Query mode: keyword\nNo matching Practices.",
  );
  const message = "The local model is preparing in the background. Retry this query later.";
  const preparing = renderQueryText({
    state: "preparing",
    preparationId: "private-operation-id",
    message,
  });
  expect(preparing).toContain("preparing");
  expect(preparing).toContain(message);
  expect(preparing).not.toContain("private-operation-id");

  const indexing = renderQueryText({
    state: "indexing",
    operationId: "private-index-operation-id",
    indexedPracticeCount: 50,
    totalPracticeCount: 100,
    message: "The semantic index is building in the background.",
  });
  expect(indexing).toContain("Semantic query is indexing.");
  expect(indexing).toContain("Indexed Practices: 50/100");
  expect(indexing).toContain("The semantic index is building in the background.");
  expect(indexing).not.toContain("private-index-operation-id");
});

test("pack list text keeps Store snapshot, stable IDs, order, and empty state", () => {
  const text = renderPackListText({
    generation: 3,
    effectiveRevision: 8,
    pack: { name: "team", version: "1.0.0" },
    practices: [
      { id: "team.first", title: "First", applies_when: "first context" },
      { id: "team.second", title: "Second", applies_when: "second context" },
    ],
  });
  expect(text).toContain("Store snapshot: generation 3, effective revision 8");
  expect(text.indexOf("team.first")).toBeLessThan(text.indexOf("team.second"));
  expect(text).toContain("Applies when: first context");
  expect(renderPackListText({ generation: 0, effectiveRevision: 0, packs: [] })).toContain(
    "No installed Packs.",
  );
});

test("pack list text renders summaries and rich metadata", () => {
  const summary = renderPackListText({
    generation: 1,
    effectiveRevision: 2,
    packs: [{ name: "team", version: "1.0.0", practiceCount: 4 }],
  });
  expect(summary).toContain("team@1.0.0 (4 Practices)");

  const rich = renderPackListText({
    generation: 1,
    effectiveRevision: 2,
    packs: [
      { name: "team", version: "1.0.0", description: "Team practices", appliesTo: ["typescript"] },
    ],
  });
  expect(rich).toContain("Team practices");
  expect(rich).toContain("Applies to: typescript");
});

test("install text reports identity, snapshot, mutations, cleanup, diagnostics, and pending index work", () => {
  const text = renderPackInstallText({
    pack: { name: "team", version: "1.0.0" },
    registry: { name: "internal", repository: "acme/team" },
    source: { type: "git", ref: "v1.0.0", commit: "0123456789abcdef" },
    generation: 4,
    effectiveRevision: 7,
    delta: { added: ["team.practice"], changed: [], invalidated: [] },
    diagnostics: [
      {
        level: "warning",
        code: "pack.warning",
        path: "pack.yaml",
        message: "Optional field omitted.",
      },
    ],
    cleanupPending: true,
    idempotent: false,
    artifactDigest: "b".repeat(64),
    indexSync: { state: "pending", operationId: "index-op", phase: "building" },
  });
  expect(text).toContain("Installed team@1.0.0.");
  expect(text).toContain("Store snapshot: generation 4, effective revision 7");
  expect(text).toContain("Added: team.practice");
  expect(text).toContain("Cleanup: pending.");
  expect(text).toContain("Semantic index: pending (building; operation index-op).");
  expect(text).toContain("Optional field omitted.");
  expect(text).not.toContain("artifactDigest");
});

test("install text explains a failed semantic index sync", () => {
  const text = renderPackInstallText({
    pack: { name: "team", version: "1.0.0" },
    registry: { name: "internal", repository: "acme/team" },
    source: { type: "git", ref: "v1.0.0" },
    generation: 4,
    effectiveRevision: 7,
    delta: { added: ["team.practice"], changed: [], invalidated: [] },
    diagnostics: [],
    cleanupPending: false,
    idempotent: false,
    indexSync: {
      state: "failed",
      error: { code: "embedding.download-failed", message: "Pack remains installed." },
    },
  });
  expect(text).toContain(
    "Semantic index: failed [embedding.download-failed]: Pack remains installed.",
  );
  expect(text).toContain("Installed team@1.0.0.");
});

test("version text is concise and human-readable", () => {
  expect(renderVersionText({ protocolVersion: 1, toolVersion: "1.2.3" })).toBe(
    "Lorelum 1.2.3 (protocol 1)",
  );
});
