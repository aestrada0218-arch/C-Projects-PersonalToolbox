import { AsyncLocalStorage } from "node:async_hooks";
import { OrganizerRepository } from "./organizer/store";
import { organizerMigration, schemas } from "./organizer/model";
import {
  capture,
  recordHistory,
  undoMethods,
  validateOrganizerRelations,
} from "./organizer/history";
import { MailRepository } from "./mailboxes/store";
import { mailMigration, outstandingMigration } from "./mailboxes/model";
import { CollectionRepository } from "./collection/store";
import { collectionMigration } from "./collection/model";
import { ShippingRepository } from "./shipping/store";
import { shippingMigration } from "./shipping/model";
import { SellingRepository } from "./selling/store";
import { sellingMigration } from "./selling/model";
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
  private context = new AsyncLocalStorage<{ actor: string; method: string }>();
  withSource<T>(
    actor: string,
    method: string,
    fn: () => T,
    inherit = false,
  ): T {
    return this.context.run(
      {
        actor: inherit ? this.context.getStore()?.actor || actor : actor,
        method,
      },
      fn,
    );
  }
  readonly organizer = new OrganizerRepository(
    () => this.db,
    (fn) => this.mutate(fn),
    () => this,
  );
  exportBackup() {
    return this.db.export();
  }
  static async backupValidator() {
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    return (bytes: Uint8Array) => {
      if (bytes.byteLength > 128 * 1024 * 1024)
        throw Error("Backup exceeds 128 MiB.");
      const db = new SQL.Database(bytes);
      try {
        const v = Number(
          db.exec("SELECT MAX(version) FROM migrations")[0]?.values[0][0],
        );
        if (
          !Number.isInteger(v) ||
          v < 1 ||
          v > 12 ||
          !db.exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='orders'",
          ).length
        )
          throw Error("Unsupported Toolbox backup.");
        const required: [number, string, string[]][] = [
          [
            1,
            "orders",
            ["id", "name", "store", "category", "total", "status", "date"],
          ],
          [
            1,
            "collection",
            ["id", "name", "category", "quantity", "purchase", "market"],
          ],
          [
            2,
            "shipments",
            [
              "id",
              "tracking",
              "carrier",
              "status",
              "received",
              "subject",
              "orderId",
            ],
          ],
          [2, "inbox_account", ["id", "email", "auto", "lastSync"]],
          [3, "inbox_updates", ["id", "externalId", "subject", "orderId"]],
          [
            4,
            "expenses",
            ["id", "description", "amountCents", "date", "scheduleId"],
          ],
          [
            4,
            "expense_schedules",
            ["id", "anchorDate", "intervalMonths", "nextIndex", "active"],
          ],
          [5, "collection_settings", ["id", "connected"]],
          [5, "collection_quotes", ["id", "itemId", "valueCents"]],
          [6, "shipping_tasks", ["id", "name", "status"]],
          [7, "selling_units", ["id", "collectionId"]],
          [9, "mailboxes", ["id", "email", "host"]],
          [9, "outstanding_orders", ["id", "transactionId", "receivedQty"]],
          [11, "inbox_update_dismissals", ["externalId", "deletedAt"]],
          [
            12,
            "organizer_records",
            [
              "id",
              "kind",
              "data",
              "revision",
              "createdAt",
              "updatedAt",
              "deletedAt",
            ],
          ],
          [12, "toolbox_history", ["id", "patches", "undoable", "undoneAt"]],
        ];
        for (const [version, table, columns] of required)
          if (v >= version) {
            const names = (
              db.exec(`PRAGMA table_info(${table})`)[0]?.values || []
            ).map((r) => String(r[1]));
            if (columns.some((c) => !names.includes(c)))
              throw Error(
                "This file does not contain a complete Toolbox database.",
              );
          }
        if (v >= 12) {
          const rows =
            db.exec("SELECT kind,data FROM organizer_records")[0]?.values || [];
          for (const row of rows) {
            const schema = schemas[String(row[0]) as keyof typeof schemas];
            if (!schema) throw Error("Unknown organizer record in backup.");
            schema.strip().parse(JSON.parse(String(row[1])));
          }
        }
        if (
          db.exec("PRAGMA integrity_check")[0]?.values[0][0] !== "ok" ||
          db.exec("PRAGMA foreign_key_check").length
        )
          throw Error("Backup integrity check failed.");
      } finally {
        db.close();
      }
    };
  }
  private changeListeners = new Set<() => void>();
  onChange(listener: () => void) {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }
  private changed() {
    for (const listener of [...this.changeListeners]) {
      try {
        listener();
      } catch {
        /* A view notification must never undo a saved transaction. */
      }
    }
  }
  readonly mail = new MailRepository(
    () => this.db,
    (fn) => this.mutate(fn),
  );
  readonly selling = new SellingRepository(
    () => this.db,
    (fn) => this.mutate(fn),
  );
  readonly shipping = new ShippingRepository(
    () => this.db,
    (fn) => this.mutate(fn),
  );
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
    // v0.7 only added separate entry tables; retain them when rolling back.
    if (Number(version) > 12) throw new Error("Unsupported database version");
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
    if (Number(version) < 6) {
      if (
        this.path &&
        Number(version) > 0 &&
        !existsSync(this.path + ".pre-shipping-v5.bak")
      )
        writeFileSync(this.path + ".pre-shipping-v5.bak", this.db.export(), {
          flag: "wx",
          mode: 0o600,
        });
      this.db.run("BEGIN;" + shippingMigration);
      // Existing connected accounts immediately become eligible for sales checks.
      const account = this.inboxAccount();
      if (account) this.shipping.bindAccountInTransaction(account.email);
      this.db.run("INSERT INTO migrations VALUES(6); COMMIT;");
      this.persist();
    }
    if (Number(version) < 7) {
      if (
        this.path &&
        Number(version) > 0 &&
        !existsSync(this.path + ".pre-selling-v6.bak")
      )
        writeFileSync(this.path + ".pre-selling-v6.bak", this.db.export(), {
          flag: "wx",
          mode: 0o600,
        });
      this.db.run(
        "BEGIN;" +
          sellingMigration +
          "INSERT INTO migrations VALUES(7); COMMIT;",
      );
      this.persist();
    }
    if (Number(version) < 9) {
      if (
        this.path &&
        Number(version) > 0 &&
        !existsSync(this.path + ".pre-mailboxes-v8.bak")
      )
        writeFileSync(this.path + ".pre-mailboxes-v8.bak", this.db.export(), {
          flag: "wx",
          mode: 0o600,
        });
      this.db.run(
        "BEGIN;" + mailMigration + "INSERT INTO migrations VALUES(9);COMMIT;",
      );
      this.persist();
    }
    if (Number(version) < 10) {
      if (
        this.path &&
        Number(version) > 0 &&
        !existsSync(this.path + ".pre-outstanding-v9.bak")
      )
        writeFileSync(this.path + ".pre-outstanding-v9.bak", this.db.export(), {
          flag: "wx",
          mode: 0o600,
        });
      this.db.run(
        "BEGIN;" +
          outstandingMigration +
          "INSERT INTO migrations VALUES(10);COMMIT;",
      );
      this.persist();
    }
    if (Number(version) < 11) {
      if (
        this.path &&
        Number(version) > 0 &&
        !existsSync(this.path + ".pre-inbox-deletion-v10.bak")
      )
        writeFileSync(
          this.path + ".pre-inbox-deletion-v10.bak",
          this.db.export(),
          { flag: "wx", mode: 0o600 },
        );
      this.db.run(
        "BEGIN; CREATE TABLE IF NOT EXISTS inbox_update_dismissals(externalId TEXT PRIMARY KEY,deletedAt TEXT NOT NULL); INSERT INTO migrations VALUES(11); COMMIT;",
      );
      this.persist();
    }
    if (Number(version) < 12) {
      if (
        this.path &&
        Number(version) > 0 &&
        !existsSync(this.path + ".pre-organizer-v11.bak")
      )
        writeFileSync(this.path + ".pre-organizer-v11.bak", this.db.export(), {
          flag: "wx",
          mode: 0o600,
        });
      this.db.run(
        "BEGIN;" +
          organizerMigration +
          "INSERT INTO migrations VALUES(12);COMMIT;",
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
    this.mutate(() => {
      this.db.run("INSERT INTO orders VALUES(?,?,?,?,?,?,?)", [
        randomUUID(),
        o.name,
        o.store,
        o.category,
        o.total,
        o.status,
        o.date,
      ]);
    });
    return this.snapshot();
  }
  updateOrder(input: unknown) {
    const { id, item } = z
      .object({ id: z.string().uuid(), item: orderSchema })
      .strict()
      .parse(input);
    this.mutate(() => {
      if (!this.snapshot().orders.some((o) => o.id === id))
        throw Error("Order missing");
      this.db.run(
        "UPDATE orders SET name=?,store=?,category=?,total=?,status=?,date=? WHERE id=?",
        [
          item.name,
          item.store,
          item.category,
          item.total,
          item.status,
          item.date,
          id,
        ],
      );
    });
    return this.snapshot();
  }
  deleteOrder(input: unknown) {
    const id = z.string().uuid().parse(input);
    this.mutate(() => {
      if (!this.snapshot().orders.some((o) => o.id === id))
        throw Error("Order missing");
      this.db.run("DELETE FROM orders WHERE id=?", [id]);
    });
    return this.snapshot();
  }
  private mutate<T>(fn: () => T): T {
    const before = this.db.export();
    const oldRows = capture(this.db);
    this.db.run("BEGIN");
    try {
      const result = fn();
      validateOrganizerRelations(this.db);
      const context = this.context.getStore();
      recordHistory(
        this.db,
        oldRows,
        context?.method
          .replace(/^toolbox:/, " ")
          .replaceAll("-", " ")
          .trim() || "Background update",
        context?.actor || "Background",
        undoMethods.has(context?.method || ""),
      );
      this.db.run("COMMIT");
      this.persist();
      this.changed();
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
      this.db.run(
        "INSERT OR REPLACE INTO inbox_account(id,email,auto) VALUES(1,?,0)",
        [email],
      );
      this.ingest(scan);
      this.shipping.bindAccountInTransaction(email);
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
        "INSERT INTO inbox_updates(id,externalId,subject,received,status,orderReference) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM inbox_update_dismissals WHERE externalId=?) ON CONFLICT(externalId) DO NOTHING",
        [
          randomUUID(),
          u.externalId,
          u.subject,
          u.received,
          u.status,
          u.orderReference,
          u.externalId,
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
    this.mutate(() => {
      this.db.run("DELETE FROM inbox_account");
      this.shipping.unbindAccountInTransaction();
    });
  }
  emailUpdates(): EmailUpdate[] {
    return this.rows("inbox_updates").sort((a, b) =>
      String(b.received).localeCompare(String(a.received)),
    ) as unknown as EmailUpdate[];
  }
  deleteEmailUpdate(input: unknown) {
    const id = z.string().uuid().parse(input);
    this.mutate(() => {
      const update = this.emailUpdates().find((u) => u.id === id);
      if (!update) throw Error("UPDATE_MISSING");
      this.db.run(
        "INSERT INTO inbox_update_dismissals(externalId,deletedAt) VALUES(?,?) ON CONFLICT(externalId) DO NOTHING",
        [update.externalId, new Date().toISOString()],
      );
      this.db.run("DELETE FROM inbox_updates WHERE id=?", [id]);
    });
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
    this.changeListeners.clear();
    this.db.close();
  }
}
