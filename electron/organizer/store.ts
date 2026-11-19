import { safePhotoSize } from "../collection/photo";
import type { Database, SqlValue } from "sql.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "../database";
import type {
  OrganizerKind,
  OrganizerRecord,
  OrganizerState,
} from "../../src/organizer-types";
import { localToday } from "../shipping/model";
import { schemas, saveSchema, saleTotals } from "./model";
import { historyState, undoHistory } from "./history";
export class OrganizerRepository {
  constructor(
    private db: () => Database,
    private transaction: <T>(fn: () => T) => T,
    private store: () => Store,
  ) {}
  records(): OrganizerRecord[] {
    const st = this.db().prepare(
      "SELECT * FROM organizer_records WHERE deletedAt IS NULL ORDER BY createdAt DESC,rowid DESC",
    );
    try {
      const rows: OrganizerRecord[] = [];
      while (st.step()) {
        const r = st.getAsObject();
        rows.push({
          id: String(r.id),
          kind: r.kind as OrganizerKind,
          data: JSON.parse(String(r.data)),
          revision: Number(r.revision),
          createdAt: String(r.createdAt),
          updatedAt: String(r.updatedAt),
        });
      }
      return rows;
    } finally {
      st.free();
    }
  }
  save(input: unknown) {
    const request = saveSchema.parse(input),
      data = schemas[request.kind].strict().parse(request.data) as Record<
        string,
        any
      >;
    return this.transaction(() => {
      const rows = this.records(),
        existing = rows.find((r) => r.id === request.id);
      if (
        request.id &&
        (!existing ||
          existing.revision !== request.revision ||
          existing.kind !== request.kind)
      )
        throw Error(
          "This record changed. Refresh and review it before saving.",
        );
      if (!request.id && request.revision !== null)
        throw Error("Invalid new record revision");
      const other = rows.filter((r) => r.id !== request.id),
        orders = this.store().snapshot().orders,
        collection = this.store().collection.items();
      if (data.orderId && !orders.some((o) => o.id === data.orderId))
        throw Error("Choose an existing order.");
      if (
        data.collectionId &&
        !collection.some((c) => c.id === data.collectionId)
      )
        throw Error("Choose an existing collection item.");
      if (request.kind === "package") {
        if (data.status === "Delivered" && !data.actualDate)
          throw Error("Enter the actual arrival date for a delivered package.");
        if (data.actualDate && data.actualDate > localToday())
          throw Error("Actual arrival cannot be in the future.");
        if (data.actualDate && data.status !== "Delivered")
          throw Error(
            "Use Delivered status when recording an actual arrival date.",
          );
      }
      if (
        request.kind === "sale" &&
        (data.refundCents > data.grossCents ||
          data.salesTaxCents > data.grossCents)
      )
        throw Error("Refund and withheld tax cannot exceed the gross sale.");
      if (request.kind === "receipt") {
        const line = rows.find(
          (r) => r.id === data.lineId && r.kind === "line",
        );
        if (!line) throw Error("Choose an existing order line.");
        if (!orders.some((o) => o.id === line.data.orderId))
          throw Error(
            "Restore the deleted parent order before receiving this line.",
          );
        const pkg = rows.find(
          (r) => r.id === data.packageId && r.kind === "package",
        );
        if (data.packageId && (!pkg || pkg.data.orderId !== line.data.orderId))
          throw Error("Choose a package belonging to the same order.");
        if (data.date > localToday())
          throw Error("Received dates cannot be in the future.");
        const received = other
          .filter((r) => r.kind === "receipt" && r.data.lineId === data.lineId)
          .reduce((sum, r) => sum + r.data.quantity, 0);
        if (received + data.quantity > line.data.quantity)
          throw Error("Received quantity exceeds the ordered quantity.");
      }
      if (request.kind === "line" && request.id) {
        const received = rows
          .filter((r) => r.kind === "receipt" && r.data.lineId === request.id)
          .reduce((sum, r) => sum + r.data.quantity, 0);
        if (received > data.quantity)
          throw Error("Quantity cannot be less than already received.");
        if (existing!.data.orderId !== data.orderId && received)
          throw Error("A received line cannot be moved to another order.");
      }
      if (
        request.kind === "package" &&
        request.id &&
        existing!.data.orderId !== data.orderId &&
        rows.some(
          (r) => r.kind === "receipt" && r.data.packageId === request.id,
        )
      )
        throw Error(
          "A package with receipts cannot be moved to another order.",
        );
      if (
        request.kind === "details" &&
        other.some(
          (r) =>
            r.kind === "details" && r.data.collectionId === data.collectionId,
        )
      )
        throw Error("Details already exist for this item; edit that record.");
      if (
        request.kind === "budget" &&
        other.some(
          (r) =>
            r.kind === "budget" &&
            r.data.category.toLowerCase() === data.category.toLowerCase(),
        )
      )
        throw Error("Edit the existing category budget instead.");
      if (request.kind === "sale") {
        const item = collection.find((c) => c.id === data.collectionId)!;
        if (data.date > localToday())
          throw Error("Sale dates cannot be in the future.");
        const capacity = Math.max(
          item.quantity,
          ...other
            .filter(
              (r) =>
                r.kind === "sale" && r.data.collectionId === data.collectionId,
            )
            .map((r) => Number(r.data.lotQuantity || 0)),
          Number(existing?.data.lotQuantity || 0),
        );
        data.lotQuantity = capacity;
        const allocated = other
          .filter(
            (r) =>
              r.kind === "sale" && r.data.collectionId === data.collectionId,
          )
          .reduce((sum, r) => sum + r.data.quantity, 0);
        if (allocated + data.quantity > capacity)
          throw Error(
            "Recorded sales exceed the quantity in this collection lot.",
          );
        if (
          data.reference &&
          other.some(
            (r) =>
              r.kind === "sale" &&
              r.data.collectionId === data.collectionId &&
              r.data.reference === data.reference &&
              r.data.marketplace === data.marketplace,
          )
        )
          throw Error("This item/order reference already has a sale record.");
        data.unitPurchaseCents =
          existing?.data.unitPurchaseCents ?? item.purchaseCents;
        Object.assign(data, saleTotals(data, data.unitPurchaseCents));
      }
      if (request.kind === "attachment") {
        const target = data.targetType === "order" ? orders : collection;
        if (!target.some((i) => i.id === data.targetId))
          throw Error("Choose an existing item or order.");
        const count = other.filter(
          (r) => r.kind === "attachment" && r.data.targetId === data.targetId,
        ).length;
        if (count >= 12)
          throw Error("Keep at most 12 attachments per item or order.");
        const bytes = Buffer.from(data.data.split(",")[1], "base64");
        if (data.data.startsWith("data:image/")) {
          const size = safePhotoSize(bytes);
          if (!size || Math.max(size.width, size.height) > 2048)
            throw Error(
              "Choose a valid photo with a longest edge under 2048 pixels.",
            );
        }
        if (
          data.data.startsWith("data:application/pdf") &&
          bytes.subarray(0, 5).toString() !== "%PDF-"
        )
          throw Error("Invalid PDF receipt.");
      }
      if (data.orderId)
        data.orderName = orders.find((o) => o.id === data.orderId)?.name;
      if (data.collectionId)
        data.collectionName = collection.find(
          (c) => c.id === data.collectionId,
        )?.name;
      if (request.kind === "receipt")
        data.lineDescription = rows.find((l) => l.id === data.lineId)?.data
          .description;
      if (request.kind === "attachment")
        data.targetName = (
          data.targetType === "order" ? orders : collection
        ).find((r) => r.id === data.targetId)?.name;
      const id = request.id || randomUUID(),
        now = new Date().toISOString();
      if (existing)
        this.db().run(
          "UPDATE organizer_records SET data=?,revision=revision+1,updatedAt=? WHERE id=?",
          [JSON.stringify(data), now, id],
        );
      else
        this.db().run(
          "INSERT INTO organizer_records VALUES(?,?,?,1,?,?,NULL)",
          [id, request.kind, JSON.stringify(data), now, now],
        );
      return id;
    });
  }
  remove(input: unknown) {
    const { id, revision } = z
      .object({ id: z.string().uuid(), revision: z.number().int().positive() })
      .strict()
      .parse(input);
    this.transaction(() => {
      const rows = this.records(),
        row = rows.find((r) => r.id === id);
      if (!row || row.revision !== revision)
        throw Error("This record changed. Refresh before deleting.");
      if (
        rows.some(
          (r) =>
            r.kind === "receipt" &&
            (r.data.lineId === id || r.data.packageId === id),
        )
      )
        throw Error("Delete the related receiving records first.");
      this.db().run(
        "UPDATE organizer_records SET deletedAt=?,revision=revision+1 WHERE id=?",
        [new Date().toISOString(), id],
      );
    });
  }
  undo(input: unknown) {
    const id = z.string().uuid().parse(input);
    this.transaction(() => undoHistory(this.db(), id));
  }
  state(): OrganizerState {
    const today = localToday(),
      records = this.records(),
      s = this.store(),
      snapshot = s.snapshot();
    const trackingSources = s.ship24.sources();
    for (const r of records.filter((r) => r.kind === "package")) {
      const source = trackingSources.find(
          (c) => c.type === "package" && c.id === r.id,
        ),
        binding = source ? s.ship24.effective(source) : null;
      if (binding?.summary)
        r.ship24 = { summary: binding.summary, checkedAt: binding.checkedAt };
    }
    const reminders: OrganizerState["reminders"] = [];
    const add = (
      id: string,
      title: string,
      date: string | null,
      section: string,
    ) => {
      if (date)
        reminders.push({ id, title, date, section, overdue: date < today });
    };
    for (const r of records) {
      if (r.kind === "reminder" && !r.data.completed)
        add(r.id, r.data.title, r.data.date, "Reminders");
      if (
        r.kind === "package" &&
        (r.ship24?.summary.status || r.data.status) !== "Delivered"
      )
        add(
          r.id,
          `${(r.ship24?.summary.status || r.data.status) === "Exception" ? "Delivery exception: " : "Expected package: "}${r.data.tracking || r.data.carrier}`,
          r.ship24?.summary.estimatedDate || r.data.expectedDate,
          "Packages",
        );
      if (
        r.kind === "return" &&
        !["Refunded", "Cancelled"].includes(r.data.status)
      )
        add(
          r.id,
          `Return/refund: ${r.data.reason}`,
          r.data.deadline,
          "Returns",
        );
    }
    for (const r of s.mail.lines())
      if (r.receivedQty < r.quantity && !r.deletedAt)
        add(r.id, `Expected: ${r.description}`, r.expectedDate, "Outstanding");
    for (const t of s.shipping.items())
      if (t.status === "Needs Shipment")
        add(t.id, `Ship sale: ${t.name}`, t.shipBy, "Tasks");
    const expenses = s.expenses.state(today);
    for (const r of expenses.schedules)
      if (r.active)
        add(r.id, `Renewal: ${r.description}`, r.nextDue, "Expenses");
    const normalize = (v: string) =>
      v
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const duplicates: OrganizerState["duplicates"] = [];
    const group = (
      source: string,
      rows: { id: string; name: string; key: string }[],
    ) => {
      const map = new Map<string, typeof rows>();
      for (const r of rows) {
        const a = map.get(r.key) || [];
        a.push(r);
        map.set(r.key, a);
      }
      for (const values of map.values())
        if (values.length > 1)
          duplicates.push({
            source,
            name: values[0].name,
            ids: values.map((r) => r.id),
          });
    };
    group(
      "Orders",
      snapshot.orders.map((o) => ({
        id: o.id,
        name: o.name,
        key: JSON.stringify([
          normalize(o.name),
          normalize(o.store),
          o.date,
          o.total,
        ]),
      })),
    );
    group(
      "Collection",
      s.collection.items().map((c) => ({
        id: c.id,
        name: c.name,
        key: JSON.stringify([
          normalize(c.name),
          c.collectionType,
          c.variantId,
          c.printing,
          c.condition,
        ]),
      })),
    );
    for (const wish of records.filter((r) => r.kind === "wishlist")) {
      const owned = s.collection
        .items()
        .filter(
          (c) =>
            normalize(c.name) === normalize(wish.data.name) &&
            c.collectionType === wish.data.section,
        );
      if (owned.length)
        duplicates.push({
          source: "Wishlist already owned",
          name: wish.data.name,
          ids: [wish.id, ...owned.map((c) => c.id)],
        });
    }
    const budgets = records
      .filter((r) => r.kind === "budget")
      .map((r) => ({
        category: r.data.category,
        budgetCents: r.data.amountCents,
        spentCents: expenses.entries
          .filter(
            (e) =>
              e.date.startsWith(today.slice(0, 7)) &&
              e.date <= today &&
              (r.data.category === "All expenses" ||
                e.category === r.data.category),
          )
          .reduce((sum, e) => sum + e.amountCents, 0),
      }));
    return {
      orders: snapshot.orders,
      collection: s.collection.items(),
      records,
      history: historyState(this.db()) as any,
      reminders: reminders.sort((a, b) => a.date.localeCompare(b.date)),
      duplicates,
      budgets,
      backups: [],
      today,
    };
  }
}
