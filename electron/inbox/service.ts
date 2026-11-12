import { z } from "zod";
import type { Store } from "../database";
import type { CredentialVault } from "./credentials";
import type { EmailProvider } from "./gmail";
import type { InboxResult, InboxState } from "../../src/inbox-types";
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
    this.timer = setInterval(
      () => {
        if (this.store.inboxAccount()?.auto && !this.busy) void this.refresh();
      },
      10 * 60 * 1000,
    );
    this.timer.unref();
    if (this.store.inboxAccount()?.auto) void this.refresh();
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
    return this.result(error);
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
  async disconnect(): Promise<InboxResult> {
    if (this.busy) return this.result(errors.busy);
    this.busy = true;
    let error: string | undefined;
    try {
      await this.vault.remove();
      this.store.disconnectInbox();
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
