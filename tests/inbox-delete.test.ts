import { it, expect } from "vitest";
import { Store } from "../electron/database";
import {
  WorkspaceGateway,
  type DesktopAction,
} from "../electron/mobile/workspace";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import initSqlJs from "sql.js";
const scan = {
  events: [],
  scanned: 1,
  skipped: 0,
  limited: false,
  updates: [
    {
      externalId: "unique-email-1",
      subject: "Order confirmed",
      received: "2026-11-19T12:00:00Z",
      status: "Order confirmed" as const,
      orderReference: "123",
    },
  ],
};
it("deletes only the review update, preserves linked orders, and suppresses re-import after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-delete-")),
    file = join(dir, "db.sqlite");
  let db = await Store.open(file);
  try {
    db.recordInboxScan(scan);
    const update = db.emailUpdates()[0],
      order = db.snapshot().orders.find((o) => o.status === "Processing")!;
    db.applyEmailUpdate({ updateId: update.id, orderId: order.id });
    const before = db.snapshot().orders;
    db.deleteEmailUpdate(update.id);
    expect(db.emailUpdates()).toHaveLength(0);
    expect(db.snapshot().orders).toEqual(before);
    db.recordInboxScan(scan);
    expect(db.emailUpdates()).toHaveLength(0);
    db.close();
    db = await Store.open(file);
    db.recordInboxScan(scan);
    expect(db.emailUpdates()).toHaveLength(0);
    expect(db.snapshot().orders).toEqual(before);
    expect(() => db.deleteEmailUpdate("not-an-id")).toThrow();
    expect(() => db.deleteEmailUpdate(randomUUID())).toThrow();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rolls back deletion markers and visible rows together when persistence fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-delete-failure-")),
    file = join(dir, "db.sqlite");
  const db = await Store.open(file);
  try {
    db.recordInboxScan(scan);
    const id = db.emailUpdates()[0].id;
    mkdirSync(file + ".tmp");
    expect(() => db.deleteEmailUpdate(id)).toThrow();
    expect(db.emailUpdates()[0].id).toBe(id);
    rmSync(file + ".tmp", { recursive: true });
    db.recordInboxScan(scan);
    expect(db.emailUpdates()).toHaveLength(1);
    db.deleteEmailUpdate(id);
    expect(db.emailUpdates()).toHaveLength(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("upgrades schema 10 with a backup and preserves existing inbox rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-delete-migration-")),
    file = join(dir, "db.sqlite");
  try {
    const old = await Store.open(file);
    old.recordInboxScan(scan);
    const id = old.emailUpdates()[0].id;
    old.close();
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const raw = new SQL.Database(readFileSync(file));
    raw.run(
      "DROP TABLE organizer_records; DROP TABLE toolbox_history; DROP TABLE inbox_update_dismissals; DELETE FROM migrations WHERE version>=11;",
    );
    writeFileSync(file, raw.export());
    raw.close();
    const db = await Store.open(file);
    try {
      expect(db.emailUpdates()[0].id).toBe(id);
      expect(existsSync(file + ".pre-inbox-deletion-v10.bak")).toBe(true);
      db.deleteEmailUpdate(id);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("phone deletion guards against newer desktop changes and deduplicates retries", async () => {
  const db = await Store.open();
  try {
    db.recordInboxScan(scan);
    const actions = new Map<string, DesktopAction>();
    const state = () => ({
      updates: db.emailUpdates(),
      shipments: [],
      syncing: false,
      supported: false,
      account: null,
    });
    actions.set("toolbox:inbox-state", state);
    actions.set("toolbox:delete-email-update", (id) => {
      db.deleteEmailUpdate(id);
      return { ok: true, state: state() };
    });
    const g = new WorkspaceGateway(db, actions),
      id = db.emailUpdates()[0].id;
    const initial = await g.execute("phone", {
      method: "inboxState",
      args: [],
      requestId: randomUUID(),
      guards: {},
    });
    db.applyEmailUpdate({
      updateId: id,
      orderId: db.snapshot().orders.find((o) => o.status === "Processing")!.id,
    });
    await expect(
      g.execute("phone", {
        method: "deleteEmailUpdate",
        args: [id],
        requestId: randomUUID(),
        guards: initial.versions,
      }),
    ).rejects.toThrow("changed on your PC");
    const fresh = await g.execute("phone", {
      method: "inboxState",
      args: [],
      requestId: randomUUID(),
      guards: {},
    });
    const request = {
      method: "deleteEmailUpdate",
      args: [id],
      requestId: randomUUID(),
      guards: fresh.versions,
    };
    expect((await g.execute("phone", request)).value.ok).toBe(true);
    expect((await g.execute("phone", request)).value.ok).toBe(true);
    expect(db.emailUpdates()).toHaveLength(0);
  } finally {
    db.close();
  }
});
