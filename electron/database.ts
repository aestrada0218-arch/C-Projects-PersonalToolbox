import { CollectionRepository } from "./collection/store";
import { collectionMigration } from "./collection/model";
import { ExpenseRepository } from "./expenses/store";
import { expenseMigration } from "./expenses/model";
import initSqlJs, { Database } from "sql.js";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  InboxAccount,
  Shipment,
  ShipmentEvent,
  EmailUpdate,
} from "../src/inbox-types";
import type { ScanResult } from "./inbox/gmail";
import type { Snapshot, NewOrder } from "../src/types";
export const orderSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    store: z.string().trim().min(1).max(80),
    category: z.string().trim().min(1).max(50),
    total: z.number().finite().min(0).max(10000000),
    status: z.enum(["Delivered", "In transit", "Processing", "Cancelled"]),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (s) =>
          !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
      ),
  })
  .strict();
export class Store {
  readonly collection = new CollectionRepository(
    () => this.db,
    (fn) => this.mutate(fn),
  );
  readonly expenses = new ExpenseRepository(
    () => this.db,
    (fn) => this.mutate(fn),
  );
  private constructor(
    private db: Database,
    private path: string | undefined,
    private restore: (bytes: Uint8Array) => Database,
  ) {}
  static async open(path?: string) {
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const store = new Store(
      path && existsSync(path)
        ? new SQL.Database(readFileSync(path))
        : new SQL.Database(),
      path,
      (bytes) => new SQL.Database(bytes),
    );
    store.migrate();
    return store;
  }
  private migrate() {
    this.db.run(
      "PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY)",
    );
    const version =
      this.db.exec("SELECT MAX(version) FROM migrations")[0]?.values[0][0] || 0;
    if (Number(version) > 5) throw new Error("Unsupported database version");
    if (Number(version) < 1) {
      this.db.run(
        `BEGIN; CREATE TABLE orders(id TEXT PRIMARY KEY,name TEXT NOT NULL,store TEXT NOT NULL,category TEXT NOT NULL,total REAL NOT NULL CHECK(total>=0),status TEXT NOT NULL CHECK(status IN ('Delivered','In transit','Processing','Cancelled')),date TEXT NOT NULL); CREATE TABLE collection(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),purchase REAL NOT NULL,market REAL NOT NULL); CREATE TABLE tasks(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL); INSERT INTO migrations VALUES(1);`,
      );
      this.seed();
      this.db.run("COMMIT");
      this.persist();
    }
    if (Number(version) < 2) {
      if (
        Number(version) === 1 &&
        this.path &&
        !existsSync(this.path + ".pre-inbox-v1.bak")
      ) {
        writeFileSync(this.path + ".pre-inbox-v1.bak", this.db.export(), {
          flag: "wx",
          mode: 0o600,
        });
      }
      this.db.run(`BEGIN;
        CREATE TABLE inbox_account(id INTEGER PRIMARY KEY CHECK(id=1),email TEXT NOT NULL,auto INTEGER NOT NULL DEFAULT 0 CHECK(auto IN (0,1)),lastSync TEXT,error TEXT,scanned INTEGER NOT NULL DEFAULT 0,skipped INTEGER NOT NULL DEFAULT 0,limited INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE shipments(id TEXT PRIMARY KEY,tracking TEXT NOT NULL UNIQUE,carrier TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('In transit','Out for delivery','Delivered')),received TEXT NOT NULL,subject TEXT NOT NULL,orderId TEXT REFERENCES orders(id) ON DELETE SET NULL);
        INSERT INTO migrations VALUES(2); COMMIT;`);
      this.persist();
    }
    if (Number(version) < 3) {
      if (
        this.path &&
        Number(version) > 0 &&
        !existsSync(this.path + ".pre-inbox-v2.bak")
      )
        writeFileSync(this.path + ".pre-inbox-v2.bak", this.db.export(), {
          flag: "wx",
          mode: 0o600,
        });
      this.db.run(
        `BEGIN; CREATE TABLE inbox_updates(id TEXT PRIMARY KEY,externalId TEXT NOT NULL UNIQUE,subject TEXT NOT NULL,received TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('Order confirmed','In transit','Out for delivery','Delivered','Needs review')),orderReference TEXT,orderId TEXT REFERENCES orders(id) ON DELETE SET NULL); INSERT INTO migrations VALUES(3); COMMIT;`,
      );
      this.persist();
    }
    if (Number(version) < 4) {
      if (
        this.path &&
        Number(version) > 0 &&
        !existsSync(this.path + ".pre-expenses-v3.bak")
      )
        writeFileSync(this.path + ".pre-expenses-v3.bak", this.db.export(), {
          flag: "wx",
          mode: 0o600,
        });
      this.db.run(
        "BEGIN;" +
          expenseMigration +
          " INSERT INTO migrations VALUES(4); COMMIT;",
      );
      this.persist();
    }
    if (Number(version) < 5) {
      if (
        this.path &&
        Number(version) > 0 &&
        !existsSync(this.path + ".pre-collection-v4.bak")
      )
        writeFileSync(this.path + ".pre-collection-v4.bak", this.db.export(), {
          flag: "wx",
          mode: 0o600,
        });
      this.db.run(
        "BEGIN;" +
          collectionMigration +
          " INSERT INTO migrations VALUES(5); COMMIT;",
      );
      this.persist();
    }
  }
  private seed() {
    const names = [
      ["Air Jordan 1 Retro High", "Nike", "Sneakers", 180],
      [
        "Pokémon 151 Elite Trainer Box",
        "Pokémon Center",
        "Trading cards",
        54.99,
      ],
      ["Kaws: Small Lie", "StockX", "Art & figures", 289],
      ["New Balance 990v6", "New Balance", "Sneakers", 199.99],
      ["LEGO Porsche 911", "LEGO", "Collectibles", 169.99],
      ["Dunk Low Vintage Green", "Nike", "Sneakers", 115],
      ["One Piece Booster Box", "Local store", "Trading cards", 124.99],
      ["Bearbrick Series 48", "Medicom", "Art & figures", 89],
    ];
    for (let i = 0; i < 36; i++) {
      const n = names[i % names.length];
      const d = new Date();
      d.setDate(d.getDate() - Math.floor(i * 2.4));
      this.db.run("INSERT INTO orders VALUES(?,?,?,?,?,?,?)", [
        randomUUID(),
        String(n[0]),
        String(n[1]),
        String(n[2]),
        Number(n[3]),
        i < 3 ? "In transit" : i < 6 ? "Processing" : "Delivered",
        d.toISOString().slice(0, 10),
      ]);
    }
    names
      .slice(0, 6)
      .forEach((n, i) =>
        this.db.run("INSERT INTO collection VALUES(?,?,?,?,?,?)", [
          randomUUID(),
          String(n[0]),
          String(n[2]),
          i + 1,
          Number(n[3]),
          Math.round(Number(n[3]) * (1.15 + i * 0.08)),
        ]),
      );
    this.db.run(
      "INSERT INTO tasks VALUES('sample-1','Collection price watch','Paused'),('sample-2','Shipment updates','Paused'),('sample-3','Weekly spending report','Paused')",
    );
  }
  private rows(table: string) {
    const result = this.db.exec(`SELECT * FROM ${table}`)[0];
    return result
      ? result.values.map((row) =>
          Object.fromEntries(result.columns.map((c, i) => [c, row[i]])),
        )
      : [];
  }
  snapshot(): Snapshot {
    return {
      orders: this.rows("orders").sort((a, b) =>
        String(b.date).localeCompare(String(a.date)),
      ),
      collection: this.rows("collection").map((item) => ({
        ...item,
        market: item.marketKnown ? item.market : 0,
      })),
      tasks: this.rows("tasks"),
    } as Snapshot;
  }
  addOrder(input: NewOrder) {
    const o = orderSchema.parse(input);
    const before = this.db.export();
    this.db.run("BEGIN");
    try {
      this.db.run("INSERT INTO orders VALUES(?,?,?,?,?,?,?)", [
        randomUUID(),
        o.name,
        o.store,
        o.category,
        o.total,
        o.status,
        o.date,
      ]);
      this.db.run("COMMIT");
      this.persist();
    } catch (e) {
      this.db.close();
      this.db = this.restore(before);
      this.db.run("PRAGMA foreign_keys=ON");
      throw e;
    }
    return this.snapshot();
  }
  private mutate<T>(fn: () => T): T {
    const before = this.db.export();
    this.db.run("BEGIN");
    try {
      const result = fn();
      this.db.run("COMMIT");
      this.persist();
      return result;
    } catch (error) {
      this.db.close();
      this.db = this.restore(before);
      this.db.run("PRAGMA foreign_keys=ON");
      throw error;
    }
  }
  inboxAccount(): InboxAccount | null {
    const row = this.rows("inbox_account")[0];
    if (!row) return null;
    return {
      ...row,
      auto: Boolean(row.auto),
      limited: Boolean(row.limited),
    } as unknown as InboxAccount;
  }
  shipments(): Shipment[] {
    return this.rows("shipments").sort((a, b) =>
      String(b.received).localeCompare(String(a.received)),
    ) as unknown as Shipment[];
  }
  connectInbox(email: string, scan: ScanResult) {
    this.mutate(() => {
      if (this.inboxAccount()?.email !== email)
        this.db.run("DELETE FROM shipments; DELETE FROM inbox_updates");
      this.db.run(
        "INSERT OR REPLACE INTO inbox_account(id,email,auto) VALUES(1,?,0)",
        [email],
      );
      this.ingest(scan);
    });
  }
  recordInboxScan(scan: ScanResult) {
    this.mutate(() => this.ingest(scan));
  }
  private ingest(scan: ScanResult) {
    for (const event of scan.events) {
      this.db.run(
        `INSERT INTO shipments(id,tracking,carrier,status,received,subject) VALUES(?,?,?,?,?,?) ON CONFLICT(tracking) DO UPDATE SET carrier=excluded.carrier,status=excluded.status,received=excluded.received,subject=excluded.subject WHERE excluded.received>shipments.received`,
        [
          randomUUID(),
          event.tracking,
          event.carrier,
          event.status,
          event.received,
          event.subject,
        ],
      );
    }
    for (const u of scan.updates || []) {
      this.db.run(
        "INSERT INTO inbox_updates(id,externalId,subject,received,status,orderReference) VALUES(?,?,?,?,?,?) ON CONFLICT(externalId) DO NOTHING",
        [
          randomUUID(),
          u.externalId,
          u.subject,
          u.received,
          u.status,
          u.orderReference,
        ],
      );
    }
    this.db.run(
      "UPDATE inbox_account SET lastSync=?,error=NULL,scanned=?,skipped=?,limited=? WHERE id=1",
      [
        new Date().toISOString(),
        scan.scanned,
        scan.skipped,
        Number(scan.limited),
      ],
    );
  }
  setInboxError(message: string) {
    this.mutate(() =>
      this.db.run("UPDATE inbox_account SET error=? WHERE id=1", [message]),
    );
  }
  setInboxAuto(value: boolean) {
    this.mutate(() =>
      this.db.run("UPDATE inbox_account SET auto=? WHERE id=1", [
        Number(value),
      ]),
    );
  }
  disconnectInbox() {
    this.mutate(() =>
      this.db.run(
        "DELETE FROM inbox_updates; DELETE FROM shipments; DELETE FROM inbox_account",
      ),
    );
  }
  emailUpdates(): EmailUpdate[] {
    return this.rows("inbox_updates").sort((a, b) =>
      String(b.received).localeCompare(String(a.received)),
    ) as unknown as EmailUpdate[];
  }
  applyEmailUpdate(input: unknown) {
    const { updateId, orderId } = z
      .object({ updateId: z.string().uuid(), orderId: z.string().uuid() })
      .strict()
      .parse(input);
    this.mutate(() => {
      const update = this.emailUpdates().find((u) => u.id === updateId);
      const order = this.snapshot().orders.find((o) => o.id === orderId);
      if (!update || !order || order.status === "Cancelled")
        throw Error("Invalid link");
      const status =
        update.status === "Delivered"
          ? "Delivered"
          : update.status === "Order confirmed"
            ? "Processing"
            : update.status === "Needs review"
              ? order.status
              : "In transit";
      const rank = {
        Processing: 0,
        "In transit": 1,
        Delivered: 2,
        Cancelled: 3,
      };
      if (rank[status] < rank[order.status])
        throw Error("Cannot move order backward");
      this.db.run("UPDATE inbox_updates SET orderId=? WHERE id=?", [
        orderId,
        updateId,
      ]);
      this.db.run("UPDATE orders SET status=? WHERE id=?", [status, orderId]);
    });
  }
  applyShipment(input: unknown) {
    const { shipmentId, orderId } = z
      .object({ shipmentId: z.string().uuid(), orderId: z.string().uuid() })
      .strict()
      .parse(input);
    this.mutate(() => {
      const shipment = this.shipments().find((s) => s.id === shipmentId);
      const order = this.snapshot().orders.find((o) => o.id === orderId);
      if (!shipment || !order || order.status === "Cancelled")
        throw new Error("Invalid link");
      const status =
        shipment.status === "Delivered" ? "Delivered" : "In transit";
      if (order.status === "Delivered" && status !== "Delivered")
        throw new Error("Cannot downgrade a delivered order");
      this.db.run("UPDATE shipments SET orderId=? WHERE id=?", [
        orderId,
        shipmentId,
      ]);
      this.db.run("UPDATE orders SET status=? WHERE id=?", [status, orderId]);
    });
  }
  private persist() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path + ".tmp", this.db.export(), { mode: 0o600 });
    renameSync(this.path + ".tmp", this.path);
  }
  close() {
    this.db.close();
  }
}
