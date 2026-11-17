import { it, expect, vi, beforeEach } from "vitest";
const { client, options } = vi.hoisted(() => ({
  client: {
    on: vi.fn(),
    connect: vi.fn(async () => {}),
    close: vi.fn(),
    list: vi.fn(async () => [
      { specialUse: "\\All", path: "[Gmail]/All Mail" },
    ]),
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    search: vi.fn(),
    fetchOne: vi.fn(),
    mailbox: { uidValidity: BigInt(7) },
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
import { ReceiptProvider } from "../electron/mailboxes/provider";
const secret = { email: "test@gmail.com", appPassword: "private-not-logged" };
beforeEach(() => {
  vi.clearAllMocks();
  client.search.mockResolvedValue([]);
  client.fetchOne.mockResolvedValue({ size: 3 * 1024 * 1024 });
});
it("uses Gmail All Mail, verified TLS, disabled logs, read-only access and a 365-day sender query", async () => {
  await new ReceiptProvider().scan(
    secret,
    { validity: null, lastUid: 0 },
    new Date("2026-11-17T12:00:00Z"),
  );
  expect(options.value).toMatchObject({
    host: "imap.gmail.com",
    secure: true,
    logger: false,
    emitLogs: false,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
  expect(client.getMailboxLock).toHaveBeenCalledWith("[Gmail]/All Mail", {
    readOnly: true,
  });
  expect(client.search.mock.calls[0][0]).toEqual({
    since: new Date("2025-11-17T12:00:00Z"),
    from: "service@paypal.com",
  });
  expect(client.close).toHaveBeenCalled();
});
it("walks a large history oldest-first with a bounded cursor and safely resets UIDVALIDITY", async () => {
  client.search.mockResolvedValue(Array.from({ length: 220 }, (_, i) => i + 1));
  const provider = new ReceiptProvider();
  const first = await provider.scan(secret, {
    validity: "[Gmail]/All Mail|7",
    lastUid: 10,
  });
  expect(first).toMatchObject({
    cursor: { validity: "[Gmail]/All Mail|7", lastUid: 110 },
    limited: true,
    skipped: 100,
  });
  expect(client.fetchOne.mock.calls[0][0]).toBe(11);
  const second = await provider.scan(secret, first.cursor);
  expect(second.cursor.lastUid).toBe(210);
  expect(second.limited).toBe(true);
  const reset = await provider.scan(secret, { validity: "old", lastUid: 220 });
  expect(reset.cursor.lastUid).toBe(100);
});
it("uses the exact custom TLS endpoint/folder and does not silently skip a transient fetch failure", async () => {
  client.search.mockResolvedValue([21]);
  client.fetchOne.mockImplementation(async (_id: number, q: any) =>
    q.size ? { size: 1000 } : false,
  );
  await expect(
    new ReceiptProvider().scan(
      { ...secret, host: "imap.example.com", port: 1993, folder: "Orders" },
      { validity: "[Gmail]/All Mail|7", lastUid: 20 },
    ),
  ).rejects.toThrow("MAIL_FETCH_FAILED");
  expect(options.value).toMatchObject({
    host: "imap.example.com",
    port: 1993,
    secure: true,
  });
  expect(client.getMailboxLock).toHaveBeenCalledWith("Orders", {
    readOnly: true,
  });
  expect(client.list).not.toHaveBeenCalled();
});
it("returns completed progress before a slow batch reaches its hard timeout", async () => {
  const now = Date.now();
  let elapsed = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now + elapsed);
  client.search.mockResolvedValue([1, 2, 3]);
  client.fetchOne.mockImplementation(async () => {
    elapsed += 40000;
    return { size: 3 * 1024 * 1024 };
  });
  try {
    const result = await new ReceiptProvider().scan(secret, {
      validity: null,
      lastUid: 0,
    });
    expect(result.cursor.lastUid).toBe(2);
    expect(result.limited).toBe(true);
  } finally {
    clock.mockRestore();
  }
});
