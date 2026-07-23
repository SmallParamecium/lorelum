type Schema = {
  oneOf?: readonly Schema[];
  type?: "object" | "string";
  const?: unknown;
  additionalProperties?: boolean;
  required?: readonly string[];
  properties?: Readonly<Record<string, Schema>>;
};

/** Validates the JSON Schema vocabulary used by the v1 protocol contract. */
export function validateProtocolSchema(value: unknown, schema: Schema): string[] {
  return validate(value, schema, "response");
}

function validate(value: unknown, schema: Schema, path: string): string[] {
  if (schema.oneOf !== undefined) {
    const results = schema.oneOf.map((candidate) => validate(value, candidate, path));
    const matchingSchemas = results.filter((errors) => errors.length === 0);
    return matchingSchemas.length === 1
      ? []
      : [`${path} must match exactly one protocol response schema`];
  }

  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    return [`${path} must equal ${JSON.stringify(schema.const)}`];
  }

  if (schema.type === "string") {
    return typeof value === "string" ? [] : [`${path} must be a string`];
  }

  if (schema.type !== "object") return [];
  if (!isRecord(value)) return [`${path} must be an object`];

  const errors: string[] = [];
  for (const property of schema.required ?? []) {
    if (!Object.hasOwn(value, property)) errors.push(`${path}.${property} is required`);
  }

  if (schema.additionalProperties === false) {
    for (const property of Object.keys(value)) {
      if (schema.properties?.[property] === undefined) {
        errors.push(`${path}.${property} is not allowed`);
      }
    }
  }

  for (const [property, propertySchema] of Object.entries(schema.properties ?? {})) {
    if (Object.hasOwn(value, property)) {
      errors.push(...validate(value[property], propertySchema, `${path}.${property}`));
    }
  }
  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
