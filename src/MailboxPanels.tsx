import { Pagination, usePagination } from "./pagination";
import { listenForDataChanges } from "./data-changes";
import { operationError } from "./operation-error";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Mail,
  Plus,
  RefreshCw,
  PackageCheck,
  Trash2,
  X,
  ShieldCheck,
} from "lucide-react";
import type {
  MailboxState,
  MailboxResult,
  MailboxAccount,
  OutstandingLine,
} from "./mailbox-types";
const initial: MailboxState = {
  accounts: [],
  outstanding: [],
  busy: false,
  supported: true,
};
const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
function useMailboxes() {
  const [state, setState] = useState(initial),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    revision = useRef(0),
    acting = useRef(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (acting.current || !window.toolbox?.mailboxState) return;
      const rev = revision.current;
      try {
        const s = await window.toolbox.mailboxState();
        if (alive && rev === revision.current) setState(s);
      } catch {
        if (alive) setError("Could not load inbox and purchase data.");
      }
    };
    void load();
    const unsubscribeChanges = listenForDataChanges(() => void load());
    const timer = setInterval(() => void load(), 3000);
    return () => {
      alive = false;
      clearInterval(timer);
      unsubscribeChanges();
    };
  }, []);
  async function action(fn: () => Promise<MailboxResult>, message: string) {
    if (acting.current) return false;
    acting.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fn();
      setState(r.state);
      if (!r.ok) {
        setError(r.error || "Operation failed.");
        return false;
      }
      setNotice(message);
      return true;
    } catch (error) {
      setError(
        operationError(
          error,
          "Could not complete the request. Check the desktop connection and retry.",
        ),
      );
      return false;
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }
  return { state, error, notice, busy: busy || state.busy, action };
}
function Dialog({
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
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="expense-dialog mail-dialog"
      aria-labelledby="mail-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="expense-dialog-heading">
        <h2 id="mail-dialog-title">{title}</h2>
        <button
          disabled={busy}
          aria-label="Close mailbox dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function MailboxManager() {
  const { state, error, notice, busy, action } = useMailboxes(),
    [open, setOpen] = useState(false),
    [remove, setRemove] = useState<MailboxAccount | null>(null),
    [password, setPassword] = useState(""),
    [provider, setProvider] = useState("gmail");
  if (!window.toolbox?.mailboxState) return null;
  return (
    <section className="panel mailbox-manager">
      <div className="panel-heading">
        <div>
          <h2>
            <Mail size={17} /> Connected inboxes
          </h2>
          <p>
            Add Gmail or other IMAP accounts. Every account has separate
            credentials and scan progress.
          </p>
        </div>
        <div className="actions">
          <button
            disabled={busy || !state.accounts.length}
            onClick={() =>
              void action(
                () => window.toolbox!.scanMailboxes(),
                "Inbox and PayPal scans finished. Larger histories continue in batches.",
              )
            }
          >
            <RefreshCw size={14} />
            Scan all inboxes
          </button>
          <button
            className="primary"
            disabled={busy || !state.supported}
            onClick={() => {
              setPassword("");
              setOpen(true);
            }}
          >
            <Plus size={14} />
            Add IMAP inbox
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
        </div>
      )}
      {!state.supported && (
        <p className="mail-note">
          Adding credentials requires Windows Credential Manager.
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>INBOX</th>
              <th>IMAP / FOLDER</th>
              <th>RECEIPT SCAN</th>
              <th>CONTROLS</th>
            </tr>
          </thead>
          <tbody>
            {state.accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.label}</strong>
                  <small>{a.email}</small>
                </td>
                <td>
                  {a.host}:{a.port}
                  <small>{a.folder}</small>
                </td>
                <td>
                  {a.lastSync
                    ? new Date(a.lastSync).toLocaleString()
                    : "Not scanned yet"}
                  <small>
                    {a.scanned} checked · {a.skipped} unmatched / unsupported
                    {a.limited ? " · More history remains" : ""}
                  </small>
                  {a.error && <small className="error">{a.error}</small>}
                </td>
                <td>
                  <div className="actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(
                          () => window.toolbox!.scanMailboxes(a.id),
                          "Mailbox scan finished.",
                        )
                      }
                      aria-label={"Scan inbox " + a.label}
                    >
                      Scan
                    </button>
                    {a.legacy ? (
                      <span className="mail-note">
                        Auto-check uses the primary Gmail switch
                      </span>
                    ) : (
                      <>
                        <label className="mail-toggle">
                          <input
                            type="checkbox"
                            checked={a.enabled}
                            disabled={busy}
                            aria-label={"Monitor " + a.label}
                            onChange={(e) =>
                              void action(
                                () =>
                                  window.toolbox!.setMailboxEnabled({
                                    id: a.id,
                                    enabled: e.target.checked,
                                  }),
                                "Monitoring preference saved.",
                              )
                            }
                          />
                          Monitor
                        </label>
                        <button
                          className="text-button danger-button"
                          disabled={busy}
                          aria-label={"Remove inbox " + a.label}
                          onClick={() => setRemove(a)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!state.accounts.length && (
        <p className="empty">
          Connect the primary Gmail account above or add an IMAP inbox.
        </p>
      )}
      <p className="mail-note">
        <ShieldCheck size={13} /> Verified TLS · read-only mail access ·
        credentials in Windows Credential Manager. Enabled inboxes check every
        10 minutes while the app is open. The PayPal scanner searches the last
        365 days; receipt data is retained after disconnect.
      </p>
      {open && (
        <Dialog
          title="Add IMAP inbox"
          busy={busy}
          onClose={() => {
            setOpen(false);
            setPassword("");
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget),
                secret = password;
              setPassword("");
              void action(
                () =>
                  window.toolbox!.connectMailbox({
                    label: String(d.get("label")),
                    email: String(d.get("email")),
                    host:
                      provider === "gmail"
                        ? "imap.gmail.com"
                        : String(d.get("host")),
                    port: provider === "gmail" ? 993 : Number(d.get("port")),
                    folder: String(d.get("folder")),
                    password:
                      provider === "gmail" ? secret.replace(/\s/g, "") : secret,
                  }),
                "Inbox connected. Initial monitoring scan is starting.",
              ).then((ok) => {
                if (ok) setOpen(false);
              });
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Provider
                <select
                  aria-label="IMAP provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="gmail">Gmail</option>
                  <option value="custom">Other IMAP (TLS)</option>
                </select>
              </label>
              <label>
                Inbox label
                <input
                  name="label"
                  required
                  maxLength={80}
                  placeholder="Personal / Family / Orders"
                />
              </label>
              <label>
                Email address
                <input name="email" type="email" required maxLength={254} />
              </label>
              {provider === "custom" && (
                <div className="form-grid">
                  <label>
                    IMAP hostname
                    <input
                      name="host"
                      required
                      maxLength={253}
                      placeholder="imap.example.com"
                    />
                  </label>
                  <label>
                    TLS port
                    <input
                      name="port"
                      type="number"
                      required
                      min={1}
                      max={65535}
                      defaultValue={993}
                    />
                  </label>
                </div>
              )}
              <label>
                Mailbox folder
                <input
                  key={provider}
                  name="folder"
                  required
                  maxLength={200}
                  defaultValue={
                    provider === "gmail" ? "[Gmail]/All Mail" : "INBOX"
                  }
                />
              </label>
              <label>
                {provider === "gmail"
                  ? "Google app password"
                  : "IMAP app password / password"}
                <input
                  aria-label="IMAP password"
                  type="password"
                  autoComplete="off"
                  required
                  maxLength={512}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <p className="mail-note">
                Gmail needs a Google app password with two-step verification.
                Other providers must allow password-based IMAP over verified
                TLS. OAuth-only providers need a future provider adapter. No
                account-count limit is imposed. Scans run sequentially to avoid
                connection overload.
              </p>
              {error && (
                <div className="alert" role="alert">
                  {error}
                </div>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setPassword("");
                  }}
                >
                  Cancel
                </button>
                <button className="primary">Verify and connect inbox</button>
              </div>
            </fieldset>
          </form>
        </Dialog>
      )}
      {remove && (
        <Dialog
          title="Remove IMAP inbox?"
          busy={busy}
          onClose={() => setRemove(null)}
        >
          <p>{remove.email}</p>
          <p>
            This stops monitoring and removes its saved credential. Imported
            purchases and shipment updates remain.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="modal-actions">
            <button disabled={busy} onClick={() => setRemove(null)}>
              Cancel
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={() =>
                void action(
                  () => window.toolbox!.disconnectMailbox(remove.id),
                  "Inbox disconnected; imported data retained.",
                ).then((ok) => {
                  if (ok) setRemove(null);
                })
              }
            >
              Remove inbox
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
export function OutstandingOrders({ onReceived }: { onReceived: () => void }) {
  const { state, error, notice, busy, action } = useMailboxes(),
    [query, setQuery] = useState(""),
    [showReceived, setShowReceived] = useState(false),
    [selected, setSelected] = useState<OutstandingLine | null>(null),
    requestId = useRef("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{
    kind: "date" | "delete";
    ids: string[];
    date?: string;
  } | null>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const items = state.outstanding.filter(
    (l) =>
      l.kind === "item" &&
      (showReceived || l.receivedQty < l.quantity) &&
      [l.description, l.transactionId, l.purchaseDate]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pagination = usePagination(
    items,
    JSON.stringify([query, showReceived]),
  );
  const selectedIds = items.filter((l) => checked.has(l.id)).map((l) => l.id);
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate =
        selectedIds.length > 0 && selectedIds.length < items.length;
  }, [selectedIds.length, items.length]);
  const openDate = (ids: string[]) => {
    window.toolbox?.captureEdit?.(items.filter((l) => ids.includes(l.id)));
    const values = new Set(
      items.filter((l) => ids.includes(l.id)).map((l) => l.expectedDate || ""),
    );
    setEdit({
      kind: "date",
      ids,
      date: values.size === 1 ? [...values][0] : "",
    });
  };
  return (
    <section className="panel outstanding-orders">
      <div className="panel-heading">
        <div>
          <h2>
            Outstanding orders{" "}
            <span className="count">
              {
                state.outstanding.filter(
                  (l) => l.kind === "item" && l.receivedQty < l.quantity,
                ).length
              }
            </span>
          </h2>
          <p>
            Minky’s Designs · PayPal receipts · awaiting your receipt
            confirmation
          </p>
        </div>
        <button
          className="primary"
          disabled={busy || !state.accounts.length}
          onClick={() =>
            void action(
              () => window.toolbox!.scanOutstanding(),
              "Receipt scan finished. More history is processed in subsequent batches.",
            )
          }
        >
          <RefreshCw size={14} />
          {busy ? "Scanning inboxes…" : "Scan last 365 days"}
        </button>
      </div>
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
      <p className="mail-note">
        Matches service@paypal.com and Payment to Minky’s Designs /
        Minkysdesigns@gmail.com. Purchase date, line amounts and transaction
        references are retained. Email alone does not confirm shipping status;
        received items move only when you confirm arrival. FOC shipping and
        other shipping-charge lines are excluded.
      </p>
      <div className="table-toolbar">
        <label className="search">
          <input
            aria-label="Search outstanding orders"
            placeholder="Description, transaction or date…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setChecked(new Set());
            }}
          />
        </label>
        <label className="mail-toggle">
          <input
            type="checkbox"
            checked={showReceived}
            onChange={(e) => {
              setShowReceived(e.target.checked);
              setChecked(new Set());
            }}
          />
          Include received items
        </label>
      </div>
      <div
        className="outstanding-bulk"
        aria-label="Outstanding order bulk actions"
      >
        <span>{selectedIds.length} selected</span>
        <button
          disabled={busy || !selectedIds.length}
          onClick={() => openDate(selectedIds)}
        >
          Set expected date
        </button>
        <button
          className="danger-button"
          disabled={busy || !selectedIds.length}
          onClick={() => {
            window.toolbox?.captureEdit?.(
              items.filter((l) => selectedIds.includes(l.id)),
            );
            setEdit({ kind: "delete", ids: selectedIds });
          }}
        >
          <Trash2 size={14} />
          Delete selected
        </button>
        {selectedIds.length > 0 && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setChecked(new Set())}
          >
            Clear selection
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  ref={selectAll}
                  type="checkbox"
                  aria-label="Select all matching outstanding lines"
                  disabled={busy || !items.length}
                  checked={
                    items.length > 0 && selectedIds.length === items.length
                  }
                  onChange={(e) =>
                    setChecked(
                      new Set(e.target.checked ? items.map((l) => l.id) : []),
                    )
                  }
                />
              </th>
              <th>DESCRIPTION / TRANSACTION</th>
              <th>PURCHASED</th>
              <th>EXPECTED ARRIVAL</th>
              <th>UNIT PRICE</th>
              <th>QTY</th>
              <th>AMOUNT</th>
              <th>RECEIVED</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {pagination.visible.map((l) => (
              <tr
                key={l.id}
                className={
                  checked.has(l.id) ? "outstanding-selected" : undefined
                }
              >
                <td>
                  <input
                    type="checkbox"
                    aria-label={
                      "Select " + l.description + " line " + (l.line + 1)
                    }
                    disabled={busy}
                    checked={checked.has(l.id)}
                    onChange={(e) => {
                      const next = new Set(checked);
                      if (e.target.checked) next.add(l.id);
                      else next.delete(l.id);
                      setChecked(next);
                    }}
                  />
                </td>
                <td>
                  <strong>{l.description}</strong>
                  <small>
                    {l.transactionId} · Line {l.line + 1}
                    {l.kind === "shipping" ? " · Shipping charge" : ""}
                  </small>
                </td>
                <td>{l.purchaseDate}</td>
                <td>
                  <button
                    className="text-button"
                    disabled={busy}
                    aria-label={
                      "Expected arrival for " +
                      l.description +
                      " line " +
                      (l.line + 1)
                    }
                    onClick={() => openDate([l.id])}
                  >
                    {l.expectedDate || "Set date"}
                  </button>
                </td>
                <td>{money(l.unitCents)}</td>
                <td>{l.quantity}</td>
                <td>{money(l.amountCents)}</td>
                <td>
                  {l.kind === "shipping"
                    ? "—"
                    : `${l.receivedQty} / ${l.quantity}`}
                </td>
                <td>
                  <div className="outstanding-row-actions">
                    {l.kind === "item" && l.receivedQty < l.quantity ? (
                      <button
                        disabled={busy}
                        aria-label={
                          "Receive " + l.description + " line " + (l.line + 1)
                        }
                        onClick={() => {
                          requestId.current = crypto.randomUUID();
                          setSelected(l);
                        }}
                      >
                        <PackageCheck size={14} />
                        Receive / move
                      </button>
                    ) : (
                      <span>
                        {l.kind === "shipping"
                          ? "Excluded from collection"
                          : "Received"}
                      </span>
                    )}
                    <button
                      className="text-button danger-button"
                      disabled={busy}
                      aria-label={
                        "Delete outstanding " +
                        l.description +
                        " line " +
                        (l.line + 1)
                      }
                      onClick={() => {
                        window.toolbox?.captureEdit?.(l);
                        setEdit({ kind: "delete", ids: [l.id] });
                      }}
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
      {!items.length && (
        <div className="empty">
          <PackageCheck size={28} />
          <h3>
            {state.accounts.length
              ? "No outstanding items to show"
              : "Connect Gmail or an IMAP inbox in Inbox first"}
          </h3>
          <p>
            Scan your receipt history to import matching purchases. Rescanning
            will not duplicate received items.
          </p>
        </div>
      )}
      <div className="table-bottom">
        <Pagination value={pagination} label="outstanding" />
      </div>
      {selected && (
        <Dialog
          title="Receive items into collection"
          busy={busy}
          onClose={() => setSelected(null)}
        >
          <p>{selected.description}</p>
          <p>
            Purchased {selected.purchaseDate} · {money(selected.unitCents)} per
            item. Market value starts unknown.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void action(
                () =>
                  window.toolbox!.receiveOutstanding({
                    requestId: requestId.current,
                    id: selected.id,
                    quantity: Number(d.get("quantity")),
                    tab: String(d.get("tab")) as "cards" | "comics" | "other",
                  }),
                "Items received and added to your collection.",
              ).then((ok) => {
                if (ok) {
                  setSelected(null);
                  onReceived();
                }
              });
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Quantity received
                <input
                  name="quantity"
                  type="number"
                  required
                  min={1}
                  max={selected.quantity - selected.receivedQty}
                  defaultValue={selected.quantity - selected.receivedQty}
                />
              </label>
              <label>
                Destination collection
                <select name="tab">
                  <option value="comics">Comic books</option>
                  <option value="cards">TCGplayer / Cards</option>
                  <option value="other">Other collectibles</option>
                </select>
              </label>
              {error && <p role="alert">{error}</p>}
              <div className="modal-actions">
                <button type="button" onClick={() => setSelected(null)}>
                  Cancel
                </button>
                <button className="primary">Confirm received and move</button>
              </div>
            </fieldset>
          </form>
        </Dialog>
      )}
      {edit && (
        <Dialog
          title={
            edit.kind === "date"
              ? "Expected arrival date"
              : edit.ids.length === 1
                ? "Delete outstanding line?"
                : "Delete selected outstanding lines?"
          }
          busy={busy}
          onClose={() => setEdit(null)}
        >
          <p>
            {edit.ids.length} {edit.ids.length === 1 ? "line" : "lines"}{" "}
            selected.
          </p>
          {edit.kind === "date" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const date = String(
                  new FormData(e.currentTarget).get("expectedDate") || "",
                );
                void action(
                  () =>
                    window.toolbox!.setOutstandingExpectedDate({
                      ids: edit.ids,
                      expectedDate: date || null,
                    }),
                  date
                    ? "Expected arrival date saved."
                    : "Expected arrival date cleared.",
                ).then((ok) => {
                  if (ok) {
                    setEdit(null);
                    setChecked(new Set());
                  }
                });
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  Expected arrival date (optional)
                  <input
                    name="expectedDate"
                    type="date"
                    defaultValue={edit.date || ""}
                  />
                </label>
                <p className="mail-note">
                  Leave blank to clear the date. This changes only your expected
                  arrival estimate, not the purchase date or received quantity.
                </p>
                {error && <p role="alert">{error}</p>}
                <div className="modal-actions">
                  <button type="button" onClick={() => setEdit(null)}>
                    Cancel
                  </button>
                  <button className="primary">Save expected date</button>
                </div>
              </fieldset>
            </form>
          ) : (
            <>
              <p>
                Remove these lines from Outstanding Orders? Deleted lines will
                stay excluded when emails are scanned again. Any items already
                received into your collection will stay there.
              </p>
              {error && <p role="alert">{error}</p>}
              <div className="modal-actions">
                <button disabled={busy} onClick={() => setEdit(null)}>
                  Cancel
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () =>
                        window.toolbox!.deleteOutstandingLines({
                          ids: edit.ids,
                          confirmed: true,
                        }),
                      "Outstanding lines deleted. They will not be re-imported.",
                    ).then((ok) => {
                      if (ok) {
                        setEdit(null);
                        setChecked(new Set());
                      }
                    })
                  }
                >
                  {edit.ids.length === 1 ? "Delete line" : "Delete lines"}
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </section>
  );
}
