import InboxPanel from "./InboxPanel";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  ShoppingBag,
  Layers,
  ListTodo,
  Globe,
  Contact,
  Inbox,
  Receipt,
  Settings,
  BriefcaseBusiness,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Download,
  Package,
  Wallet,
  Truck,
  Check,
  X,
  Command,
  ShieldCheck,
  Activity,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import type { Snapshot, NewOrder } from "./types";
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
const nav = [
  ["Analytics", LayoutDashboard],
  ["Orders", ShoppingBag],
  ["Collection", Layers],
  ["Tasks", ListTodo],
  ["Proxies", Globe],
  ["Profiles", Contact],
  ["Inbox", Inbox],
  ["Expenses", Receipt],
  ["Settings", Settings],
] as const;
const empty: Snapshot = { orders: [], collection: [], tasks: [] };
const plans: Record<string, string> = {
  Tasks:
    "Schedule authorized monitoring jobs, control retries and concurrency, and inspect redacted logs.",
  Proxies:
    "Organize proxy groups, test connectivity, and monitor health. Authentication will use Windows Credential Manager.",
  Profiles:
    "Manage account and shipping profiles with secure sensitive fields and validated CSV import.",

  Expenses: "Track shipping, taxes, marketplace fees, and realized profit.",
  Settings:
    "Configure preferences, notifications, database backups, and storage.",
};
export default function App() {
  const [data, setData] = useState<Snapshot>(empty);
  const [page, setPage] = useState("Analytics");
  const [range, setRange] = useState("90");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState("All statuses");
  const reload = () => {
    setLoading(true);
    setError("");
    if (!window.toolbox) {
      setError(
        "Open Personal Toolbox in Electron to connect to your local database.",
      );
      setLoading(false);
      return;
    }
    window.toolbox
      .snapshot()
      .then(setData)
      .catch(() =>
        setError("Could not load your local data. Please try again."),
      )
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        const input = document.querySelector<HTMLInputElement>(
          '[aria-label="Search orders"]',
        );
        if (input) {
          e.preventDefault();
          input.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  const orders = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(range));
    return data.orders.filter((o) => new Date(o.date) >= cutoff);
  }, [data, range]);
  const spend = orders
    .filter((o) => o.status !== "Cancelled")
    .reduce((s, o) => s + o.total, 0);
  const value = data.collection.reduce((s, i) => s + i.market * i.quantity, 0);
  const cost = data.collection.reduce((s, i) => s + i.purchase * i.quantity, 0);
  const shipped = orders.filter((o) => o.status === "In transit").length;
  const delivered = orders.filter((o) => o.status === "Delivered").length;
  const chart = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => {
        const start = new Date();
        start.setDate(
          start.getDate() - Number(range) + (Number(range) / 8) * i,
        );
        const end = new Date(start);
        end.setDate(end.getDate() + Number(range) / 8);
        const total = orders
          .filter(
            (o) =>
              new Date(o.date) >= start &&
              new Date(o.date) < end &&
              o.status !== "Cancelled",
          )
          .reduce((s, o) => s + o.total, 0);
        return {
          date: start.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          }),
          spend: Math.round(total),
        };
      }),
    [orders, range],
  );
  const categories = Object.entries(
    data.collection.reduce<Record<string, number>>((a, i) => {
      a[i.category] = (a[i.category] || 0) + i.quantity * i.market;
      return a;
    }, {}),
  ).map(([name, value]) => ({ name, value }));
  const filtered = orders.filter(
    (o) =>
      (o.name + " " + o.store + " " + o.id)
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (status === "All statuses" || o.status === status),
  );
  const exportOrders = async () => {
    try {
      if (!window.toolbox) throw Error();
      const ok = await window.toolbox.exportOrders();
      if (ok) setNotice("Orders exported successfully.");
    } catch {
      setError("Could not export orders. Try another save location.");
    }
  };
  return (
    <div className="app-shell">
      <aside>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("Analytics");
          }}
        >
          <span className="brand-icon">
            <BriefcaseBusiness size={23} />
          </span>
          <span>
            personal
            <span className="brand-second">
              toolbox<span className="gold">.</span>
            </span>
          </span>
        </a>
        <div className="workspace">
          <span className="avatar">P</span>
          <div>
            Personal workspace<small>Local account</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(([name, Icon]) => (
            <button
              key={name}
              className={page === name ? "active" : ""}
              onClick={() => {
                setPage(name);
                setQuery("");
                setStatus("All statuses");
              }}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === "Orders" && <small>{data.orders.length}</small>}
              {name === "Analytics" && page === name && (
                <span className="active-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local">
            <ShieldCheck size={17} />
            <div>
              Your data stays yours<small>Stored locally on this device</small>
            </div>
            <span />
          </div>
          <div className="version">
            <span>Personal Toolbox</span>
            <span>v0.2.0</span>
          </div>
        </div>
      </aside>
      <div className="content">
        <header>
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <span>{page}</span>
          </div>
          <div className="header-right">
            <span className="local-pill">
              <i /> Local workspace
            </span>
            <span className="avatar small">P</span>
          </div>
        </header>
        <main>
          <div className="title-row">
            <div>
              <div className="eyebrow">YOUR WORKSPACE, AT A GLANCE</div>
              <h1>
                {page === "Analytics" ? "Overview" : page}
                <span className="gold">.</span>
              </h1>
              <p>
                {page === "Analytics"
                  ? "A little clarity for everything you collect, track, and manage."
                  : page === "Orders"
                    ? "Every purchase, from checkout to your doorstep."
                    : page === "Collection"
                      ? "Your collection. A clearer picture of its value."
                      : "Make room for a more organized day."}
              </p>
            </div>
            <div className="actions">
              {["Analytics", "Orders"].includes(page) && (
                <select
                  aria-label="Date range"
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                >
                  <option value="90">Last 90 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="7">Last 7 days</option>
                </select>
              )}
              <button className="primary" onClick={() => setModal(true)}>
                <Plus size={16} /> Add order
              </button>
            </div>
          </div>
          {error && (
            <div role="alert" className="alert">
              {error} <button onClick={reload}>Retry</button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="panel loading">Loading your workspace…</div>
          ) : (
            <>
              {page === "Analytics" && (
                <>
                  <section className="stats">
                    {[
                      {
                        label: "Total spending",
                        amount: money(spend),
                        icon: Wallet,
                        detail: `${orders.length} orders in this period`,
                        accent: false,
                      },
                      {
                        label: "Collection value",
                        amount: money(value),
                        icon: Layers,
                        detail: `${(((value - cost) / Math.max(cost, 1)) * 100).toFixed(1)}% unrealized return`,
                        accent: true,
                      },
                      {
                        label: "Total orders",
                        amount: String(orders.length),
                        icon: ShoppingBag,
                        detail: `${delivered} successfully delivered`,
                        accent: false,
                      },
                      {
                        label: "On the way",
                        amount: String(shipped).padStart(2, "0"),
                        icon: Truck,
                        detail: "Shipments in transit",
                        accent: false,
                      },
                    ].map(({ label, amount, icon: Icon, detail, accent }) => (
                      <article className="stat panel" key={label}>
                        <div className="stat-top">
                          {label}
                          <Icon size={17} />
                        </div>
                        <strong>{amount}</strong>
                        <div
                          className={
                            accent ? "stat-detail positive" : "stat-detail"
                          }
                        >
                          {accent ? (
                            <ArrowUpRight size={13} />
                          ) : (
                            <span className="tiny-dot" />
                          )}
                          {detail}
                        </div>
                        <div className="mini-line" />
                      </article>
                    ))}
                  </section>
                  <section className="chart-grid">
                    <article className="panel spending">
                      <div className="panel-heading">
                        <div>
                          <h2>Spending overview</h2>
                          <p>Your purchasing activity over time</p>
                        </div>
                        <span className="legend">
                          <i /> Spending
                        </span>
                      </div>
                      <div className="chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={chart}
                            margin={{ left: 0, right: 12, top: 14, bottom: 0 }}
                          >
                            <defs>
                              <linearGradient
                                id="goldFill"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="0%"
                                  stopColor="#d6b56b"
                                  stopOpacity={0.25}
                                />
                                <stop
                                  offset="100%"
                                  stopColor="#d6b56b"
                                  stopOpacity={0}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid
                              stroke="#272a30"
                              vertical={false}
                              strokeDasharray="3 5"
                            />
                            <XAxis
                              dataKey="date"
                              tick={{ fill: "#80858f", fontSize: 11 }}
                              axisLine={false}
                              tickLine={false}
                              minTickGap={25}
                            />
                            <YAxis
                              tick={{ fill: "#80858f", fontSize: 11 }}
                              axisLine={false}
                              tickLine={false}
                              width={55}
                              tickFormatter={(n) => "$" + n}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "#202329",
                                border: "1px solid #3c3f46",
                                borderRadius: 8,
                              }}
                              formatter={(v) => [money(Number(v)), "Spending"]}
                            />
                            <Area
                              isAnimationActive={false}
                              type="monotone"
                              dataKey="spend"
                              stroke="#d6b56b"
                              strokeWidth={2.5}
                              fill="url(#goldFill)"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="chart-footer">
                        <span>
                          Average order value{" "}
                          <b>
                            {money(
                              spend /
                                Math.max(
                                  orders.filter((o) => o.status !== "Cancelled")
                                    .length,
                                  1,
                                ),
                            )}
                          </b>
                        </span>
                        <span>Based on local order data</span>
                      </div>
                    </article>
                    <article className="panel collection-chart">
                      <div className="panel-heading">
                        <div>
                          <h2>Collection breakdown</h2>
                          <p>Market value by category</p>
                        </div>
                        <Layers size={17} />
                      </div>
                      <strong className="collection-total">
                        {money(value)}
                        <span>Total market value</span>
                      </strong>
                      <div className="category-chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={categories}
                            layout="vertical"
                            margin={{ left: 0, right: 14 }}
                          >
                            <XAxis type="number" hide />
                            <YAxis
                              dataKey="name"
                              type="category"
                              width={97}
                              tick={{ fill: "#a3a6ae", fontSize: 11 }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              cursor={{ fill: "#ffffff05" }}
                              contentStyle={{
                                background: "#202329",
                                border: "1px solid #3c3f46",
                              }}
                              formatter={(v) => money(Number(v))}
                            />
                            <Bar
                              isAnimationActive={false}
                              dataKey="value"
                              radius={[0, 4, 4, 0]}
                              barSize={13}
                            >
                              {categories.map((_, i) => (
                                <Cell
                                  key={i}
                                  fill={
                                    [
                                      "#d6b56b",
                                      "#9c895c",
                                      "#6b7168",
                                      "#575f6e",
                                    ][i % 4]
                                  }
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <button
                        className="text-button collection-link"
                        onClick={() => setPage("Collection")}
                      >
                        Explore your collection <ArrowUpRight size={14} />
                      </button>
                    </article>
                  </section>
                </>
              )}
              {["Analytics", "Orders"].includes(page) && (
                <section className="panel orders-panel">
                  <div className="panel-heading">
                    <div className="inline-heading">
                      <h2>
                        {page === "Analytics" ? "Recent orders" : "All orders"}
                      </h2>
                      <span className="count">{filtered.length}</span>
                    </div>
                    <button
                      className="text-button"
                      onClick={
                        page === "Analytics"
                          ? () => setPage("Orders")
                          : exportOrders
                      }
                    >
                      {page === "Analytics" ? "View all orders" : "Export CSV"}
                      {page === "Analytics" ? (
                        <ArrowUpRight size={14} />
                      ) : (
                        <Download size={14} />
                      )}
                    </button>
                  </div>
                  <div className="table-toolbar">
                    <label className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search orders"
                        placeholder="Search orders, stores, or order IDs..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <span>
                        <Command size={10} /> K
                      </span>
                    </label>
                    <select
                      aria-label="Order status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      {[
                        "All statuses",
                        "Delivered",
                        "In transit",
                        "Processing",
                        "Cancelled",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>PRODUCT</th>
                          <th>STORE</th>
                          <th>DATE</th>
                          <th>STATUS</th>
                          <th className="right">TOTAL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered
                          .slice(0, page === "Analytics" ? 5 : 200)
                          .map((o, i) => (
                            <tr key={o.id}>
                              <td>
                                <div className="product">
                                  <span
                                    className={"product-icon color-" + (i % 4)}
                                  >
                                    <Package size={21} />
                                  </span>
                                  <div>
                                    {o.name}
                                    <small>
                                      {o.category}{" "}
                                      <span>
                                        · #{o.id.slice(0, 8).toUpperCase()}
                                      </span>
                                    </small>
                                  </div>
                                </div>
                              </td>
                              <td>{o.store}</td>
                              <td>
                                {new Date(
                                  o.date + "T12:00:00",
                                ).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </td>
                              <td>
                                <span
                                  className={
                                    "badge " +
                                    o.status.toLowerCase().replace(" ", "-")
                                  }
                                >
                                  <i />
                                  {o.status}
                                </span>
                              </td>
                              <td className="right total">{money(o.total)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {!filtered.length && (
                      <div className="empty">No orders match your filters.</div>
                    )}
                  </div>
                  <div className="table-bottom">
                    <span>
                      Showing{" "}
                      {Math.min(
                        filtered.length,
                        page === "Analytics" ? 5 : 200,
                      )}{" "}
                      of {filtered.length} orders
                    </span>
                    <span>
                      <ShieldCheck size={13} /> Saved on your device
                    </span>
                  </div>
                </section>
              )}
              {page === "Collection" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Collection inventory</h2>
                    <span className="gold">{money(value)} market value</span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>ITEM</th>
                          <th>QUANTITY</th>
                          <th>UNIT COST</th>
                          <th>UNIT VALUE</th>
                          <th>UNREALIZED PROFIT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.collection.map((i) => (
                          <tr key={i.id}>
                            <td>
                              {i.name}
                              <small>{i.category}</small>
                            </td>
                            <td>{i.quantity}</td>
                            <td>{money(i.purchase)}</td>
                            <td>{money(i.market)}</td>
                            <td className="positive">
                              {money((i.market - i.purchase) * i.quantity)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {page === "Inbox" && (
                <InboxPanel orders={data.orders} onOrdersChanged={reload} />
              )}
              {plans[page] && (
                <section className="panel planned">
                  <span className="planned-icon">
                    {page === "Tasks" ? (
                      <ListTodo size={28} />
                    ) : (
                      <BriefcaseBusiness size={28} />
                    )}
                  </span>
                  <span className="stage-label">COMING IN A LATER STAGE</span>
                  <h2>{page}, thoughtfully connected.</h2>
                  <p>{plans[page]}</p>
                  {page === "Tasks" && (
                    <div className="sample-tasks">
                      {data.tasks.map((t) => (
                        <div key={t.id}>
                          <Activity size={15} />
                          {t.name}
                          <span className="badge processing">
                            {t.status} · Sample
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="scope-note">
                    Stage 1 establishes the secure desktop shell, local
                    database, and analytics. This module is not active yet.
                  </div>
                </section>
              )}
            </>
          )}
          <footer>
            <span>
              <span className="tiny-dot" />{" "}
              {window.toolbox
                ? "Local database connected"
                : "Desktop connection required"}
            </span>
            <span>v0.2 · Sample data included.</span>
          </footer>
        </main>
      </div>
      {modal && (
        <OrderModal
          onClose={() => setModal(false)}
          onSave={async (order) => {
            if (!window.toolbox)
              throw Error("Open the desktop app to save orders.");
            setData(await window.toolbox.addOrder(order));
            setNotice("Order saved to your local database.");
            setModal(false);
          }}
        />
      )}
    </div>
  );
}
function OrderModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (o: NewOrder) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
      if (e.key === "Tab") {
        const fields = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="dialog"] button:not(:disabled),[role="dialog"] input,[role="dialog"] select',
          ),
        );
        const first = fields[0],
          last = fields[fields.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, saving]);
  return (
    <div className="modal-overlay">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="modal"
      >
        <div className="panel-heading">
          <h2 id="modal-title">Add an order</h2>
          <button aria-label="Close dialog" disabled={saving} onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <p>Keep your purchases in one place.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setSaving(true);
            setError("");
            try {
              await onSave({
                name: String(f.get("name")),
                store: String(f.get("store")),
                category: String(f.get("category")),
                total: Number(f.get("total")),
                status: String(f.get("status")) as NewOrder["status"],
                date: String(f.get("date")),
              });
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Could not save order.",
              );
              setSaving(false);
            }
          }}
        >
          <label>
            Product name
            <input
              autoFocus
              name="name"
              maxLength={120}
              required
              placeholder="e.g. Air Jordan 1 Retro High"
            />
          </label>
          <div className="form-grid">
            <label>
              Store
              <input
                name="store"
                maxLength={80}
                required
                placeholder="e.g. Nike"
              />
            </label>
            <label>
              Category
              <select name="category">
                {[
                  "Sneakers",
                  "Trading cards",
                  "Art & figures",
                  "Collectibles",
                  "Other",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Total cost (USD)
              <input
                name="total"
                type="number"
                min="0"
                max="10000000"
                step="0.01"
                required
                placeholder="0.00"
              />
            </label>
            <label>
              Order date
              <input
                name="date"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                required
              />
            </label>
          </div>
          <label>
            Status
            <select name="status">
              {["Processing", "In transit", "Delivered", "Cancelled"].map(
                (s) => (
                  <option key={s}>{s}</option>
                ),
              )}
            </select>
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={saving}>
              {saving ? "Saving…" : "Save order"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
