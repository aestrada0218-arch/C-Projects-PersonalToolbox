import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "../database";
import type { CredentialVault, MailSecret } from "../inbox/credentials";
import { GmailImapProvider } from "../inbox/gmail";
import { ReceiptProvider } from "./provider";
import { mailboxSchema } from "./model";
import type {
  MailboxAccount,
  MailboxResult,
  MailboxState,
} from "../../src/mailbox-types";
export class MailboxService {
  private backfills = new Set<string>();
  private busy = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryAt = new Map<string, number>();
  private active: GmailImapProvider | null = null;
  constructor(
    private store: Store,
    private primary: CredentialVault,
    private vault: (id: string) => CredentialVault,
    private receipts = new ReceiptProvider(),
    private supported = process.platform === "win32",
  ) {}
  state(): MailboxState {
    if (this.stopped)
      return {
        accounts: [],
        outstanding: [],
        busy: false,
        supported: this.supported,
      };
    const accounts = this.store.mail.accounts(),
      legacy = this.store.inboxAccount();
    if (legacy) {
      const cursor = this.store.mail.cursor("legacy:" + legacy.email);
      accounts.unshift({
        id: "legacy",
        label: "Primary Gmail",
        email: legacy.email,
        host: "imap.gmail.com",
        port: 993,
        folder: "Gmail All Mail (receipts)",
        enabled: legacy.auto,
        lastSync: cursor.lastSync || null,
        error: cursor.error || null,
        scanned: cursor.scanned || 0,
        skipped: cursor.skipped || 0,
        limited: !!cursor.limited,
        legacy: true,
      });
    }
    return {
      accounts,
      outstanding: this.store.mail.lines(),
      busy: this.busy,
      supported: this.supported,
    };
  }
  private result(error?: string): MailboxResult {
    return { ok: !error, error, state: this.state() };
  }
  async connect(input: unknown) {
    if (this.busy)
      return this.result("A mailbox operation is already running.");
    if (!this.supported)
      return this.result(
        "Secure credentials require Windows Credential Manager.",
      );
    const parsed = mailboxSchema.safeParse(input);
    if (!parsed.success)
      return this.result(
        "Check the email, IMAP hostname, TLS port, folder and password.",
      );
    const value = parsed.data;
    if (
      this.state().accounts.some(
        (a) =>
          a.email === value.email &&
          a.host === value.host &&
          a.port === value.port &&
          (a.legacy || a.folder === value.folder),
      )
    )
      return this.result("This mailbox is already connected.");
    this.busy = true;
    const id = randomUUID(),
      secret: MailSecret = {
        email: value.email,
        appPassword: value.password,
        host: value.host,
        port: value.port,
        folder: value.folder,
      };
    let written = false;
    try {
      await this.receipts.test(secret);
      if (this.stopped) return this.result("Application is closing.");
      await this.vault(id).write(secret);
      written = true;
      if (this.stopped) {
        await this.vault(id).remove();
        return this.result("Application is closing.");
      }
      const { password: _, ...metadata } = value;
      this.store.mail.add(id, metadata);
    } catch {
      if (written)
        await this.vault(id)
          .remove()
          .catch(() => {});
      return this.result(
        "Could not connect securely. Check IMAP settings, your provider app password, and Windows Credential Manager.",
      );
    } finally {
      this.busy = false;
    }
    queueMicrotask(() => void this.refresh(id).catch(() => {}));
    return this.result();
  }
  async disconnect(input: unknown) {
    if (this.busy)
      return this.result("A mailbox operation is already running.");
    const id = z.string().uuid().parse(input);
    if (!this.store.mail.accounts().some((a) => a.id === id))
      return this.result("Mailbox not found.");
    this.busy = true;
    try {
      const vault = this.vault(id),
        old = await vault.read();
      await vault.remove();
      try {
        this.store.mail.remove(id);
      } catch (e) {
        if (old) await vault.write(old);
        throw e;
      }
      return this.result();
    } catch {
      return this.result("Could not remove the mailbox securely.");
    } finally {
      this.busy = false;
    }
  }
  setEnabled(input: unknown) {
    if (this.busy)
      return this.result("A mailbox operation is already running.");
    try {
      const value = z
        .object({ id: z.string().uuid(), enabled: z.boolean() })
        .strict()
        .parse(input);
      this.store.mail.enabled(value.id, value.enabled);
      if (!value.enabled) this.backfills.delete(value.id);
      return this.result();
    } catch {
      return this.result("Could not update mailbox preferences.");
    }
  }
  receive(input: unknown) {
    try {
      this.store.mail.receive(input);
      return this.result();
    } catch {
      return this.result(
        "Choose an outstanding item, an available quantity and a collection tab.",
      );
    }
  }
  async refresh(input?: unknown, automatic = false) {
    if (this.busy || this.stopped)
      return this.result(
        "A mailbox operation is already running or the application is closing.",
      );
    const id =
      input === undefined
        ? null
        : z.union([z.literal("legacy"), z.string().uuid()]).parse(input);
    const accounts = this.state().accounts.filter((a) => !id || a.id === id);
    if (!accounts.length) return this.result("Connect an inbox first.");
    this.busy = true;
    let failures = 0;
    try {
      for (const account of accounts) {
        if (this.stopped) break;
        try {
          const secret = await (
            account.legacy ? this.primary : this.vault(account.id)
          ).read();
          if (
            !secret ||
            secret.email !== account.email ||
            (!account.legacy &&
              (secret.host !== account.host ||
                secret.folder !== account.folder ||
                secret.port !== account.port))
          )
            throw Error("MISSING_CREDENTIAL");
          const cursorId = account.legacy
            ? "legacy:" + account.email
            : account.id;
          const cursor = this.store.mail.cursor(cursorId),
            scan = await this.receipts.scan(secret, cursor);
          if (this.stopped) break;
          this.store.mail.ingest(cursorId, scan.receipts, scan.cursor, scan);
          if (scan.limited) this.backfills.add(account.id);
          else this.backfills.delete(account.id);
          this.active = new GmailImapProvider();
          if (!account.legacy) {
            const messages = await this.active.scan(secret);
            if (this.stopped) break;
            this.store.recordInboxScan(messages);
          }
          if (
            this.store.shipping.monitor().enabled &&
            (!automatic ||
              !cursor.salesNext ||
              Date.parse(cursor.salesNext) <= Date.now())
          ) {
            const sales = await this.active.scanSales(secret, {
              uidValidity: cursor.salesValidity || null,
              lastUid: cursor.salesUid || 0,
            });
            if (this.stopped) break;
            this.store.shipping.ingest(account.email, sales);
            this.store.mail.salesCursor(
              cursorId,
              sales.cursor.uidValidity,
              sales.cursor.lastUid,
              new Date(
                Date.now() +
                  (sales.limited
                    ? 60000
                    : this.store.shipping.monitor().intervalHours * 3600000),
              ).toISOString(),
            );
          }
          this.retryAt.delete(account.id);
        } catch {
          failures++;
          if (!this.stopped) {
            this.store.mail.error(
              account.legacy ? "legacy:" + account.email : account.id,
            );
            if (account.legacy)
              this.store.setInboxError(
                "Could not complete the PayPal or sales scan. Check Gmail credentials and connectivity.",
              );
          }
          this.retryAt.set(account.id, Date.now() + 10 * 60000);
        } finally {
          this.active?.cancel();
          this.active = null;
        }
      }
    } finally {
      this.busy = false;
    }
    return this.result(
      failures
        ? `${failures} inbox scan(s) could not finish. Other inboxes were processed; saved purchases were retained.`
        : undefined,
    );
  }
  start() {
    this.timer = setInterval(() => void this.tick(), 60000);
    this.timer.unref();
    void this.tick();
  }
  private async tick() {
    if (this.busy || this.stopped) return;
    try {
      for (const a of this.state().accounts) {
        if (this.stopped) break;
        const cursor = this.store.mail.cursor(
          a.legacy ? "legacy:" + a.email : a.id,
        );
        const salesDue =
          this.store.shipping.monitor().enabled &&
          (!cursor.salesNext || Date.parse(cursor.salesNext) <= Date.now());
        if (
          (a.enabled || this.backfills.has(a.id) || (a.legacy && salesDue)) &&
          (this.retryAt.get(a.id) || 0) <= Date.now() &&
          (salesDue ||
            a.limited ||
            !a.lastSync ||
            Date.parse(a.lastSync) < Date.now() - 10 * 60000)
        )
          await this.refresh(a.id, true);
      }
    } catch {
      /* fixed errors are exposed per mailbox; no message content logged */
    }
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.receipts.cancel();
    this.active?.cancel();
  }
}
