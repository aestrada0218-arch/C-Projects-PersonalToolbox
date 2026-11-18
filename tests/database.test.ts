import { describe, it, expect } from "vitest";
import { Store } from "../electron/database";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
describe("SQLite storage", () => {
  it("migrates, seeds once, persists additions, and safely binds SQL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "toolbox-"));
    const file = join(dir, "test.sqlite");
    try {
      let db = await Store.open(file);
      expect(db.snapshot().orders).toHaveLength(36);
      db.addOrder({
        name: "Quote '); DROP TABLE orders; --",
        store: "Test",
        category: "Other",
        total: 12.34,
        status: "Processing",
        date: "2026-11-12",
      });
      db.close();
      db = await Store.open(file);
      expect(db.snapshot().orders).toHaveLength(37);
      expect(db.snapshot().orders.find((o) => o.store === "Test")?.total).toBe(
        12.34,
      );
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects invalid data without mutating orders", async () => {
    const db = await Store.open();
    for (const input of [
      { total: -2 },
      { total: Infinity },
      { date: "2026-02-31" },
      { status: "Running" },
      { name: " " },
      { extra: "secret" },
    ]) {
      expect(() =>
        db.addOrder({
          ...{
            name: "Item",
            store: "Store",
            category: "Other",
            total: 10,
            status: "Delivered" as const,
            date: "2026-11-12",
          },
          ...input,
        }),
      ).toThrow();
    }
    expect(db.snapshot().orders).toHaveLength(36);
    db.close();
  });
});

it("restores memory and disk when persistence fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-failure-"));
  const path = join(dir, "test.sqlite");
  const db = await Store.open(path);
  let notifications = 0;
  db.onChange(() => {
    notifications++;
  });
  try {
    mkdirSync(path + ".tmp");
    expect(() =>
      db.addOrder({
        name: "Will fail",
        store: "Test",
        category: "Other",
        total: 1,
        status: "Processing",
        date: "2026-11-12",
      }),
    ).toThrow();
    expect(db.snapshot().orders).toHaveLength(36);
    expect(notifications).toBe(0);
    const reopened = await Store.open(path);
    expect(reopened.snapshot().orders).toHaveLength(36);
    reopened.close();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("notifies only committed changes across repositories, isolates view errors and unsubscribes", async () => {
  const db = await Store.open();
  let notifications = 0;
  const unsubscribe = db.onChange(() => {
    notifications++;
  });
  db.onChange(() => {
    throw Error("VIEW_FAILURE");
  });
  try {
    db.addOrder({
      name: "Live",
      store: "Shop",
      category: "Other",
      total: 1,
      status: "Processing",
      date: "2026-11-18",
    });
    expect(notifications).toBe(1);
    const row = db.snapshot().orders.find((o) => o.name === "Live")!;
    expect(row).toBeDefined();
    const { id, ...item } = row;
    db.updateOrder({ id, item: { ...item, total: 2 } });
    expect(notifications).toBe(2);
    db.expenses.create(
      {
        description: "Live charge",
        provider: "",
        retailer: "",
        category: "Other Expenses",
        amountCents: 100,
        date: "2026-11-18",
        intervalMonths: 0,
      },
      "2026-11-18",
    );
    expect(notifications).toBe(3);
    expect(() =>
      db.updateOrder({ id, item: { ...item, total: -1 } }),
    ).toThrow();
    expect(notifications).toBe(3);
    unsubscribe();
    db.deleteOrder(id);
    expect(notifications).toBe(3);
  } finally {
    db.close();
  }
});
