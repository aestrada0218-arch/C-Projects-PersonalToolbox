import { createHash } from "node:crypto";
import { extractEmailUpdate } from "./email-update";
import type { EmailUpdateEvent } from "../../src/inbox-types";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { ShipmentEvent } from "../../src/inbox-types";
import type { MailSecret } from "./credentials";
import { extractShipments } from "./extract";
import { extractEbaySale } from "../shipping/extract";
import { saleEmailText } from "../shipping/email-text";
import type { SalesCursor, SalesScan } from "../../src/shipping-types";
export type ScanResult = {
  events: ShipmentEvent[];
  updates?: EmailUpdateEvent[];
  scanned: number;
  skipped: number;
  limited: boolean;
};
export interface EmailProvider {
  scan(secret: MailSecret): Promise<ScanResult>;
  scanSales?(secret: MailSecret, cursor: SalesCursor): Promise<SalesScan>;
  cancel(): void;
}
export class GmailImapProvider implements EmailProvider {
  private client: ImapFlow | null = null;
  cancel() {
    this.client?.close();
  }
  async scanSales(secret: MailSecret, cursor: SalesCursor): Promise<SalesScan> {
    const client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
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
    this.client = client;
    client.on("error", () => {});
    const deadline = setTimeout(() => client.close(), 120000);
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX", { readOnly: true });
      try {
        const validity = client.mailbox
          ? String(client.mailbox.uidValidity)
          : null;
        if (!validity || !/^\d+$/.test(validity))
          throw Error("Invalid mailbox");
        const lastUid = validity === cursor.uidValidity ? cursor.lastUid : 0;
        const since = new Date();
        since.setDate(since.getDate() - 90);
        const found = await client.search(
          {
            since,
            ...(lastUid && lastUid < 4294967295
              ? { uid: `${lastUid + 1}:*` }
              : {}),
            or: [
              { from: "ebay.com" },
              { subject: "you made the sale" },
              { subject: "you made a sale" },
              { subject: "you sold" },
              { subject: "your item sold" },
              { subject: "your item has sold" },
              { subject: "sale confirmed" },
              { subject: "your buyer has paid" },
            ],
          },
          { uid: true },
        );
        // IMAP sequence ranges can include the highest UID even when the start
        // is larger. Filter explicitly, and advance only through processed rows.
        const ids = (found || [])
          .filter((uid) => uid > lastUid)
          .sort((a, b) => a - b);
        const result: SalesScan = {
          sales: [],
          scanned: 0,
          skipped: 0,
          limited: ids.length > 100,
          cursor: { uidValidity: validity, lastUid },
        };
        for (const uid of ids.slice(0, 100)) {
          const meta = await client.fetchOne(
            uid,
            { size: true },
            { uid: true },
          );
          if (!meta || !meta.size || meta.size > 1024 * 1024) {
            result.skipped++;
            result.cursor.lastUid = uid;
            continue;
          }
          const msg = await client.fetchOne(
            uid,
            {
              source: { start: 0, maxLength: 1024 * 1024 },
              internalDate: true,
            },
            { uid: true },
          );
          if (!msg || !msg.source) {
            result.skipped++;
            result.cursor.lastUid = uid;
            continue;
          }
          result.scanned++;
          try {
            const mail = await simpleParser(msg.source, {
              skipImageLinks: true,
              skipTextToHtml: true,
            });
            const received =
              msg.internalDate instanceof Date
                ? msg.internalDate.toISOString()
                : new Date(msg.internalDate || Date.now()).toISOString();
            const externalId = createHash("sha256")
              .update(mail.messageId || `INBOX:${validity}:${uid}`)
              .digest("hex");
            const sale = extractEbaySale({
              subject: mail.subject || "",
              text: saleEmailText(mail),
              senders: mail.from?.value.map((v) => v.address || "") || [],
              received,
              externalId,
            });
            if (sale) result.sales.push(sale);
          } catch {
            result.skipped++;
          }
          result.cursor.lastUid = uid;
        }
        return result;
      } finally {
        lock.release();
      }
    } finally {
      clearTimeout(deadline);
      client.close();
      if (this.client === client) this.client = null;
    }
  }
  async scan(secret: MailSecret): Promise<ScanResult> {
    const client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
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
    this.client = client;
    client.on("error", () => {});
    const deadline = setTimeout(() => client.close(), 120000);
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX", { readOnly: true });
      try {
        const since = new Date();
        since.setDate(since.getDate() - 30);
        const found = await client.search(
          {
            since,
            or: [
              { subject: "ship" },
              { subject: "tracking" },
              { subject: "delivered" },
              { subject: "delivery" },
              { subject: "package" },
              { subject: "arriv" },
              { subject: "dispatch" },
              { subject: "on its way" },
              { subject: "on the way" },
              { subject: "confirmed" },
              { subject: "confirmation" },
              { subject: "order received" },
              { body: "Forwarded message" },
            ],
          },
          { uid: true },
        );
        const ids = (found || []).sort((a, b) => b - a).slice(0, 100);
        const result: ScanResult = {
          events: [],
          updates: [],
          scanned: 0,
          skipped: 0,
          limited: (found || []).length > 100,
        };
        for (const uid of ids) {
          const meta = await client.fetchOne(
            uid,
            { size: true },
            { uid: true },
          );
          if (!meta || !meta.size || meta.size > 1024 * 1024) {
            result.skipped++;
            continue;
          }
          const msg = await client.fetchOne(
            uid,
            {
              source: { start: 0, maxLength: 1024 * 1024 },
              internalDate: true,
            },
            { uid: true },
          );
          if (!msg || !msg.source) {
            result.skipped++;
            continue;
          }
          result.scanned++;
          try {
            const mail = await simpleParser(msg.source, {
              skipImageLinks: true,
              skipTextToHtml: true,
            });
            const received =
              msg.internalDate instanceof Date
                ? msg.internalDate.toISOString()
                : new Date(msg.internalDate || Date.now()).toISOString();
            const subject = mail.subject || "";
            const text = mail.text || "";
            const externalId = createHash("sha256")
              .update(
                mail.messageId ||
                  `${client.mailbox && client.mailbox.uidValidity}:${uid}`,
              )
              .digest("hex");
            const update = extractEmailUpdate(
              subject,
              text,
              received,
              externalId,
            );
            const events = extractShipments(
              update?.subject || subject,
              text,
              received,
            );
            result.events.push(...events);
            if (!events.length && update) result.updates!.push(update);
          } catch {
            result.skipped++;
          }
        }
        return result;
      } finally {
        lock.release();
      }
    } finally {
      clearTimeout(deadline);
      client.close();
      if (this.client === client) this.client = null;
    }
  }
}
