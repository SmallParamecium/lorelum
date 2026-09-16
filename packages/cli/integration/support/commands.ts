import { runProcess, type ProcessResult } from "./process.js";

export async function runGet(
  binaryPath: string,
  practiceId: string,
  storageRoot: string,
  globalPosition: "before" | "after" = "after",
  format?: "json" | "text",
): Promise<ProcessResult> {
  const args =
    globalPosition === "before"
      ? [binaryPath, "--store-root", storageRoot, "get", practiceId]
      : [binaryPath, "get", practiceId, "--store-root", storageRoot];
  if (format !== "text") args.push("--json");
  return runProcess(args);
}

export async function runList(
  binaryPath: string,
  storageRoot: string,
  options: {
    readonly details?: boolean;
    readonly packName?: string;
    readonly format?: "json" | "text";
  } = {},
): Promise<ProcessResult> {
  const args = [binaryPath, "pack", "list"];
  if (options.details === true) args.push("--details");
  if (options.packName !== undefined) args.push(options.packName);
  args.push("--store-root", storageRoot);
  if (options.format !== "text") args.push("--json");
  return runProcess(args);
}

export async function runQuery(
  binaryPath: string,
  text: string,
  storageRoot: string,
  topK?: number,
  mode: "keyword" | "semantic" = "keyword",
  format?: "json" | "text",
): Promise<ProcessResult> {
  const args = [binaryPath, "query", text, "--mode", mode, "--store-root", storageRoot];
  if (topK !== undefined) args.push("--top-k", String(topK));
  if (format !== "text") args.push("--json");
  return runProcess(args);
}
