import Ship24Panel from "./Ship24Panel";
import { useEffect, useRef, useState } from "react";
import type {
  OrganizerKind,
  OrganizerRecord,
  OrganizerResult,
  OrganizerState,
} from "./organizer-types";
import {
  fields,
  kindLabels,
  sections,
  type OrganizerSection,
} from "./organizer-fields";
import { listenForDataChanges } from "./data-changes";
import { Pagination, usePagination } from "./pagination";
import { localToday, amountToCents } from "./expense-types";
import { operationError } from "./operation-error";
import "./organizer.css";
export type OrganizerRequest = {
  section: OrganizerSection;
  itemId?: string;
  orderId?: string;
  nonce: number;
};
const empty: OrganizerState = {
  orders: [],
  collection: [],
  records: [],
  history: [],
  reminders: [],
  duplicates: [],
  budgets: [],
  backups: [],
  today: localToday(),
};
const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    v / 100,
  );
export default function OrganizerPanel({
  request,
}: {
  request?: OrganizerRequest | null;
}) {
  const [state, setState] = useState(empty),
    [section, setSection] = useState<OrganizerSection>(
      request?.section || "Overview",
    ),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [editor, setEditor] = useState<{
      kind: OrganizerKind;
      record?: OrganizerRecord;
    } | null>(null),
    [confirm, setConfirm] = useState<{
      action: () => Promise<OrganizerResult>;
      title: string;
    } | null>(null),
    [scope, setScope] = useState({
      itemId: request?.itemId,
      orderId: request?.orderId,
    });
  const openEditor = (value: {
    kind: OrganizerKind;
    record?: OrganizerRecord;
  }) => {
    setError("");
    setEditor(value);
  };
  const acting = useRef(false),
    revision = useRef(0);
  useEffect(() => {
    setSection(request?.section || "Overview");
    setScope({ itemId: request?.itemId, orderId: request?.orderId });
    setQuery("");
  }, [request]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (acting.current) return;
      const r = revision.current;
      try {
        const s = await window.toolbox!.organizerState();
        if (alive && r === revision.current) setState(s);
      } catch {
        if (alive)
          setError(
            "Could not load your organizer. Reopen this section to retry.",
          );
      }
    };
    void load();
    const unsub = listenForDataChanges(() => void load()),
      timer = setInterval(() => void load(), 15000);
    return () => {
      alive = false;
      unsub();
      clearInterval(timer);
    };
  }, []);
  async function act(fn: () => Promise<OrganizerResult>, message = "Saved.") {
    if (acting.current) return false;
    acting.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      setState(r.state);
      if (!r.ok) {
        setError(r.error || "Could not save.");
        return false;
      }
      setNotice(message);
      return true;
    } catch (e) {
      setError(
        operationError(
          e,
          "Could not reach the Windows app. Check the connection before retrying.",
        ),
      );
      return false;
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }
  const title = (r: OrganizerRecord) => {
    const orderName =
      state.orders.find((o) => o.id === r.data.orderId)?.name ||
      r.data.orderName;
    if (r.kind === "package")
      return `${r.data.carrier} ${r.data.tracking || orderName || "package"}`;
    if (r.kind === "return")
      return `${orderName || "Purchase"} — ${r.data.reason}`;
    if (r.kind === "receipt")
      return (
        r.data.lineDescription ||
        state.records.find((l) => l.id === r.data.lineId)?.data.description ||
        "Receiving record"
      );
    if (r.kind === "budget") return r.data.category;
    return (
      r.data.description ||
      r.data.name ||
      r.data.title ||
      state.collection.find((i) => i.id === r.data.collectionId)?.name ||
      r.data.collectionName ||
      orderName ||
      kindLabels[r.kind]
    );
  };
  const scoped = (r: OrganizerRecord) => {
    if (scope.itemId && ["Collection", "Finances"].includes(section))
      return (
        r.data.collectionId === scope.itemId || r.data.targetId === scope.itemId
      );
    if (scope.orderId && section === "Orders")
      return (
        r.data.orderId === scope.orderId ||
        state.records.some(
          (l) => l.id === r.data.lineId && l.data.orderId === scope.orderId,
        )
      );
    return true;
  };
  const records = state.records.filter(
    (r) =>
      (sections[section] as readonly string[]).includes(r.kind) &&
      scoped(r) &&
      [
        title(r),
        ...Object.entries(r.data)
          .filter(([k]) => k !== "data")
          .map(([, v]) => String(v)),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const pagination = usePagination(
    records,
    JSON.stringify([section, query, scope]),
  );
  const historyPage = usePagination(
    state.history.filter((h) =>
      [h.label, h.actor, h.summary]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
    query,
  );
  const deadlinePage = usePagination(
    state.reminders.filter((r) =>
      [r.title, r.section, r.date]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
    query,
  );
  const duplicatePage = usePagination(state.duplicates, section);
  const backupPage = usePagination(state.backups, section);
  const sales = state.records.filter((r) => r.kind === "sale"),
    realized = sales.reduce((n, r) => n + r.data.profitCents, 0),
    unreconciled = sales.filter(
      (r) => r.data.payoutCents === null || r.data.payoutDifferenceCents !== 0,
    ).length;
  const rowInfo = (r: OrganizerRecord) => {
    if (r.kind === "line") {
      const received = state.records
        .filter((v) => v.kind === "receipt" && v.data.lineId === r.id)
        .reduce((n, v) => n + v.data.quantity, 0);
      return `${received} / ${r.data.quantity} received · ${r.data.quantity - received} outstanding · ${money(r.data.unitCents)} each`;
    }
    if (r.kind === "receipt")
      return `${r.data.quantity} received · ${r.data.date} · ${state.records.find((l) => l.id === r.data.lineId)?.data.description || "Deleted order line"}`;
    if (r.kind === "package")
      return `${r.ship24?.summary.status || r.data.status}${r.ship24 ? " (Ship24)" : " (manual)"} · ${r.data.carrier} ${r.data.tracking} · expected ${r.ship24?.summary.estimatedDate || r.data.expectedDate || "not set"} · actual ${r.ship24?.summary.actualDate || r.data.actualDate || "not set"}`;
    if (r.kind === "return")
      return `${r.data.status} · received ${money(r.data.refundedCents)} / ${money(r.data.expectedCents)} · deadline ${r.data.deadline || "not set"}`;
    if (r.kind === "sale")
      return `Basis ${money(r.data.basisCents)} · expected payout ${money(r.data.expectedPayoutCents)} · profit ${money(r.data.profitCents)} · payout ${r.data.payoutCents === null ? "not recorded" : money(r.data.payoutCents)} · difference ${r.data.payoutDifferenceCents === null ? "pending" : money(r.data.payoutDifferenceCents)}`;
    if (r.kind === "details")
      return [
        r.data.series,
        r.data.issue && `#${r.data.issue}`,
        r.data.variant,
        r.data.coverArtist,
        r.data.grade,
        r.data.condition,
        r.data.location,
      ]
        .filter(Boolean)
        .join(" · ");
    if (r.kind === "wishlist")
      return `${r.data.section} · target ${r.data.maxPriceCents === null ? "not set" : money(r.data.maxPriceCents)}`;
    if (r.kind === "budget")
      return `${r.data.category}: ${money(r.data.amountCents)} / month`;
    if (r.kind === "reminder")
      return `${r.data.date} · ${r.data.completed ? "Completed" : "Open"}`;
    return `${r.data.targetType} attachment`;
  };
  return (
    <div className="organizer-module">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONNECTED WORKFLOWS</span>
          <h1>
            Organizer<span className="gold">.</span>
          </h1>
          <p>
            Receiving, returns, collection details, true costs and recovery.
          </p>
        </div>
      </div>
      <div
        className="collection-tabs"
        role="tablist"
        aria-label="Organizer sections"
      >
        {Object.keys(sections).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={section === s}
            className={section === s ? "active" : ""}
            onClick={() => {
              setSection(s as OrganizerSection);
              setQuery("");
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {section === "Tracking" && <Ship24Panel />}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {((scope.itemId && ["Collection", "Finances"].includes(section)) ||
        (scope.orderId && section === "Orders")) && (
        <div className="notice">
          Showing{" "}
          {state.collection.find((i) => i.id === scope.itemId)?.name ||
            state.orders.find((o) => o.id === scope.orderId)?.name ||
            "linked records"}{" "}
          <button
            className="text-button"
            onClick={() => setScope({ itemId: undefined, orderId: undefined })}
          >
            Show all records
          </button>
        </div>
      )}
      {section === "Overview" && (
        <>
          <div className="organizer-stats">
            <article className="panel">
              <small>Open deadlines</small>
              <strong>{state.reminders.length}</strong>
            </article>
            <article className="panel">
              <small>Overdue</small>
              <strong>{state.reminders.filter((r) => r.overdue).length}</strong>
            </article>
            <article className="panel">
              <small>Recorded realized profit</small>
              <strong>{money(realized)}</strong>
            </article>
            <article className="panel">
              <small>Payouts to reconcile</small>
              <strong>{unreconciled}</strong>
            </article>
          </div>
          <section className="panel organizer-list">
            <h2>Upcoming and overdue</h2>
            <p>
              Local reminders from shipments, outstanding purchases, returns,
              renewals and your own dates.
            </p>
            {state.reminders.slice(0, 12).map((r) => (
              <div key={r.id} className={r.overdue ? "organizer-warning" : ""}>
                <strong>{r.title}</strong>
                <span>
                  {r.date} · {r.overdue ? "Overdue" : r.section}
                </span>
              </div>
            ))}
            {!state.reminders.length && <p>No open deadlines.</p>}
          </section>
          <section className="panel organizer-list">
            <h2>Possible duplicates</h2>
            <p>
              Review before buying or importing again. Same-title items can be
              legitimate different variants or purchases.
            </p>
            {duplicatePage.visible.map((d, i) => (
              <div key={i}>
                <strong>{d.name}</strong>
                <span>
                  {d.source} · {d.ids.length} records
                </span>
              </div>
            ))}
            {!state.duplicates.length && (
              <p>No exact duplicate candidates found.</p>
            )}
            <Pagination value={duplicatePage} label="duplicate" />
          </section>
        </>
      )}
      {(sections[section] as readonly string[]).length > 0 && (
        <section className="panel">
          <div className="table-toolbar">
            <label className="search">
              <input
                aria-label="Search organizer records"
                placeholder="Search all records in this section…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="actions">
              {sections[section].map((kind) => (
                <button
                  key={kind}
                  className="secondary"
                  disabled={busy}
                  onClick={() => openEditor({ kind })}
                >
                  Add {kindLabels[kind].toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          {section === "Orders" && (
            <p className="organizer-note">
              Record lines and partial quantities received across packages.
              These records do not create collection items; use Collection →
              Outstanding orders to receive imported purchases into inventory.
              Carrier statuses here are recorded manually.
            </p>
          )}
          {section === "Finances" && (
            <p className="organizer-note">
              Purchase cost is captured from the collection lot when a sale is
              first saved. Allocate purchase shipping/tax for the sold quantity.
              Gross includes buyer shipping/tax; fees, remitted tax, refunds and
              postage reduce expected payout. These accounting records do not
              change collection quantities or duplicate charges into Expenses.
            </p>
          )}
          <div className="organizer-list">
            {pagination.visible.map((r) => (
              <article key={r.id} className="organizer-record">
                <div>
                  <small>{kindLabels[r.kind]}</small>
                  <strong>{title(r)}</strong>
                  <p>{rowInfo(r)}</p>
                  {r.data.notes && <p>{r.data.notes}</p>}
                  {r.kind === "attachment" &&
                    r.data.data.startsWith("data:image/") && (
                      <img
                        className="organizer-photo"
                        src={r.data.data}
                        alt={r.data.name}
                      />
                    )}
                </div>
                <div className="actions">
                  {r.kind === "package" &&
                    r.data.tracking &&
                    r.data.carrier !== "Other" && (
                      <button
                        onClick={() =>
                          void window
                            .toolbox!.openPackageTracking(r.id)
                            .catch(() =>
                              setError("Could not open the carrier page."),
                            )
                        }
                      >
                        Open carrier
                      </button>
                    )}
                  {r.kind === "attachment" && (
                    <button
                      onClick={() => {
                        const a = document.createElement("a");
                        const encoded = r.data.data.split(",")[1],
                          mime = r.data.data.split(";")[0].slice(5),
                          url = URL.createObjectURL(
                            new Blob(
                              [
                                Uint8Array.from(atob(encoded), (c) =>
                                  c.charCodeAt(0),
                                ),
                              ],
                              { type: mime },
                            ),
                          );
                        a.href = url;
                        a.download = r.data.name.replace(/[^\w. -]/g, "_");
                        document.body.append(a);
                        a.click();
                        a.remove();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      }}
                    >
                      Download
                    </button>
                  )}
                  <button
                    aria-label={`Edit ${title(r)}`}
                    disabled={busy}
                    onClick={() => openEditor({ kind: r.kind, record: r })}
                  >
                    Edit
                  </button>
                  <button
                    className="danger-button"
                    aria-label={`Delete ${title(r)}`}
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        title: `Delete ${title(r)}?`,
                        action: () =>
                          window.toolbox!.deleteOrganizer({
                            id: r.id,
                            revision: r.revision,
                          }),
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
            {!records.length && (
              <p className="empty">No matching records yet.</p>
            )}
          </div>
          <div className="table-bottom">
            <Pagination value={pagination} label="organizer" />
          </div>
        </section>
      )}
      {(section === "Overview" || section === "Reminders") && (
        <section className="panel organizer-list">
          <h2>Unified deadlines</h2>
          {deadlinePage.visible.map((r) => (
            <div key={r.id} className={r.overdue ? "organizer-warning" : ""}>
              <strong>{r.title}</strong>
              <span>
                {r.date} · {r.section}
              </span>
            </div>
          ))}
          {!state.reminders.length && <p>No open deadlines.</p>}
          <Pagination value={deadlinePage} label="deadline" />
        </section>
      )}
      {section === "Budgets" && (
        <section className="panel organizer-list">
          <h2>This month’s expense ledger</h2>
          {state.budgets.map((b) => (
            <div
              key={b.category}
              className={
                b.spentCents > b.budgetCents ? "organizer-warning" : ""
              }
            >
              <strong>{b.category}</strong>
              <span>
                {money(b.spentCents)} / {money(b.budgetCents)} ·{" "}
                {money(b.budgetCents - b.spentCents)} remaining
              </span>
            </div>
          ))}
        </section>
      )}
      {section === "History" && (
        <section className="panel organizer-list">
          <h2>Change history and undo</h2>
          <p>
            Undo checks for subsequent edits and preserves transaction
            consistency. Provider operations and large changes require backup
            recovery.
          </p>
          <label className="search">
            <input
              aria-label="Search history"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search history…"
            />
          </label>
          {historyPage.visible.map((h) => (
            <article className="organizer-record" key={h.id}>
              <div>
                <strong>{h.label}</strong>
                <p>
                  {h.actor} · {new Date(h.createdAt).toLocaleString()}
                </p>
                <small>
                  {h.summary}
                  {h.undoneAt ? " · Undone" : ""}
                </small>
              </div>
              {h.undoable && !h.undoneAt && (
                <button
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      title: `Undo ${h.label}?`,
                      action: () => window.toolbox!.undoOrganizer(h.id),
                    })
                  }
                >
                  Undo
                </button>
              )}
            </article>
          ))}
          <Pagination value={historyPage} label="history" />
        </section>
      )}
      {section === "Backups" && (
        <section className="panel organizer-list">
          <h2>Backups and restore</h2>
          <p>
            A daily database backup is kept while the Windows app is open (30
            daily copies), plus manual and restore-safety backups. Credentials
            and device pairing are stored separately and are not exported.
            Restore/import/export are Windows-only.
          </p>
          {state.backupError && <p className="alert">{state.backupError}</p>}
          <div className="actions">
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  () => window.toolbox!.createBackup(),
                  "Backup created.",
                )
              }
            >
              Create backup
            </button>
            {!window.toolbox?.mobileMode && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () => window.toolbox!.importBackup(),
                    "Backup imported and validated; select it below to restore.",
                  )
                }
              >
                Import backup
              </button>
            )}
          </div>
          {backupPage.visible.map((b) => (
            <article className="organizer-record" key={b.id}>
              <div>
                <strong>{new Date(b.createdAt).toLocaleString()}</strong>
                <small>
                  {b.reason} · {(b.bytes / 1048576).toFixed(2)} MiB
                </small>
              </div>
              {!window.toolbox?.mobileMode && (
                <div className="actions">
                  <button
                    onClick={() =>
                      void window
                        .toolbox!.exportBackup(b.id)
                        .catch(() => setError("Could not export backup."))
                    }
                  >
                    Export
                  </button>
                  <button
                    className="danger-button"
                    onClick={() =>
                      void window
                        .toolbox!.restoreBackup(b.id)
                        .catch(() =>
                          setError(
                            "Could not restore backup. Check storage permissions.",
                          ),
                        )
                    }
                  >
                    Restore
                  </button>
                </div>
              )}
            </article>
          ))}
          <Pagination value={backupPage} label="backup" />
        </section>
      )}
      {editor && (
        <OrganizerEditor
          editor={editor}
          state={state}
          scope={scope}
          busy={busy}
          error={error}
          onCancel={() => {
            if (!busy) setEditor(null);
          }}
          onSave={async (data) => {
            if (
              await act(() =>
                window.toolbox!.saveOrganizer({
                  id: editor.record?.id || null,
                  revision: editor.record?.revision || null,
                  kind: editor.kind,
                  data,
                }),
              )
            )
              setEditor(null);
          }}
        />
      )}
      {confirm && (
        <Confirm
          title={confirm.title}
          busy={busy}
          error={error}
          onCancel={() => {
            if (!busy) setConfirm(null);
          }}
          onConfirm={async () => {
            if (await act(confirm.action, "Change completed."))
              setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
function Confirm({
  title,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="expense-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2>{title}</h2>
      <p>
        This changes local Toolbox records. It does not reverse a marketplace
        sale, refund or email action.
      </p>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          disabled={busy}
          className="danger-button"
          onClick={() => void onConfirm()}
        >
          Confirm
        </button>
      </div>
    </dialog>
  );
}
function OrganizerEditor({
  editor,
  state,
  scope,
  busy,
  error,
  onCancel,
  onSave,
}: {
  editor: { kind: OrganizerKind; record?: OrganizerRecord };
  state: OrganizerState;
  scope: { itemId?: string; orderId?: string };
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSave: (data: Record<string, any>) => Promise<void>;
}) {
  const { kind, record } = editor;
  const ref = useRef<HTMLDialogElement>(null),
    [localError, setLocalError] = useState("");
  const [values, setValues] = useState<Record<string, any>>(() =>
    Object.fromEntries(
      fields[kind].map((f) => [
        f.key,
        record?.data[f.key] !== undefined
          ? f.type === "money" && record.data[f.key] !== null
            ? String(record.data[f.key] / 100)
            : (record.data[f.key] ?? "")
          : f.key === "collectionId"
            ? scope.itemId || ""
            : f.key === "orderId"
              ? scope.orderId || ""
              : f.type === "date" && !f.optional
                ? state.today
                : f.type === "quantity"
                  ? "1"
                  : f.type === "money" && !f.optional
                    ? "0"
                    : f.type === "checkbox"
                      ? false
                      : f.options?.[0] || "",
      ]),
    ),
  );
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  const update = (key: string, value: any) => {
    setValues((v) => ({
      ...v,
      [key]: value,
      ...(key === "targetType" ? { targetId: "" } : {}),
    }));
  };
  const options = (type: string) =>
    type === "order"
      ? state.orders.map((o) => ({
          id: o.id,
          name: `${o.name} · ${o.store} · ${o.date}`,
        }))
      : type === "collection"
        ? state.collection.map((i) => ({
            id: i.id,
            name: `${i.name} · ${i.printing || i.collectionType} · ${i.condition || "ungraded"}`,
          }))
        : state.records
            .filter((r) => r.kind === type)
            .map((r) => ({
              id: r.id,
              name:
                r.data.description || `${r.data.carrier} ${r.data.tracking}`,
            }));
  const upload = async (file: File) => {
    try {
      if (file.size > (file.type === "application/pdf" ? 2 : 15) * 1024 * 1024)
        throw Error("Choose a PDF under 2 MiB or a photo under 15 MiB.");
      if (
        !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(
          file.type,
        )
      )
        throw Error("Choose JPEG, PNG, WebP or PDF.");
      let data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (file.type.startsWith("image/")) {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = reject;
          image.src = data;
        });
        if (image.width * image.height > 16000000)
          throw Error("Choose an image under 16 megapixels.");
        const scale = Math.min(1, 1000 / Math.max(image.width, image.height)),
          canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas
          .getContext("2d")!
          .drawImage(image, 0, 0, canvas.width, canvas.height);
        data = canvas.toDataURL("image/jpeg", 0.75);
        if (data.length > 500000) throw Error("Choose a smaller photo.");
      }
      setValues((v) => ({ ...v, name: file.name, data }));
      setLocalError("");
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : "Could not read attachment.",
      );
    }
  };
  return (
    <dialog
      ref={ref}
      className="expense-dialog organizer-dialog"
      aria-label={`${record ? "Edit" : "Add"} ${kindLabels[kind]}`}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2>
        {record ? "Edit" : "Add"} {kindLabels[kind]}
      </h2>
      {(error || localError) && (
        <p className="alert" role="alert">
          {localError || error}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setLocalError("");
          try {
            const data: Record<string, any> = {};
            for (const f of fields[kind]) {
              const v = values[f.key];
              if (f.type === "money") {
                if (f.optional && v === "") data[f.key] = null;
                else {
                  const cents = amountToCents(String(v));
                  if (cents === null)
                    throw Error(
                      "Enter valid amounts with up to two decimal places.",
                    );
                  data[f.key] = cents;
                }
              } else if (f.type === "quantity") data[f.key] = Number(v);
              else if (f.type === "checkbox") data[f.key] = !!v;
              else if (
                (f.type === "date" ||
                  ["package", "url"].includes(f.type || "")) &&
                f.optional &&
                v === ""
              )
                data[f.key] = null;
              else data[f.key] = v;
            }
            await onSave(data);
          } catch (e) {
            setLocalError(
              e instanceof Error ? e.message : "Review these fields.",
            );
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="form-grid">
            {fields[kind].map((f) => (
              <label key={f.key}>
                {f.label}
                {f.optional ? " (optional)" : ""}
                {f.type === "textarea" ? (
                  <textarea
                    aria-label={f.label + (f.optional ? " (optional)" : "")}
                    value={values[f.key]}
                    maxLength={1000}
                    onChange={(e) => update(f.key, e.target.value)}
                  />
                ) : f.type === "checkbox" ? (
                  <input
                    aria-label={f.label + (f.optional ? " (optional)" : "")}
                    type="checkbox"
                    checked={!!values[f.key]}
                    onChange={(e) => update(f.key, e.target.checked)}
                  />
                ) : f.type === "file" ? (
                  <>
                    <input
                      aria-label={f.label + (f.optional ? " (optional)" : "")}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      onChange={(e) => {
                        if (e.target.files?.[0]) void upload(e.target.files[0]);
                      }}
                    />
                    {values.data && <small>Attachment ready</small>}
                  </>
                ) : f.type === "select" ? (
                  <select
                    aria-label={f.label + (f.optional ? " (optional)" : "")}
                    value={values[f.key]}
                    onChange={(e) => update(f.key, e.target.value)}
                  >
                    {f.options!.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : [
                    "order",
                    "collection",
                    "line",
                    "package",
                    "target",
                  ].includes(f.type || "") ? (
                  <select
                    aria-label={f.label + (f.optional ? " (optional)" : "")}
                    required={!f.optional}
                    value={values[f.key]}
                    onChange={(e) => update(f.key, e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {options(
                      f.type === "target" ? values.targetType : f.type!,
                    ).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={f.label + (f.optional ? " (optional)" : "")}
                    type={
                      f.type === "money" || f.type === "quantity"
                        ? "number"
                        : f.type === "date"
                          ? "date"
                          : f.type === "url"
                            ? "url"
                            : "text"
                    }
                    step={f.type === "money" ? "0.01" : "1"}
                    min={
                      f.type === "money"
                        ? "0"
                        : f.type === "quantity"
                          ? "1"
                          : undefined
                    }
                    maxLength={1000}
                    required={!f.optional}
                    value={values[f.key]}
                    onChange={(e) => update(f.key, e.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
          {kind === "wishlist" &&
            state.collection.some(
              (i) =>
                i.name.trim().toLowerCase() ===
                String(values.name).trim().toLowerCase(),
            ) && (
              <p className="notice">
                Possible owned item: compare the issue, variant, printing and
                condition before purchasing.
              </p>
            )}
        </fieldset>
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || (kind === "attachment" && !values.data)}
          >
            {busy ? "Saving…" : "Save record"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
