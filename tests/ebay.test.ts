import { expect, it, vi } from "vitest";
import { EbayProvider, EbayError } from "../electron/selling/ebay";
import type { EbayConnectionInput, ListingDraft } from "../src/selling-types";
const secret: EbayConnectionInput = {
  environment: "sandbox",
  label: "Test",
  clientId: "example-client-id",
  clientSecret: "example-private-secret",
  refreshToken: "example-private-refresh-token-1234",
};
const draft: ListingDraft = {
  collectionId: "11111111-1111-4111-8111-111111111111",
  unitLabel: "A1",
  title: "Example <card>",
  description: 'My item <script>alert("x")</script>\nSecond line',
  priceCents: 1234,
  condition: "LIKE_NEW",
  conditionDescription: "Actual condition",
  conditionDescriptors: [
    { name: "27503", values: [], additionalInfo: "1234567" },
  ],
  aspects: { Brand: ["Example"] },
  photoUrls: ["https://i.ebayimg.com/images/example.jpg"],
  categoryId: "183454",
  locationKey: "warehouse",
  fulfillmentPolicyId: "1",
  paymentPolicyId: "2",
  returnPolicyId: "3",
  autoEndEbay: true,
};
function harness(route: (url: URL, init: RequestInit) => Response) {
  let cooldown = 0;
  const fetcher = vi.fn(async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/identity/v1/oauth2/token")
      return new Response(
        JSON.stringify({
          access_token: "example-access-token",
          expires_in: 7200,
        }),
      );
    return route(url, init);
  });
  return {
    fetcher,
    provider: new EbayProvider(
      () => cooldown,
      (n) => {
        cooldown = n;
      },
      fetcher as typeof fetch,
    ),
    cooldown: () => cooldown,
  };
}
it("uses fixed eBay HTTPS, refresh scopes and cached bearer auth; creates one-copy payloads and escapes listing HTML", async () => {
  const h = harness((url) =>
    url.pathname === "/sell/inventory/v1/offer"
      ? new Response(JSON.stringify({ offerId: "123" }), { status: 201 })
      : new Response(null, { status: 204 }),
  );
  await h.provider.inventory(secret, "PT-EXAMPLE", draft);
  await h.provider.saveOffer(secret, "PT-EXAMPLE", draft, null);
  await h.provider.saveOffer(secret, "PT-EXAMPLE", draft, "123");
  expect(
    h.fetcher.mock.calls.filter(([url]) =>
      String(url).includes("/oauth2/token"),
    ),
  ).toHaveLength(1);
  const [url, auth] = h.fetcher.mock.calls[0];
  expect(String(url)).toBe(
    "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
  );
  expect(auth!.headers).toMatchObject({
    Authorization:
      "Basic " +
      Buffer.from(secret.clientId + ":" + secret.clientSecret).toString(
        "base64",
      ),
  });
  const tokenBody = new URLSearchParams(String(auth!.body));
  expect(tokenBody.get("grant_type")).toBe("refresh_token");
  expect(tokenBody.get("scope")).toContain(
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  );
  const inv = JSON.parse(String(h.fetcher.mock.calls[1][1]!.body));
  expect(inv.availability.shipToLocationAvailability.quantity).toBe(1);
  expect(inv.conditionDescriptors[0]).toEqual({
    name: "27503",
    additionalInfo: "1234567",
  });
  const offer = JSON.parse(String(h.fetcher.mock.calls[2][1]!.body));
  expect(offer).toMatchObject({
    sku: "PT-EXAMPLE",
    format: "FIXED_PRICE",
    marketplaceId: "EBAY_US",
    availableQuantity: 1,
    pricingSummary: { price: { value: "12.34", currency: "USD" } },
  });
  expect(offer.listingDescription).toContain("&lt;script&gt;");
  expect(offer.listingDescription).not.toContain("<script>");
  const update = JSON.parse(String(h.fetcher.mock.calls[3][1]!.body));
  expect(update).not.toHaveProperty("sku");
  expect(update).not.toHaveProperty("format");
  expect(update).toHaveProperty("listingPolicies");
  for (const [request, init] of h.fetcher.mock.calls) {
    expect(String(request)).not.toContain(secret.refreshToken);
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
  }
});
it("reads only paid/non-cancelled order lines and keeps listing/SKU/order IDs without buyer data", async () => {
  const order = {
    orderId: "12-34567-89012",
    orderPaymentStatus: "PAID",
    creationDate: "2026-11-16T12:00:00Z",
    buyer: { username: "PRIVATE-BUYER" },
    lineItems: [
      {
        lineItemId: "line1",
        legacyItemId: "123456789",
        sku: "PT-EXAMPLE",
        quantity: 1,
      },
    ],
  };
  const h = harness(
    () =>
      new Response(
        JSON.stringify({
          orders: [
            order,
            {
              ...order,
              orderId: "cancelled",
              cancelStatus: { cancelState: "CANCELED" },
            },
            { ...order, orderId: "unpaid", orderPaymentStatus: "PENDING" },
          ],
          total: 3,
        }),
      ),
  );
  const result = await h.provider.orders(
    secret,
    "2026-11-01T00:00:00Z",
    "2026-11-17T00:00:00Z",
    0,
  );
  expect(result.sales).toHaveLength(1);
  expect(result.sales[0]).toMatchObject({
    listingId: "123456789",
    sku: "PT-EXAMPLE",
    quantity: 1,
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE-BUYER");
  expect(result.more).toBe(false);
  expect(
    new URL(String(h.fetcher.mock.calls[1][0])).searchParams.get("filter"),
  ).toContain("lastmodifieddate:");
});
it("honors eBay Retry-After and prevents repeated requests during cooldown", async () => {
  const h = harness(
    () => new Response("", { status: 429, headers: { "Retry-After": "120" } }),
  );
  await expect(h.provider.options(secret)).rejects.toMatchObject({
    kind: "rate",
  });
  const count = h.fetcher.mock.calls.length;
  expect(h.cooldown()).toBeGreaterThan(Date.now() + 110000);
  await expect(h.provider.options(secret)).rejects.toMatchObject({
    kind: "rate",
  });
  expect(h.fetcher).toHaveBeenCalledTimes(count);
});
it("uploads a photo using documented Media API multipart image field without putting paths or tokens in the URL", async () => {
  const h = harness(
    () =>
      new Response(
        JSON.stringify({
          imageUrl: "https://i.ebayimg.com/images/uploaded.jpg",
        }),
        { status: 201 },
      ),
  );
  expect(await h.provider.upload(secret, new Uint8Array([1, 2, 3]))).toContain(
    "i.ebayimg.com",
  );
  const [url, init] = h.fetcher.mock.calls[1];
  expect(String(url)).toBe(
    "https://api.sandbox.ebay.com/commerce/media/v1_beta/image/create_image_from_file",
  );
  expect(init!.body).toBeInstanceOf(FormData);
  expect((init!.body as FormData).get("image")).toBeInstanceOf(Blob);
});
it("loads category-specific names and free-text certification descriptors from official taxonomy/metadata endpoints", async () => {
  const h = harness(
    (url) =>
      new Response(
        JSON.stringify(
          url.pathname.includes("get_default")
            ? { categoryTreeId: "0" }
            : url.pathname.includes("get_item_aspects")
              ? {
                  aspects: [
                    {
                      localizedAspectName: "Brand",
                      aspectConstraint: { aspectRequired: true },
                      aspectValues: [{ localizedValue: "Example" }],
                    },
                  ],
                }
              : {
                  itemConditionPolicies: [
                    {
                      categoryId: "183454",
                      itemConditions: [
                        {
                          conditionId: "2750",
                          conditionDescription: "Graded",
                          conditionDescriptors: [
                            {
                              conditionDescriptorId: "27503",
                              conditionDescriptorName: "Certification Number",
                              conditionDescriptorConstraint: {
                                mode: "FREE_TEXT",
                              },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
        ),
      ),
  );
  const guide = await h.provider.guide(secret, "183454");
  expect(guide).toMatchObject({
    aspects: [{ name: "Brand", required: true, values: ["Example"] }],
    conditions: [
      {
        id: "2750",
        name: "Graded",
        descriptors: [
          {
            id: "27503",
            name: "Certification Number",
            freeText: true,
            values: [],
          },
        ],
      },
    ],
  });
});
it("redacts response text to numeric error IDs and does not call a stopped provider", async () => {
  const h = harness(
    () =>
      new Response(
        JSON.stringify({
          errors: [{ errorId: 25002, message: secret.refreshToken }],
        }),
        { status: 400 },
      ),
  );
  try {
    await h.provider.options(secret);
  } catch (e) {
    expect(e).toBeInstanceOf(EbayError);
    expect((e as EbayError).ids).toBe("25002");
    expect(String(e)).not.toContain(secret.refreshToken);
  }
  h.provider.cancel();
  const calls = h.fetcher.mock.calls.length;
  await expect(h.provider.options(secret)).rejects.toThrow();
  expect(h.fetcher).toHaveBeenCalledTimes(calls);
});
it("does not validate a changed client secret using an old cached access token", async () => {
  const h = harness(
    () =>
      new Response(
        JSON.stringify({
          locations: [],
          fulfillmentPolicies: [],
          paymentPolicies: [],
          returnPolicies: [],
        }),
      ),
  );
  await h.provider.options(secret);
  await h.provider.options({
    ...secret,
    clientSecret: "different-private-client-secret",
  });
  expect(
    h.fetcher.mock.calls.filter(([url]) =>
      String(url).includes("/oauth2/token"),
    ),
  ).toHaveLength(2);
  h.provider.forgetAuth();
  await h.provider.options(secret);
  expect(
    h.fetcher.mock.calls.filter(([url]) =>
      String(url).includes("/oauth2/token"),
    ),
  ).toHaveLength(3);
});
