import type { OutputCapability } from "../registry.js";

/** Current commands remain JSON-only until their text renderer and tests are ready. */
export const jsonOnlyOutput = Object.freeze({
  formats: Object.freeze(["json"] as const),
  default: "json" as const,
}) satisfies OutputCapability;

/** Text-capable commands use text by default; --json selects the machine protocol. */
export const textDefaultOutput = Object.freeze({
  formats: Object.freeze(["json", "text"] as const),
  default: "text" as const,
}) satisfies OutputCapability;
