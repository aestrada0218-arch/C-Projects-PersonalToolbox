import { WorkspaceError } from "./workspace";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Store } from "../database";
import { localToday } from "../shipping/model";
import { expectedDateSchema } from "../mailboxes/model";
import type {
  CompanionStatus,
  CompanionResult,
  MobileSnapshot,
} from "../../src/mobile-types";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const same = (a: string, b: string) => {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
const version = (v: unknown) => hash(JSON.stringify(v));
const ttl = 7 * 86400000;
export const companionOrigin = z
  .string()
  .url()
  .max(253)
  .transform((v) => {
    const u = new URL(v);
    if (
      u.protocol !== "https:" ||
      !u.hostname.endsWith(".ts.net") ||
      u.port ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash
    )
      throw Error("ORIGIN_INVALID");
    return u.origin;
  });
type Device = {
  id: string;
  name: string;
  lastSeen: string;
  expiresAt: string;
  tokenHash: string;
  csrf: string;
};
export class CompanionServer {
  private server: Server | null = null;
  private origin: string | null = null;
  private code: string | null = null;
  private codeExpires = 0;
  private devices = new Map<string, Device>();
  private failures: number[] = [];
  private sockets = new Set<import("node:net").Socket>();
  private addressPort = 17863;
  constructor(
    private store: Store,
    private assets: string,
    private port = 17863,
    private workspace?: (deviceId: string, input: unknown) => Promise<unknown>,
  ) {}
  status(): CompanionStatus {
    this.prune();
    return {
      running: !!this.server?.listening,
      url: this.origin,
      pairCode: this.code && Date.now() < this.codeExpires ? this.code : null,
      pairExpiresAt:
        this.code && Date.now() < this.codeExpires
          ? new Date(this.codeExpires).toISOString()
          : null,
      devices: [...this.devices.values()].map(
        ({ tokenHash: _, csrf: __, ...d }) => d,
      ),
    };
  }
  private result(error?: string): CompanionResult {
    return { ok: !error, error, state: this.status() };
  }
  private prune() {
    for (const [key, d] of this.devices)
      if (Date.parse(d.expiresAt) <= Date.now()) this.devices.delete(key);
  }
  async start(input: unknown) {
    try {
      const { url } = z.object({ url: companionOrigin }).strict().parse(input);
      if (this.server)
        return this.result(
          "Stop the current companion before changing its address.",
        );
      await readFile(join(this.assets, "mobile.html"));
      const server = createServer(
        (req, res) =>
          void this.handle(req, res).catch(() => {
            if (!res.headersSent)
              this.json(res, 500, {
                error: "The desktop could not complete this request.",
              });
            else res.destroy();
          }),
      );
      server.requestTimeout = 30000;
      server.headersTimeout = 10000;
      server.maxHeadersCount = 30;
      server.keepAliveTimeout = 5000;
      server.on("connection", (socket) => {
        this.sockets.add(socket);
        socket.on("close", () => this.sockets.delete(socket));
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.port, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      server.on("error", () => {
        this.stop();
      });
      this.server = server;
      this.addressPort = (server.address() as { port: number }).port;
      this.origin = url;
      this.rotatePairCode();
      return this.result();
    } catch {
      return this.result(
        "Could not start the companion. Build the app first, use your private https://PC.TAILNET.ts.net address, and check that port 17863 is free.",
      );
    }
  }
  rotatePairCode() {
    if (!this.server) return this.result("Start the companion first.");
    this.code = String(randomInt(0, 100000000)).padStart(8, "0");
    this.codeExpires = Date.now() + 5 * 60000;
    return this.result();
  }
  revoke(input: unknown) {
    try {
      const id = z.string().uuid().parse(input);
      for (const [key, d] of this.devices)
        if (d.id === id) this.devices.delete(key);
      return this.result();
    } catch {
      return this.result("Choose a connected device.");
    }
  }
  stop() {
    const server = this.server;
    this.server = null;
    this.origin = null;
    this.code = null;
    this.codeExpires = 0;
    this.devices.clear();
    this.failures = [];
    server?.close();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    return this.result();
  }
  // Used by local integration tests; the listener always binds loopback.
  localPort() {
    return this.addressPort;
  }
  private headers(res: ServerResponse) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://tcgplayer-cdn.tcgplayer.com/product/; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
  }
  private json(res: ServerResponse, status: number, value: unknown) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(value));
  }
  private async body(req: IncomingMessage, limit = 16384) {
    if (req.headers["content-type"]?.split(";")[0] !== "application/json")
      throw Error("BODY_INVALID");
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      const b = Buffer.from(c);
      size += b.length;
      if (size > limit) throw Error("BODY_INVALID");
      chunks.push(b);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  private session(req: IncomingMessage) {
    this.prune();
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("__Host-toolbox="))
      ?.slice("__Host-toolbox=".length);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const d = this.devices.get(hash(token));
    if (d) d.lastSeen = new Date().toISOString();
    return d || null;
  }
  private snapshot(): MobileSnapshot {
    const expenses = this.store.expenses.state(localToday());
    return {
      today: expenses.today,
      updatedAt: new Date().toISOString(),
      collection: this.store.collection.items().map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        collectionType: i.collectionType,
        quantity: i.quantity,
        purchaseCents: i.purchaseCents,
        valueCents: i.valueCents,
        purchaseDate: i.purchaseDate || null,
      })),
      outstanding: this.store.mail
        .lines()
        .filter((i) => i.receivedQty < i.quantity)
        .map((i) => ({
          id: i.id,
          description: i.description,
          quantity: i.quantity,
          receivedQty: i.receivedQty,
          unitCents: i.unitCents,
          purchaseDate: i.purchaseDate,
          expectedDate: i.expectedDate,
          version: version(i),
        })),
      tasks: this.store.shipping.items().map((i) => ({
        id: i.id,
        name: i.name,
        shipBy: i.shipBy,
        status: i.status,
        orderReference: i.orderReference,
        version: version(i),
      })),
      expenses: expenses.entries.map((e) => ({
        id: e.id,
        description: e.description,
        category: e.category,
        amountCents: e.amountCents,
        date: e.date,
      })),
      monthExpenseCents: expenses.monthCents,
      monthlyRecurringCents: expenses.monthlyRecurringCents,
    };
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    this.headers(res);
    const allowedHost = this.origin ? new URL(this.origin).host : "";
    if (
      ![
        allowedHost,
        "127.0.0.1:" + this.addressPort,
        "localhost:" + this.addressPort,
      ].includes(req.headers.host || "")
    ) {
      this.json(res, 403, { error: "Unrecognized host." });
      return;
    }
    const url = new URL(req.url || "/", "http://localhost");
    if (url.search) {
      this.json(res, 400, { error: "Query parameters are not supported." });
      return;
    }
    if (req.method === "OPTIONS") {
      this.json(res, 403, { error: "Cross-origin access is disabled." });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "POST" && req.headers.origin !== this.origin) {
        this.json(res, 403, {
          error:
            "Open the companion from its configured private HTTPS address.",
        });
        return;
      }
      if (req.headers.origin && req.headers.origin !== this.origin) {
        this.json(res, 403, { error: "Cross-origin access is disabled." });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/pair") {
        this.failures = this.failures.filter((t) => t > Date.now() - 60000);
        if (this.failures.length >= 5) {
          res.setHeader("Retry-After", "60");
          this.json(res, 429, {
            error: "Too many pairing attempts. Wait one minute and try again.",
          });
          return;
        }
        this.failures.push(Date.now());
        let input: unknown;
        try {
          input = await this.body(req);
        } catch {
          this.json(res, 400, {
            error: "Enter the pairing code shown on your PC.",
          });
          return;
        }
        const parsed = z
          .object({
            code: z.string().regex(/^\d{8}$/),
            name: z.string().trim().min(1).max(64),
          })
          .strict()
          .safeParse(input);
        if (
          !parsed.success ||
          !this.code ||
          Date.now() >= this.codeExpires ||
          !same(parsed.data.code, this.code)
        ) {
          this.json(res, 401, {
            error:
              "The pairing code is incorrect or expired. Generate a new code on your PC.",
          });
          return;
        }
        this.prune();
        if (this.devices.size >= 20) {
          this.json(res, 409, {
            error: "Revoke an unused device on your PC before pairing another.",
          });
          return;
        }
        const token = randomBytes(32).toString("hex"),
          tokenHash = hash(token),
          device: Device = {
            id: randomUUID(),
            name: parsed.data.name,
            lastSeen: new Date().toISOString(),
            expiresAt: new Date(Date.now() + ttl).toISOString(),
            tokenHash,
            csrf: randomBytes(32).toString("hex"),
          };
        this.devices.set(tokenHash, device);
        this.code = null;
        this.codeExpires = 0;
        res.setHeader(
          "Set-Cookie",
          `__Host-toolbox=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttl / 1000}`,
        );
        this.json(res, 200, {
          csrf: device.csrf,
          name: device.name,
          workspace: !!this.workspace,
        });
        return;
      }
      const session = this.session(req);
      if (!session) {
        this.json(res, 401, {
          error: "Pair this device with Personal Toolbox on your PC.",
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/session") {
        this.json(res, 200, {
          csrf: session.csrf,
          name: session.name,
          workspace: !!this.workspace,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/snapshot") {
        this.json(res, 200, this.snapshot());
        return;
      }
      if (req.method !== "POST") {
        this.json(res, 404, { error: "Unknown operation." });
        return;
      }
      if (!same(String(req.headers["x-toolbox-csrf"] || ""), session.csrf)) {
        this.json(res, 403, {
          error: "Refresh the companion before making changes.",
        });
        return;
      }
      if (url.pathname === "/api/logout") {
        this.devices.delete(session.tokenHash);
        res.setHeader(
          "Set-Cookie",
          "__Host-toolbox=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
        );
        this.json(res, 200, { ok: true });
        return;
      }
      try {
        const input = await this.body(
          req,
          url.pathname === "/api/workspace" ? 20 * 1024 * 1024 : 16384,
        );
        if (!this.server || this.devices.get(session.tokenHash) !== session) {
          this.json(res, 401, {
            error: "This device was unpaired. Pair again on your PC.",
          });
          return;
        }
        if (url.pathname === "/api/workspace") {
          if (!this.workspace) {
            this.json(res, 404, {
              error:
                "Update your desktop app to enable the full mobile workspace.",
            });
            return;
          }
          this.json(res, 200, await this.workspace(session.id, input));
          return;
        }
        if (url.pathname === "/api/expected-date") {
          const v = z
            .object({
              id: z.string().uuid(),
              expectedDate: expectedDateSchema,
              version: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict()
            .parse(input);
          const current = this.store.mail.lines().find((l) => l.id === v.id);
          if (!current || version(current) !== v.version) {
            this.json(res, 409, {
              error:
                "This item changed on your PC. Refresh and review it before saving.",
            });
            return;
          }
          this.store.mail.setExpectedDate({
            ids: [v.id],
            expectedDate: v.expectedDate,
          });
        } else if (url.pathname === "/api/receive") {
          const v = z
            .object({
              id: z.string().uuid(),
              requestId: z.string().uuid(),
              quantity: z.number().int().positive().max(100000),
              tab: z.enum(["cards", "comics", "other"]),
            })
            .strict()
            .parse(input);
          this.store.mail.receive(v);
        } else if (url.pathname === "/api/task-status") {
          const v = z
            .object({
              id: z.string().uuid(),
              status: z.enum(["Needs Shipment", "Shipped", "Cancelled"]),
              version: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict()
            .parse(input);
          const current = this.store.shipping
            .items()
            .find((t) => t.id === v.id);
          if (!current || version(current) !== v.version) {
            this.json(res, 409, {
              error:
                "This task changed on your PC. Refresh and review it before saving.",
            });
            return;
          }
          const { name, orderReference, shipBy, paymentStatus, notes } =
            current;
          this.store.shipping.edit({
            id: v.id,
            item: {
              name,
              orderReference,
              shipBy,
              paymentStatus,
              notes,
              status: v.status,
            },
          });
        } else {
          this.json(res, 404, { error: "Unknown operation." });
          return;
        }
        this.json(res, 200, this.snapshot());
      } catch (error) {
        this.json(res, error instanceof WorkspaceError ? error.status : 400, {
          error:
            error instanceof WorkspaceError
              ? error.message
              : "Could not save this change. Check the fields and refresh the latest data before retrying.",
        });
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      this.json(res, 405, { error: "Method not allowed." });
      return;
    }
    let file: string;
    const fixed: Record<string, string> = {
      "/": "mobile.html",
      "/mobile.html": "mobile.html",
      "/manifest.webmanifest": "manifest.webmanifest",
      "/sw.js": "sw.js",
      "/mobile-shell.json": "mobile-shell.json",
      "/mobile-icon.svg": "mobile-icon.svg",
      "/icon-192.png": "icon-192.png",
      "/icon-512.png": "icon-512.png",
    };
    if (fixed[url.pathname]) file = fixed[url.pathname];
    else if (
      /^\/assets\/[A-Za-z0-9._-]+\.(?:js|css|woff2|png|svg)$/.test(url.pathname)
    )
      file = url.pathname.slice(1);
    else {
      this.json(res, 404, { error: "Not found." });
      return;
    }
    try {
      const bytes = await readFile(join(this.assets, file));
      const ext = file.split(".").pop()!;
      res.setHeader(
        "Content-Type",
        (
          {
            html: "text/html; charset=utf-8",
            js: "text/javascript; charset=utf-8",
            css: "text/css; charset=utf-8",
            json: "application/json",
            webmanifest: "application/manifest+json",
            svg: "image/svg+xml",
            png: "image/png",
            woff2: "font/woff2",
          } as Record<string, string>
        )[ext] || "application/octet-stream",
      );
      if (file.startsWith("assets/"))
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch {
      this.json(res, 404, {
        error: "Build the mobile companion assets first.",
      });
    }
  }
}
