import type { Database } from "sql.js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  SalesCursor,
  SalesScan,
  ShippingTask,
  ShippingMonitor,
} from "../../src/shipping-types";
import {
  shippingInput,
  saleEventSchema,
  cursorSchema,
  monitorInput,
} from "./model";
export const accountHash = (email: string) =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
export class ShippingRepository {
  constructor(
    private db: () => Database,
    private transaction: <T>(fn: () => T) => T,
  ) {}
  private rows(sql: string, params: (string | number | null)[] = []) {
    const statement = this.db().prepare(sql);
    try {
      statement.bind(params);
      const rows: Record<string, any>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }
  items(): ShippingTask[] {
    return this.rows(
      "SELECT * FROM shipping_tasks ORDER BY CASE WHEN shipBy IS NULL THEN 1 ELSE 0 END,shipBy,createdAt",
    ) as ShippingTask[];
  }
  monitor(): ShippingMonitor {
    const {
      accountHash: _,
      uidValidity: _v,
      lastUid: _u,
      id: _id,
      ...settings
    } = this.rows("SELECT * FROM shipping_monitor WHERE id=1")[0];
    return {
      ...settings,
      enabled: Boolean(settings.enabled),
      limited: Boolean(settings.limited),
    } as ShippingMonitor;
  }
  cursor(): SalesCursor {
    const row = this.rows(
      "SELECT uidValidity,lastUid FROM shipping_monitor WHERE id=1",
    )[0];
    return { uidValidity: row.uidValidity, lastUid: row.lastUid };
  }
  cursorForAccount(email: string): SalesCursor {
    const row = this.rows(
      "SELECT accountHash,uidValidity,lastUid FROM shipping_monitor WHERE id=1",
    )[0];
    return row.accountHash === accountHash(email)
      ? { uidValidity: row.uidValidity, lastUid: row.lastUid }
      : { uidValidity: null, lastUid: 0 };
  }
  // These two methods participate in Store's existing account transaction.
  bindAccountInTransaction(email: string) {
    const hash = accountHash(email);
    const old = this.rows(
      "SELECT accountHash FROM shipping_monitor WHERE id=1",
    )[0].accountHash;
    if (old !== hash)
      this.db().run(
        "UPDATE shipping_monitor SET accountHash=?,uidValidity=NULL,lastUid=0,lastAttempt=NULL,lastSuccess=NULL,nextRun=NULL,error=NULL,scanned=0,skipped=0,limited=0 WHERE id=1",
        [hash],
      );
  }
  unbindAccountInTransaction() {
    this.db().run(
      "UPDATE shipping_monitor SET accountHash=NULL,uidValidity=NULL,lastUid=0,lastAttempt=NULL,lastSuccess=NULL,nextRun=NULL,error=NULL,scanned=0,skipped=0,limited=0 WHERE id=1",
    );
  }
  beginAttempt(email: string, now = new Date()) {
    this.transaction(() => {
      this.bindAccountInTransaction(email);
      this.db().run(
        "UPDATE shipping_monitor SET lastAttempt=?,nextRun=?,error=NULL WHERE id=1",
        [
          now.toISOString(),
          new Date(
            now.getTime() + this.monitor().intervalHours * 3600000,
          ).toISOString(),
        ],
      );
    });
    return this.cursor();
  }
  fail(message: string) {
    this.transaction(() =>
      this.db().run("UPDATE shipping_monitor SET error=? WHERE id=1", [
        message.slice(0, 500),
      ]),
    );
  }
  configure(input: unknown) {
    const value = monitorInput.parse(input);
    this.transaction(() =>
      this.db().run(
        "UPDATE shipping_monitor SET enabled=?,intervalHours=?,nextRun=? WHERE id=1",
        [
          Number(value.enabled),
          value.intervalHours,
          value.enabled ? new Date().toISOString() : null,
        ],
      ),
    );
  }
  add(input: unknown) {
    const item = shippingInput.parse(input);
    const id = randomUUID(),
      now = new Date().toISOString();
    this.transaction(() =>
      this.db().run(
        "INSERT INTO shipping_tasks(id,name,orderReference,shipBy,status,paymentStatus,notes,source,received,createdAt,updatedAt,editedAt,completedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          item.name,
          item.orderReference,
          item.shipBy,
          item.status,
          item.paymentStatus,
          item.notes,
          "manual",
          now,
          now,
          now,
          now,
          item.status === "Shipped" ? now : null,
        ],
      ),
    );
    return id;
  }
  edit(input: unknown) {
    const { id, item } = z
      .object({ id: z.string().uuid(), item: shippingInput })
      .strict()
      .parse(input);
    this.transaction(() => {
      const old = this.items().find((t) => t.id === id);
      if (!old) throw Error("Task missing");
      const now = new Date().toISOString();
      this.db().run(
        "UPDATE shipping_tasks SET name=?,orderReference=?,shipBy=?,status=?,paymentStatus=?,notes=?,updatedAt=?,editedAt=?,completedAt=? WHERE id=?",
        [
          item.name,
          item.orderReference,
          item.shipBy,
          item.status,
          item.paymentStatus,
          item.notes,
          now,
          now,
          item.status === "Shipped" ? old.completedAt || now : null,
          id,
        ],
      );
    });
  }
  remove(input: unknown) {
    const id = z.string().uuid().parse(input);
    this.transaction(() => {
      if (!this.items().some((i) => i.id === id)) throw Error("Task missing");
      // Foreign keys leave receipt tombstones. Rescanning a deleted sale must
      // not silently recreate work the user explicitly removed.
      this.db().run("DELETE FROM shipping_tasks WHERE id=?", [id]);
    });
  }
  ingest(email: string, input: SalesScan, now = new Date()) {
    const scan = z
      .object({
        sales: z.array(saleEventSchema).max(100),
        scanned: z.number().int().min(0).max(100),
        skipped: z.number().int().min(0).max(100),
        limited: z.boolean(),
        cursor: cursorSchema,
      })
      .strict()
      .parse(input);
    return this.transaction(() => {
      this.bindAccountInTransaction(email);
      const hash = accountHash(email);
      const previous = this.cursor();
      if (
        previous.uidValidity === scan.cursor.uidValidity &&
        scan.cursor.lastUid < previous.lastUid
      )
        throw Error("Invalid mailbox cursor");
      let added = 0;
      for (const sale of scan.sales) {
        const messageKey = "message:" + sale.externalId;
        const orderKey = sale.orderReference
          ? "order:" + sale.orderReference
          : null;
        const priorMessage = this.rows(
          "SELECT taskId FROM shipping_receipts WHERE accountHash=? AND sourceKey=?",
          [hash, messageKey],
        )[0];
        if (priorMessage) continue;
        const priorOrder = orderKey
          ? this.rows(
              "SELECT taskId FROM shipping_receipts WHERE accountHash=? AND sourceKey=?",
              [hash, orderKey],
            )[0]
          : undefined;
        let id = priorOrder?.taskId as string | null | undefined;
        if (!priorOrder) {
          id = randomUUID();
          this.db().run(
            "INSERT INTO shipping_tasks(id,name,orderReference,shipBy,status,paymentStatus,notes,source,sourceSubject,received,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            [
              id,
              sale.name,
              sale.orderReference,
              sale.shipBy,
              "Needs Shipment",
              sale.paymentStatus,
              "",
              "ebay-email",
              sale.subject,
              sale.received,
              now.toISOString(),
              now.toISOString(),
            ],
          );
          added++;
        } else if (id) {
          const item = this.items().find((t) => t.id === id);
          if (
            item &&
            !item.editedAt &&
            item.status === "Needs Shipment" &&
            sale.received >= item.received
          ) {
            this.db().run(
              "UPDATE shipping_tasks SET shipBy=COALESCE(?,shipBy),paymentStatus=?,sourceSubject=?,received=?,updatedAt=? WHERE id=?",
              [
                sale.shipBy,
                item.paymentStatus === "Paid" ? "Paid" : sale.paymentStatus,
                sale.subject,
                sale.received,
                now.toISOString(),
                id,
              ],
            );
          }
        }
        this.db().run(
          "INSERT INTO shipping_receipts(accountHash,sourceKey,taskId) VALUES(?,?,?)",
          [hash, messageKey, id || null],
        );
        if (orderKey && !priorOrder)
          this.db().run(
            "INSERT INTO shipping_receipts(accountHash,sourceKey,taskId) VALUES(?,?,?)",
            [hash, orderKey, id || null],
          );
      }
      this.db().run(
        "UPDATE shipping_monitor SET uidValidity=?,lastUid=?,lastSuccess=?,nextRun=?,error=NULL,scanned=?,skipped=?,limited=? WHERE id=1",
        [
          scan.cursor.uidValidity,
          scan.cursor.lastUid,
          now.toISOString(),
          new Date(
            now.getTime() +
              (scan.limited ? 60000 : this.monitor().intervalHours * 3600000),
          ).toISOString(),
          scan.scanned,
          scan.skipped,
          Number(scan.limited),
        ],
      );
      return added;
    });
  }
}
