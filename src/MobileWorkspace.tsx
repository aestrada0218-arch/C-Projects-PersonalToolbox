import { useEffect, useRef, useState } from "react";
import App from "./App";
import { createMobileWorkspaceApi } from "./mobile-workspace-api";
import desktopCss from "./style.css?url";
import "./mobile-workspace.css";
export default function MobileWorkspace({
  csrf,
  onExpired,
  onQuick,
  onLogout,
}: {
  csrf: string;
  onExpired: () => void;
  onQuick: () => void;
  onLogout: () => void;
}) {
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(true);
  const key = useRef(csrf);
  key.current = csrf;
  useEffect(() => {
    const before = window.toolbox;
    window.toolbox = createMobileWorkspaceApi(() => key.current, onExpired);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = desktopCss;
    link.onload = () => setReady(true);
    link.onerror = () =>
      setError(
        "Could not load the workspace. Check the PC connection and reload.",
      );
    document.head.append(link);
    return () => {
      link.remove();
      window.toolbox = before;
    };
  }, []);
  useEffect(() => {
    const handle = (e: Event) => setConnected(!!(e as CustomEvent).detail);
    window.addEventListener("toolbox-workspace-connection", handle);
    return () =>
      window.removeEventListener("toolbox-workspace-connection", handle);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const label = () => {
      document
        .querySelectorAll(".mobile-workspace .table-scroll table")
        .forEach((table) => {
          const heads = Array.from(table.querySelectorAll("thead th")).map(
            (h) => h.textContent?.trim() || "",
          );
          table.querySelectorAll("tbody tr").forEach((row) => {
            let index = 0;
            for (const cell of Array.from(
              row.children,
            ) as HTMLTableCellElement[]) {
              cell.dataset.mobileLabel = heads[index] || "";
              index += cell.colSpan || 1;
            }
          });
        });
    };
    label();
    const observer = new MutationObserver(label);
    const root = document.querySelector(".mobile-workspace");
    if (root) observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ready]);
  return (
    <div className="mobile-workspace">
      <div className="workspace-phone-bar">
        <strong>Personal Toolbox</strong>
        <div>
          <button onClick={() => location.reload()}>Refresh</button>
          <button onClick={onQuick}>Quick view</button>
          <button onClick={onLogout}>Unpair</button>
        </div>
      </div>
      {!connected && (
        <p className="m-warning" role="status">
          PC connection lost. Displayed data may be old. Keep Tailscale and
          Personal Toolbox open; changes are not queued offline.
        </p>
      )}
      {error && (
        <p className="m-error" role="alert">
          {error}
        </p>
      )}
      {ready ? <App /> : <div className="m-loading">Opening full toolbox…</div>}
    </div>
  );
}
