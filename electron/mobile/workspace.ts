import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "../database";
import { localToday } from "../shipping/model";
import {
  parseExpenseCsv,
  exportExpenseCsv,
  type ParsedExpenseCsv,
} from "../expenses/csv";
import {
  allowedTcgNavigation,
  collectibleReference,
} from "../collection/model";
import { listingUrl } from "../selling/model";
export type DesktopAction = (...args: any[]) => unknown;
type Descriptor = {
  channel: string;
  state?: string;
  read?: boolean;
  resource?: string;
  bulk?: boolean;
};
// This is a fixed capability list, not a general Electron IPC bridge.
export const workspaceMethods: Record<string, Descriptor> = {
  snapshot: { channel: "toolbox:snapshot", read: true, state: "snapshot" },
  addOrder: { channel: "toolbox:add-order", state: "snapshot" },
  updateOrder: {
    channel: "toolbox:update-order",
    state: "snapshot",
    resource: "order",
  },
  deleteOrder: {
    channel: "toolbox:delete-order",
    state: "snapshot",
    resource: "order",
  },
  collectionState: {
    channel: "toolbox:collection-state",
    read: true,
    state: "collectionState",
  },
  connectPricing: {
    channel: "toolbox:collection-connect",
    state: "collectionState",
  },
  disconnectPricing: {
    channel: "toolbox:collection-disconnect",
    state: "collectionState",
  },
  searchCatalog: { channel: "toolbox:collection-search", read: true },
  addCatalogItem: {
    channel: "toolbox:collection-add-linked",
    state: "collectionState",
  },
  addManualCollectible: {
    channel: "toolbox:collection-add-manual",
    state: "collectionState",
  },
  editCollectible: {
    channel: "toolbox:collection-edit",
    state: "collectionState",
    resource: "collection",
  },
  deleteCollectible: {
    channel: "toolbox:collection-delete",
    state: "collectionState",
    resource: "collection",
  },
  refreshCollection: {
    channel: "toolbox:collection-refresh",
    state: "collectionState",
  },
  collectionHistory: { channel: "toolbox:collection-history", read: true },
  expenseState: {
    channel: "toolbox:expense-state",
    read: true,
    state: "expenseState",
  },
  addExpense: { channel: "toolbox:add-expense", state: "expenseState" },
  editExpense: {
    channel: "toolbox:edit-expense",
    state: "expenseState",
    resource: "expense",
  },
  editExpenseSchedule: {
    channel: "toolbox:edit-expense-schedule",
    state: "expenseState",
    resource: "schedule",
  },
  stopExpenseSchedule: {
    channel: "toolbox:stop-expense-schedule",
    state: "expenseState",
    resource: "schedule",
  },
  deleteExpense: {
    channel: "toolbox:delete-expense",
    state: "expenseState",
    resource: "expense",
  },
  deleteAllExpenses: {
    channel: "toolbox:clear-expenses",
    state: "expenseState",
    resource: "expense-set",
  },
  shippingState: {
    channel: "toolbox:shipping-state",
    read: true,
    state: "shippingState",
  },
  checkSales: { channel: "toolbox:shipping-check", state: "shippingState" },
  setShippingMonitor: {
    channel: "toolbox:shipping-monitor",
    state: "shippingState",
  },
  addShippingTask: { channel: "toolbox:shipping-add", state: "shippingState" },
  editShippingTask: {
    channel: "toolbox:shipping-edit",
    state: "shippingState",
    resource: "task",
  },
  deleteShippingTask: {
    channel: "toolbox:shipping-delete",
    state: "shippingState",
    resource: "task",
  },
  mailboxState: {
    channel: "toolbox:mailboxes-state",
    read: true,
    state: "mailboxState",
  },
  connectMailbox: {
    channel: "toolbox:mailboxes-connect",
    state: "mailboxState",
  },
  disconnectMailbox: {
    channel: "toolbox:mailboxes-disconnect",
    state: "mailboxState",
  },
  setMailboxEnabled: {
    channel: "toolbox:mailboxes-enabled",
    state: "mailboxState",
  },
  setOutstandingExpectedDate: {
    channel: "toolbox:outstanding-date",
    state: "mailboxState",
    resource: "outstanding",
    bulk: true,
  },
  deleteOutstandingLines: {
    channel: "toolbox:outstanding-delete",
    state: "mailboxState",
    resource: "outstanding",
    bulk: true,
  },
  scanOutstanding: {
    channel: "toolbox:outstanding-scan",
    state: "mailboxState",
  },
  scanMailboxes: { channel: "toolbox:mailboxes-scan", state: "mailboxState" },
  receiveOutstanding: {
    channel: "toolbox:outstanding-receive",
    state: "mailboxState",
  },
  inboxState: {
    channel: "toolbox:inbox-state",
    read: true,
    state: "inboxState",
  },
  connectGmail: { channel: "toolbox:connect-gmail", state: "inboxState" },
  disconnectGmail: { channel: "toolbox:disconnect-gmail", state: "inboxState" },
  refreshInbox: { channel: "toolbox:refresh-inbox", state: "inboxState" },
  setInboxAuto: { channel: "toolbox:inbox-auto", state: "inboxState" },
  deleteEmailUpdate: {
    channel: "toolbox:delete-email-update",
    state: "inboxState",
    resource: "email-update",
  },
  linkEmailUpdate: {
    channel: "toolbox:link-email-update",
    state: "inboxState",
  },
  linkShipment: { channel: "toolbox:link-shipment", state: "inboxState" },
  sellingState: {
    channel: "toolbox:selling-state",
    read: true,
    state: "sellingState",
  },
  sellingCategory: {
    channel: "toolbox:selling-category",
    read: true,
    state: "sellingState",
  },
  connectEbay: { channel: "toolbox:selling-connect", state: "sellingState" },
  disconnectEbay: {
    channel: "toolbox:selling-disconnect",
    state: "sellingState",
  },
  createSellingDraft: {
    channel: "toolbox:selling-create",
    state: "sellingState",
  },
  editSellingDraft: {
    channel: "toolbox:selling-edit",
    state: "sellingState",
    resource: "selling",
  },
  deleteSellingDraft: {
    channel: "toolbox:selling-delete",
    state: "sellingState",
    resource: "selling",
  },
  refreshSellingOptions: {
    channel: "toolbox:selling-options",
    state: "sellingState",
  },
  createSellingLocation: {
    channel: "toolbox:selling-location",
    state: "sellingState",
  },
  prepareEbayOffer: {
    channel: "toolbox:selling-prepare",
    state: "sellingState",
    resource: "selling",
  },
  publishEbayOffer: {
    channel: "toolbox:selling-publish",
    state: "sellingState",
  },
  reconcileEbayOffer: {
    channel: "toolbox:selling-reconcile",
    state: "sellingState",
  },
  endEbayOffer: {
    channel: "toolbox:selling-end",
    state: "sellingState",
    resource: "selling",
  },
  linkMercariListing: {
    channel: "toolbox:selling-link-mercari",
    state: "sellingState",
    resource: "selling",
  },
  confirmMercariInactive: {
    channel: "toolbox:selling-inactive-mercari",
    state: "sellingState",
    resource: "selling",
  },
  recordMercariSale: {
    channel: "toolbox:selling-sale-mercari",
    state: "sellingState",
    resource: "selling",
  },
  reviewSellingConflict: {
    channel: "toolbox:selling-conflict",
    state: "sellingState",
    resource: "selling",
  },
  setSellingAuto: { channel: "toolbox:selling-auto", state: "sellingState" },
  syncSelling: { channel: "toolbox:selling-sync", state: "sellingState" },
  uploadSellingPhotoData: {
    channel: "toolbox:mobile-selling-photo",
    state: "sellingState",
    resource: "selling",
  },
};
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const stateChannels: Record<string, string> = {
  snapshot: "toolbox:snapshot",
  collectionState: "toolbox:collection-state",
  expenseState: "toolbox:expense-state",
  shippingState: "toolbox:shipping-state",
  mailboxState: "toolbox:mailboxes-state",
  inboxState: "toolbox:inbox-state",
  sellingState: "toolbox:selling-state",
};
export class WorkspaceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class WorkspaceGateway {
  private completed = new Map<
    string,
    {
      hash: string;
      expires: number;
      value: any;
      state?: string;
      rawSnapshot: boolean;
    }
  >();
  private inFlight = new Map<string, { hash: string; promise: Promise<any> }>();
  private previews = new Map<
    string,
    { token: string; parsed: ParsedExpenseCsv; expires: number }
  >();
  constructor(
    private store: Store,
    private actions: ReadonlyMap<string, DesktopAction>,
  ) {}
  private async state(kind: string) {
    const fn = this.actions.get(stateChannels[kind]);
    if (!fn) throw Error("ACTION_MISSING");
    return fn();
  }
  private versions(kind: string | undefined, value: any) {
    const versions: Record<string, string> = {};
    if (!kind || !value) return versions;
    const state = value.state || value;
    const rows = (key: string, list: any[]) => {
      for (const row of list || [])
        if (row && typeof row.id === "string")
          versions[key + ":" + row.id] = digest(row);
    };
    if (kind === "inboxState") rows("email-update", state.updates);
    if (kind === "snapshot") rows("order", state.orders);
    if (kind === "collectionState") rows("collection", state.items);
    if (kind === "expenseState") {
      rows("expense", state.entries);
      rows("schedule", state.schedules);
      versions["expense-set"] = digest([state.entries, state.schedules]);
    }
    if (kind === "shippingState") rows("task", state.items);
    if (kind === "mailboxState") rows("outstanding", state.outstanding);
    if (kind === "sellingState") rows("selling", state.units);
    return versions;
  }
  private current(key: string): unknown {
    const [kind, id] = key.split(":");
    switch (kind) {
      case "email-update":
        return this.store.emailUpdates().find((i) => i.id === id);
      case "order":
        return this.store.snapshot().orders.find((i) => i.id === id);
      case "collection":
        return this.store.collection.items().find((i) => i.id === id);
      case "expense":
        return this.store.expenses
          .state(localToday())
          .entries.find((i) => i.id === id);
      case "schedule":
        return this.store.expenses
          .state(localToday())
          .schedules.find((i) => i.id === id);
      case "expense-set": {
        const state = this.store.expenses.state(localToday());
        return [state.entries, state.schedules];
      }
      case "task":
        return this.store.shipping.items().find((i) => i.id === id);
      case "outstanding":
        return this.store.mail.lines().find((i) => i.id === id);
      case "selling":
        return this.store.selling.units().find((i) => i.id === id);
      default:
        return undefined;
    }
  }
  private guard(d: Descriptor, args: any[], guards: Record<string, string>) {
    if (!d.resource) return;
    const first = args[0];
    const keys =
      d.resource === "expense-set"
        ? ["expense-set"]
        : d.bulk
          ? z
              .array(z.string().uuid())
              .min(1)
              .max(10000)
              .parse(first?.ids)
              .map((id) => d.resource + ":" + id)
          : [
              d.resource +
                ":" +
                z
                  .string()
                  .uuid()
                  .parse(typeof first === "string" ? first : first?.id),
            ];
    for (const key of keys) {
      const current = this.current(key);
      if (
        current === undefined ||
        !guards[key] ||
        digest(current) !== guards[key]
      )
        throw new WorkspaceError(
          409,
          "This record changed on your PC. Close this editor, refresh, and review the latest version before saving. Nothing was changed.",
        );
    }
  }
  async execute(deviceId: string, input: unknown) {
    const { method, args, requestId, guards } = z
      .object({
        method: z.string().max(64),
        args: z.array(z.unknown()).max(1),
        requestId: z.string().uuid(),
        guards: z
          .record(z.string().max(100), z.string().regex(/^[a-f0-9]{64}$/))
          .default({}),
      })
      .strict()
      .parse(input);
    const custom = [
      "previewExpenseImportText",
      "commitExpenseImport",
      "exportExpenseText",
      "exportOrderText",
      "openCollectionUrl",
      "collectibleReferenceUrl",
      "openListingUrl",
      "copyListingText",
    ];
    if (!Object.hasOwn(workspaceMethods, method) && !custom.includes(method))
      throw new WorkspaceError(
        404,
        "This operation is not available from the companion.",
      );
    const d = workspaceMethods[method];
    const read =
      d?.read ||
      [
        "exportExpenseText",
        "exportOrderText",
        "openCollectionUrl",
        "collectibleReferenceUrl",
        "openListingUrl",
        "copyListingText",
      ].includes(method);
    const key = deviceId + ":" + requestId,
      hash = digest([method, args, guards]);
    for (const [k, c] of this.completed)
      if (c.expires < Date.now()) this.completed.delete(k);
    for (const [k, p] of this.previews)
      if (p.expires < Date.now()) this.previews.delete(k);
    const previous = this.completed.get(key);
    if (previous) {
      if (previous.hash !== hash)
        throw new WorkspaceError(
          409,
          "This request identifier was already used for a different operation.",
        );
      const value = previous.rawSnapshot
        ? await this.state("snapshot")
        : previous.state
          ? { ...previous.value, state: await this.state(previous.state) }
          : previous.value;
      return { value, versions: this.versions(previous.state, value) };
    }
    const pending = this.inFlight.get(key);
    if (pending) {
      if (pending.hash !== hash)
        throw new WorkspaceError(
          409,
          "This request identifier is already in use.",
        );
      return pending.promise;
    }
    if (!read && this.completed.size + this.inFlight.size >= 500)
      throw new WorkspaceError(
        429,
        "Too many write requests. Wait a few minutes before starting another action; existing requests can still be retried.",
      );
    const perform = async () => {
      let value: any;
      let state = d?.state;
      this.guard(d || { channel: "" }, args, guards);
      if (d) {
        const fn = this.actions.get(d.channel);
        if (!fn)
          throw new WorkspaceError(
            503,
            "The desktop service is not ready. Try again shortly.",
          );
        value = await fn(...args);
      } else if (method === "previewExpenseImportText") {
        const text = z
          .string()
          .max(8 * 1024 * 1024)
          .parse(args[0]);
        try {
          const parsed = parseExpenseCsv(text),
            token = randomUUID();
          this.previews.set(deviceId, {
            token,
            parsed,
            expires: Date.now() + 10 * 60000,
          });
          value = {
            token,
            charges: parsed.entries.length,
            schedules: parsed.schedules.length,
            newRecurring: parsed.entries.filter(
              (e) => !e.archived && !e.scheduleId && e.intervalMonths > 0,
            ).length,
          };
        } catch {
          value = {
            error:
              "Could not read the CSV. Use a valid expense CSV no larger than 8 MiB.",
          };
        }
      } else if (method === "commitExpenseImport") {
        state = "expenseState";
        const token = z.string().uuid().parse(args[0]),
          preview = this.previews.get(deviceId);
        if (!preview || preview.token !== token || preview.expires < Date.now())
          value = {
            ok: false,
            error: "The import preview expired. Choose the CSV again.",
            state: await this.state(state),
          };
        else {
          this.previews.delete(deviceId);
          try {
            value = {
              ok: true,
              ...this.store.expenses.import(preview.parsed, localToday()),
            };
          } catch {
            value = {
              ok: false,
              error:
                "The CSV import could not be saved. Review duplicate IDs, schedule references and storage permissions.",
              state: await this.state(state),
            };
          }
        }
      } else if (method === "exportExpenseText")
        value = exportExpenseCsv(this.store.expenses.state(localToday()));
      else if (method === "exportOrderText") {
        const keys = [
          "id",
          "name",
          "store",
          "category",
          "total",
          "status",
          "date",
        ] as const;
        const cell = (v: unknown) => {
          let s = String(v);
          if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
          return '"' + s.replace(/"/g, '""') + '"';
        };
        value = [
          keys.join(","),
          ...this.store
            .snapshot()
            .orders.map((o) => keys.map((k) => cell(o[k])).join(",")),
        ].join("\r\n");
      } else if (method === "collectibleReferenceUrl") {
        value = collectibleReference(this.store.collection.items(), args[0]);
      } else if (method === "openCollectionUrl") {
        const url = z.string().max(2048).parse(args[0]);
        if (
          !allowedTcgNavigation(url) &&
          ![
            "https://justtcg.com/",
            "https://justtcg.com/dashboard",
            "https://justtcg.com/pricing",
          ].includes(url)
        )
          throw Error("URL_INVALID");
        value = url;
      } else if (method === "openListingUrl") {
        const v = z
            .object({
              id: z.string().uuid(),
              platform: z.enum(["ebay", "mercari"]),
            })
            .strict()
            .parse(args[0]),
          unit = this.store.selling.get(v.id),
          id = v.platform === "ebay" ? unit.ebayListingId : unit.mercariId;
        if (!id) throw Error("MISSING_LISTING");
        value = listingUrl(v.platform, id, unit.environment || "production");
      } else if (method === "copyListingText") {
        const v = z
            .object({
              id: z.string().uuid(),
              field: z.enum(["title", "description", "all"]),
            })
            .strict()
            .parse(args[0]),
          unit = this.store.selling.get(v.id);
        value =
          v.field === "title"
            ? unit.title
            : v.field === "description"
              ? unit.description
              : `${unit.title}\n\n${unit.description}\n\nPrice: $${(unit.priceCents / 100).toFixed(2)} USD\nQuantity: 1\nCopy identifier: ${unit.unitLabel}\nSKU: ${unit.sku}`;
      }
      if (!read) {
        const rawSnapshot = state === "snapshot";
        const base = rawSnapshot
          ? null
          : value && typeof value === "object" && "state" in value
            ? { ...value, state: undefined }
            : value;
        this.completed.set(key, {
          hash,
          expires: Date.now() + 10 * 60000,
          value: base,
          state,
          rawSnapshot,
        });
      }
      return { value, versions: this.versions(state, value) };
    };
    const promise = perform();
    if (!read) this.inFlight.set(key, { hash, promise });
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }
}
