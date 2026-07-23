import { expect, test } from "bun:test";

import { protocolResponseSchema, renderFailure, renderSuccess, toolVersion } from "./protocol.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

test("renders one JSON line for successful protocol responses", () => {
  const writer = new MemoryWriter();

  renderSuccess(writer, "describe", { name: "lore" });

  expect(writer.value.endsWith("\n")).toBe(true);
  expect(JSON.parse(writer.value)).toEqual({
    protocolVersion: 1,
    toolVersion,
    command: "describe",
    ok: true,
    data: { name: "lore" },
  });
});

test("renders structured protocol failures", () => {
  const writer = new MemoryWriter();

  renderFailure(writer, "unknown", "usage.invalid", "The command invocation is invalid.");

  expect(JSON.parse(writer.value)).toMatchObject({
    command: "unknown",
    ok: false,
    error: { code: "usage.invalid" },
  });
});

test("exports a schema that distinguishes successful and failed envelopes", () => {
  expect(protocolResponseSchema.oneOf).toHaveLength(2);
  expect(protocolResponseSchema.oneOf[0]?.properties.ok).toEqual({ const: true });
  expect(protocolResponseSchema.oneOf[1]?.properties.ok).toEqual({ const: false });
});
