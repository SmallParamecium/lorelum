import type {
  ListPackDetailsResult,
  ListServiceWithPackDetails,
  StorageRoot,
} from "@lorelum/engine";
import { PACK_NAME_REGEX } from "@lorelum/format";

import type { JsonSchema, JsonValue } from "../output/protocol.js";
import { listErrorCodes, throwListVisibleError } from "./errors.js";
import type { CommandDefinition } from "../registry.js";
import { invalidInvocationError } from "../runtime/errors.js";
import { resolveInvocationStorageRoot } from "../store/storage-root.js";

export interface ListCommandServices {
  readonly list: Pick<ListServiceWithPackDetails, "list" | "listPack" | "listPackDetails">;
  readonly storageRoot: StorageRoot;
}

const stringSchema: JsonSchema = { type: "string" };
const stringArraySchema: JsonSchema = { type: "array", items: stringSchema };

const installedPackSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "version", "practiceCount"],
  properties: {
    name: stringSchema,
    version: stringSchema,
    practiceCount: { type: "integer" },
  },
};

const packSummarySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "version"],
  properties: { name: stringSchema, version: stringSchema },
};

const listedPracticeSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "applies_when"],
  properties: {
    id: stringSchema,
    title: stringSchema,
    applies_when: stringSchema,
  },
};

const richPackSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "version", "appliesTo"],
  properties: {
    name: stringSchema,
    version: stringSchema,
    description: stringSchema,
    appliesTo: stringArraySchema,
  },
};

const packListSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generation", "effectiveRevision", "packs"],
  properties: {
    generation: { type: "integer" },
    effectiveRevision: { type: "integer" },
    packs: { type: "array", minItems: 1, items: installedPackSchema },
  },
};

const richPackListSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generation", "effectiveRevision", "packs"],
  properties: {
    generation: { type: "integer" },
    effectiveRevision: { type: "integer" },
    packs: { type: "array", minItems: 1, items: richPackSchema },
  },
};

const emptyPackListSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generation", "effectiveRevision", "packs"],
  properties: {
    generation: { type: "integer" },
    effectiveRevision: { type: "integer" },
    packs: { type: "array", maxItems: 0 },
  },
};

const practiceCatalogSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generation", "effectiveRevision", "pack", "practices"],
  properties: {
    generation: { type: "integer" },
    effectiveRevision: { type: "integer" },
    pack: packSummarySchema,
    practices: { type: "array", items: listedPracticeSchema },
  },
};

const resultSchema: JsonSchema = {
  oneOf: [packListSchema, richPackListSchema, emptyPackListSchema, practiceCatalogSchema],
};

function toRichPackListData(result: ListPackDetailsResult): JsonValue {
  return {
    generation: result.generation,
    effectiveRevision: result.effectiveRevision,
    packs: result.packs.map((pack) => ({
      name: pack.name,
      version: pack.version,
      ...(pack.description === undefined ? {} : { description: pack.description }),
      appliesTo: [...(pack.applies_to ?? [])],
    })),
  };
}

export function createListCommand(services: ListCommandServices): CommandDefinition {
  return {
    name: "list",
    summary: "List installed Packs and their Practice catalogs from the LocalStore.",
    positionals: [{ name: "scope", required: false, values: ["packs"] }],
    options: [
      {
        longFlag: "--pack",
        description: "List the Practice catalog for one installed Pack.",
        value: { name: "name", required: true },
        optionRequired: false,
      },
    ],
    resultSchema,
    errorCodes: listErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      const scope = invocation.positionals[0];
      const packName = invocation.options.pack;
      if (scope !== undefined && scope !== "packs") throw invalidInvocationError();
      if (scope === "packs" && packName !== undefined) throw invalidInvocationError();
      if (
        packName !== undefined &&
        (typeof packName !== "string" || !PACK_NAME_REGEX.test(packName))
      ) {
        throw invalidInvocationError();
      }

      const storageRoot = resolveInvocationStorageRoot(
        invocation.options.storeRoot,
        services.storageRoot,
      );

      try {
        const result =
          scope === "packs"
            ? toRichPackListData(await services.list.listPackDetails({ storageRoot }))
            : packName === undefined
              ? await services.list.list({ storageRoot })
              : await services.list.listPack({ packName, storageRoot });
        return { data: result as unknown as JsonValue };
      } catch (error) {
        throwListVisibleError(error);
      }
    },
  };
}
