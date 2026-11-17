import { makeMailV8 } from "./legacy-collection";
import { it, expect } from "vitest";
import initSqlJs from "sql.js";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../electron/database";
it("opens a v0.7 database and preserves separate entry data while updating existing orders", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-rollback-")),
    file = join(dir, "db.sqlite");
  try {
    const initial = await Store.open(file);
    initial.close();
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    let raw = new SQL.Database(readFileSync(file));
    makeMailV8(raw);
    raw.run(
      readFileSync(join(process.cwd(), "tests/fixtures/entry-v8.sql"), "utf8"),
    );
    raw.run(
      "INSERT INTO migrations VALUES(8); UPDATE entry_settings SET runnerEmail='preserve@example.com' WHERE id=1",
    );
    writeFileSync(file, raw.export());
    raw.close();
    const store = await Store.open(file);
    expect(store.snapshot().orders).toHaveLength(36);
    store.addOrder({
      name: "After rollback",
      store: "Test",
      category: "Other",
      total: 12,
      status: "Processing",
      date: "2026-11-17",
    });
    store.close();
    raw = new SQL.Database(readFileSync(file));
    expect(
      raw.exec("SELECT runnerEmail FROM entry_settings WHERE id=1")[0]
        .values[0][0],
    ).toBe("preserve@example.com");
    expect(
      raw.exec("SELECT MAX(version) FROM migrations")[0].values[0][0],
    ).toBe(9);
    raw.run("INSERT INTO migrations VALUES(999)");
    writeFileSync(file, raw.export());
    raw.close();
    await expect(Store.open(file)).rejects.toThrow(
      "Unsupported database version",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
