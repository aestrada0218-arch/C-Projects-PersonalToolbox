import { createHash } from "node:crypto";
import { z } from "zod";
import { calendarDate } from "../expenses/model";
import type { TrackingSummary } from "../../src/ship24-types";
export const keySchema = z
  .object({
    apiKey: z
      .string()
      .trim()
      .min(10)
      .max(256)
      .regex(/^[!-~]+$/),
  })
  .strict();
export const registrationSchema = z
  .object({
    source: z
      .object({
        type: z.enum(["package", "shipment"]),
        id: z.string().uuid(),
        signature: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    confirmed: z.literal(true),
    destinationCountryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    destinationPostCode: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9 _\-./]+$/)
      .nullable(),
    shippingDate: calendarDate.nullable(),
  })
  .strict();
export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const trackingNumber = (value: string) =>
  z
    .string()
    .min(5)
    .max(50)
    .regex(/^[A-Z0-9_./-]+$/)
    .parse(value.replace(/\s+/g, "").toUpperCase());
const text = z.string().max(1500).nullish(),
  date = (v: string | null | undefined) => {
    if (!v) return null;
    const d = v.slice(0, 10);
    return calendarDate.safeParse(d).success ? d : null;
  };
export const trackerSchema = z.object({
  trackerId: z.string().min(1).max(100),
  trackingNumber: z.string().max(100),
  clientTrackerId: z.string().max(100).nullish(),
  isSubscribed: z.boolean().optional(),
});
const entry = z.object({
  tracker: trackerSchema,
  shipment: z
    .object({
      statusMilestone: text,
      delivery: z
        .object({
          estimatedDeliveryDate: text,
          courierEstimatedDeliveryDate: z
            .object({ from: text, to: text })
            .nullish(),
        })
        .nullish(),
    })
    .nullish(),
  events: z
    .array(
      z.object({
        occurrenceDatetime: text,
        status: text,
        location: text,
        statusMilestone: text,
      }),
    )
    .max(2000)
    .optional(),
  statistics: z
    .object({ timestamps: z.object({ deliveredDatetime: text }).nullish() })
    .nullish(),
});
export function parseResults(
  raw: unknown,
  providerId: string,
  number: string,
  earliest: string | null,
): TrackingSummary {
  const rows = z
    .object({ data: z.object({ trackings: z.array(entry).max(20) }) })
    .parse(raw).data.trackings;
  if (!rows.length)
    return {
      status: null,
      milestone: "No results yet",
      estimatedDate: null,
      actualDate: null,
      events: [],
      shipmentCount: 0,
    };
  if (
    rows.some(
      (r) =>
        r.tracker.trackerId !== providerId ||
        trackingNumber(r.tracker.trackingNumber) !== number,
    )
  )
    throw Error("RESULT_MISMATCH");
  const milestones = rows.map((r) => r.shipment?.statusMilestone || "pending");
  const delivered = milestones.every((s) => s === "delivered");
  const exception = milestones.some((s) =>
    [
      "exception",
      "failed_attempt",
      "return",
      "returned",
      "lost",
      "cancelled",
    ].includes(s),
  );
  const status = delivered
    ? "Delivered"
    : exception
      ? "Exception"
      : milestones.some((s) =>
            [
              "in_transit",
              "out_for_delivery",
              "available_for_pickup",
              "delivered",
            ].includes(s),
          )
        ? "In transit"
        : milestones.every((s) =>
              ["pending", "info_received", "not_found"].includes(s),
            )
          ? null
          : "Awaiting shipment";
  const actualDates = rows.map(
    (r) =>
      date(r.statistics?.timestamps?.deliveredDatetime) ||
      date(
        r.events?.find((e) => e.statusMilestone === "delivered")
          ?.occurrenceDatetime,
      ),
  );
  const actualDate =
    delivered && actualDates.every(Boolean) ? actualDates.sort().at(-1)! : null;
  if (actualDate && earliest && actualDate < earliest)
    throw Error("RESULT_OLD");
  const estimates = rows
    .map(
      (r) =>
        date(r.shipment?.delivery?.courierEstimatedDeliveryDate?.to) ||
        date(r.shipment?.delivery?.estimatedDeliveryDate),
    )
    .filter(Boolean) as string[];
  const events = rows
    .flatMap((r) =>
      (r.events || []).map((e) => ({
        date: e.occurrenceDatetime || "",
        status: e.status || e.statusMilestone || "Update",
        location: e.location || "",
        milestone: e.statusMilestone || "",
      })),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);
  return {
    status,
    milestone:
      milestones.length === 1
        ? milestones[0]
        : `${milestones.length} shipments: ${milestones.join(", ")}`,
    estimatedDate: estimates.sort().at(-1) || null,
    actualDate,
    events,
    shipmentCount: rows.length,
  };
}
export const ship24Migration = `CREATE TABLE ship24_settings(id INTEGER PRIMARY KEY CHECK(id=1),connected INTEGER NOT NULL DEFAULT 0,connectionTag TEXT,autoEnabled INTEGER NOT NULL DEFAULT 0,monthlyCap INTEGER NOT NULL DEFAULT 10,cooldownUntil INTEGER NOT NULL DEFAULT 0,lastRequestAt INTEGER NOT NULL DEFAULT 0,nextPoll INTEGER NOT NULL DEFAULT 0);INSERT INTO ship24_settings(id) VALUES(1);
CREATE TABLE ship24_trackers(id TEXT PRIMARY KEY,connectionTag TEXT NOT NULL,fingerprint TEXT NOT NULL,clientTrackerId TEXT NOT NULL,payload TEXT NOT NULL,sources TEXT NOT NULL,phase TEXT NOT NULL,attempted INTEGER NOT NULL DEFAULT 0,providerId TEXT,month TEXT NOT NULL,createdAt TEXT NOT NULL,checkedAt TEXT,lastAttempt INTEGER NOT NULL DEFAULT 0,error TEXT,summary TEXT,UNIQUE(connectionTag,fingerprint));`;
