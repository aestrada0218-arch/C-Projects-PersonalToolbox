import { outstandingIds, expectedDateSchema } from "./model";
import type { Database, SqlValue } from "sql.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  MailboxAccount,
  MailboxInput,
  OutstandingLine,
  Receipt,
} from "../../src/mailbox-types";
export class MailRepository {
  constructor(
    private db: () => Database,
    private tx: <T>(f: () => T) => T,
  ) {}
  private rows(sql: string, args: SqlValue[] = []): any[] {
    const s = this.db().prepare(sql);
    try {
      s.bind(args);
      const rows = [];
      while (s.step()) rows.push(s.getAsObject());
      return rows;
    } finally {
      s.free();
    }
  }
  accounts(): MailboxAccount[] {
    return this.rows("SELECT * FROM mailboxes ORDER BY label,id").map((a) => ({
      ...a,
      enabled: !!a.enabled,
      limited: !!a.limited,
      legacy: false,
    }));
  }
  add(id: string, input: Omit<MailboxInput, "password">) {
    this.tx(() =>
      this.db().run(
        "INSERT INTO mailboxes(id,label,email,host,port,folder) VALUES(?,?,?,?,?,?)",
        [id, input.label, input.email, input.host, input.port, input.folder],
      ),
    );
  }
  remove(id: string) {
    z.string().uuid().parse(id);
    this.tx(() => {
      this.db().run("DELETE FROM mailboxes WHERE id=?", [id]);
      this.db().run("DELETE FROM mail_cursors WHERE accountId=?", [id]);
      this.db().run(
        "UPDATE outstanding_orders SET accountId=NULL WHERE accountId=?",
        [id],
      );
    });
  }
  enabled(id: string, value: boolean) {
    z.boolean().parse(value);
    this.tx(() =>
      this.db().run("UPDATE mailboxes SET enabled=? WHERE id=?", [
        Number(value),
        id,
      ]),
    );
  }
  cursor(id: string) {
    return (
      this.rows("SELECT * FROM mail_cursors WHERE accountId=?", [id])[0] || {
        validity: null,
        lastUid: 0,
      }
    );
  }
  lines(includeExcluded = false): OutstandingLine[] {
    return this.rows(
      "SELECT * FROM outstanding_orders " +
        (includeExcluded ? "" : "WHERE kind='item' AND deletedAt IS NULL ") +
        "ORDER BY purchaseDate DESC,transactionId,line",
    );
  }
  ingest(
    id: string,
    receipts: Receipt[],
    cursor: { validity: string; lastUid: number },
    stats: { scanned: number; skipped: number; limited: boolean },
  ) {
    return this.tx(() => {
      let added = 0;
      for (const r of receipts)
        for (const [i, l] of r.lines.entries()) {
          this.db().run(
            "INSERT OR IGNORE INTO outstanding_orders(id,transactionId,line,description,unitCents,quantity,amountCents,purchaseDate,kind,accountId) VALUES(?,?,?,?,?,?,?,?,?,?)",
            [
              randomUUID(),
              r.transactionId,
              i,
              l.description,
              l.unitCents,
              l.quantity,
              l.amountCents,
              r.purchaseDate,
              l.kind,
              id,
            ],
          );
          added += this.db().getRowsModified();
        }
      this.db().run(
        "INSERT INTO mail_cursors(accountId,validity,lastUid) VALUES(?,?,?) ON CONFLICT(accountId) DO UPDATE SET validity=excluded.validity,lastUid=excluded.lastUid",
        [id, cursor.validity, cursor.lastUid],
      );
      this.db().run(
        "UPDATE mail_cursors SET lastSync=?,scanned=?,skipped=?,limited=?,error=NULL WHERE accountId=?",
        [
          new Date().toISOString(),
          stats.scanned,
          stats.skipped,
          Number(stats.limited),
          id,
        ],
      );
      this.db().run(
        "UPDATE mailboxes SET lastSync=?,error=NULL,scanned=?,skipped=?,limited=? WHERE id=?",
        [
          new Date().toISOString(),
          stats.scanned,
          stats.skipped,
          Number(stats.limited),
          id,
        ],
      );
      return added;
    });
  }
  salesCursor(
    id: string,
    validity: string | null,
    lastUid: number,
    nextRun: string,
  ) {
    this.tx(() =>
      this.db().run(
        "UPDATE mail_cursors SET salesValidity=?,salesUid=?,salesNext=? WHERE accountId=?",
        [validity, lastUid, nextRun, id],
      ),
    );
  }
  resetSalesSchedule() {
    this.tx(() => this.db().run("UPDATE mail_cursors SET salesNext=NULL"));
  }
  error(
    id: string,
    message = "Could not complete a secure mailbox scan. Check credentials, IMAP settings and your connection.",
  ) {
    this.tx(() => {
      this.db().run("UPDATE mailboxes SET error=? WHERE id=?", [message, id]);
      this.db().run(
        "INSERT INTO mail_cursors(accountId,error) VALUES(?,?) ON CONFLICT(accountId) DO UPDATE SET error=excluded.error",
        [id, message],
      );
    });
  }
  private validateSelection(ids: string[]) {
    const visible = new Set(this.lines().map((l) => l.id));
    if (ids.some((id) => !visible.has(id))) throw Error("OUTSTANDING_MISSING");
  }
  setExpectedDate(input: unknown) {
    const { ids, expectedDate } = z
      .object({ ids: outstandingIds, expectedDate: expectedDateSchema })
      .strict()
      .parse(input);
    this.tx(() => {
      this.validateSelection(ids);
      for (const id of ids)
        this.db().run(
          "UPDATE outstanding_orders SET expectedDate=? WHERE id=?",
          [expectedDate, id],
        );
    });
  }
  deleteLines(input: unknown) {
    const { ids } = z
      .object({ ids: outstandingIds, confirmed: z.literal(true) })
      .strict()
      .parse(input);
    this.tx(() => {
      this.validateSelection(ids);
      const now = new Date().toISOString();
      for (const id of ids)
        this.db().run("UPDATE outstanding_orders SET deletedAt=? WHERE id=?", [
          now,
          id,
        ]);
    });
  }
  receive(input: unknown) {
    const { id, quantity, tab, requestId } = z
      .object({
        requestId: z.string().uuid(),
        id: z.string().uuid(),
        quantity: z.number().int().positive().max(100000),
        tab: z.enum(["cards", "comics", "other"]),
      })
      .strict()
      .parse(input);
    return this.tx(() => {
      const prior = this.rows(
        "SELECT * FROM outstanding_receipts WHERE requestId=?",
        [requestId],
      )[0];
      if (prior) {
        if (
          prior.lineId !== id ||
          prior.quantity !== quantity ||
          prior.tab !== tab
        )
          throw Error("RECEIVE_CONFLICT");
        return prior.collectionId;
      }
      const line = this.lines().find((l) => l.id === id);
      if (
        !line ||
        line.kind !== "item" ||
        quantity > line.quantity - line.receivedQty
      )
        throw Error("RECEIVE_INVALID");
      const itemId = randomUUID();
      this.db().run(
        "INSERT INTO collection(id,name,category,quantity,purchase,market,collectionType,provider,marketKnown,priceState,purchaseDate) VALUES(?,?,?,?,?,0,?,'manual',0,'unpriced',?)",
        [
          itemId,
          line.description,
          "Minky’s Designs",
          quantity,
          line.unitCents / 100,
          tab,
          line.purchaseDate,
        ],
      );
      this.db().run(
        "UPDATE outstanding_orders SET receivedQty=receivedQty+?,collectionId=? WHERE id=?",
        [quantity, itemId, id],
      );
      this.db().run("INSERT INTO outstanding_receipts VALUES(?,?,?,?,?)", [
        requestId,
        id,
        itemId,
        quantity,
        tab,
      ]);
      return itemId;
    });
  }
}
