export const shippingStatuses = [
  "Needs Shipment",
  "Shipped",
  "Cancelled",
] as const;
export type ShippingStatus = (typeof shippingStatuses)[number];
export const paymentStatuses = [
  "Paid",
  "Awaiting payment",
  "Needs review",
] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];
export type ShippingTaskInput = {
  name: string;
  orderReference: string | null;
  shipBy: string | null;
  status: ShippingStatus;
  paymentStatus: PaymentStatus;
  notes: string;
};
export type ShippingTask = ShippingTaskInput & {
  id: string;
  source: "ebay-email" | "manual";
  sourceSubject: string | null;
  received: string;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  completedAt: string | null;
};
export type SalesCursor = { uidValidity: string | null; lastUid: number };
export type SaleEmailEvent = {
  externalId: string;
  name: string;
  orderReference: string | null;
  shipBy: string | null;
  paymentStatus: PaymentStatus;
  subject: string;
  received: string;
};
export type SalesScan = {
  sales: SaleEmailEvent[];
  scanned: number;
  skipped: number;
  limited: boolean;
  cursor: SalesCursor;
};
export type ShippingMonitor = {
  enabled: boolean;
  intervalHours: 2 | 3 | 6 | 12;
  lastAttempt: string | null;
  lastSuccess: string | null;
  nextRun: string | null;
  error: string | null;
  scanned: number;
  skipped: number;
  limited: boolean;
};
export type ShippingState = {
  items: ShippingTask[];
  monitor: ShippingMonitor;
  accountEmail: string | null;
  syncing: boolean;
  today: string;
};
export type ShippingResult = {
  ok: boolean;
  state: ShippingState;
  error?: string;
  added?: number;
};
