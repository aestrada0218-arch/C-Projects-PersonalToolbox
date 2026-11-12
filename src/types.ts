import type { InboxState, InboxResult, GmailConnection } from "./inbox-types";
export type Order = {
  id: string;
  name: string;
  store: string;
  category: string;
  total: number;
  status: "Delivered" | "In transit" | "Processing" | "Cancelled";
  date: string;
};
export type Item = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  purchase: number;
  market: number;
};
export type Snapshot = {
  orders: Order[];
  collection: Item[];
  tasks: { id: string; name: string; status: string }[];
};
export type NewOrder = Omit<Order, "id">;
export interface ToolboxAPI {
  snapshot(): Promise<Snapshot>;
  inboxState(): Promise<InboxState>;
  connectGmail(input: GmailConnection): Promise<InboxResult>;
  refreshInbox(): Promise<InboxResult>;
  disconnectGmail(): Promise<InboxResult>;
  setInboxAuto(enabled: boolean): Promise<InboxResult>;
  linkShipment(input: {
    shipmentId: string;
    orderId: string;
  }): Promise<InboxResult>;
  addOrder(order: NewOrder): Promise<Snapshot>;
  exportOrders(): Promise<boolean>;
}
declare global {
  interface Window {
    toolbox?: ToolboxAPI;
  }
}
