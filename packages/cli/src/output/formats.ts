import type { OutputFormat } from "../registry.js";

/** Current commands remain JSON-only until their text renderer and tests are ready. */
export const jsonOnlyOutput = Object.freeze({
  formats: Object.freeze(["json"] as const),
  default: "json" as const,
}) satisfies Readonly<{ formats: readonly OutputFormat[]; default: OutputFormat }>;

/** Text-capable commands keep JSON as the compatibility-preserving default. */
export const jsonTextOutput = Object.freeze({
  formats: Object.freeze(["json", "text"] as const),
  default: "json" as const,
}) satisfies Readonly<{ formats: readonly OutputFormat[]; default: OutputFormat }>;
