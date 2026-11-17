import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { MailSecret } from "../inbox/credentials";
import type { Receipt } from "../../src/mailbox-types";
import { parseMinkysReceipt } from "./paypal";
export type ReceiptScan = {
  receipts: Receipt[];
  cursor: { validity: string; lastUid: number };
  scanned: number;
  skipped: number;
  limited: boolean;
};
export class ReceiptProvider {
  private clients = new Set<ImapFlow>();
  cancel() {
    for (const c of this.clients) c.close();
  }
  private client(secret: MailSecret) {
    const c = new ImapFlow({
      host: secret.host || "imap.gmail.com",
      port: secret.port || 993,
      secure: true,
      auth: { user: secret.email, pass: secret.appPassword },
      logger: false,
      emitLogs: false,
      disableAutoIdle: true,
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 30000,
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    });
    c.on("error", () => {});
    this.clients.add(c);
    return c;
  }
  async test(secret: MailSecret) {
    const c = this.client(secret),
      timer = setTimeout(() => c.close(), 30000);
    try {
      await c.connect();
      const lock = await c.getMailboxLock(secret.folder || "INBOX", {
        readOnly: true,
      });
      lock.release();
    } finally {
      clearTimeout(timer);
      c.close();
      this.clients.delete(c);
    }
  }
  async scan(
    secret: MailSecret,
    cursor: { validity: string | null; lastUid: number },
    now = new Date(),
  ): Promise<ReceiptScan> {
    const c = this.client(secret),
      timer = setTimeout(() => c.close(), 120000);
    try {
      await c.connect();
      let folder = secret.folder || "INBOX";
      if (!secret.folder && !secret.host) {
        const all = (await c.list()).find((m) => m.specialUse === "\\All");
        if (all) folder = all.path;
      }
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        const rawValidity = c.mailbox ? String(c.mailbox.uidValidity) : "";
        if (!/^\d+$/.test(rawValidity)) throw Error("MAILBOX_INVALID");
        const validity = folder + "|" + rawValidity;
        const lastUid = validity === cursor.validity ? cursor.lastUid : 0;
        const since = new Date(now.getTime() - 365 * 86400000),
          cutoff = since.toISOString().slice(0, 10);
        const found = await c.search(
          {
            since,
            from: "service@paypal.com",
            ...(lastUid && lastUid < 4294967295
              ? { uid: `${lastUid + 1}:*` }
              : {}),
          },
          { uid: true },
        );
        const ids = (found || [])
          .filter((u) => u > lastUid)
          .sort((a, b) => a - b);
        const result: ReceiptScan = {
          receipts: [],
          cursor: { validity, lastUid },
          scanned: 0,
          skipped: 0,
          limited: ids.length > 100,
        };
        for (const uid of ids.slice(0, 100)) {
          const meta = await c.fetchOne(uid, { size: true }, { uid: true });
          if (!meta || !meta.size || meta.size > 2 * 1024 * 1024) {
            result.skipped++;
            result.cursor.lastUid = uid;
            continue;
          }
          const msg = await c.fetchOne(
            uid,
            { source: { start: 0, maxLength: 2 * 1024 * 1024 } },
            { uid: true },
          );
          if (!msg || !msg.source) throw Error("MAIL_FETCH_FAILED");
          const mail = await simpleParser(msg.source, {
            skipImageLinks: true,
            skipTextToHtml: true,
          });
          result.scanned++;
          const receipt = parseMinkysReceipt(mail);
          if (
            receipt &&
            receipt.purchaseDate >= cutoff &&
            receipt.purchaseDate <= now.toISOString().slice(0, 10)
          )
            result.receipts.push(receipt);
          else result.skipped++;
          result.cursor.lastUid = uid;
        }
        return result;
      } finally {
        lock.release();
      }
    } finally {
      clearTimeout(timer);
      c.close();
      this.clients.delete(c);
    }
  }
}
