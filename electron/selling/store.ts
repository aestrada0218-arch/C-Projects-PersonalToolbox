import type { Database, SqlValue } from "sql.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { draftSchema, unitId, mercariId } from "./model";
import type {
  EbayConnectionInput,
  ListingDraft,
  SellingUnit,
  SellingOptions,
  SellingSettings,
  SellingSale,
} from "../../src/selling-types";
const safeId = z.string().regex(/^\d{1,30}$/);
export class SellingRepository {
  constructor(
    private db: () => Database,
    private transaction: <T>(fn: () => T) => T,
  ) {}
  private rows(sql: string, args: SqlValue[] = []): Record<string, any>[] {
    const stmt = this.db().prepare(sql);
    try {
      stmt.bind(args);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }
  units(): SellingUnit[] {
    return this.rows(
      "SELECT * FROM selling_units ORDER BY createdAt DESC,id",
    ).map(({ draftJson, ...row }) => ({
      ...JSON.parse(draftJson),
      ...row,
      conflict: Boolean(row.conflict),
      conflictReviewed: Boolean(row.conflictReviewed),
    }));
  }
  get(input: unknown) {
    const id = unitId.parse(input),
      item = this.units().find((u) => u.id === id);
    if (!item) throw Error("SELL_MISSING");
    return item;
  }
  stock() {
    return this.rows(
      "SELECT c.id,c.name,c.quantity,COUNT(s.id) AS allocated FROM collection c LEFT JOIN selling_units s ON c.id=s.collectionId GROUP BY c.id ORDER BY c.name",
    ).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      quantity: Number(r.quantity),
      allocated: Number(r.allocated),
    }));
  }
  settings(supported = process.platform === "win32"): SellingSettings {
    const r = this.rows("SELECT * FROM selling_settings WHERE id=1")[0];
    return {
      connected: Boolean(r.connected),
      supported,
      environment: r.environment,
      label: r.label,
      connectionKey: r.connectionKey,
      automatic: Boolean(r.automatic),
      options: JSON.parse(r.optionsJson),
      lastSync: r.lastSync,
      nextSync: r.nextSync,
      cooldownUntil: r.cooldownUntil,
      error: r.error,
    };
  }
  connect(input: EbayConnectionInput, key: string, options: SellingOptions) {
    this.transaction(() => {
      const old = this.settings();
      this.db().run(
        "UPDATE selling_settings SET connected=1,environment=?,label=?,connectionKey=?,optionsJson=?,nextSync=NULL,error=NULL WHERE id=1",
        [input.environment, input.label, key, JSON.stringify(options)],
      );
      if (old.connectionKey !== key)
        this.db().run(
          "UPDATE selling_settings SET cycleStart=NULL,cycleEnd=NULL,cycleOffset=0,lastSync=NULL WHERE id=1",
        );
      for (const unit of this.units().filter(
        (u) =>
          u.offerId &&
          u.environment === input.environment &&
          !["inactive", "sold"].includes(u.ebayState),
      ))
        this.db().run("UPDATE selling_units SET connectionKey=? WHERE id=?", [
          key,
          unit.id,
        ]);
    });
  }
  disconnect() {
    this.transaction(() =>
      this.db().run(
        "UPDATE selling_settings SET connected=0,nextSync=NULL WHERE id=1",
      ),
    );
  }
  automatic(value: unknown) {
    const enabled = z.boolean().parse(value);
    this.transaction(() =>
      this.db().run(
        "UPDATE selling_settings SET automatic=?,nextSync=NULL WHERE id=1",
        [Number(enabled)],
      ),
    );
  }
  options(value: SellingOptions) {
    this.transaction(() =>
      this.db().run("UPDATE selling_settings SET optionsJson=? WHERE id=1", [
        JSON.stringify(value),
      ]),
    );
  }
  create(input: unknown) {
    const draft = draftSchema.parse(input),
      id = randomUUID(),
      now = new Date().toISOString();
    this.transaction(() => {
      const stock = this.stock().find((i) => i.id === draft.collectionId);
      if (!stock || stock.allocated >= stock.quantity)
        throw Error("SELL_STOCK");
      this.db().run(
        "INSERT INTO selling_units(id,collectionId,sku,draftJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
        [
          id,
          draft.collectionId,
          "PT-" + id.replace(/-/g, ""),
          JSON.stringify(draft),
          now,
          now,
        ],
      );
    });
    return id;
  }
  edit(input: unknown) {
    const { id, draft } = z
      .object({ id: unitId, draft: draftSchema })
      .strict()
      .parse(input);
    this.transaction(() => {
      const old = this.get(id);
      if (old.soldOn || !["draft", "prepared"].includes(old.ebayState))
        throw Error("SELL_LOCKED");
      if (old.collectionId !== draft.collectionId) throw Error("SELL_STOCK");
      this.db().run(
        "UPDATE selling_units SET draftJson=?,revision=revision+1,ebayState='draft',error=NULL,updatedAt=? WHERE id=?",
        [JSON.stringify(draft), new Date().toISOString(), id],
      );
    });
  }
  addPhoto(input: unknown, url: string) {
    const old = this.get(input);
    const draft = draftSchema.parse({
      ...this.draft(old),
      photoUrls: [...old.photoUrls, url],
    });
    this.edit({ id: old.id, draft });
  }
  draft(unit: SellingUnit): ListingDraft {
    return draftSchema.parse(
      Object.fromEntries(
        Object.keys(draftSchema.shape).map((k) => [k, (unit as any)[k]]),
      ),
    );
  }
  remove(input: unknown) {
    const item = this.get(input);
    if (item.offerId || item.mercariId || item.soldOn)
      throw Error("SELL_LOCKED");
    this.transaction(() =>
      this.db().run("DELETE FROM selling_units WHERE id=?", [item.id]),
    );
  }
  patch(
    input: unknown,
    fields: Partial<
      Pick<
        SellingUnit,
        | "environment"
        | "connectionKey"
        | "offerId"
        | "ebayListingId"
        | "ebayState"
        | "error"
      >
    >,
  ) {
    const item = this.get(input);
    const keys = Object.keys(fields);
    if (
      keys.some(
        (k) =>
          ![
            "environment",
            "connectionKey",
            "offerId",
            "ebayListingId",
            "ebayState",
            "error",
          ].includes(k),
      )
    )
      throw Error("SELL_FIELDS");
    this.transaction(() =>
      this.db().run(
        `UPDATE selling_units SET ${keys.map((k) => k + "=?").join(",")},revision=revision+1,updatedAt=? WHERE id=?`,
        [
          ...keys.map((k) => (fields as any)[k] ?? null),
          new Date().toISOString(),
          item.id,
        ],
      ),
    );
  }
  linkMercari(input: unknown) {
    const { id, url } = z
        .object({ id: unitId, url: z.string().max(2048) })
        .strict()
        .parse(input),
      mid = mercariId(url);
    if (!mid) throw Error("SELL_URL");
    const unit = this.get(id);
    if (unit.soldOn || (unit.mercariId && unit.mercariState !== "inactive"))
      throw Error("SELL_LOCKED");
    if (
      this.units().some((other) => other.id !== id && other.mercariId === mid)
    )
      throw Error("SELL_MATCH");
    this.transaction(() =>
      this.db().run(
        "UPDATE selling_units SET mercariId=?,mercariState='active',revision=revision+1,updatedAt=? WHERE id=?",
        [mid, new Date().toISOString(), id],
      ),
    );
  }
  inactiveMercari(input: unknown) {
    const { id, expectedId, confirmed } = z
      .object({
        id: unitId,
        expectedId: z.string().regex(/^m\d{5,20}$/),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(input);
    const unit = this.get(id);
    if (
      unit.mercariId !== expectedId ||
      unit.mercariState !== "active" ||
      !confirmed
    )
      throw Error("SELL_MATCH");
    this.transaction(() =>
      this.db().run(
        "UPDATE selling_units SET mercariState='inactive',revision=revision+1,updatedAt=? WHERE id=?",
        [new Date().toISOString(), id],
      ),
    );
  }
  private sale(
    unit: SellingUnit,
    platform: "ebay" | "mercari",
    reference: string,
    at: string,
    eventId: string,
  ) {
    if (
      this.rows("SELECT eventId FROM selling_events WHERE eventId=?", [eventId])
        .length
    )
      return;
    const conflict = Boolean(unit.soldOn && unit.soldOn !== platform);
    this.db().run("INSERT INTO selling_events VALUES(?,?,?,?)", [
      eventId,
      unit.id,
      platform,
      at,
    ]);
    this.db().run(
      `UPDATE selling_units SET soldOn=COALESCE(soldOn,?),soldAt=COALESCE(soldAt,?),saleReference=COALESCE(saleReference,?),${platform === "ebay" ? "ebayState='sold'" : "mercariState='sold'"},conflict=MAX(conflict,?),revision=revision+1,updatedAt=? WHERE id=?`,
      [
        platform,
        at,
        reference,
        Number(conflict),
        new Date().toISOString(),
        unit.id,
      ],
    );
  }
  mercariSale(input: unknown) {
    const { id, expectedId, reference } = z
      .object({
        id: unitId,
        expectedId: z.string().regex(/^m\d{5,20}$/),
        reference: z.string().trim().max(80),
      })
      .strict()
      .parse(input);
    this.transaction(() => {
      const unit = this.get(id);
      if (unit.mercariId !== expectedId || unit.mercariState !== "active")
        throw Error("SELL_MATCH");
      this.sale(
        unit,
        "mercari",
        reference || expectedId,
        new Date().toISOString(),
        "mercari:" + expectedId,
      );
    });
    return id;
  }
  reviewConflict(input: unknown) {
    const item = this.get(input);
    if (!item.conflict) throw Error("SELL_MATCH");
    this.transaction(() =>
      this.db().run("UPDATE selling_units SET conflictReviewed=1 WHERE id=?", [
        item.id,
      ]),
    );
  }
  cooldown(until: number) {
    this.transaction(() =>
      this.db().run(
        "UPDATE selling_settings SET cooldownUntil=MAX(cooldownUntil,?),nextSync=? WHERE id=1",
        [until, new Date(until).toISOString()],
      ),
    );
  }
  syncError(message: string) {
    this.transaction(() =>
      this.db().run(
        "UPDATE selling_settings SET error=?,nextSync=? WHERE id=1",
        [message, new Date(Date.now() + 300000).toISOString()],
      ),
    );
  }
  cycle() {
    return this.rows(
      "SELECT cycleStart,cycleEnd,cycleOffset FROM selling_settings WHERE id=1",
    )[0] as {
      cycleStart: string | null;
      cycleEnd: string | null;
      cycleOffset: number;
    };
  }
  page(
    sales: SellingSale[],
    start: string,
    end: string,
    offset: number,
    more: boolean,
  ) {
    this.transaction(() => {
      const settings = this.settings();
      for (const sale of sales) {
        safeId.parse(sale.listingId);
        const unit = this.units().find(
          (u) =>
            u.environment === settings.environment &&
            u.connectionKey === settings.connectionKey &&
            u.ebayListingId === sale.listingId &&
            u.sku === sale.sku,
        );
        if (!unit) continue;
        if (sale.quantity !== 1) {
          this.db().run("UPDATE selling_units SET error=? WHERE id=?", [
            "Unexpected eBay quantity. Review this order manually.",
            unit.id,
          ]);
          continue;
        }
        this.sale(
          unit,
          "ebay",
          sale.orderId,
          sale.at,
          "ebay:" + settings.environment + ":" + sale.eventId,
        );
      }
      this.db().run(
        "UPDATE selling_settings SET cycleStart=?,cycleEnd=?,cycleOffset=?,lastSync=?,nextSync=?,error=NULL WHERE id=1",
        [
          more ? start : null,
          more ? end : null,
          more ? offset : 0,
          more ? settings.lastSync : end,
          new Date(Date.now() + (more ? 60000 : 300000)).toISOString(),
        ],
      );
    });
  }
}
