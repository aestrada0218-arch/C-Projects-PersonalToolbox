import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "toolbox",
  Object.freeze({
    inboxState: () => ipcRenderer.invoke("toolbox:inbox-state"),
    connectGmail: (input: unknown) =>
      ipcRenderer.invoke("toolbox:connect-gmail", input),
    refreshInbox: () => ipcRenderer.invoke("toolbox:refresh-inbox"),
    disconnectGmail: () => ipcRenderer.invoke("toolbox:disconnect-gmail"),
    setInboxAuto: (enabled: unknown) =>
      ipcRenderer.invoke("toolbox:inbox-auto", enabled),
    linkEmailUpdate: (input: unknown) =>
      ipcRenderer.invoke("toolbox:link-email-update", input),
    linkShipment: (input: unknown) =>
      ipcRenderer.invoke("toolbox:link-shipment", input),
    expenseState: () => ipcRenderer.invoke("toolbox:expense-state"),
    addExpense: (input: unknown) =>
      ipcRenderer.invoke("toolbox:add-expense", input),
    editExpense: (input: unknown) =>
      ipcRenderer.invoke("toolbox:edit-expense", input),
    editExpenseSchedule: (input: unknown) =>
      ipcRenderer.invoke("toolbox:edit-expense-schedule", input),
    stopExpenseSchedule: (id: unknown) =>
      ipcRenderer.invoke("toolbox:stop-expense-schedule", id),
    deleteExpense: (input: unknown) =>
      ipcRenderer.invoke("toolbox:delete-expense", input),
    deleteAllExpenses: () => ipcRenderer.invoke("toolbox:clear-expenses"),
    previewExpenseImport: () =>
      ipcRenderer.invoke("toolbox:preview-expense-import"),
    commitExpenseImport: (token: unknown) =>
      ipcRenderer.invoke("toolbox:commit-expense-import", token),
    exportExpenses: () => ipcRenderer.invoke("toolbox:export-expenses"),
    collectionState: () => ipcRenderer.invoke("toolbox:collection-state"),
    connectPricing: (key: unknown) =>
      ipcRenderer.invoke("toolbox:collection-connect", key),
    disconnectPricing: () =>
      ipcRenderer.invoke("toolbox:collection-disconnect"),
    searchCatalog: (input: unknown) =>
      ipcRenderer.invoke("toolbox:collection-search", input),
    addCatalogItem: (input: unknown) =>
      ipcRenderer.invoke("toolbox:collection-add-linked", input),
    addManualCollectible: (input: unknown) =>
      ipcRenderer.invoke("toolbox:collection-add-manual", input),
    editCollectible: (input: unknown) =>
      ipcRenderer.invoke("toolbox:collection-edit", input),
    deleteCollectible: (id: unknown) =>
      ipcRenderer.invoke("toolbox:collection-delete", id),
    refreshCollection: (id?: unknown) =>
      ipcRenderer.invoke("toolbox:collection-refresh", id),
    collectionHistory: (id: unknown) =>
      ipcRenderer.invoke("toolbox:collection-history", id),
    browseTcg: () => ipcRenderer.invoke("toolbox:collection-browser"),
    collectionBrowserState: () =>
      ipcRenderer.invoke("toolbox:collection-browser-state"),
    openCollectionProvider: (url: unknown) =>
      ipcRenderer.invoke("toolbox:collection-external", url),
    chooseCollectionImage: () => ipcRenderer.invoke("toolbox:collection-image"),
    onTcgProduct: (callback: (id: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: unknown) => {
        if (typeof id === "string" && /^\d{1,12}$/.test(id)) callback(id);
      };
      ipcRenderer.on("toolbox:tcg-product", handler);
      return () => {
        ipcRenderer.removeListener("toolbox:tcg-product", handler);
      };
    },
    snapshot: () => ipcRenderer.invoke("toolbox:snapshot"),
    addOrder: (input: unknown) =>
      ipcRenderer.invoke("toolbox:add-order", input),
    exportOrders: () => ipcRenderer.invoke("toolbox:export-orders"),
  }),
);
