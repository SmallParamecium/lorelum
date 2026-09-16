import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

export interface SqliteConnection<Schema extends Record<string, unknown>> {
  readonly client: Database;
  readonly orm: BunSQLiteDatabase<Schema>;
  close(): void;
}

export interface OpenSqliteConnectionOptions {
  readonly readonly?: boolean;
}

/**
 * Close every statement owned by this client before releasing its SQLite
 * connection. Drizzle retains prepared statements, so the default close mode
 * can leave a closed client holding a Windows file handle until GC runs.
 */
export function closeSqliteClient(client: Database): void {
  client.close(true);
}

/** Wrap a caller-owned bun:sqlite client without changing its lifecycle. */
export function createSqliteConnection<Schema extends Record<string, unknown>>(
  client: Database,
  schema: Schema,
): SqliteConnection<Schema> {
  const orm = drizzle({ client, schema });
  return Object.freeze({
    client,
    orm,
    close() {
      closeSqliteClient(client);
    },
  });
}

/** The only Engine persistence entrypoint that creates a bun:sqlite handle. */
export function openSqliteConnection<Schema extends Record<string, unknown>>(
  path: string,
  schema: Schema,
  options: OpenSqliteConnectionOptions = {},
): SqliteConnection<Schema> {
  let client: Database | undefined;
  try {
    const opened =
      options.readonly === true ? new Database(path, { readonly: true }) : new Database(path);
    client = opened;
    return createSqliteConnection(opened, schema);
  } catch (error) {
    if (client !== undefined) closeSqliteClient(client);
    throw error;
  }
}
