import { it, expect, vi } from "vitest";
const { client, options } = vi.hoisted(() => ({
  client: {
    on: vi.fn(),
    connect: vi.fn(async () => {}),
    close: vi.fn(),
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    search: vi.fn(),
    fetchOne: vi.fn(),
    mailbox: { uidValidity: BigInt(100) },
  },
  options: { value: null as any },
}));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    constructor(input: any) {
      options.value = input;
      return client;
    }
  },
}));
import { GmailImapProvider } from "../electron/inbox/gmail";
it("finds seller emails independently of shipping subjects, parses HTML-only sale notices and stays read-only", async () => {
  client.search.mockResolvedValue([10]);
  client.fetchOne.mockImplementation(async (_id: number, query: any) =>
    query.size
      ? { size: 1000 }
      : {
          source: Buffer.from(
            "From: eBay <ebay@ebay.com>\r\nMessage-ID: <sale-1@example.invalid>\r\nSubject: You made the sale for Example Card\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<h1>Great news&mdash;your item has sold!</h1><table><tr><td>Your buyer has paid</td><td>Ship by:<br><strong>Oct 02, 2026</strong></td></tr></table><p>Order number: 12-34567-89012</p>",
          ),
          internalDate: new Date("2026-10-01T12:00:00Z"),
        },
  );
  const result = await new GmailImapProvider().scanSales(
    { email: "seller@example.invalid", appPassword: "abcdefghijklmnop" },
    { uidValidity: null, lastUid: 0 },
  );
  expect(result.sales[0]).toMatchObject({
    name: "Example Card",
    shipBy: "2026-10-02",
    orderReference: "12-34567-89012",
    paymentStatus: "Paid",
  });
  expect(result.cursor).toEqual({ uidValidity: "100", lastUid: 10 });
  expect(client.search.mock.calls.at(-1)?.[0].or).toContainEqual({
    subject: "you made the sale",
  });
  expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX", {
    readOnly: true,
  });
  expect(options.value).toMatchObject({
    logger: false,
    emitLogs: false,
    tls: { rejectUnauthorized: true },
  });
});
it("walks sales oldest-first in bounded batches, persists a UID cursor, and resets safely on mailbox UIDVALIDITY changes", async () => {
  client.fetchOne.mockClear();
  client.fetchOne.mockResolvedValue({ size: 2000000 });
  client.search.mockResolvedValue(
    Array.from({ length: 150 }, (_, i) => i + 1).reverse(),
  );
  const provider = new GmailImapProvider(),
    secret = {
      email: "seller@example.invalid",
      appPassword: "abcdefghijklmnop",
    };
  const first = await provider.scanSales(secret, {
    uidValidity: null,
    lastUid: 0,
  });
  expect(first).toMatchObject({
    limited: true,
    skipped: 100,
    cursor: { uidValidity: "100", lastUid: 100 },
  });
  expect(client.fetchOne.mock.calls[0][0]).toBe(1);
  const second = await provider.scanSales(secret, first.cursor);
  expect(second).toMatchObject({
    limited: false,
    skipped: 50,
    cursor: { uidValidity: "100", lastUid: 150 },
  });
  expect(client.search.mock.calls.at(-1)?.[0].uid).toBe("101:*");
  const reset = await provider.scanSales(secret, {
    uidValidity: "99",
    lastUid: 999,
  });
  expect(client.search.mock.calls.at(-1)?.[0].uid).toBeUndefined();
  expect(reset.cursor.lastUid).toBe(100);
});
it("does not advance an existing sales cursor when IMAP returns the highest old UID for an empty range", async () => {
  client.fetchOne.mockClear();
  client.search.mockResolvedValue([50]);
  const result = await new GmailImapProvider().scanSales(
    { email: "seller@example.invalid", appPassword: "abcdefghijklmnop" },
    { uidValidity: "100", lastUid: 50 },
  );
  expect(result.cursor.lastUid).toBe(50);
  expect(result.scanned).toBe(0);
  expect(client.fetchOne).not.toHaveBeenCalled();
});
it("uses fixed Gmail TLS, read-only INBOX, bounded PEEK fetches, and disabled logs", async () => {
  client.search.mockResolvedValue([1, 2]);
  client.fetchOne.mockImplementation(async (id: number, query: any) =>
    query.size
      ? { size: id === 1 ? 2000000 : 500 }
      : {
          source: Buffer.from(
            "Subject: Your package has shipped\r\nContent-Type: text/plain\r\n\r\nUPS 1Z999AA10123456784",
          ),
          internalDate: new Date("2026-11-12T12:00:00Z"),
        },
  );
  const result = await new GmailImapProvider().scan({
    email: "test@gmail.com",
    appPassword: "abcdefghijklmnop",
  });
  expect(options.value).toMatchObject({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    logger: false,
    emitLogs: false,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
  expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX", {
    readOnly: true,
  });
  expect(result.scanned).toBe(1);
  expect(result.skipped).toBe(1);
  expect(result.events[0].tracking).toBe("1Z999AA10123456784");
  expect(client.fetchOne).toHaveBeenCalledWith(
    2,
    { source: { start: 0, maxLength: 1024 * 1024 }, internalDate: true },
    { uid: true },
  );
  expect(client.close).toHaveBeenCalled();
});
it("caps a large result set at the newest 100 matches", async () => {
  client.fetchOne.mockClear();
  client.search.mockResolvedValue(Array.from({ length: 150 }, (_, i) => i + 1));
  client.fetchOne.mockResolvedValue({ size: 2000000 });
  const result = await new GmailImapProvider().scan({
    email: "test@gmail.com",
    appPassword: "abcdefghijklmnop",
  });
  expect(result.limited).toBe(true);
  expect(client.fetchOne).toHaveBeenCalledTimes(100);
  expect(client.fetchOne.mock.calls[0][0]).toBe(150);
});
it("keeps both forwarded email examples when neither contains recognized tracking", async () => {
  client.search.mockResolvedValue([10, 11]);
  client.fetchOne.mockImplementation(async (id: number, query: any) =>
    query.size
      ? { size: 500 }
      : {
          source: Buffer.from(
            "Message-ID: <test-" +
              id +
              "@example.invalid>\r\nSubject: " +
              (id === 10
                ? "Fwd: Order #98765432 confirmed"
                : "Fwd: Out for delivery 1 item: Example item") +
              "\r\nContent-Type: text/plain\r\n\r\n---------- Forwarded message ---------\r\nNo visible tracking number",
          ),
          internalDate: new Date("2026-11-12T12:00:00Z"),
        },
  );
  const provider = new GmailImapProvider();
  const secret = { email: "test@gmail.com", appPassword: "abcdefghijklmnop" };
  const result = await provider.scan(secret);
  expect(result.events).toEqual([]);
  expect(result.updates?.map((u) => u.status)).toEqual([
    "Out for delivery",
    "Order confirmed",
  ]);
  expect(client.search.mock.calls.at(-1)?.[0].or).toContainEqual({
    subject: "confirmed",
  });
  const again = await provider.scan(secret);
  expect(again.updates?.map((u) => u.externalId)).toEqual(
    result.updates?.map((u) => u.externalId),
  );
});
