import { useEffect, useState } from "react";
import {
  Mail,
  RefreshCw,
  ShieldCheck,
  Truck,
  Unplug,
  CheckCircle2,
} from "lucide-react";
import type { Order } from "./types";
import type {
  InboxResult,
  InboxState,
  Shipment,
  EmailUpdate,
} from "./inbox-types";
const initial: InboxState = {
  account: null,
  shipments: [],
  syncing: false,
  supported: true,
};
export default function InboxPanel({
  orders,
  onOrdersChanged,
}: {
  orders: Order[];
  onOrdersChanged: () => void;
}) {
  const [state, setState] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showConnect, setShowConnect] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      window.toolbox
        ?.inboxState()
        .then((s) => {
          if (active) {
            setState(s);
            setLoading(false);
          }
        })
        .catch(() => {
          if (active) {
            setError("Could not load your inbox.");
            setLoading(false);
          }
        });
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function action(fn: () => Promise<InboxResult>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fn();
      setState(r.state);
      if (!r.ok) setError(r.error || "Inbox operation failed.");
      else {
        setMessage(success);
        setShowConnect(false);
        setConfirmDisconnect(false);
        return true;
      }
    } catch {
      setError("Unable to contact the desktop inbox service. Try again.");
    } finally {
      setBusy(false);
    }
    return false;
  }
  const disabled = busy || state.syncing;
  const account = state.account;
  const updates = (state.updates || []).filter((u) =>
    (u.subject + " " + (u.orderReference || ""))
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const shipments = state.shipments.filter((s) =>
    (s.tracking + " " + s.carrier + " " + s.subject)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  if (loading)
    return <div className="panel loading">Loading your shipment inbox…</div>;
  return (
    <div className="inbox-module">
      <section className="panel inbox-intro">
        <span className="gmail-icon">
          <Mail size={26} />
        </span>
        <div>
          <h2>Gmail shipment inbox</h2>
          <p>Turn shipping emails into a clear view of what’s on the way.</p>
        </div>
        <span className="local-pill">
          <ShieldCheck size={14} /> Read-only IMAP · TLS
        </span>
      </section>
      {(error || account?.error) && (
        <div className="alert" role="alert">
          {error || account?.error}
        </div>
      )}
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {!state.supported && (
        <div className="alert">
          Gmail connection requires Windows Credential Manager. You can preview
          this screen here; connect on your Windows PC.
        </div>
      )}
      <section className="panel inbox-account">
        <div className="panel-heading">
          <div>
            <h2>
              {account ? "Connected account" : "Connect your Gmail account"}
            </h2>
            <p>
              {account
                ? account.email
                : "Use a Google app password, never your normal Gmail password."}
            </p>
          </div>
          {account && (
            <span
              className={account.error ? "badge processing" : "badge delivered"}
            >
              <i />
              {account.error ? "Needs attention" : "Configured"}
            </span>
          )}
        </div>
        {account && (
          <>
            <div className="inbox-controls">
              <button
                className="primary"
                disabled={disabled}
                onClick={() =>
                  void action(
                    () => window.toolbox!.refreshInbox(),
                    "Inbox refreshed. Review detected shipment updates below.",
                  )
                }
              >
                <RefreshCw size={14} />{" "}
                {disabled ? "Checking Gmail…" : "Refresh now"}
              </button>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={account.auto}
                  disabled={disabled}
                  onChange={(e) =>
                    void action(
                      () => window.toolbox!.setInboxAuto(e.target.checked),
                      e.target.checked
                        ? "Automatic checks enabled."
                        : "Automatic checks paused.",
                    )
                  }
                />{" "}
                Check every 10 minutes while app is open
              </label>
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => setShowConnect((v) => !v)}
              >
                Update credentials
              </button>
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => setConfirmDisconnect(true)}
              >
                <Unplug size={14} />
                Disconnect
              </button>
            </div>
            <div className="sync-summary">
              <span>
                Last successful check:{" "}
                {account.lastSync
                  ? new Date(account.lastSync).toLocaleString()
                  : "Not yet checked"}
              </span>
              <span>
                {account.scanned} emails scanned · {account.skipped} skipped
              </span>
            </div>
            {account.limited && (
              <p className="inbox-warning">
                Showing results from the newest 100 matching emails in the last
                30 days. Older matches were not scanned.
              </p>
            )}
          </>
        )}
        {confirmDisconnect && (
          <div className="disconnect-confirm">
            <p>
              Remove the saved Gmail credential and all detected shipments from
              this inbox? Existing orders and their applied statuses will stay.
            </p>
            <button
              disabled={disabled}
              onClick={() => setConfirmDisconnect(false)}
            >
              Cancel
            </button>
            <button
              className="danger-button"
              disabled={disabled}
              onClick={() =>
                void action(
                  () => window.toolbox!.disconnectGmail(),
                  "Gmail disconnected. Saved credential and shipment inbox removed.",
                )
              }
            >
              Disconnect and clear inbox
            </button>
          </div>
        )}
        {(!account || showConnect) && (
          <GmailForm
            disabled={disabled || !state.supported}
            email={account?.email || ""}
            onConnect={(input) =>
              action(
                () => window.toolbox!.connectGmail(input),
                "Gmail connected and initial shipment scan completed.",
              )
            }
            busy={busy}
          />
        )}
      </section>
      <section className="panel inbox-help">
        <h3>Set up Gmail in three steps</h3>
        <ol>
          <li>
            Enable <b>2-Step Verification</b> in your Google Account.
          </li>
          <li>
            Open <b>myaccount.google.com/apppasswords</b> in your browser and
            create an app password named “Personal Toolbox”.
          </li>
          <li>
            Enter your Gmail address and that 16-letter app password above.
            Spaces are accepted.
          </li>
        </ol>
        <p>
          App passwords may be unavailable for managed work/school accounts,
          Advanced Protection, or some security configurations. Ask your
          administrator if needed. Personal Gmail normally has IMAP enabled;
          managed accounts must allow IMAP.
        </p>
        <p>
          <ShieldCheck size={13} /> The app password is stored in Windows
          Credential Manager. SQLite stores your email address and shipment
          metadata only. App passwords can access your mailbox; this app opens
          INBOX read-only and does not send, mark read, move, or delete email.
        </p>
      </section>
      <section className="panel">
        {" "}
        <div className="table-toolbar">
          <label className="search">
            <input
              aria-label="Search inbox updates"
              placeholder="Search tracking, carrier, order reference, or subject…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              Email updates without tracking{" "}
              <span className="count">{(state.updates || []).length}</span>
            </h2>
            <p>
              Order confirmations and delivery emails can appear even when no
              supported tracking number is found.
            </p>
          </div>
          <Mail size={18} />
        </div>
        {!updates.length ? (
          <div className="empty">
            <p>
              No matching untracked updates yet. Click Refresh now after
              forwarding a confirmation or shipping email to this Gmail INBOX.
            </p>
          </div>
        ) : (
          <div>
            {updates.map((update) => (
              <EmailUpdateRow
                key={update.id}
                update={update}
                orders={orders}
                disabled={disabled}
                onApply={async (orderId) => {
                  const ok = await action(
                    () =>
                      window.toolbox!.linkEmailUpdate({
                        updateId: update.id,
                        orderId,
                      }),
                    "Email update linked to the selected order.",
                  );
                  if (ok) onOrdersChanged();
                }}
              />
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              Shipments with tracking{" "}
              <span className="count">{state.shipments.length}</span>
            </h2>
            <p>
              Review email-derived updates before applying them to an order.
            </p>
          </div>
          <Truck size={18} />
        </div>
        {!shipments.length ? (
          <div className="empty">
            <Mail size={28} />
            <h3>
              {account
                ? "No matching shipments yet"
                : "Your shipments will appear here"}
            </h3>
            <p>
              {account
                ? "The scan checks shipping-related subjects in INBOX from the last 30 days. Currently recognizes UPS, USPS, Amazon, and explicitly labeled FedEx/DHL numbers."
                : "Connect Gmail to check shipping emails. No sample emails are mixed into your inbox."}
            </p>
          </div>
        ) : (
          <div className="shipment-list">
            {shipments.map((s) => (
              <ShipmentRow
                key={s.id}
                shipment={s}
                orders={orders}
                disabled={disabled}
                onApply={async (orderId) => {
                  const ok = await action(
                    () =>
                      window.toolbox!.linkShipment({
                        shipmentId: s.id,
                        orderId,
                      }),
                    "Shipment linked and order status applied.",
                  );
                  if (ok) onOrdersChanged();
                }}
              />
            ))}
          </div>
        )}
        <div className="table-bottom">
          Email updates are estimates, not live carrier confirmations. Remote
          images, links, email HTML, and attachments are never displayed.
        </div>
      </section>
    </div>
  );
}
function GmailForm({
  disabled,
  email,
  onConnect,
  busy,
}: {
  disabled: boolean;
  email: string;
  busy: boolean;
  onConnect: (input: {
    email: string;
    appPassword: string;
  }) => Promise<boolean | undefined>;
}) {
  const [password, setPassword] = useState("");
  return (
    <form
      className="gmail-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const secret = password;
        setPassword("");
        await onConnect({
          email: String(form.get("email")),
          appPassword: secret,
        });
      }}
    >
      <div className="form-grid">
        <label>
          Gmail address
          <input
            aria-label="Gmail address"
            name="email"
            type="email"
            autoComplete="username"
            defaultValue={email}
            required
            maxLength={254}
            disabled={disabled}
            placeholder="you@gmail.com"
          />
        </label>
        <label>
          Google app password
          <input
            aria-label="Google app password"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={64}
            disabled={disabled}
            placeholder="16-letter app password"
          />
        </label>
      </div>
      <button className="primary" type="submit" disabled={disabled}>
        <ShieldCheck size={14} />
        {busy ? "Testing connection and scanning…" : "Connect Gmail securely"}
      </button>
      <span className="gmail-secret-note">
        Credential saved only after Gmail accepts it.
      </span>
    </form>
  );
}
function ShipmentRow({
  shipment: s,
  orders,
  disabled,
  onApply,
}: {
  shipment: Shipment;
  orders: Order[];
  disabled: boolean;
  onApply: (id: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState(s.orderId || "");
  return (
    <article className="shipment-row">
      <div className="shipment-info">
        <div>
          <span className="shipment-carrier">{s.carrier}</span>
          <code>{s.tracking}</code>
          <span
            className={
              "badge " + (s.status === "Delivered" ? "delivered" : "in-transit")
            }
          >
            <i />
            {s.status}
          </span>
        </div>
        <p>{s.subject}</p>
        <small>
          Received {new Date(s.received).toLocaleString()}{" "}
          {s.orderId && "· Linked to an order"}
        </small>
      </div>
      <div className="shipment-apply">
        <select
          aria-label={"Order for " + s.tracking}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={disabled}
        >
          <option value="">Choose an order to update…</option>
          {orders
            .filter((o) => o.status !== "Cancelled")
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.store} · {o.id.slice(0, 8)}
              </option>
            ))}
        </select>
        <button
          className="primary"
          disabled={disabled || !selected}
          onClick={() => void onApply(selected)}
        >
          <CheckCircle2 size={14} />
          Apply status
        </button>
      </div>
    </article>
  );
}

function EmailUpdateRow({
  update: u,
  orders,
  disabled,
  onApply,
}: {
  update: EmailUpdate;
  orders: Order[];
  disabled: boolean;
  onApply: (id: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState(u.orderId || "");
  return (
    <article className="shipment-row">
      <div className="shipment-info">
        <div>
          <span className="badge processing">{u.status}</span>
          {u.orderReference && <code>Order #{u.orderReference}</code>}
        </div>
        <p>{u.subject}</p>
        <small>
          Received {new Date(u.received).toLocaleString()}{" "}
          {u.orderId && "· Linked to an order"}
        </small>
        <small>
          No recognized tracking number. Review this email-derived update.
        </small>
      </div>
      <div className="shipment-apply">
        <select
          aria-label={"Order for email " + u.id}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={disabled}
        >
          <option value="">Choose an existing order…</option>
          {orders
            .filter((o) => o.status !== "Cancelled")
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.store} · {o.id.slice(0, 8)}
              </option>
            ))}
        </select>
        <button
          className="primary"
          disabled={disabled || !selected}
          onClick={() => void onApply(selected)}
        >
          {u.status === "Needs review" ? "Link to order" : "Apply email status"}
        </button>
      </div>
    </article>
  );
}
