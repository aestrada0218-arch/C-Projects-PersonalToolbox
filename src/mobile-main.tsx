import React from "react";
import { createRoot } from "react-dom/client";
import MobileApp from "./MobileApp";
import "./mobile.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>,
);
if ("serviceWorker" in navigator && location.protocol === "https:")
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
