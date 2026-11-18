import { workspaceGuards } from "./workspace-guards";
import type { ToolboxAPI } from "./types";
export class WorkspaceApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
    this.name = "WorkspaceApiError";
  }
}
type Marked = { _mobileKey?: string; _mobileVersion?: string };
export function createMobileWorkspaceApi(
  getCsrf: () => string,
  onExpired: () => void,
) {
  const latest = new Map<string, string>(),
    frozen = new Map<string, string>(),
    pending = new Map<string, string>(),
    listeners = new Set<(id: string) => void>();
  const storageKey = "toolbox-pending-workspace-v1";
  const pendingTimes = new Map<string, number>();
  try {
    const entries = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
    if (Array.isArray(entries))
      for (const e of entries.slice(0, 200))
        if (
          Array.isArray(e) &&
          /^[a-f0-9]{64}$/.test(e[0]) &&
          /^[a-f0-9-]{36}$/.test(e[1]) &&
          Number(e[2]) > Date.now()
        ) {
          pending.set(e[0], e[1]);
          pendingTimes.set(e[0], e[2]);
        }
  } catch {
    /* storage can be unavailable in private browsing */
  }
  const persist = () => {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify(
          [...pending]
            .filter(([key]) => (pendingTimes.get(key) || 0) > Date.now())
            .map(([key, id]) => [key, id, pendingTimes.get(key)]),
        ),
      );
    } catch {
      /* pending IDs remain in memory */
    }
  };
  let capture = false;
  const decorate = (value: any, versions: Record<string, string>) => {
    for (const [key, v] of Object.entries(versions)) latest.set(key, v);
    const walk = (v: any) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) {
        v.forEach(walk);
        return;
      }
      if (typeof v.id === "string") {
        const found = Object.keys(versions).find((k) => k.endsWith(":" + v.id));
        if (found) {
          Object.defineProperty(v, "_mobileKey", {
            value: found,
            enumerable: false,
          });
          Object.defineProperty(v, "_mobileVersion", {
            value: versions[found],
            enumerable: false,
          });
        }
      }
      Object.values(v).forEach(walk);
    };
    walk(value);
    return value;
  };
  const captureEdit = (value: unknown) => {
    frozen.clear();
    capture = true;
    const walk = (v: any) => {
      if (!v || typeof v !== "object") return;
      const row = v as Marked;
      if (row._mobileKey && row._mobileVersion)
        frozen.set(row._mobileKey, row._mobileVersion);
      if (Array.isArray(v)) v.forEach(walk);
      else Object.values(v).forEach(walk);
    };
    walk(value);
    if (!frozen.size) for (const [key, v] of latest) frozen.set(key, v);
  };
  const reads = new Set([
    "snapshot",
    "collectionState",
    "expenseState",
    "shippingState",
    "mailboxState",
    "inboxState",
    "sellingState",
    "searchCatalog",
    "sellingCategory",
    "collectionHistory",
    "exportExpenseText",
    "exportOrderText",
    "openCollectionUrl",
    "openListingUrl",
    "copyListingText",
  ]);
  async function rpc(method: string, args: unknown[] = []) {
    const guards: Record<string, string> = {};
    const resource = workspaceGuards[method],
      first = args[0] as any;
    if (resource) {
      const keys =
        resource === "expense-set"
          ? ["expense-set"]
          : resource === "outstanding" && Array.isArray(first?.ids)
            ? first.ids.map((id: string) => resource + ":" + id)
            : [
                resource +
                  ":" +
                  (typeof first === "string" ? first : first?.id),
              ];
      for (const key of keys) {
        const v =
          capture && frozen.has(key) ? frozen.get(key) : latest.get(key);
        if (v) guards[key] = v;
      }
    }
    const serialize = JSON.stringify([method, args, guards]);
    const bytes = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(serialize),
        ),
      ),
      fingerprint = Array.from(bytes, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    if (
      pending.has(fingerprint) &&
      pendingTimes.has(fingerprint) &&
      pendingTimes.get(fingerprint)! <= Date.now()
    )
      throw new WorkspaceApiError(
        "This interrupted request is older than 10 minutes. Refresh and check the saved data before starting a new action.",
        409,
      );
    const requestId = pending.get(fingerprint) || crypto.randomUUID();
    pending.set(fingerprint, requestId);
    if (
      !reads.has(method) &&
      ![
        "connectMailbox",
        "connectGmail",
        "connectEbay",
        "connectPricing",
      ].includes(method)
    ) {
      if (!pendingTimes.has(fingerprint))
        pendingTimes.set(fingerprint, Date.now() + 10 * 60000);
      persist();
    }
    try {
      const r = await fetch("/api/workspace", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Toolbox-CSRF": getCsrf(),
        },
        body: JSON.stringify({ method, args, guards, requestId }),
        signal: AbortSignal.timeout(
          reads.has(method) &&
            !["searchCatalog", "sellingCategory"].includes(method)
            ? 20000
            : 180000,
        ),
      });
      const body = await r.json();
      window.dispatchEvent(
        new CustomEvent("toolbox-workspace-connection", { detail: true }),
      );
      if (!r.ok) {
        pending.delete(fingerprint);
        pendingTimes.delete(fingerprint);
        if (r.status === 401) onExpired();
        throw new WorkspaceApiError(
          body.error || "Could not complete this desktop operation.",
          r.status,
        );
      }
      pending.delete(fingerprint);
      pendingTimes.delete(fingerprint);
      const value = decorate(body.value, body.versions || {});
      if (!reads.has(method) && value?.ok !== false) {
        frozen.clear();
        capture = false;
      }
      return value;
    } catch (error) {
      if (error instanceof WorkspaceApiError) throw error;
      window.dispatchEvent(
        new CustomEvent("toolbox-workspace-connection", { detail: false }),
      );
      throw new WorkspaceApiError(
        "The PC connection was interrupted. Keep Tailscale and Personal Toolbox open. Check the latest data before retrying. The same request is protected against duplicates for 10 minutes.",
      );
    } finally {
      persist();
      while (pending.size > 200) pending.delete(pending.keys().next().value!);
    }
  }
  const methods = [
    "snapshot",
    "addOrder",
    "updateOrder",
    "deleteOrder",
    "collectionState",
    "connectPricing",
    "disconnectPricing",
    "searchCatalog",
    "addCatalogItem",
    "addManualCollectible",
    "editCollectible",
    "deleteCollectible",
    "refreshCollection",
    "collectionHistory",
    "expenseState",
    "addExpense",
    "editExpense",
    "editExpenseSchedule",
    "stopExpenseSchedule",
    "deleteExpense",
    "deleteAllExpenses",
    "commitExpenseImport",
    "shippingState",
    "checkSales",
    "setShippingMonitor",
    "addShippingTask",
    "editShippingTask",
    "deleteShippingTask",
    "mailboxState",
    "connectMailbox",
    "disconnectMailbox",
    "setMailboxEnabled",
    "setOutstandingExpectedDate",
    "deleteOutstandingLines",
    "scanOutstanding",
    "scanMailboxes",
    "receiveOutstanding",
    "inboxState",
    "connectGmail",
    "disconnectGmail",
    "refreshInbox",
    "setInboxAuto",
    "linkEmailUpdate",
    "linkShipment",
    "sellingState",
    "sellingCategory",
    "connectEbay",
    "disconnectEbay",
    "createSellingDraft",
    "editSellingDraft",
    "deleteSellingDraft",
    "refreshSellingOptions",
    "createSellingLocation",
    "prepareEbayOffer",
    "publishEbayOffer",
    "reconcileEbayOffer",
    "endEbayOffer",
    "linkMercariListing",
    "confirmMercariInactive",
    "recordMercariSale",
    "reviewSellingConflict",
    "setSellingAuto",
    "syncSelling",
  ];
  const api: Record<string, any> = { mobileMode: true, captureEdit };
  for (const method of methods)
    api[method] = (...args: unknown[]) =>
      rpc(method, args.length && args[0] !== undefined ? args : []);
  const choose = (accept: string) =>
    new Promise<File | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.hidden = true;
      document.body.append(input);
      let done = false;
      const finish = (file: File | null) => {
        if (done) return;
        done = true;
        input.remove();
        resolve(file);
      };
      input.onchange = () => finish(input.files?.[0] || null);
      input.oncancel = () => finish(null);
      input.click();
    });
  const photo = async (file: File, size: number, min = 0) => {
    if (file.size > 15 * 1024 * 1024)
      throw Error("Choose an image under 15 MiB.");
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(Error("Choose a JPEG, PNG or WebP photo."));
      image.src = data;
    });
    if (
      Math.max(image.naturalWidth, image.naturalHeight) > 4096 ||
      Math.max(image.naturalWidth, image.naturalHeight) < min
    )
      throw Error(
        "Choose a photo up to 4096 pixels, with its longest side at least " +
          (min || 1) +
          " pixels.",
      );
    const scale = Math.min(
        1,
        size / Math.max(image.naturalWidth, image.naturalHeight),
      ),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("This browser could not process the photo.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  };
  const download = (name: string, text: string) => {
    const url = URL.createObjectURL(
        new Blob([text], { type: "text/csv;charset=utf-8" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const open = (url: string) => {
    const u = new URL(url);
    if (u.protocol !== "https:") throw Error("Use a secure provider link.");
    const tab = window.open("about:blank", "_blank");
    if (tab) {
      tab.opener = null;
      tab.location.replace(u.href);
    } else window.location.assign(u.href);
    return true;
  };
  api.chooseCollectionImage = async () => {
    try {
      const file = await choose("image/jpeg,image/png,image/webp");
      return { data: file ? await photo(file, 256) : null };
    } catch (e) {
      return {
        data: null,
        error: e instanceof Error ? e.message : "Could not open this photo.",
      };
    }
  };
  api.uploadSellingPhoto = async (id: string) => {
    const file = await choose("image/jpeg,image/png");
    if (!file) return { ok: true, state: await api.sellingState() };
    try {
      return await rpc("uploadSellingPhotoData", [
        { id, data: await photo(file, 1600, 500) },
      ]);
    } catch (e) {
      return {
        ok: false,
        state: await api.sellingState(),
        error: e instanceof Error ? e.message : "Could not upload this photo.",
      };
    }
  };
  api.previewExpenseImport = async () => {
    const file = await choose(".csv,text/csv");
    if (!file) return { cancelled: true };
    if (file.size > 8 * 1024 * 1024)
      return { error: "CSV is limited to 8 MiB." };
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      return rpc("previewExpenseImportText", [text]);
    } catch {
      return { error: "Choose a readable UTF-8 expense CSV file." };
    }
  };
  api.exportExpenses = async () => {
    download("personal-toolbox-expenses.csv", await rpc("exportExpenseText"));
    return { ok: true };
  };
  api.exportOrders = async () => {
    download("personal-toolbox-orders.csv", await rpc("exportOrderText"));
    return true;
  };
  api.openCollectionProvider = async (url: string) =>
    open(await rpc("openCollectionUrl", [url]));
  api.openSellingListing = async (input: unknown) =>
    open(await rpc("openListingUrl", [input]));
  api.openSellingHelp = async (page: string) =>
    open(
      page === "ebay"
        ? "https://developer.ebay.com/my/keys"
        : "https://www.mercari.com/sell/",
    );
  api.copySellingDraft = async (input: unknown) => {
    const text = rpc("copyListingText", [input]);
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined")
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": text.then(
            (value) => new Blob([value], { type: "text/plain" }),
          ),
        }),
      ]);
    else await navigator.clipboard.writeText(await text);
    return true;
  };
  api.browseTcg = async () => {
    open("https://www.tcgplayer.com/categories");
    return { open: false, productId: null, url: null };
  };
  api.collectionBrowserState = async () => ({
    open: false,
    productId: null,
    url: null,
  });
  api.onTcgProduct = (cb: (id: string) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };
  const disabled = async () => ({
    ok: false,
    error:
      "Manage pairing and trusted devices from Settings on your Windows PC.",
    state: {
      running: true,
      url: location.origin,
      pairCode: null,
      pairExpiresAt: null,
      devices: [],
    },
  });
  api.companionStatus = async () => (await disabled()).state;
  api.startCompanion = disabled;
  api.stopCompanion = disabled;
  api.rotateCompanionCode = disabled;
  api.revokeCompanionDevice = disabled;
  return api as unknown as ToolboxAPI;
}
