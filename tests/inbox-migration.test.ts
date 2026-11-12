import { it, expect } from "vitest";
import initSqlJs from "sql.js";
import { Store } from "../electron/database";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
it("migrates a Stage 1 database without losing orders and never persists app passwords", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-migrate-"));
  const path = join(dir, "db.sqlite");
  try {
    let db = await Store.open(path);
    const ids = db.snapshot().orders.map((o) => o.id);
    db.close();
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const v1 = new SQL.Database(readFileSync(path));
    v1.run(
      "DROP TABLE shipments; DROP TABLE inbox_account; DELETE FROM migrations WHERE version=2",
    );
    writeFileSync(path, v1.export());
    v1.close();
    db = await Store.open(path);
    expect(db.snapshot().orders.map((o) => o.id)).toEqual(ids);
    expect(db.inboxAccount()).toBeNull();
    db.connectInbox("test@gmail.com", {
      events: [],
      scanned: 0,
      skipped: 0,
      limited: false,
    });
    db.close();
    const reopened = await Store.open(path);
    expect(reopened.inboxAccount()?.email).toBe("test@gmail.com");
    expect(reopened.snapshot().orders).toHaveLength(36);
    reopened.close();
    const disk = new SQL.Database(readFileSync(path));
    const columns = disk
      .exec("PRAGMA table_info(inbox_account)")[0]
      .values.map((row) => row[1]);
    expect(columns).not.toContain("appPassword");
    expect(columns).not.toContain("password");
    disk.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
