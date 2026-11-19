import { schemas } from "../electron/organizer/model";
import { afterEach, expect, it, vi } from "vitest";
import { Store } from "../electron/database";
import { Ship24Service, type Ship24Secret } from "../electron/ship24/service";
import { Ship24Provider, Ship24Error } from "../electron/ship24/provider";
import {
  parseResults,
  registrationSchema,
  trackingNumber,
} from "../electron/ship24/model";
import type { CredentialVault } from "../electron/inbox/credentials";
import type { TrackingSource } from "../src/ship24-types";
const key = "offline-test-secret-never-send";
const opened: Store[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
  vi.restoreAllMocks();
});
async function fixture() {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => (now += 2000));
  const db = await Store.open();
  opened.push(db);
  const packageId = db.organizer.save({
    id: null,
    revision: null,
    kind: "package",
    data: {
      orderId: db.snapshot().orders[0].id,
      carrier: "USPS",
      tracking: "9400123456789000",
      status: "In transit",
      expectedDate: "2027-01-01",
      actualDate: null,
      notes: "Manual note",
    },
  });
  let secret: Ship24Secret | null = null;
  const vault: CredentialVault<Ship24Secret> = {
    read: vi.fn(async () => secret),
    write: vi.fn(async (s) => {
      secret = s;
    }),
    remove: vi.fn(async () => {
      secret = null;
    }),
  };
  const provider = {
    verify: vi.fn(async () => {}),
    find: vi.fn(async (_key: string, _id: string): Promise<any> => null),
    create: vi.fn(async (_key: string, p: any) => ({
      ...p,
      trackerId: "provider-1",
      isSubscribed: true,
    })),
    results: vi.fn(async () => results()),
    stop: vi.fn(),
  };
  const service = new Ship24Service(
    db.ship24,
    vault,
    provider as unknown as Ship24Provider,
    true,
  );
  await service.initialize();
  const source = service.state().sources.find((s) => s.id === packageId)!;
  const input = (s: TrackingSource = source) => ({
    source: { type: s.type, id: s.id, signature: s.signature },
    confirmed: true,
    destinationCountryCode: null,
    destinationPostCode: null,
    shippingDate: null,
  });
  return {
    db,
    service,
    provider,
    vault,
    source,
    input,
    advance: (n = 60000) => {
      now += n;
    },
  };
}
function results(milestones = ["in_transit"], date = "2027-01-03") {
  return {
    data: {
      trackings: milestones.map((statusMilestone) => ({
        tracker: {
          trackerId: "provider-1",
          trackingNumber: "9400123456789000",
        },
        shipment: {
          statusMilestone,
          delivery: { estimatedDeliveryDate: "2027-01-04" },
        },
        events: [
          {
            status: "Carrier update",
            statusMilestone,
            occurrenceDatetime: date + "T09:30:00",
            location: "Sorting center",
          },
        ],
        statistics: {
          timestamps: {
            deliveredDatetime:
              statusMilestone === "delivered" ? date + "T09:30:00" : null,
          },
        },
      })),
    },
  };
}
it("validates explicit consent, source identity and actual calendar dates", () => {
  expect(trackingNumber(" 94 001 ")).toBe("94001");
  expect(() => trackingNumber("../?bad")).toThrow();
  expect(registrationSchema.safeParse({ confirmed: false }).success).toBe(
    false,
  );
});
it("verifies before storing, keeps credentials out of public state and SQL", async () => {
  const f = await fixture();
  expect((await f.service.connect({ apiKey: key })).ok).toBe(true);
  expect(f.provider.verify).toHaveBeenCalledWith(key);
  expect(f.vault.write).toHaveBeenCalledWith({ apiKey: key });
  expect(JSON.stringify(f.service.state())).not.toContain(key);
  expect(JSON.stringify(f.db.ship24.all())).not.toContain(key);
  expect(f.service.state().autoEnabled).toBe(false);
  f.provider.verify.mockRejectedValueOnce(new Ship24Error("AUTH"));
  expect((await f.service.connect({ apiKey: "another-invalid-key" })).ok).toBe(
    false,
  );
  expect(f.vault.write).toHaveBeenCalledTimes(1);
  expect(f.service.state().connected).toBe(true);
});
it("credential-write failure leaves no connected plaintext fallback", async () => {
  const f = await fixture();
  vi.mocked(f.vault.write).mockRejectedValueOnce(Error(key));
  const r = await f.service.connect({ apiKey: key });
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain(key);
  expect(r.state.connected).toBe(false);
  expect(f.vault.remove).toHaveBeenCalledOnce();
});
it("requires a live source and consent before any registration", async () => {
  const f = await fixture();
  await f.service.connect({ apiKey: key });
  expect(
    (await f.service.register({ ...f.input(), confirmed: false })).ok,
  ).toBe(false);
  expect(
    (
      await f.service.register({
        ...f.input(),
        source: { ...f.input().source, signature: "a".repeat(64) },
      })
    ).ok,
  ).toBe(false);
  expect(f.provider.create).not.toHaveBeenCalled();
  expect(f.provider.find).not.toHaveBeenCalled();
});
it("deduplicates exact shipment registration and refreshes with GET only; manual data stays intact", async () => {
  const f = await fixture();
  await f.service.connect({ apiKey: key });
  expect((await f.service.register(f.input())).ok).toBe(true);
  expect((await f.service.register(f.input())).ok).toBe(true);
  expect(f.provider.create).toHaveBeenCalledTimes(1);
  expect(f.service.state().usedThisMonth).toBe(1);
  const id = f.service.state().trackers[0].id;
  f.provider.results.mockResolvedValueOnce(results(["delivered"]));
  expect((await f.service.refresh(id)).ok).toBe(true);
  expect(f.service.state().trackers[0].summary?.status).toBe("Delivered");
  const raw = f.db.organizer.records().find((r) => r.id === f.source.id)!;
  expect(raw.data.status).toBe("In transit");
  expect(raw.data.notes).toBe("Manual note");
  expect(
    f.db.organizer.state().records.find((r) => r.id === f.source.id)?.ship24
      ?.summary.status,
  ).toBe("Delivered");
  vi.mocked(Date.now).mockReturnValue(f.db.ship24.get(id)!.lastAttempt + 100);
  expect((await f.service.refresh(id)).error).toContain("30 seconds");
  expect(f.provider.create).toHaveBeenCalledTimes(1);
});
it("enforces the local cap across disconnects and API-key changes", async () => {
  const f = await fixture();
  await f.service.connect({ apiKey: key });
  await f.service.preferences({ autoEnabled: false, monthlyCap: 1 });
  await f.service.register(f.input());
  await f.service.disconnect();
  expect(f.service.state().trackers).toHaveLength(1);
  await f.service.connect({ apiKey: "another-offline-key" });
  const r = await f.service.register(f.input());
  expect(r.error).toContain("cap");
  expect(f.provider.create).toHaveBeenCalledTimes(1);
  expect(r.state.usedThisMonth).toBe(1);
});
it("uncertain POST cannot be replayed and recovers using stable client ID after restart", async () => {
  const f = await fixture();
  await f.service.connect({ apiKey: key });
  f.provider.create.mockRejectedValueOnce(new Ship24Error("NETWORK"));
  expect((await f.service.register(f.input())).ok).toBe(false);
  const row = f.db.ship24.all()[0];
  expect(row.phase).toBe("uncertain");
  expect((await f.service.register(f.input())).error).toContain("uncertain");
  const restarted = new Ship24Service(
    f.db.ship24,
    f.vault,
    f.provider as unknown as Ship24Provider,
    true,
  );
  await restarted.initialize();
  f.provider.find.mockResolvedValueOnce({
    ...row.payload,
    trackerId: "provider-1",
    isSubscribed: true,
  });
  expect((await restarted.recover(row.id)).ok).toBe(true);
  expect(f.provider.find).toHaveBeenLastCalledWith(key, row.clientTrackerId);
  expect(f.provider.create).toHaveBeenCalledTimes(1);
  expect(restarted.state().usedThisMonth).toBe(1);
});
it("recovers an existing tracker without consuming a new local registration", async () => {
  const f = await fixture();
  await f.service.connect({ apiKey: key });
  f.provider.find.mockImplementationOnce(async (_k, id) => ({
    trackerId: "provider-1",
    trackingNumber: f.source.trackingNumber,
    clientTrackerId: id,
    isSubscribed: true,
  }));
  expect((await f.service.register(f.input())).ok).toBe(true);
  expect(f.provider.create).not.toHaveBeenCalled();
  expect(f.service.state().usedThisMonth).toBe(0);
});
it("rate limiting persists a cooldown and prevents new requests", async () => {
  const f = await fixture();
  await f.service.connect({ apiKey: key });
  await f.service.register(f.input());
  f.provider.results.mockRejectedValueOnce(
    new Ship24Error("RATE", Date.now() + 600000),
  );
  const id = f.service.state().trackers[0].id;
  expect((await f.service.refresh(id)).ok).toBe(false);
  const cooldown = f.db.ship24.settings().cooldownUntil;
  expect(cooldown).toBeGreaterThan(Date.now());
  f.advance();
  expect((await f.service.refresh(id)).ok).toBe(false);
  expect(f.provider.results).toHaveBeenCalledTimes(1);
});
it("keeps last good cache on empty, mismatched or failed updates", async () => {
  const f = await fixture();
  await f.service.connect({ apiKey: key });
  await f.service.register(f.input());
  const id = f.service.state().trackers[0].id;
  await f.service.refresh(id);
  const good = f.service.state().trackers[0].summary;
  f.advance();
  f.provider.results.mockResolvedValueOnce({ data: { trackings: [] } });
  expect((await f.service.refresh(id)).ok).toBe(false);
  expect(f.service.state().trackers[0].summary).toEqual(good);
  f.advance();
  f.provider.results.mockRejectedValueOnce(Error(key));
  const r = await f.service.refresh(id);
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain(key);
  expect(r.state.trackers[0].summary).toEqual(good);
});
it("does not automatically register sources; polling is opt-in and bounded", async () => {
  const f = await fixture();
  await f.service.connect({ apiKey: key });
  await f.service.tick();
  expect(f.provider.results).not.toHaveBeenCalled();
  expect(f.provider.create).not.toHaveBeenCalled();
  await f.service.register(f.input());
  await f.service.preferences({ autoEnabled: true, monthlyCap: 10 });
  await f.service.tick();
  expect(f.provider.results).toHaveBeenCalledTimes(1);
  await f.service.tick();
  expect(f.provider.results).toHaveBeenCalledTimes(1);
  f.advance(31 * 60000);
  await f.service.tick();
  expect(f.provider.results).toHaveBeenCalledTimes(2);
  await f.service.disconnect();
  f.advance(31 * 60000);
  await f.service.tick();
  expect(f.provider.results).toHaveBeenCalledTimes(2);
  f.service.stop();
  expect(f.provider.stop).toHaveBeenCalledOnce();
});
it("requires all linked shipments to be delivered and preserves carrier timestamps", () => {
  const s = parseResults(
    results(["delivered", "in_transit"]),
    "provider-1",
    "9400123456789000",
    null,
  );
  expect(s.status).toBe("In transit");
  expect(s.actualDate).toBeNull();
  expect(s.events[0].date).toBe("2027-01-03T09:30:00");
  expect(
    parseResults(
      results(["delivered", "delivered"]),
      "provider-1",
      "9400123456789000",
      null,
    ).status,
  ).toBe("Delivered");
  expect(() =>
    parseResults(results(), "different", "9400123456789000", null),
  ).toThrow("RESULT_MISMATCH");
  expect(() =>
    parseResults(
      results(["delivered"], "2020-01-01"),
      "provider-1",
      "9400123456789000",
      "2026-01-01",
    ),
  ).toThrow("RESULT_OLD");
});
it("uses a fixed HTTPS host and header-only key; redirects cannot leak credentials", async () => {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ data: { trackers: [] } })),
  );
  const p = new Ship24Provider(fetcher as unknown as typeof fetch);
  await p.verify(key);
  const [url, options] = fetcher.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("https://api.ship24.com/public/v1/trackers?page=1&limit=1");
  expect(url).not.toContain(key);
  expect(options.redirect).toBe("manual");
  expect(options.method).toBe("GET");
  expect(options.headers).toMatchObject({ Authorization: "Bearer " + key });
});
it("honors Retry-After, rejects oversized data, and hides provider error bodies", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(key, { status: 429, headers: { "Retry-After": "120" } }),
  );
  const p = new Ship24Provider(fetcher as unknown as typeof fetch);
  await expect(p.verify(key)).rejects.toMatchObject({ code: "RATE" });
  fetcher.mockResolvedValueOnce(
    new Response("{}", {
      headers: { "Content-Length": String(5 * 1024 * 1024) },
    }),
  );
  await expect(p.verify(key)).rejects.toMatchObject({ code: "FORMAT" });
  fetcher.mockResolvedValueOnce(new Response(key, { status: 500 }));
  await expect(p.verify(key)).rejects.toMatchObject({ message: "NETWORK" });
});

it("migrates schema 12 without changing orders or manual package records", async () => {
  const { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { default: initSqlJs } = await import("sql.js");
  const dir = mkdtempSync(join(tmpdir(), "ship24-migration-")),
    file = join(dir, "db.sqlite");
  try {
    const old = await Store.open(file),
      orders = old.snapshot().orders;
    old.close();
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const raw = new SQL.Database(readFileSync(file));
    raw.run(
      "DROP TABLE ship24_trackers; DROP TABLE ship24_settings; DELETE FROM migrations WHERE version=13",
    );
    writeFileSync(file, raw.export());
    raw.close();
    const upgraded = await Store.open(file);
    try {
      expect(upgraded.snapshot().orders).toEqual(orders);
      expect(upgraded.ship24.settings().connected).toBe(false);
      expect(upgraded.ship24.settings().monthlyCap).toBe(10);
      expect(existsSync(file + ".pre-ship24-v12.bak")).toBe(true);
      const validate = await Store.backupValidator();
      expect(() => validate(upgraded.exportBackup())).not.toThrow();
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("shares one provider tracker between exact matching package records", async () => {
  const f = await fixture();
  await f.service.connect({ apiKey: key });
  await f.service.register(f.input());
  const first = f.db.organizer.records().find((r) => r.id === f.source.id)!;
  const id = f.db.organizer.save({
    id: null,
    revision: null,
    kind: "package",
    data: schemas.package.strip().parse(first.data),
  });
  const alias = f.service.state().sources.find((s) => s.id === id)!;
  expect((await f.service.register(f.input(alias))).ok).toBe(true);
  expect(f.provider.create).toHaveBeenCalledTimes(1);
  expect(f.service.state().trackers).toHaveLength(1);
  expect(f.service.state().trackers[0].sources).toHaveLength(2);
});

it("rejects source changes that happen while checking for an existing tracker", async () => {
  const f = await fixture();
  await f.service.connect({ apiKey: key });
  f.provider.find.mockImplementationOnce(async () => {
    const row = f.db.organizer.records().find((r) => r.id === f.source.id)!;
    f.db.organizer.save({
      id: row.id,
      revision: row.revision,
      kind: "package",
      data: {
        ...schemas.package.strip().parse(row.data),
        tracking: "9400123456789999",
      },
    });
    return null;
  });
  expect((await f.service.register(f.input())).error).toContain(
    "source changed",
  );
  expect(f.provider.create).not.toHaveBeenCalled();
  expect(f.service.state().usedThisMonth).toBe(0);
});
