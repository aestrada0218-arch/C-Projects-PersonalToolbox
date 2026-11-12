import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "toolbox",
  Object.freeze({
    snapshot: () => ipcRenderer.invoke("toolbox:snapshot"),
    addOrder: (input: unknown) =>
      ipcRenderer.invoke("toolbox:add-order", input),
    exportOrders: () => ipcRenderer.invoke("toolbox:export-orders"),
  }),
);
