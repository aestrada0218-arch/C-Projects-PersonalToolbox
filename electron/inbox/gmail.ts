import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { ShipmentEvent } from "../../src/inbox-types";
import type { MailSecret } from "./credentials";
import { extractShipments } from "./extract";
export type ScanResult = {
  events: ShipmentEvent[];
  scanned: number;
  skipped: number;
  limited: boolean;
};
export interface EmailProvider {
  scan(secret: MailSecret): Promise<ScanResult>;
  cancel(): void;
}
export class GmailImapProvider implements EmailProvider {
  private client: ImapFlow | null = null;
  cancel() {
    this.client?.close();
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
            ],
          },
          { uid: true },
        );
        const ids = (found || []).sort((a, b) => b - a).slice(0, 100);
        const result: ScanResult = {
          events: [],
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
            result.events.push(
              ...extractShipments(
                mail.subject || "",
                mail.text || "",
                received,
              ),
            );
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
