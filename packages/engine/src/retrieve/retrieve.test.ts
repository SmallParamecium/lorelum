import { expect, test } from "bun:test";

import type { Practice } from "@lorelum/format";

import { retrievePractices } from "./retrieve.js";

const practices: Practice[] = [
  {
    id: "api.layered-client",
    title: "Layer the API client",
    stage: "api-layer",
    tech_stack: ["react", "typescript"],
    applies_when: "building an API layer in a React SPA",
    body: "Put HTTP calls behind a client module.",
  },
  {
    id: "state.redux",
    title: "Scale client state with Redux",
    stage: "state",
    tech_stack: ["react"],
    applies_when: "managing heavy client state",
  },
  {
    id: "auth.jwt",
    title: "Store tokens outside components",
    stage: "auth",
    tech_stack: ["react"],
    applies_when: "handling login flows",
  },
];

test("ranks by field weight with stable id order for ties", () => {
  const result = retrievePractices({ practices, query: "api layer react" });
  expect(result.results[0]!.id).toBe("api.layered-client");
});

test("returns metadata only by default and body with includeBody", () => {
  const summary = retrievePractices({ practices, query: "layer", topK: 1 });
  expect(summary.results[0]).toEqual({
    id: "api.layered-client",
    title: "Layer the API client",
    stage: "api-layer",
    tech_stack: ["react", "typescript"],
    applies_when: "building an API layer in a React SPA",
  });

  const full = retrievePractices({ practices, query: "layer", topK: 1, includeBody: true });
  expect(full.results[0]!.body).toBe("Put HTTP calls behind a client module.");
});

test("returns an empty result for a query with no matches", () => {
  expect(retrievePractices({ practices, query: "zzz-unmatched" })).toEqual({
    query: "zzz-unmatched",
    k: 5,
    total: 0,
    results: [],
  });
});

test("caps results at k while total reports all matches", () => {
  const result = retrievePractices({ practices, query: "react", topK: 1 });
  expect(result.k).toBe(1);
  expect(result.results.length).toBe(1);
  expect(result.total).toBe(3);
});

test("clamps out-of-range topK defensively", () => {
  expect(retrievePractices({ practices, query: "react", topK: 0 }).k).toBe(1);
  expect(retrievePractices({ practices, query: "react", topK: 51 }).k).toBe(50);
  expect(retrievePractices({ practices, query: "react", topK: 1.5 }).k).toBe(5);
});

test("matches Unicode text (CJK) deterministically", () => {
  const cjk: Practice[] = [
    {
      id: "api.client",
      title: "API 客户端分层",
      stage: "api-layer",
      tech_stack: ["react"],
      applies_when: "在 React SPA 中构建 API 层",
    },
  ];
  const result = retrievePractices({ practices: cjk, query: "api 层" });
  expect(result.total).toBe(1);
  expect(result.results[0]!.id).toBe("api.client");
});

test("matches contiguous Chinese text via bigram tokenization", () => {
  const avatarPractices: Practice[] = [
    {
      id: "react.avatar-fallback-rendering",
      title: "React 头像回退呈现",
      stage: "visual-resilience",
      tech_stack: ["react", "typescript"],
      applies_when:
        "当界面展示用户或成员头像，并需在图片缺失、加载失败或无替代文本时提供可识别回退时。",
    },
  ];
  const result = retrievePractices({ practices: avatarPractices, query: "头像 图片 缺失 回退" });
  expect(result.total).toBe(1);
  expect(result.results[0]!.id).toBe("react.avatar-fallback-rendering");
});

test("is deterministic for identical inputs", () => {
  const left = retrievePractices({ practices, query: "react state" });
  const right = retrievePractices({ practices, query: "react state" });
  expect(left).toEqual(right);
});
