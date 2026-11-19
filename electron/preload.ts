import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "toolbox",
  Object.freeze({
    onDataChanged: (callback: () => void) => {
      if (typeof callback !== "function")
        throw new TypeError("Callback required");
      const listener = () => callback();
      ipcRenderer.on("toolbox:data-changed", listener);
      return () => ipcRenderer.removeListener("toolbox:data-changed", listener);
    },
    openCollectibleReference: (id: unknown) =>
      ipcRenderer.invoke("toolbox:collection-reference", id),
    updateOrder: (input: unknown) =>
      ipcRenderer.invoke("toolbox:update-order", input),
    companionStatus: () => ipcRenderer.invoke("toolbox:companion-status"),
    startCompanion: (input: unknown) =>
      ipcRenderer.invoke("toolbox:companion-start", input),
    pauseCompanion: () => ipcRenderer.invoke("toolbox:companion-pause"),
    stopCompanion: () => ipcRenderer.invoke("toolbox:companion-stop"),
    rotateCompanionCode: () => ipcRenderer.invoke("toolbox:companion-pair"),
    revokeCompanionDevice: (id: unknown) =>
      ipcRenderer.invoke("toolbox:companion-revoke", id),
    setOutstandingExpectedDate: (input: unknown) =>
      ipcRenderer.invoke("toolbox:outstanding-date", input),
    deleteOutstandingLines: (input: unknown) =>
      ipcRenderer.invoke("toolbox:outstanding-delete", input),
    scanOutstanding: () => ipcRenderer.invoke("toolbox:outstanding-scan"),
    mailboxState: () => ipcRenderer.invoke("toolbox:mailboxes-state"),
    connectMailbox: (input: unknown) =>
      ipcRenderer.invoke("toolbox:mailboxes-connect", input),
    disconnectMailbox: (id: unknown) =>
      ipcRenderer.invoke("toolbox:mailboxes-disconnect", id),
    setMailboxEnabled: (input: unknown) =>
      ipcRenderer.invoke("toolbox:mailboxes-enabled", input),
    scanMailboxes: (id?: unknown) =>
      ipcRenderer.invoke("toolbox:mailboxes-scan", id),
    receiveOutstanding: (input: unknown) =>
      ipcRenderer.invoke("toolbox:outstanding-receive", input),
    deleteOrder: (id: unknown) =>
      ipcRenderer.invoke("toolbox:delete-order", id),
    sellingState: () => ipcRenderer.invoke("toolbox:selling-state"),
    sellingCategory: (id: unknown) =>
      ipcRenderer.invoke("toolbox:selling-category", id),
    connectEbay: (input: unknown) =>
      ipcRenderer.invoke("toolbox:selling-connect", input),
    disconnectEbay: () => ipcRenderer.invoke("toolbox:selling-disconnect"),
    createSellingDraft: (input: unknown) =>
      ipcRenderer.invoke("toolbox:selling-create", input),
    editSellingDraft: (input: unknown) =>
      ipcRenderer.invoke("toolbox:selling-edit", input),
    deleteSellingDraft: (id: unknown) =>
      ipcRenderer.invoke("toolbox:selling-delete", id),
    refreshSellingOptions: () => ipcRenderer.invoke("toolbox:selling-options"),
    createSellingLocation: (input: unknown) =>
      ipcRenderer.invoke("toolbox:selling-location", input),
    prepareEbayOffer: (id: unknown) =>
      ipcRenderer.invoke("toolbox:selling-prepare", id),
    publishEbayOffer: (input: unknown) =>
      ipcRenderer.invoke("toolbox:selling-publish", input),
    reconcileEbayOffer: (id: unknown) =>
      ipcRenderer.invoke("toolbox:selling-reconcile", id),
    endEbayOffer: (id: unknown) =>
      ipcRenderer.invoke("toolbox:selling-end", id),
    linkMercariListing: (input: unknown) =>
      ipcRenderer.invoke("toolbox:selling-link-mercari", input),
    confirmMercariInactive: (input: unknown) =>
      ipcRenderer.invoke("toolbox:selling-inactive-mercari", input),
    recordMercariSale: (input: unknown) =>
      ipcRenderer.invoke("toolbox:selling-sale-mercari", input),
    reviewSellingConflict: (id: unknown) =>
      ipcRenderer.invoke("toolbox:selling-conflict", id),
    setSellingAuto: (value: unknown) =>
      ipcRenderer.invoke("toolbox:selling-auto", value),
    syncSelling: () => ipcRenderer.invoke("toolbox:selling-sync"),
    openSellingListing: (input: unknown) =>
      ipcRenderer.invoke("toolbox:selling-open", input),
    openSellingHelp: (page: unknown) =>
      ipcRenderer.invoke("toolbox:selling-help", page),
    copySellingDraft: (input: unknown) =>
      ipcRenderer.invoke("toolbox:selling-copy", input),
    uploadSellingPhoto: (id: unknown) =>
      ipcRenderer.invoke("toolbox:selling-photo", id),
    shippingState: () => ipcRenderer.invoke("toolbox:shipping-state"),
    checkSales: () => ipcRenderer.invoke("toolbox:shipping-check"),
    setShippingMonitor: (input: unknown) =>
      ipcRenderer.invoke("toolbox:shipping-monitor", input),
    addShippingTask: (input: unknown) =>
      ipcRenderer.invoke("toolbox:shipping-add", input),
    editShippingTask: (input: unknown) =>
      ipcRenderer.invoke("toolbox:shipping-edit", input),
    deleteShippingTask: (id: unknown) =>
      ipcRenderer.invoke("toolbox:shipping-delete", id),
    inboxState: () => ipcRenderer.invoke("toolbox:inbox-state"),
    connectGmail: (input: unknown) =>
      ipcRenderer.invoke("toolbox:connect-gmail", input),
    refreshInbox: () => ipcRenderer.invoke("toolbox:refresh-inbox"),
    disconnectGmail: () => ipcRenderer.invoke("toolbox:disconnect-gmail"),
    setInboxAuto: (enabled: unknown) =>
      ipcRenderer.invoke("toolbox:inbox-auto", enabled),
    deleteEmailUpdate: (id: unknown) =>
      ipcRenderer.invoke("toolbox:delete-email-update", id),
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
