import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { CredentialVault } from "../inbox/credentials";
import type { CollectionRepository } from "./store";
import type { MarketDataProvider } from "./justtcg";
import type {
  CollectionState,
  CollectionResult,
  CatalogResult,
  CatalogCard,
  CatalogVariant,
} from "../../src/collection-types";
import { apiKeySchema, searchSchema, cents } from "./model";
export type PricingSecret = { apiKey: string };
export function pricingError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "COLLECTION_ALLOCATED")
    return "This collection entry has reserved or sold copies in Selling. Remove unused drafts first; quantity cannot be reduced below its saved listing records.";
  return code === "PRICE_RATE_LIMIT"
    ? "Pricing request limit reached. Wait for the cooldown or check your JustTCG plan before retrying."
    : code === "PRICE_AUTH"
      ? "JustTCG rejected the key or account access. Check your API key and free-plan status in the provider dashboard."
      : code === "PRICE_URL"
        ? "Paste a TCGplayer product URL, a product ID, or a card name."
        : code === "PRICE_KEY"
          ? "Connect your JustTCG API key first."
          : code === "CREDENTIAL_UNAVAILABLE"
            ? "Windows Credential Manager is unavailable. Enter the key on your Windows PC; no plaintext fallback is used."
            : code === "PRICE_RESPONSE"
              ? "The pricing provider returned data that could not be used. Existing values were kept."
              : "Could not complete the collection request. Check the fields, connection, and local storage permissions.";
}
export class CollectionService {
  private busy = false;
  private stopped = false;
  stop() {
    this.stopped = true;
    this.provider.cancel?.();
  }

  private progress = "";
  private selections = new Map<
    string,
    { card: CatalogCard; variant: CatalogVariant; expires: number }
  >();
  constructor(
    private repo: CollectionRepository,
    private vault: CredentialVault<PricingSecret>,
    private provider: MarketDataProvider,
    private supported = process.platform === "win32",
  ) {}
  state(): CollectionState {
    if (this.stopped)
      return {
        items: [],
        settings: {
          connected: false,
          supported: this.supported,
          games: [],
          cooldownUntil: 0,
          dailyRemaining: null,
          monthlyRemaining: null,
        },
        busy: false,
        progress: "",
      };
    return {
      items: this.repo.items(),
      settings: this.repo.settings(this.supported),
      busy: this.busy,
      progress: this.progress,
    };
  }
  private result(error?: string): CollectionResult {
    if (this.stopped)
      return {
        ok: false,
        error: "Application is closing.",
        state: this.state(),
      };
    return { ok: !error, error, state: this.state() };
  }
  private async key() {
    if (!this.repo.settings().connected) throw Error("PRICE_KEY");
    const saved = await this.vault.read();
    if (this.stopped) throw Error("PRICE_CLOSED");
    if (!saved) throw Error("PRICE_KEY");
    return apiKeySchema.parse(saved.apiKey);
  }
  async connect(input: unknown) {
    if (this.busy)
      return this.result("A collection request is already running.");
    if (!this.supported)
      return this.result(pricingError(Error("CREDENTIAL_UNAVAILABLE")));
    const parsed = apiKeySchema.safeParse(input);
    if (!parsed.success) return this.result("Enter a valid JustTCG API key.");
    this.busy = true;
    let error: string | undefined;
    try {
      const old = await this.vault.read();
      if (this.stopped) return this.result();
      const games = await this.provider.games(parsed.data);
      if (this.stopped) return this.result();
      await this.vault.write({ apiKey: parsed.data });
      try {
        if (!this.stopped) this.repo.configure(games);
      } catch {
        try {
          if (old) await this.vault.write(old);
          else await this.vault.remove();
        } catch {}
        throw Error("PRICE_STORAGE");
      }
      this.selections.clear();
    } catch (e) {
      error = pricingError(e);
    } finally {
      this.busy = false;
    }
    return this.result(error);
  }
  async disconnect() {
    if (this.busy)
      return this.result("A collection request is already running.");
    this.busy = true;
    let error: string | undefined;
    try {
      await this.vault.remove();
      if (!this.stopped) this.repo.disconnect();
      this.selections.clear();
    } catch (e) {
      error = pricingError(e);
    } finally {
      this.busy = false;
    }
    return this.result(error);
  }
  async search(input: unknown): Promise<CatalogResult> {
    const fail = (error: string) => ({
      ok: false,
      error,
      cards: [],
      hasMore: false,
      settings: this.state().settings,
    });
    if (this.busy) return fail("A collection request is already running.");
    const parsed = searchSchema.safeParse(input);
    if (!parsed.success)
      return fail("Enter at least two characters to search.");
    this.busy = true;
    try {
      const data = await this.provider.search(await this.key(), parsed.data);
      if (this.stopped) return fail("Application is closing.");
      this.selections.clear();
      for (const card of data.cards)
        for (const variant of card.variants) {
          variant.selectionId = randomUUID();
          this.selections.set(variant.selectionId, {
            card,
            variant,
            expires: Date.now() + 10 * 60 * 1000,
          });
        }
      return {
        ok: true,
        ...data,
        settings: this.repo.settings(this.supported),
      };
    } catch (e) {
      return fail(pricingError(e));
    } finally {
      this.busy = false;
    }
  }
  addLinked(input: unknown) {
    if (this.busy)
      return this.result("A collection request is already running.");
    try {
      const parsed = z
        .object({
          selectionId: z.string().uuid(),
          quantity: z.number().int().min(1).max(100000),
          purchaseCents: cents,
        })
        .strict()
        .parse(input);
      const selected = this.selections.get(parsed.selectionId);
      if (!selected || selected.expires < Date.now())
        return this.result(
          "That search result expired. Search again before adding it.",
        );
      this.repo.addLinked(selected.card, selected.variant, {
        quantity: parsed.quantity,
        purchaseCents: parsed.purchaseCents,
      });
      return this.result();
    } catch (e) {
      return this.result(pricingError(e));
    }
  }
  manual(input: unknown) {
    if (this.busy)
      return this.result("A collection request is already running.");
    try {
      this.repo.addManual(input);
      return this.result();
    } catch (e) {
      return this.result(pricingError(e));
    }
  }
  edit(input: unknown) {
    if (this.busy)
      return this.result("A collection request is already running.");
    try {
      this.repo.edit(input);
      return this.result();
    } catch (e) {
      return this.result(pricingError(e));
    }
  }
  remove(id: unknown) {
    if (this.busy)
      return this.result("A collection request is already running.");
    try {
      this.repo.remove(id);
      return this.result();
    } catch (e) {
      return this.result(pricingError(e));
    }
  }
  async refresh(id?: unknown): Promise<CollectionResult> {
    if (this.busy)
      return this.result("A collection request is already running.");
    if (id !== undefined && !z.string().uuid().safeParse(id).success)
      return this.result("Choose a valid collection item.");
    const items = this.repo
      .items()
      .filter(
        (i) =>
          i.provider === "justtcg" &&
          i.variantId &&
          (id === undefined || i.id === id),
      );
    if (!items.length)
      return this.result(
        "No API-linked cards to refresh. Manual items can be updated with Edit.",
      );
    this.busy = true;
    this.progress = "Reading saved pricing connection…";
    const processed = new Set<string>();
    let updated = 0;
    let failed = 0;
    let error: string | undefined;
    try {
      const key = await this.key();
      const ids = [...new Set(items.map((i) => i.variantId!))];
      for (let offset = 0; offset < ids.length; offset += 20) {
        this.progress = `Refreshing ${Math.min(offset + 20, ids.length)} of ${ids.length} card variants…`;
        const batch = ids.slice(offset, offset + 20);
        const cards = await this.provider.batch(key, batch);
        if (this.stopped) return this.result();
        const variants = new Map(
          cards.flatMap((c) =>
            c.variants.map(
              (v) =>
                [
                  v.id,
                  { variant: v, checkedAt: c.checkedAt, cardId: c.id },
                ] as const,
            ),
          ),
        );
        for (const item of items.filter((i) => batch.includes(i.variantId!))) {
          const quote = variants.get(item.variantId!);
          if (
            quote &&
            quote.cardId === item.cardId &&
            quote.variant.condition === item.condition &&
            quote.variant.printing === item.printing &&
            quote.variant.language === item.language
          ) {
            this.repo.quote(item.id, quote.variant, quote.checkedAt);
            updated++;
          } else {
            this.repo.error(
              item.id,
              "The provider did not return the saved variant. Its previous value was kept.",
            );
            failed++;
          }
          processed.add(item.id);
        }
      }
    } catch (e) {
      error = pricingError(e);
      if (updated)
        error = `${updated} items refreshed before this error: ${error}`;
      for (const item of items.filter((i) => !processed.has(i.id))) {
        failed++;
        try {
          if (!this.stopped) this.repo.error(item.id, error);
        } catch {}
      }
    } finally {
      this.busy = false;
      this.progress = "";
    }
    return { ...this.result(error), updated, failed };
  }
}
