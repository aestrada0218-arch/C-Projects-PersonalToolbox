export type CollectionTab = "cards" | "comics" | "other";
export type PriceState = "manual" | "current" | "expired" | "unpriced";
export type CatalogVariant = {
  id: string;
  selectionId: string;
  condition: string;
  printing: string;
  language: string;
  valueCents: number | null;
  lastKnownCents: number | null;
  observedAt: string | null;
  state: PriceState;
};
export type CatalogCard = {
  id: string;
  name: string;
  game: string;
  setName: string;
  number: string;
  productId: string | null;
  variants: CatalogVariant[];
  checkedAt: string;
};
export type OwnedCollectible = {
  id: string;
  name: string;
  category: string;
  collectionType: CollectionTab;
  quantity: number;
  purchaseCents: number;
  valueCents: number | null;
  lastKnownCents: number | null;
  provider: "manual" | "justtcg";
  cardId: string | null;
  variantId: string | null;
  productId: string | null;
  condition: string;
  printing: string;
  language: string;
  setName: string;
  referenceUrl: string | null;
  imageData: string | null;
  state: PriceState;
  observedAt: string | null;
  checkedAt: string | null;
  error: string | null;
};
export type QuoteObservation = {
  id: string;
  itemId: string;
  valueCents: number | null;
  state: string;
  checkedAt: string;
  observedAt: string | null;
  source: string;
};
export type PricingSettings = {
  connected: boolean;
  supported: boolean;
  games: { id: string; name: string }[];
  cooldownUntil: number;
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
};
export type CollectionState = {
  items: OwnedCollectible[];
  settings: PricingSettings;
  busy: boolean;
  progress: string;
};
export type CollectionResult = {
  ok: boolean;
  state: CollectionState;
  error?: string;
  updated?: number;
  failed?: number;
};
export type CatalogSearch = { query: string; game: string; offset: number };
export type CatalogResult = {
  ok: boolean;
  cards: CatalogCard[];
  hasMore: boolean;
  searchQuery?: string;
  error?: string;
  settings: PricingSettings;
};
export type ManualCollectible = {
  name: string;
  category: string;
  collectionType: CollectionTab;
  quantity: number;
  purchaseCents: number;
  valueCents: number | null;
  referenceUrl: string | null;
  imageData: string | null;
};
export type LinkedCollectible = {
  selectionId: string;
  quantity: number;
  purchaseCents: number;
};
export type CollectionBrowserState = {
  open: boolean;
  productId: string | null;
  url: string | null;
};
