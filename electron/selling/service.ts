import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { CredentialVault } from "../inbox/credentials";
import type { SellingRepository } from "./store";
import type { EbayMarket, RemoteOffer } from "./ebay";
import { EbayError } from "./ebay";
import { connectionSchema, connectionKey, publishReady, unitId } from "./model";
import type {
  EbayConnectionInput,
  SellingState,
  SellingReviewResult,
  SellingUnit,
  PublishReview,
  CategoryGuide,
} from "../../src/selling-types";
export function sellingError(error: unknown) {
  if (error instanceof EbayError)
    return error.kind === "auth"
      ? "eBay rejected account access. Check the environment, app credentials, user refresh token, and required scopes."
      : error.kind === "rate"
        ? "eBay request limit reached. Wait for its cooldown before retrying."
        : error.kind === "validation"
          ? `eBay declined the request${error.ids ? " (" + error.ids + ")" : ""}. Check the category, condition descriptors, required item specifics, photos, business policies and seller eligibility.`
          : error.kind === "missing"
            ? "eBay could not find this offer in the connected account. Check the account and environment; no replacement listing was created."
            : "Could not confirm eBay's response. Check the saved offer status before retrying a publish or ending operation.";
  const code = error instanceof Error ? error.message : "";
  return (
    (
      {
        SELL_STOCK:
          "No unallocated copies remain for this collection entry. Each draft reserves one copy, including sold copies.",
        SELL_LOCKED:
          "This listing pair is locked. Live, ended, or sold offers cannot be edited or deleted as drafts.",
        SELL_FIELDS:
          "Complete the title, price, description, photo, category, ship-from location and all three eBay policy fields.",
        SELL_URL:
          "Use the exact HTTPS Mercari US item link (mercari.com/us/item/m…).",
        SELL_MATCH:
          "The saved listing identifiers do not match. No other listing was changed.",
        SELL_REVIEW:
          "The publish review expired or the draft changed. Prepare it again and review the latest details.",
        SELL_KEY: "Connect your eBay seller API credentials first.",
        SELL_ENV:
          "Reconnect the account/environment that owns this exact eBay offer.",
        SELL_AMBIGUOUS:
          "More than one offer was returned for this SKU. Resolve the ambiguity in eBay before continuing.",
        CREDENTIAL_UNAVAILABLE:
          "Windows Credential Manager is unavailable. Connect eBay on your Windows PC; there is no plaintext credential fallback.",
        SELL_CLOSED: "Application is closing.",
      } as Record<string, string>
    )[code] ||
    "Could not complete this selling request. Check the fields, account connection and local storage permissions."
  );
}
export class SellingService {
  private busy = false;
  private stopped = false;
  private progress = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private reviews = new Map<
    string,
    { id: string; revision: number; key: string; expires: number }
  >();
  constructor(
    private repo: SellingRepository,
    private vault: CredentialVault<EbayConnectionInput>,
    private provider: EbayMarket,
    private supported = process.platform === "win32",
  ) {}
  state(): SellingState {
    if (this.stopped)
      return {
        units: [],
        stock: [],
        settings: {
          connected: false,
          supported: this.supported,
          environment: "sandbox",
          label: "",
          connectionKey: null,
          automatic: false,
          options: { locations: [], fulfillment: [], payment: [], returns: [] },
          lastSync: null,
          nextSync: null,
          cooldownUntil: 0,
          error: null,
        },
        busy: false,
        progress: "",
      };
    return {
      units: this.repo.units(),
      stock: this.repo.stock(),
      settings: this.repo.settings(this.supported),
      busy: this.busy,
      progress: this.progress,
    };
  }
  private open() {
    if (this.stopped) throw Error("SELL_CLOSED");
  }
  private async run(
    fn: () => Promise<void | PublishReview>,
  ): Promise<SellingReviewResult> {
    if (this.stopped)
      return {
        ok: false,
        state: this.state(),
        error: "Application is closing.",
      };
    if (this.busy)
      return {
        ok: false,
        state: this.state(),
        error: "A selling operation is already running.",
      };
    this.busy = true;
    let review: PublishReview | undefined, error: string | undefined;
    try {
      review = (await fn()) || undefined;
    } catch (e) {
      error = sellingError(e);
    } finally {
      this.busy = false;
      this.progress = "";
    }
    return {
      ok: !error && !this.stopped,
      state: this.state(),
      ...(review ? { review } : {}),
      error: this.stopped ? "Application is closing." : error,
    };
  }
  private async secret() {
    if (!this.repo.settings().connected) throw Error("SELL_KEY");
    const secret = connectionSchema.parse(await this.vault.read());
    this.open();
    if (connectionKey(secret) !== this.repo.settings().connectionKey)
      throw Error("SELL_KEY");
    return secret;
  }
  private owner(unit: SellingUnit, secret: EbayConnectionInput) {
    if (unit.environment && unit.environment !== secret.environment)
      throw Error("SELL_ENV");
    if (unit.connectionKey && unit.connectionKey !== connectionKey(secret))
      throw Error("SELL_ENV");
  }
  private match(unit: SellingUnit, remote: RemoteOffer) {
    if (
      remote.sku !== unit.sku ||
      (unit.offerId && unit.offerId !== remote.id) ||
      (unit.ebayListingId &&
        remote.listingId &&
        unit.ebayListingId !== remote.listingId)
    )
      throw Error("SELL_MATCH");
  }
  async connect(input: unknown) {
    return this.run(async () => {
      if (!this.supported) throw Error("CREDENTIAL_UNAVAILABLE");
      const value = connectionSchema.parse(input),
        key = connectionKey(value);
      this.progress = "Checking eBay access and listing policies…";
      const options = await this.provider.options(value);
      this.open();
      const existing = this.repo
        .units()
        .filter(
          (u) =>
            u.offerId &&
            u.environment === value.environment &&
            !["inactive", "sold"].includes(u.ebayState) &&
            u.connectionKey !== key,
        );
      if (existing.length > 100) throw Error("SELL_AMBIGUOUS");
      for (const unit of existing) {
        const remote = await this.provider.offer(value, unit.offerId!);
        this.open();
        this.match(unit, remote);
      }
      const old = await this.vault.read();
      this.open();
      await this.vault.write(value);
      this.open();
      try {
        this.repo.connect(value, key, options);
      } catch (e) {
        try {
          if (old) await this.vault.write(old);
          else await this.vault.remove();
        } catch {}
        throw e;
      }
      this.reviews.clear();
    });
  }
  async disconnect() {
    return this.run(async () => {
      const old = await this.vault.read();
      this.open();
      await this.vault.remove();
      this.open();
      try {
        this.repo.disconnect();
      } catch (e) {
        if (old) await this.vault.write(old);
        throw e;
      }
      this.reviews.clear();
      this.provider.forgetAuth?.();
    });
  }
  local(action: () => unknown) {
    return this.run(async () => {
      action();
    });
  }
  async refreshOptions() {
    return this.run(async () => {
      const secret = await this.secret();
      const options = await this.provider.options(secret);
      this.open();
      this.repo.options(options);
    });
  }
  async createLocation(input: unknown) {
    return this.run(async () => {
      const value = z
        .object({
          name: z.string().trim().min(1).max(80),
          zip: z.string().regex(/^\d{5}(?:-\d{4})?$/),
        })
        .strict()
        .parse(input);
      const secret = await this.secret();
      await this.provider.location(
        secret,
        "PT-" + randomUUID(),
        value.name,
        value.zip,
      );
      this.open();
      const options = await this.provider.options(secret);
      this.open();
      this.repo.options(options);
    });
  }
  async upload(id: unknown, bytes: Uint8Array) {
    return this.run(async () => {
      const unit = this.repo.get(id);
      if (
        unit.soldOn ||
        !["draft", "prepared"].includes(unit.ebayState) ||
        unit.photoUrls.length >= 24
      )
        throw Error("SELL_LOCKED");
      const secret = await this.secret();
      this.owner(unit, secret);
      const url = await this.provider.upload(secret, bytes);
      this.open();
      this.repo.addPhoto(unit.id, url);
    });
  }
  async prepare(input: unknown) {
    return this.run(async () => {
      const unit = this.repo.get(input);
      if (
        unit.soldOn ||
        !["draft", "prepared", "uncertain"].includes(unit.ebayState)
      )
        throw Error("SELL_LOCKED");
      const draft = publishReady(this.repo.draft(unit)),
        secret = await this.secret();
      this.owner(unit, secret);
      this.progress = "Preparing an unpublished eBay offer…";
      const remote = unit.offerId
        ? await this.provider.offer(secret, unit.offerId)
        : await this.provider.findOffer(secret, unit.sku);
      this.open();
      if (remote) {
        this.match(unit, remote);
        if (remote.status === "PUBLISHED") {
          if (!remote.listingId) throw Error("SELL_MATCH");
          this.repo.patch(unit.id, {
            environment: secret.environment,
            connectionKey: connectionKey(secret),
            offerId: remote.id,
            ebayListingId: remote.listingId,
            ebayState: remote.ended ? "inactive" : "active",
            error: null,
          });
          return;
        }
        if (unit.ebayListingId) {
          this.repo.patch(unit.id, { ebayState: "inactive", error: null });
          return;
        }
      }
      this.repo.patch(unit.id, {
        environment: secret.environment,
        connectionKey: connectionKey(secret),
        ...(remote ? { offerId: remote.id } : {}),
        error: null,
      });
      await this.provider.inventory(secret, unit.sku, draft);
      this.open();
      const offerId = await this.provider.saveOffer(
        secret,
        unit.sku,
        draft,
        remote?.id || null,
      );
      this.open();
      this.repo.patch(unit.id, { offerId, ebayState: "prepared", error: null });
      const saved = this.repo.get(unit.id),
        token = randomUUID(),
        expires = Date.now() + 10 * 60000;
      this.reviews.clear();
      this.reviews.set(token, {
        id: unit.id,
        revision: saved.revision,
        key: connectionKey(secret),
        expires,
      });
      return {
        token,
        unit: saved,
        environment: secret.environment,
        expiresAt: new Date(expires).toISOString(),
        options: this.repo.settings().options,
      };
    });
  }
  async category(input: unknown) {
    let guide: CategoryGuide | undefined;
    const result = await this.run(async () => {
      const id = z
        .string()
        .regex(/^\d{1,30}$/)
        .parse(input);
      guide = await this.provider.guide(await this.secret(), id);
      this.open();
    });
    return { ...result, guide };
  }
  async publish(input: unknown) {
    return this.run(async () => {
      const { token, confirmed } = z
          .object({ token: z.string().uuid(), confirmed: z.literal(true) })
          .strict()
          .parse(input),
        review = this.reviews.get(token);
      if (!review || !confirmed || review.expires < Date.now())
        throw Error("SELL_REVIEW");
      const unit = this.repo.get(review.id),
        secret = await this.secret();
      this.owner(unit, secret);
      if (
        unit.revision !== review.revision ||
        review.key !== connectionKey(secret) ||
        unit.soldOn ||
        unit.ebayState !== "prepared" ||
        !unit.offerId
      )
        throw Error("SELL_REVIEW");
      const remote = await this.provider.offer(secret, unit.offerId);
      this.open();
      this.match(unit, remote);
      this.reviews.delete(token);
      if (remote.status === "PUBLISHED") {
        if (!remote.listingId) throw Error("SELL_MATCH");
        this.repo.patch(unit.id, {
          ebayListingId: remote.listingId,
          ebayState: remote.ended ? "inactive" : "active",
          error: null,
        });
        return;
      }
      this.progress = "Publishing this one copy to eBay…";
      this.repo.patch(unit.id, {
        ebayState: "uncertain",
        error: "Publication is in progress or needs reconciliation.",
      });
      try {
        const listingId = await this.provider.publish(secret, unit.offerId);
        this.open();
        this.repo.patch(unit.id, {
          ebayListingId: listingId,
          ebayState: "active",
          error: null,
        });
      } catch (e) {
        if (!this.stopped)
          this.repo.patch(unit.id, {
            ebayState:
              e instanceof EbayError &&
              ["validation", "auth", "rate"].includes(e.kind)
                ? "prepared"
                : "uncertain",
            error: sellingError(e),
          });
        throw e;
      }
    });
  }
  private async reconcileOne(secret: EbayConnectionInput, unit: SellingUnit) {
    this.owner(unit, secret);
    if (!unit.offerId) throw Error("SELL_MISSING");
    const remote = await this.provider.offer(secret, unit.offerId);
    this.open();
    this.match(unit, remote);
    if (remote.status === "PUBLISHED") {
      if (!remote.listingId) throw Error("SELL_MATCH");
      this.repo.patch(unit.id, {
        ebayListingId: remote.listingId,
        ebayState:
          unit.ebayState === "sold"
            ? "sold"
            : remote.ended
              ? "inactive"
              : "active",
        error: null,
      });
    } else
      this.repo.patch(unit.id, {
        ebayState: unit.ebayListingId || unit.soldOn ? "inactive" : "prepared",
        error: null,
      });
  }
  async reconcile(id: unknown) {
    return this.run(async () => {
      await this.reconcileOne(await this.secret(), this.repo.get(id));
    });
  }
  private async endOne(secret: EbayConnectionInput, unit: SellingUnit) {
    this.owner(unit, secret);
    if (!unit.offerId) throw Error("SELL_MISSING");
    if (unit.ebayState === "sold") return;
    const remote = await this.provider.offer(secret, unit.offerId);
    this.open();
    this.match(unit, remote);
    if (remote.status === "UNPUBLISHED" || remote.ended) {
      this.repo.patch(unit.id, {
        ...(remote.listingId ? { ebayListingId: remote.listingId } : {}),
        ebayState: "inactive",
        error: null,
      });
      return;
    }
    if (!remote.listingId) throw Error("SELL_MATCH");
    this.repo.patch(unit.id, {
      ebayListingId: remote.listingId,
      ebayState: "uncertain",
      error: "Ending the eBay offer needs confirmation.",
    });
    try {
      await this.provider.withdraw(secret, unit.offerId);
      this.open();
      this.repo.patch(unit.id, { ebayState: "inactive", error: null });
    } catch (e) {
      if (!this.stopped) this.repo.patch(unit.id, { error: sellingError(e) });
      throw e;
    }
  }
  async end(id: unknown) {
    return this.run(async () => {
      await this.endOne(await this.secret(), this.repo.get(id));
    });
  }
  async mercariSale(input: unknown) {
    return this.run(async () => {
      const id = this.repo.mercariSale(input),
        unit = this.repo.get(id),
        settings = this.repo.settings();
      if (
        unit.autoEndEbay &&
        unit.offerId &&
        !["inactive", "sold"].includes(unit.ebayState) &&
        settings.connected
      ) {
        await this.endOne(await this.secret(), unit);
      }
    });
  }
  async sync() {
    return this.run(async () => {
      try {
        const secret = await this.secret();
        this.progress = "Checking exact eBay listing IDs and SKUs for sales…";
        for (const unit of this.repo
          .units()
          .filter(
            (u) =>
              u.environment === secret.environment &&
              u.connectionKey === connectionKey(secret) &&
              u.offerId &&
              u.ebayState === "uncertain",
          )
          .slice(0, 10))
          await this.reconcileOne(secret, unit);
        const cycle = this.repo.cycle(),
          settings = this.repo.settings(),
          start =
            cycle.cycleStart ||
            (settings.lastSync
              ? new Date(
                  Math.max(
                    Date.now() - 90 * 86400000,
                    Date.parse(settings.lastSync) - 120000,
                  ),
                ).toISOString()
              : new Date(Date.now() - 30 * 86400000).toISOString()),
          end = cycle.cycleEnd || new Date().toISOString();
        let offset = cycle.cycleOffset;
        for (let page = 0; page < 5; page++) {
          const data = await this.provider.orders(secret, start, end, offset);
          this.open();
          if (data.more && !data.count) throw Error("SELL_AMBIGUOUS");
          offset += data.count;
          this.repo.page(data.sales, start, end, offset, data.more);
          if (!data.more) break;
        }
        for (const unit of this.repo
          .units()
          .filter(
            (u) =>
              u.soldOn === "mercari" &&
              u.autoEndEbay &&
              u.offerId &&
              u.environment === secret.environment &&
              u.connectionKey === connectionKey(secret) &&
              !["inactive", "sold"].includes(u.ebayState),
          )
          .slice(0, 10)) {
          try {
            await this.endOne(secret, unit);
          } catch (e) {
            this.open();
            this.repo.patch(unit.id, { error: sellingError(e) });
          }
        }
      } catch (e) {
        if (!this.stopped) this.repo.syncError(sellingError(e));
        throw e;
      }
    });
  }
  start() {
    if (this.timer) clearInterval(this.timer);
    const tick = () => {
      if (this.stopped || this.busy) return;
      const s = this.repo.settings();
      if (
        s.connected &&
        s.automatic &&
        s.cooldownUntil <= Date.now() &&
        (!s.nextSync || Date.parse(s.nextSync) <= Date.now())
      )
        void this.sync().catch(() => {});
    };
    this.timer = setInterval(tick, 60000);
    this.timer.unref();
    tick();
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.provider.cancel();
    this.reviews.clear();
  }
}
