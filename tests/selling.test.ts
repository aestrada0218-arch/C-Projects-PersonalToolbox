import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import initSqlJs from "sql.js";
import { Store } from "../electron/database";
import { SellingService } from "../electron/selling/service";
import {
  EbayProvider,
  EbayError,
  type RemoteOffer,
} from "../electron/selling/ebay";
import {
  connectionKey,
  connectionSchema,
  draftSchema,
  mercariId,
  listingUrl,
} from "../electron/selling/model";
import { makeSellingV6 } from "./legacy-collection";
import { WindowsCredentialVault } from "../electron/inbox/credentials";
import type {
  EbayConnectionInput,
  ListingDraft,
  SellingOptions,
  SellingSale,
  CategoryGuide,
} from "../src/selling-types";
afterEach(() => vi.useRealTimers());
const credentials: EbayConnectionInput = {
  environment: "sandbox",
  label: "Test seller",
  clientId: "test-client-id-1234",
  clientSecret: "PRIVATE-EXAMPLE-client-secret",
  refreshToken: "PRIVATE-EXAMPLE-refresh-token-1234567890",
};
const options: SellingOptions = {
  locations: [{ id: "warehouse", name: "Example origin" }],
  fulfillment: [{ id: "101", name: "Example shipping" }],
  payment: [{ id: "102", name: "Example payment" }],
  returns: [{ id: "103", name: "Example returns" }],
};
const guide: CategoryGuide = {
  aspects: [{ name: "Brand", required: true, values: ["Example"] }],
  conditions: [
    {
      id: "4000",
      name: "Ungraded",
      descriptors: [
        {
          id: "40001",
          name: "Card Condition",
          required: true,
          freeText: false,
          values: [{ id: "400010", name: "Near mint" }],
        },
      ],
    },
  ],
};
function draft(
  db: Store,
  collectionId = db.collection.items()[0].id,
): ListingDraft {
  return {
    collectionId,
    unitLabel: "Binder A · copy 1",
    title: "Example card",
    description: "My actual item description",
    priceCents: 2500,
    condition: "USED_VERY_GOOD",
    conditionDescription: "See my photos",
    conditionDescriptors: [{ name: "40001", values: ["400010"] }],
    aspects: { Brand: ["Example"] },
    photoUrls: ["https://i.ebayimg.com/images/example.jpg"],
    categoryId: "183454",
    locationKey: "warehouse",
    fulfillmentPolicyId: "101",
    paymentPolicyId: "102",
    returnPolicyId: "103",
    autoEndEbay: true,
  };
}
function setup(db: Store) {
  let saved: EbayConnectionInput | null = null;
  const offers = new Map<string, RemoteOffer>();
  let next = 1000;
  const vault = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (v: EbayConnectionInput) => {
      saved = v;
    }),
    remove: vi.fn(async () => {
      saved = null;
    }),
  };
  const provider = {
    cancel: vi.fn(),
    options: vi.fn(async () => options),
    guide: vi.fn(async () => guide),
    location: vi.fn(async () => {}),
    findOffer: vi.fn(
      async (_s: EbayConnectionInput, sku: string) =>
        [...offers.values()].find((o) => o.sku === sku) || null,
    ),
    offer: vi.fn(async (_s: EbayConnectionInput, id: string) => {
      const o = offers.get(id);
      if (!o) throw new EbayError("missing");
      return structuredClone(o);
    }),
    inventory: vi.fn(async () => {}),
    saveOffer: vi.fn(
      async (
        _s: EbayConnectionInput,
        sku: string,
        _draft: ListingDraft,
        id: string | null,
      ) => {
        const key = id || String(next++);
        offers.set(key, {
          id: key,
          sku,
          status: "UNPUBLISHED",
          listingId: null,
          ended: false,
          raw: {},
        });
        return key;
      },
    ),
    publish: vi.fn(async (_s: EbayConnectionInput, id: string) => {
      const offer = offers.get(id)!;
      offer.status = "PUBLISHED";
      offer.listingId = "222" + id;
      return offer.listingId;
    }),
    withdraw: vi.fn(async (_s: EbayConnectionInput, id: string) => {
      offers.get(id)!.status = "UNPUBLISHED";
    }),
    upload: vi.fn(async () => "https://i.ebayimg.com/images/uploaded.jpg"),
    orders: vi.fn(async () => ({
      sales: [] as SellingSale[],
      more: false,
      count: 0,
    })),
  };
  return {
    service: new SellingService(db.selling, vault, provider, true),
    vault,
    provider,
    offers,
  };
}
async function active(
  db: Store,
  fixture: ReturnType<typeof setup>,
  data = draft(db),
) {
  const id = db.selling.create(data);
  const prepared = await fixture.service.prepare(id);
  expect(prepared.ok).toBe(true);
  expect(prepared.review).toBeDefined();
  expect(
    (
      await fixture.service.publish({
        token: prepared.review!.token,
        confirmed: true,
      })
    ).ok,
  ).toBe(true);
  return db.selling.get(id);
}
it("validates single-copy drafts, public photo URLs and exact marketplace links", () => {
  expect(
    mercariId("https://www.mercari.com/us/item/m123456789/?source=test"),
  ).toBe("m123456789");
  for (const url of [
    "https://mercari.com.evil.invalid/us/item/m123456789/",
    "http://mercari.com/us/item/m123456789/",
    "https://user:pass@mercari.com/us/item/m123456789/",
    "file:///tmp/item",
    "https://mercari.com/us/item/not-an-id/",
  ])
    expect(mercariId(url)).toBeNull();
  expect(listingUrl("ebay", "123", "sandbox")).toBe(
    "https://www.sandbox.ebay.com/itm/123",
  );
  expect(() => listingUrl("mercari", "https://evil.invalid/")).toThrow();
  expect(
    connectionSchema.safeParse({
      ...credentials,
      refreshToken: "x".repeat(2100),
      clientId: "y".repeat(200),
      clientSecret: "z".repeat(200),
    }).success,
  ).toBe(false);
});
it("reserves physical copies atomically and protects collection quantity/deletion without changing financial values", async () => {
  const db = await Store.open();
  try {
    const item = db.collection.items().find((i) => i.quantity === 1)!;
    const data = draft(db, item.id),
      before = db.snapshot();
    const id = db.selling.create(data);
    expect(() => db.selling.create(data)).toThrow("SELL_STOCK");
    expect(() => db.collection.remove(item.id)).toThrow("COLLECTION_ALLOCATED");
    expect(db.snapshot()).toEqual(before);
    db.selling.remove(id);
    expect(db.selling.stock().find((s) => s.id === item.id)?.allocated).toBe(0);
    expect(
      draftSchema.safeParse({
        ...data,
        photoUrls: ["https://127.0.0.1/image.jpg"],
      }).success,
    ).toBe(false);
    expect(draftSchema.safeParse({ ...data, priceCents: 0 }).success).toBe(
      false,
    );
    const many = db.collection.items().find((i) => i.quantity === 2)!;
    db.selling.create(draft(db, many.id));
    db.selling.create(draft(db, many.id));
    expect(() =>
      db.collection.edit({
        id: many.id,
        item: {
          name: many.name,
          category: many.category,
          collectionType: many.collectionType,
          quantity: 1,
          purchaseCents: many.purchaseCents,
          valueCents: many.valueCents,
          referenceUrl: many.referenceUrl,
          imageData: many.imageData,
        },
      }),
    ).toThrow("COLLECTION_ALLOCATED");
  } finally {
    db.close();
  }
});
it("requires a fresh review before publishing, invalidates edited drafts, and does not publish twice", async () => {
  const db = await Store.open(),
    f = setup(db);
  try {
    await f.service.connect(credentials);
    const id = db.selling.create(draft(db));
    const first = await f.service.prepare(id);
    expect(first.review?.unit.priceCents).toBe(2500);
    expect(f.provider.publish).not.toHaveBeenCalled();
    db.selling.edit({ id, draft: { ...draft(db), priceCents: 3000 } });
    expect(
      (await f.service.publish({ token: first.review!.token, confirmed: true }))
        .ok,
    ).toBe(false);
    expect(f.provider.publish).not.toHaveBeenCalled();
    const second = await f.service.prepare(id);
    expect(
      (
        await f.service.publish({
          token: second.review!.token,
          confirmed: false,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await f.service.publish({
          token: second.review!.token,
          confirmed: true,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await f.service.publish({
          token: second.review!.token,
          confirmed: true,
        })
      ).ok,
    ).toBe(false);
    expect(f.provider.publish).toHaveBeenCalledTimes(1);
    expect(db.selling.get(id)).toMatchObject({
      ebayState: "active",
      ebayListingId: expect.any(String),
    });
  } finally {
    f.service.stop();
    db.close();
  }
});
it("keeps ambiguous publish results uncertain and reconciles the original offer instead of creating a second listing", async () => {
  const db = await Store.open(),
    f = setup(db);
  try {
    await f.service.connect(credentials);
    const id = db.selling.create(draft(db)),
      first = await f.service.prepare(id);
    f.provider.publish.mockImplementationOnce(async (_s, id) => {
      const offer = f.offers.get(id)!;
      offer.status = "PUBLISHED";
      offer.listingId = "999123";
      throw new EbayError("network");
    });
    expect(
      (await f.service.publish({ token: first.review!.token, confirmed: true }))
        .ok,
    ).toBe(false);
    expect(db.selling.get(id).ebayState).toBe("uncertain");
    expect((await f.service.reconcile(id)).ok).toBe(true);
    expect(db.selling.get(id)).toMatchObject({
      ebayListingId: "999123",
      ebayState: "active",
    });
    expect(f.provider.publish).toHaveBeenCalledTimes(1);
    expect(f.provider.saveOffer).toHaveBeenCalledTimes(1);
  } finally {
    f.service.stop();
    db.close();
  }
});
it("rejects expired reviews and clears them across disconnect", async () => {
  const db = await Store.open(),
    f = setup(db);
  try {
    await f.service.connect(credentials);
    vi.useFakeTimers();
    const id = db.selling.create(draft(db)),
      r = await f.service.prepare(id);
    vi.advanceTimersByTime(11 * 60000);
    expect(
      (await f.service.publish({ token: r.review!.token, confirmed: true })).ok,
    ).toBe(false);
    expect(f.provider.publish).not.toHaveBeenCalled();
    await f.service.disconnect();
    expect(db.selling.get(id).offerId).toBeTruthy();
    expect(await f.vault.read()).toBeNull();
  } finally {
    f.service.stop();
    db.close();
  }
});
it("matches paid sales by both listing ID and SKU, never by title, and deduplicates repeat pages", async () => {
  const db = await Store.open(),
    f = setup(db);
  try {
    await f.service.connect(credentials);
    const source = db.collection.items().find((i) => i.quantity === 2)!,
      a = await active(db, f, draft(db, source.id)),
      b = await active(db, f, {
        ...draft(db, source.id),
        unitLabel: "Binder B · copy 2",
      });
    db.selling.linkMercari({
      id: a.id,
      url: "https://www.mercari.com/us/item/m123456789/",
    });
    db.selling.linkMercari({
      id: b.id,
      url: "https://www.mercari.com/us/item/m987654321/",
    });
    const order: SellingSale = {
      eventId: "order:line",
      orderId: "12-34567-89012",
      listingId: a.ebayListingId!,
      sku: a.sku,
      quantity: 1,
      at: new Date().toISOString(),
    };
    f.provider.orders.mockResolvedValueOnce({
      sales: [{ ...order, sku: b.sku }],
      more: false,
      count: 1,
    });
    await f.service.sync();
    expect(db.selling.get(a.id).soldOn).toBeNull();
    f.provider.orders.mockResolvedValue({
      sales: [order],
      more: false,
      count: 1,
    });
    await f.service.sync();
    await f.service.sync();
    expect(db.selling.get(a.id)).toMatchObject({
      soldOn: "ebay",
      ebayState: "sold",
      mercariState: "active",
    });
    expect(db.selling.get(b.id)).toMatchObject({
      soldOn: null,
      ebayState: "active",
      mercariState: "active",
    });
    expect(f.provider.withdraw).not.toHaveBeenCalled();
  } finally {
    f.service.stop();
    db.close();
  }
});
it("keeps Mercari active until exact deactivation confirmation and prevents duplicate listing links", async () => {
  const db = await Store.open();
  try {
    const source = db.collection.items().find((i) => i.quantity === 2)!,
      a = db.selling.create(draft(db, source.id)),
      b = db.selling.create(draft(db, source.id));
    db.selling.linkMercari({
      id: a,
      url: "https://mercari.com/us/item/m123456789/",
    });
    expect(() =>
      db.selling.linkMercari({
        id: b,
        url: "https://mercari.com/us/item/m123456789/",
      }),
    ).toThrow();
    expect(() =>
      db.selling.inactiveMercari({
        id: a,
        expectedId: "m999999999",
        confirmed: true,
      }),
    ).toThrow();
    expect(db.selling.get(a).mercariState).toBe("active");
    db.selling.inactiveMercari({
      id: a,
      expectedId: "m123456789",
      confirmed: true,
    });
    expect(db.selling.get(a).mercariState).toBe("inactive");
  } finally {
    db.close();
  }
});
it("ends only the linked eBay offer after a confirmed Mercari sale and records conflicts without cancelling buyer orders", async () => {
  const db = await Store.open(),
    f = setup(db);
  try {
    await f.service.connect(credentials);
    const item = await active(db, f);
    db.selling.linkMercari({
      id: item.id,
      url: "https://mercari.com/us/item/m123456789/",
    });
    expect(
      (
        await f.service.mercariSale({
          id: item.id,
          expectedId: "m123456789",
          reference: "Mercari order",
        })
      ).ok,
    ).toBe(true);
    expect(f.provider.withdraw).toHaveBeenCalledWith(credentials, item.offerId);
    expect(db.selling.get(item.id)).toMatchObject({
      soldOn: "mercari",
      ebayState: "inactive",
      mercariState: "sold",
    });
    f.provider.orders.mockResolvedValueOnce({
      sales: [
        {
          eventId: "also-sold",
          orderId: "ebay-order",
          listingId: item.ebayListingId!,
          sku: item.sku,
          quantity: 1,
          at: new Date().toISOString(),
        },
      ],
      more: false,
      count: 1,
    });
    await f.service.sync();
    expect(db.selling.get(item.id).conflict).toBe(true);
    db.selling.reviewConflict(item.id);
    expect(db.selling.get(item.id).conflictReviewed).toBe(true);
  } finally {
    f.service.stop();
    db.close();
  }
});
it("keeps a failed ending unresolved, verifies the remote offer's SKU, and never withdraws an unrelated offer", async () => {
  const db = await Store.open(),
    f = setup(db);
  try {
    await f.service.connect(credentials);
    const item = await active(db, f);
    db.selling.linkMercari({
      id: item.id,
      url: "https://mercari.com/us/item/m123456789/",
    });
    f.provider.withdraw.mockRejectedValueOnce(new EbayError("network"));
    expect(
      (
        await f.service.mercariSale({
          id: item.id,
          expectedId: "m123456789",
          reference: "",
        })
      ).ok,
    ).toBe(false);
    expect(db.selling.get(item.id)).toMatchObject({
      soldOn: "mercari",
      ebayState: "uncertain",
    });
    const remote = f.offers.get(item.offerId!)!;
    remote.sku = "ANOTHER-COPY";
    const calls = f.provider.withdraw.mock.calls.length;
    expect((await f.service.end(item.id)).ok).toBe(false);
    expect(f.provider.withdraw).toHaveBeenCalledTimes(calls);
    remote.sku = item.sku;
    expect((await f.service.end(item.id)).ok).toBe(true);
    expect(db.selling.get(item.id).ebayState).toBe("inactive");
  } finally {
    f.service.stop();
    db.close();
  }
});
it("honors per-copy manual-ending preference and does not republish a sold copy", async () => {
  const db = await Store.open(),
    f = setup(db);
  try {
    await f.service.connect(credentials);
    const item = await active(db, f, { ...draft(db), autoEndEbay: false });
    db.selling.linkMercari({
      id: item.id,
      url: "https://mercari.com/us/item/m123456789/",
    });
    await f.service.mercariSale({
      id: item.id,
      expectedId: "m123456789",
      reference: "",
    });
    await f.service.sync();
    expect(f.provider.withdraw).not.toHaveBeenCalled();
    expect((await f.service.prepare(item.id)).ok).toBe(false);
  } finally {
    f.service.stop();
    db.close();
  }
});
it("keeps credentials out of state/database and restores the old vault value when connection persistence fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-selling-secret-")),
    path = join(dir, "data.sqlite"),
    db = await Store.open(path),
    f = setup(db);
  try {
    await f.service.connect(credentials);
    expect(JSON.stringify(f.service.state())).not.toContain(
      credentials.clientSecret,
    );
    const spy = vi.spyOn(db.selling, "connect").mockImplementationOnce(() => {
      throw Error("disk full");
    });
    const r = await f.service.connect({
      ...credentials,
      refreshToken: "different-private-refresh-token-123456789",
    });
    expect(r.ok).toBe(false);
    expect(await f.vault.read()).toEqual(credentials);
    spy.mockRestore();
    expect(
      readFileSync(path).includes(Buffer.from(credentials.clientSecret)),
    ).toBe(false);
    expect(
      readFileSync(path).includes(Buffer.from(credentials.refreshToken)),
    ).toBe(false);
  } finally {
    f.service.stop();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("persists exact listing IDs, sale state and outstanding removal reminders across restarts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-selling-state-")),
    path = join(dir, "data.sqlite");
  let db = await Store.open(path);
  const f = setup(db);
  try {
    await f.service.connect(credentials);
    const item = await active(db, f);
    db.selling.linkMercari({
      id: item.id,
      url: "https://mercari.com/us/item/m123456789/",
    });
    f.provider.orders.mockResolvedValueOnce({
      sales: [
        {
          eventId: "one",
          orderId: "order",
          listingId: item.ebayListingId!,
          sku: item.sku,
          quantity: 1,
          at: new Date().toISOString(),
        },
      ],
      more: false,
      count: 1,
    });
    await f.service.sync();
    f.service.stop();
    db.close();
    db = await Store.open(path);
    expect(db.selling.get(item.id)).toMatchObject({
      sku: item.sku,
      ebayListingId: item.ebayListingId,
      mercariId: "m123456789",
      soldOn: "ebay",
      mercariState: "active",
    });
    expect(
      db.selling.stock().find((s) => s.id === item.collectionId)?.allocated,
    ).toBe(1);
  } finally {
    f.service.stop();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rolls back sale state and the paging cursor together on database failure", async () => {
  const db = await Store.open(),
    f = setup(db);
  try {
    await f.service.connect(credentials);
    const item = await active(db, f);
    (db as any).db.run(
      "CREATE TRIGGER selling_failure BEFORE UPDATE ON selling_settings BEGIN SELECT RAISE(ABORT,'test'); END;",
    );
    expect(() =>
      db.selling.page(
        [
          {
            eventId: "one",
            orderId: "order",
            listingId: item.ebayListingId!,
            sku: item.sku,
            quantity: 1,
            at: new Date().toISOString(),
          },
        ],
        "2026-01-01T00:00:00Z",
        "2026-01-02T00:00:00Z",
        50,
        true,
      ),
    ).toThrow();
    expect(db.selling.get(item.id).soldOn).toBeNull();
    expect(db.selling.cycle().cycleOffset).toBe(0);
  } finally {
    f.service.stop();
    db.close();
  }
});
it("serializes operations and does not write a completed publication after shutdown", async () => {
  const db = await Store.open(),
    f = setup(db);
  try {
    await f.service.connect(credentials);
    const id = db.selling.create(draft(db)),
      review = (await f.service.prepare(id)).review!;
    let finish!: (id: string) => void;
    f.provider.publish.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const running = f.service.publish({ token: review.token, confirmed: true });
    await vi.waitFor(() => expect(f.provider.publish).toHaveBeenCalled());
    expect((await f.service.sync()).ok).toBe(false);
    f.service.stop();
    finish("12345");
    expect((await running).ok).toBe(false);
    expect(db.selling.get(id).ebayState).toBe("uncertain");
    expect(f.provider.cancel).toHaveBeenCalled();
  } finally {
    f.service.stop();
    db.close();
  }
});
it("migrates v0.5 without changing collection, expenses, inbox or shipping tasks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-selling-migration-")),
    path = join(dir, "data.sqlite");
  let db = await Store.open(path);
  try {
    const before = db.snapshot();
    db.shipping.add({
      name: "Existing shipment",
      orderReference: null,
      shipBy: null,
      status: "Needs Shipment",
      paymentStatus: "Paid",
      notes: "Keep",
    });
    const task = db.shipping.items()[0];
    db.close();
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const old = new SQL.Database(readFileSync(path));
    makeSellingV6(old);
    writeFileSync(path, old.export());
    old.close();
    db = await Store.open(path);
    expect(db.snapshot()).toEqual(before);
    expect(db.shipping.items()[0]).toEqual(task);
    expect(db.selling.units()).toEqual([]);
    expect(existsSync(path + ".pre-selling-v6.bak")).toBe(true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("checks eBay about every five minutes while open, honors pause, and continues saved paging without restarting a range", async () => {
  const db = await Store.open(),
    f = setup(db);
  try {
    await f.service.connect(credentials);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T01:00:00Z"));
    f.service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.provider.orders).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 60000);
    expect(f.provider.orders).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.provider.orders).toHaveBeenCalledTimes(2);
    db.selling.automatic(false);
    await vi.advanceTimersByTimeAsync(10 * 60000);
    expect(f.provider.orders).toHaveBeenCalledTimes(2);
    f.provider.orders.mockResolvedValue({ sales: [], count: 50, more: true });
    await f.service.sync();
    expect(db.selling.cycle().cycleOffset).toBe(250);
    const end = db.selling.cycle().cycleEnd;
    f.provider.orders.mockResolvedValueOnce({
      sales: [],
      count: 1,
      more: false,
    });
    await f.service.sync();
    const args = f.provider.orders.mock.calls.at(-1) as any;
    expect(args[3]).toBe(250);
    expect(args[2]).toBe(end);
    expect(db.selling.cycle().cycleOffset).toBe(0);
  } finally {
    f.service.stop();
    db.close();
  }
});
it.runIf(process.platform === "win32")(
  "stores a personal eBay credential in an isolated Windows vault target",
  async () => {
    const vault = new WindowsCredentialVault<EbayConnectionInput>(
      "PersonalToolbox/EbayTest/" + randomUUID(),
    );
    try {
      await vault.write(credentials);
      expect(await vault.read()).toEqual(credentials);
    } finally {
      await vault.remove();
    }
  },
  60000,
);
