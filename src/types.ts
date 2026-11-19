import type {
  Ship24State,
  Ship24Result,
  Ship24Registration,
} from "./ship24-types";
import type {
  OrganizerState,
  OrganizerResult,
  OrganizerKind,
} from "./organizer-types";
import type { CompanionStatus, CompanionResult } from "./mobile-types";
import type {
  MailboxState,
  MailboxResult,
  MailboxInput,
} from "./mailbox-types";
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
import type {
  ShippingState,
  ShippingResult,
  ShippingTaskInput,
  ShippingMonitor,
} from "./shipping-types";
import type {
  SellingState,
  SellingResult,
  ListingDraft,
  EbayConnectionInput,
  SellingReviewResult,
  CategoryGuide,
} from "./selling-types";
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
  openPackageTracking(id: string): Promise<boolean>;
  organizerAlerts?(): Promise<{
    overdue: number;
    dueSoon: number;
    duplicates: number;
    backupError?: string;
  }>;
  organizerState(): Promise<OrganizerState>;
  saveOrganizer(input: {
    id: string | null;
    revision: number | null;
    kind: OrganizerKind;
    data: unknown;
  }): Promise<OrganizerResult>;
  deleteOrganizer(input: {
    id: string;
    revision: number;
  }): Promise<OrganizerResult>;
  undoOrganizer(id: string): Promise<OrganizerResult>;
  createBackup(): Promise<OrganizerResult>;
  restoreBackup(id: string): Promise<boolean>;
  exportBackup(id: string): Promise<boolean>;
  importBackup(): Promise<OrganizerResult>;
  recoverShip24(id: string): Promise<Ship24Result>;
  openShip24Site(page: "dashboard" | "setup"): Promise<boolean>;
  ship24State(): Promise<Ship24State>;
  connectShip24(input: { apiKey: string }): Promise<Ship24Result>;
  disconnectShip24(): Promise<Ship24Result>;
  setShip24Preferences(input: {
    autoEnabled: boolean;
    monthlyCap: number;
  }): Promise<Ship24Result>;
  registerShip24(input: Ship24Registration): Promise<Ship24Result>;
  refreshShip24(id: string): Promise<Ship24Result>;
  readonly mobileMode?: boolean;
  onDataChanged?(callback: () => void): () => void;
  captureEdit?(value: unknown): void;
  openCollectibleReference(id: string): Promise<boolean>;
  updateOrder(input: { id: string; item: NewOrder }): Promise<Snapshot>;
  companionStatus(): Promise<CompanionStatus>;
  startCompanion(input: { url: string }): Promise<CompanionResult>;
  stopCompanion(): Promise<CompanionResult>;
  pauseCompanion(): Promise<CompanionResult>;
  rotateCompanionCode(): Promise<CompanionResult>;
  revokeCompanionDevice(id: string): Promise<CompanionResult>;
  mailboxState(): Promise<MailboxState>;
  connectMailbox(input: MailboxInput): Promise<MailboxResult>;
  disconnectMailbox(id: string): Promise<MailboxResult>;
  setMailboxEnabled(input: {
    id: string;
    enabled: boolean;
  }): Promise<MailboxResult>;
  setOutstandingExpectedDate(input: {
    ids: string[];
    expectedDate: string | null;
  }): Promise<MailboxResult>;
  deleteOutstandingLines(input: {
    ids: string[];
    confirmed: true;
  }): Promise<MailboxResult>;
  scanOutstanding(): Promise<MailboxResult>;
  scanMailboxes(id?: string): Promise<MailboxResult>;
  receiveOutstanding(input: {
    requestId: string;
    id: string;
    quantity: number;
    tab: "cards" | "comics" | "other";
  }): Promise<MailboxResult>;
  deleteOrder(id: string): Promise<Snapshot>;
  sellingState(): Promise<SellingState>;
  sellingCategory(
    id: string,
  ): Promise<SellingResult & { guide?: CategoryGuide }>;
  connectEbay(input: EbayConnectionInput): Promise<SellingResult>;
  disconnectEbay(): Promise<SellingResult>;
  createSellingDraft(input: ListingDraft): Promise<SellingResult>;
  editSellingDraft(input: {
    id: string;
    draft: ListingDraft;
  }): Promise<SellingResult>;
  deleteSellingDraft(id: string): Promise<SellingResult>;
  refreshSellingOptions(): Promise<SellingResult>;
  createSellingLocation(input: {
    name: string;
    zip: string;
  }): Promise<SellingResult>;
  prepareEbayOffer(id: string): Promise<SellingReviewResult>;
  publishEbayOffer(input: {
    token: string;
    confirmed: true;
  }): Promise<SellingResult>;
  reconcileEbayOffer(id: string): Promise<SellingResult>;
  endEbayOffer(id: string): Promise<SellingResult>;
  linkMercariListing(input: {
    id: string;
    url: string;
  }): Promise<SellingResult>;
  confirmMercariInactive(input: {
    id: string;
    expectedId: string;
    confirmed: true;
  }): Promise<SellingResult>;
  recordMercariSale(input: {
    id: string;
    expectedId: string;
    reference: string;
  }): Promise<SellingResult>;
  reviewSellingConflict(id: string): Promise<SellingResult>;
  setSellingAuto(value: boolean): Promise<SellingResult>;
  syncSelling(): Promise<SellingResult>;
  openSellingListing(input: {
    id: string;
    platform: "ebay" | "mercari";
  }): Promise<boolean>;
  openSellingHelp(page: "ebay" | "mercari"): Promise<boolean>;
  copySellingDraft(input: {
    id: string;
    field: "title" | "description" | "all";
  }): Promise<boolean>;
  uploadSellingPhoto(id: string): Promise<SellingResult>;
  shippingState(): Promise<ShippingState>;
  checkSales(): Promise<ShippingResult>;
  setShippingMonitor(
    input: Pick<ShippingMonitor, "enabled" | "intervalHours">,
  ): Promise<ShippingResult>;
  addShippingTask(input: ShippingTaskInput): Promise<ShippingResult>;
  editShippingTask(input: {
    id: string;
    item: ShippingTaskInput;
  }): Promise<ShippingResult>;
  deleteShippingTask(id: string): Promise<ShippingResult>;
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
  deleteEmailUpdate(id: string): Promise<InboxResult>;
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
