import { z } from "zod";
import { createHash } from "node:crypto";
import type {
  EbayConnectionInput,
  SellingOptions,
  ListingDraft,
  SellingSale,
  CategoryGuide,
} from "../../src/selling-types";
import { connectionKey, photoUrl } from "./model";
export class EbayError extends Error {
  constructor(
    public kind:
      "auth" | "rate" | "network" | "response" | "validation" | "missing",
    public ids: string = "",
  ) {
    super("EBAY_" + kind);
  }
}
export type RemoteOffer = {
  id: string;
  sku: string;
  status: "PUBLISHED" | "UNPUBLISHED";
  listingId: string | null;
  ended: boolean;
  raw: Record<string, any>;
};
export interface EbayMarket {
  forgetAuth?(): void;
  guide(
    secret: EbayConnectionInput,
    categoryId: string,
  ): Promise<CategoryGuide>;
  cancel(): void;
  options(secret: EbayConnectionInput): Promise<SellingOptions>;
  location(
    secret: EbayConnectionInput,
    key: string,
    name: string,
    zip: string,
  ): Promise<void>;
  findOffer(
    secret: EbayConnectionInput,
    sku: string,
  ): Promise<RemoteOffer | null>;
  offer(secret: EbayConnectionInput, id: string): Promise<RemoteOffer>;
  inventory(
    secret: EbayConnectionInput,
    sku: string,
    draft: ListingDraft,
  ): Promise<void>;
  saveOffer(
    secret: EbayConnectionInput,
    sku: string,
    draft: ListingDraft,
    id: string | null,
  ): Promise<string>;
  publish(secret: EbayConnectionInput, id: string): Promise<string>;
  withdraw(secret: EbayConnectionInput, id: string): Promise<void>;
  upload(secret: EbayConnectionInput, bytes: Uint8Array): Promise<string>;
  orders(
    secret: EbayConnectionInput,
    start: string,
    end: string,
    offset: number,
  ): Promise<{ sales: SellingSale[]; more: boolean; count: number }>;
}
const idSchema = z.string().regex(/^\d{1,30}$/);
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export class EbayProvider implements EbayMarket {
  private active = new Set<AbortController>();
  private closed = false;
  private tokenCache: { key: string; token: string; expires: number } | null =
    null;
  constructor(
    private cooldown: () => number,
    private saveCooldown: (until: number) => void,
    private fetcher: typeof fetch = fetch,
  ) {}
  cancel() {
    this.closed = true;
    for (const c of this.active) c.abort();
    this.active.clear();
    this.tokenCache = null;
  }
  forgetAuth() {
    this.tokenCache = null;
  }
  private base(secret: EbayConnectionInput) {
    return secret.environment === "production"
      ? "https://api.ebay.com"
      : "https://api.sandbox.ebay.com";
  }
  private async request(
    secret: EbayConnectionInput,
    path: string,
    init: RequestInit = {},
  ) {
    if (this.closed) throw new EbayError("network");
    if (this.cooldown() > Date.now()) throw new EbayError("rate");
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new EbayError("response");
    const c = new AbortController();
    this.active.add(c);
    try {
      let response: Response;
      try {
        response = await this.fetcher(this.base(secret) + path, {
          ...init,
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.any([c.signal, AbortSignal.timeout(30000)]),
        });
      } catch {
        throw new EbayError("network");
      }
      if (response.status === 429) {
        const retry = response.headers.get("retry-after"),
          n = Number(retry);
        const until =
          retry && Number.isFinite(n)
            ? Date.now() + Math.max(60, n) * 1000
            : Math.max(Date.now() + 60000, Date.parse(retry || "") || 0);
        this.saveCooldown(until);
        await response.body?.cancel();
        throw new EbayError("rate");
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        this.tokenCache = null;
        throw new EbayError("auth");
      }
      if (response.status === 404) {
        await response.body?.cancel();
        throw new EbayError("missing");
      }
      if (response.status === 204) {
        await response.body?.cancel();
        return {};
      }
      const reader = response.body?.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 5 * 1024 * 1024) {
              await reader.cancel();
              throw new EbayError("response");
            }
            chunks.push(value);
          }
        } catch {
          throw new EbayError("response");
        }
      let body: any;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        throw new EbayError("response");
      }
      if (!response.ok) {
        const ids = Array.isArray(body.errors)
          ? body.errors
              .map((e: any) => String(e.errorId))
              .filter((s: string) => /^\d{1,10}$/.test(s))
              .slice(0, 3)
              .join(", ")
          : "";
        throw new EbayError(
          response.status >= 500 ? "network" : "validation",
          ids,
        );
      }
      return body;
    } finally {
      this.active.delete(c);
    }
  }
  private async token(secret: EbayConnectionInput) {
    const key = createHash("sha256")
      .update(JSON.stringify([connectionKey(secret), secret.clientSecret]))
      .digest("hex");
    if (this.tokenCache?.key === key && this.tokenCache.expires > Date.now())
      return this.tokenCache.token;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: secret.refreshToken,
      scope: [
        "api_scope",
        "api_scope/sell.inventory",
        "api_scope/sell.account.readonly",
        "api_scope/sell.fulfillment.readonly",
      ]
        .map((s) => "https://api.ebay.com/oauth/" + s)
        .join(" "),
    });
    const result = await this.request(secret, "/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(secret.clientId + ":" + secret.clientSecret).toString(
            "base64",
          ),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const token = z
      .object({
        access_token: z.string().min(10).max(10000),
        expires_in: z.number().positive().max(86400),
      })
      .parse(result);
    this.tokenCache = {
      key,
      token: token.access_token,
      expires: Date.now() + Math.max(0, token.expires_in - 60) * 1000,
    };
    return token.access_token;
  }
  private async api(
    secret: EbayConnectionInput,
    path: string,
    method = "GET",
    body?: unknown,
  ) {
    return this.request(secret, path, {
      method,
      headers: {
        Authorization: "Bearer " + (await this.token(secret)),
        Accept: "application/json",
        "Content-Language": "en-US",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  async options(secret: EbayConnectionInput): Promise<SellingOptions> {
    const locations = await this.api(
      secret,
      "/sell/inventory/v1/location?limit=100",
    );
    const result: SellingOptions = {
      locations: [],
      fulfillment: [],
      payment: [],
      returns: [],
    };
    const choice = z.object({
      id: z.string().min(1).max(100),
      name: z.string().max(200),
    });
    result.locations = z
      .array(choice)
      .max(100)
      .parse(
        (locations.locations || []).map((r: any) => ({
          id: r.merchantLocationKey,
          name: r.name || r.merchantLocationKey,
        })),
      );
    for (const [name, key] of [
      ["fulfillment", "fulfillment"],
      ["payment", "payment"],
      ["return", "returns"],
    ] as const) {
      const data = await this.api(
        secret,
        `/sell/account/v1/${name}_policy?marketplace_id=EBAY_US`,
      );
      result[key] = z
        .array(choice)
        .max(100)
        .parse(
          (data[name + "Policies"] || []).map((r: any) => ({
            id: r[name + "PolicyId"],
            name: r.name || r[name + "PolicyId"],
          })),
        );
    }
    return result;
  }
  async location(
    secret: EbayConnectionInput,
    key: string,
    name: string,
    zip: string,
  ) {
    await this.api(
      secret,
      "/sell/inventory/v1/location/" + encodeURIComponent(key),
      "POST",
      {
        name,
        location: { address: { postalCode: zip, country: "US" } },
        locationTypes: ["WAREHOUSE"],
        merchantLocationStatus: "ENABLED",
      },
    );
  }
  async guide(
    secret: EbayConnectionInput,
    categoryId: string,
  ): Promise<CategoryGuide> {
    const category = idSchema.parse(categoryId),
      tree = await this.api(
        secret,
        "/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US",
      ),
      treeId = idSchema.parse(tree.categoryTreeId);
    const aspects = await this.api(
      secret,
      `/commerce/taxonomy/v1/category_tree/${treeId}/get_item_aspects_for_category?category_id=${category}`,
    );
    const conditions = await this.api(
      secret,
      "/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?" +
        new URLSearchParams({ filter: `categoryIds:{${category}}` }),
    );
    const text = z.string().max(200),
      choice = z.object({ id: idSchema, name: text });
    return z
      .object({
        aspects: z
          .array(
            z.object({
              name: text,
              required: z.boolean(),
              values: z.array(text).max(1000),
            }),
          )
          .max(200),
        conditions: z
          .array(
            z.object({
              id: idSchema,
              name: text,
              descriptors: z
                .array(
                  z.object({
                    id: idSchema,
                    name: text,
                    required: z.boolean(),
                    freeText: z.boolean(),
                    values: z.array(choice).max(1000),
                  }),
                )
                .max(20),
            }),
          )
          .max(30),
      })
      .parse({
        aspects: (aspects.aspects || []).map((a: any) => ({
          name: a.localizedAspectName,
          required: Boolean(a.aspectConstraint?.aspectRequired),
          values: (a.aspectValues || [])
            .slice(0, 1000)
            .map((v: any) => v.localizedValue),
        })),
        conditions:
          (conditions.itemConditionPolicies || [])
            .find((p: any) => p.categoryId === category)
            ?.itemConditions?.map((c: any) => ({
              id: c.conditionId,
              name: c.conditionDescription,
              descriptors: (c.conditionDescriptors || []).map((d: any) => ({
                id: d.conditionDescriptorId,
                name: d.conditionDescriptorName,
                required: d.conditionDescriptorConstraint?.usage === "REQUIRED",
                freeText: d.conditionDescriptorConstraint?.mode === "FREE_TEXT",
                values: (d.conditionDescriptorValues || [])
                  .slice(0, 1000)
                  .map((v: any) => ({
                    id: v.conditionDescriptorValueId,
                    name: v.conditionDescriptorValueName,
                  })),
              })),
            })) || [],
      });
  }
  private normalizeOffer(raw: any): RemoteOffer {
    const data = z
      .object({
        offerId: idSchema,
        sku: z.string().min(1).max(100),
        status: z.enum(["PUBLISHED", "UNPUBLISHED"]),
        listing: z
          .object({
            listingId: idSchema.optional(),
            listingStatus: z.string().optional(),
          })
          .optional(),
      })
      .passthrough()
      .parse(raw);
    return {
      id: data.offerId,
      sku: data.sku,
      status: data.status,
      listingId: data.listing?.listingId || null,
      ended: data.listing?.listingStatus === "ENDED",
      raw: data,
    };
  }
  async findOffer(secret: EbayConnectionInput, sku: string) {
    let data: any;
    try {
      data = await this.api(
        secret,
        "/sell/inventory/v1/offer?" +
          new URLSearchParams({
            sku,
            marketplace_id: "EBAY_US",
            format: "FIXED_PRICE",
            limit: "100",
          }),
      );
    } catch (e) {
      if (e instanceof EbayError && e.kind === "missing") return null;
      throw e;
    }
    if (!Array.isArray(data.offers) || data.offers.length > 1)
      throw Error("SELL_AMBIGUOUS");
    return data.offers.length ? this.normalizeOffer(data.offers[0]) : null;
  }
  async offer(secret: EbayConnectionInput, id: string) {
    return this.normalizeOffer(
      await this.api(secret, "/sell/inventory/v1/offer/" + idSchema.parse(id)),
    );
  }
  async inventory(
    secret: EbayConnectionInput,
    sku: string,
    draft: ListingDraft,
  ) {
    await this.api(
      secret,
      "/sell/inventory/v1/inventory_item/" + encodeURIComponent(sku),
      "PUT",
      {
        availability: { shipToLocationAvailability: { quantity: 1 } },
        condition: draft.condition,
        ...(draft.conditionDescription
          ? { conditionDescription: draft.conditionDescription }
          : {}),
        ...(draft.conditionDescriptors.length
          ? {
              conditionDescriptors: draft.conditionDescriptors.map((d) => ({
                name: d.name,
                ...(d.values.length ? { values: d.values } : {}),
                ...(d.additionalInfo
                  ? { additionalInfo: d.additionalInfo }
                  : {}),
              })),
            }
          : {}),
        product: {
          title: draft.title,
          description: draft.description,
          aspects: draft.aspects,
          imageUrls: draft.photoUrls,
        },
      },
    );
  }
  async saveOffer(
    secret: EbayConnectionInput,
    sku: string,
    draft: ListingDraft,
    id: string | null,
  ) {
    const body = {
      sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      availableQuantity: 1,
      categoryId: draft.categoryId,
      listingDescription:
        "<p>" + escapeHtml(draft.description).replace(/\n/g, "<br>") + "</p>",
      listingDuration: "GTC",
      merchantLocationKey: draft.locationKey,
      pricingSummary: {
        price: { value: (draft.priceCents / 100).toFixed(2), currency: "USD" },
      },
      listingPolicies: {
        fulfillmentPolicyId: draft.fulfillmentPolicyId,
        paymentPolicyId: draft.paymentPolicyId,
        returnPolicyId: draft.returnPolicyId,
      },
      includeCatalogProductDetails: false,
    };
    const {
      sku: _sku,
      marketplaceId: _market,
      format: _format,
      ...updateBody
    } = body;
    const data = await this.api(
      secret,
      "/sell/inventory/v1/offer" + (id ? "/" + idSchema.parse(id) : ""),
      id ? "PUT" : "POST",
      id ? updateBody : body,
    );
    return id || idSchema.parse(data.offerId);
  }
  async publish(secret: EbayConnectionInput, id: string) {
    const data = await this.api(
      secret,
      "/sell/inventory/v1/offer/" + idSchema.parse(id) + "/publish",
      "POST",
    );
    return idSchema.parse(data.listingId);
  }
  async withdraw(secret: EbayConnectionInput, id: string) {
    await this.api(
      secret,
      "/sell/inventory/v1/offer/" + idSchema.parse(id) + "/withdraw",
      "POST",
    );
  }
  async upload(secret: EbayConnectionInput, bytes: Uint8Array) {
    const body = new FormData();
    body.append(
      "image",
      new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
      "collection-photo.jpg",
    );
    const result = await this.request(
      secret,
      "/commerce/media/v1_beta/image/create_image_from_file",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + (await this.token(secret)),
          Accept: "application/json",
        },
        body,
      },
    );
    return photoUrl.parse(result.imageUrl);
  }
  async orders(
    secret: EbayConnectionInput,
    start: string,
    end: string,
    offset: number,
  ) {
    const data = await this.api(
      secret,
      "/sell/fulfillment/v1/order?" +
        new URLSearchParams({
          filter: `lastmodifieddate:[${start}..${end}]`,
          limit: "50",
          offset: String(offset),
        }),
    );
    if (!Array.isArray(data.orders) || data.orders.length > 50)
      throw new EbayError("response");
    const sales: SellingSale[] = [];
    for (const raw of data.orders) {
      if (
        !["PAID", "PARTIALLY_REFUNDED"].includes(raw.orderPaymentStatus) ||
        ["CANCELED", "CANCELLED"].includes(raw.cancelStatus?.cancelState)
      )
        continue;
      const order = z
        .object({
          orderId: z.string().min(1).max(80),
          creationDate: z.string().datetime({ offset: true }),
          lineItems: z
            .array(
              z.object({
                lineItemId: z.string().min(1).max(100),
                legacyItemId: idSchema.optional(),
                sku: z.string().max(100).optional(),
                quantity: z.number().int().positive(),
              }),
            )
            .max(1000),
        })
        .parse(raw);
      for (const line of order.lineItems)
        if (line.legacyItemId && line.sku)
          sales.push({
            eventId: order.orderId + ":" + line.lineItemId,
            orderId: order.orderId,
            listingId: line.legacyItemId,
            sku: line.sku,
            quantity: line.quantity,
            at: order.creationDate,
          });
    }
    return {
      sales,
      count: data.orders.length,
      more:
        Boolean(data.next) ||
        (typeof data.total === "number" &&
          offset + data.orders.length < data.total),
    };
  }
}
