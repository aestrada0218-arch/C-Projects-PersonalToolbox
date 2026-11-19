import { Pagination, usePagination } from "./pagination";
import { listenForDataChanges } from "./data-changes";
import { operationError } from "./operation-error";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link as LinkIcon,
  Plus,
  RefreshCw,
  ShieldCheck,
  Tag,
  Trash2,
  Upload,
  X,
  AlertTriangle,
  Pencil,
  Search,
} from "lucide-react";
import type {
  ListingDraft,
  SellingUnit,
  SellingState,
  SellingResult,
  SellingReviewResult,
  PublishReview,
  EbayConnectionInput,
  SellingOptions,
  CategoryGuide,
} from "./selling-types";
import { listingConditions } from "./selling-types";
import { amountToCents } from "./expense-types";
const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const when = (date: string | null) =>
  date ? new Date(date).toLocaleString() : "Not checked yet";
const empty: SellingState = {
  units: [],
  stock: [],
  settings: {
    connected: false,
    supported: true,
    environment: "sandbox",
    label: "",
    connectionKey: null,
    automatic: true,
    options: { locations: [], fulfillment: [], payment: [], returns: [] },
    lastSync: null,
    nextSync: null,
    cooldownUntil: 0,
    error: null,
  },
  busy: false,
  progress: "",
};
type Modal =
  | { kind: "draft"; item?: SellingUnit; collectionId?: string }
  | { kind: "connect" }
  | { kind: "location" }
  | { kind: "review"; review: PublishReview }
  | { kind: "link"; item: SellingUnit }
  | {
      kind: "confirm";
      action:
        "end" | "inactive" | "delete" | "conflict" | "sale" | "disconnect";
      item?: SellingUnit;
    };
export const sellingNeedsAction = (u: SellingUnit) =>
  Boolean(
    (u.soldOn === "ebay" && u.mercariState === "active") ||
    (u.soldOn === "mercari" &&
      u.offerId &&
      !["inactive", "sold"].includes(u.ebayState)) ||
    (u.conflict && !u.conflictReviewed) ||
    u.ebayState === "uncertain" ||
    u.error,
  );
export default function SellingPanel({
  itemRequest,
  onChanged,
}: {
  itemRequest: { id: string; nonce: number } | null;
  onChanged: () => void;
}) {
  const [state, setState] = useState(empty),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [modal, setModal] = useState<Modal | null>(null),
    [filter, setFilter] = useState("All pairs"),
    [query, setQuery] = useState("");
  const running = useRef(false),
    revision = useRef(0),
    handled = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (running.current) return;
      const rev = revision.current;
      try {
        const value = await window.toolbox!.sellingState();
        if (alive && revision.current === rev) {
          setState(value);
          setLoading(false);
        }
      } catch {
        if (alive) {
          setError("Could not load selling records. Reopen Selling to retry.");
          setLoading(false);
        }
      }
    };
    void load();
    const unsubscribeChanges = listenForDataChanges(() => void load());
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
      unsubscribeChanges();
    };
  }, []);
  useEffect(() => {
    if (loading || !itemRequest || handled.current === itemRequest.nonce)
      return;
    handled.current = itemRequest.nonce;
    const stock = state.stock.find((i) => i.id === itemRequest.id);
    if (!stock || stock.allocated >= stock.quantity) {
      setError(
        "No unallocated copies remain for this collection entry. Existing draft and sold records reserve copies.",
      );
      return;
    }
    setModal({ kind: "draft", collectionId: itemRequest.id });
  }, [loading, itemRequest?.nonce]);
  const disabled = busy || state.busy;
  async function action(
    fn: () => Promise<SellingResult | SellingReviewResult>,
    message: string,
  ) {
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
        setError(result.error || "Selling request failed.");
        return false;
      }
      setNotice(message);
      const review = (result as SellingReviewResult).review;
      setModal(review ? { kind: "review", review } : null);
      onChanged();
      return true;
    } catch (error) {
      setError(
        operationError(
          error,
          "Could not complete the selling request. Check the app connection and retry.",
        ),
      );
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const open = (value: Modal) => {
    window.toolbox?.captureEdit?.(value);
    setError("");
    setModal(value);
  };
  const uploadPhoto = (unit: SellingUnit) => {
    window.toolbox?.captureEdit?.(unit);
    return window.toolbox!.uploadSellingPhoto(unit.id);
  };
  const external = (item: SellingUnit, platform: "ebay" | "mercari") =>
    void window
      .toolbox!.openSellingListing({ id: item.id, platform })
      .catch(() => setError("The saved listing link could not be opened."));
  const help = (page: "ebay" | "mercari") =>
    void window
      .toolbox!.openSellingHelp(page)
      .catch(() => setError("Could not open your system browser."));
  const copy = (item: SellingUnit, field: "all" | "title" | "description") =>
    void window
      .toolbox!.copySellingDraft({ id: item.id, field })
      .then(() =>
        setNotice(
          "Listing text copied. Paste it into Mercari and choose its category, condition and shipping settings there.",
        ),
      )
      .catch(() => setError("Could not copy the saved draft."));
  const pending = state.units.filter(sellingNeedsAction);
  const matching = state.units.filter(
    (u) =>
      (filter === "All pairs" ||
        (filter === "Needs attention" && sellingNeedsAction(u)) ||
        (filter === "Drafts" &&
          !u.soldOn &&
          ["draft", "prepared"].includes(u.ebayState)) ||
        (filter === "Sold" && u.soldOn)) &&
      [u.title, u.unitLabel, u.sku, u.ebayListingId, u.mercariId]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pagination = usePagination(matching, JSON.stringify([filter, query]));
  const { setPage } = pagination;
  if (loading)
    return <div className="panel loading">Loading your listing workspace…</div>;
  return (
    <div className="selling-module">
      <div className="title-row">
        <div>
          <div className="eyebrow">ONE ITEM. TWO MARKETPLACES.</div>
          <h1>
            Selling<span className="gold">.</span>
          </h1>
          <p>
            Prepare a shared draft, publish to eBay, and track the matching
            Mercari listing.
          </p>
        </div>
        <div className="actions">
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => open({ kind: "connect" })}
          >
            <ShieldCheck size={15} />
            {state.settings.connected ? "eBay connection" : "Connect eBay"}
          </button>
          <button
            className="primary"
            disabled={
              disabled || !state.stock.some((i) => i.allocated < i.quantity)
            }
            onClick={() => open({ kind: "draft" })}
          >
            <Plus size={16} />
            New listing draft
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
            aria-label="Dismiss selling notification"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <section className="stats expense-stats">
        <article className="stat panel" aria-label="Listing pairs">
          <div className="stat-top">
            Listing pairs
            <Tag size={17} />
          </div>
          <strong>{state.units.length}</strong>
          <div className="stat-detail">One reserved copy per pair</div>
        </article>
        <article className="stat panel" aria-label="Active on eBay">
          <div className="stat-top">
            Active on eBay
            <ArrowUpRight size={17} />
          </div>
          <strong>
            {state.units.filter((u) => u.ebayState === "active").length}
          </strong>
          <div className="stat-detail">
            Includes the displayed test/live environment
          </div>
        </article>
        <article className="stat panel" aria-label="Needs attention">
          <div className="stat-top">
            Needs attention
            <AlertTriangle size={17} />
          </div>
          <strong className={pending.length ? "shipping-overdue-text" : ""}>
            {pending.length}
          </strong>
          <div className="stat-detail">
            Removal reminders or uncertain results
          </div>
        </article>
        <article className="stat panel" aria-label="Recorded sold copies">
          <div className="stat-top">
            Recorded sold copies
            <CheckCircle2 size={17} />
          </div>
          <strong>{state.units.filter((u) => u.soldOn).length}</strong>
          <div className="stat-detail">
            Reserved against the original collection lot
          </div>
        </article>
      </section>
      <section className="panel selling-connection">
        <div>
          <h2>
            <span className="selling-ebay-word">eBay</span>{" "}
            {state.settings.connected
              ? state.settings.label
              : "Seller API not connected"}
          </h2>
          <p>
            {state.settings.connected ? (
              <>
                <span
                  className={
                    state.settings.environment === "production"
                      ? "badge delivered"
                      : "badge processing"
                  }
                >
                  {state.settings.environment === "production"
                    ? "LIVE · real listings"
                    : "SANDBOX · test listings"}
                </span>{" "}
                Last completed sales check: {when(state.settings.lastSync)}
              </>
            ) : (
              "Local drafts and Mercari links work without an API account. Connect eBay to prepare, publish, and end offers."
            )}
          </p>
        </div>
        <div className="actions">
          <button
            disabled={disabled || !state.settings.connected}
            onClick={() =>
              void action(
                () => window.toolbox!.syncSelling(),
                "eBay sales/status check completed. Review any removal reminders below.",
              )
            }
          >
            <RefreshCw size={14} className={disabled ? "spinning" : ""} />
            Check sales now
          </button>
          <button
            disabled={disabled || !state.settings.connected}
            onClick={() =>
              void action(
                () => window.toolbox!.refreshSellingOptions(),
                "eBay policy and location choices refreshed.",
              )
            }
          >
            Refresh policies
          </button>
          <button
            disabled={disabled || !state.settings.connected}
            onClick={() => open({ kind: "location" })}
          >
            Add ship-from ZIP
          </button>
        </div>
        <label className="selling-auto">
          <input
            type="checkbox"
            aria-label="Automatically check eBay sales"
            checked={state.settings.automatic}
            disabled={disabled}
            onChange={(e) => {
              if (running.current) return;
              const automatic = e.target.checked;
              setState((s) => ({
                ...s,
                settings: { ...s.settings, automatic },
              }));
              void action(
                () => window.toolbox!.setSellingAuto(automatic),
                "Automatic eBay sales checking preference saved.",
              );
            }}
          />
          Check eBay about every 5 minutes while this app is open
        </label>
        <p className="selling-note">
          Mercari publishing and deactivation are manual. This app never marks
          Mercari inactive until you confirm you did it there. It cannot prevent
          simultaneous purchases; check both platforms when a sale arrives.
          Closing the app pauses checks.
        </p>
        {state.settings.nextSync &&
          state.settings.connected &&
          state.settings.automatic && (
            <p className="selling-note">
              Next check: {when(state.settings.nextSync)}
            </p>
          )}
        {state.settings.error && (
          <div className="alert" role="alert">
            {state.settings.error}
          </div>
        )}
        {state.progress && <p role="status">{state.progress}</p>}
      </section>
      {!!pending.length && (
        <div className="selling-attention-banner" role="status">
          <AlertTriangle size={20} />
          <div>
            <strong>
              {pending.length} listing pair
              {pending.length === 1 ? " needs" : "s need"} attention
            </strong>
            <p>
              Follow-ups remain open until the exact other listing is confirmed
              inactive.
            </p>
          </div>
          <button
            className="text-button"
            onClick={() => {
              setFilter("Needs attention");
              setPage(1);
            }}
          >
            Show follow-ups
          </button>
        </div>
      )}
      <section className="panel selling-list">
        <div className="table-toolbar">
          <label className="search">
            <Search size={15} />
            <input
              aria-label="Search listing pairs"
              placeholder="Search title, copy label, SKU or listing ID…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            aria-label="Listing pair filter"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            {["All pairs", "Needs attention", "Drafts", "Sold"].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <span className="selling-note">
            {matching.length} pairs · Quantity 1 per marketplace
          </span>
        </div>
        {!matching.length ? (
          <div className="empty shipping-empty">
            <Tag size={30} />
            <h3>
              {state.units.length
                ? "No pairs match this filter"
                : "Your next sale starts here"}
            </h3>
            <p>
              Use Sell from your collection, or create a draft here. Each pair
              links the exact same physical copy on both platforms.
            </p>
          </div>
        ) : (
          <div className="selling-grid">
            {pagination.visible.map((unit) => {
              const editable =
                  !unit.soldOn &&
                  ["draft", "prepared"].includes(unit.ebayState),
                needsMercari =
                  unit.soldOn === "ebay" && unit.mercariState === "active",
                needsEbay =
                  unit.soldOn === "mercari" &&
                  unit.offerId &&
                  !["inactive", "sold"].includes(unit.ebayState);
              return (
                <article
                  className={
                    "selling-unit" +
                    (sellingNeedsAction(unit) ? " selling-unit-attention" : "")
                  }
                  key={unit.id}
                  aria-label={unit.unitLabel}
                >
                  <div className="selling-unit-heading">
                    <div>
                      <span className="eyebrow">{unit.unitLabel}</span>
                      <h2>{unit.title}</h2>
                      <p className="selling-sku">SKU: {unit.sku}</p>
                    </div>
                    <strong>{dollars(unit.priceCents)}</strong>
                  </div>
                  {unit.soldOn && (
                    <div className="selling-sold">
                      <CheckCircle2 size={15} />
                      Sold on {unit.soldOn === "ebay"
                        ? "eBay"
                        : "Mercari"} · {when(unit.soldAt)}
                      {unit.saleReference && (
                        <small>Reference: {unit.saleReference}</small>
                      )}
                    </div>
                  )}
                  {unit.conflict && (
                    <div className="alert" role="alert">
                      Both marketplaces have a recorded sale for this copy.
                      Review both orders directly.{" "}
                      {unit.conflictReviewed ? (
                        <span>Marked reviewed locally.</span>
                      ) : (
                        <button
                          className="text-button"
                          disabled={disabled}
                          onClick={() =>
                            open({
                              kind: "confirm",
                              action: "conflict",
                              item: unit,
                            })
                          }
                        >
                          Mark reviewed
                        </button>
                      )}
                    </div>
                  )}
                  <div className="selling-marketplaces">
                    <div className="selling-market">
                      <div>
                        <h3>
                          eBay{" "}
                          <span
                            className={
                              unit.ebayState === "active"
                                ? "badge delivered"
                                : "badge processing"
                            }
                          >
                            {unit.ebayState}
                          </span>
                        </h3>
                        <small>
                          {unit.environment
                            ? unit.environment.toUpperCase()
                            : "Not prepared"}{" "}
                          ·{" "}
                          {unit.ebayListingId
                            ? `Listing ${unit.ebayListingId}`
                            : unit.offerId
                              ? `Unpublished offer ${unit.offerId}`
                              : "No remote offer"}
                        </small>
                      </div>
                      <div className="selling-market-actions">
                        {unit.ebayListingId && (
                          <button
                            className="text-button"
                            disabled={disabled}
                            onClick={() => external(unit, "ebay")}
                          >
                            <ExternalLink size={13} />
                            Open listing
                          </button>
                        )}
                        {editable && (
                          <button
                            className="secondary"
                            disabled={disabled || !state.settings.connected}
                            onClick={() =>
                              void action(
                                () => window.toolbox!.prepareEbayOffer(unit.id),
                                "Offer prepared or existing remote state reconciled. Publishing requires the review dialog.",
                              )
                            }
                          >
                            Prepare / review
                          </button>
                        )}
                        {unit.offerId && (
                          <button
                            className="text-button"
                            disabled={disabled || !state.settings.connected}
                            onClick={() =>
                              void action(
                                () =>
                                  window.toolbox!.reconcileEbayOffer(unit.id),
                                "eBay offer status checked. No new listing was published.",
                              )
                            }
                          >
                            Check status
                          </button>
                        )}
                        {unit.offerId &&
                          !["inactive", "sold"].includes(unit.ebayState) && (
                            <button
                              className="text-button"
                              disabled={disabled || !state.settings.connected}
                              onClick={() =>
                                open({
                                  kind: "confirm",
                                  action: "end",
                                  item: unit,
                                })
                              }
                            >
                              End eBay offer
                            </button>
                          )}
                      </div>
                    </div>
                    <div className="selling-market">
                      <div>
                        <h3>
                          Mercari{" "}
                          <span
                            className={
                              unit.mercariState === "active"
                                ? "badge delivered"
                                : "badge processing"
                            }
                          >
                            {unit.mercariState}
                          </span>
                        </h3>
                        <small>
                          {unit.mercariId
                            ? `Listing ${unit.mercariId}`
                            : "Publish manually, then link its exact item URL"}
                        </small>
                      </div>
                      <div className="selling-market-actions">
                        <button
                          className="text-button"
                          onClick={() => copy(unit, "all")}
                        >
                          <Copy size={13} />
                          Copy draft
                        </button>
                        <button
                          className="text-button"
                          onClick={() => copy(unit, "title")}
                        >
                          Copy title
                        </button>
                        <button
                          className="text-button"
                          onClick={() => copy(unit, "description")}
                        >
                          Copy description
                        </button>
                        {unit.mercariId && (
                          <button
                            className="text-button"
                            onClick={() => external(unit, "mercari")}
                          >
                            <ExternalLink size={13} />
                            Open exact listing
                          </button>
                        )}
                        {!unit.soldOn &&
                          ["unlinked", "inactive"].includes(
                            unit.mercariState,
                          ) && (
                            <button
                              className="secondary"
                              disabled={disabled}
                              onClick={() => open({ kind: "link", item: unit })}
                            >
                              <LinkIcon size={13} />
                              {unit.mercariId
                                ? "Link replacement"
                                : "Link listing"}
                            </button>
                          )}
                        {unit.mercariState === "active" && (
                          <>
                            <button
                              className="text-button"
                              disabled={disabled}
                              onClick={() =>
                                open({
                                  kind: "confirm",
                                  action: "sale",
                                  item: unit,
                                })
                              }
                            >
                              Record Mercari sale
                            </button>
                            <button
                              className="text-button"
                              disabled={disabled}
                              onClick={() =>
                                open({
                                  kind: "confirm",
                                  action: "inactive",
                                  item: unit,
                                })
                              }
                            >
                              Confirm inactive
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {needsMercari && (
                    <div className="selling-followup">
                      <AlertTriangle size={16} />
                      <div>
                        <strong>Remove the linked Mercari listing</strong>
                        <p>
                          This copy sold on eBay. Open Mercari, deactivate{" "}
                          {unit.mercariId}, then use Confirm inactive.
                        </p>
                      </div>
                    </div>
                  )}
                  {needsEbay && (
                    <div className="selling-followup">
                      <AlertTriangle size={16} />
                      <div>
                        <strong>End the linked eBay offer</strong>
                        <p>
                          This copy was recorded sold on Mercari. The eBay
                          ending is not yet confirmed. Reconnect eBay or retry
                          End eBay offer.
                        </p>
                      </div>
                    </div>
                  )}
                  {unit.error && (
                    <p className="error" role="alert">
                      {unit.error}
                    </p>
                  )}
                  <div className="selling-unit-footer">
                    <span>
                      {unit.photoUrls.length} listing photos · 1 reserved copy
                    </span>
                    <div>
                      {editable && (
                        <>
                          <button
                            className="text-button"
                            disabled={disabled}
                            aria-label={`Edit listing draft ${unit.title}`}
                            onClick={() => open({ kind: "draft", item: unit })}
                          >
                            <Pencil size={14} />
                            Edit draft
                          </button>
                          <button
                            className="text-button"
                            disabled={
                              disabled ||
                              !state.settings.connected ||
                              unit.photoUrls.length >= 24
                            }
                            onClick={() =>
                              void action(
                                () => uploadPhoto(unit),
                                "Your photo was uploaded to eBay and added to this draft.",
                              )
                            }
                          >
                            <Upload size={14} />
                            Upload photo
                          </button>
                        </>
                      )}
                      {!unit.offerId && !unit.mercariId && !unit.soldOn && (
                        <button
                          className="text-button"
                          disabled={disabled}
                          aria-label={`Delete listing draft ${unit.title}`}
                          onClick={() =>
                            open({
                              kind: "confirm",
                              action: "delete",
                              item: unit,
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <div className="table-bottom">
          <span>
            Copies stay allocated after sale. Collection quantities and
            financial totals are not changed automatically.
          </span>
          <Pagination value={pagination} label="selling" />
        </div>
      </section>
      {modal && (
        <SellingDialog
          title={
            modal.kind === "draft"
              ? modal.item
                ? "Edit shared listing draft"
                : "New shared listing draft"
              : modal.kind === "connect"
                ? "eBay seller connection"
                : modal.kind === "location"
                  ? "Add eBay ship-from location"
                  : modal.kind === "review"
                    ? "Review eBay publication"
                    : modal.kind === "link"
                      ? "Link the exact Mercari listing"
                      : modal.action === "sale"
                        ? "Record a Mercari sale"
                        : modal.action === "inactive"
                          ? "Confirm Mercari is inactive"
                          : modal.action === "end"
                            ? "End this eBay offer"
                            : modal.action === "delete"
                              ? "Delete unused draft"
                              : modal.action === "disconnect"
                                ? "Disconnect eBay"
                                : "Review double sale"
          }
          busy={disabled}
          onClose={() => setModal(null)}
        >
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          {modal.kind === "draft" ? (
            <DraftForm
              item={modal.item}
              collectionId={modal.collectionId}
              state={state}
              busy={disabled}
              onCancel={() => setModal(null)}
              onSave={(draft) =>
                modal.item
                  ? action(
                      () =>
                        window.toolbox!.editSellingDraft({
                          id: modal.item!.id,
                          draft,
                        }),
                      "Shared draft saved. Prepare it again before publishing.",
                    )
                  : action(
                      () => window.toolbox!.createSellingDraft(draft),
                      "One copy reserved. Add your photos and eBay details before preparing the offer.",
                    )
              }
            />
          ) : modal.kind === "connect" ? (
            <ConnectionForm
              state={state}
              busy={disabled}
              onHelp={() => help("ebay")}
              onConnect={(input) =>
                action(
                  () => window.toolbox!.connectEbay(input),
                  "eBay connection verified and saved in Windows Credential Manager.",
                )
              }
              onDisconnect={() =>
                open({ kind: "confirm", action: "disconnect" })
              }
            />
          ) : modal.kind === "location" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void action(
                  () =>
                    window.toolbox!.createSellingLocation({
                      name: String(data.get("name")),
                      zip: String(data.get("zip")),
                    }),
                  "Ship-from location added to your eBay account.",
                );
              }}
            >
              <p className="collection-form-note">
                Creates a warehouse location in your connected eBay account
                using a US postal code. This affects the shipping origin for
                future listings.
              </p>
              <label>
                Location name
                <input
                  name="name"
                  required
                  maxLength={80}
                  placeholder="My shipping location"
                />
              </label>
              <label>
                US postal code
                <input
                  name="zip"
                  required
                  pattern="[0-9]{5}(-[0-9]{4})?"
                  placeholder="ZIP or ZIP+4"
                />
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button className="primary" disabled={disabled}>
                  Create location in eBay
                </button>
              </div>
            </form>
          ) : modal.kind === "review" ? (
            <PublishForm
              review={modal.review}
              busy={disabled}
              onPublish={() =>
                action(
                  () =>
                    window.toolbox!.publishEbayOffer({
                      token: modal.review.token,
                      confirmed: true,
                    }),
                  "eBay publication confirmed. If cross-listed, save the matching Mercari link.",
                )
              }
            />
          ) : modal.kind === "link" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const url = String(new FormData(e.currentTarget).get("url"));
                void action(
                  () =>
                    window.toolbox!.linkMercariListing({
                      id: modal.item.id,
                      url,
                    }),
                  "Exact Mercari listing linked as active. No Mercari account action was performed.",
                );
              }}
            >
              <p className="collection-form-note">
                Link the Mercari listing for <b>{modal.item.unitLabel}</b>:{" "}
                {modal.item.title}. This pair must represent the same one
                physical copy.
              </p>
              <label>
                Mercari US item URL
                <input
                  name="url"
                  type="url"
                  required
                  autoFocus
                  maxLength={2048}
                  placeholder="https://www.mercari.com/us/item/m123456789/"
                />
              </label>
              <label className="selling-check">
                <input type="checkbox" required />I verified this is my active
                listing for this exact copy.
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => help("mercari")}>
                  Open Mercari selling
                </button>
                <button className="primary" disabled={disabled}>
                  Save listing link
                </button>
              </div>
            </form>
          ) : (
            <Confirmation
              modal={modal}
              busy={disabled}
              onCancel={() => setModal(null)}
              onOpen={(platform) =>
                modal.item && external(modal.item, platform)
              }
              onConfirm={(reference) => {
                const item = modal.item;
                if (modal.action === "disconnect")
                  return action(
                    () => window.toolbox!.disconnectEbay(),
                    "eBay disconnected. Active listings remain live; automated checks and ending are paused.",
                  );
                if (!item) return Promise.resolve(false);
                if (modal.action === "delete")
                  return action(
                    () => window.toolbox!.deleteSellingDraft(item.id),
                    "Unused draft deleted and its reserved copy released.",
                  );
                if (modal.action === "inactive")
                  return action(
                    () =>
                      window.toolbox!.confirmMercariInactive({
                        id: item.id,
                        expectedId: item.mercariId!,
                        confirmed: true,
                      }),
                    "Your Mercari deactivation confirmation was recorded locally.",
                  );
                if (modal.action === "sale")
                  return action(
                    () =>
                      window.toolbox!.recordMercariSale({
                        id: item.id,
                        expectedId: item.mercariId!,
                        reference,
                      }),
                    "Mercari sale recorded. Check any remaining eBay ending follow-up.",
                  );
                if (modal.action === "conflict")
                  return action(
                    () => window.toolbox!.reviewSellingConflict(item.id),
                    "Double sale marked reviewed locally. No buyer order was changed.",
                  );
                return action(
                  () => window.toolbox!.endEbayOffer(item.id),
                  "eBay confirmed this offer is inactive.",
                );
              }}
            />
          )}
        </SellingDialog>
      )}
    </div>
  );
}
function SellingDialog({
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
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="expense-dialog selling-dialog"
      aria-labelledby="selling-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="expense-dialog-heading">
        <h2 id="selling-dialog-title">{title}</h2>
        <button
          aria-label="Close selling dialog"
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
function ConnectionForm({
  state,
  busy,
  onHelp,
  onConnect,
  onDisconnect,
}: {
  state: SellingState;
  busy: boolean;
  onHelp: () => void;
  onConnect: (input: EbayConnectionInput) => Promise<boolean>;
  onDisconnect: () => void;
}) {
  const [clientId, setClientId] = useState(""),
    [clientSecret, setClientSecret] = useState(""),
    [refreshToken, setRefreshToken] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget),
          value: EbayConnectionInput = {
            environment: String(
              data.get("environment"),
            ) as EbayConnectionInput["environment"],
            label: String(data.get("label")),
            clientId,
            clientSecret,
            refreshToken,
          };
        setClientId("");
        setClientSecret("");
        setRefreshToken("");
        void onConnect(value);
      }}
    >
      <p className="collection-form-note">
        Use your own eBay Developer Program app and seller-authorized refresh
        token. Your eBay password is not used. Begin in Sandbox to test.
        Production publishing creates real listings and may incur eBay fees.
      </p>
      <button type="button" className="text-button" onClick={onHelp}>
        Open eBay Developer keys <ExternalLink size={13} />
      </button>
      <p className="selling-note">
        Required OAuth scopes: base api_scope, sell.inventory,
        sell.account.readonly, sell.fulfillment.readonly. Generate the seller
        refresh token using eBay's User Tokens page. See the app README for
        setup.
      </p>
      <fieldset disabled={busy || !state.settings.supported}>
        <div className="form-grid">
          <label>
            Environment
            <select
              name="environment"
              aria-label="eBay environment"
              defaultValue={state.settings.environment}
            >
              <option value="sandbox">Sandbox — test only</option>
              <option value="production">Production — real listings</option>
            </select>
          </label>
          <label>
            Seller connection label
            <input
              name="label"
              required
              maxLength={80}
              defaultValue={state.settings.label || "My eBay account"}
            />
          </label>
        </div>
        <label>
          eBay Client ID
          <input
            aria-label="eBay Client ID"
            type="password"
            autoComplete="off"
            required
            minLength={10}
            maxLength={200}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </label>
        <label>
          eBay Client secret
          <input
            aria-label="eBay Client secret"
            type="password"
            autoComplete="off"
            required
            minLength={10}
            maxLength={200}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
        </label>
        <label>
          eBay seller refresh token
          <input
            aria-label="eBay seller refresh token"
            type="password"
            autoComplete="off"
            required
            minLength={20}
            maxLength={2100}
            value={refreshToken}
            onChange={(e) => setRefreshToken(e.target.value)}
          />
        </label>
        <p className="collection-form-note">
          <ShieldCheck size={13} />
          Saved only in Windows Credential Manager after verification. Fields
          clear when submitted. Tokens are never shown in the app or stored in
          SQLite.
        </p>
        {!state.settings.supported && (
          <div className="alert">
            Connect on Windows to use Credential Manager. Local drafts and
            Mercari links still work here.
          </div>
        )}
        <div className="modal-actions">
          {state.settings.connected && (
            <button
              type="button"
              className="danger-button"
              onClick={onDisconnect}
            >
              Disconnect eBay
            </button>
          )}
          <button className="primary">
            {busy ? "Verifying…" : "Verify and save connection"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
function DraftForm({
  item,
  collectionId,
  state,
  busy,
  onSave,
  onCancel,
}: {
  item?: SellingUnit;
  collectionId?: string;
  state: SellingState;
  busy: boolean;
  onSave: (value: ListingDraft) => Promise<boolean>;
  onCancel: () => void;
}) {
  const stock =
    state.stock.find((s) => s.id === (item?.collectionId || collectionId)) ||
    state.stock.find((s) => s.allocated < s.quantity);
  const [selected, setSelected] = useState(
      item?.collectionId || stock?.id || "",
    ),
    [title, setTitle] = useState(item?.title || stock?.name.slice(0, 80) || ""),
    [copyLabel, setCopyLabel] = useState(
      item?.unitLabel || `Copy ${(stock?.allocated || 0) + 1}`,
    ),
    [description, setDescription] = useState(
      item?.description || stock?.name || "",
    ),
    [price, setPrice] = useState(
      item ? (item.priceCents / 100).toFixed(2) : "",
    ),
    [error, setError] = useState("");
  const [category, setCategory] = useState(item?.categoryId || ""),
    [condition, setCondition] = useState(item?.condition || ""),
    [guide, setGuide] = useState<CategoryGuide | null>(null),
    [reading, setReading] = useState(false);
  const [specifics, setSpecifics] = useState<{ name: string; value: string }[]>(
    Object.entries(item?.aspects || {}).flatMap(([name, values]) =>
      values.map((value) => ({ name, value })),
    ),
  );
  const [descriptors, setDescriptors] = useState(
    item?.conditionDescriptors || [],
  );
  const conditionIds: Record<string, string> = {
    NEW: "1000",
    NEW_OTHER: "1500",
    LIKE_NEW: "2750",
    USED_EXCELLENT: "3000",
    USED_VERY_GOOD: "4000",
    USED_GOOD: "5000",
    USED_ACCEPTABLE: "6000",
    FOR_PARTS_OR_NOT_WORKING: "7000",
  };
  const conditionGuide = guide?.conditions.find(
    (c) => c.id === conditionIds[condition],
  );
  async function loadGuide() {
    setReading(true);
    setError("");
    try {
      const result = await window.toolbox!.sellingCategory(category);
      if (!result.ok || !result.guide) {
        setError(result.error || "Could not load category fields.");
        return;
      }
      setGuide(result.guide);
      setSpecifics((old) => [
        ...old,
        ...result
          .guide!.aspects.filter(
            (a) => a.required && !old.some((s) => s.name === a.name),
          )
          .map((a) => ({ name: a.name, value: "" })),
      ]);
      if (
        condition &&
        !result.guide.conditions.some((c) => c.id === conditionIds[condition])
      ) {
        setCondition("");
        setDescriptors([]);
      }
    } catch {
      setError(
        "Could not read this eBay category. Check the category ID and connection.",
      );
    } finally {
      setReading(false);
    }
  }
  function descriptor(id: string, value: string, freeText: boolean) {
    setDescriptors((old) => [
      ...old.filter((d) => d.name !== id),
      ...(value
        ? [
            freeText
              ? { name: id, values: [], additionalInfo: value }
              : { name: id, values: [value] },
          ]
        : []),
    ]);
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        const data = new FormData(e.currentTarget),
          priceCents = amountToCents(price);
        if (priceCents === null || priceCents < 1) {
          setError(
            "Choose a selling price above zero with at most two decimal places.",
          );
          return;
        }
        const aspects: Record<string, string[]> = Object.create(null);
        for (const pair of specifics) {
          if (pair.name.trim() && pair.value.trim())
            aspects[pair.name.trim()] = [
              ...(aspects[pair.name.trim()] || []),
              pair.value.trim(),
            ];
        }
        void onSave({
          collectionId: selected,
          unitLabel: copyLabel,
          title,
          description,
          priceCents,
          condition: condition as ListingDraft["condition"],
          conditionDescription: String(data.get("conditionDescription") || ""),
          conditionDescriptors: descriptors,
          aspects,
          photoUrls: String(data.get("photoUrls") || "")
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean),
          categoryId: category,
          locationKey: String(data.get("locationKey") || ""),
          fulfillmentPolicyId: String(data.get("fulfillmentPolicyId") || ""),
          paymentPolicyId: String(data.get("paymentPolicyId") || ""),
          returnPolicyId: String(data.get("returnPolicyId") || ""),
          autoEndEbay: data.get("autoEndEbay") === "on",
        });
      }}
    >
      <fieldset disabled={busy || reading}>
        <p className="collection-form-note">
          This pair reserves <b>one physical copy</b>. Give it a recognizable
          label (binder slot, serial number, or condition). Save a draft before
          finishing eBay setup.
        </p>
        <label>
          Collection entry
          <select
            aria-label="Listing collection entry"
            value={selected}
            disabled={Boolean(item)}
            onChange={(e) => {
              const stock = state.stock.find((s) => s.id === e.target.value)!;
              setSelected(stock.id);
              setTitle(stock.name.slice(0, 80));
              setDescription(stock.name);
              setCopyLabel(`Copy ${stock.allocated + 1}`);
              setPrice("");
            }}
          >
            {state.stock
              .filter(
                (s) => s.allocated < s.quantity || s.id === item?.collectionId,
              )
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {Math.max(0, s.quantity - s.allocated)} unallocated
                  / {s.quantity} recorded
                </option>
              ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Physical copy label
            <input
              required
              maxLength={120}
              value={copyLabel}
              onChange={(e) => setCopyLabel(e.target.value)}
            />
          </label>
          <label>
            Selling price (USD)
            <input
              aria-label="Selling price (USD)"
              required
              min="0.01"
              max="10000000"
              step="0.01"
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
        </div>
        <label>
          Listing title
          <input
            required
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            required
            maxLength={4000}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          eBay leaf category ID
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={30}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setGuide(null);
            }}
            placeholder="Required before preparing"
          />
        </label>
        <button
          type="button"
          disabled={
            !state.settings.connected || !/^\d+$/.test(category) || reading
          }
          onClick={() => void loadGuide()}
        >
          <RefreshCw size={13} />
          {reading ? "Loading category fields…" : "Load category fields"}
        </button>
        <p className="selling-note">
          Choose the correct leaf category from eBay before publishing. Load its
          fields to see supported conditions, required specifics and any grading
          details. Loading never selects a grade for you.
        </p>
        <label>
          eBay condition
          <select
            aria-label="eBay item condition"
            required
            value={condition}
            onChange={(e) => {
              setCondition(e.target.value);
              setDescriptors([]);
            }}
          >
            <option value="" disabled>
              Choose the actual condition
            </option>
            {listingConditions
              .filter(
                (c) =>
                  !guide ||
                  guide.conditions.some((g) => g.id === conditionIds[c]),
              )
              .map((c) => (
                <option value={c} key={c}>
                  {guide?.conditions.find((g) => g.id === conditionIds[c])
                    ?.name || c.replace(/_/g, " ")}
                </option>
              ))}
          </select>
        </label>
        {Boolean(conditionGuide?.descriptors.length) && (
          <div className="selling-specifics">
            <h3>Condition details</h3>
            {conditionGuide!.descriptors.map((d) => (
              <label key={d.id}>
                {d.name}
                {d.required ? " · required" : ""}
                {d.freeText ? (
                  <input
                    aria-label={d.name}
                    maxLength={30}
                    value={
                      descriptors.find((v) => v.name === d.id)
                        ?.additionalInfo || ""
                    }
                    onChange={(e) => descriptor(d.id, e.target.value, true)}
                  />
                ) : (
                  <select
                    aria-label={d.name}
                    value={
                      descriptors.find((v) => v.name === d.id)?.values[0] || ""
                    }
                    onChange={(e) => descriptor(d.id, e.target.value, false)}
                  >
                    <option value="">Choose the actual value</option>
                    {d.values.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            ))}
          </div>
        )}
        {!guide && descriptors.length > 0 && (
          <p className="selling-note">
            {descriptors.length} saved condition details retained. Load category
            fields to review or edit them.
          </p>
        )}
        <label>
          Condition description
          <textarea
            name="conditionDescription"
            rows={2}
            maxLength={1000}
            defaultValue={item?.conditionDescription || ""}
          />
        </label>
        <div className="selling-specifics">
          <h3>Item specifics</h3>
          <p className="selling-note">
            Use the actual card/item details. Fields marked required must be
            complete before eBay will publish.
          </p>
          {specifics.map((pair, index) => (
            <div className="selling-specific-row" key={index}>
              <label>
                Detail name
                <input
                  aria-label={`Specific name ${index + 1}`}
                  list="selling-specific-names"
                  value={pair.name}
                  maxLength={100}
                  onChange={(e) =>
                    setSpecifics((old) =>
                      old.map((p, i) =>
                        i === index ? { ...p, name: e.target.value } : p,
                      ),
                    )
                  }
                />
              </label>
              <label>
                {guide?.aspects.find((a) => a.name === pair.name)?.required
                  ? "Value · required"
                  : "Value"}
                <input
                  aria-label={`Specific value ${index + 1}`}
                  list={`selling-values-${index}`}
                  value={pair.value}
                  maxLength={200}
                  onChange={(e) =>
                    setSpecifics((old) =>
                      old.map((p, i) =>
                        i === index ? { ...p, value: e.target.value } : p,
                      ),
                    )
                  }
                />
                <datalist id={`selling-values-${index}`}>
                  {guide?.aspects
                    .find((a) => a.name === pair.name)
                    ?.values.map((v) => (
                      <option key={v} value={v} />
                    ))}
                </datalist>
              </label>
              <button
                type="button"
                className="text-button"
                aria-label={`Remove specific ${index + 1}`}
                onClick={() =>
                  setSpecifics((old) => old.filter((_, i) => i !== index))
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <datalist id="selling-specific-names">
            {guide?.aspects.map((a) => (
              <option key={a.name} value={a.name} />
            ))}
          </datalist>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setSpecifics((old) => [...old, { name: "", value: "" }])
            }
          >
            <Plus size={13} />
            Add item detail
          </button>
        </div>
        <label>
          Listing photo HTTPS URLs (one per line)
          <textarea
            name="photoUrls"
            rows={3}
            defaultValue={item?.photoUrls.join("\n") || ""}
            placeholder="Save the draft, then use Upload photo to upload your own JPEG/PNG to eBay."
          />
        </label>
        <p className="selling-note">
          Use photos of your own item. Collection thumbnails and catalog artwork
          are not automatically uploaded. Upload the original photos yourself on
          Mercari.
        </p>
        <details className="selling-advanced" open={Boolean(item?.categoryId)}>
          <summary>eBay shipping and return settings</summary>
          <div className="form-grid">
            <PolicySelect
              name="locationKey"
              label="Ship-from location"
              options={state.settings.options.locations}
              value={item?.locationKey}
            />
            <PolicySelect
              name="fulfillmentPolicyId"
              label="Shipping policy"
              options={state.settings.options.fulfillment}
              value={item?.fulfillmentPolicyId}
            />
            <PolicySelect
              name="paymentPolicyId"
              label="Payment policy"
              options={state.settings.options.payment}
              value={item?.paymentPolicyId}
            />
            <PolicySelect
              name="returnPolicyId"
              label="Return policy"
              options={state.settings.options.returns}
              value={item?.returnPolicyId}
            />
          </div>
        </details>
        <label className="selling-check">
          <input
            name="autoEndEbay"
            type="checkbox"
            defaultChecked={item?.autoEndEbay ?? true}
          />
          Automatically end the linked eBay offer when I record this exact copy
          sold on Mercari.
        </label>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary">Save shared draft</button>
        </div>
      </fieldset>
    </form>
  );
}
function PolicySelect({
  name,
  label,
  options,
  value,
}: {
  name: string;
  label: string;
  options: { id: string; name: string }[];
  value?: string;
}) {
  return (
    <label>
      {label}
      <select name={name} aria-label={label} defaultValue={value || ""}>
        <option value="">Choose before preparing</option>
        {value && !options.some((p) => p.id === value) && (
          <option value={value}>Saved ID: {value}</option>
        )}
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function PublishForm({
  review,
  busy,
  onPublish,
}: {
  review: PublishReview;
  busy: boolean;
  onPublish: () => Promise<boolean>;
}) {
  const unit = review.unit;
  const name = (type: keyof SellingOptions, id: string) =>
    review.options[type].find((o) => o.id === id)?.name || id;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onPublish();
      }}
    >
      <div
        className={
          review.environment === "production"
            ? "selling-live-warning"
            : "notice"
        }
      >
        {review.environment === "production"
          ? "LIVE EBAY PUBLICATION · REAL LISTING / POSSIBLE SELLER FEES"
          : "SANDBOX · TEST LISTING ONLY"}
      </div>
      <h3>{unit.title}</h3>
      <dl className="selling-review">
        <dt>Price / quantity</dt>
        <dd>
          {dollars(unit.priceCents)} USD · 1 copy · Buy It Now / Good ’Til
          Cancelled
        </dd>
        <dt>Exact copy</dt>
        <dd>
          {unit.unitLabel} · {unit.sku}
        </dd>
        <dt>Condition / category</dt>
        <dd>
          {unit.condition} · {unit.categoryId}
        </dd>
        <dt>Ship from</dt>
        <dd>{name("locations", unit.locationKey)}</dd>
        <dt>Shipping policy</dt>
        <dd>{name("fulfillment", unit.fulfillmentPolicyId)}</dd>
        <dt>Payment policy</dt>
        <dd>{name("payment", unit.paymentPolicyId)}</dd>
        <dt>Return policy</dt>
        <dd>{name("returns", unit.returnPolicyId)}</dd>
        <dt>Photos</dt>
        <dd>{unit.photoUrls.length} images</dd>
        <dt>Mercari listing</dt>
        <dd>
          {unit.mercariId ||
            "Not linked — publish manually and save its exact URL"}
        </dd>
      </dl>
      <details open>
        <summary>Description and item specifics</summary>
        <p className="selling-description">{unit.description}</p>
        <pre>
          {JSON.stringify(
            {
              aspects: unit.aspects,
              conditionDescription: unit.conditionDescription,
              conditionDescriptors: unit.conditionDescriptors,
              photoUrls: unit.photoUrls,
            },
            null,
            2,
          )}
        </pre>
      </details>
      <p className="collection-form-note">
        Expires {when(review.expiresAt)}. This publishes only to eBay. Mercari
        needs a separate manual listing and link. Applicable fees are determined
        by eBay; no fee estimate has been calculated here.
      </p>
      <label className="selling-check">
        <input
          type="checkbox"
          required
          aria-label="Confirm eBay publication details"
        />
        I reviewed this exact copy, price, photos, condition and policies, and
        authorize this {review.environment === "production" ? "live" : "test"}{" "}
        publication.
      </label>
      <div className="modal-actions">
        <button className="primary" disabled={busy}>
          {busy
            ? "Publishing…"
            : review.environment === "production"
              ? "Publish live eBay listing"
              : "Publish sandbox listing"}
        </button>
      </div>
    </form>
  );
}
function Confirmation({
  modal,
  busy,
  onCancel,
  onOpen,
  onConfirm,
}: {
  modal: Extract<Modal, { kind: "confirm" }>;
  busy: boolean;
  onCancel: () => void;
  onOpen: (platform: "ebay" | "mercari") => void;
  onConfirm: (reference: string) => Promise<boolean>;
}) {
  const text =
    modal.action === "sale"
      ? "Record this exact copy sold on Mercari? Its linked eBay offer will be ended if the draft's automatic-ending preference is on and the owning eBay account is connected. Any failure stays visible as a follow-up."
      : modal.action === "inactive"
        ? "First deactivate this exact listing on Mercari. Confirming below records your action locally; it does not change Mercari for you."
        : modal.action === "end"
          ? "End the saved eBay offer for this exact SKU? This sends an ending request to the connected eBay account. It does not cancel a buyer's order."
          : modal.action === "delete"
            ? "Delete this unused local draft and release its reserved copy? This is available only before any marketplace listing has been linked or an eBay offer created."
            : modal.action === "disconnect"
              ? "Remove the saved eBay credential? Published listings remain live, and account checks/automatic ending pause until you reconnect."
              : "Confirm that you reviewed both sales directly and handled any buyer issues. This only acknowledges the reminder locally.";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const reference = String(
          new FormData(e.currentTarget).get("reference") || "",
        );
        void onConfirm(reference);
      }}
    >
      <p className="collection-form-note">{text}</p>
      {modal.item && (
        <div className="selling-confirm-item">
          <strong>{modal.item.title}</strong>
          <small>
            {modal.item.unitLabel} · {modal.item.sku}
          </small>
          <small>
            eBay:{" "}
            {modal.item.ebayListingId || modal.item.offerId || "not prepared"} ·
            Mercari: {modal.item.mercariId || "not linked"}
          </small>
        </div>
      )}
      {modal.action === "inactive" && (
        <button type="button" onClick={() => onOpen("mercari")}>
          Open exact Mercari listing <ExternalLink size={13} />
        </button>
      )}
      {modal.action === "sale" && (
        <label>
          Mercari order reference (optional)
          <input name="reference" maxLength={80} />
        </label>
      )}
      <label className="selling-check">
        <input type="checkbox" required aria-label="Confirm selling action" />I
        verified the exact item and authorize this action.
      </label>
      <div className="modal-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          className={modal.action === "delete" ? "danger-button" : "primary"}
          disabled={busy}
        >
          {modal.action === "inactive"
            ? "I deactivated it on Mercari"
            : modal.action === "sale"
              ? "Record Mercari sale"
              : modal.action === "end"
                ? "End eBay offer"
                : modal.action === "delete"
                  ? "Delete draft"
                  : modal.action === "disconnect"
                    ? "Disconnect eBay"
                    : "Mark reviewed"}
        </button>
      </div>
    </form>
  );
}
