import { useEffect, useRef, useState } from "react";
import {
  Smartphone,
  ShieldCheck,
  RefreshCw,
  Power,
  Trash2,
} from "lucide-react";
import type { CompanionStatus, CompanionResult } from "./mobile-types";
const initial: CompanionStatus = {
  running: false,
  url: null,
  pairCode: null,
  pairExpiresAt: null,
  devices: [],
};
export default function CompanionSettings() {
  const [state, setState] = useState(initial),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const acting = useRef(false),
    revision = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (acting.current) return;
      const rev = revision.current;
      try {
        const s = await window.toolbox!.companionStatus();
        if (alive && rev === revision.current) setState(s);
      } catch {
        if (alive) setError("Could not load companion settings.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function act(fn: () => Promise<CompanionResult>) {
    if (acting.current) return;
    acting.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      setState(r.state);
      if (!r.ok) setError(r.error || "Could not update the companion.");
    } catch {
      setError("Could not reach the desktop companion service.");
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="companion-settings">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR TOOLBOX, CONNECTED</span>
          <h1>
            Settings<span className="gold">.</span>
          </h1>
          <p>Private access from your iPhone, with your data on this PC.</p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              <Smartphone size={18} /> iPhone companion
            </h2>
            <p>Collection, outstanding orders, expenses and shipment tasks.</p>
          </div>
          <span className="local-pill">
            <ShieldCheck size={14} />
            {state.running
              ? "Enabled · private HTTPS required"
              : "Off by default"}
          </span>
        </div>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="companion-content">
          <p>
            Install Tailscale on your Windows PC and iPhone, and sign into the
            same private network. The companion listens only on this PC’s
            loopback address; Tailscale Serve supplies the private HTTPS
            connection.
          </p>
          <ol>
            <li>
              In PowerShell, run:
              <pre>tailscale serve --bg http://127.0.0.1:17863</pre>
            </li>
            <li>
              Copy the <strong>https://…ts.net</strong> address Tailscale prints
              into the field below.
            </li>
            <li>
              Enable the companion. Open that address in Safari on your iPhone
              and enter the pairing code.
            </li>
            <li>
              In Safari choose <strong>Share → Add to Home Screen</strong>. If
              the saved app asks to pair again, generate a new code here.
            </li>
          </ol>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => window.toolbox!.startCompanion({ url }));
            }}
          >
            <label>
              Private Tailscale HTTPS address
              <input
                aria-label="Private Tailscale HTTPS address"
                type="url"
                placeholder="https://your-pc.your-tailnet.ts.net"
                required
                value={state.running ? state.url || "" : url}
                disabled={state.running || busy}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <div className="actions">
              {!state.running ? (
                <button className="primary" disabled={busy}>
                  Enable iPhone companion
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(() => window.toolbox!.stopCompanion())
                  }
                >
                  <Power size={15} />
                  Stop companion and unpair all devices
                </button>
              )}
            </div>
          </form>
          {state.running && (
            <div className="companion-pair">
              <div>
                <span className="eyebrow">SINGLE-USE PAIRING CODE</span>
                <strong aria-label="Current pairing code">
                  {state.pairCode || "Generate a new code"}
                </strong>
                <small>
                  {state.pairExpiresAt
                    ? "Expires " +
                      new Date(state.pairExpiresAt).toLocaleTimeString()
                    : "Codes expire after 5 minutes and are used once."}
                </small>
              </div>
              <button
                disabled={busy}
                onClick={() =>
                  void act(() => window.toolbox!.rotateCompanionCode())
                }
              >
                <RefreshCw size={14} />
                New pairing code
              </button>
            </div>
          )}
          <p className="companion-note">
            Keep this PC awake and Personal Toolbox running. No cloud database
            is created. Gmail passwords, API keys and full emails stay on the
            desktop. Phone edits save directly to this database. Pairing and
            device sessions are cleared when the companion stops or the app
            restarts; sessions otherwise expire after 7 days.
          </p>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              Paired devices{" "}
              <span className="count">{state.devices.length}</span>
            </h2>
            <p>
              Only pair devices you control. Revoking a device blocks its next
              request.
            </p>
          </div>
        </div>
        {state.devices.map((d) => (
          <div className="companion-device" key={d.id}>
            <Smartphone size={18} />
            <div>
              <strong>{d.name}</strong>
              <small>
                Last seen {new Date(d.lastSeen).toLocaleString()} · Expires{" "}
                {new Date(d.expiresAt).toLocaleDateString()}
              </small>
            </div>
            <button
              disabled={busy}
              aria-label={"Revoke device " + d.name}
              onClick={() =>
                void act(() => window.toolbox!.revokeCompanionDevice(d.id))
              }
            >
              <Trash2 size={14} />
              Revoke
            </button>
          </div>
        ))}
        {!state.devices.length && (
          <p className="empty">
            No phones paired. Enable the companion to connect your iPhone.
          </p>
        )}
      </section>
      <p className="companion-note">
        Use Tailscale Serve, not Funnel. Do not forward the port on your router.
        This version provides live access while the PC is running; it does not
        queue offline changes or run Gmail scans on iOS.
      </p>
    </section>
  );
}
