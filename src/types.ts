import type {
  CollectionState,
  CollectionResult,
  CatalogResult,
  CatalogSearch,
  ManualCollectible,
  LinkedCollectible,
  QuoteObservation,
  CollectionBrowserState,
} from "./collection-types";
import type {
  ExpenseInput,
  ExpenseState,
  ExpenseResult,
  ExpenseImportPreview,
  ExpenseExportResult,
  ScheduleInput,
} from "./expense-types";
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
  marketKnown?: number;
};
export type Snapshot = {
  orders: Order[];
  collection: Item[];
  tasks: { id: string; name: string; status: string }[];
};
export type NewOrder = Omit<Order, "id">;
export interface ToolboxAPI {
  snapshot(): Promise<Snapshot>;
  collectionState(): Promise<CollectionState>;
  connectPricing(key: string): Promise<CollectionResult>;
  disconnectPricing(): Promise<CollectionResult>;
  searchCatalog(input: CatalogSearch): Promise<CatalogResult>;
  addCatalogItem(input: LinkedCollectible): Promise<CollectionResult>;
  addManualCollectible(input: ManualCollectible): Promise<CollectionResult>;
  editCollectible(input: {
    id: string;
    item: ManualCollectible;
  }): Promise<CollectionResult>;
  deleteCollectible(id: string): Promise<CollectionResult>;
  refreshCollection(id?: string): Promise<CollectionResult>;
  collectionHistory(id: string): Promise<QuoteObservation[]>;
  browseTcg(): Promise<CollectionBrowserState>;
  collectionBrowserState(): Promise<CollectionBrowserState>;
  openCollectionProvider(url: string): Promise<boolean>;
  chooseCollectionImage(): Promise<{ data: string | null; error?: string }>;
  onTcgProduct(callback: (id: string) => void): () => void;
  expenseState(): Promise<ExpenseState>;
  addExpense(input: ExpenseInput): Promise<ExpenseResult>;
  editExpense(input: {
    id: string;
    expense: ExpenseInput;
  }): Promise<ExpenseResult>;
  editExpenseSchedule(input: {
    id: string;
    schedule: ScheduleInput;
  }): Promise<ExpenseResult>;
  stopExpenseSchedule(id: string): Promise<ExpenseResult>;
  deleteExpense(input: {
    id: string;
    stopSeries: boolean;
  }): Promise<ExpenseResult>;
  deleteAllExpenses(): Promise<ExpenseResult>;
  previewExpenseImport(): Promise<ExpenseImportPreview>;
  commitExpenseImport(token: string): Promise<ExpenseResult>;
  exportExpenses(): Promise<ExpenseExportResult>;
  inboxState(): Promise<InboxState>;
  connectGmail(input: GmailConnection): Promise<InboxResult>;
  refreshInbox(): Promise<InboxResult>;
  disconnectGmail(): Promise<InboxResult>;
  setInboxAuto(enabled: boolean): Promise<InboxResult>;
  linkEmailUpdate(input: {
    updateId: string;
    orderId: string;
  }): Promise<InboxResult>;
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
