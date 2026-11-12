import { z } from "zod";
import { shippingStatuses, paymentStatuses } from "../../src/shipping-types";
export const shippingDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const date = new Date(s + "T12:00:00Z");
    return (
      !isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === s &&
      s >= "1900-01-01" &&
      s <= "2199-12-31"
    );
  });
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export const shippingInput = z
  .object({
    name: z.string().trim().min(1).max(240),
    orderReference: z.string().trim().min(1).max(80).nullable(),
    shipBy: shippingDate.nullable(),
    status: z.enum(shippingStatuses),
    paymentStatus: z.enum(paymentStatuses),
    notes: z.string().trim().max(2000),
  })
  .strict();
export const saleEventSchema = z
  .object({
    externalId: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().trim().min(1).max(240),
    orderReference: z
      .string()
      .regex(/^\d{2}-\d{5}-\d{5}$/)
      .nullable(),
    shipBy: shippingDate.nullable(),
    paymentStatus: z.enum(paymentStatuses),
    subject: z.string().max(200),
    received: z.string().datetime({ offset: true }),
  })
  .strict();
export const cursorSchema = z
  .object({
    uidValidity: z
      .string()
      .regex(/^\d{1,20}$/)
      .nullable(),
    lastUid: z.number().int().min(0).max(4294967295),
  })
  .strict();
export const monitorInput = z
  .object({
    enabled: z.boolean(),
    intervalHours: z.union([
      z.literal(2),
      z.literal(3),
      z.literal(6),
      z.literal(12),
    ]),
  })
  .strict();
export const shippingMigration = `
CREATE TABLE shipping_tasks(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,orderReference TEXT,shipBy TEXT,
 status TEXT NOT NULL CHECK(status IN ('Needs Shipment','Shipped','Cancelled')),
 paymentStatus TEXT NOT NULL CHECK(paymentStatus IN ('Paid','Awaiting payment','Needs review')),
 notes TEXT NOT NULL DEFAULT '',source TEXT NOT NULL CHECK(source IN ('ebay-email','manual')),
 sourceSubject TEXT,received TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,editedAt TEXT,completedAt TEXT
);
CREATE INDEX shipping_due ON shipping_tasks(status,shipBy);
CREATE TABLE shipping_receipts(accountHash TEXT NOT NULL,sourceKey TEXT NOT NULL,taskId TEXT REFERENCES shipping_tasks(id) ON DELETE SET NULL,PRIMARY KEY(accountHash,sourceKey));
CREATE TABLE shipping_monitor(
 id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),intervalHours INTEGER NOT NULL DEFAULT 3 CHECK(intervalHours IN(2,3,6,12)),
 accountHash TEXT,uidValidity TEXT,lastUid INTEGER NOT NULL DEFAULT 0,lastAttempt TEXT,lastSuccess TEXT,nextRun TEXT,error TEXT,
 scanned INTEGER NOT NULL DEFAULT 0,skipped INTEGER NOT NULL DEFAULT 0,limited INTEGER NOT NULL DEFAULT 0
);
INSERT INTO shipping_monitor(id) VALUES(1);
`;
