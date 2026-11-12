import { it, expect, vi } from "vitest";
import { Store } from "../electron/database";
import { normalizeCard, JustTcgProvider } from "../electron/collection/justtcg";
import { CollectionService } from "../electron/collection/service";
import {
  allowedTcgNavigation,
  tcgProductId,
} from "../electron/collection/model";
import { safePhotoSize } from "../electron/collection/photo";
import { makeCollectionV4 } from "./legacy-collection";
import { WindowsCredentialVault } from "../electron/inbox/credentials";
import type { PricingSecret } from "../electron/collection/service";
import type { CatalogCard } from "../src/collection-types";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import initSqlJs from "sql.js";
import {
  catalogNameQuery,
  rankCatalogCards,
  tcgArtworkUrl,
} from "../src/catalog-display";
const raw = {
  id: "example-card",
  uuid: "card-stable",
  name: "Example Dragon",
  game: "Pokemon",
  set: "example-set",
  set_name: "Example Set",
  number: "001",
  tcgplayerId: "12345",
  variants: [
    {
      id: "variant-raw",
      uuid: "variant-stable",
      condition: "Near Mint",
      printing: "Normal",
      language: null,
      price: 12.34,
      priceStatus: "current",
      lastKnownPrice: null,
      lastUpdated: 1780936262,
    },
  ],
};
const checked = "2026-11-12T12:00:00.000Z";
const card = () => normalizeCard(structuredClone(raw), checked);
it("maps exact catalog product IDs to artwork and rejects URLs, traversal and invalid identifiers", () => {
  expect(tcgArtworkUrl("42382")).toBe(
    "https://tcgplayer-cdn.tcgplayer.com/product/42382_in_400x400.jpg",
  );
  for (const id of [
    null,
    undefined,
    "",
    "0",
    "../123",
    "https://example.com/image.jpg",
    "123?x=y",
    "123/456",
    "1234567890123",
  ])
    expect(tcgArtworkUrl(id)).toBeNull();
});
it("searches full marketplace titles by card name without splitting genuine hyphenated names and ranks exact title/set first", () => {
  const title = "Mew - B/RGB - ME: 30th Celebration (30C)";
  expect(catalogNameQuery(title)).toBe("Mew");
  expect(catalogNameQuery("Mew ex - ME: 30th Celebration (30C)")).toBe(
    "Mew ex",
  );
  for (const query of [
    "Ho-Oh",
    "Porygon-Z",
    "Mr. Mime",
    "Mew - B/RGB",
    "12345",
    "https://www.tcgplayer.com/product/12345/a-b",
  ])
    expect(catalogNameQuery(query)).toBe(query);
  const related = {
    ...card(),
    id: "related",
    name: "Mew",
    setName: "Other Set",
  };
  const exact = {
    ...card(),
    id: "exact",
    name: "Mew - B/RGB",
    setName: "ME: 30th Celebration",
  };
  const sameSet = { ...related, id: "same-set", setName: exact.setName };
  const cards = [related, sameSet, exact];
  expect(rankCatalogCards(cards, title).map((c) => c.id)).toEqual([
    "exact",
    "same-set",
    "related",
  ]);
  expect(cards[0].id).toBe("related");
});
it("sends only the card name for a full title, retains product-ID lookups and one request per page", async () => {
  const db = await Store.open();
  try {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [raw], meta: { hasMore: false } })),
    );
    const provider = new JustTcgProvider(
      db.collection,
      fetcher as typeof fetch,
    );
    const result = await provider.search(key, {
      query: "Mew - B/RGB - ME: 30th Celebration (30C)",
      game: "pokemon",
      offset: 0,
    });
    expect(
      new URL((fetcher.mock.calls[0] as any)[0]).searchParams.get("q"),
    ).toBe("Mew");
    expect(result.searchQuery).toBe("Mew");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await provider.search(key, {
      query: "https://www.tcgplayer.com/product/42382/charizard",
      game: "",
      offset: 0,
    });
    const params = new URL((fetcher.mock.calls[1] as any)[0]).searchParams;
    expect(params.get("tcgplayerId")).toBe("42382");
    expect(params.has("q")).toBe(false);
  } finally {
    db.close();
  }
});
function setup(db: Store) {
  let key: PricingSecret | null = null;
  const vault = {
    read: vi.fn(async () => key),
    write: vi.fn(async (value: PricingSecret) => {
      key = value;
    }),
    remove: vi.fn(async () => {
      key = null;
    }),
  };
  const provider = {
    games: vi.fn(async () => [{ id: "pokemon", name: "Pokemon" }]),
    search: vi.fn(async () => ({ cards: [card()], hasMore: false })),
    batch: vi.fn(async () => [card()]),
    cancel: vi.fn(),
  };
  const service = new CollectionService(db.collection, vault, provider, true);
  return { service, vault, provider };
}
const key = "tcg_test_example_key_12345";
it("normalizes exact variant identity, USD cents, language, zero/unavailable/expired prices, and source time", () => {
  expect(card().variants[0]).toMatchObject({
    id: "variant-stable",
    condition: "Near Mint",
    language: "English",
    valueCents: 1234,
    state: "current",
    observedAt: new Date(1780936262 * 1000).toISOString(),
  });
  const zero = structuredClone(raw);
  zero.variants[0].price = 0;
  expect(normalizeCard(zero, checked).variants[0].valueCents).toBe(0);
  const expired: any = structuredClone(raw);
  expired.variants[0] = {
    ...expired.variants[0],
    price: null,
    priceStatus: "expired",
    lastKnownPrice: 9.87,
  };
  expect(normalizeCard(expired, checked).variants[0]).toMatchObject({
    state: "expired",
    valueCents: null,
    lastKnownCents: 987,
  });
  const unknown: any = structuredClone(raw);
  unknown.variants[0].price = null;
  expect(normalizeCard(unknown, checked).variants[0].state).toBe("unpriced");
});
it("accepts only HTTPS TCGplayer navigation/product IDs and bounds local photo dimensions", () => {
  expect(
    tcgProductId("https://www.tcgplayer.com/product/12345/example?x=1"),
  ).toBe("12345");
  for (const url of [
    "http://www.tcgplayer.com/product/123",
    "https://tcgplayer.com.evil.example/product/123",
    "https://user:pass@tcgplayer.com/product/123",
    "file:///tmp/test",
    "javascript:alert(1)",
    "https://tcgplayer.com:444/product/123",
  ]) {
    expect(allowedTcgNavigation(url)).toBe(false);
    expect(tcgProductId(url)).toBeNull();
  }
  expect(allowedTcgNavigation("https://www.tcgplayer.com/categories")).toBe(
    true,
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT5sAAAAASUVORK5CYII=",
    "base64",
  );
  expect(safePhotoSize(png)).toEqual({ width: 1, height: 1 });
  const huge = Buffer.from(png);
  huge.writeUInt32BE(100000, 16);
  expect(safePhotoSize(huge)).toBeNull();
  expect(safePhotoSize(Buffer.from("<svg/>"))).toBeNull();
});
it("adds manual comics, unknown values, ownership edits and history without losing legacy items", async () => {
  const db = await Store.open();
  try {
    const original = db.collection.items();
    expect(original).toHaveLength(6);
    const id = db.collection.addManual({
      name: "Example comic #1",
      category: "Comics",
      collectionType: "comics",
      quantity: 2,
      purchaseCents: 500,
      valueCents: null,
      referenceUrl: "https://example.com/comic/1",
      imageData: null,
    });
    let item = db.collection.items().find((i) => i.id === id)!;
    expect(item).toMatchObject({
      valueCents: null,
      collectionType: "comics",
      provider: "manual",
    });
    expect(db.collection.history(id)).toHaveLength(0);
    db.collection.edit({
      id,
      item: {
        name: item.name,
        category: item.category,
        collectionType: "comics",
        quantity: 3,
        purchaseCents: 550,
        valueCents: 1000,
        referenceUrl: item.referenceUrl,
        imageData: null,
      },
    });
    item = db.collection.items().find((i) => i.id === id)!;
    expect(item).toMatchObject({
      quantity: 3,
      purchaseCents: 550,
      valueCents: 1000,
      state: "manual",
    });
    expect(db.collection.history(id)[0].valueCents).toBe(1000);
    db.collection.remove(id);
    expect(db.collection.history(id)).toEqual([]);
    expect(db.collection.items()).toHaveLength(6);
  } finally {
    db.close();
  }
});
it("keeps keys out of SQLite and renderer responses, binds additions to search selections, and preserves missing quotes/history", async () => {
  const db = await Store.open();
  const { service, vault, provider } = setup(db);
  try {
    expect((await service.connect(key)).ok).toBe(true);
    expect(await vault.read()).toEqual({ apiKey: key });
    expect(JSON.stringify(service.state())).not.toContain(key);
    const searched = await service.search({
      query: "Dragon",
      game: "pokemon",
      offset: 0,
    });
    const choice = searched.cards[0].variants[0];
    expect(
      service.addLinked({
        selectionId: randomUUID(),
        quantity: 1,
        purchaseCents: 1000,
      }).ok,
    ).toBe(false);
    expect(
      service.addLinked({
        selectionId: choice.selectionId,
        quantity: 2,
        purchaseCents: 1000,
      }).ok,
    ).toBe(true);
    const item = service.state().items.find((i) => i.provider === "justtcg")!;
    expect(item).toMatchObject({
      valueCents: 1234,
      variantId: "variant-stable",
      condition: "Near Mint",
      referenceUrl: "https://www.tcgplayer.com/product/12345",
    });
    const next = card();
    next.variants[0].valueCents = 1500;
    next.checkedAt = "2026-11-12T13:00:00Z";
    provider.batch.mockResolvedValueOnce([next]);
    expect((await service.refresh(item.id)).updated).toBe(1);
    expect(
      service.state().items.find((i) => i.id === item.id)?.valueCents,
    ).toBe(1500);
    const missing = card();
    missing.variants[0].valueCents = null;
    missing.variants[0].state = "expired";
    missing.variants[0].lastKnownCents = 1500;
    provider.batch.mockResolvedValueOnce([missing]);
    await service.refresh(item.id);
    expect(service.state().items.find((i) => i.id === item.id)).toMatchObject({
      valueCents: null,
      lastKnownCents: 1500,
      state: "expired",
    });
    expect(db.collection.history(item.id)).toHaveLength(3);
    provider.batch.mockRejectedValueOnce(new Error(key));
    const failed = await service.refresh(item.id);
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain(key);
    expect(
      service.state().items.find((i) => i.id === item.id)?.lastKnownCents,
    ).toBe(1500);
    expect((await service.disconnect()).ok).toBe(true);
    expect(service.state().settings.connected).toBe(false);
    expect(db.collection.history(item.id)).toHaveLength(3);
    expect(service.state().items.find((i) => i.id === item.id)).toBeTruthy();
  } finally {
    service.stop();
    db.close();
  }
});
it("rejects identity changes on refresh rather than substituting a different printing or condition", async () => {
  const db = await Store.open();
  const { service, provider } = setup(db);
  try {
    await service.connect(key);
    const r = await service.search({ query: "Dragon", game: "", offset: 0 });
    service.addLinked({
      selectionId: r.cards[0].variants[0].selectionId,
      quantity: 1,
      purchaseCents: 0,
    });
    const item = service.state().items.find((i) => i.provider === "justtcg")!;
    const wrong = card();
    wrong.variants[0].condition = "Damaged";
    wrong.variants[0].valueCents = 1;
    provider.batch.mockResolvedValueOnce([wrong]);
    const result = await service.refresh(item.id);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(1);
    expect(
      service.state().items.find((i) => i.id === item.id)?.valueCents,
    ).toBe(1234);
  } finally {
    service.stop();
    db.close();
  }
});
it("restores the old credential when connection persistence fails and does not save rejected keys", async () => {
  const db = await Store.open();
  const { service, vault, provider } = setup(db);
  try {
    provider.games.mockRejectedValueOnce(Error("PRICE_AUTH"));
    expect((await service.connect(key)).ok).toBe(false);
    expect(vault.write).not.toHaveBeenCalled();
    await service.connect(key);
    const spy = vi
      .spyOn(db.collection, "configure")
      .mockImplementationOnce(() => {
        throw Error("disk full");
      });
    expect((await service.connect("tcg_test_replacement_key")).ok).toBe(false);
    expect(await vault.read()).toEqual({ apiKey: key });
    spy.mockRestore();
  } finally {
    service.stop();
    db.close();
  }
});
it("refreshes in free-plan batches of 20, keeps partial success, and reports only unfinished items as failed", async () => {
  const db = await Store.open();
  const { service, provider } = setup(db);
  try {
    await service.connect(key);
    const many = card();
    many.variants = Array.from({ length: 25 }, (_, i) => ({
      ...many.variants[0],
      id: "variant-" + i,
    }));
    provider.search.mockResolvedValueOnce({ cards: [many], hasMore: false });
    const result = await service.search({
      query: "Dragon",
      game: "",
      offset: 0,
    });
    for (const variant of result.cards[0].variants)
      service.addLinked({
        selectionId: variant.selectionId,
        quantity: 1,
        purchaseCents: 1000,
      });
    provider.batch
      .mockImplementationOnce(async (_key: any, ids: any) => [
        {
          ...many,
          variants: many.variants
            .filter((v) => ids.includes(v.id))
            .map((v) => ({ ...v, valueCents: 2000 })),
        },
      ])
      .mockRejectedValueOnce(Error("PRICE_RATE_LIMIT"));
    const refreshed = await service.refresh();
    expect(
      provider.batch.mock.calls.map((args) => (args as any)[1].length),
    ).toEqual([20, 5]);
    expect(refreshed.updated).toBe(20);
    expect(refreshed.failed).toBe(5);
    expect(
      service
        .state()
        .items.filter((i) => i.provider === "justtcg" && i.valueCents === 2000),
    ).toHaveLength(20);
    expect(
      service.state().items.filter((i) => i.provider === "justtcg" && i.error),
    ).toHaveLength(5);
  } finally {
    service.stop();
    db.close();
  }
});
it("uses the documented API URL/header/query, persists local rate limits, and honors server cooldowns without logging raw errors", async () => {
  const db = await Store.open();
  try {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [raw],
            meta: { hasMore: true },
            _metadata: {
              apiDailyRequestsRemaining: 90,
              apiRequestsRemaining: 900,
            },
          }),
          { status: 200 },
        ),
    );
    const provider = new JustTcgProvider(
      db.collection,
      fetcher as unknown as typeof fetch,
    );
    const result = await provider.search(key, {
      query: "Example Dragon",
      game: "pokemon",
      offset: 20,
    });
    const [url, options] = fetcher.mock.calls[0] as any;
    expect(new URL(url).origin).toBe("https://api.justtcg.com");
    expect(new URL(url).searchParams.get("q")).toBe("Example Dragon");
    expect(new URL(url).searchParams.get("limit")).toBe("20");
    expect(new URL(url).searchParams.get("offset")).toBe("20");
    expect(options.headers["x-api-key"]).toBe(key);
    expect(options.redirect).toBe("error");
    expect(result.hasMore).toBe(true);
    expect(db.collection.settings()).toMatchObject({
      dailyRemaining: 90,
      monthlyRemaining: 900,
    });
    fetcher.mockResolvedValueOnce(
      new Response("", { status: 429, headers: { "Retry-After": "120" } }),
    );
    await expect(provider.games(key)).rejects.toThrow("PRICE_RATE_LIMIT");
    expect(db.collection.settings().cooldownUntil).toBeGreaterThan(
      Date.now() + 110000,
    );
    const calls = fetcher.mock.calls.length;
    await expect(provider.games(key)).rejects.toThrow("PRICE_RATE_LIMIT");
    expect(fetcher).toHaveBeenCalledTimes(calls);
  } finally {
    db.close();
  }
});
it("migrates v0.3 data and preserves ownership, orders, expenses and settings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-collection-"));
  const file = join(dir, "db.sqlite");
  try {
    let db = await Store.open(file);
    const oldItems = db.snapshot().collection.map((i) => ({
      id: i.id,
      market: i.market,
      purchase: i.purchase,
      quantity: i.quantity,
    }));
    db.expenses.create(
      {
        description: "Test expense",
        provider: "",
        retailer: "",
        category: "Other Expenses",
        amountCents: 1250,
        date: "2026-11-12",
        intervalMonths: 0,
      },
      "2026-11-12",
    );
    db.close();
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const legacy = new SQL.Database(readFileSync(file));
    makeCollectionV4(legacy);
    writeFileSync(file, legacy.export());
    legacy.close();
    db = await Store.open(file);
    expect(
      db.snapshot().collection.map((i) => ({
        id: i.id,
        market: i.market,
        purchase: i.purchase,
        quantity: i.quantity,
      })),
    ).toEqual(oldItems);
    expect(db.snapshot().orders).toHaveLength(36);
    expect(db.expenses.state("2026-11-12").totalCents).toBe(1250);
    expect(
      db.collection
        .items()
        .every((i) => i.provider === "manual" && i.collectionType === "other"),
    ).toBe(true);
    db.close();
    expect(
      readFileSync(file + ".pre-collection-v4.bak").byteLength,
    ).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it.runIf(process.platform === "win32")(
  "stores a JustTCG-shaped secret in an isolated Windows Credential Manager target",
  async () => {
    const vault = new WindowsCredentialVault<PricingSecret>(
      "PersonalToolbox/Test/" + randomUUID(),
    );
    try {
      await vault.write({ apiKey: key });
      expect(await vault.read()).toEqual({ apiKey: key });
    } finally {
      await vault.remove();
    }
  },
  60000,
);
it("persists linked variant/price history across reopen without saving the API key in SQLite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-quotes-"));
  const file = join(dir, "db.sqlite");
  let db = await Store.open(file);
  const { service } = setup(db);
  try {
    await service.connect(key);
    const r = await service.search({ query: "Dragon", game: "", offset: 0 });
    service.addLinked({
      selectionId: r.cards[0].variants[0].selectionId,
      quantity: 2,
      purchaseCents: 500,
    });
    const id = service.state().items.find((i) => i.provider === "justtcg")!.id;
    await service.refresh(id);
    service.stop();
    db.close();
    expect(readFileSync(file).includes(Buffer.from(key))).toBe(false);
    db = await Store.open(file);
    expect(db.collection.items().find((i) => i.id === id)).toMatchObject({
      quantity: 2,
      purchaseCents: 500,
      valueCents: 1234,
      variantId: "variant-stable",
      provider: "justtcg",
    });
    expect(db.collection.history(id)).toHaveLength(2);
  } finally {
    service.stop();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("prevents overlapping provider operations and stops safely while a request is pending", async () => {
  const db = await Store.open();
  const { service, provider } = setup(db);
  await service.connect(key);
  let finish!: (value: { cards: CatalogCard[]; hasMore: boolean }) => void;
  provider.search.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = service.search({ query: "Dragon", game: "", offset: 0 });
  await Promise.resolve();
  await Promise.resolve();
  expect(
    (await service.search({ query: "Dragon", game: "", offset: 0 })).error,
  ).toContain("already running");
  service.stop();
  db.close();
  finish({ cards: [card()], hasMore: false });
  expect((await pending).ok).toBe(false);
  expect(provider.cancel).toHaveBeenCalled();
});
it("serializes batch identifiers and payload controls as the official SDK documents", async () => {
  const db = await Store.open();
  try {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [raw] }), { status: 200 }),
    );
    const provider = new JustTcgProvider(
      db.collection,
      fetcher as unknown as typeof fetch,
    );
    await provider.batch(key, ["variant-stable"]);
    const [url, options] = fetcher.mock.calls[0] as any;
    expect(url).toBe("https://api.justtcg.com/v1/cards");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual([
      { variantId: "variant-stable", include_price_history: "false" },
    ]);
  } finally {
    db.close();
  }
});
