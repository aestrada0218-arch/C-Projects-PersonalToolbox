import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DollarSign,
  CalendarDays,
  Repeat,
  Receipt,
  Globe,
  Users,
  Package,
  ShoppingBag,
  CircleHelp,
  Plus,
  Search,
  Upload,
  Download,
  Trash2,
  Pencil,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  expenseCategories,
  intervalLabel,
  localToday,
  amountToCents,
  type Expense,
  type ExpenseInput,
  type ExpenseSchedule,
  type ExpenseState,
  type ExpenseResult,
  type ExpenseImportPreview,
  type ExpenseCategory,
} from "./expense-types";
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const icons = [Globe, Users, Package, ShoppingBag, CircleHelp];
const initial: ExpenseState = {
  entries: [],
  schedules: [],
  today: localToday(),
  totalCents: 0,
  monthCents: 0,
  monthlyRecurringCents: 0,
  catchUpRemaining: false,
};
type Modal =
  | { kind: "add" }
  | { kind: "edit"; entry: Expense }
  | { kind: "schedule"; schedule: ExpenseSchedule }
  | { kind: "delete"; entry: Expense }
  | { kind: "stop"; schedule: ExpenseSchedule }
  | { kind: "clear" }
  | { kind: "import"; preview: ExpenseImportPreview };
export default function ExpensesPanel() {
  const [state, setState] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<ExpenseCategory | "All">("All");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<Modal | null>(null);
  const [stopSeries, setStopSeries] = useState(true);
  const running = useRef(false);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (running.current) return;
      window.toolbox
        ?.expenseState()
        .then((data) => {
          if (alive && !running.current) {
            setState(data);
            setLoading(false);
          }
        })
        .catch(() => {
          if (alive) {
            setError(
              "Could not load expenses. Retry by opening this section again.",
            );
            setLoading(false);
          }
        });
    };
    load();
    const timer = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function action(fn: () => Promise<ExpenseResult>, message: string) {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fn();
      setState(r.state);
      if (!r.ok) {
        setError(r.error || "Could not save this change.");
        return false;
      }
      setNotice(
        r.added !== undefined
          ? `${r.added} expense entries imported; ${r.skipped || 0} existing records skipped.`
          : message,
      );
      setModal(null);
      return true;
    } catch {
      setError(
        "The expense service could not complete this request. Check storage permissions and retry.",
      );
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const open = (value: Modal) => {
    setError("");
    setModal(value);
  };
  const filtered = state.entries.filter(
    (e) =>
      (tab === "All" || e.category === tab) &&
      (e.description + " " + e.provider + " " + e.retailer)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const lastPage = Math.max(1, Math.ceil(filtered.length / 25));
  const current = Math.min(page, lastPage);
  const visible = filtered.slice((current - 1) * 25, current * 25);
  const activeSchedules = state.schedules.filter((s) => s.active);
  const shownSchedules = activeSchedules.filter(
    (s) =>
      (tab === "All" || s.category === tab) &&
      (s.description + " " + s.provider + " " + s.retailer)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const filteredTotal = filtered
    .filter((e) => e.date <= state.today)
    .reduce((n, e) => n + e.amountCents, 0);
  const previewImport = async () => {
    setError("");
    setBusy(true);
    running.current = true;
    try {
      const p = await window.toolbox!.previewExpenseImport();
      if (p.error) setError(p.error);
      else if (!p.cancelled) open({ kind: "import", preview: p });
    } catch {
      setError("Could not open the CSV file.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const exportCsv = async () => {
    setError("");
    setBusy(true);
    running.current = true;
    try {
      const result = await window.toolbox!.exportExpenses();
      if (result.error) setError(result.error);
      else if (result.ok)
        setNotice("All expense entries and recurring schedules exported.");
    } catch {
      setError("Could not export expenses.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="expenses-module">
      <div className="title-row expense-title">
        <div>
          <div className="eyebrow">EVERY COST, ACCOUNTED FOR</div>
          <h1>
            Expenses<span className="gold">.</span>
          </h1>
          <p>
            Where the money goes — proxies, cook groups, shipping, and your
            collection.
          </p>
        </div>
        <div className="expense-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void previewImport()}
          >
            <Upload size={14} />
            Import CSV
          </button>
          <button
            className="secondary"
            disabled={
              busy || (!state.entries.length && !state.schedules.length)
            }
            onClick={() => void exportCsv()}
          >
            <Download size={14} />
            Export CSV
          </button>
          <button
            className="expense-delete-all"
            disabled={
              busy || (!state.entries.length && !state.schedules.length)
            }
            onClick={() => open({ kind: "clear" })}
          >
            <Trash2 size={14} />
            Delete all
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => open({ kind: "add" })}
          >
            <Plus size={15} />
            Add expense
          </button>
        </div>
      </div>
      {error && !modal && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button
            aria-label="Dismiss expense notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <section className="stats expense-stats">
        {[
          {
            label: "Total spend",
            value: money(state.totalCents),
            Icon: DollarSign,
            tone: "gold",
            detail: "All categories · due through today",
          },
          {
            label: "This month",
            value: money(state.monthCents),
            Icon: CalendarDays,
            tone: "blue",
            detail: "Charges due this calendar month",
          },
          {
            label: "Recurring / mo",
            value: money(state.monthlyRecurringCents),
            Icon: Repeat,
            tone: "purple",
            detail: "Monthly equivalent of active schedules",
          },
          {
            label: "Entries",
            value: String(state.entries.length),
            Icon: Receipt,
            tone: "green",
            detail: `${activeSchedules.length} active recurring schedule${activeSchedules.length === 1 ? "" : "s"}`,
          },
        ].map(({ label, value, Icon, tone, detail }) => (
          <article
            className="panel expense-stat"
            key={label}
            aria-label={label}
          >
            <div>
              <span className={"expense-stat-icon " + tone}>
                <Icon size={17} />
              </span>
              <strong>{value}</strong>
            </div>
            <span>{label}</span>
            <small>{detail}</small>
          </article>
        ))}
      </section>
      <p className="expense-accounting-note">
        Recurring charges are recorded automatically when due and caught up
        after reopening. Future-dated entries are excluded from spending totals.
      </p>
      {state.catchUpRemaining && (
        <div className="notice">
          Recording overdue charges in batches. More charges will appear on the
          next automatic check.
        </div>
      )}
      <section className="panel expense-ledger">
        <div
          role="tablist"
          aria-label="Expense categories"
          className="expense-tabs"
        >
          {(["All", ...expenseCategories] as const).map((category, i) => {
            const Icon = i === 0 ? Receipt : icons[i - 1];
            const count =
              category === "All"
                ? state.entries.length
                : state.entries.filter((e) => e.category === category).length;
            return (
              <button
                role="tab"
                aria-selected={tab === category}
                tabIndex={tab === category ? 0 : -1}
                onKeyDown={(e) => {
                  const tabs = ["All", ...expenseCategories] as const;
                  let next = i;
                  if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
                  else if (e.key === "ArrowLeft")
                    next = (i + tabs.length - 1) % tabs.length;
                  else if (e.key === "Home") next = 0;
                  else if (e.key === "End") next = tabs.length - 1;
                  else return;
                  e.preventDefault();
                  setTab(tabs[next]);
                  setPage(1);
                  document.getElementById("expense-tab-" + next)?.focus();
                }}
                aria-controls="expense-ledger-table"
                id={"expense-tab-" + i}
                className={
                  (tab === category ? "selected " : "") +
                  "expense-category-" +
                  i
                }
                key={category}
                onClick={() => {
                  setTab(category);
                  setPage(1);
                }}
              >
                <Icon size={15} />
                {category}
                <span>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="table-toolbar">
          <label className="search expense-search">
            <Search size={15} />
            <input
              aria-label="Search expenses"
              placeholder="Search description / provider / retailer…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <span className="expense-filter-total">
            {filtered.length} entries <span>·</span>{" "}
            <b>{money(filteredTotal)}</b> spent
          </span>
        </div>
        <div
          id="expense-ledger-table"
          role="tabpanel"
          aria-labelledby={
            "expense-tab-" +
            (["All", ...expenseCategories] as readonly string[]).indexOf(tab)
          }
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>DESCRIPTION</th>
                  <th>PROVIDER / RETAILER</th>
                  <th>CATEGORY</th>
                  <th>DATE</th>
                  <th>RECURRENCE</th>
                  <th className="right">AMOUNT</th>
                  <th className="right">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => {
                  const schedule = state.schedules.find(
                    (s) => s.id === e.scheduleId,
                  );
                  return (
                    <tr key={e.id}>
                      <td className="expense-description">
                        {e.description}
                        {e.date > state.today && (
                          <small className="gold">
                            Scheduled · not yet included in spend
                          </small>
                        )}
                      </td>
                      <td>
                        {e.provider || "—"}
                        <small>{e.retailer || "No retailer"}</small>
                      </td>
                      <td>
                        <span
                          className={
                            "expense-category-label category-" +
                            expenseCategories.indexOf(e.category)
                          }
                        >
                          {e.category}
                        </span>
                      </td>
                      <td>
                        {new Date(e.date + "T12:00:00").toLocaleDateString()}
                      </td>
                      <td>
                        {e.intervalMonths ? (
                          <>
                            <span className="expense-repeat">
                              <Repeat size={12} />
                              {intervalLabel(e.intervalMonths)}
                            </span>
                            <small>
                              {schedule?.active
                                ? "Auto-recorded series"
                                : "Series stopped"}
                            </small>
                          </>
                        ) : (
                          <span className="muted">One-time</span>
                        )}
                      </td>
                      <td className="right total">{money(e.amountCents)}</td>
                      <td className="right">
                        <div className="expense-row-actions">
                          <button
                            aria-label={"Edit charge " + e.description}
                            title="Edit this charge"
                            disabled={busy}
                            onClick={() => open({ kind: "edit", entry: e })}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            aria-label={"Delete charge " + e.description}
                            title="Delete this charge"
                            disabled={busy}
                            onClick={() => {
                              setStopSeries(true);
                              open({ kind: "delete", entry: e });
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!visible.length && (
            <div className="expense-empty">
              {loading ? (
                <p>Loading expenses…</p>
              ) : (
                <>
                  <span>
                    <Receipt size={29} />
                  </span>
                  <h2>
                    {query
                      ? "No expenses match your search"
                      : tab === "All"
                        ? "A clearer picture starts here"
                        : `No ${tab.toLowerCase()} yet`}
                  </h2>
                  <p>
                    Add your first expense or import a CSV to start tracking
                    costs.
                  </p>
                  <button
                    className="primary"
                    onClick={() => open({ kind: "add" })}
                  >
                    <Plus size={14} />
                    Add expense
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="table-bottom">
          <span>
            Showing {filtered.length ? (current - 1) * 25 + 1 : 0}–
            {Math.min(current * 25, filtered.length)} of {filtered.length}{" "}
            entries · USD
          </span>
          <div className="expense-pagination">
            <button
              aria-label="Previous expense page"
              disabled={current <= 1}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              {current} / {lastPage}
            </span>
            <button
              aria-label="Next expense page"
              disabled={current >= lastPage}
              onClick={() => setPage(current + 1)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </section>
      {!!shownSchedules.length && (
        <section className="panel expense-schedules">
          <div className="panel-heading">
            <div>
              <h2>
                Recurring schedules{" "}
                <span className="count">{shownSchedules.length}</span>
              </h2>
              <p>
                Change future billing without rewriting previously recorded
                charges.
              </p>
            </div>
            <Repeat size={18} />
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>EXPENSE</th>
                  <th>PER BILLING PERIOD</th>
                  <th>NEXT CHARGE</th>
                  <th className="right">MANAGE</th>
                </tr>
              </thead>
              <tbody>
                {shownSchedules.map((s) => (
                  <tr key={s.id}>
                    <td className="expense-description">
                      {s.description}
                      <small>
                        {s.category} {s.provider && "· " + s.provider}
                      </small>
                    </td>
                    <td>
                      {money(s.amountCents)}
                      <small>{intervalLabel(s.intervalMonths)}</small>
                    </td>
                    <td>
                      {new Date(s.nextDue + "T12:00:00").toLocaleDateString()}
                    </td>
                    <td>
                      <div className="expense-schedule-actions">
                        <button
                          disabled={busy}
                          className="text-button"
                          onClick={() =>
                            open({ kind: "schedule", schedule: s })
                          }
                        >
                          <Pencil size={13} />
                          Edit schedule
                        </button>
                        <button
                          disabled={busy}
                          className="danger-button"
                          onClick={() => open({ kind: "stop", schedule: s })}
                        >
                          Stop repeats
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {modal && (
        <ExpenseDialog
          title={
            modal.kind === "add"
              ? "Add expense"
              : modal.kind === "edit"
                ? "Edit logged charge"
                : modal.kind === "schedule"
                  ? "Edit recurring schedule"
                  : modal.kind === "import"
                    ? "Review CSV import"
                    : modal.kind === "clear"
                      ? "Delete all expenses?"
                      : modal.kind === "stop"
                        ? "Stop future repeats?"
                        : "Delete this charge?"
          }
          busy={busy}
          onClose={() => setModal(null)}
        >
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          {modal.kind === "add" ||
          modal.kind === "edit" ||
          modal.kind === "schedule" ? (
            <ExpenseForm
              mode={modal.kind}
              initial={
                modal.kind === "edit"
                  ? modal.entry
                  : modal.kind === "schedule"
                    ? {
                        description: modal.schedule.description,
                        provider: modal.schedule.provider,
                        retailer: modal.schedule.retailer,
                        category: modal.schedule.category,
                        amountCents: modal.schedule.amountCents,
                        date:
                          modal.schedule.nextDue < state.today
                            ? state.today
                            : modal.schedule.nextDue,
                        intervalMonths: modal.schedule.intervalMonths,
                      }
                    : undefined
              }
              category={tab === "All" ? "Other Expenses" : tab}
              today={state.today}
              busy={busy}
              onCancel={() => setModal(null)}
              onSave={(input) =>
                modal.kind === "add"
                  ? action(
                      () => window.toolbox!.addExpense(input),
                      "Expense saved. Due recurring charges have been recorded.",
                    )
                  : modal.kind === "edit"
                    ? action(
                        () =>
                          window.toolbox!.editExpense({
                            id: modal.entry.id,
                            expense: input,
                          }),
                        "Logged charge updated.",
                      )
                    : action(
                        () =>
                          window.toolbox!.editExpenseSchedule({
                            id: modal.schedule.id,
                            schedule: {
                              ...input,
                              intervalMonths: input.intervalMonths as
                                1 | 3 | 6 | 12,
                            },
                          }),
                        "Future recurring schedule updated. Past charges are unchanged.",
                      )
              }
            />
          ) : (
            <>
              <p className="expense-confirm-copy">
                {modal.kind === "clear"
                  ? `Permanently remove all ${state.entries.length} expense entries and ${state.schedules.length} recurring schedules across every category? This cannot be undone in the app.`
                  : modal.kind === "stop"
                    ? `Stop future charges for “${modal.schedule.description}”? All previously recorded charges will remain.`
                    : modal.kind === "delete"
                      ? `Remove the ${money(modal.entry.amountCents)} charge for “${modal.entry.description}”? Other recorded charges in the series will remain.`
                      : `Import ${modal.preview.charges || 0} charge records and ${modal.preview.schedules || 0} schedule records? ${modal.preview.newRecurring || 0} new recurring series will also be created. Existing IDs are skipped. Past-due recurring charges will be caught up automatically.`}
              </p>
              {modal.kind === "delete" &&
                state.schedules.some(
                  (s) => s.id === modal.entry.scheduleId && s.active,
                ) && (
                  <label className="expense-checkbox">
                    <input
                      type="checkbox"
                      checked={stopSeries}
                      onChange={(e) => setStopSeries(e.target.checked)}
                    />
                    Also stop future repeats for this series
                  </label>
                )}
              <div className="modal-actions">
                <button disabled={busy} onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button
                  className={
                    modal.kind === "import"
                      ? "primary"
                      : "expense-danger-confirm"
                  }
                  disabled={busy}
                  onClick={() => {
                    if (modal.kind === "clear")
                      void action(
                        () => window.toolbox!.deleteAllExpenses(),
                        "All expenses and recurring schedules deleted.",
                      );
                    else if (modal.kind === "stop")
                      void action(
                        () =>
                          window.toolbox!.stopExpenseSchedule(
                            modal.schedule.id,
                          ),
                        "Future repeats stopped. Existing charges kept.",
                      );
                    else if (modal.kind === "delete")
                      void action(
                        () =>
                          window.toolbox!.deleteExpense({
                            id: modal.entry.id,
                            stopSeries,
                          }),
                        "Charge deleted.",
                      );
                    else
                      void action(
                        () =>
                          window.toolbox!.commitExpenseImport(
                            modal.preview.token!,
                          ),
                        "CSV imported.",
                      );
                  }}
                >
                  {busy
                    ? "Saving…"
                    : modal.kind === "import"
                      ? "Import expenses"
                      : modal.kind === "clear"
                        ? "Delete all expenses"
                        : modal.kind === "stop"
                          ? "Stop repeats"
                          : "Delete charge"}
                </button>
              </div>
            </>
          )}
        </ExpenseDialog>
      )}
    </div>
  );
}
function ExpenseDialog({
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
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      className="expense-dialog"
      ref={ref}
      aria-labelledby="expense-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="expense-dialog-heading">
        <h2 id="expense-dialog-title">{title}</h2>
        <button
          disabled={busy}
          aria-label="Close expense dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ExpenseForm({
  mode,
  initial,
  category,
  today,
  busy,
  onSave,
  onCancel,
}: {
  mode: "add" | "edit" | "schedule";
  initial?: ExpenseInput;
  category: ExpenseCategory;
  today: string;
  busy: boolean;
  onSave: (input: ExpenseInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [recurring, setRecurring] = useState(Boolean(initial?.intervalMonths));
  const [interval, setInterval] = useState<number>(
    initial?.intervalMonths || 1,
  );
  const [amount, setAmount] = useState(
    initial ? (initial.amountCents / 100).toFixed(2) : "",
  );
  const [formError, setFormError] = useState("");
  const cents = amountToCents(amount);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setFormError("");
        if (cents === null) {
          setFormError("Enter a valid amount with up to two decimal places.");
          return;
        }
        const f = new FormData(e.currentTarget);
        await onSave({
          description: String(f.get("description")),
          provider: String(f.get("provider") || ""),
          retailer: String(f.get("retailer") || ""),
          category: String(f.get("category")) as ExpenseCategory,
          amountCents: cents,
          date: String(f.get("date")),
          intervalMonths:
            mode === "edit"
              ? initial!.intervalMonths
              : recurring
                ? (interval as 1 | 3 | 6 | 12)
                : 0,
        });
      }}
    >
      <fieldset disabled={busy}>
        <label>
          Description
          <input
            autoFocus
            name="description"
            required
            maxLength={200}
            defaultValue={initial?.description}
            placeholder="e.g. Residential proxies – 5 GB"
          />
        </label>
        <div className="form-grid">
          <label>
            Provider
            <input
              name="provider"
              maxLength={100}
              defaultValue={initial?.provider}
              placeholder="e.g. Proxy provider"
            />
          </label>
          <label>
            Retailer
            <input
              name="retailer"
              maxLength={100}
              defaultValue={initial?.retailer}
              placeholder="Optional"
            />
          </label>
          <label>
            Category
            <select
              aria-label="Category"
              name="category"
              defaultValue={initial?.category || category}
            >
              {expenseCategories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Amount ($)
            <input
              name="amount"
              type="number"
              min="0"
              max="10000000"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label>
            {mode === "schedule" ? "Next billing date" : "Date"}
            <input
              name="date"
              type="date"
              min={mode === "schedule" ? today : "1900-01-01"}
              max="2199-12-31"
              defaultValue={initial?.date || today}
              required
            />
          </label>
          {mode !== "edit" && (
            <label className="expense-recurring-control">
              <span>Recurring</span>
              <div>
                <input
                  aria-label="Recurring"
                  role="switch"
                  type="checkbox"
                  checked={recurring}
                  disabled={mode === "schedule"}
                  onChange={(e) => setRecurring(e.target.checked)}
                />
                <span>Automatically record charges</span>
              </div>
            </label>
          )}
        </div>
        {mode !== "edit" && recurring && (
          <div className="expense-recurrence-box">
            <label>
              Repeat every
              <select
                aria-label="Repeat every"
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value))}
              >
                <option value="1">1 month</option>
                <option value="3">3 months</option>
                <option value="6">6 months</option>
                <option value="12">Yearly (12 months)</option>
              </select>
            </label>
            <p>
              {cents !== null ? money(cents) : "$0.00"} per billing period ·{" "}
              <b>
                {cents !== null ? money(Math.round(cents / interval)) : "$0.00"}
                /mo equivalent
              </b>
            </p>
            <p>
              {mode === "schedule"
                ? "Only future charges use these settings; existing charges stay unchanged."
                : "Charges are added on each due date. A past start date will also create any missed charges."}
            </p>
          </div>
        )}
        {mode === "edit" && (
          <p className="expense-form-note">
            This changes one logged charge only. Use “Edit schedule” to change
            future repeats.
          </p>
        )}
        {formError && (
          <p className="error" role="alert">
            {formError}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy
              ? "Saving…"
              : mode === "add"
                ? "Add expense"
                : mode === "schedule"
                  ? "Save schedule"
                  : "Save charge"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
