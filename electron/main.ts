import { WorkspaceGateway, type DesktopAction } from "./mobile/workspace";
import { nativeImage } from "electron";
import { z } from "zod";
import { safePhotoSize } from "./collection/photo";
import { CompanionServer } from "./mobile/server";
import { MailboxService } from "./mailboxes/service";
import { net } from "electron";
import { CollectionService, type PricingSecret } from "./collection/service";
import { JustTcgProvider } from "./collection/justtcg";
import { TcgCatalogBrowser } from "./collection/browser";
import { registerCollectionHandlers } from "./collection/ipc";
import { app, BrowserWindow, ipcMain, dialog } from "electron";
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
let mailboxes: MailboxService;
let store: Store;
let companion: CompanionServer;
const desktopActions = new Map<string, DesktopAction>();
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
  desktopActions.set(channel, fn);
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
      const workspace = new WorkspaceGateway(store, desktopActions);
      companion = new CompanionServer(
        store,
        join(__dirname, "../../dist"),
        17863,
        (device, input) => workspace.execute(device, input),
      );
      handle("toolbox:companion-status", () => companion.status());
      handle("toolbox:companion-start", (input) => companion.start(input));
      handle("toolbox:companion-stop", () => companion.stop());
      handle("toolbox:companion-pair", () => companion.rotatePairCode());
      handle("toolbox:companion-revoke", (id) => companion.revoke(id));
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
      const primaryProvider = new GmailImapProvider();
      inbox = new InboxService(store, new WindowsCredentialVault(), {
        scan: (secret) => primaryProvider.scan(secret),
        cancel: () => primaryProvider.cancel(),
      });
      mailboxes = new MailboxService(
        store,
        new WindowsCredentialVault(),
        (id) => new WindowsCredentialVault("PersonalToolbox/IMAP/" + id),
      );
      handle("toolbox:mailboxes-state", () => mailboxes.state());
      handle("toolbox:mailboxes-connect", (input) => mailboxes.connect(input));
      handle("toolbox:mailboxes-disconnect", (id) => mailboxes.disconnect(id));
      handle("toolbox:mailboxes-enabled", (input) =>
        mailboxes.setEnabled(input),
      );
      handle("toolbox:outstanding-scan", () =>
        mailboxes.refresh(undefined, false, true),
      );
      handle("toolbox:mailboxes-scan", (id) => mailboxes.refresh(id));
      handle("toolbox:outstanding-date", (input) =>
        mailboxes.setExpectedDate(input),
      );
      handle("toolbox:outstanding-delete", (input) =>
        mailboxes.deleteLines(input),
      );
      handle("toolbox:outstanding-receive", (input) =>
        mailboxes.receive(input),
      );
      mailboxes.start();
      handle("toolbox:inbox-state", () => ({
        ...inbox.state(),
        syncing: inbox.state().syncing || mailboxes.state().busy,
      }));
      handle("toolbox:connect-gmail", (input) =>
        mailboxes.state().busy
          ? {
              ok: false,
              error: "Wait for the active mailbox scan to finish.",
              state: inbox.state(),
            }
          : inbox.connect(input),
      );
      handle("toolbox:refresh-inbox", () => inbox.refresh());
      handle("toolbox:disconnect-gmail", () =>
        mailboxes.state().busy
          ? {
              ok: false,
              error: "Wait for the active mailbox scan to finish.",
              state: inbox.state(),
            }
          : inbox.disconnect(),
      );
      handle("toolbox:inbox-auto", (value) => inbox.setAuto(value));
      handle("toolbox:link-email-update", (input) => inbox.linkUpdate(input));
      handle("toolbox:link-shipment", (input) => inbox.link(input));
      inbox.start();
      const shippingState = () => ({
        ...inbox.shippingState(),
        accountEmail:
          mailboxes
            .state()
            .accounts.map((a) => a.email)
            .join(", ") || null,
        syncing: inbox.state().syncing || mailboxes.state().busy,
      });
      handle("toolbox:shipping-state", shippingState);
      handle("toolbox:shipping-check", async () => {
        const result = await mailboxes.refresh();
        return {
          ok: result.ok,
          error: result.error,
          state: shippingState(),
        };
      });
      handle("toolbox:shipping-monitor", (input) => {
        const result = inbox.setShippingMonitor(input);
        if (result.ok) store.mail.resetSalesSchedule();
        return { ...result, state: shippingState() };
      });
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
      handle("toolbox:delete-order", (id) => store.deleteOrder(id));
      handle("toolbox:update-order", (input) => store.updateOrder(input));
      handle("toolbox:mobile-selling-photo", async (input) => {
        const { id, data } = z
          .object({
            id: z.string().uuid(),
            data: z
              .string()
              .max(4 * 1024 * 1024)
              .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
          })
          .strict()
          .parse(input);
        const bytes = Buffer.from(data.split(",")[1], "base64"),
          size = safePhotoSize(bytes);
        if (
          !size ||
          Math.max(size.width, size.height) < 500 ||
          Math.max(size.width, size.height) > 1600
        )
          throw Error("PHOTO_INVALID");
        const image = nativeImage.createFromBuffer(bytes);
        if (image.isEmpty()) throw Error("PHOTO_INVALID");
        return selling.upload(id, image.toJPEG(90));
      });
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
    companion?.stop();
    selling?.stop();
    collectionService?.stop();
    tcgBrowser?.close();
    stopExpenseTimer?.();
    mailboxes?.stop();
    inbox?.stop();
    store?.close();
  });
}
