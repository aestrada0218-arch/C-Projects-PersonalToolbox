import { net } from "electron";
import { CollectionService, type PricingSecret } from "./collection/service";
import { JustTcgProvider } from "./collection/justtcg";
import { TcgCatalogBrowser } from "./collection/browser";
import { registerCollectionHandlers } from "./collection/ipc";
import { app, BrowserWindow, ipcMain, dialog, safeStorage } from "electron";
import { EntryService } from "./entry/service";
import { WindowsProfileCipher } from "./entry/crypto";
import { PlaywrightEntryDriver, type ProxySecret } from "./entry/driver";
import { GmailCodeProvider } from "./entry/codes";
import { registerEntryHandlers } from "./entry/ipc";
let entries: EntryService;
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { Store } from "./database";
import { InboxService } from "./inbox/service";
import { WindowsCredentialVault } from "./inbox/credentials";
import { GmailImapProvider } from "./inbox/gmail";
import { registerExpenseHandlers } from "./expenses/ipc";
import { SellingService } from "./selling/service";
import { EbayProvider } from "./selling/ebay";
import { registerSellingHandlers } from "./selling/ipc";
import type { EbayConnectionInput } from "../src/selling-types";
let selling: SellingService;
let stopExpenseTimer: (() => void) | undefined;
let collectionService: CollectionService;
let tcgBrowser: TcgCatalogBrowser;
let inbox: InboxService;
let store: Store;
let window: BrowserWindow;
const dev = process.argv.includes("--dev") && !app.isPackaged;
function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#0e1014",
    title: "Personal Toolbox",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.on("closed", () => tcgBrowser?.close());
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e) => e.preventDefault());
  if (dev) void window.loadURL("http://localhost:5173");
  else void window.loadFile(join(__dirname, "../../dist/index.html"));
}
function authorized(event: Electron.IpcMainInvokeEvent) {
  if (
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("Unauthorized request");
}
function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    authorized(event);
    try {
      return await fn(...args);
    } catch {
      throw new Error(
        "Unable to complete request. Check the input and try again.",
      );
    }
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app
    .whenReady()
    .then(async () => {
      store = await Store.open(
        join(app.getPath("userData"), "personal-toolbox.sqlite"),
        { entryCipher: new WindowsProfileCipher(safeStorage) },
      );
      entries = new EntryService(
        store,
        new PlaywrightEntryDriver(),
        new GmailCodeProvider(),
        new WindowsCredentialVault(),
        new WindowsCredentialVault("PersonalToolbox/EntryGmail/v1"),
        (id) =>
          new WindowsCredentialVault<ProxySecret>(
            "PersonalToolbox/EntryProxy/" + id,
          ),
      );
      registerEntryHandlers(entries, store.entries, () => window, handle);
      selling = new SellingService(
        store.selling,
        new WindowsCredentialVault<EbayConnectionInput>(
          "PersonalToolbox/EbaySelling/v1",
        ),
        new EbayProvider(
          () => store.selling.settings().cooldownUntil,
          (until) => store.selling.cooldown(until),
          (url, init) =>
            net.fetch(url instanceof URL ? url.toString() : url, init),
        ),
      );
      registerSellingHandlers(selling, store.selling, () => window, handle);
      selling.start();
      collectionService = new CollectionService(
        store.collection,
        new WindowsCredentialVault<PricingSecret>("PersonalToolbox/JustTCG/v1"),
        new JustTcgProvider(store.collection, (url, init) =>
          net.fetch(url instanceof URL ? url.toString() : url, init),
        ),
      );
      tcgBrowser = new TcgCatalogBrowser(() => window);
      registerCollectionHandlers(
        collectionService,
        store.collection,
        tcgBrowser,
        () => window,
        handle,
      );
      inbox = new InboxService(
        store,
        new WindowsCredentialVault(),
        new GmailImapProvider(),
      );
      handle("toolbox:inbox-state", () => inbox.state());
      handle("toolbox:connect-gmail", (input) => inbox.connect(input));
      handle("toolbox:refresh-inbox", () => inbox.refresh());
      handle("toolbox:disconnect-gmail", () => inbox.disconnect());
      handle("toolbox:inbox-auto", (value) => inbox.setAuto(value));
      handle("toolbox:link-email-update", (input) => inbox.linkUpdate(input));
      handle("toolbox:link-shipment", (input) => inbox.link(input));
      inbox.start();
      handle("toolbox:shipping-state", () => inbox.shippingState());
      handle("toolbox:shipping-check", () => inbox.refreshSales());
      handle("toolbox:shipping-monitor", (input) =>
        inbox.setShippingMonitor(input),
      );
      handle("toolbox:shipping-add", (input) =>
        inbox.shippingAction(() => store.shipping.add(input)),
      );
      handle("toolbox:shipping-edit", (input) =>
        inbox.shippingAction(() => store.shipping.edit(input)),
      );
      handle("toolbox:shipping-delete", (id) =>
        inbox.shippingAction(() => store.shipping.remove(id)),
      );
      handle("toolbox:snapshot", () => store.snapshot());
      handle("toolbox:add-order", (input) => store.addOrder(input));
      handle("toolbox:export-orders", async () => {
        const result = await dialog.showSaveDialog(window, {
          defaultPath: "personal-toolbox-orders.csv",
          filters: [{ name: "CSV", extensions: ["csv"] }],
        });
        if (result.canceled || !result.filePath) return false;
        const cell = (value: unknown) => {
          let s = String(value);
          if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
          return '"' + s.replace(/"/g, '""') + '"';
        };
        const orders = store.snapshot().orders;
        const keys = [
          "id",
          "name",
          "store",
          "category",
          "total",
          "status",
          "date",
        ] as const;
        await writeFile(
          result.filePath,
          [
            keys.join(","),
            ...orders.map((o) => keys.map((k) => cell(o[k])).join(",")),
          ].join("\r\n"),
        );
        return true;
      });
      stopExpenseTimer = registerExpenseHandlers(
        store.expenses,
        () => window,
        handle,
      );

      createWindow();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch(() => {
      dialog.showErrorBox(
        "Personal Toolbox",
        "The local database could not be opened. Restore a backup or check storage permissions.",
      );
      app.quit();
    });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => {
    entries?.shutdown();
    selling?.stop();
    collectionService?.stop();
    tcgBrowser?.close();
    stopExpenseTimer?.();
    inbox?.stop();
    store?.close();
  });
}
