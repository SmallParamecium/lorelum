import assert from "node:assert/strict";

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse the CLI's one-line JSON envelope and reject accidental extra output. */
export function parseSingleResponse(stdout: string): JsonRecord {
  const lines = stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `expected one JSON response line, got ${lines.length}`);
  const response: unknown = JSON.parse(lines[0]!);
  assert(isRecord(response));
  return response;
}

export function requireSuccessData(response: JsonRecord, command: string): JsonRecord {
  assert.equal(response.command, command);
  assert.equal(response.ok, true);
  assert(isRecord(response.data));
  return response.data;
}

export function requireFailureCode(response: JsonRecord, command: string, code: string): void {
  assert.equal(response.command, command);
  assert.equal(response.ok, false);
  assert(isRecord(response.error));
  assert.equal(response.error.code, code);
}

export function selectProtocolFields(stdout: string): {
  command: unknown;
  errorCode?: unknown;
  ok: unknown;
} {
  const response: unknown = JSON.parse(stdout);
  assert(isRecord(response));
  const error = response.error;
  return {
    command: response.command,
    ...(isRecord(error) ? { errorCode: error.code } : {}),
    ok: response.ok,
  };
}
