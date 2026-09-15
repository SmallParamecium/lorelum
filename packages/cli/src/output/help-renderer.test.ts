import { expect, test } from "bun:test";

import { renderHelpText } from "./help-renderer.js";

test("renders root Help as plain-text commands and global options", () => {
  const text = renderHelpText({
    name: "lore",
    usage: "lore",
    summary: "CLI summary.",
    options: [{ name: "--human", description: "Request text output." }],
    commands: [
      { usage: "query <text>", summary: "Find Practices." },
      { usage: "pack list", summary: "List Packs." },
    ],
  });

  expect(text).toContain("Usage: lore [options] <command>");
  expect(text).toContain("Commands:");
  expect(text).toContain("query <text>");
  expect(text).toContain("help [command...]");
  expect(text).toContain("Options:");
  expect(text).not.toContain('"ok"');
});

test("renders command Help with arguments, option choices, and defaults", () => {
  const text = renderHelpText({
    name: "query",
    usage: "query <text>",
    summary: "Find Practices.",
    positionals: [{ name: "text", required: true }],
    options: [
      {
        name: "--mode <mode>",
        description: "Choose retrieval mode.",
        values: ["semantic", "keyword"],
        defaultValue: "semantic",
      },
    ],
  });

  expect(text).toContain("Usage: lore query <text>");
  expect(text).toContain("<text> (required)");
  expect(text).toContain("--mode <mode>");
  expect(text).toContain("choices: semantic, keyword");
  expect(text).toContain("default: semantic");
});
