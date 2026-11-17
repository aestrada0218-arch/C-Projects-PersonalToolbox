import { request } from "node:http";
import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../electron/database";
import { CompanionServer } from "../electron/mobile/server";
const origin = "https://toolbox.example.ts.net";
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "mobile-api-"));
  writeFileSync(join(dir, "mobile.html"), "<h1>Mobile shell</h1>");
  const db = await Store.open(),
    server = new CompanionServer(db, dir, 0);
  expect((await server.start({ url: origin })).ok).toBe(true);
  const base = "http://127.0.0.1:" + server.localPort();
  const call = (
    path: string,
    body?: unknown,
    cookie = "",
    csrf = "",
    extra: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Host: new URL(origin).host,
        ...(body === undefined
          ? {}
          : {
              Origin: origin,
              "Content-Type": "application/json",
              "X-Toolbox-CSRF": csrf,
            }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const pair = async () => {
    const code = server.status().pairCode;
    const res = await call("/api/pair", { code, name: "Test iPhone" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!.split(";")[0],
      value = await res.json();
    return { cookie, csrf: value.csrf };
  };
  return {
    db,
    server,
    call,
    pair,
    cleanup() {
      server.stop();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
it("serves a mobile shell while protecting data, enforcing origins and issuing HttpOnly Secure single-use sessions", async () => {
  const f = await setup();
  try {
    expect((await f.call("/")).status).toBe(200);
    expect((await f.call("/api/snapshot")).status).toBe(401);
    expect(
      (
        await f.call(
          "/api/pair",
          { code: f.server.status().pairCode, name: "Phone" },
          "",
          "",
          { Origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    const code = f.server.status().pairCode!,
      r = await f.call("/api/pair", { code, name: "Phone" });
    expect(r.headers.get("set-cookie")).toMatch(
      /HttpOnly; Secure; SameSite=Strict/,
    );
    const cookie = r.headers.get("set-cookie")!.split(";")[0],
      value = await r.json();
    expect(f.server.status().pairCode).toBeNull();
    expect((await f.call("/api/pair", { code, name: "Other" })).status).toBe(
      401,
    );
    const data = await f
      .call("/api/snapshot", undefined, cookie)
      .then((r) => r.json());
    expect(data.collection.length).toBeGreaterThan(0);
    expect(data).not.toHaveProperty("accounts");
    expect(data).not.toHaveProperty("settings");
    expect(JSON.stringify(data)).not.toContain("appPassword");
    expect(
      (await f.call("/api/expected-date", {}, cookie, "wrong")).status,
    ).toBe(403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const r = request(
        {
          hostname: "127.0.0.1",
          port: f.server.localPort(),
          path: "/api/snapshot",
          headers: { host: "evil.example", cookie },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      r.on("error", reject);
      r.end();
    });
    expect(badHost).toBe(403);
    expect(
      (await f.call("/personal-toolbox.sqlite", undefined, cookie)).status,
    ).toBe(404);
    expect(
      (await f.call("/api/session", undefined, cookie)).headers.get(
        "cache-control",
      ),
    ).toBe("no-store");
    expect(value.csrf).toHaveLength(64);
  } finally {
    f.cleanup();
  }
});
it("rate-limits pairing attempts and rejects public/insecure companion origins", async () => {
  const f = await setup();
  try {
    for (let i = 0; i < 5; i++)
      expect(
        (await f.call("/api/pair", { code: "not-a-code", name: "Phone" }))
          .status,
      ).toBe(401);
    expect(
      (
        await f.call("/api/pair", {
          code: f.server.status().pairCode,
          name: "Phone",
        })
      ).status,
    ).toBe(429);
    f.server.stop();
    expect(
      (await f.server.start({ url: "http://toolbox.example.ts.net" })).ok,
    ).toBe(false);
    expect(
      (await f.server.start({ url: "https://public.example.com" })).ok,
    ).toBe(false);
  } finally {
    f.cleanup();
  }
});
it("updates the shared database, rejects stale edits and receives items idempotently without exposing destructive APIs", async () => {
  const f = await setup();
  try {
    f.db.mail.ingest(
      "test",
      [
        {
          transactionId: "MOBILETEST00001",
          purchaseDate: "2026-11-16",
          lines: [
            {
              description: "Phone comic",
              quantity: 3,
              unitCents: 399,
              amountCents: 1197,
              kind: "item",
            },
          ],
        },
      ],
      { validity: "1", lastUid: 1 },
      { scanned: 1, skipped: 0, limited: false },
    );
    const taskId = f.db.shipping.add({
      name: "Ship comic",
      orderReference: null,
      shipBy: "2026-12-01",
      status: "Needs Shipment",
      paymentStatus: "Paid",
      notes: "Private note kept on PC",
    });
    const { cookie, csrf } = await f.pair(),
      data = await f
        .call("/api/snapshot", undefined, cookie)
        .then((r) => r.json()),
      line = data.outstanding[0];
    expect(data.tasks.find((t: any) => t.id === taskId)).not.toHaveProperty(
      "notes",
    );
    const payload = {
      id: line.id,
      expectedDate: "2027-01-01",
      version: line.version,
    };
    expect(
      (await f.call("/api/expected-date", payload, cookie, csrf)).status,
    ).toBe(200);
    expect(f.db.mail.lines()[0].expectedDate).toBe("2027-01-01");
    expect(
      (await f.call("/api/expected-date", payload, cookie, csrf)).status,
    ).toBe(409);
    const receive = {
      id: line.id,
      quantity: 2,
      tab: "comics",
      requestId: "11111111-1111-4111-8111-111111111111",
    };
    expect((await f.call("/api/receive", receive, cookie, csrf)).status).toBe(
      200,
    );
    expect((await f.call("/api/receive", receive, cookie, csrf)).status).toBe(
      200,
    );
    expect(f.db.mail.lines()[0].receivedQty).toBe(2);
    const task = data.tasks.find((t: any) => t.id === taskId);
    expect(
      (
        await f.call(
          "/api/task-status",
          { id: taskId, status: "Shipped", version: task.version },
          cookie,
          csrf,
        )
      ).status,
    ).toBe(200);
    expect(f.db.shipping.items().find((t) => t.id === taskId)).toMatchObject({
      status: "Shipped",
      notes: "Private note kept on PC",
    });
    expect(
      (await f.call("/api/delete-order", { id: line.id }, cookie, csrf)).status,
    ).toBe(404);
  } finally {
    f.cleanup();
  }
});
it("revokes devices immediately and clears pairing and sessions on stop", async () => {
  const f = await setup();
  try {
    const { cookie } = await f.pair();
    const devices = f.server.status().devices;
    expect(devices).toHaveLength(1);
    expect(devices[0]).not.toHaveProperty("tokenHash");
    expect(devices[0]).not.toHaveProperty("csrf");
    f.server.revoke(devices[0].id);
    expect((await f.call("/api/snapshot", undefined, cookie)).status).toBe(401);
    f.server.rotatePairCode();
    await f.pair();
    expect(f.server.stop().state.devices).toHaveLength(0);
    expect(f.server.status().running).toBe(false);
  } finally {
    f.cleanup();
  }
});

import { vi } from "vitest";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
it("expires unused pairing codes and device sessions without persisting authentication", async () => {
  const f = await setup(),
    base = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(base + 6 * 60000);
  try {
    expect(
      (await f.call("/api/pair", { code: "12345678", name: "Phone" })).status,
    ).toBe(401);
    expect(f.server.status().pairCode).toBeNull();
    f.server.rotatePairCode();
    const { cookie } = await f.pair();
    clock.mockReturnValue(base + 8 * 86400000);
    expect((await f.call("/api/session", undefined, cookie)).status).toBe(401);
    expect(f.server.status().devices).toHaveLength(0);
  } finally {
    clock.mockRestore();
    f.cleanup();
  }
});
it("never intercepts private API responses in the offline service worker", () => {
  const handlers = new Map<string, (event: any) => void>(),
    respondWith = vi.fn(),
    open = vi.fn();
  runInNewContext(readFileSync(join(process.cwd(), "public/sw.js"), "utf8"), {
    self: {
      location: { origin },
      addEventListener: (name: string, fn: any) => handlers.set(name, fn),
    },
    URL,
    caches: { open },
    fetch: vi.fn(),
    Response,
  });
  for (const path of ["/api/snapshot", "/api/session", "/api/pair"])
    handlers.get("fetch")!({
      request: new Request(origin + path),
      respondWith,
    });
  expect(respondWith).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});
