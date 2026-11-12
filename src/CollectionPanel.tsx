import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Layers,
  Search,
  RefreshCw,
  Plus,
  ExternalLink,
  BookOpen,
  Package,
  Wallet,
  TrendingUp,
  ShieldCheck,
  X,
  Pencil,
  Trash2,
  History,
  ImagePlus,
  Link as LinkIcon,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type {
  CollectionState,
  CollectionResult,
  CatalogCard,
  CatalogVariant,
  OwnedCollectible,
  CollectionTab,
  ManualCollectible,
  QuoteObservation,
} from "./collection-types";
import { amountToCents } from "./expense-types";
import CardArtwork from "./CardArtwork";
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const initial: CollectionState = {
  items: [],
  settings: {
    connected: false,
    supported: true,
    games: [],
    cooldownUntil: 0,
    dailyRemaining: null,
    monthlyRemaining: null,
  },
  busy: false,
  progress: "",
};
type Modal =
  | { kind: "connect" }
  | { kind: "disconnect" }
  | { kind: "manual" }
  | { kind: "edit"; item: OwnedCollectible }
  | { kind: "delete"; item: OwnedCollectible }
  | { kind: "add"; card: CatalogCard; variant: CatalogVariant }
  | { kind: "history"; item: OwnedCollectible; quotes: QuoteObservation[] };
export default function CollectionPanel({
  onChanged,
  productRequest,
}: {
  onChanged: () => void;
  productRequest: { id: string; nonce: number } | null;
}) {
  const [state, setState] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | CollectionTab>("all");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [game, setGame] = useState("");
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [lastSearch, setLastSearch] = useState({
    query: "",
    game: "",
    searchQuery: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);
  const [page, setPage] = useState(1);
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const running = useRef(false);
  const handled = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (running.current) return;
      window.toolbox
        ?.collectionState()
        .then((s) => {
          if (alive && !running.current) {
            setState(s);
            setLoading(false);
          }
        })
        .catch(() => {
          if (alive) {
            setError(
              "Could not load collection data. Reopen this section to retry.",
            );
            setLoading(false);
          }
        });
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (tab !== "cards") return;
    let alive = true;
    const load = () =>
      window.toolbox
        ?.collectionBrowserState()
        .then((b) => {
          if (alive) setOpenProduct(b.productId);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tab]);
  useEffect(() => {
    if (!productRequest || loading || handled.current === productRequest.nonce)
      return;
    handled.current = productRequest.nonce;
    setTab("cards");
    setModal(null);
    setCards([]);
    setQuery(productRequest.id);
    if (disabled)
      setError("A request is already running. Click Search when it finishes.");
    else if (state.settings.connected) void search(productRequest.id, 0);
    else
      setError("Connect JustTCG to look up this product, then click Search.");
  }, [productRequest?.nonce, loading]);
  const disabled = busy || state.busy;
  async function action(fn: () => Promise<CollectionResult>, message: string) {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      setState(result.state);
      if (!result.ok) {
        setError(result.error || "Could not complete this request.");
        return false;
      }
      setNotice(
        result.updated !== undefined
          ? `Refreshed ${result.updated} items; ${result.failed || 0} variants were unavailable. Check each source timestamp below.`
          : message,
      );
      setModal(null);
      onChanged();
      return true;
    } catch {
      setError(
        "The collection service could not complete the request. Please retry.",
      );
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function search(text = query, nextOffset = 0, searchGame = game) {
    if (running.current) return;
    setError("");
    setNotice("");
    if (!state.settings.connected) {
      setError("Connect a JustTCG API key to search and refresh prices.");
      return;
    }
    running.current = true;
    setBusy(true);
    setCards([]);
    setHasMore(false);
    setLastSearch({ query: text, game: searchGame, searchQuery: "" });
    setSearched(true);
    try {
      const result = await window.toolbox!.searchCatalog({
        query: text,
        game: searchGame,
        offset: nextOffset,
      });
      setState((s) => ({ ...s, settings: result.settings }));
      if (!result.ok) {
        setError(result.error || "Catalog search failed.");
        return;
      }
      setCards(result.cards);
      setLastSearch({
        query: text,
        game: searchGame,
        searchQuery: result.searchQuery || text,
      });
      setOffset(nextOffset);
      setHasMore(result.hasMore);
    } catch {
      setError("Could not search the card provider.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const open = (value: Modal) => {
    setError("");
    setModal(value);
  };
  const external = (url: string) =>
    void window
      .toolbox!.openCollectionProvider(url)
      .catch(() => setError("Could not open your browser."));
  const items = state.items.filter(
    (i) =>
      (tab === "all" || i.collectionType === tab) &&
      (
        i.name +
        " " +
        i.category +
        " " +
        i.setName +
        " " +
        i.condition +
        " " +
        i.printing
      )
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const lastPage = Math.max(1, Math.ceil(items.length / 25));
  const current = Math.min(page, lastPage);
  const known = state.items.filter((i) => i.valueCents !== null);
  const value = known.reduce((n, i) => n + i.valueCents! * i.quantity, 0);
  const cost = state.items.reduce(
    (n, i) => n + i.purchaseCents * i.quantity,
    0,
  );
  const profit = known.reduce(
    (n, i) => n + (i.valueCents! - i.purchaseCents) * i.quantity,
    0,
  );
  const unknown = state.items.length - known.length;
  return (
    <div className="collection-module">
      <div className="title-row">
        <div>
          <div className="eyebrow">COLLECT WHAT YOU LOVE</div>
          <h1>
            Collection<span className="gold">.</span>
          </h1>
          <p>
            Your cards, comics, and collectibles — with a clear record of their
            value.
          </p>
        </div>
        <div className="expense-actions">
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => open({ kind: "connect" })}
          >
            <ShieldCheck size={14} />
            {state.settings.connected
              ? "Pricing connection"
              : "Connect pricing"}
          </button>
          <button
            className="secondary"
            disabled={
              disabled ||
              !state.settings.connected ||
              !state.items.some((i) => i.provider === "justtcg")
            }
            onClick={() =>
              void action(
                () => window.toolbox!.refreshCollection(),
                "Values refreshed.",
              )
            }
          >
            <RefreshCw size={14} />
            {disabled ? "Working…" : "Refresh values"}
          </button>
          <button
            className="primary"
            disabled={disabled}
            onClick={() => open({ kind: "manual" })}
          >
            <Plus size={15} />
            Add item
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
            aria-label="Dismiss collection notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {state.busy && (
        <div className="notice" role="status">
          {state.progress || "Contacting the pricing provider…"}
        </div>
      )}
      <section className="stats expense-stats">
        {[
          {
            label: "Known market value",
            amount: money(value),
            detail: unknown
              ? `${unknown} entries have no current value`
              : "All entries currently valued",
            Icon: Layers,
          },
          {
            label: "Purchase cost",
            amount: money(cost),
            detail: "Unit cost × quantity owned",
            Icon: Wallet,
          },
          {
            label: "Unrealized P/L",
            amount: money(profit),
            detail: "Valued entries only · excludes fees",
            Icon: TrendingUp,
          },
          {
            label: "Units owned",
            amount: String(state.items.reduce((n, i) => n + i.quantity, 0)),
            detail: `${state.items.length} collection entries`,
            Icon: Package,
          },
        ].map(({ label, amount, detail, Icon }) => (
          <article
            className="panel expense-stat"
            key={label}
            aria-label={label}
          >
            <div>
              <span className="expense-stat-icon gold">
                <Icon size={17} />
              </span>
              <strong>{amount}</strong>
            </div>
            <span>{label}</span>
            <small>{detail}</small>
          </article>
        ))}
      </section>
      <div
        className="collection-tabs"
        role="tablist"
        aria-label="Collection sections"
      >
        {(
          [
            { id: "all", name: "All items", Icon: Layers },
            { id: "cards", name: "TCGplayer / Cards", Icon: Layers },
            { id: "comics", name: "Comic books", Icon: BookOpen },
            { id: "other", name: "Other collectibles", Icon: Package },
          ] as const
        ).map(({ id, name, Icon }, index) => (
          <button
            role="tab"
            id={"collection-tab-" + id}
            aria-controls="collection-content"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            key={id}
            onClick={() => {
              setTab(id);
              setPage(1);
            }}
            onKeyDown={(e) => {
              const ids = ["all", "cards", "comics", "other"] as const;
              let next = index;
              if (e.key === "ArrowRight") next = (index + 1) % 4;
              else if (e.key === "ArrowLeft") next = (index + 3) % 4;
              else if (e.key === "Home") next = 0;
              else if (e.key === "End") next = 3;
              else return;
              e.preventDefault();
              setTab(ids[next]);
              setPage(1);
              document.getElementById("collection-tab-" + ids[next])?.focus();
            }}
          >
            <Icon size={16} />
            {name}
            <span>
              {id === "all"
                ? state.items.length
                : state.items.filter((i) => i.collectionType === id).length}
            </span>
          </button>
        ))}
      </div>
      <div
        id="collection-content"
        role="tabpanel"
        aria-labelledby={"collection-tab-" + tab}
      >
        {tab === "cards" && (
          <section className="panel collection-catalog">
            <div className="panel-heading">
              <div>
                <h2>Find your next collection item</h2>
                <p>
                  Search card data and variant pricing from JustTCG, or browse
                  TCGplayer directly.
                </p>
              </div>
              <button
                className="secondary"
                disabled={disabled}
                onClick={() =>
                  void window
                    .toolbox!.browseTcg()
                    .catch(() =>
                      setError("Could not open the TCGplayer catalog window."),
                    )
                }
              >
                <ExternalLink size={14} />
                Browse TCGplayer
              </button>
            </div>
            <div className="catalog-source">
              <LinkIcon size={12} />
              <span>tcgplayer.com/categories</span>
              <span>·</span>
              <span>Price data: JustTCG · USD</span>
              {openProduct && (
                <button
                  className="text-button"
                  disabled={disabled}
                  onClick={() => {
                    setQuery(openProduct);
                    void search(openProduct, 0);
                  }}
                >
                  Look up open product #{openProduct}
                </button>
              )}
            </div>
            <form
              className="catalog-search"
              onSubmit={(e) => {
                e.preventDefault();
                void search(query, 0);
              }}
            >
              <label>
                <span>Card name, TCGplayer product URL, or product ID</span>
                <div className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search card catalog"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    required
                    minLength={2}
                    maxLength={2048}
                    placeholder="e.g. Charizard, Black Lotus, or a product link"
                  />
                </div>
              </label>
              <label>
                <span>Game</span>
                <select
                  aria-label="Card game"
                  value={game}
                  onChange={(e) => setGame(e.target.value)}
                >
                  <option value="">All games</option>
                  {state.settings.games.map((g) => (
                    <option value={g.id} key={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                disabled={disabled || !state.settings.connected}
                type="submit"
              >
                <Search size={14} />
                Search
              </button>
            </form>
            {!state.settings.connected && (
              <div className="collection-setup">
                <ShieldCheck size={22} />
                <div>
                  <h3>Connect a free JustTCG personal key</h3>
                  <p>
                    TCGplayer browsing works separately. A pricing connection
                    enables in-app results and manual value refresh.
                  </p>
                  <button
                    className="text-button"
                    disabled={disabled}
                    onClick={() => open({ kind: "connect" })}
                  >
                    Set up pricing <ExternalLink size={12} />
                  </button>
                </div>
              </div>
            )}
            {state.settings.cooldownUntil > Date.now() && (
              <p className="collection-rate-note">
                Provider cooldown until{" "}
                {new Date(state.settings.cooldownUntil).toLocaleTimeString()}.
                Search and refresh remain subject to your plan limits.
              </p>
            )}
            <div className="catalog-budget">
              <span>
                20 results per page · Requests count toward your provider plan.
              </span>
              <span>
                {state.settings.dailyRemaining === null
                  ? ""
                  : `${state.settings.dailyRemaining} requests left today`}
                {state.settings.monthlyRemaining === null
                  ? ""
                  : ` · ${state.settings.monthlyRemaining} this billing month`}
              </span>
            </div>
            {searched &&
              !busy &&
              state.settings.connected &&
              lastSearch.searchQuery && (
                <div className="catalog-results-heading" role="status">
                  <span>
                    <b>
                      {cards.length}
                      {hasMore ? "+" : ""} results
                    </b>{" "}
                    for “{lastSearch.searchQuery}”
                  </span>
                  {lastSearch.searchQuery !== lastSearch.query &&
                    !/^https?:/i.test(lastSearch.query) && (
                      <span className="catalog-title-hint">
                        Searched the card name from your full product title.
                        Closest title/set matches appear first on this page.
                      </span>
                    )}
                </div>
              )}
            {!!cards.length && (
              <div className="catalog-grid">
                {cards.map((card) => (
                  <CatalogResultCard
                    key={card.id}
                    card={card}
                    disabled={disabled}
                    onAdd={(variant) => open({ kind: "add", card, variant })}
                    onOpen={() =>
                      card.productId &&
                      external(
                        "https://www.tcgplayer.com/product/" + card.productId,
                      )
                    }
                  />
                ))}
              </div>
            )}
            {searched && !cards.length && !busy && state.settings.connected && (
              <div className="empty">
                No catalog results to display. Check the query, connection, or
                any message above. Product coverage depends on the provider.
              </div>
            )}
            {!!cards.length && (
              <div className="table-bottom">
                <span>
                  Showing up to 20 matches · choose the exact printing,
                  condition, and language
                </span>
                <div className="expense-pagination">
                  <button
                    disabled={disabled || offset === 0}
                    onClick={() =>
                      void search(
                        lastSearch.query,
                        Math.max(0, offset - 20),
                        lastSearch.game,
                      )
                    }
                  >
                    Previous
                  </button>
                  <span>Page {Math.floor(offset / 20) + 1}</span>
                  <button
                    disabled={disabled || !hasMore}
                    onClick={() =>
                      void search(
                        lastSearch.query,
                        offset + 20,
                        lastSearch.game,
                      )
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            <p className="collection-browser-help">
              Artwork: TCGplayer product images where available. Prices:
              JustTCG, not TCGplayer lowest listings. Missing artwork does not
              prevent adding or refreshing a card. In the TCGplayer window,
              search normally and open a product. Choose{" "}
              <b>Catalog → Look up this product in Personal Toolbox</b> to bring
              it here. If the site blocks the in-app browser, use its menu to
              open the page in your system browser, then paste the product URL
              above.
            </p>
          </section>
        )}
        {tab === "comics" && (
          <section className="panel collection-comics">
            <BookOpen size={27} />
            <div>
              <h2>A home for your comic books</h2>
              <p>
                Add comics and update estimates manually now. This section is
                separate from trading cards and ready for a future approved
                comic catalog/pricing adapter.
              </p>
            </div>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => open({ kind: "manual" })}
            >
              <Plus size={14} />
              Add comic
            </button>
          </section>
        )}
        <section className="panel collection-inventory">
          <div className="panel-heading">
            <div>
              <h2>
                Collection inventory{" "}
                <span className="count">{items.length}</span>
              </h2>
              <p>
                Last recorded values, source timestamps, and ownership details
                in one place.
              </p>
            </div>
            <span className="gold">
              {money(
                items.reduce((n, i) => n + (i.valueCents ?? 0) * i.quantity, 0),
              )}{" "}
              known value
            </span>
          </div>
          <div className="table-toolbar">
            <label className="search">
              <Search size={15} />
              <input
                aria-label="Search owned collection"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(1);
                }}
                placeholder="Search your items, set, game, or variant…"
              />
            </label>
            <span className="collection-valuation-note">
              Estimates are not guaranteed sale prices.
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ITEM / VARIANT</th>
                  <th>QTY</th>
                  <th>UNIT COST</th>
                  <th>UNIT VALUE</th>
                  <th>VALUE STATUS</th>
                  <th className="right">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {items.slice((current - 1) * 25, current * 25).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="collection-owned-name">
                        {item.imageData ||
                        (item.provider === "justtcg" && item.productId) ? (
                          <CardArtwork
                            localImage={item.imageData}
                            productId={
                              item.provider === "justtcg"
                                ? item.productId
                                : null
                            }
                            name={item.name}
                            compact
                          />
                        ) : (
                          <span className="collection-art">
                            {item.collectionType === "comics" ? (
                              <BookOpen size={25} />
                            ) : (
                              <Layers size={25} />
                            )}
                          </span>
                        )}
                        <div>
                          <strong>{item.name}</strong>
                          <small>
                            {[item.category, item.setName]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                          <small>
                            {item.provider === "justtcg"
                              ? [item.printing, item.condition, item.language]
                                  .filter(Boolean)
                                  .join(" · ")
                              : "Manual valuation"}
                          </small>
                          {item.referenceUrl && item.provider === "justtcg" && (
                            <button
                              className="text-button"
                              disabled={disabled}
                              onClick={() => external(item.referenceUrl!)}
                            >
                              TCGplayer product <ExternalLink size={10} />
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>{item.quantity}</td>
                    <td>{money(item.purchaseCents)}</td>
                    <td className="total">
                      {item.valueCents === null
                        ? "Unavailable"
                        : money(item.valueCents)}
                      {item.valueCents === null &&
                        item.lastKnownCents !== null && (
                          <small>
                            Last recorded: {money(item.lastKnownCents)}
                          </small>
                        )}
                    </td>
                    <td>
                      <span
                        className={
                          "badge " +
                          (item.error
                            ? "processing"
                            : item.state === "current"
                              ? "delivered"
                              : item.state === "manual"
                                ? ""
                                : "processing")
                        }
                      >
                        {item.error
                          ? "Refresh failed"
                          : item.state === "current"
                            ? "JustTCG quote"
                            : item.state === "manual"
                              ? "Manual estimate"
                              : item.state === "expired"
                                ? "Expired quote"
                                : "No current quote"}
                      </span>
                      <small>
                        {item.observedAt
                          ? "Source: " +
                            new Date(item.observedAt).toLocaleString()
                          : item.provider === "justtcg"
                            ? "Source time unavailable"
                            : "User-entered value"}
                      </small>
                      <small>
                        {item.checkedAt
                          ? "Checked: " +
                            new Date(item.checkedAt).toLocaleString()
                          : "Not checked online"}
                      </small>
                      {item.error && (
                        <small className="collection-item-error">
                          {item.error}
                        </small>
                      )}
                    </td>
                    <td>
                      <div className="collection-row-actions">
                        <button
                          aria-label={"Refresh value " + item.name}
                          title={
                            item.provider === "justtcg"
                              ? "Fetch latest available provider quote"
                              : "Manual item: edit its estimate"
                          }
                          disabled={
                            disabled ||
                            item.provider !== "justtcg" ||
                            !state.settings.connected
                          }
                          onClick={() =>
                            void action(
                              () => window.toolbox!.refreshCollection(item.id),
                              "Value refreshed.",
                            )
                          }
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          aria-label={"Value history " + item.name}
                          title="Value history"
                          disabled={disabled}
                          onClick={() =>
                            void window
                              .toolbox!.collectionHistory(item.id)
                              .then((quotes) =>
                                open({ kind: "history", item, quotes }),
                              )
                              .catch(() =>
                                setError("Could not load value history."),
                              )
                          }
                        >
                          <History size={14} />
                        </button>
                        <button
                          aria-label={"Edit item " + item.name}
                          title="Edit ownership and photo"
                          disabled={disabled}
                          onClick={() => open({ kind: "edit", item })}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          aria-label={"Delete item " + item.name}
                          title="Remove from collection"
                          disabled={disabled}
                          onClick={() => open({ kind: "delete", item })}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!items.length && (
            <div className="expense-empty">
              <span>
                <Layers size={28} />
              </span>
              <h2>
                {loading
                  ? "Loading collection…"
                  : "Your collection starts here"}
              </h2>
              <p>
                {tab === "cards"
                  ? "Search above, select a variant, and add the quantity you own."
                  : "Add an item with its quantity, unit purchase cost, and optional value."}
              </p>
            </div>
          )}
          <div className="table-bottom">
            <span>
              {items.length} entries · USD · unavailable values excluded from
              totals
            </span>
            <div className="expense-pagination">
              <button
                disabled={current <= 1}
                onClick={() => setPage(current - 1)}
              >
                Previous
              </button>
              <span>
                {current} / {lastPage}
              </span>
              <button
                disabled={current >= lastPage}
                onClick={() => setPage(current + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>
      {modal && (
        <CollectionDialog
          busy={busy}
          title={
            modal.kind === "connect"
              ? "Connect JustTCG pricing"
              : modal.kind === "disconnect"
                ? "Disconnect pricing?"
                : modal.kind === "add"
                  ? "Add card to collection"
                  : modal.kind === "manual"
                    ? "Add collection item"
                    : modal.kind === "edit"
                      ? "Edit collection item"
                      : modal.kind === "delete"
                        ? "Remove collection item?"
                        : "Value history"
          }
          onClose={() => setModal(null)}
        >
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          {modal.kind === "connect" ? (
            <PricingConnection
              connected={state.settings.connected}
              supported={state.settings.supported}
              disabled={disabled}
              onHelp={() => external("https://justtcg.com/")}
              onConnect={(key) =>
                action(
                  () => window.toolbox!.connectPricing(key),
                  "Pricing connected. Search by card name or TCGplayer product link.",
                )
              }
              onDisconnect={() => open({ kind: "disconnect" })}
            />
          ) : modal.kind === "disconnect" || modal.kind === "delete" ? (
            <>
              <p className="expense-confirm-copy">
                {modal.kind === "disconnect"
                  ? "Remove the saved JustTCG API key? Your collection and saved value history will remain."
                  : "Remove “" +
                    modal.item.name +
                    "” and its saved value history? Orders and expenses are not changed."}
              </p>
              <div className="modal-actions">
                <button disabled={disabled} onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button
                  className="expense-danger-confirm"
                  disabled={disabled}
                  onClick={() =>
                    void (modal.kind === "disconnect"
                      ? action(
                          () => window.toolbox!.disconnectPricing(),
                          "Pricing disconnected. Saved values and history kept.",
                        )
                      : action(
                          () =>
                            window.toolbox!.deleteCollectible(modal.item.id),
                          "Item removed from collection.",
                        ))
                  }
                >
                  {busy
                    ? "Saving…"
                    : modal.kind === "disconnect"
                      ? "Disconnect"
                      : "Remove item"}
                </button>
              </div>
            </>
          ) : modal.kind === "add" ? (
            <AddCatalogItem
              card={modal.card}
              variant={modal.variant}
              busy={disabled}
              onCancel={() => setModal(null)}
              onSave={(quantity, purchaseCents) =>
                action(
                  () =>
                    window.toolbox!.addCatalogItem({
                      selectionId: modal.variant.selectionId,
                      quantity,
                      purchaseCents,
                    }),
                  "Card added with its selected variant and saved quote.",
                )
              }
            />
          ) : modal.kind === "manual" || modal.kind === "edit" ? (
            <ManualItemForm
              item={modal.kind === "edit" ? modal.item : undefined}
              defaultTab={tab === "all" ? "other" : tab}
              busy={disabled}
              onCancel={() => setModal(null)}
              onSave={(input) =>
                modal.kind === "edit"
                  ? action(
                      () =>
                        window.toolbox!.editCollectible({
                          id: modal.item.id,
                          item: input,
                        }),
                      "Collection item updated.",
                    )
                  : action(
                      () => window.toolbox!.addManualCollectible(input),
                      "Collection item added.",
                    )
              }
            />
          ) : (
            <PriceHistory item={modal.item} quotes={modal.quotes} />
          )}
        </CollectionDialog>
      )}
    </div>
  );
}
function CatalogResultCard({
  card,
  disabled,
  onAdd,
  onOpen,
}: {
  card: CatalogCard;
  disabled: boolean;
  onAdd: (v: CatalogVariant) => void;
  onOpen: () => void;
}) {
  const [selected, setSelected] = useState("");
  const variant = card.variants.find((v) => v.id === selected);
  const priced = card.variants.flatMap((v) =>
    v.valueCents === null ? [] : [v.valueCents],
  );
  const minimum = priced.length ? Math.min(...priced) : null;
  return (
    <article className="catalog-card">
      <CardArtwork productId={card.productId} name={card.name} />
      <div className="catalog-card-heading">
        <h3 title={card.name}>{card.name}</h3>
        <p>
          {card.setName}
          {card.number ? " · #" + card.number : ""}
        </p>
      </div>
      <label>
        Choose variant
        <select
          aria-label={"Variant for " + card.name}
          title={
            variant
              ? [variant.printing, variant.condition, variant.language].join(
                  " · ",
                )
              : "Choose the printing, condition, and language"
          }
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={disabled}
        >
          <option value="">Select variant…</option>
          {card.variants.map((v) => (
            <option key={v.id} value={v.id}>
              {[v.printing, v.condition, v.language].join(" · ")} —{" "}
              {v.valueCents === null ? "No current quote" : money(v.valueCents)}
            </option>
          ))}
        </select>
      </label>
      <div className="catalog-card-price">
        <strong>
          {variant
            ? variant.valueCents === null
              ? "Unavailable"
              : money(variant.valueCents)
            : minimum === null
              ? "Unavailable"
              : "From " + money(minimum)}
        </strong>
        <span>
          {variant ? "JustTCG · per item" : "Across available variants"}
        </span>
      </div>
      <div className="catalog-card-actions">
        <button
          className="primary"
          disabled={disabled || !variant}
          onClick={() => variant && onAdd(variant)}
        >
          <Plus size={14} />
          Add to collection
        </button>
        {card.productId && (
          <button className="text-button" disabled={disabled} onClick={onOpen}>
            TCGplayer <ExternalLink size={12} />
          </button>
        )}
      </div>
    </article>
  );
}
function CollectionDialog({
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
      ref={ref}
      className="expense-dialog collection-dialog"
      aria-labelledby="collection-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="expense-dialog-heading">
        <h2 id="collection-dialog-title">{title}</h2>
        <button
          aria-label="Close collection dialog"
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
function PricingConnection({
  connected,
  supported,
  disabled,
  onHelp,
  onConnect,
  onDisconnect,
}: {
  connected: boolean;
  supported: boolean;
  disabled: boolean;
  onHelp: () => void;
  onConnect: (key: string) => Promise<boolean>;
  onDisconnect: () => void;
}) {
  const [key, setKey] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = key;
        setKey("");
        void onConnect(value);
      }}
    >
      <p className="collection-form-note">
        Create a JustTCG account, choose its free personal-use plan, and copy
        the API key from your dashboard. The free plan has request limits;
        product coverage and prices are supplied by JustTCG.
      </p>
      <button className="text-button" type="button" onClick={onHelp}>
        Open JustTCG signup/dashboard <ExternalLink size={13} />
      </button>
      {!supported && (
        <div className="alert">
          Saving API keys requires Windows Credential Manager. Connect on your
          Windows PC.
        </div>
      )}
      <label className="collection-key-label">
        JustTCG API key
        <input
          autoFocus
          aria-label="JustTCG API key"
          type="password"
          autoComplete="off"
          required
          minLength={10}
          maxLength={256}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          disabled={disabled || !supported}
        />
      </label>
      <p className="collection-form-note">
        <ShieldCheck size={13} /> The key is stored in Windows Credential
        Manager and never returned to this screen. It is saved only after the
        provider accepts it.
      </p>
      <div className="modal-actions">
        {connected && (
          <button
            type="button"
            className="danger-button"
            disabled={disabled}
            onClick={onDisconnect}
          >
            Disconnect pricing
          </button>
        )}
        <button
          type="submit"
          className="primary"
          disabled={disabled || !supported}
        >
          {disabled ? "Testing…" : connected ? "Update key" : "Connect pricing"}
        </button>
      </div>
    </form>
  );
}
function AddCatalogItem({
  card,
  variant,
  busy,
  onCancel,
  onSave,
}: {
  card: CatalogCard;
  variant: CatalogVariant;
  busy: boolean;
  onCancel: () => void;
  onSave: (quantity: number, cost: number) => Promise<boolean>;
}) {
  const [cost, setCost] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const cents = amountToCents(cost);
        if (cents === null) {
          setError(
            "Enter a unit purchase price with up to two decimal places.",
          );
          return;
        }
        const form = new FormData(e.currentTarget);
        void onSave(Number(form.get("quantity")), cents);
      }}
    >
      <div className="collection-selected-card">
        <CardArtwork productId={card.productId} name={card.name} compact />
        <h3 className="collection-selected-name">{card.name}</h3>
      </div>
      <p className="collection-form-note">
        {card.setName} · {variant.printing} · {variant.condition} ·{" "}
        {variant.language}
      </p>
      <div className="collection-selected-price">
        <span>Current provider value</span>
        <strong>
          {variant.valueCents === null
            ? "Unavailable"
            : money(variant.valueCents)}
        </strong>
        <small>
          {variant.observedAt
            ? "Source observed: " +
              new Date(variant.observedAt).toLocaleString()
            : "Source timestamp unavailable"}{" "}
          · Checked {new Date(card.checkedAt).toLocaleString()}
        </small>
      </div>
      <fieldset disabled={busy}>
        <div className="form-grid">
          <label>
            Quantity owned
            <input
              autoFocus
              name="quantity"
              type="number"
              required
              min="1"
              max="100000"
              step="1"
              defaultValue="1"
            />
          </label>
          <label>
            Unit purchase price ($)
            <input
              aria-label="Unit purchase price ($)"
              type="number"
              required
              min="0"
              max="10000000"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0.00"
            />
          </label>
        </div>
        <p className="collection-form-note">
          Enter your cost per item, not the total for all copies. Use 0 for a
          gift. Adding saves this exact variant; Refresh value requests its
          latest available quote.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Add to collection"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
function ManualItemForm({
  item,
  defaultTab,
  busy,
  onSave,
  onCancel,
}: {
  item?: OwnedCollectible;
  defaultTab: CollectionTab;
  busy: boolean;
  onSave: (input: ManualCollectible) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [cost, setCost] = useState(
    item ? (item.purchaseCents / 100).toFixed(2) : "",
  );
  const [value, setValue] = useState(
    item?.valueCents !== null && item?.valueCents !== undefined
      ? (item.valueCents / 100).toFixed(2)
      : "",
  );
  const [image, setImage] = useState<string | null>(item?.imageData || null);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const linked = item?.provider === "justtcg";
  const photo = async () => {
    setPicking(true);
    try {
      const result = await window.toolbox!.chooseCollectionImage();
      if (result.error) setError(result.error);
      else if (result.data) setImage(result.data);
    } catch {
      setError("Could not open that image.");
    } finally {
      setPicking(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        const purchaseCents = amountToCents(cost);
        const valueCents = value.trim() === "" ? null : amountToCents(value);
        if (
          purchaseCents === null ||
          (valueCents === null && value.trim() !== "")
        ) {
          setError("Enter amounts with up to two decimal places.");
          return;
        }
        const f = new FormData(e.currentTarget);
        void onSave({
          name: linked ? item!.name : String(f.get("name")),
          category: linked ? item!.category : String(f.get("category")),
          collectionType: linked
            ? item!.collectionType
            : (String(f.get("collectionType")) as CollectionTab),
          quantity: Number(f.get("quantity")),
          purchaseCents,
          valueCents: linked ? item!.valueCents : valueCents,
          referenceUrl: linked
            ? item!.referenceUrl
            : String(f.get("referenceUrl") || "").trim() || null,
          imageData: image,
        });
      }}
    >
      <fieldset disabled={busy || picking}>
        <label>
          Item name
          <input
            autoFocus
            name="name"
            required
            maxLength={200}
            defaultValue={item?.name}
            disabled={linked}
            placeholder="e.g. Comic title, issue #1"
          />
        </label>
        <div className="form-grid">
          <label>
            Section
            <select
              aria-label="Collection section"
              name="collectionType"
              defaultValue={item?.collectionType || defaultTab}
              disabled={linked}
            >
              <option value="cards">Trading cards</option>
              <option value="comics">Comic books</option>
              <option value="other">Other collectibles</option>
            </select>
          </label>
          <label>
            Category / game
            <input
              name="category"
              required
              maxLength={80}
              defaultValue={
                item?.category ||
                (defaultTab === "comics"
                  ? "Comics"
                  : defaultTab === "cards"
                    ? "Trading cards"
                    : "Collectibles")
              }
              disabled={linked}
            />
          </label>
          <label>
            Quantity owned
            <input
              name="quantity"
              type="number"
              required
              min="1"
              max="100000"
              step="1"
              defaultValue={item?.quantity || 1}
            />
          </label>
          <label>
            Unit purchase price ($)
            <input
              aria-label="Unit purchase price ($)"
              type="number"
              min="0"
              max="10000000"
              step="0.01"
              required
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
          <label>
            Unit value estimate ($)
            <input
              aria-label="Unit value estimate ($)"
              type="number"
              min="0"
              max="10000000"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={linked}
              placeholder="Optional — unknown if blank"
            />
          </label>
        </div>
        <label>
          Reference URL
          <input
            name="referenceUrl"
            type="url"
            maxLength={2048}
            defaultValue={item?.referenceUrl || ""}
            disabled={linked}
            placeholder="https://… (optional)"
          />
        </label>
        <div className="collection-photo-edit">
          {image && <img src={image} alt="Selected collection photo" />}
          <button
            className="secondary"
            type="button"
            disabled={busy || picking}
            onClick={() => void photo()}
          >
            <ImagePlus size={14} />
            {picking ? "Opening…" : image ? "Change photo" : "Add your photo"}
          </button>
          {image && (
            <button
              className="text-button"
              type="button"
              onClick={() => setImage(null)}
            >
              Remove photo
            </button>
          )}
        </div>
        <p className="collection-form-note">
          {linked
            ? "The selected catalog identity and online quote are fixed. Edit quantity, purchase cost, or your photo here; use Refresh value for pricing."
            : "Values here are manual estimates. A reference link does not enable automatic pricing. Leave value blank if unknown; this excludes it from market totals."}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy || picking} onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" disabled={busy || picking}>
            {busy ? "Saving…" : item ? "Save item" : "Add item"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
function PriceHistory({
  item,
  quotes,
}: {
  item: OwnedCollectible;
  quotes: QuoteObservation[];
}) {
  const data = [...quotes].reverse().map((q) => ({
    date: new Date(q.checkedAt).toLocaleString(),
    value: q.valueCents === null ? null : q.valueCents / 100,
  }));
  return (
    <>
      <h3 className="collection-selected-name">{item.name}</h3>
      <p className="collection-form-note">
        Up to 100 saved observations. Checked time is when this app requested
        data; source time is when the provider last observed its quote.
      </p>
      {quotes.length > 1 && (
        <div className="collection-history-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="#30353d" strokeDasharray="3 4" />
              <XAxis dataKey="date" hide />
              <YAxis
                tick={{ fill: "#8993a3", fontSize: 10 }}
                width={55}
                tickFormatter={(value) => "$" + value}
              />
              <Tooltip
                contentStyle={{
                  background: "#1b2029",
                  border: "1px solid #3b4350",
                }}
                formatter={(value) => money(Number(value) * 100)}
              />
              <Line
                isAnimationActive={false}
                type="linear"
                dataKey="value"
                stroke="#d6b56b"
                dot={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>CHECKED</th>
              <th>UNIT VALUE</th>
              <th>SOURCE / STATUS</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id}>
                <td>
                  {new Date(q.checkedAt).toLocaleString()}
                  <small>
                    {q.observedAt
                      ? "Source: " + new Date(q.observedAt).toLocaleString()
                      : "No source timestamp"}
                  </small>
                </td>
                <td>
                  {q.valueCents === null ? "Unavailable" : money(q.valueCents)}
                </td>
                <td>
                  {q.source}
                  <small>{q.state}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!quotes.length && (
        <div className="empty">
          No price observations saved yet. Refresh an API-linked item or edit a
          manual estimate to start its history.
        </div>
      )}
    </>
  );
}
