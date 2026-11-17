import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import type { MailSecret } from "../inbox/credentials";
import { saleEmailText } from "../shipping/email-text";
import { hash } from "./model";
export type CodeMessage = { code: string; messageKey: string };
export interface CodeProvider {
  test(secret: MailSecret): Promise<void>;
  find(
    secret: MailSecret,
    recipient: string,
    since: number,
    domains: string[],
    signal: AbortSignal,
    checkpoint: () => Promise<void>,
    accept: (key: string) => boolean,
  ): Promise<CodeMessage | null>;
  cancel(): void;
}
export function codeFromMail(
  mail: ParsedMail,
  recipient: string,
  since: number,
  received: number,
  domains: string[],
): string | null {
  if (
    received < since - 1000 ||
    (mail.date && mail.date.getTime() < since - 30000)
  )
    return null;
  const senders =
    mail.from?.value.map((v) => v.address?.toLowerCase() || "") || [];
  if (
    !senders.some((address) => {
      const d = address.slice(address.lastIndexOf("@") + 1);
      return domains.some(
        (allowed) => d === allowed || d.endsWith("." + allowed),
      );
    })
  )
    return null;
  const addresses = (Array.isArray(mail.to) ? mail.to : [mail.to]).flatMap(
    (v) => v?.value.map((x) => x.address?.toLowerCase() || "") || [],
  );
  for (const header of ["delivered-to", "x-original-to", "x-forwarded-to"]) {
    const value = mail.headers.get(header);
    if (typeof value === "string")
      addresses.push(
        ...(value
          .toLowerCase()
          .match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ||
          []),
      );
  }
  if (!addresses.includes(recipient.toLowerCase())) return null;
  const text = ((mail.subject || "") + "\n" + saleEmailText(mail)).slice(
    0,
    120000,
  );
  if (
    /\b(?:password reset|reset (?:your )?password|account recovery|change (?:your )?email)\b/i.test(
      text,
    )
  )
    return null;
  if (
    !/\b(?:verif(?:y|ication)|sign[ -]?in|security|one[ -]?time|login|passcode|authentication|access code)\b/i.test(
      text,
    )
  )
    return null;
  const candidates = new Set<string>();
  for (const match of text.matchAll(
    /\b(?:code|passcode)\b[^\d]{0,40}\b(\d{4,8})\b/gi,
  ))
    candidates.add(match[1]);
  for (const match of text.matchAll(
    /\b(\d{4,8})\b[^\d]{0,30}\b(?:(?:verification|security|login|one.time)\s+)?(?:code|passcode)\b/gi,
  ))
    candidates.add(match[1]);
  return candidates.size === 1 ? [...candidates][0] : null;
}
export const abortDelay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(Error("ENTRY_STOP"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(Error("ENTRY_STOP"));
    };
    signal.addEventListener("abort", stop, { once: true });
  });
export class GmailCodeProvider implements CodeProvider {
  private clients = new Set<ImapFlow>();
  cancel() {
    for (const c of this.clients) c.close();
    this.clients.clear();
  }
  private client(secret: MailSecret) {
    const c = new ImapFlow({
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
    c.on("error", () => {});
    this.clients.add(c);
    return c;
  }
  async test(secret: MailSecret) {
    const c = this.client(secret);
    const timer = setTimeout(() => c.close(), 30000);
    try {
      await c.connect();
      const lock = await c.getMailboxLock("INBOX", { readOnly: true });
      lock.release();
    } finally {
      clearTimeout(timer);
      c.close();
      this.clients.delete(c);
    }
  }
  async find(
    secret: MailSecret,
    recipient: string,
    since: number,
    domains: string[],
    signal: AbortSignal,
    checkpoint: () => Promise<void>,
    accept: (key: string) => boolean,
  ) {
    const c = this.client(secret),
      stop = () => c.close();
    signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, 95000);
    try {
      if (signal.aborted) throw Error("ENTRY_STOP");
      await c.connect();
      const lock = await c.getMailboxLock("INBOX", { readOnly: true });
      try {
        const end = Date.now() + 90000,
          seen = new Set<number>();
        while (Date.now() < end && !signal.aborted) {
          await checkpoint();
          const found = await c.search(
            {
              since: new Date(since - 86400000),
              or: [
                { subject: "code" },
                { subject: "verification" },
                { subject: "sign in" },
                { subject: "login" },
              ],
            },
            { uid: true },
          );
          for (const uid of (found || []).sort((a, b) => b - a).slice(0, 50)) {
            if (seen.has(uid)) continue;
            seen.add(uid);
            const meta = await c.fetchOne(uid, { size: true }, { uid: true });
            if (!meta || !meta.size || meta.size > 1024 * 1024) continue;
            const message = await c.fetchOne(
              uid,
              {
                source: { start: 0, maxLength: 1024 * 1024 },
                internalDate: true,
              },
              { uid: true },
            );
            if (!message || !message.source) continue;
            const received =
              message.internalDate instanceof Date
                ? message.internalDate.getTime()
                : Date.parse(String(message.internalDate));
            if (!Number.isFinite(received)) continue;
            const mail = await simpleParser(message.source, {
              skipImageLinks: true,
              skipTextToHtml: true,
            });
            const code = codeFromMail(
              mail,
              recipient,
              since,
              received,
              domains,
            );
            if (!code) continue;
            const validity = c.mailbox ? String(c.mailbox.uidValidity) : "";
            const messageKey = hash(
              `${secret.email}:${validity}:${uid}:${mail.messageId || ""}`,
            );
            if (accept(messageKey)) return { code, messageKey };
          }
          await abortDelay(5000, signal);
        }
        return null;
      } finally {
        lock.release();
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      c.close();
      this.clients.delete(c);
    }
  }
}
