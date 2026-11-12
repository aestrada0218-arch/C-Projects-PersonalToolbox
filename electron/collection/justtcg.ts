import { z } from "zod";
import type { CatalogCard, CatalogVariant } from "../../src/collection-types";
import type { CollectionRepository } from "./store";
import { tcgProductId } from "./model";
import { catalogNameQuery, rankCatalogCards } from "../../src/catalog-display";
const rawVariant = z.object({
  id: z.string().min(1).max(512),
  uuid: z.string().min(1).max(512).nullish(),
  condition: z.string().max(100).nullish(),
  printing: z.string().max(100).nullish(),
  language: z.string().max(100).nullish(),
  price: z.number().finite().min(0).max(10000000).nullable(),
  lastKnownPrice: z.number().finite().min(0).max(10000000).nullish(),
  priceStatus: z.enum(["current", "expired", "unpriced"]).optional(),
  lastUpdated: z.number().finite().min(0).max(4102444800).nullish(),
});
const rawCard = z.object({
  id: z.string().min(1).max(512),
  uuid: z.string().min(1).max(512).nullish(),
  name: z.string().min(1).max(200),
  game: z.string().max(100),
  set: z.string().max(200).optional(),
  set_name: z.string().max(200).nullish(),
  number: z.string().max(100).nullish(),
  tcgplayerId: z
    .string()
    .regex(/^\d{1,12}$/)
    .nullish(),
  variants: z.array(rawVariant).max(1000),
});
export function normalizeCard(raw: unknown, checkedAt: string): CatalogCard {
  const card = rawCard.parse(raw);
  return {
    id: card.uuid || card.id,
    name: card.name,
    game: card.game,
    setName: card.set_name || card.set || "",
    number: card.number || "",
    productId: card.tcgplayerId || null,
    checkedAt,
    variants: card.variants.map((v) => {
      const state =
        v.priceStatus === "current" && v.price === null
          ? "unpriced"
          : v.priceStatus || (v.price === null ? "unpriced" : "current");
      const valueCents =
        state === "current" && v.price !== null
          ? Math.round(v.price * 100)
          : null;
      return {
        id: v.uuid || v.id,
        selectionId: "",
        condition: v.condition || "Unknown condition",
        printing: v.printing || "Unknown printing",
        language: v.language || "English",
        valueCents,
        lastKnownCents:
          v.lastKnownPrice !== undefined && v.lastKnownPrice !== null
            ? Math.round(v.lastKnownPrice * 100)
            : state === "expired" && v.price !== null
              ? Math.round(v.price * 100)
              : null,
        observedAt:
          v.lastUpdated !== undefined && v.lastUpdated !== null
            ? new Date(v.lastUpdated * 1000).toISOString()
            : null,
        state,
      };
    }),
  };
}
export type ProviderResponse = {
  cards: CatalogCard[];
  hasMore: boolean;
  searchQuery?: string;
};
export interface MarketDataProvider {
  cancel?(): void;
  games(key: string): Promise<{ id: string; name: string }[]>;
  search(
    key: string,
    input: { query: string; game: string; offset: number },
  ): Promise<ProviderResponse>;
  batch(key: string, variantIds: string[]): Promise<CatalogCard[]>;
}
export class JustTcgProvider implements MarketDataProvider {
  private active = new Set<AbortController>();
  cancel() {
    for (const controller of this.active) controller.abort();
    this.active.clear();
  }
  constructor(
    private repo: CollectionRepository,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async request(
    key: string,
    path: "/games" | "/cards",
    params: Record<string, string> = {},
    body?: unknown,
  ) {
    this.repo.reserveRequest();
    const url = new URL("https://api.justtcg.com/v1" + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const controller = new AbortController();
    this.active.add(controller);
    try {
      let response: Response;
      try {
        response = await this.fetcher(url.toString(), {
          method: body ? "POST" : "GET",
          headers: {
            "x-api-key": key,
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.any([
            AbortSignal.timeout(20000),
            controller.signal,
          ]),
        });
      } catch {
        throw Error("PRICE_NETWORK");
      }
      if (response.status === 429) {
        const retry = response.headers.get("retry-after");
        let until = Date.now() + 60000;
        if (retry) {
          const seconds = Number(retry);
          const date = Date.parse(retry);
          if (Number.isFinite(seconds) && seconds >= 0)
            until = Math.max(until, Date.now() + seconds * 1000);
          else if (Number.isFinite(date)) until = Math.max(until, date);
        }
        this.repo.cooldown(until);
        await response.body?.cancel();
        throw Error("PRICE_RATE_LIMIT");
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw Error("PRICE_AUTH");
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw Error("PRICE_NETWORK");
      }
      const reader = response.body?.getReader();
      if (!reader) throw Error("PRICE_RESPONSE");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 5 * 1024 * 1024) {
            await reader.cancel();
            throw Error("PRICE_RESPONSE");
          }
          chunks.push(value);
        }
      } catch {
        throw Error("PRICE_RESPONSE");
      }
      let data: any;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw Error("PRICE_RESPONSE");
      }
      if (data.error) throw Error("PRICE_RESPONSE");
      const meta = data._metadata || {};
      const number = (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) && v >= 0
          ? Math.floor(v)
          : null;
      this.repo.usage(
        number(meta.apiDailyRequestsRemaining),
        number(meta.apiRequestsRemaining),
      );
      return data;
    } finally {
      this.active.delete(controller);
    }
  }
  async games(key: string) {
    const data = await this.request(key, "/games");
    return z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          name: z.string().min(1).max(100),
        }),
      )
      .max(200)
      .parse(data.data);
  }
  async search(
    key: string,
    input: { query: string; game: string; offset: number },
  ) {
    const productId =
      tcgProductId(input.query) ||
      (/^\d{1,12}$/.test(input.query) ? input.query : null);
    if (/^https?:/i.test(input.query) && !productId) throw Error("PRICE_URL");
    const params: Record<string, string> = {
      limit: "20",
      offset: String(input.offset),
      include_price_history: "false",
      include_null_prices: "true",
    };
    if (productId) params.tcgplayerId = productId;
    else {
      params.q = catalogNameQuery(input.query);
      if (input.game) params.game = input.game;
    }
    const data = await this.request(key, "/cards", params);
    if (!Array.isArray(data.data) || data.data.length > 20)
      throw Error("PRICE_RESPONSE");
    const checkedAt = new Date().toISOString();
    return {
      cards: rankCatalogCards(
        data.data.map((card: unknown) => normalizeCard(card, checkedAt)),
        input.query,
      ),
      hasMore: Boolean(data.meta?.hasMore),
      searchQuery: productId || params.q,
    };
  }
  async batch(key: string, variantIds: string[]) {
    if (!variantIds.length || variantIds.length > 20)
      throw Error("PRICE_RESPONSE");
    const data = await this.request(
      key,
      "/cards",
      {},
      variantIds.map((variantId) => ({
        variantId,
        include_price_history: "false",
      })),
    );
    if (!Array.isArray(data.data) || data.data.length > 20)
      throw Error("PRICE_RESPONSE");
    const checkedAt = new Date().toISOString();
    return data.data.map((card: unknown) => normalizeCard(card, checkedAt));
  }
}
