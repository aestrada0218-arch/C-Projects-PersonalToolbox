import { z } from "zod";
import { createHash } from "node:crypto";
import { listingConditions } from "../../src/selling-types";
export const environmentSchema = z.enum(["sandbox", "production"]);
export const connectionSchema = z
  .object({
    environment: environmentSchema,
    label: z.string().trim().min(1).max(80),
    clientId: z
      .string()
      .trim()
      .min(10)
      .max(200)
      .regex(/^[!-~]+$/),
    clientSecret: z
      .string()
      .trim()
      .min(10)
      .max(200)
      .regex(/^[!-~]+$/),
    refreshToken: z
      .string()
      .trim()
      .min(20)
      .max(2100)
      .regex(/^[!-~]+$/),
  })
  .strict()
  .refine(
    (value) => JSON.stringify(value).length <= 2400,
    "Credentials exceed Windows vault capacity.",
  );
export const connectionKey = (value: {
  environment: string;
  clientId: string;
  refreshToken: string;
}) =>
  createHash("sha256")
    .update(
      JSON.stringify([value.environment, value.clientId, value.refreshToken]),
    )
    .digest("hex");
export const photoUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const u = new URL(value);
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.port &&
        u.hostname.includes(".") &&
        !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) &&
        !/\.(?:local|localhost|internal)$/.test(u.hostname) &&
        !/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/.test(
          u.hostname,
        )
      );
    } catch {
      return false;
    }
  }, "Use a public HTTPS photo URL.");
const id = z.string().regex(/^\d{1,30}$/);
export const draftSchema = z
  .object({
    collectionId: z.string().uuid(),
    unitLabel: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(4000),
    priceCents: z.number().int().min(1).max(1000000000),
    condition: z.enum(listingConditions),
    conditionDescription: z.string().trim().max(1000),
    conditionDescriptors: z
      .array(
        z
          .object({
            name: id,
            values: z.array(id).max(20),
            additionalInfo: z.string().max(30).optional(),
          })
          .strict()
          .refine((v) => v.values.length > 0 || Boolean(v.additionalInfo)),
      )
      .max(10),
    aspects: z
      .record(
        z.string().trim().min(1).max(100),
        z.array(z.string().trim().min(1).max(200)).min(1).max(30),
      )
      .refine((v) => Object.keys(v).length <= 50),
    photoUrls: z.array(photoUrl).max(24),
    categoryId: z.union([id, z.literal("")]),
    locationKey: z.string().trim().max(100),
    fulfillmentPolicyId: z.union([id, z.literal("")]),
    paymentPolicyId: z.union([id, z.literal("")]),
    returnPolicyId: z.union([id, z.literal("")]),
    autoEndEbay: z.boolean(),
  })
  .strict();
export function publishReady(value: unknown) {
  const draft = draftSchema.parse(value);
  if (
    !draft.photoUrls.length ||
    ![
      draft.categoryId,
      draft.locationKey,
      draft.fulfillmentPolicyId,
      draft.paymentPolicyId,
      draft.returnPolicyId,
    ].every(Boolean)
  )
    throw Error("SELL_FIELDS");
  return draft;
}
export const unitId = z.string().uuid();
export function mercariId(value: string) {
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      !["www.mercari.com", "mercari.com"].includes(u.hostname) ||
      u.port ||
      u.username ||
      u.password
    )
      return null;
    return u.pathname.match(/^\/us\/item\/(m\d{5,20})\/?$/)?.[1] || null;
  } catch {
    return null;
  }
}
export function listingUrl(
  platform: "ebay" | "mercari",
  id: string,
  environment = "production",
) {
  if (platform === "mercari" && /^m\d{5,20}$/.test(id))
    return `https://www.mercari.com/us/item/${id}/`;
  if (platform === "ebay" && /^\d{1,30}$/.test(id))
    return `https://${environment === "sandbox" ? "www.sandbox.ebay.com" : "www.ebay.com"}/itm/${id}`;
  throw Error("SELL_URL");
}
export const sellingMigration = `
CREATE TABLE selling_units(id TEXT PRIMARY KEY,collectionId TEXT NOT NULL REFERENCES collection(id) ON DELETE RESTRICT,sku TEXT NOT NULL UNIQUE,draftJson TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,
 environment TEXT CHECK(environment IN('sandbox','production')),connectionKey TEXT,offerId TEXT,ebayListingId TEXT,ebayState TEXT NOT NULL DEFAULT 'draft' CHECK(ebayState IN('draft','prepared','active','inactive','uncertain','sold')),
 mercariId TEXT UNIQUE,mercariState TEXT NOT NULL DEFAULT 'unlinked' CHECK(mercariState IN('unlinked','active','inactive','sold')),soldOn TEXT CHECK(soldOn IN('ebay','mercari')),soldAt TEXT,saleReference TEXT,conflict INTEGER NOT NULL DEFAULT 0,conflictReviewed INTEGER NOT NULL DEFAULT 0,error TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
CREATE UNIQUE INDEX selling_ebay_listing ON selling_units(environment,ebayListingId) WHERE ebayListingId IS NOT NULL;
CREATE UNIQUE INDEX selling_offer ON selling_units(environment,offerId) WHERE offerId IS NOT NULL;
CREATE TABLE selling_events(eventId TEXT PRIMARY KEY,unitId TEXT NOT NULL REFERENCES selling_units(id) ON DELETE RESTRICT,platform TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE selling_settings(id INTEGER PRIMARY KEY CHECK(id=1),connected INTEGER NOT NULL DEFAULT 0,environment TEXT NOT NULL DEFAULT 'sandbox',label TEXT NOT NULL DEFAULT '',connectionKey TEXT,automatic INTEGER NOT NULL DEFAULT 1,optionsJson TEXT NOT NULL DEFAULT '{"locations":[],"fulfillment":[],"payment":[],"returns":[]}',lastSync TEXT,nextSync TEXT,cooldownUntil INTEGER NOT NULL DEFAULT 0,error TEXT,cycleStart TEXT,cycleEnd TEXT,cycleOffset INTEGER NOT NULL DEFAULT 0);
INSERT INTO selling_settings(id) VALUES(1);
`;
