import { describe, it, expect } from "vitest";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleParser } from "mailparser";
import { Store } from "../electron/database";
import {
  allowedEntryUrl,
  campaignSchema,
  proxySchema,
} from "../electron/entry/model";
import { parseEntryCsv } from "../electron/entry/csv";
import { codeFromMail } from "../electron/entry/codes";
import { WindowsProfileCipher } from "../electron/entry/crypto";
const key = randomBytes(32);
const cipher = {
  available: () => true,
  encrypt(text: string) {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", key, iv);
    return Buffer.concat([iv, c.update(text), c.final(), c.getAuthTag()]);
  },
  decrypt(bytes: Uint8Array) {
    const b = Buffer.from(bytes),
      d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(-16));
    return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString();
  },
};
const config = {
  name: "Holiday queue",
  url: "https://shop.thirdeyecomics.com/products/test?campaign=1",
  concurrency: 2,
  browser: "msedge",
  gmailSource: "off",
  senderDomains: ["eql.com"],
  onePerHousehold: false,
};
const csv =
  "email,first_name,last_name,address,city,state,zip\nfamily@example.com,Alex,Smith,123 Secret Street,Austin,TX,78701\n";
describe("Entry runner persistence and security", () => {
  it("restricts product navigation and validates proxy credentials separately", () => {
    expect(campaignSchema.parse(config).url).toBe(
      "https://shop.thirdeyecomics.com/products/test",
    );
    for (const url of [
      "http://shop.thirdeyecomics.com/products/test",
      "https://shop.thirdeyecomics.com.evil.test/products/test",
      "https://user:pass@shop.thirdeyecomics.com/products/test",
    ])
      expect(campaignSchema.safeParse({ ...config, url }).success).toBe(false);
    expect(allowedEntryUrl("https://launch.eql.com/draw")).toBe(true);
    expect(allowedEntryUrl("https://eql.com.evil.test")).toBe(false);
    for (const server of [
      "http://proxy.example:80",
      "https://proxy.example:443",
      "socks5://proxy.example:1080",
    ])
      expect(
        proxySchema.safeParse({
          name: "Home",
          server,
          username: "",
          password: "",
        }).success,
      ).toBe(true);
    expect(
      proxySchema.safeParse({
        name: "Bad",
        server: "http://u:p@proxy.example:80",
        username: "",
        password: "",
      }).success,
    ).toBe(false);
  });
  it("fails closed without Windows encryption and does not fall back to plaintext", async () => {
    const db = await Store.open();
    try {
      const id = db.entries.createCampaign(config);
      expect(() => db.entries.import(id, parseEntryCsv(csv))).toThrow(
        "ENTRY_ENCRYPTION",
      );
      expect(db.entries.jobs()).toHaveLength(0);
      expect(
        new WindowsProfileCipher(
          {
            isEncryptionAvailable: () => true,
            encryptString: () => Buffer.from(""),
            decryptString: () => "",
          },
          "linux",
        ).available(),
      ).toBe(false);
    } finally {
      db.close();
    }
  });
  it("encrypts profiles on disk, deduplicates identities and preserves interrupted submission history", async () => {
    const dir = mkdtempSync(join(tmpdir(), "entry-")),
      file = join(dir, "db.sqlite");
    let db = await Store.open(file, { entryCipher: cipher });
    try {
      const id = db.entries.createCampaign(config);
      const rows = parseEntryCsv(csv);
      expect(db.entries.import(id, rows)).toBe(1);
      expect(db.entries.import(id, rows)).toBe(0);
      const job = db.entries.jobs()[0];
      expect(job.maskedEmail).not.toContain("family@");
      expect(db.entries.profile(job.id).address).toBe("123 Secret Street");
      db.entries.begin(job.id);
      db.entries.intent(job.id);
      expect(() => db.entries.intent(job.id)).toThrow("ENTRY_SUBMITTED");
      db.close();
      expect(
        readFileSync(file).includes(Buffer.from("123 Secret Street")),
      ).toBe(false);
      expect(
        readFileSync(file).includes(Buffer.from("family@example.com")),
      ).toBe(false);
      db = await Store.open(file, { entryCipher: cipher });
      db.entries.recover();
      expect(db.entries.job(job.id).status).toBe("Needs review");
      expect(() => db.entries.retry({ id: job.id, reviewed: true })).toThrow(
        "ENTRY_SUBMITTED",
      );
      expect(() => db.entries.complete(job.id, "clicked")).toThrow(
        "ENTRY_CONFIRMATION",
      );
      db.entries.complete(job.id, "entry-confirmed");
      expect(db.entries.job(job.id).status).toBe("Completed");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rolls back partial imports and prevents sharing the same mailbox message across jobs", async () => {
    const db = await Store.open(undefined, { entryCipher: cipher });
    try {
      const id = db.entries.createCampaign(config),
        rows = parseEntryCsv(csv);
      expect(() =>
        db.entries.import(id, [
          ...rows,
          {
            ...rows[0],
            profile: {
              ...rows[0].profile,
              email: "other@example.com",
              first_name: "Other",
            },
            proxyId: "00000000-0000-4000-8000-000000000000",
          },
        ]),
      ).toThrow();
      expect(db.entries.jobs()).toHaveLength(0);
      db.entries.import(id, [
        ...rows,
        {
          ...rows[0],
          profile: {
            ...rows[0].profile,
            email: "other@example.com",
            first_name: "Other",
          },
        },
      ]);
      const [a, b] = db.entries.jobs();
      expect(db.entries.claimCode("message-hash", a.id)).toBe(true);
      expect(db.entries.claimCode("message-hash", a.id)).toBe(true);
      expect(db.entries.claimCode("message-hash", b.id)).toBe(false);
    } finally {
      db.close();
    }
  });
  it("honors optional household limits and rejects malformed CSV without echoing private values", async () => {
    const db = await Store.open(undefined, { entryCipher: cipher });
    try {
      const id = db.entries.createCampaign({
          ...config,
          onePerHousehold: true,
        }),
        rows = parseEntryCsv(csv);
      expect(
        db.entries.import(id, [
          ...rows,
          {
            ...rows[0],
            profile: {
              ...rows[0].profile,
              email: "other@example.com",
              first_name: "Other",
            },
          },
        ]),
      ).toBe(1);
      expect(() =>
        parseEntryCsv(csv.replace("78701", "private-invalid-zip")),
      ).toThrow("check zip");
    } finally {
      db.close();
    }
  });
});
describe("Fresh verification codes", () => {
  const since = Date.parse("2026-11-17T15:00:00Z");
  const message = async (
    body = "Your verification code is 123456",
    to = "family@example.com",
    from = "auth@eql.com",
  ) =>
    simpleParser(
      `From: ${from}\r\nTo: ${to}\r\nDate: Tue, 17 Nov 2026 15:00:00 GMT\r\nSubject: Sign in verification\r\n\r\n${body}`,
    );
  it("matches recipient, trusted domain and request freshness", async () => {
    const mail = await message();
    expect(
      codeFromMail(mail, "family@example.com", since, since, ["eql.com"]),
    ).toBe("123456");
    expect(
      codeFromMail(mail, "other@example.com", since, since, ["eql.com"]),
    ).toBeNull();
    expect(
      codeFromMail(mail, "family@example.com", since, since - 60000, [
        "eql.com",
      ]),
    ).toBeNull();
    expect(
      codeFromMail(
        await message(undefined, undefined, "auth@eql.com.evil.test"),
        "family@example.com",
        since,
        since,
        ["eql.com"],
      ),
    ).toBeNull();
  });
  it("rejects recovery codes, ambiguous codes and arbitrary order numbers", async () => {
    for (const body of [
      "Password reset verification code is 123456",
      "Your verification code is 123456. Another code is 654321.",
      "Your order number is 123456",
    ])
      expect(
        codeFromMail(await message(body), "family@example.com", since, since, [
          "eql.com",
        ]),
      ).toBeNull();
  });
});

import { EntryService } from "../electron/entry/service";
import type {
  EntryDriver,
  EntryControl,
  ProxySecret,
} from "../electron/entry/driver";
import type { CredentialVault } from "../electron/inbox/credentials";
const memoryVault = <T>(value: T | null = null): CredentialVault<T> => ({
  read: async () => value,
  write: async (v) => {
    value = v;
  },
  remove: async () => {
    value = null;
  },
});
async function until(check: () => boolean) {
  for (let n = 0; n < 200; n++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Fixture timed out");
}
describe("Entry orchestration", () => {
  it("requires individual final review, passes fixed proxy and keeps credentials out of state/logs", async () => {
    const db = await Store.open(undefined, { entryCipher: cipher }),
      vaults = new Map<string, CredentialVault<ProxySecret>>();
    let calls = 0;
    const proxyVault = (id: string) => {
      if (!vaults.has(id)) vaults.set(id, memoryVault<ProxySecret>());
      return vaults.get(id)!;
    };
    const driver: EntryDriver = {
      run: async (_c, p, proxy, control) => {
        calls++;
        expect(p.email).toBe("family@example.com");
        expect(proxy?.password).toBe("secret-proxy");
        const answer = await control.wait("review", "Review exact entry");
        expect(answer.action).toBe("submit");
        control.intent();
        return { kind: "confirmed", rule: "entry-confirmed" };
      },
      stop: () => {},
      testProxy: async () => true,
    };
    const svc = new EntryService(
      db,
      driver,
      { test: async () => {}, find: async () => null, cancel: () => {} },
      memoryVault(),
      memoryVault(),
      proxyVault,
      true,
    );
    try {
      const saved = await svc.saveProxy({
        name: "Fixed family",
        server: "http://proxy.example:8080",
        username: "user",
        password: "secret-proxy",
      });
      expect(saved.ok).toBe(true);
      const proxy = saved.state.proxies[0],
        id = db.entries.createCampaign(config);
      db.entries.import(
        id,
        parseEntryCsv(csv).map((r) => ({ ...r, proxyId: proxy.id })),
      );
      expect((await svc.start({ campaignId: id, confirmed: true })).ok).toBe(
        true,
      );
      await until(() => svc.state().prompts.length === 1);
      const prompt = svc.state().prompts[0];
      expect(svc.answer({ promptId: prompt.id, action: "submit" }).ok).toBe(
        false,
      );
      expect(db.entries.jobs()[0].submissionStartedAt).toBeNull();
      expect(
        svc.answer({ promptId: prompt.id, action: "submit", confirmed: true })
          .ok,
      ).toBe(true);
      await until(() => !svc.state().running);
      expect(db.entries.jobs()[0].status).toBe("Completed");
      expect(calls).toBe(1);
      expect(JSON.stringify(svc.state())).not.toContain("secret-proxy");
      expect((await svc.start({ campaignId: id, confirmed: true })).ok).toBe(
        false,
      );
    } finally {
      await svc.stop();
      svc.shutdown();
      db.close();
    }
  });
  it("stops all concurrent lanes and retains rate limit cooldown without changing proxies", async () => {
    const db = await Store.open(undefined, { entryCipher: cipher });
    let active = 0,
      max = 0;
    const driver: EntryDriver = {
      run: async (_c, _p, _proxy, control) => {
        active++;
        max = Math.max(max, active);
        try {
          await control.wait("manual", "Fixture waiting");
          return { kind: "skipped" };
        } finally {
          active--;
        }
      },
      stop: () => {},
      testProxy: async () => false,
    };
    const svc = new EntryService(
      db,
      driver,
      { test: async () => {}, find: async () => null, cancel: () => {} },
      memoryVault(),
      memoryVault(),
      () => memoryVault(),
      true,
    );
    try {
      const id = db.entries.createCampaign({ ...config, concurrency: 2 }),
        row = parseEntryCsv(csv)[0];
      db.entries.import(id, [
        row,
        {
          ...row,
          profile: {
            ...row.profile,
            email: "second@example.com",
            first_name: "Second",
          },
        },
        {
          ...row,
          profile: {
            ...row.profile,
            email: "third@example.com",
            first_name: "Third",
          },
        },
      ]);
      await svc.start({ campaignId: id, confirmed: true });
      await until(() => svc.state().prompts.length === 2);
      expect(max).toBe(2);
      expect(svc.pause().state.paused).toBe(true);
      db.entries.cooldown(id, Date.now() + 60000);
      expect(svc.resume().ok).toBe(false);
      await svc.stop();
      expect(active).toBe(0);
      expect(svc.state().prompts).toHaveLength(0);
      expect(svc.state().running).toBe(false);
      expect(
        db.entries.jobs().filter((j) => j.status === "Pending"),
      ).toHaveLength(1);
      expect(
        db.entries.jobs().filter((j) => j.status === "Needs review"),
      ).toHaveLength(2);
    } finally {
      await svc.stop();
      svc.shutdown();
      db.close();
    }
  });
});
