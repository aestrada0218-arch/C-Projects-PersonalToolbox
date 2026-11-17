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
import type {
  EntryState,
  EntryResult,
  EntryCampaignInput,
  EntryProfile,
  EntryProxyInput,
  EntryImportPreview,
  EntryAnswer,
} from "./entry-types";
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
  entryState(): Promise<EntryState>;
  createEntryCampaign(input: EntryCampaignInput): Promise<EntryResult>;
  editEntryCampaign(input: {
    id: string;
    config: EntryCampaignInput;
  }): Promise<EntryResult>;
  entryProfile(id: string): Promise<EntryProfile>;
  editEntryProfile(input: {
    id: string;
    profile: EntryProfile;
    proxyId: string | null;
  }): Promise<EntryResult>;
  deleteEntryJob(id: string): Promise<EntryResult>;
  retryEntryJob(input: { id: string; reviewed: true }): Promise<EntryResult>;
  previewEntryImport(id: string): Promise<EntryImportPreview>;
  commitEntryImport(token: string): Promise<EntryResult>;
  saveEntryTemplate(): Promise<boolean>;
  saveEntryProxy(input: EntryProxyInput): Promise<EntryResult>;
  deleteEntryProxy(id: string): Promise<EntryResult>;
  testEntryProxy(id: string): Promise<EntryResult>;
  connectEntryGmail(input: GmailConnection): Promise<EntryResult>;
  disconnectEntryGmail(): Promise<EntryResult>;
  startEntries(input: {
    campaignId: string;
    confirmed: true;
    reviewJobId?: string;
  }): Promise<EntryResult>;
  answerEntryPrompt(input: EntryAnswer): Promise<EntryResult>;
  focusEntryBrowser(id: string): Promise<EntryResult>;
  pauseEntries(): Promise<EntryResult>;
  resumeEntries(): Promise<EntryResult>;
  stopEntries(): Promise<EntryResult>;
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
