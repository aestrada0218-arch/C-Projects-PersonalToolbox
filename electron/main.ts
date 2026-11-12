import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { Store } from "./database";
import { InboxService } from "./inbox/service";
import { WindowsCredentialVault } from "./inbox/credentials";
import { GmailImapProvider } from "./inbox/gmail";
import { registerExpenseHandlers } from "./expenses/ipc";
let stopExpenseTimer: (() => void) | undefined;
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
    stopExpenseTimer?.();
    inbox?.stop();
    store?.close();
  });
}
