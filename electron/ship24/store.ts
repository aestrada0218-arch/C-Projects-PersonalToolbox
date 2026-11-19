import type { Database, SqlValue } from "sql.js";
import { randomUUID } from "node:crypto";
import type { Store } from "../database";
import type {
  TrackingSource,
  TrackingSummary,
  Ship24Tracker,
} from "../../src/ship24-types";
import { digest, trackingNumber } from "./model";
export type Binding = {
  id: string;
  connectionTag: string;
  fingerprint: string;
  clientTrackerId: string;
  payload: Record<string, any>;
  sources: TrackingSource[];
  phase: "pending" | "active" | "uncertain";
  attempted: boolean;
  providerId: string | null;
  month: string;
  createdAt: string;
  checkedAt: string | null;
  lastAttempt: number;
  error: string | null;
  summary: TrackingSummary | null;
};
export class Ship24Repository {
  constructor(
    private db: () => Database,
    private transaction: <T>(fn: () => T) => T,
    private store: () => Store,
  ) {}
  private rows(sql: string, params: SqlValue[] = []) {
    const st = this.db().prepare(sql);
    try {
      st.bind(params);
      const rows: Record<string, SqlValue>[] = [];
      while (st.step()) rows.push(st.getAsObject());
      return rows;
    } finally {
      st.free();
    }
  }
  settings() {
    const r = this.rows("SELECT * FROM ship24_settings WHERE id=1")[0];
    return {
      connected: !!r.connected,
      connectionTag: r.connectionTag as string | null,
      autoEnabled: !!r.autoEnabled,
      monthlyCap: Number(r.monthlyCap),
      cooldownUntil: Number(r.cooldownUntil),
      lastRequestAt: Number(r.lastRequestAt),
      nextPoll: Number(r.nextPoll),
    };
  }
  configure(connected: boolean, tag: string | null) {
    this.transaction(() =>
      this.db().run(
        "UPDATE ship24_settings SET connected=?,connectionTag=?,autoEnabled=0 WHERE id=1",
        [Number(connected), tag],
      ),
    );
  }
  preferences(auto: boolean, cap: number) {
    this.transaction(() =>
      this.db().run(
        "UPDATE ship24_settings SET autoEnabled=?,monthlyCap=?,nextPoll=0 WHERE id=1",
        [Number(auto), cap],
      ),
    );
  }
  request() {
    this.transaction(() =>
      this.db().run("UPDATE ship24_settings SET lastRequestAt=? WHERE id=1", [
        Date.now(),
      ]),
    );
  }
  cooldown(until: number) {
    this.transaction(() =>
      this.db().run(
        "UPDATE ship24_settings SET cooldownUntil=MAX(cooldownUntil,?) WHERE id=1",
        [until],
      ),
    );
  }
  nextPoll() {
    this.transaction(() =>
      this.db().run("UPDATE ship24_settings SET nextPoll=? WHERE id=1", [
        Date.now() + 30 * 60000,
      ]),
    );
  }
  sources(): TrackingSource[] {
    const s = this.store(),
      orders = s.snapshot().orders;
    const sources: TrackingSource[] = [];
    const add = (
      type: "package" | "shipment",
      id: string,
      tracking: string,
      carrier: string,
      title: string,
      earliestDate: string | null,
    ) => {
      try {
        carrier =
          (
            { USPS: "USPS", UPS: "UPS", FEDEX: "FedEx", DHL: "DHL" } as Record<
              string,
              string
            >
          )[carrier.trim().toUpperCase()] || carrier.trim();
        const number = trackingNumber(tracking),
          signature = digest([type, id, number, carrier, earliestDate]);
        sources.push({
          type,
          id,
          trackingNumber: number,
          carrier,
          title,
          earliestDate,
          signature,
        });
      } catch {
        /* Blank/unsupported numbers remain editable in their source view. */
      }
    };
    for (const p of s.organizer.records().filter((r) => r.kind === "package"))
      add(
        "package",
        p.id,
        p.data.tracking,
        p.data.carrier,
        p.data.orderName || p.data.tracking,
        orders.find((o) => o.id === p.data.orderId)?.date || null,
      );
    for (const p of s.shipments())
      add(
        "shipment",
        p.id,
        p.tracking,
        p.carrier,
        p.subject,
        p.orderId ? orders.find((o) => o.id === p.orderId)?.date || null : null,
      );
    return sources;
  }
  all(): Binding[] {
    return this.rows(
      "SELECT * FROM ship24_trackers ORDER BY createdAt DESC,rowid DESC",
    ).map((r) => ({
      ...r,
      payload: JSON.parse(String(r.payload)),
      sources: JSON.parse(String(r.sources)),
      summary: r.summary ? JSON.parse(String(r.summary)) : null,
      attempted: !!r.attempted,
      lastAttempt: Number(r.lastAttempt),
    })) as Binding[];
  }
  get(id: string) {
    return this.all().find((r) => r.id === id);
  }
  used() {
    return this.rows(
      "SELECT COUNT(*) AS n FROM ship24_trackers WHERE attempted=1 AND month=?",
      [new Date().toISOString().slice(0, 7)],
    )[0].n as number;
  }
  prepare(tag: string, payload: Record<string, any>, source: TrackingSource) {
    const fingerprint = digest(payload),
      clientTrackerId = "pt-" + fingerprint.slice(0, 48);
    let row = this.all().find(
      (r) => r.connectionTag === tag && r.fingerprint === fingerprint,
    );
    if (row) {
      this.transaction(() => {
        const links = [
          ...row!.sources.filter(
            (s) => !(s.type === source.type && s.id === source.id),
          ),
          source,
        ];
        this.db().run("UPDATE ship24_trackers SET sources=? WHERE id=?", [
          JSON.stringify(links),
          row!.id,
        ]);
      });
      return this.get(row.id)!;
    }
    const id = randomUUID();
    this.transaction(() =>
      this.db().run(
        "INSERT INTO ship24_trackers(id,connectionTag,fingerprint,clientTrackerId,payload,sources,phase,month,createdAt) VALUES(?,?,?,?,?,?,'pending',?,?)",
        [
          id,
          tag,
          fingerprint,
          clientTrackerId,
          JSON.stringify({ ...payload, clientTrackerId }),
          JSON.stringify([source]),
          new Date().toISOString().slice(0, 7),
          new Date().toISOString(),
        ],
      ),
    );
    return this.get(id)!;
  }
  reserve(id: string) {
    this.transaction(() => {
      const row = this.get(id);
      if (!row) throw Error("MISSING");
      if (row.attempted) throw Error("UNCERTAIN");
      if (this.used() >= this.settings().monthlyCap) throw Error("LOCAL_CAP");
      this.db().run(
        "UPDATE ship24_trackers SET attempted=1,month=?,lastAttempt=? WHERE id=?",
        [new Date().toISOString().slice(0, 7), Date.now(), id],
      );
    });
  }
  activate(id: string, providerId: string) {
    this.transaction(() =>
      this.db().run(
        "UPDATE ship24_trackers SET providerId=?,phase='active',lastAttempt=0,error=NULL WHERE id=?",
        [providerId, id],
      ),
    );
  }
  fail(id: string, error: string, uncertain = false) {
    this.transaction(() =>
      this.db().run(
        "UPDATE ship24_trackers SET error=?,phase=CASE WHEN ? THEN 'uncertain' ELSE phase END,lastAttempt=? WHERE id=?",
        [error, Number(uncertain), Date.now(), id],
      ),
    );
  }
  update(id: string, summary: TrackingSummary) {
    this.transaction(() =>
      this.db().run(
        "UPDATE ship24_trackers SET summary=?,checkedAt=?,lastAttempt=?,error=NULL WHERE id=?",
        [JSON.stringify(summary), new Date().toISOString(), Date.now(), id],
      ),
    );
  }
  publicTrackers(): Ship24Tracker[] {
    const tag = this.settings().connectionTag;
    return this.all().map((r) => ({
      id: r.id,
      trackingNumber: String(r.payload.trackingNumber),
      carrier: String(r.payload.courierName || "Auto-detect"),
      sources: r.sources,
      phase: r.phase,
      checkedAt: r.checkedAt,
      error: r.error,
      summary: r.summary,
      currentConnection: r.connectionTag === tag,
    }));
  }
  effective(source: TrackingSource) {
    return this.all()
      .filter(
        (r) =>
          r.summary &&
          (!source.earliestDate ||
            !r.summary.actualDate ||
            r.summary.actualDate >= source.earliestDate) &&
          r.sources.some((s) => s.signature === source.signature),
      )
      .sort((a, b) => (b.checkedAt || "").localeCompare(a.checkedAt || ""))[0];
  }
}
