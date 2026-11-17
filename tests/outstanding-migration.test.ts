import { it, expect } from "vitest";
import initSqlJs from "sql.js";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../electron/database";
it("upgrades a v9 database preserving receipt identities and cursor progress with a backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "outstanding-v9-")),
    file = join(dir, "test.sqlite");
  try {
    let db = await Store.open(file);
    db.mail.ingest(
      "test",
      [
        {
          transactionId: "MIGRATIONTEST00001",
          purchaseDate: "2026-11-16",
          lines: [
            {
              description: "Original comic",
              unitCents: 399,
              quantity: 2,
              amountCents: 798,
              kind: "item",
            },
            {
              description: "FOC SHIPPING",
              unitCents: 495,
              quantity: 1,
              amountCents: 495,
              kind: "shipping",
            },
          ],
        },
      ],
      { validity: "folder|1", lastUid: 77 },
      { scanned: 1, skipped: 0, limited: false },
    );
    const id = db.mail.lines()[0].id,
      orderIds = db.snapshot().orders.map((o) => o.id);
    db.close();
    const SQL = await initSqlJs({
        locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
      }),
      raw = new SQL.Database(readFileSync(file));
    raw.run(
      "ALTER TABLE outstanding_orders DROP COLUMN expectedDate; ALTER TABLE outstanding_orders DROP COLUMN deletedAt; DELETE FROM migrations WHERE version=10;",
    );
    writeFileSync(file, raw.export());
    raw.close();
    db = await Store.open(file);
    expect(db.mail.lines()).toHaveLength(1);
    expect(db.mail.lines()[0]).toMatchObject({
      id,
      expectedDate: null,
      deletedAt: null,
      quantity: 2,
      unitCents: 399,
    });
    expect(db.mail.lines(true)).toHaveLength(2);
    expect(db.mail.cursor("test").lastUid).toBe(77);
    expect(db.snapshot().orders.map((o) => o.id)).toEqual(orderIds);
    expect(existsSync(file + ".pre-outstanding-v9.bak")).toBe(true);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
