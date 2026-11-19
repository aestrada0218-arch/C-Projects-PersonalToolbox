import { z } from "zod";
import { calendarDate } from "../expenses/model";
import { imageData, referenceUrl } from "../collection/model";
const text = z.string().trim().max(1000),
  name = z.string().trim().min(1).max(200);
const id = z.string().uuid(),
  optionalId = id.nullable(),
  date = calendarDate.nullable();
const cents = z.number().int().min(0).max(1000000000),
  qty = z.number().int().min(1).max(100000);
export const schemas = {
  line: z.object({
    orderId: id,
    description: name,
    quantity: qty,
    unitCents: cents,
  }),
  receipt: z.object({
    lineId: id,
    packageId: optionalId,
    quantity: qty,
    date: calendarDate,
  }),
  package: z.object({
    orderId: id,
    carrier: z.enum(["UPS", "USPS", "FedEx", "DHL", "Other"]),
    tracking: z.string().trim().max(100),
    status: z.enum([
      "Awaiting shipment",
      "In transit",
      "Delivered",
      "Exception",
    ]),
    expectedDate: date,
    actualDate: date,
    notes: text,
  }),
  return: z.object({
    orderId: id,
    reason: name,
    deadline: date,
    expectedCents: cents,
    refundedCents: cents,
    status: z.enum([
      "Requested",
      "Returning",
      "Refund pending",
      "Refunded",
      "Cancelled",
    ]),
    notes: text,
  }),
  details: z.object({
    collectionId: id,
    series: text,
    issue: z.string().trim().max(80),
    coverArtist: text,
    variant: text,
    printing: z.string().trim().max(100),
    condition: z.string().trim().max(100),
    grade: z.string().trim().max(80),
    certification: z.string().trim().max(100),
    location: text,
    notes: text,
  }),
  wishlist: z.object({
    name,
    section: z.enum(["cards", "comics", "other"]),
    category: z.string().trim().max(80),
    maxPriceCents: cents.nullable(),
    referenceUrl,
    notes: text,
  }),
  sale: z.object({
    collectionId: id,
    quantity: qty,
    date: calendarDate,
    marketplace: z.string().trim().min(1).max(80),
    reference: z.string().trim().max(150),
    grossCents: cents,
    purchaseShippingCents: cents,
    purchaseTaxCents: cents,
    feesCents: cents,
    postageCents: cents,
    salesTaxCents: cents,
    refundCents: cents,
    payoutCents: cents.nullable(),
    notes: text,
  }),
  budget: z.object({
    category: z.string().trim().min(1).max(80),
    amountCents: cents,
  }),
  reminder: z.object({
    title: name,
    date: calendarDate,
    completed: z.boolean(),
    notes: text,
  }),
  attachment: z.object({
    targetType: z.enum(["order", "collection"]),
    targetId: id,
    name: z.string().trim().min(1).max(120),
    data: z.union([
      imageData.unwrap(),
      z
        .string()
        .max(2800000)
        .regex(/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/),
    ]),
  }),
};
export const saveSchema = z
  .object({
    id: id.nullable(),
    revision: z.number().int().positive().nullable(),
    kind: z.enum([
      "line",
      "receipt",
      "package",
      "return",
      "details",
      "wishlist",
      "sale",
      "budget",
      "reminder",
      "attachment",
    ]),
    data: z.unknown(),
  })
  .strict();
export const organizerMigration = `CREATE TABLE IF NOT EXISTS organizer_records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,deletedAt TEXT);
CREATE INDEX IF NOT EXISTS organizer_kind ON organizer_records(kind,deletedAt);
CREATE TABLE IF NOT EXISTS toolbox_history(id TEXT PRIMARY KEY,label TEXT NOT NULL,actor TEXT NOT NULL,createdAt TEXT NOT NULL,undoable INTEGER NOT NULL,undoneAt TEXT,summary TEXT NOT NULL,patches TEXT NOT NULL);`;
export function saleTotals(
  data: Record<string, any>,
  unitPurchaseCents: number,
) {
  const basisCents =
    unitPurchaseCents * data.quantity +
    data.purchaseShippingCents +
    data.purchaseTaxCents;
  const expectedPayoutCents =
    data.grossCents -
    data.feesCents -
    data.postageCents -
    data.salesTaxCents -
    data.refundCents;
  return {
    basisCents,
    expectedPayoutCents,
    profitCents: expectedPayoutCents - basisCents,
    payoutDifferenceCents:
      data.payoutCents === null ? null : data.payoutCents - expectedPayoutCents,
  };
}
export function carrierLink(data: Record<string, any>) {
  const number = z.string().trim().min(1).max(100).parse(data.tracking),
    encoded = encodeURIComponent(number);
  const urls: Record<string, string> = {
    UPS: `https://www.ups.com/track?tracknum=${encoded}`,
    USPS: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`,
    FedEx: `https://www.fedex.com/fedextrack/?trknbr=${encoded}`,
    DHL: `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${encoded}`,
  };
  if (!urls[data.carrier])
    throw Error("Use the carrier's website for this tracking number.");
  return urls[data.carrier];
}
