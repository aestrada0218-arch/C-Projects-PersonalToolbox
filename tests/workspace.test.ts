import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/database";
import {
  WorkspaceGateway,
  workspaceMethods,
  type DesktopAction,
} from "../electron/mobile/workspace";
import { workspaceGuards } from "../src/workspace-guards";
import { localToday } from "../electron/shipping/model";
async function setup() {
  const db = await Store.open(),
    actions = new Map<string, DesktopAction>();
  const collection = () => ({
      items: db.collection.items(),
      settings: db.collection.settings(false),
      busy: false,
      progress: "",
    }),
    mailbox = () => ({
      accounts: [],
      outstanding: db.mail.lines(),
      busy: false,
      supported: false,
    }),
    shipping = () => ({
      items: db.shipping.items(),
      monitor: db.shipping.monitor(),
      accountEmail: null,
      syncing: false,
      today: localToday(),
    });
  actions.set("toolbox:snapshot", () => db.snapshot());
  actions.set("toolbox:add-order", (v) => db.addOrder(v));
  actions.set("toolbox:update-order", (v) => db.updateOrder(v));
  actions.set("toolbox:delete-order", (id) => db.deleteOrder(id));
  actions.set("toolbox:collection-state", collection);
  actions.set("toolbox:collection-add-manual", (v) => {
    db.collection.addManual(v);
    return { ok: true, state: collection() };
  });
  actions.set("toolbox:collection-edit", (v) => {
    db.collection.edit(v);
    return { ok: true, state: collection() };
  });
  actions.set("toolbox:collection-delete", (id) => {
    db.collection.remove(id);
    return { ok: true, state: collection() };
  });
  actions.set("toolbox:expense-state", () => db.expenses.state(localToday()));
  actions.set("toolbox:add-expense", (v) => ({
    ok: true,
    state: db.expenses.create(v, localToday()),
  }));
  actions.set("toolbox:edit-expense", (v) => ({
    ok: true,
    state: db.expenses.update(v, localToday()),
  }));
  actions.set("toolbox:clear-expenses", () => ({
    ok: true,
    state: db.expenses.clear(localToday()),
  }));
  actions.set("toolbox:mailboxes-state", mailbox);
  actions.set("toolbox:outstanding-date", (v) => {
    db.mail.setExpectedDate(v);
    return { ok: true, state: mailbox() };
  });
  actions.set("toolbox:outstanding-delete", (v) => {
    db.mail.deleteLines(v);
    return { ok: true, state: mailbox() };
  });
  actions.set("toolbox:shipping-state", shipping);
  actions.set("toolbox:shipping-add", (v) => {
    db.shipping.add(v);
    return { ok: true, state: shipping() };
  });
  actions.set("toolbox:selling-state", () => ({
    units: db.selling.units(),
    stock: db.selling.stock(),
    settings: db.selling.settings(false),
    busy: false,
    progress: "",
  }));
  const gateway = new WorkspaceGateway(db, actions);
  return {
    db,
    actions,
    gateway,
    call: (
      method: string,
      args: unknown[] = [],
      guards: Record<string, string> = {},
      id = randomUUID(),
      device = "phone",
    ) => gateway.execute(device, { method, args, guards, requestId: id }),
  };
}
const order = {
  name: "Phone order",
  store: "Store",
  category: "Comics",
  total: 7.98,
  status: "Processing",
  date: "2026-11-17",
};
describe("full mobile workspace", () => {
  it("matches shared concurrency capabilities and denies native/path/unknown commands", async () => {
    const f = await setup();
    try {
      for (const [method, d] of Object.entries(workspaceMethods))
        expect(d.resource).toBe(workspaceGuards[method]);
      for (const method of [
        "readFile",
        "toolbox:collection-image",
        "startCompanion",
        "__proto__",
        "constructor",
      ])
        await expect(
          f.call(method, ["C:\\private.sqlite"]),
        ).rejects.toMatchObject({ status: 404 });
    } finally {
      f.db.close();
    }
  });
  it("creates once across retries and concurrent requests, scopes request IDs per device and rejects key reuse", async () => {
    const f = await setup();
    try {
      const id = randomUUID();
      const [a, b] = await Promise.all([
        f.call("addOrder", [order], {}, id),
        f.call("addOrder", [order], {}, id),
      ]);
      expect(
        a.value.orders.filter((o: any) => o.name === "Phone order"),
      ).toHaveLength(1);
      expect(
        b.value.orders.filter((o: any) => o.name === "Phone order"),
      ).toHaveLength(1);
      await f.call("addOrder", [order], {}, id);
      expect(
        f.db.snapshot().orders.filter((o) => o.name === "Phone order"),
      ).toHaveLength(1);
      await expect(
        f.call("addOrder", [{ ...order, total: 99 }], {}, id),
      ).rejects.toMatchObject({ status: 409 });
      await f.call("addOrder", [order], {}, id, "other-phone");
      expect(
        f.db.snapshot().orders.filter((o) => o.name === "Phone order"),
      ).toHaveLength(2);
    } finally {
      f.db.close();
    }
  });
  it("edits and deletes orders only with the version the phone reviewed", async () => {
    const f = await setup();
    try {
      const first = await f.call("snapshot"),
        item = first.value.orders[0],
        key = "order:" + item.id;
      await expect(
        f.call("updateOrder", [{ id: item.id, item: order }]),
      ).rejects.toMatchObject({ status: 409 });
      await f.call("updateOrder", [{ id: item.id, item: order }], {
        [key]: first.versions[key],
      });
      expect(
        f.db.snapshot().orders.find((o) => o.id === item.id),
      ).toMatchObject(order);
      await expect(
        f.call("deleteOrder", [item.id], { [key]: first.versions[key] }),
      ).rejects.toMatchObject({ status: 409 });
      const current = await f.call("snapshot");
      await f.call("deleteOrder", [item.id], { [key]: current.versions[key] });
      expect(f.db.snapshot().orders.some((o) => o.id === item.id)).toBe(false);
    } finally {
      f.db.close();
    }
  });
  it("supports collection, expenses, tasks and outstanding bulk editing using existing repositories", async () => {
    const f = await setup();
    try {
      await f.call("addManualCollectible", [
        {
          name: "Phone comic",
          category: "Comics",
          collectionType: "comics",
          quantity: 2,
          purchaseCents: 399,
          valueCents: null,
          referenceUrl: null,
          imageData: null,
        },
      ]);
      const c = await f.call("collectionState"),
        item = c.value.items.find((i: any) => i.name === "Phone comic");
      await f.call(
        "editCollectible",
        [
          {
            id: item.id,
            item: {
              name: "Edited phone comic",
              category: "Comics",
              collectionType: "comics",
              quantity: 3,
              purchaseCents: 499,
              valueCents: 899,
              referenceUrl: null,
              imageData: null,
            },
          },
        ],
        { ["collection:" + item.id]: c.versions["collection:" + item.id] },
      );
      expect(
        f.db.collection.items().find((i) => i.id === item.id)?.quantity,
      ).toBe(3);
      await f.call("addExpense", [
        {
          description: "Phone renewal",
          provider: "Provider",
          retailer: "",
          category: "Other Expenses",
          amountCents: 1200,
          date: localToday(),
          intervalMonths: 3,
        },
      ]);
      const expenses = await f.call("expenseState");
      expect(expenses.value.schedules).toHaveLength(1);
      await f.call("addShippingTask", [
        {
          name: "Ship phone item",
          orderReference: null,
          shipBy: null,
          status: "Needs Shipment",
          paymentStatus: "Paid",
          notes: "",
        },
      ]);
      expect(
        f.db.shipping.items().some((t) => t.name === "Ship phone item"),
      ).toBe(true);
      f.db.mail.ingest(
        "fixture",
        [
          {
            transactionId: "WORKSPACETEST001",
            purchaseDate: "2026-11-17",
            lines: [
              {
                description: "Outstanding A",
                unitCents: 399,
                quantity: 1,
                amountCents: 399,
                kind: "item",
              },
              {
                description: "Outstanding B",
                unitCents: 399,
                quantity: 1,
                amountCents: 399,
                kind: "item",
              },
            ],
          },
        ],
        { validity: "1", lastUid: 1 },
        { scanned: 1, skipped: 0, limited: false },
      );
      const m = await f.call("mailboxState"),
        ids = m.value.outstanding.map((l: any) => l.id);
      await f.call(
        "setOutstandingExpectedDate",
        [{ ids, expectedDate: "2027-01-20" }],
        m.versions,
      );
      expect(
        f.db.mail.lines().every((l) => l.expectedDate === "2027-01-20"),
      ).toBe(true);
      await expect(
        f.call(
          "deleteOutstandingLines",
          [{ ids, confirmed: true }],
          m.versions,
        ),
      ).rejects.toMatchObject({ status: 409 });
      const fresh = await f.call("mailboxState");
      await f.call(
        "deleteOutstandingLines",
        [{ ids, confirmed: true }],
        fresh.versions,
      );
      expect(f.db.mail.lines()).toHaveLength(0);
    } finally {
      f.db.close();
    }
  });
  it("keeps CSV previews device-scoped and exports safe text without accepting file paths", async () => {
    const f = await setup();
    try {
      await f.call("addExpense", [
        {
          description: "=danger()",
          provider: "Provider",
          retailer: "",
          category: "Other Expenses",
          amountCents: 100,
          date: localToday(),
          intervalMonths: 0,
        },
      ]);
      const exported = await f.call("exportExpenseText");
      expect(typeof exported.value).toBe("string");
      expect(exported.value).toContain("'=danger()");
      const preview = await f.call("previewExpenseImportText", [
        exported.value,
      ]);
      expect(preview.value.token).toBeTruthy();
      expect(
        (
          await f.call(
            "commitExpenseImport",
            [preview.value.token],
            {},
            randomUUID(),
            "other-phone",
          )
        ).value.ok,
      ).toBe(false);
      expect(
        (await f.call("commitExpenseImport", [preview.value.token])).value.ok,
      ).toBe(true);
      const orders = await f.call("exportOrderText");
      expect(orders.value).toContain("id,name,store");
    } finally {
      f.db.close();
    }
  });
});

it("opens a manual collection reference through a validated, read-only phone capability", async () => {
  const f = await setup();
  try {
    f.db.collection.addManual({
      name: "Linked comic",
      category: "Comics",
      collectionType: "comics",
      quantity: 1,
      purchaseCents: 100,
      valueCents: null,
      referenceUrl: "https://example.org/comic/1",
      imageData: null,
    });
    const id = f.db.collection
      .items()
      .find((i) => i.name === "Linked comic")!.id;
    const result = await f.gateway.execute("phone", {
      method: "collectibleReferenceUrl",
      args: [id],
      requestId: randomUUID(),
      guards: {},
    });
    expect(result.value).toBe("https://example.org/comic/1");
    await expect(
      f.gateway.execute("phone", {
        method: "collectibleReferenceUrl",
        args: ["https://example.org/unsaved"],
        requestId: randomUUID(),
        guards: {},
      }),
    ).rejects.toThrow();
  } finally {
    f.db.close();
  }
});
