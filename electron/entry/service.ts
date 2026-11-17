import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Store } from "../database";
import type { CredentialVault, MailSecret } from "../inbox/credentials";
import { connectionSchema as gmailSchema } from "../inbox/service";
import { proxySchema } from "./model";
import { parseEntryCsv, previewRows, type ImportedEntry } from "./csv";
import type { CodeProvider } from "./codes";
import type {
  EntryDriver,
  EntryControl,
  DriverAnswer,
  ProxySecret,
} from "./driver";
import type {
  EntryState,
  EntryResult,
  EntryPrompt,
  EntryImportPreview,
  EntryCampaign,
  EntryAnswer,
} from "../../src/entry-types";
export function entryError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return (
    (
      {
        ENTRY_ENCRYPTION:
          "Encrypted profile storage is unavailable. Use this app on your Windows account with OS encryption enabled. No plaintext fallback is used.",
        ENTRY_CAMPAIGN_EXISTS:
          "A queue already exists for this product. Select it instead of creating duplicate entries.",
        ENTRY_LOCKED:
          "This record is locked. Started profiles and their proxy assignments cannot be replaced or deleted.",
        ENTRY_SUBMITTED:
          "This entry may already have been submitted. Open it for review; automatic resubmission is blocked.",
        ENTRY_PROXY_FIXED:
          "This proxy endpoint is already assigned to started profiles and cannot be changed for their retries.",
        ENTRY_PROXY_USED:
          "This proxy is assigned to saved profiles. Unassign it from unused profiles first; started assignments are retained.",
        ENTRY_PROXY_NAME: "Choose a unique proxy name.",
        ENTRY_PROXY:
          "The saved proxy credential is missing or does not match its endpoint. Re-enter its credential; no fallback connection was used.",
        ENTRY_DUPLICATE:
          "This person, email, or household is already recorded for the product's selected entry rule.",
        ENTRY_GMAIL:
          "Connect the selected Gmail account first, or select manual codes. Passwords and codes are never written to logs.",
        ENTRY_BUSY:
          "Wait for the current operation, or stop the active queue before changing its configuration.",
        ENTRY_COOLDOWN:
          "The site's cooldown has not elapsed. Keep the same proxy and wait before resuming.",
        ENTRY_BROWSER_CLOSED:
          "The browser was closed. This attempt needs review before any retry.",
        ENTRY_ACCOUNT_MISMATCH:
          "The visible browser account does not match this profile. Review the account on the site before retrying.",
        ENTRY_MISSING: "The selected entry record was not found.",
        ENTRY_CONFIRMATION:
          "A click or local confirmation is not proof of successful entry. A recognized site confirmation is required.",
        CREDENTIAL_UNAVAILABLE:
          "Windows Credential Manager is unavailable. Save credentials on your Windows PC; no plaintext password file is used.",
      } as Record<string, string>
    )[code] ||
    "The entry operation could not be completed. Check the fields, browser installation, connection, and storage permissions. Raw browser/mail errors are not logged."
  );
}
export class EntryService {
  private disposed = false;
  private busy = false;
  private activeId: string | null = null;
  private paused = false;
  private stopping = false;
  private controller: AbortController | null = null;
  private runPromise: Promise<void> | null = null;
  private wakes = new Set<() => void>();
  private prompts = new Map<
    string,
    {
      value: EntryPrompt;
      resolve: (answer: DriverAnswer) => void;
      reject: (e: Error) => void;
    }
  >();
  private previews = new Map<
    string,
    { campaignId: string; rows: ImportedEntry[]; expires: number }
  >();
  private gmail: MailSecret | null = null;
  constructor(
    private store: Store,
    private driver: EntryDriver,
    private codes: CodeProvider,
    private inboxVault: CredentialVault,
    private runnerVault: CredentialVault,
    private proxyVault: (id: string) => CredentialVault<ProxySecret>,
    private supported = process.platform === "win32",
  ) {
    store.entries.recover();
  }
  state(): EntryState {
    if (this.disposed)
      return {
        campaigns: [],
        jobs: [],
        proxies: [],
        logs: [],
        prompts: [],
        activeCampaignId: null,
        running: false,
        paused: false,
        stopping: false,
        secureStorage: false,
        credentialSupport: this.supported,
        inboxEmail: null,
        runnerEmail: null,
      };
    return {
      campaigns: this.store.entries.campaigns(),
      jobs: this.store.entries.jobs(),
      proxies: this.store.entries.proxies(),
      logs: this.store.entries.logs(),
      prompts: [...this.prompts.values()].map((p) => p.value),
      activeCampaignId: this.activeId,
      running: Boolean(this.activeId),
      paused: this.paused,
      stopping: this.stopping,
      secureStorage: this.store.entries.available(),
      credentialSupport: this.supported,
      inboxEmail: this.store.inboxAccount()?.email || null,
      runnerEmail: this.store.entries.runnerEmail(),
    };
  }
  private result(error?: string): EntryResult {
    return {
      ok: !error && !this.disposed,
      state: this.state(),
      error: this.disposed ? "Application is closing." : error,
    };
  }
  private async mutate(fn: () => Promise<void> | void) {
    if (this.disposed) return this.result();
    if (this.busy || this.activeId)
      return this.result(entryError(Error("ENTRY_BUSY")));
    this.busy = true;
    try {
      await fn();
      return this.result();
    } catch (e) {
      return this.result(entryError(e));
    } finally {
      this.busy = false;
    }
  }
  local(fn: () => unknown) {
    return this.mutate(() => {
      fn();
    });
  }
  async connectGmail(input: unknown) {
    return this.mutate(async () => {
      if (!this.supported) throw Error("CREDENTIAL_UNAVAILABLE");
      const value = gmailSchema.parse(input);
      await this.codes.test(value);
      if (this.disposed) return;
      const old = await this.runnerVault.read();
      await this.runnerVault.write(value);
      if (this.disposed) return;
      try {
        this.store.entries.setRunnerEmail(value.email);
      } catch (e) {
        if (old) await this.runnerVault.write(old);
        else await this.runnerVault.remove();
        throw e;
      }
    });
  }
  async disconnectGmail() {
    return this.mutate(async () => {
      const old = await this.runnerVault.read();
      await this.runnerVault.remove();
      try {
        if (!this.disposed) this.store.entries.setRunnerEmail(null);
      } catch (e) {
        if (old) await this.runnerVault.write(old);
        throw e;
      }
    });
  }
  async saveProxy(input: unknown) {
    return this.mutate(async () => {
      if (!this.supported) throw Error("CREDENTIAL_UNAVAILABLE");
      const parsed = proxySchema.parse(input),
        id = parsed.id || randomUUID(),
        server = new URL(parsed.server).toString().replace(/\/$/, "");
      const oldMeta = this.store.entries.proxies().find((p) => p.id === id);
      if (
        oldMeta &&
        oldMeta.server !== server &&
        this.store.entries.jobs().some((j) => j.proxyId === id && j.attempts)
      )
        throw Error("ENTRY_PROXY_FIXED");
      const vault = this.proxyVault(id),
        old = await vault.read();
      await vault.write({
        server,
        username: parsed.username,
        password: parsed.password,
      });
      if (this.disposed) return;
      try {
        this.store.entries.saveProxy(
          id,
          parsed.name,
          server,
          Boolean(parsed.username),
        );
      } catch (e) {
        if (old) await vault.write(old);
        else await vault.remove();
        throw e;
      }
    });
  }
  async removeProxy(input: unknown) {
    return this.mutate(async () => {
      const proxy = this.store.entries.proxy(input);
      if (!this.store.entries.canDeleteProxy(proxy.id))
        throw Error("ENTRY_PROXY_USED");
      const vault = this.proxyVault(proxy.id),
        old = await vault.read();
      await vault.remove();
      if (this.disposed) return;
      try {
        this.store.entries.removeProxy(proxy.id);
      } catch (e) {
        if (old) await vault.write(old);
        throw e;
      }
    });
  }
  private async readProxy(id: string | null) {
    if (!id) return null;
    const record = this.store.entries.proxy(id),
      saved = await this.proxyVault(id).read();
    if (!saved || saved.server !== record.server) throw Error("ENTRY_PROXY");
    return saved;
  }
  async testProxy(id: unknown) {
    return this.mutate(async () => {
      const proxy = this.store.entries.proxy(id),
        secret = await this.readProxy(proxy.id);
      if (!secret) throw Error("ENTRY_PROXY");
      const controller = new AbortController();
      const good = await this.driver.testProxy(secret, controller.signal);
      if (this.disposed) return;
      this.store.entries.proxyHealth(proxy.id, good);
      if (!good) throw Error("ENTRY_PROXY");
    });
  }
  preview(campaignId: string, text: string): EntryImportPreview {
    try {
      if (this.activeId || this.busy) throw Error("ENTRY_BUSY");
      if (!this.store.entries.available()) throw Error("ENTRY_ENCRYPTION");
      const rows = parseEntryCsv(text, this.store.entries.proxies()),
        summary = this.store.entries.importSummary(campaignId, rows),
        token = randomUUID();
      this.previews.clear();
      this.previews.set(token, {
        campaignId,
        rows,
        expires: Date.now() + 10 * 60000,
      });
      return {
        token,
        ...summary,
        rows: previewRows(rows, this.store.entries.proxies()),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      return {
        error:
          message.startsWith("CSV ") ||
          message.startsWith("Row ") ||
          message.startsWith("Use ") ||
          message.startsWith("Import ")
            ? message
            : entryError(e),
      };
    }
  }
  commit(input: unknown) {
    return this.mutate(() => {
      const token = z.string().uuid().parse(input),
        preview = this.previews.get(token);
      if (!preview || preview.expires < Date.now())
        throw Error("ENTRY_MISSING");
      this.store.entries.import(preview.campaignId, preview.rows);
      this.previews.delete(token);
    });
  }
  async start(input: unknown) {
    return this.mutate(async () => {
      const { campaignId, confirmed, reviewJobId } = z
        .object({
          campaignId: z.string().uuid(),
          confirmed: z.literal(true),
          reviewJobId: z.string().uuid().optional(),
        })
        .strict()
        .parse(input);
      if (!confirmed) throw Error("ENTRY_LOCKED");
      if (!this.store.entries.available()) throw Error("ENTRY_ENCRYPTION");
      const campaign = this.store.entries.campaign(campaignId);
      if (campaign.cooldownUntil > Date.now()) throw Error("ENTRY_COOLDOWN");
      const jobs = reviewJobId
        ? [this.store.entries.job(reviewJobId)]
        : this.store.entries
            .jobs()
            .filter(
              (j) => j.campaignId === campaignId && j.status === "Pending",
            );
      if (
        !jobs.length ||
        jobs.some((j) => j.campaignId !== campaignId || !j.readable)
      )
        throw Error("ENTRY_MISSING");
      if (
        reviewJobId &&
        !jobs.every((j) =>
          ["Needs review", "Completed", "Failed"].includes(j.status),
        )
      )
        throw Error("ENTRY_LOCKED");
      this.gmail = null;
      if (!reviewJobId && campaign.gmailSource !== "off") {
        const value = await (
          campaign.gmailSource === "inbox" ? this.inboxVault : this.runnerVault
        ).read();
        const expected =
          campaign.gmailSource === "inbox"
            ? this.store.inboxAccount()?.email
            : this.store.entries.runnerEmail();
        if (!value || value.email !== expected) throw Error("ENTRY_GMAIL");
        this.gmail = gmailSchema.parse(value);
      }
      if (this.disposed) return;
      this.controller = new AbortController();
      this.activeId = campaignId;
      this.paused = false;
      this.stopping = false;
      this.store.entries.log(
        campaignId,
        null,
        reviewJobId
          ? "Existing-entry review opened; new submission is disabled."
          : "Queue started. Every final submission requires a separate review.",
      );
      this.runPromise = this.run(
        campaign,
        jobs.map((j) => j.id),
        Boolean(reviewJobId),
        this.controller.signal,
      ).catch(() => {});
    });
  }
  private async checkpoint(signal: AbortSignal) {
    if (signal.aborted || this.disposed) throw Error("ENTRY_STOP");
    while (this.paused && !signal.aborted && !this.disposed)
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
            signal.removeEventListener("abort", stop);
            this.wakes.delete(wake);
            resolve();
          },
          stop = () => {
            this.wakes.delete(wake);
            reject(Error("ENTRY_STOP"));
          };
        this.wakes.add(wake);
        signal.addEventListener("abort", stop, { once: true });
      });
    if (signal.aborted || this.disposed) throw Error("ENTRY_STOP");
  }
  private async question(
    jobId: string,
    kind: EntryPrompt["kind"],
    message: string,
    signal: AbortSignal,
  ) {
    await this.checkpoint(signal);
    const id = randomUUID(),
      value: EntryPrompt = {
        id,
        jobId,
        kind,
        message,
        createdAt: new Date().toISOString(),
      };
    this.store.entries.status(
      jobId,
      kind === "review" ? "Ready" : "Waiting",
      kind === "review"
        ? "Review before submission"
        : kind === "code"
          ? "Manual verification code"
          : "Waiting for you",
    );
    return new Promise<DriverAnswer>((resolve, reject) => {
      const stop = () => {
        this.prompts.delete(id);
        reject(Error("ENTRY_STOP"));
      };
      signal.addEventListener("abort", stop, { once: true });
      this.prompts.set(id, {
        value,
        resolve: (answer) => {
          signal.removeEventListener("abort", stop);
          this.prompts.delete(id);
          if (!this.disposed)
            this.store.entries.status(
              jobId,
              "Running",
              "Continuing requested step",
            );
          resolve(answer);
        },
        reject,
      });
    });
  }
  private async run(
    campaign: EntryCampaign,
    ids: string[],
    reviewOnly: boolean,
    signal: AbortSignal,
  ) {
    let next = 0;
    const lane = async () => {
      while (next < ids.length && !signal.aborted && !this.disposed) {
        await this.checkpoint(signal);
        const id = ids[next++];
        const original = this.store.entries.job(id);
        try {
          if (!reviewOnly) this.store.entries.begin(id);
          else if (reviewOnly && original.status === "Completed")
            this.store.entries.status(
              id,
              "Completed",
              "Previously confirmed",
              original.note,
            );
          else
            this.store.entries.status(
              id,
              "Running",
              "Opening existing-entry review",
            );
          const job = this.store.entries.job(id),
            profile = this.store.entries.profile(id),
            proxy = await this.readProxy(job.proxyId);
          await this.checkpoint(signal);
          const control: EntryControl = {
            jobId: id,
            signal,
            checkpoint: () => this.checkpoint(signal),
            stage: (stage) => {
              if (!this.disposed && !signal.aborted)
                this.store.entries.status(id, "Running", stage);
            },
            wait: (kind, message) => this.question(id, kind, message, signal),
            code: async (since) => {
              if (!this.gmail) return null;
              try {
                const found = await this.codes.find(
                  this.gmail,
                  profile.email,
                  since,
                  campaign.senderDomains,
                  signal,
                  () => this.checkpoint(signal),
                  (key) =>
                    !this.disposed && this.store.entries.claimCode(key, id),
                );
                return found?.code || null;
              } catch {
                if (signal.aborted) throw Error("ENTRY_STOP");
                if (!this.disposed)
                  this.store.entries.log(
                    campaign.id,
                    id,
                    "Automatic code lookup unavailable; manual verification is required.",
                  );
                return null;
              }
            },
            intent: () => {
              if (reviewOnly) throw Error("ENTRY_LOCKED");
              this.store.entries.intent(id);
            },
            rateLimit: (until) => {
              if (this.disposed || signal.aborted) return;
              this.store.entries.cooldown(
                campaign.id,
                Math.min(until, 8640000000000000),
              );
              this.paused = true;
              this.store.entries.log(
                campaign.id,
                id,
                "Site rate limit received. The queue is paused; proxy rotation and automatic retry are disabled.",
              );
            },
          };
          const result = await this.driver.run(
            campaign,
            profile,
            proxy,
            control,
            reviewOnly,
          );
          if (this.disposed) return;
          if (result.kind === "confirmed" || result.kind === "existing")
            this.store.entries.complete(id, result.rule!);
          else
            this.store.entries.status(
              id,
              reviewOnly && original.status === "Completed"
                ? "Completed"
                : result.kind === "skipped" &&
                    !this.store.entries.job(id).submissionStartedAt
                  ? "Skipped"
                  : "Needs review",
              result.kind === "skipped"
                ? "Skipped by operator"
                : "Confirmation required",
              "No new entry is assumed successful without a recognized site confirmation.",
            );
        } catch (e) {
          if (this.disposed) return;
          const job = this.store.entries.job(id),
            stopped = signal.aborted;
          this.store.entries.status(
            id,
            reviewOnly && original.status === "Completed"
              ? "Completed"
              : stopped || job.submissionStartedAt
                ? "Needs review"
                : "Failed",
            stopped ? "Stopped" : "Attempt requires attention",
            stopped
              ? "Browser run stopped. Check the site before retrying."
              : entryError(e),
          );
          this.store.entries.log(
            campaign.id,
            id,
            stopped
              ? "Attempt stopped; no success was assumed."
              : "Attempt could not finish; inspect the profile and browser before retrying.",
          );
        }
      }
    };
    try {
      await Promise.allSettled(
        Array.from(
          {
            length: reviewOnly ? 1 : Math.min(campaign.concurrency, ids.length),
          },
          () => lane(),
        ),
      );
    } finally {
      for (const pending of this.prompts.values())
        pending.reject(Error("ENTRY_STOP"));
      this.prompts.clear();
      this.gmail = null;
      this.activeId = null;
      this.paused = false;
      this.stopping = false;
      this.controller = null;
      for (const wake of this.wakes) wake();
      this.wakes.clear();
      if (!this.disposed)
        this.store.entries.log(
          campaign.id,
          null,
          "Queue finished or stopped. Pending and review records were retained.",
        );
    }
  }
  answer(input: unknown) {
    try {
      const value = z
          .object({
            promptId: z.string().uuid(),
            action: z.enum(["continue", "submit", "skip"]),
            code: z
              .string()
              .regex(/^\d{4,8}$/)
              .optional(),
            confirmed: z.boolean().optional(),
          })
          .strict()
          .parse(input) as EntryAnswer,
        prompt = this.prompts.get(value.promptId);
      if (!prompt) throw Error("ENTRY_MISSING");
      if (value.code && prompt.value.kind !== "code")
        throw Error("ENTRY_LOCKED");
      if (
        value.action === "submit" &&
        (prompt.value.kind !== "review" || value.confirmed !== true)
      )
        throw Error("ENTRY_LOCKED");
      if (
        prompt.value.kind === "verify" &&
        value.action !== "skip" &&
        value.confirmed !== true
      )
        throw Error("ENTRY_CONFIRMATION");
      if (
        this.activeId &&
        this.store.entries.campaign(this.activeId).cooldownUntil > Date.now()
      )
        throw Error("ENTRY_COOLDOWN");
      if (this.paused) throw Error("ENTRY_BUSY");
      prompt.resolve(value);
      return this.result();
    } catch (e) {
      return this.result(entryError(e));
    }
  }
  async focus(id: unknown) {
    try {
      const job = this.store.entries.job(id);
      if (
        job.campaignId !== this.activeId ||
        !["Running", "Waiting", "Ready"].includes(job.status)
      )
        throw Error("ENTRY_MISSING");
      await this.driver.focus?.(job.id);
      return this.result();
    } catch (e) {
      return this.result(entryError(e));
    }
  }
  pause() {
    if (!this.activeId) return this.result(entryError(Error("ENTRY_MISSING")));
    this.paused = true;
    this.store.entries.log(
      this.activeId,
      null,
      "Automation paused at checkpoints; browser windows remain open.",
    );
    return this.result();
  }
  resume() {
    if (!this.activeId) return this.result(entryError(Error("ENTRY_MISSING")));
    if (this.store.entries.campaign(this.activeId).cooldownUntil > Date.now())
      return this.result(entryError(Error("ENTRY_COOLDOWN")));
    this.paused = false;
    for (const wake of this.wakes) wake();
    this.wakes.clear();
    return this.result();
  }
  async stop() {
    if (this.activeId) {
      this.stopping = true;
      this.controller?.abort();
      this.codes.cancel();
      this.driver.stop();
      await this.runPromise;
    }
    return this.result();
  }
  shutdown() {
    this.disposed = true;
    this.controller?.abort();
    this.codes.cancel();
    this.driver.stop();
    for (const p of this.prompts.values()) p.reject(Error("ENTRY_STOP"));
    this.prompts.clear();
    this.previews.clear();
    this.gmail = null;
  }
}
