/**
 * Minimal deterministic retrieval: pure metadata + text matching shared by the
 * CLI and future MCP adapters. No filesystem or process I/O.
 */
export { retrievePractices } from "./retrieve.js";
export type {
  RetrievePracticesInput,
  RetrievePracticesResult,
  RetrievedPractice,
} from "./types.js";
