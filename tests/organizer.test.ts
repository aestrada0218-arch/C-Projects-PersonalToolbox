import { schemas } from "../electron/organizer/model";
import { it, expect } from "vitest";
import { Store } from "../electron/database";
import { BackupManager } from "../electron/organizer/backups";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import initSqlJs from "sql.js";
const save = (
  db: Store,
  kind: any,
  data: any,
  id: string | null = null,
  revision: number | null = null,
) =>
  db.withSource("Desktop", "toolbox:organizer-save", () =>
    db.organizer.save({
      id,
      revision,
      kind,
      data: Object.fromEntries(
        Object.keys(schemas[kind as keyof typeof schemas].shape).map((key) => [
          key,
          data[key],
        ]),
      ),
    }),
  );
const row = (db: Store, id: string) =>
  db.organizer.records().find((r) => r.id === id)!;
it("records partial quantities across packages, rejects over-receiving and inconsistent parent records", async () => {
  const db = await Store.open();
  try {
    const orderId = db.snapshot().orders[0].id,
      otherOrder = db.snapshot().orders[1].id;
    const line = save(db, "line", {
      orderId,
      description: "Five comics",
      quantity: 5,
      unitCents: 399,
    });
    const pkg = save(db, "package", {
      orderId,
      carrier: "USPS",
      tracking: "94001234567890",
      status: "In transit",
      expectedDate: "2027-01-01",
      actualDate: null,
      notes: "",
    });
    save(db, "receipt", {
      lineId: line,
      packageId: pkg,
      quantity: 2,
      date: db.organizer.state().today,
    });
    expect(() =>
      save(db, "receipt", {
        lineId: line,
        packageId: pkg,
        quantity: 4,
        date: db.organizer.state().today,
      }),
    ).toThrow("exceeds");
    expect(() =>
      save(
        db,
        "line",
        { orderId, description: "Five comics", quantity: 1, unitCents: 399 },
        line,
        1,
      ),
    ).toThrow("less than");
    expect(() =>
      save(
        db,
        "package",
        { ...row(db, pkg).data, orderId: otherOrder },
        pkg,
        1,
      ),
    ).toThrow("cannot be moved");
    save(db, "receipt", {
      lineId: line,
      packageId: null,
      quantity: 3,
      date: db.organizer.state().today,
    });
    expect(
      db.organizer
        .records()
        .filter((r) => r.kind === "receipt")
        .reduce((n, r) => n + r.data.quantity, 0),
    ).toBe(5);
    expect(() => db.organizer.remove({ id: line, revision: 1 })).toThrow(
      "related receiving",
    );
    expect(() =>
      save(
        db,
        "package",
        { ...row(db, pkg).data, status: "Delivered" },
        pkg,
        1,
      ),
    ).toThrow("actual arrival");
  } finally {
    db.close();
  }
});
it("captures sale cost basis, reconciles payouts and prevents duplicates or oversold accounting", async () => {
  const db = await Store.open();
  try {
    const id = db.collection.addManual({
      name: "Absolute test",
      category: "Comic",
      collectionType: "comics",
      quantity: 3,
      purchaseCents: 500,
      valueCents: 900,
      referenceUrl: null,
      imageData: null,
    });
    const data = {
      collectionId: id,
      quantity: 2,
      date: db.organizer.state().today,
      marketplace: "eBay",
      reference: "SALE001",
      grossCents: 3000,
      purchaseShippingCents: 100,
      purchaseTaxCents: 50,
      feesCents: 300,
      postageCents: 200,
      salesTaxCents: 100,
      refundCents: 0,
      payoutCents: 2350,
      notes: "",
    };
    const sale = save(db, "sale", data);
    expect(row(db, sale).data).toMatchObject({
      basisCents: 1150,
      expectedPayoutCents: 2400,
      profitCents: 1250,
      payoutDifferenceCents: -50,
      unitPurchaseCents: 500,
    });
    expect(() => save(db, "sale", { ...data, reference: "SALE002" })).toThrow(
      "exceed",
    );
    expect(() => save(db, "sale", { ...data, quantity: 1 })).toThrow(
      "already has",
    );
    const item = db.collection.items().find((i) => i.id === id)!;
    db.collection.edit({
      id,
      item: {
        name: item.name,
        category: item.category,
        collectionType: item.collectionType,
        quantity: item.quantity,
        purchaseCents: 700,
        valueCents: item.valueCents,
        referenceUrl: item.referenceUrl,
        imageData: item.imageData,
      },
    });
    save(db, "sale", { ...data, payoutCents: 2400 }, sale, 1);
    expect(row(db, sale).data.unitPurchaseCents).toBe(500);
    expect(row(db, sale).data.payoutDifferenceCents).toBe(0);
  } finally {
    db.close();
  }
});
it("combines budgets, wishlists, renewal/deadline reminders and exact duplicate candidates", async () => {
  const db = await Store.open();
  try {
    const today = db.organizer.state().today;
    db.expenses.create(
      {
        description: "Local supplies",
        provider: "",
        retailer: "",
        category: "Other Expenses",
        amountCents: 2000,
        date: today,
        intervalMonths: 1,
      },
      today,
    );
    save(db, "budget", { category: "All expenses", amountCents: 1000 });
    const item = db.collection.items()[0];
    save(db, "wishlist", {
      name: item.name,
      section: item.collectionType,
      category: "",
      maxPriceCents: null,
      referenceUrl: null,
      notes: "",
    });
    save(db, "reminder", {
      title: "Check return",
      date: "2020-01-01",
      completed: false,
      notes: "",
    });
    const state = db.organizer.state();
    expect(state.budgets[0]).toMatchObject({
      spentCents: 2000,
      budgetCents: 1000,
    });
    expect(
      state.duplicates.some((d) => d.source === "Wishlist already owned"),
    ).toBe(true);
    expect(
      state.reminders.find((r) => r.title === "Check return")?.overdue,
    ).toBe(true);
    expect(
      state.reminders.some((r) => r.title.includes("Renewal: Local supplies")),
    ).toBe(true);
    expect(() =>
      save(db, "budget", { category: "All expenses", amountCents: 2000 }),
    ).toThrow("existing category");
  } finally {
    db.close();
  }
});
it("undo restores linked data atomically, records source device, and refuses subsequent conflicts", async () => {
  const db = await Store.open();
  try {
    const order = db.snapshot().orders.find((o) => o.status === "Processing")!;
    db.recordInboxScan({
      events: [],
      scanned: 1,
      skipped: 0,
      limited: false,
      updates: [
        {
          externalId: "history-email",
          subject: "Order confirmed",
          received: new Date().toISOString(),
          status: "Order confirmed",
          orderReference: null,
        },
      ],
    });
    db.applyEmailUpdate({
      updateId: db.emailUpdates()[0].id,
      orderId: order.id,
    });
    db.withSource("iPhone: Adrian", "Companion", () =>
      db.withSource(
        "Desktop",
        "toolbox:delete-order",
        () => db.deleteOrder(order.id),
        true,
      ),
    );
    const entry = db.organizer.state().history[0];
    expect(entry.actor).toBe("iPhone: Adrian");
    expect(entry.undoable).toBe(true);
    db.withSource("Desktop", "toolbox:organizer-undo", () =>
      db.organizer.undo(entry.id),
    );
    expect(db.snapshot().orders.some((o) => o.id === order.id)).toBe(true);
    expect(db.emailUpdates()[0].orderId).toBe(order.id);
    const id = save(db, "reminder", {
      title: "First",
      date: "2027-01-01",
      completed: false,
      notes: "",
    });
    save(db, "reminder", { ...row(db, id).data, title: "Second" }, id, 1);
    const edit = db.organizer.state().history[0];
    db.withSource("Desktop", "toolbox:organizer-undo", () =>
      db.organizer.undo(edit.id),
    );
    expect(row(db, id).data.title).toBe("First");
    expect(row(db, id).revision).toBeGreaterThan(2);
    expect(() =>
      save(db, "reminder", { ...row(db, id).data, title: "Stale" }, id, 1),
    ).toThrow("changed");
    const original = db.organizer
      .state()
      .history.find((h) => h.id === entry.id)!;
    expect(original.undoneAt).not.toBeNull();
  } finally {
    db.close();
  }
});
it("automatic/manual backups validate data, retain safety copies and reject path traversal or corruption", async () => {
  const dir = mkdtempSync(join(tmpdir(), "organizer-backup-")),
    file = join(dir, "live.sqlite");
  let db = await Store.open(file);
  try {
    const manager = new BackupManager(
      join(dir, "backups"),
      file,
      await Store.backupValidator(),
    );
    manager.daily(db.exportBackup());
    manager.daily(db.exportBackup());
    expect(manager.list()).toHaveLength(1);
    const backup = manager.create(db.exportBackup());
    db.addOrder({
      name: "After backup",
      store: "Test",
      category: "Other",
      total: 1,
      status: "Processing",
      date: "2026-11-19",
    });
    db.close();
    manager.queueRestore(backup);
    manager.applyPending();
    db = await Store.open(file);
    expect(db.snapshot().orders.some((o) => o.name === "After backup")).toBe(
      false,
    );
    expect(manager.list().some((b) => b.reason === "restore-safety")).toBe(
      true,
    );
    expect(() => manager.bytes("../live.sqlite")).toThrow();
    expect(() => manager.create(new Uint8Array([1, 2, 3]))).toThrow();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("migrates schema 11 with a backup and rolls back record/history together on a failed save", async () => {
  const dir = mkdtempSync(join(tmpdir(), "organizer-migrate-")),
    file = join(dir, "db.sqlite");
  let db = await Store.open(file);
  try {
    const orderIds = db.snapshot().orders.map((o) => o.id);
    db.close();
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const raw = new SQL.Database(readFileSync(file));
    raw.run(
      "DROP TABLE ship24_trackers; DROP TABLE ship24_settings; DROP TABLE organizer_records; DROP TABLE toolbox_history; DELETE FROM migrations WHERE version>=12;",
    );
    writeFileSync(file, raw.export());
    raw.close();
    db = await Store.open(file);
    expect(db.snapshot().orders.map((o) => o.id)).toEqual(orderIds);
    expect(existsSync(file + ".pre-organizer-v11.bak")).toBe(true);
    mkdirSync(file + ".tmp");
    expect(() =>
      save(db, "reminder", {
        title: "Fail",
        date: "2027-01-01",
        completed: false,
        notes: "",
      }),
    ).toThrow();
    expect(db.organizer.records()).toHaveLength(0);
    expect(db.organizer.state().history).toHaveLength(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("undo cannot orphan receiving records or restore a conflicting budget", async () => {
  const db = await Store.open();
  try {
    const orderId = db.snapshot().orders[0].id;
    const id = save(db, "line", {
      orderId,
      description: "Protected line",
      quantity: 2,
      unitCents: 100,
    });
    const lineCreate = db.organizer.state().history[0];
    save(db, "receipt", {
      lineId: id,
      packageId: null,
      quantity: 1,
      date: db.organizer.state().today,
    });
    expect(() =>
      db.withSource("Desktop", "toolbox:organizer-undo", () =>
        db.organizer.undo(lineCreate.id),
      ),
    ).toThrow("depend");
    expect(row(db, id)).toBeDefined();
    expect(db.organizer.records().some((r) => r.kind === "receipt")).toBe(true);
    const budget = save(db, "budget", {
      category: "All expenses",
      amountCents: 100,
    });
    db.withSource("Desktop", "toolbox:organizer-delete", () =>
      db.organizer.remove({ id: budget, revision: 1 }),
    );
    const deletion = db.organizer.state().history[0];
    save(db, "budget", { category: "All expenses", amountCents: 200 });
    expect(() =>
      db.withSource("Desktop", "toolbox:organizer-undo", () =>
        db.organizer.undo(deletion.id),
      ),
    ).toThrow("matching");
    expect(
      db.organizer.records().filter((r) => r.kind === "budget"),
    ).toHaveLength(1);
  } finally {
    db.close();
  }
});
it("a failed restore request is discarded without changing the current database", async () => {
  const dir = mkdtempSync(join(tmpdir(), "restore-failed-")),
    file = join(dir, "live.sqlite");
  const db = await Store.open(file);
  try {
    const manager = new BackupManager(
      join(dir, "backups"),
      file,
      await Store.backupValidator(),
    );
    const before = readFileSync(file);
    writeFileSync(file + ".restore-request", "../untrusted.sqlite");
    expect(() => manager.applyPending()).toThrow("saved backup");
    expect(readFileSync(file)).toEqual(before);
    expect(existsSync(file + ".restore-request")).toBe(false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
