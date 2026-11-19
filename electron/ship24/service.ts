import { z } from "zod";
import type { CredentialVault } from "../inbox/credentials";
import type { Ship24Result, Ship24State } from "../../src/ship24-types";
import { Ship24Repository, type Binding } from "./store";
import { Ship24Provider, Ship24Error } from "./provider";
import {
  digest,
  keySchema,
  registrationSchema,
  parseResults,
  trackingNumber,
} from "./model";
export type Ship24Secret = { apiKey: string };
const messages: Record<string, string> = {
  AUTH: "Ship24 rejected this key or plan. Use a Tracking API per-shipment plan key.",
  RATE: "Ship24 asked us to slow down. Wait for the cooldown before retrying.",
  QUOTA:
    "Ship24 reports insufficient quota. Review your plan in its dashboard.",
  NETWORK: "Ship24 could not be reached. Existing results were kept.",
  NO_RESULTS:
    "Ship24 has no new results yet. Previous carrier results were kept.",
  FORMAT: "Ship24 returned an unexpected response. Existing results were kept.",
  LOCAL_CAP:
    "The local monthly registration cap was reached. Existing trackers can still be refreshed.",
  UNCERTAIN:
    "Registration may have reached Ship24. Use Recover registration; no new tracker will be created while the result is uncertain.",
  ARCHIVED:
    "This tracker is archived in Ship24. Review it in the Ship24 dashboard.",
  REJECTED:
    "Ship24 rejected the registration. Review the tracking details and your account.",
  SOURCE:
    "The source changed. Close this form, refresh, and review the current tracking number.",
  MISSING: "This tracker or source is no longer available.",
  WAIT: "Wait 30 seconds before refreshing this tracker again.",
  BUSY: "Another Ship24 operation is running. Please wait.",
  UNSUPPORTED: "Secure Ship24 credentials require Windows Credential Manager.",
  RESULT_OLD:
    "The reported delivery predates the purchase or shipping date. Review the tracking number and shipment details.",
  RESULT_MISMATCH:
    "Ship24 returned results for a different tracker. Existing results were retained.",
};
export class Ship24Service {
  private lastError: string | undefined;
  private secret: Ship24Secret | null = null;
  private busy = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    private repo: Ship24Repository,
    private vault: CredentialVault<Ship24Secret>,
    private provider: Ship24Provider,
    private windows = process.platform === "win32",
  ) {}
  platformSupported() {
    return this.windows;
  }
  async initialize() {
    if (!this.platformSupported()) return;
    try {
      const secret = await this.vault.read();
      this.alive();
      this.secret = secret ? keySchema.parse(secret) : null;
      if (
        this.repo.settings().connected &&
        (!this.secret ||
          this.repo.settings().connectionTag !== digest(this.secret.apiKey))
      )
        this.repo.configure(false, null);
    } catch {
      this.secret = null;
      if (this.repo.settings().connected) this.repo.configure(false, null);
    }
  }
  state(): Ship24State {
    if (this.stopped)
      return {
        connected: false,
        supported: this.platformSupported(),
        busy: false,
        autoEnabled: false,
        monthlyCap: 10,
        usedThisMonth: 0,
        month: new Date().toISOString().slice(0, 7),
        cooldownUntil: 0,
        sources: [],
        trackers: [],
      };
    const s = this.repo.settings();
    return {
      error: this.lastError,
      connected: s.connected && !!this.secret,
      supported: this.platformSupported(),
      busy: this.busy,
      autoEnabled: s.autoEnabled,
      monthlyCap: s.monthlyCap,
      usedThisMonth: this.repo.used(),
      month: new Date().toISOString().slice(0, 7),
      cooldownUntil: s.cooldownUntil,
      sources: this.repo.sources(),
      trackers: this.repo.publicTrackers(),
    };
  }
  private result(error?: string): Ship24Result {
    return { ok: !error, error, state: this.state() };
  }
  private alive() {
    if (this.stopped) throw new Ship24Error("CLOSING");
  }
  private explain(e: unknown) {
    const code =
      e instanceof Ship24Error
        ? e.code
        : e instanceof Error
          ? e.message
          : "FORMAT";
    if (e instanceof Ship24Error && e.retryUntil && !this.stopped)
      this.repo.cooldown(e.retryUntil);
    return (
      messages[code] ||
      "Could not complete Ship24 tracking. Check the fields, connection and storage permissions."
    );
  }
  private async request<T>(fn: () => Promise<T>) {
    this.alive();
    const s = this.repo.settings();
    if (Date.now() < s.cooldownUntil) throw new Ship24Error("RATE");
    const delay = 1000 - (Date.now() - s.lastRequestAt);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    this.alive();
    this.repo.request();
    const value = await fn();
    this.alive();
    return value;
  }
  private async run(fn: () => Promise<void>) {
    if (this.busy) return this.result(messages.BUSY);
    if (!this.platformSupported()) return this.result(messages.UNSUPPORTED);
    this.busy = true;
    let error: string | undefined;
    try {
      this.alive();
      await fn();
    } catch (e) {
      error = this.stopped ? "Application is closing." : this.explain(e);
    } finally {
      this.busy = false;
      this.lastError = error;
    }
    return this.result(error);
  }
  connect(input: unknown) {
    return this.run(async () => {
      const next = keySchema.parse(input),
        previous = this.secret;
      await this.request(() => this.provider.verify(next.apiKey));
      try {
        await this.vault.write(next);
        this.alive();
        this.repo.configure(true, digest(next.apiKey));
        this.secret = next;
      } catch (e) {
        try {
          if (previous) await this.vault.write(previous);
          else await this.vault.remove();
        } catch {
          /* No plaintext fallback. */
        }
        throw e;
      }
    });
  }
  disconnect() {
    return this.run(async () => {
      const previous = this.secret;
      try {
        await this.vault.remove();
        this.alive();
        this.repo.configure(false, null);
        this.secret = null;
      } catch (e) {
        if (previous)
          try {
            await this.vault.write(previous);
          } catch {
            /* Credential failure remains local. */
          }
        throw e;
      }
    });
  }
  preferences(input: unknown) {
    return this.run(async () => {
      const data = z
        .object({
          autoEnabled: z.boolean(),
          monthlyCap: z.number().int().min(1).max(1000),
        })
        .strict()
        .parse(input);
      if (data.autoEnabled && !this.secret) throw new Ship24Error("AUTH");
      this.repo.preferences(data.autoEnabled, data.monthlyCap);
    });
  }
  register(input: unknown) {
    return this.run(async () => {
      if (!this.secret || !this.repo.settings().connected)
        throw new Ship24Error("AUTH");
      const p = registrationSchema.parse(input),
        source = this.repo
          .sources()
          .find(
            (s) =>
              s.type === p.source.type &&
              s.id === p.source.id &&
              s.signature === p.source.signature,
          );
      if (!source) throw new Ship24Error("SOURCE");
      const payload: Record<string, any> = {
        trackingNumber: source.trackingNumber,
      };
      if (source.carrier !== "Other") payload.courierName = source.carrier;
      if (p.destinationCountryCode)
        payload.destinationCountryCode = p.destinationCountryCode;
      if (p.destinationPostCode)
        payload.destinationPostCode = p.destinationPostCode;
      if (p.shippingDate) payload.shippingDate = p.shippingDate;
      if (
        this.repo
          .all()
          .some(
            (r) =>
              r.connectionTag === digest(this.secret!.apiKey) &&
              r.attempted &&
              r.phase === "uncertain" &&
              r.sources.some((s) => s.signature === source.signature),
          )
      )
        throw new Ship24Error("UNCERTAIN");
      const row = this.repo.prepare(
        digest(this.secret.apiKey),
        payload,
        source,
      );
      if (row.phase === "active" && row.providerId) return;
      try {
        const found = await this.request(() =>
          this.provider.find(this.secret!.apiKey, row.clientTrackerId),
        );
        if (found) {
          if (
            trackingNumber(found.trackingNumber) !== source.trackingNumber ||
            found.clientTrackerId !== row.clientTrackerId
          )
            throw new Ship24Error("RESULT_MISMATCH");
          if (found.isSubscribed === false) throw new Ship24Error("ARCHIVED");
          this.repo.activate(row.id, found.trackerId);
          return;
        }
        if (row.attempted) throw new Ship24Error("UNCERTAIN");
        if (!this.repo.sources().some((s) => s.signature === source.signature))
          throw new Ship24Error("SOURCE");
        this.repo.reserve(row.id);
        const created = await this.request(() =>
          this.provider.create(this.secret!.apiKey, row.payload),
        );
        if (
          trackingNumber(created.trackingNumber) !== source.trackingNumber ||
          created.clientTrackerId !== row.clientTrackerId
        )
          throw new Ship24Error("RESULT_MISMATCH");
        this.repo.activate(row.id, created.trackerId);
      } catch (e) {
        if (!this.stopped) {
          const error = this.explain(e);
          this.repo.fail(row.id, error, !!this.repo.get(row.id)?.attempted);
        }
        throw e;
      }
    });
  }
  recover(input: unknown) {
    return this.run(async () => {
      const id = z.string().uuid().parse(input),
        row = this.repo.get(id);
      if (!row) throw new Ship24Error("MISSING");
      if (
        !this.secret ||
        row.connectionTag !== digest(this.secret.apiKey) ||
        !this.repo.settings().connected
      )
        throw new Ship24Error("AUTH");
      const tracker = await this.request(() =>
        this.provider.find(this.secret!.apiKey, row.clientTrackerId),
      );
      if (!tracker) throw new Ship24Error("UNCERTAIN");
      if (
        tracker.clientTrackerId !== row.clientTrackerId ||
        trackingNumber(tracker.trackingNumber) !== row.payload.trackingNumber
      )
        throw new Ship24Error("RESULT_MISMATCH");
      if (tracker.isSubscribed === false) throw new Ship24Error("ARCHIVED");
      this.repo.activate(row.id, tracker.trackerId);
    });
  }
  private async refreshRow(row: Binding) {
    if (
      !this.secret ||
      !this.repo.settings().connected ||
      row.connectionTag !== digest(this.secret.apiKey)
    )
      throw new Ship24Error("AUTH");
    if (!row.providerId) throw new Ship24Error("UNCERTAIN");
    if (Date.now() - row.lastAttempt < 30000) throw new Ship24Error("WAIT");
    const sources = this.repo.sources();
    if (
      !row.sources.some((s) => sources.some((c) => c.signature === s.signature))
    )
      throw new Ship24Error("SOURCE");
    try {
      const raw = await this.request(() =>
        this.provider.results(this.secret!.apiKey, row.providerId!),
      );
      const earliest =
        [row.payload.shippingDate, ...row.sources.map((s) => s.earliestDate)]
          .filter(Boolean)
          .sort()
          .at(-1) || null;
      const summary = parseResults(
        raw,
        row.providerId,
        String(row.payload.trackingNumber),
        earliest,
      );
      if (
        row.summary &&
        (summary.shipmentCount === 0 ||
          (summary.status === null && !summary.events.length))
      )
        throw new Ship24Error("NO_RESULTS");
      this.repo.update(row.id, summary);
    } catch (e) {
      if (!this.stopped) this.repo.fail(row.id, this.explain(e));
      throw e;
    }
  }
  refresh(input: unknown) {
    return this.run(async () => {
      const id = z.string().uuid().parse(input),
        row = this.repo.get(id);
      if (!row) throw new Ship24Error("MISSING");
      await this.refreshRow(row);
    });
  }
  start() {
    this.timer = setInterval(() => void this.tick(), 60000);
  }
  async tick() {
    if (this.stopped || this.busy || !this.secret) return;
    const s = this.repo.settings();
    if (
      !s.autoEnabled ||
      Date.now() < s.nextPoll ||
      Date.now() < s.cooldownUntil
    )
      return;
    await this.run(async () => {
      this.repo.nextPoll();
      const sources = this.repo.sources();
      const rows = this.repo
        .all()
        .filter(
          (r) =>
            r.connectionTag === s.connectionTag &&
            r.phase === "active" &&
            !["Delivered"].includes(r.summary?.status || "") &&
            r.sources.some((v) =>
              sources.some((c) => c.signature === v.signature),
            ),
        )
        .sort((a, b) => a.lastAttempt - b.lastAttempt)
        .slice(0, 20);
      let failed = false;
      for (const row of rows) {
        try {
          await this.refreshRow(row);
        } catch (e) {
          failed = true;
          if (
            e instanceof Ship24Error &&
            ["RATE", "AUTH", "QUOTA", "CLOSING"].includes(e.code)
          )
            throw e;
        }
      }
      if (failed)
        throw Error(
          "Some trackers could not refresh; successful updates were retained.",
        );
    });
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.provider.stop();
    this.secret = null;
  }
}
