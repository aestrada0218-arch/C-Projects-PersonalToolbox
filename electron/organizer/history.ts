import type { Database, SqlValue } from "sql.js";
import { randomUUID } from "node:crypto";
// No credential/configuration, pricing quotas, sale-offer or provider cursor tables.
const tables = [
  "orders",
  "collection",
  "collection_quotes",
  "expense_schedules",
  "expenses",
  "shipments",
  "inbox_updates",
  "inbox_update_dismissals",
  "shipping_tasks",
  "shipping_receipts",
  "outstanding_orders",
  "outstanding_receipts",
  "organizer_records",
];
type Row = Record<string, SqlValue>;
type Patch = { table: string; key: Row; before: Row | null; after: Row | null };
function rows(db: Database, sql: string, params: SqlValue[] = []): Row[] {
  const st = db.prepare(sql);
  try {
    st.bind(params);
    const out: Row[] = [];
    while (st.step()) out.push(st.getAsObject());
    return out;
  } finally {
    st.free();
  }
}
export function capture(db: Database) {
  return Object.fromEntries(
    tables
      .filter(
        (t) =>
          rows(
            db,
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            [t],
          ).length,
      )
      .map((t) => [t, rows(db, `SELECT * FROM ${t}`)]),
  );
}
function pk(db: Database, table: string) {
  return rows(db, `PRAGMA table_info(${table})`)
    .filter((c) => Number(c.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((c) => String(c.name));
}
export function validateOrganizerRelations(db: Database) {
  const records = rows(
    db,
    "SELECT id,kind,data FROM organizer_records WHERE deletedAt IS NULL",
  ).map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    data: JSON.parse(String(r.data)),
  }));
  const received = new Map<string, number>(),
    unique = new Set<string>();
  for (const r of records) {
    if (r.kind === "receipt") {
      const line = records.find(
          (l) => l.id === r.data.lineId && l.kind === "line",
        ),
        pkg = records.find(
          (p) => p.id === r.data.packageId && p.kind === "package",
        );
      if (
        !line ||
        (r.data.packageId && (!pkg || pkg.data.orderId !== line.data.orderId))
      )
        throw Error(
          "Receiving records still depend on this line or package. Remove them first.",
        );
      received.set(line.id, (received.get(line.id) || 0) + r.data.quantity);
    }
    const key =
      r.kind === "details"
        ? "details:" + r.data.collectionId
        : r.kind === "budget"
          ? "budget:" + r.data.category.toLowerCase()
          : r.kind === "sale" && r.data.reference
            ? "sale:" +
              JSON.stringify([
                r.data.collectionId,
                r.data.marketplace,
                r.data.reference,
              ])
            : null;
    if (key) {
      if (unique.has(key))
        throw Error(
          "A newer matching record exists. Remove it before undoing this change.",
        );
      unique.add(key);
    }
  }
  for (const line of records.filter((r) => r.kind === "line"))
    if ((received.get(line.id) || 0) > line.data.quantity)
      throw Error(
        "Undo would reduce ordered quantity below what was received. Undo receiving first.",
      );
  for (const id of new Set(
    records.filter((r) => r.kind === "sale").map((r) => r.data.collectionId),
  )) {
    const sales = records.filter(
        (r) => r.kind === "sale" && r.data.collectionId === id,
      ),
      capacity = Math.max(...sales.map((r) => Number(r.data.lotQuantity || 0)));
    if (capacity && sales.reduce((n, r) => n + r.data.quantity, 0) > capacity)
      throw Error(
        "Undo would over-allocate this collection lot. Review newer sale records first.",
      );
  }
}
export function recordHistory(
  db: Database,
  before: ReturnType<typeof capture>,
  label: string,
  actor: string,
  canUndo: boolean,
) {
  const after = capture(db),
    patches: Patch[] = [],
    counts: string[] = [];
  for (const table of tables) {
    if (!before[table] || !after[table]) continue;
    const keys = pk(db, table),
      key = (r: Row) => JSON.stringify(keys.map((k) => r[k]));
    const old = new Map(before[table].map((r) => [key(r), r])),
      now = new Map(after[table].map((r) => [key(r), r]));
    let changed = 0;
    for (const k of new Set([...old.keys(), ...now.keys()])) {
      const a = old.get(k) || null,
        b = now.get(k) || null;
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      const row = a || b!;
      changed++;
      patches.push({
        table,
        key: Object.fromEntries(keys.map((k) => [k, row[k]])),
        before: a,
        after: b,
      });
    }
    if (changed) counts.push(`${table.replaceAll("_", " ")}: ${changed}`);
  }
  if (!patches.length) return;
  const descriptions = patches.slice(0, 3).map((p) => {
    const row = p.after || p.before!;
    let title = row.name || row.description || row.subject;
    if (p.table === "organizer_records") {
      const data = JSON.parse(String(row.data));
      title =
        data.title ||
        data.description ||
        data.name ||
        data.collectionName ||
        data.orderName ||
        data.category ||
        String(row.kind);
    }
    return String(title || Object.values(p.key).join("/"))
      .replace(/[\x00-\x1f]/g, " ")
      .slice(0, 120);
  });
  if (
    label === "organizer save" &&
    patches.length === 1 &&
    patches[0].table === "organizer_records"
  )
    label = `${patches[0].before ? "Edit" : "Add"} ${(patches[0].after || patches[0].before)!.kind}`;
  const json = JSON.stringify(patches),
    bounded = Buffer.byteLength(json) <= 2 * 1024 * 1024;
  db.run("INSERT INTO toolbox_history VALUES(?,?,?,?,?,NULL,?,?)", [
    randomUUID(),
    label,
    actor,
    new Date().toISOString(),
    Number(canUndo && bounded),
    counts.join(" · ") + " — " + descriptions.join("; "),
    canUndo && bounded ? json : "[]",
  ]);
  db.run(
    "DELETE FROM toolbox_history WHERE id NOT IN(SELECT id FROM toolbox_history ORDER BY createdAt DESC,rowid DESC LIMIT 200)",
  );
}
export function historyState(db: Database) {
  return rows(
    db,
    "SELECT id,label,actor,createdAt,undoable,undoneAt,summary FROM toolbox_history ORDER BY createdAt DESC,rowid DESC LIMIT 200",
  ).map((r) => ({ ...r, undoable: !!r.undoable }));
}
export function undoHistory(db: Database, id: string) {
  const entry = rows(db, "SELECT * FROM toolbox_history WHERE id=?", [id])[0];
  if (!entry || !entry.undoable || entry.undoneAt)
    throw Error(
      "This change cannot be undone. Use a backup for external operations or large changes.",
    );
  const patches = JSON.parse(String(entry.patches)) as Patch[];
  for (const p of patches) {
    if (!tables.includes(p.table)) throw Error("Invalid history record");
    const keys = pk(db, p.table);
    if (keys.join() !== Object.keys(p.key).join())
      throw Error("Invalid history key");
    const current =
      rows(
        db,
        `SELECT * FROM ${p.table} WHERE ${keys.map((k) => `${k}=?`).join(" AND ")}`,
        keys.map((k) => p.key[k]),
      )[0] || null;
    const comparable = (row: Row | null) =>
      p.table === "organizer_records" && row
        ? Object.fromEntries(
            Object.entries(row).filter(
              ([key]) => !["revision", "updatedAt"].includes(key),
            ),
          )
        : row;
    if (
      JSON.stringify(comparable(current)) !==
      JSON.stringify(comparable(p.after))
    )
      throw Error(
        "This record changed again. Undo the newer change first or use a backup.",
      );
  }
  db.run("PRAGMA defer_foreign_keys=ON");
  for (const p of [...patches].reverse().filter((p) => !p.before)) {
    const keys = Object.keys(p.key);
    db.run(
      `DELETE FROM ${p.table} WHERE ${keys.map((k) => `${k}=?`).join(" AND ")}`,
      keys.map((k) => p.key[k]),
    );
  }
  for (const p of patches.filter((p) => p.before)) {
    if (p.table === "organizer_records") {
      const current = rows(
        db,
        "SELECT revision FROM organizer_records WHERE id=?",
        [p.key.id],
      )[0];
      p.before = {
        ...p.before!,
        revision:
          Math.max(
            Number(current?.revision || 0),
            Number(p.after?.revision || 0),
            Number(p.before!.revision),
          ) + 1,
        updatedAt: new Date().toISOString(),
      };
    }
    const columns = rows(db, `PRAGMA table_info(${p.table})`).map((c) =>
      String(c.name),
    );
    if (Object.keys(p.before!).some((k) => !columns.includes(k)))
      throw Error("The database schema changed; use a backup instead.");
    const keys = pk(db, p.table),
      cols = Object.keys(p.before!);
    db.run(
      `INSERT INTO ${p.table}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")}) ON CONFLICT(${keys.join(",")}) DO UPDATE SET ${cols
        .filter((k) => !keys.includes(k))
        .map((k) => `${k}=excluded.${k}`)
        .join(",")}`,
      cols.map((k) => p.before![k]),
    );
  }
  db.run("UPDATE toolbox_history SET undoneAt=?,undoable=0 WHERE id=?", [
    new Date().toISOString(),
    id,
  ]);
}
export const undoMethods = new Set([
  "toolbox:clear-expenses",
  "toolbox:collection-add-linked",
  "toolbox:add-order",
  "toolbox:update-order",
  "toolbox:delete-order",
  "toolbox:collection-add-manual",
  "toolbox:collection-edit",
  "toolbox:collection-delete",
  "toolbox:add-expense",
  "toolbox:edit-expense",
  "toolbox:delete-expense",
  "toolbox:edit-expense-schedule",
  "toolbox:stop-expense-schedule",
  "toolbox:shipping-add",
  "toolbox:shipping-edit",
  "toolbox:shipping-delete",
  "toolbox:outstanding-date",
  "toolbox:outstanding-delete",
  "toolbox:delete-email-update",
  "toolbox:organizer-save",
  "toolbox:organizer-delete",
]);
