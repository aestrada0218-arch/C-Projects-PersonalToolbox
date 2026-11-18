import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Store } from "../electron/database";
import { CompanionServer } from "../electron/mobile/server";
import { FileCompanionPreferences } from "../electron/mobile/preferences";
import { companionRequestPrefix } from "../src/companion-request";
const origin = "https://remember.example.ts.net";
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "remember-companion-"));
  writeFileSync(join(dir, "mobile.html"), "Mobile");
  const path = join(dir, "settings.json"),
    db = await Store.open();
  let server: CompanionServer;
  let failWrites = false;
  let writes = 0;
  const backing = new FileCompanionPreferences(path);
  const persistence = {
    load: () => backing.load(),
    save: (v: any) => {
      if (failWrites) throw Error("STORAGE_FAILURE");
      backing.save(v);
    },
  };
  const make = () =>
    new CompanionServer(
      db,
      dir,
      0,
      async () => {
        writes++;
        return { value: true };
      },
      persistence,
    );
  server = make();
  const call = (endpoint: string, body?: unknown, cookie = "", csrf = "") =>
    fetch(`http://127.0.0.1:${server.localPort()}${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Host: new URL(server.status().url || origin).host,
        Origin: server.status().url || origin,
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-Toolbox-CSRF": csrf,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const pair = async () => {
    const r = await call("/api/pair", {
      code: server.status().pairCode,
      name: "Remembered iPhone",
    });
    expect(r.status).toBe(200);
    return {
      cookie: r.headers.get("set-cookie")!.split(";")[0],
      ...(await r.json()),
    };
  };
  return {
    db,
    path,
    call,
    pair,
    get server() {
      return server;
    },
    fail(value: boolean) {
      failWrites = value;
    },
    get writes() {
      return writes;
    },
    async restart() {
      server.shutdown();
      server = make();
      await server.restore();
    },
    close() {
      server.shutdown();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
it("remembers origin, auto-enables and restores a phone across process restarts without saving bearer secrets", async () => {
  const f = await fixture();
  try {
    expect(f.server.status().running).toBe(false);
    expect((await f.server.start({ url: origin })).ok).toBe(true);
    const paired = await f.pair(),
      code = f.server.rotatePairCode().state.pairCode!;
    const saved = readFileSync(f.path, "utf8");
    expect(saved).not.toContain(paired.cookie.split("=")[1]);
    expect(saved).not.toContain(paired.csrf);
    expect(saved).not.toContain(code);
    const oldId =
      companionRequestPrefix(
        createHash("sha256").update(paired.csrf).digest("hex"),
      ) + randomUUID().slice(24);
    await f.restart();
    expect(f.server.status()).toMatchObject({
      running: true,
      url: origin,
      devices: [{ name: "Remembered iPhone" }],
    });
    const r = await f.call("/api/session", undefined, paired.cookie);
    expect(r.status).toBe(200);
    const session = await r.json();
    expect(session.csrf).not.toBe(paired.csrf);
    expect(
      (
        await f.call(
          "/api/workspace",
          { requestId: oldId },
          paired.cookie,
          session.csrf,
        )
      ).status,
    ).toBe(409);
    expect(f.writes).toBe(0);
    expect(
      (await f.call("/api/logout", {}, paired.cookie, paired.csrf)).status,
    ).toBe(403);
    expect(
      (await f.call("/api/logout", {}, paired.cookie, session.csrf)).status,
    ).toBe(200);
    await f.restart();
    expect(
      (await f.call("/api/session", undefined, paired.cookie)).status,
    ).toBe(401);
  } finally {
    f.close();
  }
});
it("pause remembers the address and phone, disables auto-start, and explicit revocation survives restart", async () => {
  const f = await fixture();
  try {
    await f.server.start({ url: origin });
    const p = await f.pair();
    expect(f.server.pause().state).toMatchObject({
      running: false,
      url: origin,
    });
    await f.restart();
    expect(f.server.status().running).toBe(false);
    expect(f.server.status().devices).toHaveLength(1);
    await f.server.start({ url: origin });
    expect((await f.call("/api/session", undefined, p.cookie)).status).toBe(
      200,
    );
    expect(f.server.revoke(f.server.status().devices[0].id).ok).toBe(true);
    await f.restart();
    expect((await f.call("/api/session", undefined, p.cookie)).status).toBe(
      401,
    );
    const q = await f.pair();
    expect(f.server.stop().state.devices).toHaveLength(0);
    await f.restart();
    expect(f.server.status()).toMatchObject({
      running: false,
      url: origin,
      devices: [],
    });
    await f.server.start({ url: origin });
    expect((await f.call("/api/session", undefined, q.cookie)).status).toBe(
      401,
    );
  } finally {
    f.close();
  }
});
it("changing the saved origin clears trusted phones and corrupt settings never auto-enable", async () => {
  const f = await fixture();
  try {
    await f.server.start({ url: origin });
    const p = await f.pair();
    f.server.pause();
    await f.server.start({ url: "https://other.example.ts.net" });
    expect(f.server.status().devices).toHaveLength(0);
    expect((await f.call("/api/session", undefined, p.cookie)).status).toBe(
      401,
    );
    f.server.shutdown();
    writeFileSync(f.path, "broken settings");
    await f.restart();
    expect(f.server.status()).toMatchObject({
      running: false,
      url: null,
      devices: [],
    });
    expect(f.server.status().error).toContain("could not be read");
  } finally {
    f.close();
  }
});
it("storage failures never claim a phone was paired or durably revoked", async () => {
  const f = await fixture();
  try {
    await f.server.start({ url: origin });
    f.fail(true);
    const r = await f.call("/api/pair", {
      code: f.server.status().pairCode,
      name: "Phone",
    });
    expect(r.status).toBe(503);
    expect(r.headers.has("set-cookie")).toBe(false);
    expect(f.server.status().devices).toHaveLength(0);
    f.fail(false);
    await f.pair();
    f.fail(true);
    expect(f.server.revoke(f.server.status().devices[0].id).ok).toBe(false);
    expect(f.server.stop().ok).toBe(false);
    expect(f.server.status().devices).toHaveLength(1);
    f.fail(false);
    expect(f.server.stop().ok).toBe(true);
  } finally {
    f.close();
  }
});
