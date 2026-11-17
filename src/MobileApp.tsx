import { useEffect, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  Home,
  Layers,
  Package,
  Truck,
  Receipt,
  RefreshCw,
  LogOut,
  WifiOff,
  ChevronRight,
} from "lucide-react";
import type { MobileSnapshot } from "./mobile-types";
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
type Edit =
  | { kind: "date"; item: MobileSnapshot["outstanding"][number] }
  | {
      kind: "receive";
      item: MobileSnapshot["outstanding"][number];
      requestId: string;
    }
  | { kind: "task"; item: MobileSnapshot["tasks"][number] };
export default function MobileApp() {
  const [name, setName] = useState(""),
    [csrf, setCsrf] = useState(""),
    [data, setData] = useState<MobileSnapshot | null>(null),
    [tab, setTab] = useState("Home"),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [offline, setOffline] = useState(false),
    [edit, setEdit] = useState<Edit | null>(null);
  const active = useRef(false),
    generation = useRef(0),
    dialog = useRef<HTMLDialogElement>(null);
  const unpair = () => {
    generation.current++;
    setCsrf("");
    setName("");
    setData(null);
    setEdit(null);
  };
  async function api(path: string, body?: unknown) {
    const r = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers:
        body === undefined
          ? {}
          : { "Content-Type": "application/json", "X-Toolbox-CSRF": csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    let value: any;
    try {
      value = await r.json();
    } catch {
      throw Error(
        "The desktop could not be reached. Keep Tailscale and Personal Toolbox open on your PC.",
      );
    }
    if (!r.ok) {
      if (r.status === 401) unpair();
      throw Error(value.error || "Could not complete this request.");
    }
    return value;
  }
  async function refresh(silent = false) {
    if (active.current) return;
    const gen = generation.current;
    try {
      const v = (await api("snapshot")) as MobileSnapshot;
      if (gen === generation.current) {
        setData(v);
        setOffline(false);
        if (!silent) setError("");
      }
    } catch (e) {
      if (gen === generation.current) {
        setOffline(true);
        if (!silent)
          setError(e instanceof Error ? e.message : "Connection lost.");
      }
    }
  }
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/session", {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) return;
        const v = await r.json();
        if (alive) {
          setCsrf(v.csrf);
          setName(v.name);
        }
      } catch {
        if (alive) setOffline(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!csrf) return;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh(true);
    }, 15000);
    const visible = () => {
      if (!document.hidden) void refresh(true);
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [csrf]);
  useEffect(() => {
    if (edit) dialog.current?.showModal();
  }, [edit]);
  async function mutate(path: string, body: unknown, message: string) {
    if (active.current) return false;
    active.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const v = (await api(path, body)) as MobileSnapshot;
      setData(v);
      setOffline(false);
      setNotice(message);
      setEdit(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes.");
      return false;
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  const match = (text: string) =>
      text.toLowerCase().includes(query.toLowerCase()),
    pending =
      data?.outstanding.reduce((n, i) => n + i.quantity - i.receivedQty, 0) ||
      0,
    tasks = data?.tasks.filter((t) => t.status === "Needs Shipment") || [];
  if (loading)
    return (
      <main className="m-loading">
        <BriefcaseBusiness size={32} />
        <p>Opening your toolbox…</p>
      </main>
    );
  if (!csrf)
    return (
      <main className="m-pair">
        <div className="m-brand">
          <BriefcaseBusiness />
          <span>
            personal
            <br />
            toolbox<span className="m-gold">.</span>
          </span>
        </div>
        <span className="m-eyebrow">YOUR PRIVATE COMPANION</span>
        <h1>
          Your toolbox,
          <br />
          wherever you are.
        </h1>
        <p>
          Open Settings → iPhone companion on your Windows PC and generate a
          pairing code.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (active.current) return;
            active.current = true;
            setBusy(true);
            setError("");
            const d = new FormData(e.currentTarget),
              code = String(d.get("code"));
            e.currentTarget.reset();
            try {
              const v = await api("pair", {
                code,
                name: String(d.get("name") || "My iPhone"),
              });
              setCsrf(v.csrf);
              setName(v.name);
              setOffline(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Pairing failed.");
            } finally {
              active.current = false;
              setBusy(false);
            }
          }}
        >
          <label>
            Device name
            <input
              name="name"
              required
              maxLength={64}
              defaultValue="My iPhone"
              autoComplete="off"
            />
          </label>
          <label>
            8-digit pairing code
            <input
              name="code"
              aria-label="Pairing code"
              inputMode="numeric"
              type="password"
              autoComplete="one-time-code"
              pattern="[0-9]{8}"
              minLength={8}
              maxLength={8}
              required
              placeholder="••••••••"
            />
          </label>
          {error && (
            <p role="alert" className="m-error">
              {error}
            </p>
          )}
          <button className="m-primary" disabled={busy}>
            {busy ? "Connecting…" : "Pair this iPhone"}
            <ChevronRight size={17} />
          </button>
        </form>
        {offline && (
          <div className="m-warning" role="status">
            <div>
              Your PC could not be reached. Check Tailscale and keep Personal
              Toolbox open.
              <button onClick={() => location.reload()}>Reconnect to PC</button>
            </div>
          </div>
        )}
        <aside>
          <strong>Add to your Home Screen</strong>
          <p>
            In Safari, tap Share → Add to Home Screen. Open the saved app and
            pair there if it asks again.
          </p>
          <small>Private Tailscale connection · Your PC must stay on</small>
        </aside>
      </main>
    );
  return (
    <div className="m-app">
      <header>
        <div className="m-brand">
          <BriefcaseBusiness />
          <span>
            personal toolbox<span className="m-gold">.</span>
          </span>
        </div>
        <button
          aria-label="Refresh data"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={18} />
        </button>
      </header>
      <main>
        <div className="m-heading">
          <div>
            <span className="m-eyebrow">{name.toUpperCase()}</span>
            <h1>
              {tab}
              <span className="m-gold">.</span>
            </h1>
          </div>
          <span className={"m-connection " + (offline ? "lost" : "")}>
            <i />
            {offline ? "Connection lost" : "Private connection"}
          </span>
        </div>
        {offline && (
          <div className="m-warning" role="status">
            <WifiOff size={16} />
            Keep your PC awake, Personal Toolbox running and Tailscale
            connected. Displayed data may be out of date.
          </div>
        )}
        {error && (
          <div className="m-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="m-notice" role="status">
            {notice}
          </div>
        )}
        {!data ? (
          <section className="m-card">
            <h2>Connecting to your PC…</h2>
            <p>Check Tailscale on both devices, then refresh.</p>
          </section>
        ) : (
          <>
            {tab === "Home" ? (
              <>
                <section className="m-welcome">
                  <span className="m-eyebrow">EVERYTHING, IN REACH</span>
                  <h2>
                    A clear view of
                    <br />
                    what’s next.
                  </h2>
                  <p>
                    Your collection, purchases and shipping tasks, connected to
                    your desktop.
                  </p>
                </section>
                <div className="m-stats">
                  <article>
                    <Package />
                    <strong>{pending}</strong>
                    <span>Items expected</span>
                  </article>
                  <article>
                    <Truck />
                    <strong>{tasks.length}</strong>
                    <span>Need shipment</span>
                  </article>
                  <article>
                    <Receipt />
                    <strong>{money(data.monthExpenseCents)}</strong>
                    <span>Spent this month</span>
                  </article>
                  <article>
                    <Layers />
                    <strong>
                      {data.collection.reduce((n, i) => n + i.quantity, 0)}
                    </strong>
                    <span>Collection units</span>
                  </article>
                </div>
                <h2 className="m-section-title">Coming up</h2>
                {data.outstanding.slice(0, 4).map((i) => (
                  <article className="m-card" key={i.id}>
                    <div className="m-card-top">
                      <span className="m-tag">EXPECTED ITEM</span>
                      <span>{i.expectedDate || "Date not set"}</span>
                    </div>
                    <h3>{i.description}</h3>
                    <p>
                      {i.quantity - i.receivedQty} remaining · Purchased{" "}
                      {i.purchaseDate}
                    </p>
                    <button
                      onClick={() => {
                        setTab("Outstanding");
                        setQuery("");
                      }}
                    >
                      View outstanding orders
                      <ChevronRight size={15} />
                    </button>
                  </article>
                ))}
                {!data.outstanding.length && (
                  <p className="m-empty">Your outstanding queue is clear.</p>
                )}
                <section className="m-card m-install">
                  <h3>Make this your pocket toolbox</h3>
                  <p>
                    Safari → Share → Add to Home Screen. Your PC handles email
                    scanning; this companion shows the latest saved data.
                  </p>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await api("logout", {});
                        unpair();
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Could not sign out.",
                        );
                      }
                    }}
                  >
                    <LogOut size={15} />
                    Unpair this device
                  </button>
                </section>
              </>
            ) : (
              <>
                <label className="m-search">
                  <span>Search {tab.toLowerCase()}</span>
                  <input
                    aria-label={"Search " + tab.toLowerCase()}
                    placeholder="Search…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                {tab === "Collection" &&
                  data.collection
                    .filter((i) =>
                      match(i.name + " " + i.category + " " + i.collectionType),
                    )
                    .map((i) => (
                      <article className="m-card" key={i.id}>
                        <div className="m-card-top">
                          <span className="m-tag">
                            {i.collectionType.toUpperCase()}
                          </span>
                          <span>{i.quantity} owned</span>
                        </div>
                        <h3>{i.name}</h3>
                        <p>
                          {i.category}
                          {i.purchaseDate
                            ? " · Purchased " + i.purchaseDate
                            : ""}
                        </p>
                        <div className="m-values">
                          <div>
                            <span>Unit cost</span>
                            <strong>{money(i.purchaseCents)}</strong>
                          </div>
                          <div>
                            <span>Unit value</span>
                            <strong className="m-gold">
                              {i.valueCents === null
                                ? "Unpriced"
                                : money(i.valueCents)}
                            </strong>
                          </div>
                        </div>
                      </article>
                    ))}
                {tab === "Outstanding" &&
                  data.outstanding
                    .filter((i) =>
                      match(
                        i.description +
                          " " +
                          i.purchaseDate +
                          " " +
                          (i.expectedDate || ""),
                      ),
                    )
                    .map((i) => (
                      <article className="m-card" key={i.id}>
                        <div className="m-card-top">
                          <span className="m-tag">AWAITING ARRIVAL</span>
                          <span>{i.quantity - i.receivedQty} remaining</span>
                        </div>
                        <h3>{i.description}</h3>
                        <p>
                          Purchased {i.purchaseDate} · {money(i.unitCents)} each
                        </p>
                        <div className="m-due">
                          <span>Expected arrival</span>
                          <strong>{i.expectedDate || "Not set"}</strong>
                        </div>
                        <div className="m-actions">
                          <button
                            disabled={busy || offline}
                            onClick={() => setEdit({ kind: "date", item: i })}
                          >
                            Edit expected date
                          </button>
                          <button
                            className="m-primary"
                            disabled={busy || offline}
                            onClick={() =>
                              setEdit({
                                kind: "receive",
                                item: i,
                                requestId: crypto.randomUUID(),
                              })
                            }
                          >
                            Receive items
                          </button>
                        </div>
                      </article>
                    ))}
                {tab === "Tasks" &&
                  data.tasks
                    .filter((i) =>
                      match(
                        i.name +
                          " " +
                          i.status +
                          " " +
                          (i.orderReference || ""),
                      ),
                    )
                    .map((i) => (
                      <article className="m-card" key={i.id}>
                        <div className="m-card-top">
                          <span className="m-tag">
                            {i.status.toUpperCase()}
                          </span>
                          <span>
                            {i.shipBy ? "Ship by " + i.shipBy : "No deadline"}
                          </span>
                        </div>
                        <h3>{i.name}</h3>
                        {i.orderReference && <p>Order {i.orderReference}</p>}
                        <button
                          disabled={busy || offline}
                          onClick={() => setEdit({ kind: "task", item: i })}
                        >
                          Update task status
                          <ChevronRight size={15} />
                        </button>
                      </article>
                    ))}
                {tab === "Expenses" && (
                  <>
                    <div className="m-total">
                      <span>This month</span>
                      <strong>{money(data.monthExpenseCents)}</strong>
                      <small>
                        {money(data.monthlyRecurringCents)} monthly recurring
                        estimate
                      </small>
                    </div>
                    {data.expenses
                      .filter((i) =>
                        match(i.description + " " + i.category + " " + i.date),
                      )
                      .map((i) => (
                        <article className="m-card m-expense" key={i.id}>
                          <div>
                            <span className="m-tag">{i.category}</span>
                            <h3>{i.description}</h3>
                            <p>{i.date}</p>
                          </div>
                          <strong>{money(i.amountCents)}</strong>
                        </article>
                      ))}
                  </>
                )}
                {((tab === "Collection" && !data.collection.length) ||
                  (tab === "Outstanding" && !data.outstanding.length) ||
                  (tab === "Tasks" && !data.tasks.length) ||
                  (tab === "Expenses" && !data.expenses.length)) && (
                  <p className="m-empty">
                    Nothing here yet. Add or import items in your desktop app.
                  </p>
                )}
              </>
            )}
            <footer>
              Last updated{" "}
              {new Date(data.updatedAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
              <br />
              Personal Toolbox · Private companion
            </footer>
          </>
        )}
      </main>
      <nav aria-label="Mobile navigation">
        {[
          ["Home", Home],
          ["Collection", Layers],
          ["Outstanding", Package],
          ["Tasks", Truck],
          ["Expenses", Receipt],
        ].map(([label, Icon]) => {
          const I = Icon as typeof Home;
          return (
            <button
              key={String(label)}
              aria-current={tab === label ? "page" : undefined}
              onClick={() => {
                setTab(String(label));
                setQuery("");
                setError("");
                setNotice("");
                window.scrollTo({ top: 0 });
              }}
            >
              <I size={20} />
              <span>{String(label)}</span>
            </button>
          );
        })}
      </nav>
      {edit && (
        <dialog
          className="m-dialog"
          ref={dialog}
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) setEdit(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              if (edit.kind === "date")
                void mutate(
                  "expected-date",
                  {
                    id: edit.item.id,
                    expectedDate: String(d.get("date") || "") || null,
                    version: edit.item.version,
                  },
                  "Expected arrival date saved.",
                );
              else if (edit.kind === "receive")
                void mutate(
                  "receive",
                  {
                    id: edit.item.id,
                    requestId: edit.requestId,
                    quantity: Number(d.get("quantity")),
                    tab: d.get("tab"),
                  },
                  "Items received into your collection.",
                );
              else
                void mutate(
                  "task-status",
                  {
                    id: edit.item.id,
                    status: d.get("status"),
                    version: edit.item.version,
                  },
                  "Task status updated.",
                );
            }}
          >
            <h2>
              {edit.kind === "date"
                ? "Expected arrival"
                : edit.kind === "receive"
                  ? "Receive items"
                  : "Update task"}
            </h2>
            <p>
              {edit.kind === "task" ? edit.item.name : edit.item.description}
            </p>
            <fieldset disabled={busy}>
              {edit.kind === "date" ? (
                <>
                  <label>
                    Expected arrival date (optional)
                    <input
                      name="date"
                      type="date"
                      defaultValue={edit.item.expectedDate || ""}
                    />
                  </label>
                  <small>Leave blank to clear the date.</small>
                </>
              ) : edit.kind === "receive" ? (
                <>
                  <label>
                    Quantity received
                    <input
                      name="quantity"
                      type="number"
                      required
                      min={1}
                      max={edit.item.quantity - edit.item.receivedQty}
                      defaultValue={edit.item.quantity - edit.item.receivedQty}
                    />
                  </label>
                  <label>
                    Destination collection
                    <select name="tab">
                      <option value="comics">Comic books</option>
                      <option value="cards">Cards</option>
                      <option value="other">Other collectibles</option>
                    </select>
                  </label>
                </>
              ) : (
                <label>
                  Task status
                  <select
                    aria-label="Task status"
                    name="status"
                    defaultValue={edit.item.status}
                  >
                    <option>Needs Shipment</option>
                    <option>Shipped</option>
                    <option>Cancelled</option>
                  </select>
                </label>
              )}
              <label className="m-check">
                <input type="checkbox" required />I reviewed this item and want
                to save this change to my PC.
              </label>
              {error && (
                <p className="m-error" role="alert">
                  {error}
                </p>
              )}
              <div className="m-actions">
                <button type="button" onClick={() => setEdit(null)}>
                  Cancel
                </button>
                <button className="m-primary">
                  {busy ? "Saving…" : "Confirm and save"}
                </button>
              </div>
            </fieldset>
          </form>
        </dialog>
      )}
    </div>
  );
}
