import { useEffect, useRef, useState } from "react";
import type {
  Ship24State,
  Ship24Result,
  TrackingSource,
  Ship24Tracker,
} from "./ship24-types";
import { Pagination, usePagination } from "./pagination";
import { listenForDataChanges } from "./data-changes";
import { operationError } from "./operation-error";
const empty: Ship24State = {
  connected: false,
  supported: false,
  busy: false,
  autoEnabled: false,
  monthlyCap: 10,
  usedThisMonth: 0,
  month: "",
  cooldownUntil: 0,
  sources: [],
  trackers: [],
};
export default function Ship24Panel() {
  const [state, setState] = useState(empty),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [key, setKey] = useState(""),
    [query, setQuery] = useState(""),
    [registration, setRegistration] = useState<TrackingSource | null>(null),
    [details, setDetails] = useState<Ship24Tracker | null>(null),
    [cap, setCap] = useState(10),
    [showKey, setShowKey] = useState(false);
  const capDirty = useRef(false);
  const running = useRef(false),
    revision = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (running.current) return;
      const rev = revision.current;
      try {
        const s = await window.toolbox!.ship24State();
        if (alive && rev === revision.current) {
          setState(s);
          if (!capDirty.current) setCap(s.monthlyCap);
        }
      } catch {
        if (alive)
          setError(
            "Could not load Ship24. Update and restart the Windows app if needed.",
          );
      }
    };
    void load();
    const unsub = listenForDataChanges(() => void load()),
      timer = setInterval(() => void load(), 3000);
    return () => {
      alive = false;
      unsub();
      clearInterval(timer);
    };
  }, []);
  async function act(fn: () => Promise<Ship24Result>, message: string) {
    if (running.current) return false;
    running.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fn();
      setState(r.state);
      if (!r.ok) {
        setError(r.error || "Could not update Ship24.");
        return false;
      }
      setNotice(message);
      return true;
    } catch (e) {
      setError(
        operationError(
          e,
          "Could not contact Windows. Check the latest tracker status before retrying registration.",
        ),
      );
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const disabled = busy || state.busy;
  const sources = state.sources.filter((s) =>
      [s.title, s.trackingNumber, s.carrier, s.type]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
    sourcePage = usePagination(sources, query);
  const trackers = state.trackers.filter((t) =>
      [t.trackingNumber, t.carrier, ...t.sources.map((s) => s.title)]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
    trackerPage = usePagination(trackers, query);
  const linked = (s: TrackingSource) =>
    state.trackers.find(
      (t) =>
        t.currentConnection &&
        t.sources.some((r) => r.signature === s.signature),
    );
  return (
    <section className="panel ship24-panel">
      <div className="panel-heading">
        <div>
          <h2>Ship24 tracking</h2>
          <p>
            Carrier updates for Organizer packages and tracking numbers found in
            Inbox.
          </p>
        </div>
        <span className="local-pill">
          {state.connected ? "Connected" : "Not connected"}
        </span>
      </div>
      {(error || state.error) && (
        <div className="alert" role="alert">
          {error || state.error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <div className="organizer-list">
        <p>
          Use a{" "}
          <button
            className="text-button"
            onClick={() =>
              void window
                .toolbox!.openShip24Site("setup")
                .catch(() => setError("Could not open Ship24 setup."))
            }
          >
            Ship24 Tracking API per-shipment plan
          </button>
          . Registering a new tracker can consume its shipment quota. Toolbox
          never buys a plan or automatically registers inbox numbers.
        </p>
        {!state.supported && (
          <p className="alert">
            Secure API-key storage requires Windows Credential Manager.
          </p>
        )}
        <button
          className="text-button"
          onClick={() =>
            void window
              .toolbox!.openShip24Site("dashboard")
              .catch(() => setError("Could not open Ship24 dashboard."))
          }
        >
          Open Ship24 dashboard
        </button>
        {(!state.connected || showKey) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const apiKey = key;
              setKey("");
              void act(
                () => window.toolbox!.connectShip24({ apiKey }),
                "Ship24 key verified and saved securely.",
              ).then((ok) => {
                if (ok) setShowKey(false);
              });
            }}
          >
            <label>
              Ship24 API key
              <input
                aria-label="Ship24 API key"
                type="password"
                value={key}
                autoComplete="off"
                spellCheck={false}
                minLength={10}
                maxLength={256}
                required
                disabled={disabled || !state.supported}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <button className="primary" disabled={disabled || !state.supported}>
              {disabled ? "Connecting…" : "Connect Ship24 securely"}
            </button>
          </form>
        )}
        {state.connected && (
          <div className="actions">
            <button disabled={disabled} onClick={() => setShowKey((v) => !v)}>
              Update Ship24 key
            </button>
            <button
              disabled={disabled}
              className="danger-button"
              onClick={() => {
                if (
                  window.confirm(
                    "Disconnect Ship24 from Toolbox? Existing Ship24 trackers remain in your account; Toolbox will stop refreshing them.",
                  )
                )
                  void act(
                    () => window.toolbox!.disconnectShip24(),
                    "Disconnected. Existing provider trackers were not deleted.",
                  );
              }}
            >
              Disconnect Ship24
            </button>
          </div>
        )}
        <p>
          New registrations attempted locally in{" "}
          {state.month || "this UTC month"}:{" "}
          <strong>
            {state.usedThisMonth} / {state.monthlyCap}
          </strong>
          . This local safeguard is not your account’s remaining quota or
          billing period. Check Ship24 before increasing it.
        </p>
        {state.cooldownUntil > Date.now() && (
          <p className="notice">
            Provider cooldown until{" "}
            {new Date(state.cooldownUntil).toLocaleTimeString()}.
          </p>
        )}
        <form
          className="actions"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              cap > state.monthlyCap &&
              !window.confirm(
                "Increase the local registration limit? Your Ship24 plan may charge for additional shipments. Review its quota before continuing.",
              )
            )
              return;
            void act(
              () =>
                window.toolbox!.setShip24Preferences({
                  autoEnabled: state.autoEnabled,
                  monthlyCap: cap,
                }),
              "Local registration cap updated.",
            ).then((ok) => {
              if (ok) capDirty.current = false;
            });
          }}
        >
          <label>
            Local monthly registration cap
            <input
              aria-label="Local monthly registration cap"
              type="number"
              min={1}
              max={1000}
              step={1}
              value={cap}
              disabled={disabled}
              onChange={(e) => {
                capDirty.current = true;
                setCap(Number(e.target.value));
              }}
            />
          </label>
          <button disabled={disabled}>Save cap</button>
        </form>
        <label className="expense-checkbox">
          <input
            type="checkbox"
            aria-label="Automatically refresh Ship24"
            checked={state.autoEnabled}
            disabled={disabled || !state.connected}
            onChange={(e) =>
              void act(
                () =>
                  window.toolbox!.setShip24Preferences({
                    autoEnabled: e.target.checked,
                    monthlyCap: state.monthlyCap,
                  }),
                e.target.checked
                  ? "Registered active trackers refresh about every 30 minutes while Windows is open."
                  : "Automatic refresh paused.",
              )
            }
          />{" "}
          Refresh registered active trackers about every 30 minutes while the
          app is open
        </label>
      </div>
      <div className="table-toolbar">
        <label className="search">
          <input
            aria-label="Search Ship24 tracking"
            value={query}
            placeholder="Search all sources and trackers…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="organizer-list">
        <h3>Available tracking numbers</h3>
        {sourcePage.visible.map((s) => {
          const existing = linked(s);
          return (
            <article className="organizer-record" key={s.type + s.id}>
              <div>
                <strong>{s.title}</strong>
                <p>
                  {s.carrier} · {s.trackingNumber} ·{" "}
                  {s.type === "package"
                    ? "Organizer package"
                    : "Inbox shipment"}
                </p>
                {existing && (
                  <small>
                    {existing.phase === "active"
                      ? "Registered"
                      : existing.phase === "uncertain"
                        ? "Registration needs recovery"
                        : "Not registered yet"}
                  </small>
                )}
              </div>
              <button
                className="secondary"
                disabled={
                  disabled || !state.connected || existing?.phase === "active"
                }
                aria-label={`Track ${s.trackingNumber} with Ship24`}
                onClick={() => {
                  setError("");
                  if (existing?.phase === "uncertain") {
                    void act(
                      () => window.toolbox!.recoverShip24(existing.id),
                      "Existing registration recovered without creating another tracker.",
                    );
                    return;
                  }
                  setRegistration(s);
                }}
              >
                {existing?.phase === "active"
                  ? "Registered"
                  : existing?.phase === "uncertain"
                    ? "Recover registration"
                    : "Track with Ship24"}
              </button>
            </article>
          );
        })}
        {!sources.length && (
          <p>
            Add a tracking number to an Organizer package or scan your Inbox.
            Blank or unsupported formats are not submitted.
          </p>
        )}
        <Pagination value={sourcePage} label="tracking source" />
      </div>
      <div className="organizer-list">
        <h3>Registered and pending trackers</h3>
        {trackerPage.visible.map((t) => (
          <article className="organizer-record" key={t.id}>
            <div>
              <strong>{t.trackingNumber}</strong>
              <p>
                {t.summary?.status ||
                  t.summary?.milestone ||
                  "Waiting for carrier results"}{" "}
                · {t.summary?.milestone || t.phase}
              </p>
              <small>
                {t.checkedAt
                  ? "Last checked " + new Date(t.checkedAt).toLocaleString()
                  : "Not checked yet"}
                {!t.currentConnection ? " · Previous API key" : ""}
              </small>
              {t.summary?.estimatedDate && (
                <p>Estimated delivery: {t.summary.estimatedDate}</p>
              )}
              {t.summary?.actualDate && (
                <p>Delivered: {t.summary.actualDate}</p>
              )}
              {t.error && <p className="organizer-warning">{t.error}</p>}
            </div>
            <div className="actions">
              <button
                disabled={
                  disabled ||
                  !state.connected ||
                  !t.currentConnection ||
                  t.phase !== "active"
                }
                aria-label={`Refresh Ship24 ${t.trackingNumber}`}
                onClick={() =>
                  void act(
                    () => window.toolbox!.refreshShip24(t.id),
                    "Latest available carrier results saved.",
                  )
                }
              >
                Refresh
              </button>
              <button disabled={!t.summary} onClick={() => setDetails(t)}>
                Timeline
              </button>
            </div>
          </article>
        ))}
        {!trackers.length && <p>No trackers registered through Toolbox yet.</p>}
        <Pagination value={trackerPage} label="Ship24 tracker" />
      </div>
      <p className="organizer-note">
        Initial results can take a few minutes. Refresh reads Ship24’s existing
        tracker; it does not create another one. Exact matching registration
        details share a tracker. Reused numbers may need the real shipping date
        or destination. Disconnecting or deleting local data does not
        unsubscribe trackers in Ship24. Provider availability and freshness vary
        by carrier.
      </p>
      {registration && (
        <Registration
          source={registration}
          busy={disabled}
          error={error}
          onClose={() => {
            if (!disabled) setRegistration(null);
          }}
          onSave={async (data) => {
            if (
              await act(
                () => window.toolbox!.registerShip24(data),
                "Tracker registered or recovered. Carrier results may take a few minutes.",
              )
            )
              setRegistration(null);
          }}
        />
      )}
      {details && (
        <Timeline
          tracker={state.trackers.find((t) => t.id === details.id) || details}
          onClose={() => setDetails(null)}
        />
      )}
    </section>
  );
}
function Registration({
  source,
  busy,
  error,
  onClose,
  onSave,
}: {
  source: TrackingSource;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (data: import("./ship24-types").Ship24Registration) => Promise<void>;
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
      aria-label="Register Ship24 tracking"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2>Track with Ship24</h2>
      <p>
        {source.carrier} · {source.trackingNumber}
      </p>
      <p>
        A new tracker may consume one shipment from your Ship24 plan. Only
        provide a shipping date or destination if you know it; invented values
        can match the wrong parcel.
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void onSave({
            source: {
              type: source.type,
              id: source.id,
              signature: source.signature,
            },
            confirmed: true,
            destinationCountryCode:
              String(f.get("country") || "")
                .trim()
                .toUpperCase() || null,
            destinationPostCode: String(f.get("postcode") || "").trim() || null,
            shippingDate: String(f.get("date") || "") || null,
          });
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Destination country code (optional)
            <input
              aria-label="Ship24 destination country"
              name="country"
              maxLength={2}
              pattern="[A-Za-z]{2}"
              placeholder="US"
            />
          </label>
          <label>
            Destination postal code (optional)
            <input name="postcode" maxLength={32} />
          </label>
          <label>
            Actual shipping date (optional)
            <input type="date" name="date" />
          </label>
          <label className="expense-checkbox">
            <input
              aria-label="Confirm Ship24 registration"
              type="checkbox"
              required
            />{" "}
            I confirm these details and authorize registration using my Ship24
            quota.
          </label>
        </fieldset>
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Registering…" : "Register tracker"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
function Timeline({
  tracker,
  onClose,
}: {
  tracker: Ship24Tracker;
  onClose: () => void;
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
      className="expense-dialog organizer-dialog"
      aria-label="Ship24 timeline"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2>{tracker.trackingNumber}</h2>
      <p>Times and locations are shown as supplied by Ship24/carriers.</p>
      <div className="organizer-list">
        {tracker.summary?.events.map((e, i) => (
          <article className="organizer-record" key={i}>
            <div>
              <strong>{e.status}</strong>
              <p>
                {e.date} · {e.location}
              </p>
            </div>
          </article>
        ))}
      </div>
      <button onClick={onClose}>Close</button>
    </dialog>
  );
}
