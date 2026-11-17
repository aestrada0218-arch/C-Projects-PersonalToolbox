export type EbayEnvironment = "sandbox" | "production";
export const listingConditions = [
  "NEW",
  "NEW_OTHER",
  "LIKE_NEW",
  "USED_EXCELLENT",
  "USED_VERY_GOOD",
  "USED_GOOD",
  "USED_ACCEPTABLE",
  "FOR_PARTS_OR_NOT_WORKING",
] as const;
export type ListingDraft = {
  collectionId: string;
  unitLabel: string;
  title: string;
  description: string;
  priceCents: number;
  condition: (typeof listingConditions)[number];
  conditionDescription: string;
  conditionDescriptors: {
    name: string;
    values: string[];
    additionalInfo?: string;
  }[];
  aspects: Record<string, string[]>;
  photoUrls: string[];
  categoryId: string;
  locationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  autoEndEbay: boolean;
};
export type EbayListingState =
  "draft" | "prepared" | "active" | "inactive" | "uncertain" | "sold";
export type SellingUnit = ListingDraft & {
  id: string;
  sku: string;
  revision: number;
  environment: EbayEnvironment | null;
  connectionKey: string | null;
  offerId: string | null;
  ebayListingId: string | null;
  ebayState: EbayListingState;
  mercariId: string | null;
  mercariState: "unlinked" | "active" | "inactive" | "sold";
  soldOn: "ebay" | "mercari" | null;
  soldAt: string | null;
  saleReference: string | null;
  conflict: boolean;
  conflictReviewed: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
export type SellingOptions = {
  locations: { id: string; name: string }[];
  fulfillment: { id: string; name: string }[];
  payment: { id: string; name: string }[];
  returns: { id: string; name: string }[];
};
export type SellingSettings = {
  connected: boolean;
  supported: boolean;
  environment: EbayEnvironment;
  label: string;
  connectionKey: string | null;
  automatic: boolean;
  options: SellingOptions;
  lastSync: string | null;
  nextSync: string | null;
  cooldownUntil: number;
  error: string | null;
};
export type SellingState = {
  units: SellingUnit[];
  stock: { id: string; name: string; quantity: number; allocated: number }[];
  settings: SellingSettings;
  busy: boolean;
  progress: string;
};
export type SellingResult = {
  ok: boolean;
  state: SellingState;
  error?: string;
};
export type EbayConnectionInput = {
  environment: EbayEnvironment;
  label: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};
export type PublishReview = {
  token: string;
  unit: SellingUnit;
  environment: EbayEnvironment;
  expiresAt: string;
  options: SellingOptions;
};
export type SellingReviewResult = SellingResult & { review?: PublishReview };
export type SellingSale = {
  eventId: string;
  orderId: string;
  listingId: string;
  sku: string;
  quantity: number;
  at: string;
};
export type CategoryGuide = {
  aspects: { name: string; required: boolean; values: string[] }[];
  conditions: {
    id: string;
    name: string;
    descriptors: {
      id: string;
      name: string;
      required: boolean;
      freeText: boolean;
      values: { id: string; name: string }[];
    }[];
  }[];
};
