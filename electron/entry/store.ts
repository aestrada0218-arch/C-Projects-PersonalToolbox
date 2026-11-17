import type { Database, SqlValue } from "sql.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ProfileCipher } from "./crypto";
import type { ImportedEntry } from "./csv";
import {
  campaignSchema,
  profileSchema,
  hash,
  identity,
  maskEmail,
} from "./model";
import type {
  EntryCampaign,
  EntryJob,
  EntryLog,
  EntryProxy,
  EntryProfile,
  EntryStatus,
} from "../../src/entry-types";
const uuid = z.string().uuid();
export class EntryRepository {
  constructor(
    private db: () => Database,
    private transaction: <T>(fn: () => T) => T,
    private cipher: ProfileCipher,
  ) {}
  available() {
    return this.cipher.available();
  }
  private rows(sql: string, args: SqlValue[] = []): Record<string, any>[] {
    const stmt = this.db().prepare(sql);
    try {
      stmt.bind(args);
      const result = [];
      while (stmt.step()) result.push(stmt.getAsObject());
      return result;
    } finally {
      stmt.free();
    }
  }
  campaigns(): EntryCampaign[] {
    return this.rows(
      "SELECT * FROM entry_campaigns ORDER BY createdAt DESC,id",
    ).map(({ configJson, ...r }) => ({ ...JSON.parse(configJson), ...r }));
  }
  campaign(input: unknown) {
    const id = uuid.parse(input),
      row = this.campaigns().find((c) => c.id === id);
    if (!row) throw Error("ENTRY_MISSING");
    return row;
  }
  createCampaign(input: unknown) {
    const config = campaignSchema.parse(input),
      key = hash(config.url),
      id = randomUUID();
    if (this.campaigns().some((c) => c.productKey === key))
      throw Error("ENTRY_CAMPAIGN_EXISTS");
    this.transaction(() =>
      this.db().run(
        "INSERT INTO entry_campaigns(id,productKey,configJson,createdAt) VALUES(?,?,?,?)",
        [id, key, JSON.stringify(config), new Date().toISOString()],
      ),
    );
    return id;
  }
  editCampaign(input: unknown) {
    const { id, config } = z
        .object({ id: uuid, config: campaignSchema })
        .strict()
        .parse(input),
      old = this.campaign(id);
    if (
      config.url !== old.url ||
      config.onePerHousehold !== old.onePerHousehold
    )
      throw Error("ENTRY_LOCKED");
    this.transaction(() =>
      this.db().run("UPDATE entry_campaigns SET configJson=? WHERE id=?", [
        JSON.stringify(config),
        id,
      ]),
    );
  }
  proxies(): EntryProxy[] {
    return this.rows("SELECT * FROM entry_proxies ORDER BY name").map((p) => ({
      ...p,
      authenticated: Boolean(p.authenticated),
    })) as EntryProxy[];
  }
  proxy(input: unknown) {
    const id = uuid.parse(input),
      p = this.proxies().find((p) => p.id === id);
    if (!p) throw Error("ENTRY_PROXY");
    return p;
  }
  saveProxy(id: string, name: string, server: string, authenticated: boolean) {
    if (this.proxies().some((p) => p.name === name && p.id !== id))
      throw Error("ENTRY_PROXY_NAME");
    const old = this.proxies().find((p) => p.id === id);
    if (
      old &&
      old.server !== server &&
      this.rows(
        "SELECT id FROM entry_jobs WHERE proxyId=? AND attempts>0 LIMIT 1",
        [id],
      ).length
    )
      throw Error("ENTRY_PROXY_FIXED");
    this.transaction(() =>
      this.db().run(
        "INSERT INTO entry_proxies(id,name,server,authenticated) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,server=excluded.server,authenticated=excluded.authenticated,health='Unknown',checkedAt=NULL",
        [id, name, server, Number(authenticated)],
      ),
    );
  }
  proxyHealth(id: string, healthy: boolean) {
    this.transaction(() =>
      this.db().run(
        "UPDATE entry_proxies SET health=?,checkedAt=? WHERE id=?",
        [healthy ? "Reachable" : "Failed", new Date().toISOString(), id],
      ),
    );
  }
  canDeleteProxy(id: string) {
    return !this.rows("SELECT id FROM entry_jobs WHERE proxyId=? LIMIT 1", [id])
      .length;
  }
  removeProxy(input: unknown) {
    const id = this.proxy(input).id;
    if (!this.canDeleteProxy(id)) throw Error("ENTRY_PROXY_USED");
    this.transaction(() =>
      this.db().run("DELETE FROM entry_proxies WHERE id=?", [id]),
    );
  }
  runnerEmail() {
    return this.rows("SELECT runnerEmail FROM entry_settings WHERE id=1")[0]
      .runnerEmail as string | null;
  }
  setRunnerEmail(email: string | null) {
    this.transaction(() =>
      this.db().run("UPDATE entry_settings SET runnerEmail=? WHERE id=1", [
        email,
      ]),
    );
  }
  profile(input: unknown): EntryProfile {
    const id = uuid.parse(input),
      row = this.rows("SELECT profileCipher FROM entry_jobs WHERE id=?", [
        id,
      ])[0];
    if (!row) throw Error("ENTRY_MISSING");
    try {
      return profileSchema.parse(
        JSON.parse(this.cipher.decrypt(row.profileCipher)),
      );
    } catch {
      throw Error("ENTRY_ENCRYPTION");
    }
  }
  jobs(): EntryJob[] {
    return this.rows(
      "SELECT * FROM entry_jobs ORDER BY campaignId,number,id",
    ).map((r) => {
      let profile: EntryProfile | null = null;
      try {
        profile = this.profile(r.id);
      } catch {}
      const {
        profileCipher: _,
        emailKey: _e,
        personKey: _p,
        householdKey: _h,
        ...publicRow
      } = r;
      return {
        ...publicRow,
        label: profile?.label || `Profile ${r.number}`,
        profileName: profile
          ? `${profile.first_name} ${profile.last_name}`
          : "Encrypted profile unavailable",
        maskedEmail: profile ? maskEmail(profile.email) : "Unavailable",
        readable: Boolean(profile),
      } as EntryJob;
    });
  }
  job(input: unknown) {
    const id = uuid.parse(input),
      row = this.jobs().find((j) => j.id === id);
    if (!row) throw Error("ENTRY_MISSING");
    return row;
  }
  private duplicates(
    campaignId: string,
    profile: EntryProfile,
    ignoreId?: string,
  ) {
    const c = this.campaign(campaignId),
      keys = identity(profile);
    return (
      this.rows(
        `SELECT id FROM entry_jobs WHERE campaignId=? AND (emailKey=? OR personKey=?${c.onePerHousehold ? " OR householdKey=?" : ""})${ignoreId ? " AND id<>?" : ""}`,
        [
          campaignId,
          keys.emailKey,
          keys.personKey,
          ...(c.onePerHousehold ? [keys.householdKey] : []),
          ...(ignoreId ? [ignoreId] : []),
        ],
      ).length > 0
    );
  }
  importSummary(campaignId: string, entries: ImportedEntry[]) {
    const campaign = this.campaign(campaignId),
      emails = new Set<string>(),
      people = new Set<string>(),
      houses = new Set<string>();
    let duplicates = 0;
    for (const row of entries) {
      const keys = identity(row.profile);
      if (
        this.duplicates(campaignId, row.profile) ||
        emails.has(keys.emailKey) ||
        people.has(keys.personKey) ||
        (campaign.onePerHousehold && houses.has(keys.householdKey))
      )
        duplicates++;
      else {
        emails.add(keys.emailKey);
        people.add(keys.personKey);
        houses.add(keys.householdKey);
      }
    }
    return { total: entries.length, duplicates };
  }
  import(campaignId: string, entries: ImportedEntry[]) {
    if (!this.available()) throw Error("ENTRY_ENCRYPTION");
    this.campaign(campaignId);
    return this.transaction(() => {
      let count = 0;
      let number = Number(
        this.rows(
          "SELECT MAX(number) AS number FROM entry_jobs WHERE campaignId=?",
          [campaignId],
        )[0].number || 0,
      );
      for (const entry of entries) {
        const profile = profileSchema.parse(entry.profile);
        if (this.duplicates(campaignId, profile)) continue;
        if (entry.proxyId) this.proxy(entry.proxyId);
        const keys = identity(profile),
          cipher = this.cipher.encrypt(JSON.stringify(profile));
        this.db().run(
          "INSERT INTO entry_jobs(id,campaignId,number,profileCipher,emailKey,personKey,householdKey,proxyId,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)",
          [
            randomUUID(),
            campaignId,
            ++number,
            cipher,
            keys.emailKey,
            keys.personKey,
            keys.householdKey,
            entry.proxyId,
            new Date().toISOString(),
          ],
        );
        count++;
      }
      return count;
    });
  }
  editProfile(input: unknown) {
    const { id, profile, proxyId } = z
        .object({ id: uuid, profile: profileSchema, proxyId: uuid.nullable() })
        .strict()
        .parse(input),
      job = this.job(id);
    if (job.attempts || job.status !== "Pending") throw Error("ENTRY_LOCKED");
    if (proxyId) this.proxy(proxyId);
    if (this.duplicates(job.campaignId, profile, id))
      throw Error("ENTRY_DUPLICATE");
    const keys = identity(profile),
      cipher = this.cipher.encrypt(JSON.stringify(profile));
    this.transaction(() =>
      this.db().run(
        "UPDATE entry_jobs SET profileCipher=?,emailKey=?,personKey=?,householdKey=?,proxyId=?,updatedAt=? WHERE id=?",
        [
          cipher,
          keys.emailKey,
          keys.personKey,
          keys.householdKey,
          proxyId,
          new Date().toISOString(),
          id,
        ],
      ),
    );
  }
  removeJob(input: unknown) {
    const job = this.job(input);
    if (job.attempts || job.status !== "Pending") throw Error("ENTRY_LOCKED");
    this.transaction(() =>
      this.db().run("DELETE FROM entry_jobs WHERE id=?", [job.id]),
    );
  }
  status(id: string, status: EntryStatus, stage: string, note = "") {
    this.transaction(() =>
      this.db().run(
        "UPDATE entry_jobs SET status=?,stage=?,note=?,updatedAt=? WHERE id=?",
        [status, stage, note, new Date().toISOString(), id],
      ),
    );
  }
  begin(id: string) {
    const job = this.job(id);
    if (job.status !== "Pending") throw Error("ENTRY_LOCKED");
    this.transaction(() => {
      this.db().run(
        "UPDATE entry_jobs SET attempts=attempts+1,status='Running',stage='Opening browser',note='',updatedAt=? WHERE id=?",
        [new Date().toISOString(), id],
      );
      this.logInTransaction(
        job.campaignId,
        id,
        "Run started with the saved network configuration.",
      );
    });
  }
  intent(id: string) {
    const job = this.job(id);
    if (job.submissionStartedAt) throw Error("ENTRY_SUBMITTED");
    this.transaction(() =>
      this.db().run(
        "UPDATE entry_jobs SET submissionStartedAt=?,stage='Submitting',updatedAt=? WHERE id=?",
        [new Date().toISOString(), new Date().toISOString(), id],
      ),
    );
  }
  complete(id: string, confirmation: string) {
    const job = this.job(id);
    if (!["entry-confirmed", "existing-entry"].includes(confirmation))
      throw Error("ENTRY_CONFIRMATION");
    this.transaction(() => {
      this.db().run(
        "UPDATE entry_jobs SET status='Completed',stage='Confirmed by site',note='',completedAt=?,confirmation=?,updatedAt=? WHERE id=?",
        [new Date().toISOString(), confirmation, new Date().toISOString(), id],
      );
      this.logInTransaction(
        job.campaignId,
        id,
        "Site entry confirmation detected.",
      );
    });
  }
  retry(input: unknown) {
    const { id, reviewed } = z
        .object({ id: uuid, reviewed: z.literal(true) })
        .strict()
        .parse(input),
      job = this.job(id);
    if (
      !reviewed ||
      job.submissionStartedAt ||
      !["Failed", "Skipped", "Needs review"].includes(job.status)
    )
      throw Error("ENTRY_SUBMITTED");
    this.status(
      id,
      "Pending",
      "Queued",
      "Previous attempt reviewed; retry uses the original profile and proxy.",
    );
  }
  claimCode(messageKey: string, jobId: string) {
    const old = this.rows(
      "SELECT jobId FROM entry_code_receipts WHERE messageKey=?",
      [messageKey],
    )[0];
    if (old) return old.jobId === jobId;
    this.transaction(() =>
      this.db().run("INSERT INTO entry_code_receipts VALUES(?,?)", [
        messageKey,
        jobId,
      ]),
    );
    return true;
  }
  cooldown(campaignId: string, until: number) {
    this.transaction(() =>
      this.db().run(
        "UPDATE entry_campaigns SET cooldownUntil=MAX(cooldownUntil,?) WHERE id=?",
        [until, campaignId],
      ),
    );
  }
  recover() {
    const interrupted = this.jobs().filter((j) =>
      ["Running", "Waiting", "Ready"].includes(j.status),
    );
    if (!interrupted.length) return;
    this.transaction(() => {
      for (const j of interrupted) {
        this.db().run(
          "UPDATE entry_jobs SET status='Needs review',stage='Interrupted',note='The app closed during this attempt. Check the site before retrying.',updatedAt=? WHERE id=?",
          [new Date().toISOString(), j.id],
        );
        this.logInTransaction(
          j.campaignId,
          j.id,
          "Interrupted attempt retained for review; it was not resubmitted.",
        );
      }
    });
  }
  private logInTransaction(
    campaignId: string,
    jobId: string | null,
    message: string,
  ) {
    this.db().run(
      "INSERT INTO entry_logs(campaignId,jobId,at,message) VALUES(?,?,?,?)",
      [campaignId, jobId, new Date().toISOString(), message],
    );
    this.db().run(
      "DELETE FROM entry_logs WHERE campaignId=? AND id NOT IN(SELECT id FROM entry_logs WHERE campaignId=? ORDER BY id DESC LIMIT 500)",
      [campaignId, campaignId],
    );
  }
  log(campaignId: string, jobId: string | null, message: string) {
    this.transaction(() => this.logInTransaction(campaignId, jobId, message));
  }
  logs(): EntryLog[] {
    return this.rows(
      "SELECT * FROM(SELECT * FROM entry_logs ORDER BY id DESC LIMIT 200) ORDER BY id",
    ) as EntryLog[];
  }
}
