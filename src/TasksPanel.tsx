import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ListTodo,
  PackageCheck,
  Clock3,
  AlertTriangle,
  CheckCircle2,
  Mail,
  Search,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  X,
  Activity,
  Undo2,
} from "lucide-react";
import type {
  ShippingTask,
  ShippingTaskInput,
  ShippingState,
  ShippingResult,
  ShippingStatus,
} from "./shipping-types";
import { paymentStatuses, shippingStatuses } from "./shipping-types";
import EntryRunnerPanel from "./EntryRunnerPanel";
const taskSections = [
  ...shippingStatuses,
  "Entry Runner",
  "Automation",
] as const;
const initial: ShippingState = {
  items: [],
  monitor: {
    enabled: true,
    intervalHours: 3,
    lastAttempt: null,
    lastSuccess: null,
    nextRun: null,
    error: null,
    scanned: 0,
    skipped: 0,
    limited: false,
  },
  accountEmail: null,
  syncing: false,
  today: "",
};
const dateLabel = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const timeLabel = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not checked yet";
const editable = (task: ShippingTask): ShippingTaskInput => ({
  name: task.name,
  orderReference: task.orderReference,
  shipBy: task.shipBy,
  status: task.status,
  paymentStatus: task.paymentStatus,
  notes: task.notes,
});
type Modal =
  | { kind: "add" }
  | { kind: "edit"; item: ShippingTask }
  | { kind: "delete"; item: ShippingTask };
export default function TasksPanel({
  onOpenInbox,
  onChanged,
  samples,
}: {
  onOpenInbox: () => void;
  onChanged: () => void;
  samples: { id: string; name: string; status: string }[];
}) {
  const [state, setState] = useState(initial),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState("");
  const [tab, setTab] = useState<
      ShippingStatus | "Automation" | "Entry Runner"
    >("Needs Shipment"),
    [modal, setModal] = useState<Modal | null>(null),
    [page, setPage] = useState(1);
  const running = useRef(false),
    revision = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (running.current) return;
      const current = revision.current;
      try {
        const value = await window.toolbox!.shippingState();
        if (alive && current === revision.current) {
          setState(value);
          setLoading(false);
        }
      } catch {
        if (alive) {
          setError("Could not load shipping tasks. Reopen Tasks to retry.");
          setLoading(false);
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function action(fn: () => Promise<ShippingResult>, message: string) {
    if (running.current) return false;
    running.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      setState(result.state);
      if (!result.ok) {
        setError(result.error || "The task request failed.");
        return false;
      }
      setNotice(
        result.added !== undefined
          ? `Sales check complete. ${result.added} new shipping task${result.added === 1 ? "" : "s"} added.`
          : message,
      );
      setModal(null);
      onChanged();
      return true;
    } catch {
      setError(
        "Could not complete this request. Check the connection and try again.",
      );
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const disabled = busy || state.syncing;
  const pending = state.items.filter((i) => i.status === "Needs Shipment"),
    overdue = pending.filter((i) => i.shipBy && i.shipBy < state.today),
    today = pending.filter((i) => i.shipBy === state.today);
  const matching = state.items.filter(
    (i) =>
      i.status === tab &&
      [i.name, i.orderReference || "", i.notes]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(matching.length / 25)),
    current = Math.min(page, pages);
  const changeStatus = (item: ShippingTask, status: ShippingStatus) =>
    action(
      () =>
        window.toolbox!.editShippingTask({
          id: item.id,
          item: { ...editable(item), status },
        }),
      status === "Shipped"
        ? "Task marked shipped. No change was sent to eBay."
        : "Task returned to Needs Shipment.",
    );
  if (loading)
    return <div className="panel loading">Loading your shipping tasks…</div>;
  return (
    <div className="tasks-module">
      <div className="title-row">
        <div>
          <div className="eyebrow">YOUR NEXT MOVE</div>
          <h1>
            Tasks<span className="gold">.</span>
          </h1>
          <p>
            Turn sales into a clear shipping checklist. Keep every deadline in
            view.
          </p>
        </div>
        <div className="actions">
          <button
            className="secondary"
            disabled={disabled || !state.accountEmail}
            onClick={() => void action(() => window.toolbox!.checkSales(), "")}
          >
            <RefreshCw size={15} className={disabled ? "spinning" : ""} />
            {state.syncing ? "Checking inbox…" : "Check sales now"}
          </button>
          <button
            className="primary"
            disabled={disabled}
            onClick={() => setModal({ kind: "add" })}
          >
            <Plus size={16} />
            Add shipping task
          </button>
        </div>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button
            aria-label="Dismiss task notification"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {tab !== "Entry Runner" && (
        <>
          <section className="stats expense-stats shipping-stats">
            {[
              {
                label: "Needs Shipment",
                value: pending.length,
                icon: ListTodo,
                detail: "Open shipping tasks",
              },
              {
                label: "Due today",
                value: today.length,
                icon: Clock3,
                detail: "Ship-by date is today",
              },
              {
                label: "Overdue",
                value: overdue.length,
                icon: AlertTriangle,
                detail: "Past the recorded ship-by date",
              },
              {
                label: "Shipped",
                value: state.items.filter((i) => i.status === "Shipped").length,
                icon: PackageCheck,
                detail: "Completed in Personal Toolbox",
              },
            ].map(({ label, value, icon: Icon, detail }) => (
              <article className="stat panel" key={label} aria-label={label}>
                <div className="stat-top">
                  {label}
                  <Icon size={18} />
                </div>
                <strong
                  className={
                    label === "Overdue" && value ? "shipping-overdue-text" : ""
                  }
                >
                  {value}
                </strong>
                <div className="stat-detail">{detail}</div>
              </article>
            ))}
          </section>
          <section
            className="panel shipping-monitor"
            aria-label="eBay sales monitor"
          >
            <div className="shipping-monitor-heading">
              <span className="shipping-mail-icon">
                <Mail size={22} />
              </span>
              <div>
                <h2>eBay sales monitor</h2>
                <p>
                  {state.accountEmail
                    ? `Connected Gmail: ${state.accountEmail}`
                    : "Connect Gmail in Inbox to turn sale emails into tasks."}
                </p>
              </div>
              <span
                className={
                  state.accountEmail && state.monitor.enabled
                    ? "badge delivered"
                    : "badge processing"
                }
              >
                {!state.accountEmail
                  ? "Gmail required"
                  : state.monitor.enabled
                    ? "Automatic checks on"
                    : "Automatic checks paused"}
              </span>
            </div>
            <div className="shipping-monitor-controls">
              <label className="shipping-check-label">
                <input
                  type="checkbox"
                  aria-label="Automatically check eBay sales"
                  checked={state.monitor.enabled}
                  disabled={disabled}
                  onChange={(e) => {
                    if (running.current) return;
                    const enabled = e.target.checked;
                    setState((s) => ({
                      ...s,
                      monitor: { ...s.monitor, enabled },
                    }));
                    void action(
                      () =>
                        window.toolbox!.setShippingMonitor({
                          enabled,
                          intervalHours: state.monitor.intervalHours,
                        }),
                      "Sales monitoring preference saved.",
                    );
                  }}
                />
                Check while the app is open
              </label>
              <label>
                Check every{" "}
                <select
                  aria-label="Sales check interval"
                  value={state.monitor.intervalHours}
                  disabled={disabled}
                  onChange={(e) =>
                    void action(
                      () =>
                        window.toolbox!.setShippingMonitor({
                          enabled: state.monitor.enabled,
                          intervalHours: Number(e.target.value) as
                            2 | 3 | 6 | 12,
                        }),
                      "Sales check interval saved.",
                    )
                  }
                >
                  {[2, 3, 6, 12].map((h) => (
                    <option key={h} value={h}>
                      {h} hours
                    </option>
                  ))}
                </select>
              </label>
              <button className="text-button" onClick={onOpenInbox}>
                <Mail size={13} />
                {state.accountEmail
                  ? "Manage Gmail connection"
                  : "Connect Gmail in Inbox"}
              </button>
            </div>
            <div className="shipping-monitor-details">
              <span>
                Last successful check: {timeLabel(state.monitor.lastSuccess)}
              </span>
              <span>
                Next:{" "}
                {!state.accountEmail
                  ? "Connect Gmail"
                  : !state.monitor.enabled
                    ? "Paused"
                    : state.monitor.nextRun
                      ? timeLabel(state.monitor.nextRun)
                      : "When connected / app opens"}
              </span>
            </div>
            <p className="shipping-help">
              Checks read Gmail’s INBOX, including already-read messages. The
              first scan covers up to 90 days, then continues from the last
              processed message. Checks resume when the app reopens. Sale tasks
              are local reminders; marking shipped does not update eBay.
            </p>
            {state.monitor.lastSuccess && (
              <p className="shipping-scan-count">
                Last batch: {state.monitor.scanned} emails checked ·{" "}
                {state.monitor.skipped} skipped
              </p>
            )}
            {state.monitor.error && (
              <div className="alert" role="alert">
                Sales check failed: {state.monitor.error} Your existing tasks
                were kept.
              </div>
            )}
            {state.monitor.limited && (
              <p className="shipping-review-note">
                More matching emails remain. Catch-up checks process 100
                messages at a time, about one minute apart while monitoring is
                on.
              </p>
            )}
            {state.monitor.skipped > 0 && (
              <p className="shipping-review-note">
                Some emails were missing, too large, or could not be parsed.
                Review those sales in eBay and add a task manually if needed.
              </p>
            )}
          </section>
        </>
      )}
      <div
        className="collection-tabs shipping-tabs"
        role="tablist"
        aria-label="Task sections"
      >
        {taskSections.map((name, index) => (
          <button
            role="tab"
            id={`shipping-tab-${index}`}
            aria-controls="shipping-task-panel"
            aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1}
            key={name}
            onClick={() => {
              setTab(name);
              setPage(1);
            }}
            onKeyDown={(e) => {
              const tabs = taskSections;
              if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const n =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? tabs.length - 1
                    : (index +
                        (e.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              setTab(tabs[n]);
              setPage(1);
              document.getElementById(`shipping-tab-${n}`)?.focus();
            }}
          >
            {name === "Needs Shipment" ? (
              <ListTodo size={15} />
            ) : name === "Shipped" ? (
              <PackageCheck size={15} />
            ) : name === "Automation" || name === "Entry Runner" ? (
              <Activity size={15} />
            ) : (
              <X size={15} />
            )}{" "}
            {name}
            <span>
              {name === "Entry Runner"
                ? "New"
                : name === "Automation"
                  ? samples.length
                  : state.items.filter((i) => i.status === name).length}
            </span>
          </button>
        ))}
      </div>
      <section
        id="shipping-task-panel"
        className={
          tab === "Entry Runner" ? "entry-module" : "panel shipping-list"
        }
        role="tabpanel"
        aria-labelledby={`shipping-tab-${taskSections.indexOf(tab)}`}
      >
        {tab === "Entry Runner" ? (
          <EntryRunnerPanel onOpenInbox={onOpenInbox} />
        ) : tab === "Automation" ? (
          <div className="shipping-automation">
            <h2>Monitoring & automation</h2>
            <p>
              General automation controls are planned for a later stage. These
              sample jobs do not run. The eBay sales monitor above is active
              independently.
            </p>
            {samples.map((t) => (
              <div key={t.id}>
                <Activity size={15} />
                <span>{t.name}</span>
                <span className="badge processing">{t.status} · Sample</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="panel-heading">
              <div>
                <h2>
                  {tab} <span className="count">{matching.length}</span>
                </h2>
                <p>
                  {tab === "Needs Shipment"
                    ? "Confirm the sale in eBay, pack the item, and mark it shipped when done."
                    : tab === "Shipped"
                      ? "Completed tasks stay here so another inbox check will not recreate them."
                      : "Cancelled tasks remain recorded. You can edit, reopen, or delete them."}
                </p>
              </div>
            </div>
            <div className="table-toolbar">
              <label className="search">
                <Search size={15} />
                <input
                  aria-label="Search shipping tasks"
                  placeholder="Search item, order number, or notes…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <span className="shipping-table-note">
                Ship-by dates use your local calendar
              </span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>ITEM / ORDER</th>
                    <th>SHIP BY</th>
                    <th>PAYMENT</th>
                    <th>SOURCE</th>
                    <th className="right">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {matching
                    .slice((current - 1) * 25, current * 25)
                    .map((item) => (
                      <tr key={item.id}>
                        <td className="shipping-name">
                          <strong>{item.name}</strong>
                          <small>
                            {item.orderReference
                              ? `Order ${item.orderReference}`
                              : "Order number not found — review sale"}
                          </small>
                          {item.notes && (
                            <small className="shipping-task-notes">
                              {item.notes}
                            </small>
                          )}
                        </td>
                        <td>
                          <DueDate item={item} today={state.today} />
                        </td>
                        <td>
                          <span
                            className={`badge ${item.paymentStatus === "Paid" ? "delivered" : "processing"}`}
                            title="Payment status recorded from the email or your edit"
                          >
                            {item.paymentStatus}
                          </span>
                          {item.paymentStatus !== "Paid" && (
                            <small className="shipping-review-note">
                              Confirm payment before shipping
                            </small>
                          )}
                        </td>
                        <td>
                          <span className="shipping-source">
                            {item.source === "ebay-email"
                              ? "eBay email"
                              : "Manual task"}
                          </span>
                          <small title={item.sourceSubject || undefined}>
                            {timeLabel(item.received)}
                          </small>
                          {item.editedAt && <small>Edited locally</small>}
                        </td>
                        <td>
                          <div className="shipping-row-actions">
                            {item.status === "Needs Shipment" ? (
                              <button
                                className="shipping-complete"
                                aria-label={`Mark shipped ${item.name}`}
                                disabled={disabled}
                                onClick={() =>
                                  void changeStatus(item, "Shipped")
                                }
                              >
                                <CheckCircle2 size={15} />
                                Mark shipped
                              </button>
                            ) : (
                              <button
                                className="text-button"
                                aria-label={`Reopen task ${item.name}`}
                                disabled={disabled}
                                onClick={() =>
                                  void changeStatus(item, "Needs Shipment")
                                }
                              >
                                <Undo2 size={15} />
                                Reopen
                              </button>
                            )}
                            <button
                              className="text-button"
                              aria-label={`Edit shipping task ${item.name}`}
                              disabled={disabled}
                              onClick={() => setModal({ kind: "edit", item })}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              className="text-button"
                              aria-label={`Delete shipping task ${item.name}`}
                              disabled={disabled}
                              onClick={() => setModal({ kind: "delete", item })}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!matching.length && (
              <div className="empty shipping-empty">
                <PackageCheck size={30} />
                <h3>
                  {query
                    ? "No tasks match your search"
                    : tab === "Needs Shipment"
                      ? "Your shipping queue is clear"
                      : "No tasks here yet"}
                </h3>
                <p>
                  {query
                    ? "Try an item name or order number."
                    : tab === "Needs Shipment"
                      ? "New eBay sale emails will appear here after a successful sales check. You can also add a task yourself."
                      : "Tasks you update will appear in this section."}
                </p>
              </div>
            )}
            <div className="table-bottom">
              <span>{matching.length} tasks · Saved on your device</span>
              <div className="expense-pagination">
                <button
                  disabled={current === 1}
                  onClick={() => setPage(current - 1)}
                >
                  Previous
                </button>
                <span>
                  {current} / {pages}
                </span>
                <button
                  disabled={current >= pages}
                  onClick={() => setPage(current + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      {modal && (
        <TaskDialog
          title={
            modal.kind === "delete"
              ? "Delete shipping task"
              : modal.kind === "edit"
                ? "Edit shipping task"
                : "Add shipping task"
          }
          busy={disabled}
          onClose={() => setModal(null)}
        >
          {modal.kind === "delete" ? (
            <>
              <p className="collection-form-note">
                Delete “{modal.item.name}”? Its eBay email and order identifiers
                will remain marked as handled, so another scan will not recreate
                this task.
              </p>
              <div className="modal-actions">
                <button disabled={disabled} onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button
                  className="danger-button"
                  disabled={disabled}
                  onClick={() =>
                    void action(
                      () => window.toolbox!.deleteShippingTask(modal.item.id),
                      "Shipping task deleted. Repeated sales checks will not recreate it.",
                    )
                  }
                >
                  Delete task
                </button>
              </div>
            </>
          ) : (
            <TaskForm
              item={modal.kind === "edit" ? modal.item : undefined}
              busy={disabled}
              onCancel={() => setModal(null)}
              onSave={async (item) => {
                const saved = await (modal.kind === "edit"
                  ? action(
                      () =>
                        window.toolbox!.editShippingTask({
                          id: modal.item.id,
                          item,
                        }),
                      "Shipping task updated.",
                    )
                  : action(
                      () => window.toolbox!.addShippingTask(item),
                      "Shipping task added.",
                    ));
                if (saved) {
                  setTab(item.status);
                  setPage(1);
                }
                return saved;
              }}
            />
          )}
        </TaskDialog>
      )}
    </div>
  );
}
function DueDate({ item, today }: { item: ShippingTask; today: string }) {
  if (!item.shipBy)
    return (
      <span className="shipping-date-missing">
        <AlertTriangle size={13} />
        Date missing — review eBay
      </span>
    );
  const overdue = item.status === "Needs Shipment" && item.shipBy < today;
  return (
    <span
      className={`shipping-due ${overdue ? "shipping-due-overdue" : item.shipBy === today && item.status === "Needs Shipment" ? "shipping-due-today" : ""}`}
    >
      <strong>{dateLabel(item.shipBy)}</strong>
      {item.status === "Needs Shipment" && (
        <small>
          {overdue
            ? "Overdue"
            : item.shipBy === today
              ? "Due today"
              : "Upcoming"}
        </small>
      )}
    </span>
  );
}
function TaskDialog({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current!.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="expense-dialog shipping-dialog"
      aria-labelledby="shipping-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="expense-dialog-heading">
        <h2 id="shipping-dialog-title">{title}</h2>
        <button
          aria-label="Close shipping dialog"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function TaskForm({
  item,
  busy,
  onCancel,
  onSave,
}: {
  item?: ShippingTask;
  busy: boolean;
  onCancel: () => void;
  onSave: (item: ShippingTaskInput) => Promise<boolean>;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        void onSave({
          name: String(data.get("name")),
          orderReference:
            String(data.get("orderReference") || "").trim() || null,
          shipBy: String(data.get("shipBy") || "") || null,
          status: String(data.get("status")) as ShippingStatus,
          paymentStatus: String(
            data.get("paymentStatus"),
          ) as ShippingTaskInput["paymentStatus"],
          notes: String(data.get("notes") || ""),
        });
      }}
    >
      <fieldset disabled={busy}>
        <label>
          Item / task name
          <input
            name="name"
            autoFocus
            required
            maxLength={240}
            defaultValue={item?.name || ""}
          />
        </label>
        <div className="form-grid">
          <label>
            eBay order number
            <input
              name="orderReference"
              maxLength={80}
              placeholder="Optional"
              defaultValue={item?.orderReference || ""}
            />
          </label>
          <label>
            Ship-by date
            <input
              name="shipBy"
              type="date"
              min="1900-01-01"
              max="2199-12-31"
              defaultValue={item?.shipBy || ""}
            />
          </label>
          <label>
            Task status
            <select
              name="status"
              aria-label="Task status"
              defaultValue={item?.status || "Needs Shipment"}
            >
              {shippingStatuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Payment status
            <select
              name="paymentStatus"
              aria-label="Payment status"
              defaultValue={item?.paymentStatus || "Needs review"}
            >
              {paymentStatuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Notes
          <textarea
            name="notes"
            rows={3}
            maxLength={2000}
            defaultValue={item?.notes || ""}
            placeholder="Packing notes or reason for cancellation"
          />
        </label>
        <p className="collection-form-note">
          Leave the date blank if it is unknown. Your edits, completion, or
          deletion will be kept when the same sale is scanned again. Changes
          stay in this app.
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary">
            {busy ? "Saving…" : item ? "Save shipping task" : "Add task"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
