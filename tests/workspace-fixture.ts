import { randomUUID } from "node:crypto";
import { Store } from "../electron/database";
import {
  WorkspaceGateway,
  type DesktopAction,
} from "../electron/mobile/workspace";
import { localToday } from "../electron/shipping/model";
export async function createWorkspaceFixture(file?: string) {
  const db = await Store.open(file),
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
    }),
    selling = () => ({
      units: db.selling.units(),
      stock: db.selling.stock(),
      settings: db.selling.settings(false),
      busy: false,
      progress: "",
    });
  actions.set("toolbox:ship24-state", () => ({
    connected: false,
    supported: false,
    busy: false,
    autoEnabled: false,
    monthlyCap: 10,
    usedThisMonth: 0,
    month: "2026-11",
    cooldownUntil: 0,
    sources: [],
    trackers: [],
  }));
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
  actions.set("toolbox:edit-expense-schedule", (v) => ({
    ok: true,
    state: db.expenses.updateSchedule(v, localToday()),
  }));
  actions.set("toolbox:stop-expense-schedule", (v) => ({
    ok: true,
    state: db.expenses.stopSchedule(v, localToday()),
  }));
  actions.set("toolbox:delete-expense", (v) => ({
    ok: true,
    state: db.expenses.remove(v, localToday()),
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
  actions.set("toolbox:outstanding-receive", (v) => {
    db.mail.receive(v);
    return { ok: true, state: mailbox() };
  });
  actions.set("toolbox:shipping-state", shipping);
  actions.set("toolbox:shipping-add", (v) => {
    db.shipping.add(v);
    return { ok: true, state: shipping() };
  });
  actions.set("toolbox:shipping-edit", (v) => {
    db.shipping.edit(v);
    return { ok: true, state: shipping() };
  });
  actions.set("toolbox:shipping-delete", (v) => {
    db.shipping.remove(v);
    return { ok: true, state: shipping() };
  });
  actions.set("toolbox:shipping-monitor", (v) => {
    db.shipping.configure(v);
    return { ok: true, state: shipping() };
  });
  actions.set("toolbox:inbox-state", () => ({
    account: null,
    shipments: db.shipments(),
    updates: db.emailUpdates(),
    syncing: false,
    supported: false,
  }));
  actions.set("toolbox:delete-email-update", (id) => {
    db.deleteEmailUpdate(id);
    return {
      ok: true,
      state: {
        account: null,
        shipments: db.shipments(),
        updates: db.emailUpdates(),
        syncing: false,
        supported: false,
      },
    };
  });
  actions.set("toolbox:selling-state", selling);
  actions.set("toolbox:selling-create", (v) => {
    db.selling.create(v);
    return { ok: true, state: selling() };
  });
  actions.set("toolbox:selling-edit", (v) => {
    db.selling.edit(v);
    return { ok: true, state: selling() };
  });
  actions.set("toolbox:selling-delete", (id) => {
    db.selling.remove(id);
    return { ok: true, state: selling() };
  });
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
