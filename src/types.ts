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
  addOrder(order: NewOrder): Promise<Snapshot>;
  exportOrders(): Promise<boolean>;
}
declare global {
  interface Window {
    toolbox?: ToolboxAPI;
  }
}
