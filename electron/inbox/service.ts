import { z } from "zod";
import type { Store } from "../database";
import type { CredentialVault } from "./credentials";
import type { EmailProvider } from "./gmail";
import type { InboxResult, InboxState } from "../../src/inbox-types";
import type { ShippingState, ShippingResult } from "../../src/shipping-types";
import { localToday } from "../shipping/model";
export const connectionSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    appPassword: z
      .string()
      .max(64)
      .transform((s) => s.replace(/\s/g, ""))
      .pipe(z.string().regex(/^[a-z]{16}$/i)),
  })
  .strict();
const errors = {
  auth: "Gmail rejected the sign-in. Use a 16-letter app password from Google Account → Security → App passwords. Your normal Gmail password will not work.",
  network:
    "Could not reach Gmail securely. Check your connection, firewall, and Gmail IMAP access, then retry.",
  vault:
    "Windows Credential Manager is unavailable. No credentials were saved to SQLite. Run on Windows with Credential Manager access.",
  storage:
    "Could not save inbox data. Check local storage permissions and retry.",
  missing:
    "Reconnect Gmail: its saved Windows credential is missing or does not match this account.",
  busy: "An inbox operation is already running. Please wait.",
  invalid: "Enter a valid Gmail address and a 16-letter Google app password.",
};
export class InboxService {
  private busy = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextInboxCheck = 0;
  constructor(
    private store: Store,
    private vault: CredentialVault,
    private provider: EmailProvider,
    private supported = process.platform === "win32",
  ) {}
  state(): InboxState {
    return {
      account: this.store.inboxAccount(),
      shipments: this.store.shipments(),
      updates: this.store.emailUpdates(),
      syncing: this.busy,
      supported: this.supported,
    };
  }
  private result(error?: string): InboxResult {
    if (this.stopped)
      return {
        ok: false,
        error: "Application is closing.",
        state: {
          account: null,
          shipments: [],
          syncing: false,
          supported: this.supported,
        },
      };
    return { ok: !error, error, state: this.state() };
  }
  start() {
    if (this.timer) clearInterval(this.timer);
    this.nextInboxCheck = Date.now() + 10 * 60 * 1000;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {});
    }, 60 * 1000);
    this.timer.unref();
    void this.tick(true).catch(() => {});
  }
  private async tick(startup = false) {
    if (this.stopped || this.busy) return;
    const monitor = this.store.shipping.monitor();
    if (
      this.provider.scanSales &&
      this.store.inboxAccount() &&
      monitor.enabled &&
      (!monitor.nextRun || Date.parse(monitor.nextRun) <= Date.now())
    )
      await this.refreshSales();
    if (this.stopped || this.busy) return;
    if (
      this.store.inboxAccount()?.auto &&
      (startup || Date.now() >= this.nextInboxCheck)
    ) {
      this.nextInboxCheck = Date.now() + 10 * 60 * 1000;
      await this.refresh();
    }
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.provider.cancel();
  }
  private classify(error: unknown) {
    const e = error as {
      authenticationFailed?: boolean;
      serverResponseCode?: string;
      code?: string;
    };
    if (
      e?.code === "CREDENTIAL_UNAVAILABLE" ||
      (error instanceof Error && error.message === "CREDENTIAL_UNAVAILABLE")
    )
      return errors.vault;
    return e?.authenticationFailed ||
      e?.serverResponseCode === "AUTHENTICATIONFAILED"
      ? errors.auth
      : errors.network;
  }
  async connect(input: unknown): Promise<InboxResult> {
    if (this.busy) return this.result(errors.busy);
    if (!this.supported) return this.result(errors.vault);
    const parsed = connectionSchema.safeParse(input);
    if (!parsed.success) return this.result(errors.invalid);
    this.busy = true;
    let error: string | undefined;
    try {
      const old = await this.vault.read();
      if (this.stopped) return this.result();
      const scan = await this.provider.scan(parsed.data);
      if (this.stopped) return this.result();
      await this.vault.write(parsed.data);
      try {
        if (!this.stopped) this.store.connectInbox(parsed.data.email, scan);
      } catch {
        try {
          if (old) await this.vault.write(old);
          else await this.vault.remove();
        } catch {}
        error = errors.storage;
      }
    } catch (e) {
      error = this.classify(e);
    } finally {
      this.busy = false;
    }
    const result = this.result(error);
    if (!error && !this.stopped && this.provider.scanSales)
      queueMicrotask(() => void this.tick().catch(() => {}));
    return result;
  }
  async refresh(): Promise<InboxResult> {
    if (this.busy) return this.result(errors.busy);
    const account = this.store.inboxAccount();
    if (!account) return this.result("Connect Gmail first.");
    this.busy = true;
    let error: string | undefined;
    try {
      const secret = await this.vault.read();
      if (!secret || secret.email !== account.email) {
        error = errors.missing;
      } else {
        const scan = await this.provider.scan(secret);
        if (!this.stopped) {
          try {
            this.store.recordInboxScan(scan);
          } catch {
            error = errors.storage;
          }
        }
      }
    } catch (e) {
      error = this.classify(e);
    } finally {
      this.busy = false;
      this.nextInboxCheck = Date.now() + 10 * 60 * 1000;
    }
    if (error && !this.stopped) {
      try {
        this.store.setInboxError(error);
      } catch {}
    }
    return this.stopped
      ? {
          ok: false,
          state: {
            account: null,
            shipments: [],
            syncing: false,
            supported: this.supported,
          },
          error: "Application is closing.",
        }
      : this.result(error);
  }
  shippingState(): ShippingState {
    if (this.stopped)
      return {
        items: [],
        monitor: {
          enabled: false,
          intervalHours: 3,
          lastAttempt: null,
          lastSuccess: null,
          nextRun: null,
          error: null,
          scanned: 0,
          skipped: 0,
          limited: false,
        },
        accountEmail: null,
        syncing: false,
        today: localToday(),
      };
    return {
      items: this.store.shipping.items(),
      monitor: this.store.shipping.monitor(),
      accountEmail: this.store.inboxAccount()?.email || null,
      syncing: this.busy,
      today: localToday(),
    };
  }
  private shippingResult(error?: string): ShippingResult {
    return {
      ok: !error && !this.stopped,
      state: this.shippingState(),
      error: this.stopped ? "Application is closing." : error,
    };
  }
  async refreshSales(): Promise<ShippingResult> {
    if (this.stopped) return this.shippingResult();
    if (this.busy) return this.shippingResult(errors.busy);
    const account = this.store.inboxAccount();
    if (!account)
      return this.shippingResult(
        "Connect Gmail in Inbox to check for eBay sales.",
      );
    if (!this.provider.scanSales)
      return this.shippingResult(
        "This email provider does not support sales checks.",
      );
    this.busy = true;
    let error: string | undefined,
      added = 0;
    let phase: "storage" | "network" = "storage";
    try {
      const cursor = this.store.shipping.beginAttempt(account.email);
      phase = "network";
      const secret = await this.vault.read();
      if (this.stopped) return this.shippingResult();
      if (!secret || secret.email !== account.email) error = errors.missing;
      else {
        const scan = await this.provider.scanSales(secret, cursor);
        if (this.stopped) return this.shippingResult();
        phase = "storage";
        added = this.store.shipping.ingest(account.email, scan);
      }
    } catch (e) {
      error = phase === "storage" ? errors.storage : this.classify(e);
    } finally {
      this.busy = false;
    }
    if (error && !this.stopped)
      try {
        this.store.shipping.fail(error);
      } catch {}
    return { ...this.shippingResult(error), added };
  }
  shippingAction(action: () => unknown): ShippingResult {
    if (this.stopped) return this.shippingResult();
    if (this.busy) return this.shippingResult(errors.busy);
    try {
      action();
      return this.shippingResult();
    } catch {
      return this.shippingResult(
        "Could not save the shipping task. Check its fields, date, and storage permissions.",
      );
    }
  }
  setShippingMonitor(input: unknown) {
    const result = this.shippingAction(() =>
      this.store.shipping.configure(input),
    );
    if (result.ok && this.provider.scanSales)
      queueMicrotask(() => void this.tick().catch(() => {}));
    return result;
  }
  async disconnect(): Promise<InboxResult> {
    if (this.busy) return this.result(errors.busy);
    this.busy = true;
    let error: string | undefined;
    try {
      const old = await this.vault.read();
      await this.vault.remove();
      try {
        this.store.disconnectInbox();
      } catch (e) {
        if (old) await this.vault.write(old);
        throw e;
      }
    } catch (e) {
      error =
        e instanceof Error && e.message === "CREDENTIAL_UNAVAILABLE"
          ? errors.vault
          : errors.storage;
    } finally {
      this.busy = false;
    }
    return this.result(error);
  }
  setAuto(value: unknown) {
    if (this.busy) return this.result(errors.busy);
    if (!this.store.inboxAccount()) return this.result("Connect Gmail first.");
    try {
      this.store.setInboxAuto(z.boolean().parse(value));
      return this.result();
    } catch {
      return this.result(errors.storage);
    }
  }
  linkUpdate(input: unknown) {
    if (this.busy) return this.result(errors.busy);
    try {
      this.store.applyEmailUpdate(input);
      return this.result();
    } catch {
      return this.result(
        "Choose an existing order that is not cancelled. Earlier emails cannot move an order backward.",
      );
    }
  }
  link(input: unknown) {
    if (this.busy) return this.result(errors.busy);
    try {
      this.store.applyShipment(input);
      return this.result();
    } catch {
      return this.result(
        "Could not apply this update. Choose an existing order that is not cancelled; delivered orders cannot move backward.",
      );
    }
  }
}
