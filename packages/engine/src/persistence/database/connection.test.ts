import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

import { keywordIndexDatabaseDefinition } from "../definitions";
import { openSqliteConnection } from "./connection";
import { migrateSqlite } from "./migrator";

test.skipIf(process.platform !== "win32")(
  "closing a migrated connection releases the file for immediate rename on Windows",
  async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "lorelum-sqlite-close-"));
    try {
      const databasePath = join(rootPath, "example.sqlite");
      const connection = openSqliteConnection(databasePath, keywordIndexDatabaseDefinition.schema);
      migrateSqlite(connection, keywordIndexDatabaseDefinition);
      connection.close();

      // Drizzle retains prepared statements; closing an Engine-owned client must
      // finalize them before callers publish a replacement file.
      await rename(databasePath, `${databasePath}.moved`);
      expect(await readdir(rootPath)).toEqual(["example.sqlite.moved"]);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  },
);

test("closing a connection closes the underlying bun:sqlite client", async () => {
  const rootPath = join(await mkdtemp(join(tmpdir(), "lorelum-sqlite-close-")), "nested");
  await mkdir(rootPath, { recursive: true });
  try {
    const connection = openSqliteConnection(
      join(rootPath, "example.sqlite"),
      keywordIndexDatabaseDefinition.schema,
    );
    const { client } = connection;
    connection.close();
    expect(() => client.exec("SELECT 1")).toThrow();
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
