import { describe, it, expect, vi } from "vitest";
import { simpleParser } from "mailparser";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMinkysReceipt } from "../electron/mailboxes/paypal";
import { Store } from "../electron/database";
import { MailboxService } from "../electron/mailboxes/service";
import { GmailImapProvider } from "../electron/inbox/gmail";
import type { ReceiptProvider } from "../electron/mailboxes/provider";
import type {
  CredentialVault,
  MailSecret,
} from "../electron/inbox/credentials";
export const body = `Payment from
Example Buyer
buyer@example.com
Payment to
Minky’s Designs
Minkysdesigns@gmail.com
Note to payment recipient
You haven't included a note.
Transaction ID
TESTPAYPAL00000001
Date
November 16, 2026
Payment Status
COMPLETED
Description
Unit price
Qty
Amount
ABSOLUTE BATMAN BEYOND ARK-M
#1 (ONE SHOT)
$3.99 USD
4
$15.96 USD
ABSOLUTE BATMAN BEYOND ARK-M
#1 (ONE SHOT)
$4.79 USD
2
$9.58 USD
FOC SHIPPING - $4.95 BASE RATE
$4.95 USD
1
$4.95 USD
Shipping and handling
$3.00 USD
Sales Tax
$1.48 USD
Discount
-$5.88 USD
Total
$34.97 USD
Payment
$29.09 USD`;
async function mail(text = body, from = "service@paypal.com") {
  return simpleParser(
    `From: PayPal <${from}>\r\nTo: buyer@example.com\r\nSubject: Payment receipt\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}`,
  );
}
const empty = {
  events: [],
  updates: [],
  scanned: 0,
  skipped: 0,
  limited: false,
};
function vault<T>(initial: T | null = null): CredentialVault<T> {
  let value = initial;
  return {
    read: async () => value,
    write: async (v) => {
      value = v;
    },
    remove: async () => {
      value = null;
    },
  };
}
async function idle(service: MailboxService) {
  for (let n = 0; n < 100; n++) {
    if (!service.state().busy) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Fixture timeout");
}
describe("Minky PayPal receipts", () => {
  it("extracts the screenshot line data, purchase date and charges without mistaking payment total for item prices", async () => {
    const receipt = parseMinkysReceipt(await mail())!;
    expect(receipt).toMatchObject({
      transactionId: "TESTPAYPAL00000001",
      purchaseDate: "2026-11-16",
    });
    expect(receipt.lines).toEqual([
      {
        description: "ABSOLUTE BATMAN BEYOND ARK-M #1 (ONE SHOT)",
        unitCents: 399,
        quantity: 4,
        amountCents: 1596,
        kind: "item",
      },
      {
        description: "ABSOLUTE BATMAN BEYOND ARK-M #1 (ONE SHOT)",
        unitCents: 479,
        quantity: 2,
        amountCents: 958,
        kind: "item",
      },
      {
        description: "FOC SHIPPING - $4.95 BASE RATE",
        unitCents: 495,
        quantity: 1,
        amountCents: 495,
        kind: "shipping",
      },
    ]);
  });
  it("supports HTML-only PayPal tables without loading remote resources", async () => {
    const html = body
      .split("\n")
      .map((t) => `<tr><td>${t}</td></tr>`)
      .join("");
    const parsed = await simpleParser(
      `From: service@paypal.com\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<table>${html}</table><img src="https://never-load.example/track">`,
    );
    expect(parseMinkysReceipt(parsed)?.lines).toHaveLength(3);
  });
  it("requires the exact sender, payee, completed status and internally consistent line amounts", async () => {
    for (const [text, from] of [
      [body, "service@paypal.com.evil.test"],
      [
        body.replace("Minkysdesigns@gmail.com", "other@gmail.com"),
        "service@paypal.com",
      ],
      [body.replace("Payment to", "Payment from"), "service@paypal.com"],
      [body.replace("COMPLETED", "REFUNDED"), "service@paypal.com"],
      [body.replace("$15.96", "$15.95"), "service@paypal.com"],
      [body.replace("TESTPAYPAL00000001", "?"), "service@paypal.com"],
    ])
      expect(parseMinkysReceipt(await mail(text, from))).toBeNull();
  });
});
describe("Outstanding persistence", () => {
  it("deduplicates across inboxes, receives partial quantities atomically and prevents duplicate move requests", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mail-receive-")),
      file = join(dir, "db.sqlite");
    let store = await Store.open(file);
    try {
      const receipt = parseMinkysReceipt(await mail())!;
      expect(
        store.mail.ingest(
          "inbox-a",
          [receipt],
          { validity: "1", lastUid: 1 },
          { scanned: 1, skipped: 0, limited: false },
        ),
      ).toBe(3);
      expect(
        store.mail.ingest(
          "inbox-b",
          [receipt],
          { validity: "2", lastUid: 20 },
          { scanned: 1, skipped: 0, limited: false },
        ),
      ).toBe(0);
      const line = store.mail.lines().find((l) => l.line === 0)!;
      const input = {
        id: line.id,
        quantity: 2,
        tab: "comics",
        requestId: randomUUID(),
      };
      const itemId = store.mail.receive(input);
      expect(store.mail.receive(input)).toBe(itemId);
      expect(
        store.mail.lines().find((l) => l.id === line.id)?.receivedQty,
      ).toBe(2);
      expect(
        store.collection.items().find((i) => i.id === itemId),
      ).toMatchObject({
        quantity: 2,
        purchaseCents: 399,
        purchaseDate: "2026-11-16",
        valueCents: null,
        collectionType: "comics",
      });
      expect(() => store.mail.receive({ ...input, quantity: 1 })).toThrow(
        "RECEIVE_CONFLICT",
      );
      expect(() =>
        store.mail.receive({ ...input, requestId: randomUUID(), quantity: 3 }),
      ).toThrow("RECEIVE_INVALID");
      store.close();
      store = await Store.open(file);
      expect(
        store.mail.lines().find((l) => l.id === line.id)?.receivedQty,
      ).toBe(2);
      store.mail.receive({ ...input, requestId: randomUUID(), quantity: 2 });
      expect(
        store.mail.lines().find((l) => l.id === line.id)?.receivedQty,
      ).toBe(4);
      store.mail.ingest(
        "inbox-a",
        [receipt],
        { validity: "1", lastUid: 1 },
        { scanned: 1, skipped: 0, limited: false },
      );
      expect(store.mail.lines()).toHaveLength(2);
      const shipping = store.mail
        .lines(true)
        .find((l) => l.kind === "shipping")!;
      expect(() =>
        store.mail.receive({
          ...input,
          id: shipping.id,
          requestId: randomUUID(),
          quantity: 1,
        }),
      ).toThrow("RECEIVE_INVALID");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("deletes orders while retaining and unlinking their email records", async () => {
    const db = await Store.open();
    try {
      const order = db.snapshot().orders[0];
      db.connectInbox("test@gmail.com", {
        events: [
          {
            tracking: "1Z999AA10123456784",
            carrier: "UPS",
            status: "In transit",
            subject: "Shipment",
            received: "2026-11-16T12:00:00Z",
          },
        ],
        scanned: 1,
        skipped: 0,
        limited: false,
      });
      db.applyShipment({ shipmentId: db.shipments()[0].id, orderId: order.id });
      db.deleteOrder(order.id);
      expect(
        db.snapshot().orders.find((o) => o.id === order.id),
      ).toBeUndefined();
      expect(db.shipments()[0].orderId).toBeNull();
      expect(() => db.deleteOrder(order.id)).toThrow("Order missing");
      expect(() => db.deleteOrder("'; DELETE FROM orders")).toThrow();
    } finally {
      db.close();
    }
  });
});
describe("Multiple IMAP accounts", () => {
  it("keeps credentials in separate vaults and retains imported purchases after disconnect", async () => {
    const scan = vi
        .spyOn(GmailImapProvider.prototype, "scan")
        .mockResolvedValue(empty),
      sales = vi
        .spyOn(GmailImapProvider.prototype, "scanSales")
        .mockResolvedValue({
          sales: [],
          scanned: 0,
          skipped: 0,
          limited: false,
          cursor: { uidValidity: "1", lastUid: 0 },
        });
    const dir = mkdtempSync(join(tmpdir(), "multi-mail-")),
      file = join(dir, "db.sqlite"),
      db = await Store.open(file),
      vaults = new Map<string, CredentialVault<MailSecret>>(),
      receipt = parseMinkysReceipt(await mail())!;
    const provider = {
      test: vi.fn(async () => {}),
      scan: vi.fn(async () => ({
        receipts: [receipt],
        cursor: { validity: "1", lastUid: 1 },
        scanned: 1,
        skipped: 0,
        limited: false,
      })),
      cancel: vi.fn(),
    } as unknown as ReceiptProvider;
    const getVault = (id: string) => {
      if (!vaults.has(id)) vaults.set(id, vault<MailSecret>());
      return vaults.get(id)!;
    };
    const service = new MailboxService(db, vault(), getVault, provider, true);
    try {
      for (let n = 0; n < 12; n++) {
        const result = await service.connect({
          label: "Account " + n,
          email: `person${n}@example.com`,
          host: "imap.example.com",
          port: 993,
          folder: "INBOX",
          password: "never-persist-this-secret",
        });
        expect(result.ok).toBe(true);
        await idle(service);
      }
      expect(service.state().accounts).toHaveLength(12);
      expect(service.state().outstanding).toHaveLength(2);
      expect(vaults.size).toBe(12);
      expect(JSON.stringify(service.state())).not.toContain("never-persist");
      expect(
        readFileSync(file).includes(Buffer.from("never-persist-this-secret")),
      ).toBe(false);
      const id = service.state().accounts[0].id;
      expect((await service.disconnect(id)).ok).toBe(true);
      expect(await getVault(id).read()).toBeNull();
      expect(service.state().outstanding).toHaveLength(2);
      expect(scan).toHaveBeenCalledTimes(12);
      expect(sales).toHaveBeenCalledTimes(12);
    } finally {
      service.stop();
      db.close();
      scan.mockRestore();
      sales.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it("isolates failing accounts so a failed IMAP login does not prevent other receipt imports", async () => {
  const scan = vi
      .spyOn(GmailImapProvider.prototype, "scan")
      .mockResolvedValue(empty),
    sales = vi
      .spyOn(GmailImapProvider.prototype, "scanSales")
      .mockResolvedValue({
        sales: [],
        scanned: 0,
        skipped: 0,
        limited: false,
        cursor: { uidValidity: "1", lastUid: 0 },
      }),
    db = await Store.open();
  const ids = [randomUUID(), randomUUID()],
    secrets = new Map(
      ids.map((id, n) => [
        id,
        vault<MailSecret>({
          email: `account${n}@example.com`,
          host: "imap.example.com",
          port: 993,
          folder: "INBOX",
          appPassword: "private",
        }),
      ]),
    );
  ids.forEach((id, n) =>
    db.mail.add(id, {
      label: `Mailbox ${n}`,
      email: `account${n}@example.com`,
      host: "imap.example.com",
      port: 993,
      folder: "INBOX",
    }),
  );
  const receipt = parseMinkysReceipt(await mail())!,
    provider = {
      test: async () => {},
      cancel: () => {},
      scan: async (secret: MailSecret) => {
        if (secret.email === "account0@example.com")
          throw Error("Private server diagnostic should not leak");
        return {
          receipts: [receipt],
          cursor: { validity: "1", lastUid: 1 },
          scanned: 1,
          skipped: 0,
          limited: false,
        };
      },
    } as unknown as ReceiptProvider;
  const service = new MailboxService(
    db,
    vault(),
    (id) => secrets.get(id)!,
    provider,
    true,
  );
  try {
    const result = await service.refresh();
    expect(result.ok).toBe(false);
    expect(result.state.outstanding).toHaveLength(2);
    expect(result.state.accounts.find((a) => a.id === ids[0])?.error).toContain(
      "secure mailbox scan",
    );
    expect(
      result.state.accounts.find((a) => a.id === ids[1])?.lastSync,
    ).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("Private server diagnostic");
  } finally {
    service.stop();
    db.close();
    scan.mockRestore();
    sales.mockRestore();
  }
});
it("rolls back a newly written vault credential if saving mailbox metadata fails", async () => {
  const db = await Store.open(),
    saved = vault<MailSecret>(),
    provider = {
      test: async () => {},
      cancel: () => {},
    } as unknown as ReceiptProvider,
    service = new MailboxService(db, vault(), () => saved, provider, true),
    failure = vi.spyOn(db.mail, "add").mockImplementation(() => {
      throw Error("Disk unavailable");
    });
  try {
    const result = await service.connect({
      label: "Test",
      email: "test@example.com",
      host: "imap.example.com",
      port: 993,
      folder: "INBOX",
      password: "private",
    });
    expect(result.ok).toBe(false);
    expect(await saved.read()).toBeNull();
    expect(db.mail.accounts()).toHaveLength(0);
  } finally {
    failure.mockRestore();
    service.stop();
    db.close();
  }
});
it("monitors receipts every ten minutes while respecting the separate sales interval for each inbox", async () => {
  const db = await Store.open(),
    id = randomUUID();
  db.mail.add(id, {
    label: "Scheduled",
    email: "schedule@example.com",
    host: "imap.example.com",
    port: 993,
    folder: "INBOX",
  });
  const scan = vi
      .spyOn(GmailImapProvider.prototype, "scan")
      .mockResolvedValue(empty),
    sales = vi
      .spyOn(GmailImapProvider.prototype, "scanSales")
      .mockResolvedValue({
        sales: [],
        scanned: 0,
        skipped: 0,
        limited: false,
        cursor: { uidValidity: "1", lastUid: 0 },
      }),
    receiptScan = vi.fn(async () => ({
      receipts: [],
      cursor: { validity: "1", lastUid: 1 },
      scanned: 0,
      skipped: 0,
      limited: false,
    })),
    provider = {
      scan: receiptScan,
      cancel: () => {},
      test: async () => {},
    } as unknown as ReceiptProvider,
    service = new MailboxService(
      db,
      vault(),
      () =>
        vault<MailSecret>({
          email: "schedule@example.com",
          host: "imap.example.com",
          port: 993,
          folder: "INBOX",
          appPassword: "private",
        }),
      provider,
      true,
    );
  vi.useFakeTimers();
  try {
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sales).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(11 * 60000);
    expect(receiptScan.mock.calls.length).toBeGreaterThan(1);
    expect(sales).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * 3600000);
    expect(sales).toHaveBeenCalledTimes(2);
  } finally {
    service.stop();
    vi.useRealTimers();
    scan.mockRestore();
    sales.mockRestore();
    db.close();
  }
});
it("keeps primary Gmail sales monitoring active when shipment auto-check is off", async () => {
  const db = await Store.open();
  db.connectInbox("primary@gmail.com", empty);
  const sales = vi
      .spyOn(GmailImapProvider.prototype, "scanSales")
      .mockResolvedValue({
        sales: [],
        scanned: 0,
        skipped: 0,
        limited: false,
        cursor: { uidValidity: "1", lastUid: 0 },
      }),
    provider = {
      test: async () => {},
      cancel: () => {},
      scan: async () => ({
        receipts: [],
        cursor: { validity: "1", lastUid: 0 },
        scanned: 0,
        skipped: 0,
        limited: false,
      }),
    } as unknown as ReceiptProvider,
    service = new MailboxService(
      db,
      vault<MailSecret>({ email: "primary@gmail.com", appPassword: "private" }),
      () => vault(),
      provider,
      true,
    );
  vi.useFakeTimers();
  try {
    expect(db.inboxAccount()?.auto).toBe(false);
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sales).toHaveBeenCalledTimes(1);
  } finally {
    service.stop();
    vi.useRealTimers();
    sales.mockRestore();
    db.close();
  }
});
it("hands off an existing primary sales cursor when upgrading to per-inbox scanning", async () => {
  const db = await Store.open();
  db.connectInbox("primary@gmail.com", empty);
  db.shipping.ingest("primary@gmail.com", {
    sales: [],
    scanned: 0,
    skipped: 0,
    limited: false,
    cursor: { uidValidity: "1", lastUid: 900 },
  });
  const sales = vi
      .spyOn(GmailImapProvider.prototype, "scanSales")
      .mockImplementation(async (_secret, cursor) => {
        expect(cursor).toEqual({ uidValidity: "1", lastUid: 900 });
        return {
          sales: [],
          scanned: 0,
          skipped: 0,
          limited: false,
          cursor: { uidValidity: "1", lastUid: 901 },
        };
      }),
    provider = {
      test: async () => {},
      cancel: () => {},
      scan: async () => ({
        receipts: [],
        cursor: { validity: "1", lastUid: 0 },
        scanned: 0,
        skipped: 0,
        limited: false,
      }),
    } as unknown as ReceiptProvider,
    service = new MailboxService(
      db,
      vault<MailSecret>({ email: "primary@gmail.com", appPassword: "private" }),
      () => vault(),
      provider,
      true,
    );
  try {
    expect((await service.refresh()).ok).toBe(true);
    expect(db.mail.cursor("legacy:primary@gmail.com").salesUid).toBe(901);
    expect(db.shipping.cursorForAccount("other@gmail.com")).toEqual({
      uidValidity: null,
      lastUid: 0,
    });
  } finally {
    service.stop();
    sales.mockRestore();
    db.close();
  }
});
it("imports outstanding receipts without invoking an unrelated failing sales scan", async () => {
  const db = await Store.open();
  db.connectInbox("primary@gmail.com", empty);
  const sales = vi
      .spyOn(GmailImapProvider.prototype, "scanSales")
      .mockRejectedValue(Error("private unrelated failure")),
    receipt = parseMinkysReceipt(await mail())!,
    provider = {
      test: async () => {},
      cancel: () => {},
      scan: async () => ({
        receipts: [receipt],
        cursor: { validity: "1", lastUid: 1 },
        scanned: 1,
        skipped: 0,
        limited: false,
      }),
    } as unknown as ReceiptProvider,
    service = new MailboxService(
      db,
      vault<MailSecret>({ email: "primary@gmail.com", appPassword: "private" }),
      () => vault(),
      provider,
      true,
    );
  try {
    const result = await service.refresh(undefined, false, true);
    expect(result.ok).toBe(true);
    expect(result.state.outstanding).toHaveLength(2);
    expect(sales).not.toHaveBeenCalled();
  } finally {
    service.stop();
    sales.mockRestore();
    db.close();
  }
});
import { scanError } from "../electron/mailboxes/errors";
it("provides actionable fixed errors without exposing server text or passwords", () => {
  expect(
    scanError(
      { authenticationFailed: true, message: "password=private" },
      "receipts",
    ),
  ).toContain("app password");
  expect(scanError({ code: "ETIMEDOUT" }, "receipts")).toContain("timed out");
  expect(
    scanError({ serverResponseCode: "NONEXISTENT" }, "receipts"),
  ).toContain("folder");
  expect(scanError(Error("private IMAP diagnostic"), "sales")).not.toContain(
    "private",
  );
});

it("saves and clears optional dates in bulk, rejects invalid dates and keeps updates atomic", async () => {
  const db = await Store.open();
  try {
    const receipt = parseMinkysReceipt(await mail())!;
    db.mail.ingest(
      "test",
      [receipt],
      { validity: "1", lastUid: 1 },
      { scanned: 1, skipped: 0, limited: false },
    );
    const ids = db.mail.lines().map((l) => l.id);
    expect(ids).toHaveLength(2);
    expect(db.mail.lines(true)).toHaveLength(3);
    db.mail.setExpectedDate({ ids, expectedDate: "2027-01-15" });
    expect(db.mail.lines().every((l) => l.expectedDate === "2027-01-15")).toBe(
      true,
    );
    for (const date of ["2026-02-30", "2027-13-01", "not-a-date"])
      expect(() =>
        db.mail.setExpectedDate({ ids, expectedDate: date }),
      ).toThrow();
    expect(() =>
      db.mail.setExpectedDate({
        ids: [ids[0], randomUUID()],
        expectedDate: "2027-02-01",
      }),
    ).toThrow();
    expect(db.mail.lines().every((l) => l.expectedDate === "2027-01-15")).toBe(
      true,
    );
    expect(() =>
      db.mail.setExpectedDate({ ids: [ids[0], ids[0]], expectedDate: null }),
    ).toThrow();
    db.mail.ingest(
      "other-inbox",
      [receipt],
      { validity: "2", lastUid: 10 },
      { scanned: 1, skipped: 0, limited: false },
    );
    expect(db.mail.lines().every((l) => l.expectedDate === "2027-01-15")).toBe(
      true,
    );
    db.mail.setExpectedDate({ ids, expectedDate: null });
    expect(db.mail.lines().every((l) => l.expectedDate === null)).toBe(true);
  } finally {
    db.close();
  }
});
it("deletes selected lines without losing received collection items or recreating cancelled lines on import", async () => {
  const dir = mkdtempSync(join(tmpdir(), "outstanding-delete-")),
    file = join(dir, "test.sqlite");
  let db = await Store.open(file);
  try {
    const receipt = parseMinkysReceipt(await mail())!;
    db.mail.ingest(
      "test",
      [receipt],
      { validity: "1", lastUid: 1 },
      { scanned: 1, skipped: 0, limited: false },
    );
    const lines = db.mail.lines(),
      ids = lines.map((l) => l.id);
    const itemId = db.mail.receive({
      id: ids[0],
      quantity: 1,
      tab: "comics",
      requestId: randomUUID(),
    });
    db.mail.setExpectedDate({ ids, expectedDate: "2027-01-15" });
    expect(() => db.mail.deleteLines({ ids, confirmed: false })).toThrow();
    expect(() =>
      db.mail.deleteLines({ ids: [ids[0], randomUUID()], confirmed: true }),
    ).toThrow();
    expect(db.mail.lines()).toHaveLength(2);
    db.close();
    db = await Store.open(file);
    expect(db.mail.lines().every((l) => l.expectedDate === "2027-01-15")).toBe(
      true,
    );
    db.mail.deleteLines({ ids, confirmed: true });
    expect(db.mail.lines()).toHaveLength(0);
    expect(db.collection.items().find((i) => i.id === itemId)?.quantity).toBe(
      1,
    );
    db.close();
    db = await Store.open(file);
    expect(
      db.mail.ingest(
        "other-inbox",
        [receipt],
        { validity: "2", lastUid: 1 },
        { scanned: 1, skipped: 0, limited: false },
      ),
    ).toBe(0);
    expect(db.mail.lines()).toHaveLength(0);
    expect(db.mail.lines(true).filter((l) => l.deletedAt)).toHaveLength(2);
    expect(() =>
      db.mail.setExpectedDate({ ids, expectedDate: null }),
    ).toThrow();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
