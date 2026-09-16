import packageManifest from "../../package.json";

/** Version of the process-envelope contract. */
export const protocolVersion = 1;
/** Version of the CLI implementation emitting the envelope. */
export const toolVersion = packageManifest.version;

export type JsonSchema = {
  oneOf?: readonly JsonSchema[];
  type?: "array" | "boolean" | "integer" | "object" | "string";
  const?: unknown;
  enum?: readonly unknown[];
  additionalProperties?: boolean;
  required?: readonly string[];
  properties?: Readonly<Record<string, JsonSchema>>;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | Readonly<Record<string, unknown>>;

export interface OutputWriter {
  write(message: string): void;
}

/** Controls whether a text projection gets a terminal line feed added. */
export type TextOutputMode = "line" | "verbatim";

interface EnvelopeBase {
  protocolVersion: number;
  toolVersion: string;
  command: string;
}

export interface ProtocolSuccess<T extends JsonValue = JsonValue> extends EnvelopeBase {
  ok: true;
  data: T;
}

export interface ProtocolFailure extends EnvelopeBase {
  ok: false;
  error: {
    code: string;
    message: string;
    recovery?: ErrorRecovery;
  };
}

export interface ErrorRecovery {
  readonly action: "backend.stop-if-idle";
  readonly automation: "auto" | "defer";
  readonly reason: "idle" | "active-long-task" | "unknown-activity";
  readonly retry: "original-command";
}

/** Validates the outer response only; command `data` uses its registry result schema. */
export const protocolResponseSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["protocolVersion", "toolVersion", "command", "ok", "data"],
      properties: {
        protocolVersion: { const: protocolVersion },
        toolVersion: { type: "string" },
        command: { type: "string" },
        ok: { const: true },
        data: {},
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["protocolVersion", "toolVersion", "command", "ok", "error"],
      properties: {
        protocolVersion: { const: protocolVersion },
        toolVersion: { type: "string" },
        command: { type: "string" },
        ok: { const: false },
        error: {
          type: "object",
          additionalProperties: false,
          required: ["code", "message"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            recovery: {
              type: "object",
              additionalProperties: false,
              required: ["action", "automation", "reason", "retry"],
              properties: {
                action: { const: "backend.stop-if-idle" },
                automation: { enum: ["auto", "defer"] },
                reason: { enum: ["idle", "active-long-task", "unknown-activity"] },
                retry: { const: "original-command" },
              },
            },
          },
        },
      },
    },
  ],
} as const satisfies JsonSchema;

export function renderSuccess<T extends JsonValue>(
  writer: OutputWriter,
  command: string,
  data: T,
): void {
  assertJsonValue(data);
  const response: ProtocolSuccess<T> = {
    protocolVersion,
    toolVersion,
    command,
    ok: true,
    data,
  };
  writer.write(`${JSON.stringify(response)}\n`);
}

export function renderFailure(
  writer: OutputWriter,
  command: string,
  code: string,
  message: string,
  recovery?: ErrorRecovery,
): void {
  const response: ProtocolFailure = {
    protocolVersion,
    toolVersion,
    command,
    ok: false,
    error: { code, message, ...(recovery === undefined ? {} : { recovery }) },
  };
  writer.write(`${JSON.stringify(response)}\n`);
}

/** Writes a plain-text projection, optionally preserving the renderer output exactly. */
export function renderTextSuccess(
  writer: OutputWriter,
  text: string,
  mode: TextOutputMode = "line",
): void {
  if (typeof text !== "string") throw new TypeError("Text renderers must return a string.");
  writer.write(mode === "verbatim" || text.endsWith("\n") ? text : `${text}\n`);
}

export function renderTextFailure(writer: OutputWriter, code: string, message: string): void {
  writer.write(`error[${code}]: ${message}\n`);
}

export function assertJsonValue(value: unknown): asserts value is JsonValue {
  assertJsonValueInternal(value, new WeakSet());
}

function assertJsonValueInternal(value: unknown, ancestors: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new TypeError("Protocol data contains a non-finite number.");
  }
  if (typeof value !== "object") {
    throw new TypeError("Protocol data is not JSON-safe.");
  }
  if (ancestors.has(value)) {
    throw new TypeError("Protocol data contains a circular reference.");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) assertJsonValueInternal(item, ancestors);
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Protocol data must contain only plain JSON objects.");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Protocol data contains symbol properties.");
    }
    for (const nestedValue of Object.values(value)) {
      assertJsonValueInternal(nestedValue, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}
