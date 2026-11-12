import { z } from "zod";
export const cents = z.number().int().min(0).max(1000000000);
export const referenceUrl = z
  .string()
  .max(2048)
  .url()
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "Use an HTTPS link.")
  .nullable();
export const imageData = z
  .string()
  .max(500000)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
  .nullable();
export const manualSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(80),
    collectionType: z.enum(["cards", "comics", "other"]),
    quantity: z.number().int().min(1).max(100000),
    purchaseCents: cents,
    valueCents: cents.nullable(),
    referenceUrl,
    imageData,
  })
  .strict();
export const apiKeySchema = z
  .string()
  .trim()
  .min(10)
  .max(256)
  .regex(/^[!-~]+$/);
export const searchSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(2)
      .max(2048)
      .refine((s) => Boolean(tcgProductId(s)) || s.length <= 200),
    game: z.string().max(100),
    offset: z.number().int().min(0).max(100000),
  })
  .strict();
export function tcgProductId(value: string): string | null {
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      !["www.tcgplayer.com", "tcgplayer.com"].includes(u.hostname) ||
      u.username ||
      u.password ||
      u.port
    )
      return null;
    return u.pathname.match(/^\/product\/(\d{1,12})(?:\/|$)/)?.[1] || null;
  } catch {
    return null;
  }
}
export function tcgUrl(id: string | null) {
  return id && /^\d{1,12}$/.test(id)
    ? "https://www.tcgplayer.com/product/" + id
    : null;
}
export function allowedTcgNavigation(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      ["www.tcgplayer.com", "tcgplayer.com"].includes(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.port
    );
  } catch {
    return false;
  }
}
export const collectionMigration = `ALTER TABLE collection ADD COLUMN collectionType TEXT NOT NULL DEFAULT 'other' CHECK(collectionType IN('cards','comics','other'));
ALTER TABLE collection ADD COLUMN provider TEXT NOT NULL DEFAULT 'manual' CHECK(provider IN('manual','justtcg'));
ALTER TABLE collection ADD COLUMN cardId TEXT;
ALTER TABLE collection ADD COLUMN variantId TEXT;
ALTER TABLE collection ADD COLUMN productId TEXT;
ALTER TABLE collection ADD COLUMN conditionName TEXT NOT NULL DEFAULT '';
ALTER TABLE collection ADD COLUMN printing TEXT NOT NULL DEFAULT '';
ALTER TABLE collection ADD COLUMN language TEXT NOT NULL DEFAULT '';
ALTER TABLE collection ADD COLUMN setName TEXT NOT NULL DEFAULT '';
ALTER TABLE collection ADD COLUMN referenceUrl TEXT;
ALTER TABLE collection ADD COLUMN imageData TEXT;
ALTER TABLE collection ADD COLUMN marketKnown INTEGER NOT NULL DEFAULT 1;
ALTER TABLE collection ADD COLUMN lastKnownCents INTEGER;
ALTER TABLE collection ADD COLUMN priceState TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE collection ADD COLUMN observedAt TEXT;
ALTER TABLE collection ADD COLUMN checkedAt TEXT;
ALTER TABLE collection ADD COLUMN priceError TEXT;
UPDATE collection SET lastKnownCents=ROUND(market*100);
CREATE TABLE collection_quotes(id TEXT PRIMARY KEY,itemId TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,valueCents INTEGER,state TEXT NOT NULL,checkedAt TEXT NOT NULL,observedAt TEXT,source TEXT NOT NULL);
CREATE INDEX collection_quote_item_date ON collection_quotes(itemId,checkedAt);
CREATE TABLE collection_settings(id INTEGER PRIMARY KEY CHECK(id=1),connected INTEGER NOT NULL DEFAULT 0,gamesJson TEXT NOT NULL DEFAULT '[]',cooldownUntil INTEGER NOT NULL DEFAULT 0,requestTimes TEXT NOT NULL DEFAULT '[]',dailyRemaining INTEGER,monthlyRemaining INTEGER);
INSERT INTO collection_settings(id) VALUES(1);`;
