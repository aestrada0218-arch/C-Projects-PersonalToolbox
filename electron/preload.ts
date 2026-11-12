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
    snapshot: () => ipcRenderer.invoke("toolbox:snapshot"),
    addOrder: (input: unknown) =>
      ipcRenderer.invoke("toolbox:add-order", input),
    exportOrders: () => ipcRenderer.invoke("toolbox:export-orders"),
  }),
);
