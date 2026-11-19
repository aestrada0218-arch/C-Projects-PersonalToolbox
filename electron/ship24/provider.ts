import { z } from "zod";
import { trackerSchema } from "./model";
export class Ship24Error extends Error {
  constructor(
    public code: string,
    public retryUntil = 0,
  ) {
    super(code);
  }
}
export class Ship24Provider {
  private controllers = new Set<AbortController>();
  constructor(private fetcher: typeof fetch = fetch) {}
  stop() {
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
  }
  private async request(key: string, path: string, body?: unknown) {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await this.fetcher(
        "https://api.ship24.com/public/v1" + path,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "manual",
          signal: controller.signal,
        },
      );
      if (res.status === 429) {
        const h = res.headers.get("Retry-After"),
          seconds = Number(h);
        const until =
          h && Number.isFinite(seconds)
            ? Date.now() + Math.max(1, seconds) * 1000
            : h
              ? Date.parse(h)
              : NaN;
        throw new Ship24Error(
          "RATE",
          Math.min(
            Date.now() + 86400000,
            Math.max(Date.now() + 60000, Number.isFinite(until) ? until : 0),
          ),
        );
      }
      if (res.status === 401 || res.status === 403)
        throw new Ship24Error("AUTH");
      if (res.status === 404) throw new Ship24Error("NOT_FOUND");
      if (res.status === 409) throw new Ship24Error("EXISTS");
      if (res.status === 402) throw new Ship24Error("QUOTA");
      if (!res.ok)
        throw new Ship24Error(res.status >= 500 ? "NETWORK" : "REJECTED");
      if (Number(res.headers.get("content-length") || 0) > 4 * 1024 * 1024)
        throw new Ship24Error("FORMAT");
      const reader = res.body?.getReader();
      if (!reader) throw new Ship24Error("FORMAT");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new Ship24Error("FORMAT");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
      }
      try {
        return JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new Ship24Error("FORMAT");
      }
    } catch (e) {
      if (e instanceof Ship24Error) throw e;
      throw new Ship24Error("NETWORK");
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
  async verify(key: string) {
    z.object({
      data: z.object({ trackers: z.array(trackerSchema).max(1) }),
    }).parse(await this.request(key, "/trackers?page=1&limit=1"));
  }
  async find(key: string, clientId: string) {
    try {
      return z
        .object({ data: z.object({ tracker: trackerSchema }) })
        .parse(
          await this.request(
            key,
            "/trackers/" +
              encodeURIComponent(clientId) +
              "?searchBy=clientTrackerId",
          ),
        ).data.tracker;
    } catch (e) {
      if (e instanceof Ship24Error && e.code === "NOT_FOUND") return null;
      throw e;
    }
  }
  async create(key: string, payload: unknown) {
    try {
      return z
        .object({ data: z.object({ tracker: trackerSchema }) })
        .parse(await this.request(key, "/trackers", payload)).data.tracker;
    } catch (e) {
      if (e instanceof Ship24Error) throw e;
      throw new Ship24Error("FORMAT");
    }
  }
  results(key: string, id: string) {
    return this.request(
      key,
      "/trackers/" + encodeURIComponent(id) + "/results",
    );
  }
}
