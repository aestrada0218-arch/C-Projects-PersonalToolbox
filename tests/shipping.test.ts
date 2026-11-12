import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import initSqlJs from "sql.js";
import { Store } from "../electron/database";
import { InboxService } from "../electron/inbox/service";
import { extractEbaySale, extractShipBy } from "../electron/shipping/extract";
import { shippingInput, localToday } from "../electron/shipping/model";
import { makeShippingV5 } from "./legacy-collection";
import type {
  SaleEmailEvent,
  SalesScan,
  SalesCursor,
  ShippingTask,
} from "../src/shipping-types";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const email = "seller@example.invalid";
const secret = { email, appPassword: "abcdefghijklmnop" };
const received = "2026-10-01T12:00:00.000Z";
const subject = "You made the sale for Example Championship Card";
const text =
  "Great news—your item has sold!\nYour buyer has paid and now it’s time to get a shipping label.\nShip by:\nOct 02, 2026\nOrder number: 12-34567-89012\nExample Buyer\n123 Demo Street";
const sale = (overrides: Partial<SaleEmailEvent> = {}): SaleEmailEvent => ({
  externalId: hash("message-1"),
  name: "Example Championship Card",
  orderReference: "12-34567-89012",
  shipBy: "2026-10-02",
  paymentStatus: "Paid",
  subject,
  received,
  ...overrides,
});
const scan = (sales = [sale()], lastUid = 10, limited = false): SalesScan => ({
  sales,
  scanned: sales.length,
  skipped: 0,
  limited,
  cursor: { uidValidity: "100", lastUid },
});
const edit = (item: ShippingTask) => ({
  name: item.name,
  orderReference: item.orderReference,
  shipBy: item.shipBy,
  status: item.status,
  paymentStatus: item.paymentStatus,
  notes: item.notes,
});
const emptyInbox = { events: [], scanned: 0, skipped: 0, limited: false };
afterEach(() => vi.useRealTimers());
it("recognizes a seller sale notice and explicit ship-by date without retaining a buyer address or raw body", () => {
  const parsed = extractEbaySale({
    subject,
    text,
    senders: ["ebay@ebay.com"],
    received,
    externalId: hash("message-1"),
  });
  expect(parsed).toEqual(sale());
  expect(JSON.stringify(parsed)).not.toContain("123 Demo Street");
  expect(JSON.stringify(parsed)).not.toContain("Example Buyer");
});
it("accepts inline forwarded eBay sale headers but rejects lookalike senders and quoted cancellations/buyer receipts", () => {
  const forwarded = `---------- Forwarded message ---------\nFrom: eBay <ebay@ebay.com>\nDate: Thu, Oct 1, 2026\nSubject: ${subject}\nTo: Seller <${email}>\n\n${text}`;
  expect(
    extractEbaySale({
      subject: "Fwd: sale notice",
      text: forwarded,
      senders: [email],
      received,
      externalId: hash("message-1"),
    }),
  ).toEqual(sale());
  for (const invalid of [
    { subject, text, senders: ["ebay@ebay.com.evil.invalid"] },
    { subject, text, senders: ["ebay@notebay.com"] },
    { subject: "Your order was cancelled", text, senders: ["ebay@ebay.com"] },
    { subject: "Refund issued", text: forwarded, senders: [email] },
    { subject: "Your order is confirmed", text, senders: ["ebay@ebay.com"] },
    {
      subject: "New items to buy",
      text: "Find your next favorite today",
      senders: ["ebay@ebay.com"],
    },
  ])
    expect(
      extractEbaySale({ ...invalid, received, externalId: hash("bad") }),
    ).toBeNull();
});
it("flags missing dates and unpaid/unclear payments without inventing a deadline from handling time", () => {
  const input = {
    subject,
    text: "Your buyer has not yet paid. Ship within 30 days.",
    senders: ["ebay@ebay.com"],
    received,
    externalId: hash("missing"),
  };
  expect(extractEbaySale(input)).toMatchObject({
    shipBy: null,
    orderReference: null,
    paymentStatus: "Awaiting payment",
  });
  expect(
    extractEbaySale({ ...input, text: "Great news—your item has sold!" }),
  ).toMatchObject({ shipBy: null, paymentStatus: "Needs review" });
});
it("validates calendar deadlines and explicit US/month-name formats including leap days", () => {
  for (const value of [
    "Ship by: Oct 02, 2026",
    "Ship by\nFriday, October 2, 2026",
    "Ship by: 10/02/2026",
    "Ship by: 2026-10-02",
  ])
    expect(extractShipBy(value)).toBe("2026-10-02");
  expect(extractShipBy("Ship by: February 29, 2028")).toBe("2028-02-29");
  for (const value of [
    "Ship by: Feb 29, 2026",
    "Ship by: tomorrow",
    "Ship by: Octopus 2, 2026",
    "Order date: Oct 02, 2026",
    "Ship within 30 days",
  ])
    expect(extractShipBy(value)).toBeNull();
  expect(
    shippingInput.safeParse({
      name: "Sale",
      orderReference: null,
      shipBy: "2026-02-30",
      status: "Needs Shipment",
      paymentStatus: "Paid",
      notes: "",
    }).success,
  ).toBe(false);
  expect(localToday(new Date(2026, 9, 2, 23, 45))).toBe("2026-10-02");
});
it("deduplicates message IDs and order references, upgrades unedited notices and preserves manual edits and shipped status", async () => {
  const db = await Store.open();
  try {
    db.connectInbox(email, emptyInbox);
    expect(
      db.shipping.ingest(
        email,
        scan([sale({ paymentStatus: "Awaiting payment", shipBy: null })]),
      ),
    ).toBe(1);
    expect(db.shipping.ingest(email, scan())).toBe(0); // same message
    expect(
      db.shipping.ingest(
        email,
        scan(
          [
            sale({
              externalId: hash("paid"),
              received: "2026-10-02T12:00:00.000Z",
            }),
          ],
          11,
        ),
      ),
    ).toBe(0);
    let item = db.shipping.items()[0];
    expect(item).toMatchObject({
      shipBy: "2026-10-02",
      paymentStatus: "Paid",
      status: "Needs Shipment",
    });
    db.shipping.edit({
      id: item.id,
      item: {
        ...edit(item),
        name: "My corrected item",
        shipBy: "2026-10-05",
        notes: "Use rigid mailer",
      },
    });
    db.shipping.ingest(
      email,
      scan(
        [
          sale({
            externalId: hash("repeat"),
            shipBy: "2026-10-03",
            received: "2026-10-03T12:00:00.000Z",
          }),
        ],
        12,
      ),
    );
    item = db.shipping.items()[0];
    expect(item).toMatchObject({
      name: "My corrected item",
      shipBy: "2026-10-05",
      notes: "Use rigid mailer",
    });
    db.shipping.edit({
      id: item.id,
      item: { ...edit(item), status: "Shipped" },
    });
    db.shipping.ingest(
      email,
      scan(
        [
          sale({
            externalId: hash("later"),
            received: "2026-10-04T12:00:00.000Z",
          }),
        ],
        13,
      ),
    );
    expect(db.shipping.items()).toHaveLength(1);
    expect(db.shipping.items()[0]).toMatchObject({
      status: "Shipped",
      completedAt: expect.any(String),
    });
    expect(db.snapshot().tasks).toHaveLength(3);
  } finally {
    db.close();
  }
});
it("retains deleted-sale tombstones across restart, mailbox resets and Gmail disconnect without blocking a distinct order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-sales-")),
    path = join(dir, "data.sqlite");
  let db = await Store.open(path);
  try {
    db.connectInbox(email, emptyInbox);
    db.shipping.ingest(email, scan());
    const id = db.shipping.items()[0].id;
    db.shipping.remove(id);
    db.disconnectInbox();
    db.close();
    db = await Store.open(path);
    db.connectInbox(email, emptyInbox);
    expect(
      db.shipping.ingest(email, {
        ...scan([sale(), sale({ externalId: hash("new notice") })], 50),
        cursor: { uidValidity: "999", lastUid: 50 },
      }),
    ).toBe(0);
    expect(db.shipping.items()).toHaveLength(0);
    expect(
      db.shipping.ingest(
        email,
        scan(
          [
            sale({
              externalId: hash("different order"),
              orderReference: "22-34567-89012",
            }),
          ],
          51,
        ),
      ),
    ).toBe(1);
    expect(db.shipping.items()).toHaveLength(1);
    expect(readFileSync(path).includes(Buffer.from(secret.appPassword))).toBe(
      false,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("scopes receipts to the Gmail account and keeps existing tasks when accounts change", async () => {
  const db = await Store.open();
  try {
    db.connectInbox(email, emptyInbox);
    db.shipping.ingest(email, scan());
    db.connectInbox("other@example.invalid", emptyInbox);
    expect(db.shipping.cursor()).toEqual({ uidValidity: null, lastUid: 0 });
    expect(db.shipping.items()).toHaveLength(1);
    expect(db.shipping.ingest("other@example.invalid", scan())).toBe(1);
    expect(db.shipping.items()).toHaveLength(2);
  } finally {
    db.close();
  }
});
it("validates a whole sales batch before changing tasks, receipts or the mailbox cursor", async () => {
  const db = await Store.open();
  try {
    db.connectInbox(email, emptyInbox);
    expect(() =>
      db.shipping.ingest(
        email,
        scan([
          sale(),
          sale({ externalId: hash("invalid"), shipBy: "2026-02-30" }),
        ]),
      ),
    ).toThrow();
    expect(db.shipping.items()).toHaveLength(0);
    expect(db.shipping.cursor().lastUid).toBe(0);
    expect(db.shipping.ingest(email, scan())).toBe(1);
  } finally {
    db.close();
  }
});
it("rolls back task and receipt writes together on SQLite failure", async () => {
  const db = await Store.open();
  try {
    db.connectInbox(email, emptyInbox);
    (db as any).db.run(
      "CREATE TRIGGER reject_test BEFORE INSERT ON shipping_tasks WHEN NEW.name='Reject this item' BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    );
    expect(() =>
      db.shipping.ingest(
        email,
        scan([
          sale(),
          sale({
            externalId: hash("second"),
            orderReference: "22-34567-89012",
            name: "Reject this item",
          }),
        ]),
      ),
    ).toThrow();
    expect(db.shipping.items()).toHaveLength(0);
    expect(db.shipping.cursor().lastUid).toBe(0);
    expect(db.shipping.ingest(email, scan())).toBe(1);
  } finally {
    db.close();
  }
});
function fixtures(db: Store) {
  db.connectInbox(email, emptyInbox);
  const vault = {
    read: vi.fn(async () => secret),
    write: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  const provider = {
    scan: vi.fn(async () => emptyInbox),
    scanSales: vi.fn(async (_secret: typeof secret, _cursor: SalesCursor) =>
      scan(),
    ),
    cancel: vi.fn(),
  };
  return {
    vault,
    provider,
    service: new InboxService(db, vault, provider, true),
  };
}
it("checks sales every three hours independently of incoming-shipment opt-in, and catches up after reopening", async () => {
  const db = await Store.open(),
    f = fixtures(db);
  let second: InboxService | undefined;
  try {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
    f.service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.provider.scanSales).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(179 * 60000);
    expect(f.provider.scanSales).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.provider.scanSales).toHaveBeenCalledTimes(2);
    expect(f.provider.scan).not.toHaveBeenCalled();
    expect(db.shipping.items()).toHaveLength(1);
    f.service.stop();
    await vi.advanceTimersByTimeAsync(4 * 3600000);
    second = new InboxService(db, f.vault, f.provider, true);
    second.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.provider.scanSales).toHaveBeenCalledTimes(3);
  } finally {
    f.service.stop();
    second?.stop();
    db.close();
  }
});
it("pauses automatic sales checks, honors a two-hour interval, and allows an explicit manual check", async () => {
  const db = await Store.open(),
    f = fixtures(db);
  try {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
    db.shipping.configure({ enabled: false, intervalHours: 2 });
    f.service.start();
    await vi.advanceTimersByTimeAsync(8 * 3600000);
    expect(f.provider.scanSales).not.toHaveBeenCalled();
    expect((await f.service.refreshSales()).ok).toBe(true);
    expect(f.provider.scanSales).toHaveBeenCalledTimes(1);
    f.service.setShippingMonitor({ enabled: true, intervalHours: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.provider.scanSales).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * 3600000);
    expect(f.provider.scanSales).toHaveBeenCalledTimes(3);
  } finally {
    f.service.stop();
    db.close();
  }
});
it("serializes Gmail operations, cancels an active scan on close, and does not ingest after shutdown", async () => {
  const db = await Store.open(),
    f = fixtures(db);
  try {
    let finish!: (s: SalesScan) => void;
    f.provider.scanSales.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.service.refreshSales();
    await Promise.resolve();
    await Promise.resolve();
    expect((await f.service.refreshSales()).error).toContain("already running");
    expect((await f.service.refresh()).error).toContain("already running");
    f.service.stop();
    expect(f.provider.cancel).toHaveBeenCalled();
    finish(scan());
    expect((await pending).ok).toBe(false);
    expect(db.shipping.items()).toHaveLength(0);
  } finally {
    f.service.stop();
    db.close();
  }
});
it("keeps tasks/cursor after failed scans, redacts credentials and waits for the next scheduled retry", async () => {
  const db = await Store.open(),
    f = fixtures(db);
  try {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
    db.shipping.ingest(email, scan());
    f.provider.scanSales.mockRejectedValueOnce(
      Object.assign(Error(secret.appPassword), { authenticationFailed: true }),
    );
    const result = await f.service.refreshSales();
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret.appPassword);
    expect(result.error).toContain("Gmail rejected");
    expect(db.shipping.cursor().lastUid).toBe(10);
    expect(db.shipping.items()).toHaveLength(1);
    f.service.start();
    await vi.advanceTimersByTimeAsync(179 * 60000);
    expect(f.provider.scanSales).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.provider.scanSales).toHaveBeenCalledTimes(2);
  } finally {
    f.service.stop();
    db.close();
  }
});
it("continues a bounded backlog after one minute instead of waiting three hours", async () => {
  const db = await Store.open(),
    f = fixtures(db);
  try {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
    f.provider.scanSales.mockResolvedValueOnce(scan([sale()], 100, true));
    f.provider.scanSales.mockResolvedValueOnce(scan([], 101));
    f.service.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.provider.scanSales).toHaveBeenCalledTimes(2);
    expect(f.provider.scanSales.mock.calls[1][1]).toEqual({
      uidValidity: "100",
      lastUid: 100,
    });
  } finally {
    f.service.stop();
    db.close();
  }
});
it("migrates v0.4.1 with an existing Gmail account without changing purchases, collection, or expenses", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-sales-migrate-")),
    path = join(dir, "data.sqlite");
  let db = await Store.open(path);
  try {
    db.connectInbox(email, emptyInbox);
    db.setInboxAuto(true);
    const before = db.snapshot();
    db.close();
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const legacy = new SQL.Database(readFileSync(path));
    makeShippingV5(legacy);
    writeFileSync(path, legacy.export());
    legacy.close();
    db = await Store.open(path);
    expect(db.snapshot()).toEqual(before);
    expect(db.inboxAccount()).toMatchObject({ email, auto: true });
    expect(db.shipping.items()).toHaveLength(0);
    expect(db.shipping.monitor()).toMatchObject({
      enabled: true,
      intervalHours: 3,
    });
    expect(existsSync(path + ".pre-shipping-v5.bak")).toBe(true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
