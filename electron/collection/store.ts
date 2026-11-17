import type { Database, SqlValue } from "sql.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  OwnedCollectible,
  PricingSettings,
  CatalogCard,
  CatalogVariant,
  QuoteObservation,
} from "../../src/collection-types";
import { manualSchema, tcgUrl, cents, imageData } from "./model";
export class CollectionRepository {
  constructor(
    private db: () => Database,
    private transaction: <T>(fn: () => T) => T,
  ) {}
  private rows(sql: string, args: SqlValue[] = []) {
    const statement = this.db().prepare(sql);
    try {
      statement.bind(args);
      const rows: Record<string, SqlValue>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }
  items(): OwnedCollectible[] {
    return this.rows("SELECT * FROM collection ORDER BY name,id").map((r) => ({
      id: String(r.id),
      purchaseDate: r.purchaseDate === null ? null : String(r.purchaseDate),
      name: String(r.name),
      category: String(r.category),
      collectionType: r.collectionType,
      quantity: Number(r.quantity),
      purchaseCents: Math.round(Number(r.purchase) * 100),
      valueCents: r.marketKnown ? Math.round(Number(r.market) * 100) : null,
      lastKnownCents:
        r.lastKnownCents === null ? null : Number(r.lastKnownCents),
      provider: r.provider,
      cardId: r.cardId,
      variantId: r.variantId,
      productId: r.productId,
      condition: r.conditionName,
      printing: r.printing,
      language: r.language,
      setName: r.setName,
      referenceUrl: r.referenceUrl,
      imageData: r.imageData,
      state: r.priceState,
      observedAt: r.observedAt,
      checkedAt: r.checkedAt,
      error: r.priceError,
    })) as OwnedCollectible[];
  }
  settings(supported = process.platform === "win32"): PricingSettings {
    const r = this.rows("SELECT * FROM collection_settings WHERE id=1")[0];
    return {
      connected: Boolean(r.connected),
      supported,
      games: JSON.parse(String(r.gamesJson)),
      cooldownUntil: Number(r.cooldownUntil),
      dailyRemaining:
        r.dailyRemaining === null ? null : Number(r.dailyRemaining),
      monthlyRemaining:
        r.monthlyRemaining === null ? null : Number(r.monthlyRemaining),
    };
  }
  configure(games: { id: string; name: string }[]) {
    this.transaction(() =>
      this.db().run(
        "UPDATE collection_settings SET connected=1,gamesJson=? WHERE id=1",
        [JSON.stringify(games)],
      ),
    );
  }
  disconnect() {
    this.transaction(() =>
      this.db().run(
        "UPDATE collection_settings SET connected=0,gamesJson='[]',dailyRemaining=NULL,monthlyRemaining=NULL WHERE id=1",
      ),
    );
  }
  reserveRequest(now = Date.now()) {
    const r = this.rows(
      "SELECT cooldownUntil,requestTimes FROM collection_settings WHERE id=1",
    )[0];
    if (Number(r.cooldownUntil) > now) throw Error("PRICE_RATE_LIMIT");
    const times = (JSON.parse(String(r.requestTimes)) as number[]).filter(
      (t) => t > now - 60000,
    );
    if (times.length >= 10) throw Error("PRICE_RATE_LIMIT");
    this.transaction(() =>
      this.db().run(
        "UPDATE collection_settings SET requestTimes=? WHERE id=1",
        [JSON.stringify([...times, now])],
      ),
    );
  }
  cooldown(until: number) {
    this.transaction(() =>
      this.db().run(
        "UPDATE collection_settings SET cooldownUntil=MAX(cooldownUntil,?) WHERE id=1",
        [until],
      ),
    );
  }
  usage(daily: number | null, monthly: number | null) {
    this.transaction(() =>
      this.db().run(
        "UPDATE collection_settings SET dailyRemaining=?,monthlyRemaining=? WHERE id=1",
        [daily, monthly],
      ),
    );
  }
  addManual(input: unknown) {
    const item = manualSchema.parse(input);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db().run(
        "INSERT INTO collection(id,name,category,quantity,purchase,market,collectionType,provider,referenceUrl,imageData,marketKnown,lastKnownCents,priceState,checkedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          item.name,
          item.category,
          item.quantity,
          item.purchaseCents / 100,
          (item.valueCents ?? 0) / 100,
          item.collectionType,
          "manual",
          item.referenceUrl,
          item.imageData,
          Number(item.valueCents !== null),
          item.valueCents,
          item.valueCents === null ? "unpriced" : "manual",
          item.valueCents === null ? null : now,
        ],
      );
      if (item.valueCents !== null)
        this.observe(id, item.valueCents, "manual", now, null, "Manual");
    });
    return id;
  }
  addLinked(
    card: CatalogCard,
    variant: CatalogVariant,
    input: { quantity: number; purchaseCents: number },
  ) {
    const { quantity, purchaseCents } = z
      .object({
        quantity: z.number().int().min(1).max(100000),
        purchaseCents: cents,
      })
      .strict()
      .parse(input);
    const id = randomUUID();
    this.transaction(() => {
      this.db().run(
        "INSERT INTO collection(id,name,category,quantity,purchase,market,collectionType,provider,cardId,variantId,productId,conditionName,printing,language,setName,referenceUrl,marketKnown,lastKnownCents,priceState,observedAt,checkedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          card.name,
          card.game,
          quantity,
          purchaseCents / 100,
          (variant.valueCents ?? variant.lastKnownCents ?? 0) / 100,
          "cards",
          "justtcg",
          card.id,
          variant.id,
          card.productId,
          variant.condition,
          variant.printing,
          variant.language,
          card.setName,
          tcgUrl(card.productId),
          Number(variant.valueCents !== null),
          variant.valueCents ?? variant.lastKnownCents,
          variant.state,
          variant.observedAt,
          card.checkedAt,
        ],
      );
      this.observe(
        id,
        variant.valueCents,
        variant.state,
        card.checkedAt,
        variant.observedAt,
        "JustTCG",
      );
    });
    return id;
  }
  edit(input: unknown) {
    const { id, item } = z
      .object({ id: z.string().uuid(), item: manualSchema })
      .strict()
      .parse(input);
    const old = this.items().find((i) => i.id === id);
    if (!old) throw Error("Item missing");
    this.transaction(() => {
      const allocated = Number(
        this.rows(
          "SELECT COUNT(*) AS total FROM selling_units WHERE collectionId=?",
          [id],
        )[0]?.total || 0,
      );
      if (item.quantity < allocated) throw Error("COLLECTION_ALLOCATED");
      if (old.provider === "justtcg") {
        // Catalog identity and price stay bound to the exact variant; only ownership fields/photo can change.
        this.db().run(
          "UPDATE collection SET quantity=?,purchase=?,imageData=? WHERE id=?",
          [item.quantity, item.purchaseCents / 100, item.imageData, id],
        );
      } else {
        const now = new Date().toISOString();
        this.db().run(
          "UPDATE collection SET name=?,category=?,collectionType=?,quantity=?,purchase=?,market=?,marketKnown=?,lastKnownCents=?,priceState=?,referenceUrl=?,imageData=?,checkedAt=?,priceError=NULL WHERE id=?",
          [
            item.name,
            item.category,
            item.collectionType,
            item.quantity,
            item.purchaseCents / 100,
            (item.valueCents ?? old.lastKnownCents ?? 0) / 100,
            Number(item.valueCents !== null),
            item.valueCents ?? old.lastKnownCents,
            item.valueCents === null ? "unpriced" : "manual",
            item.referenceUrl,
            item.imageData,
            now,
            id,
          ],
        );
        if (item.valueCents !== old.valueCents)
          this.observe(
            id,
            item.valueCents,
            item.valueCents === null ? "unpriced" : "manual",
            now,
            null,
            "Manual",
          );
      }
    });
  }
  remove(id: unknown) {
    const allocated = Number(
      this.rows(
        "SELECT COUNT(*) AS total FROM selling_units WHERE collectionId=?",
        [z.string().uuid().parse(id)],
      )[0]?.total || 0,
    );
    if (allocated) throw Error("COLLECTION_ALLOCATED");
    const key = z.string().uuid().parse(id);
    this.transaction(() =>
      this.db().run("DELETE FROM collection WHERE id=?", [key]),
    );
  }
  quote(id: string, variant: CatalogVariant, checkedAt: string) {
    const old = this.items().find((i) => i.id === id);
    if (!old || old.variantId !== variant.id || old.provider !== "justtcg")
      throw Error("Variant mismatch");
    this.transaction(() => {
      this.db().run(
        "UPDATE collection SET market=?,marketKnown=?,lastKnownCents=?,priceState=?,observedAt=?,checkedAt=?,priceError=NULL WHERE id=?",
        [
          (variant.valueCents ??
            variant.lastKnownCents ??
            old.lastKnownCents ??
            0) / 100,
          Number(variant.valueCents !== null),
          variant.valueCents ?? variant.lastKnownCents ?? old.lastKnownCents,
          variant.state,
          variant.observedAt,
          checkedAt,
          id,
        ],
      );
      this.observe(
        id,
        variant.valueCents,
        variant.state,
        checkedAt,
        variant.observedAt,
        "JustTCG",
      );
    });
  }
  error(id: string, message: string) {
    this.transaction(() =>
      this.db().run("UPDATE collection SET priceError=? WHERE id=?", [
        message,
        id,
      ]),
    );
  }
  private observe(
    itemId: string,
    valueCents: number | null,
    state: string,
    checkedAt: string,
    observedAt: string | null,
    source: string,
  ) {
    this.db().run("INSERT INTO collection_quotes VALUES(?,?,?,?,?,?,?)", [
      randomUUID(),
      itemId,
      valueCents,
      state,
      checkedAt,
      observedAt,
      source,
    ]);
  }
  history(id: unknown): QuoteObservation[] {
    const key = z.string().uuid().parse(id);
    return this.rows(
      "SELECT * FROM collection_quotes WHERE itemId=? ORDER BY checkedAt DESC,id DESC LIMIT 100",
      [key],
    ) as unknown as QuoteObservation[];
  }
}
