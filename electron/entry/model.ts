import { z } from "zod";
import { createHash } from "node:crypto";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const field = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v));
export const profileSchema = z
  .object({
    email,
    first_name: field,
    last_name: field,
    address: field,
    city: field,
    state: z.string().trim().min(2).max(50),
    zip: z
      .string()
      .trim()
      .regex(/^\d{5}(?:-\d{4})?$/),
    label: z.string().trim().max(100),
  })
  .strict();
export function allowedEntryUrl(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.port &&
      !u.username &&
      !u.password &&
      ["thirdeyecomics.com", "eql.com"].some(
        (d) => u.hostname === d || u.hostname.endsWith("." + d),
      )
    );
  } catch {
    return false;
  }
}
export function productUrl(value: string) {
  try {
    const u = new URL(value);
    if (
      !allowedEntryUrl(value) ||
      u.hostname !== "shop.thirdeyecomics.com" ||
      !/^\/products\/[a-zA-Z0-9][a-zA-Z0-9-]{0,200}\/?$/.test(u.pathname)
    )
      return null;
    return u.origin + u.pathname.replace(/\/$/, "");
  } catch {
    return null;
  }
}
export const campaignSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    url: z
      .string()
      .max(2048)
      .transform((v) => productUrl(v) || "")
      .refine(Boolean),
    concurrency: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
    ]),
    browser: z.enum(["msedge", "chrome", "chromium"]),
    gmailSource: z.enum(["off", "inbox", "runner"]),
    senderDomains: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
      )
      .min(1)
      .max(10),
    onePerHousehold: z.boolean(),
  })
  .strict();
export function identity(profile: z.infer<typeof profileSchema>) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(
        /\b(street|avenue|road|drive|lane|boulevard|apartment|suite)\b/g,
        (v) =>
          ({
            street: "st",
            avenue: "ave",
            road: "rd",
            drive: "dr",
            lane: "ln",
            boulevard: "blvd",
            apartment: "apt",
            suite: "ste",
          })[v]!,
      )
      .replace(/[^a-z0-9]/g, "");
  const house = [profile.address, profile.city, profile.state, profile.zip]
    .map(normalize)
    .join("|");
  return {
    emailKey: hash(profile.email),
    personKey: hash(
      [normalize(profile.first_name), normalize(profile.last_name), house].join(
        "|",
      ),
    ),
    householdKey: hash(house),
  };
}
export const maskEmail = (value: string) => {
  const [name, domain] = value.split("@");
  return name.slice(0, 1) + "***@" + domain;
};
export const proxySchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    server: z
      .string()
      .trim()
      .max(250)
      .refine((value) => {
        try {
          const u = new URL(value);
          return (
            ["http:", "https:", "socks5:"].includes(u.protocol) &&
            Boolean(u.hostname) &&
            (Boolean(u.port) || ["http:", "https:"].includes(u.protocol)) &&
            Number(u.port || (u.protocol === "https:" ? "443" : "80")) >= 1 &&
            Number(u.port || (u.protocol === "https:" ? "443" : "80")) <=
              65535 &&
            !u.username &&
            !u.password &&
            ["", "/"].includes(u.pathname) &&
            !u.search &&
            !u.hash
          );
        } catch {
          return false;
        }
      }),
    username: z.string().max(200),
    password: z.string().max(300),
  })
  .strict()
  .refine(
    (v) => !v.server.startsWith("socks5:") || (!v.username && !v.password),
    "Authenticated SOCKS5 is not supported by Chromium. Use HTTP/HTTPS.",
  )
  .refine((v) => Boolean(v.username) === Boolean(v.password));
export const entryMigration = `
CREATE TABLE entry_campaigns(id TEXT PRIMARY KEY,productKey TEXT NOT NULL UNIQUE,configJson TEXT NOT NULL,createdAt TEXT NOT NULL,cooldownUntil INTEGER NOT NULL DEFAULT 0);
CREATE TABLE entry_proxies(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,server TEXT NOT NULL,authenticated INTEGER NOT NULL,health TEXT NOT NULL DEFAULT 'Unknown',checkedAt TEXT);
CREATE TABLE entry_jobs(id TEXT PRIMARY KEY,campaignId TEXT NOT NULL REFERENCES entry_campaigns(id) ON DELETE RESTRICT,number INTEGER NOT NULL,profileCipher BLOB NOT NULL,emailKey TEXT NOT NULL,personKey TEXT NOT NULL,householdKey TEXT NOT NULL,proxyId TEXT REFERENCES entry_proxies(id) ON DELETE RESTRICT,status TEXT NOT NULL DEFAULT 'Pending',stage TEXT NOT NULL DEFAULT 'Queued',note TEXT NOT NULL DEFAULT '',attempts INTEGER NOT NULL DEFAULT 0,submissionStartedAt TEXT,completedAt TEXT,confirmation TEXT,updatedAt TEXT NOT NULL,UNIQUE(campaignId,emailKey),UNIQUE(campaignId,personKey));
CREATE INDEX entry_job_queue ON entry_jobs(campaignId,status,number);
CREATE TABLE entry_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,campaignId TEXT NOT NULL REFERENCES entry_campaigns(id) ON DELETE CASCADE,jobId TEXT,at TEXT NOT NULL,message TEXT NOT NULL);
CREATE TABLE entry_code_receipts(messageKey TEXT PRIMARY KEY,jobId TEXT NOT NULL REFERENCES entry_jobs(id) ON DELETE RESTRICT);
CREATE TABLE entry_settings(id INTEGER PRIMARY KEY CHECK(id=1),runnerEmail TEXT);
INSERT INTO entry_settings(id) VALUES(1);
`;
