import { carrierLink } from "./organizer/model";
import { BackupManager } from "./organizer/backups";
import { FileCompanionPreferences } from "./mobile/preferences";
import { WorkspaceGateway, type DesktopAction } from "./mobile/workspace";
import { nativeImage, shell } from "electron";
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
let backups: BackupManager;
let backupError: string | undefined;
let restoreError: string | undefined;
let backupTimer: ReturnType<typeof setInterval> | undefined;
let unsubscribeDataChanges: (() => void) | undefined;
let dataChangeTimer: ReturnType<typeof setTimeout> | undefined;
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
  const action = (...args: any[]) =>
    store.withSource(
      "Desktop",
      channel,
      () => {
        if (
          channel === "toolbox:clear-expenses" ||
          (channel === "toolbox:outstanding-delete" &&
            Array.isArray(args[0]?.ids) &&
            args[0].ids.length > 1)
        )
          backups.create(store.exportBackup(), "pre-change");
        if (
          channel === "toolbox:collection-delete" ||
          (channel === "toolbox:organizer-delete" &&
            store.organizer
              .records()
              .some((r) => r.id === args[0]?.id && r.kind === "attachment"))
        )
          backups.create(store.exportBackup(), "pre-change");
        return fn(...args);
      },
      true,
    );
  desktopActions.set(channel, action);
  ipcMain.handle(channel, async (event, ...args) => {
    authorized(event);
    try {
      return await action(...args);
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
      const dataPath = join(app.getPath("userData"), "personal-toolbox.sqlite");
      backups = new BackupManager(
        join(app.getPath("userData"), "backups"),
        dataPath,
        await Store.backupValidator(),
      );
      try {
        backups.applyPending();
      } catch {
        restoreError =
          "The requested restore could not complete. Review the saved backups and storage permissions; the app will open the database currently on disk.";
      }
      store = await Store.open(dataPath);
      const dailyBackup = () => {
        try {
          backups.daily(store.exportBackup());
          backupError = undefined;
        } catch {
          backupError =
            "Automatic backup failed. Check free space and storage permissions.";
        }
      };
      dailyBackup();
      backupTimer = setInterval(dailyBackup, 3600000);
      const organizerState = () => ({
        ...store.organizer.state(),
        backups: backups.list(),
        backupError: backupError || restoreError,
      });
      const organizerResult = (fn: () => unknown) => {
        try {
          fn();
          return { ok: true, state: organizerState() };
        } catch (e) {
          return {
            ok: false,
            error:
              e instanceof z.ZodError
                ? "Check the required fields, amounts and calendar dates."
                : e instanceof Error &&
                    !/SQL|constraint|ENOENT|EACCES|filesystem|UNIQUE/i.test(
                      e.message,
                    )
                  ? e.message
                  : "Could not save this change. Review the record and storage permissions.",
            state: organizerState(),
          };
        }
      };
      handle("toolbox:organizer-state", organizerState);
      handle("toolbox:organizer-alerts", () => {
        const s = store.organizer.state(),
          date = new Date(s.today + "T12:00:00Z");
        date.setUTCDate(date.getUTCDate() + 7);
        const until = date.toISOString().slice(0, 10);
        return {
          overdue: s.reminders.filter((r) => r.overdue).length,
          dueSoon: s.reminders.filter(
            (r) => r.date >= s.today && r.date <= until,
          ).length,
          duplicates: s.duplicates.length,
          backupError: backupError || restoreError,
        };
      });
      handle("toolbox:organizer-track", async (input) => {
        const id = z.string().uuid().parse(input),
          r = store.organizer
            .records()
            .find((r) => r.id === id && r.kind === "package");
        if (!r) throw Error("Package missing");
        await shell.openExternal(carrierLink(r.data));
        return true;
      });
      handle("toolbox:organizer-save", (input) =>
        organizerResult(() => store.organizer.save(input)),
      );
      handle("toolbox:organizer-delete", (input) =>
        organizerResult(() => store.organizer.remove(input)),
      );
      handle("toolbox:organizer-undo", (id) =>
        organizerResult(() => store.organizer.undo(id)),
      );
      handle("toolbox:backup-create", () =>
        organizerResult(() => backups.create(store.exportBackup())),
      );
      handle("toolbox:backup-restore", async (input) => {
        const id = z.string().max(200).parse(input);
        backups.bytes(id);
        const r = await dialog.showMessageBox(window, {
          type: "warning",
          buttons: ["Cancel", "Restore and restart"],
          defaultId: 0,
          cancelId: 0,
          message: "Restore this backup?",
          detail:
            "Changes made since this backup will be replaced. A safety backup of the current database is created at the next launch. Credentials remain in Windows Credential Manager.",
        });
        if (r.response !== 1) return false;
        backups.queueRestore(id);
        if (dev)
          app.relaunch({
            args: process.argv.slice(1).filter((arg) => arg !== "--dev"),
          });
        else app.relaunch();
        app.quit();
        return true;
      });
      handle("toolbox:backup-export", async (input) => {
        const id = z.string().max(200).parse(input),
          bytes = backups.bytes(id);
        const r = await dialog.showSaveDialog(window, {
          defaultPath: "PersonalToolbox-backup.sqlite",
          filters: [{ name: "Toolbox backup", extensions: ["sqlite"] }],
        });
        if (r.canceled || !r.filePath) return false;
        await writeFile(r.filePath, bytes);
        return true;
      });
      handle("toolbox:backup-import", async () => {
        const r = await dialog.showOpenDialog(window, {
          properties: ["openFile"],
          filters: [{ name: "Toolbox backup", extensions: ["sqlite"] }],
        });
        if (r.canceled || !r.filePaths[0]) return organizerResult(() => {});
        const { stat, readFile } = await import("node:fs/promises");
        if ((await stat(r.filePaths[0])).size > 128 * 1024 * 1024)
          throw Error("Backup too large");
        const bytes = await readFile(r.filePaths[0]);
        return organizerResult(() => backups.create(bytes, "import"));
      });
      unsubscribeDataChanges = store.onChange(() => {
        clearTimeout(dataChangeTimer);
        dataChangeTimer = setTimeout(() => {
          if (
            window &&
            !window.isDestroyed() &&
            !window.webContents.isDestroyed()
          )
            window.webContents.send("toolbox:data-changed");
        }, 100);
      });
      const workspace = new WorkspaceGateway(store, desktopActions);
      companion = new CompanionServer(
        store,
        join(__dirname, "../../dist"),
        17863,
        (device, input) =>
          store.withSource(
            "iPhone: " +
              (companion.status().devices.find((d) => d.id === device)?.name ||
                device.slice(0, 8)),
            "Companion",
            () => workspace.execute(device, input),
          ),
        new FileCompanionPreferences(
          join(app.getPath("userData"), "companion-settings.json"),
        ),
      );
      handle("toolbox:companion-status", () => companion.status());
      handle("toolbox:companion-start", (input) => companion.start(input));
      handle("toolbox:companion-stop", () => companion.stop());
      handle("toolbox:companion-pause", () => companion.pause());
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
      handle("toolbox:delete-email-update", (id) => inbox.deleteUpdate(id));
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

      await companion.restore();
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
    clearInterval(backupTimer);
    unsubscribeDataChanges?.();
    clearTimeout(dataChangeTimer);
    companion?.shutdown();
    selling?.stop();
    collectionService?.stop();
    tcgBrowser?.close();
    stopExpenseTimer?.();
    mailboxes?.stop();
    inbox?.stop();
    store?.close();
  });
}
