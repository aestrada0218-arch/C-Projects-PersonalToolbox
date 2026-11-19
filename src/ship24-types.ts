export type TrackingSource = {
  type: "package" | "shipment";
  id: string;
  signature: string;
  trackingNumber: string;
  carrier: string;
  title: string;
  earliestDate: string | null;
};
export type TrackingEvent = {
  date: string;
  status: string;
  location: string;
  milestone: string;
};
export type TrackingSummary = {
  status: "Awaiting shipment" | "In transit" | "Delivered" | "Exception" | null;
  milestone: string;
  estimatedDate: string | null;
  actualDate: string | null;
  events: TrackingEvent[];
  shipmentCount: number;
};
export type Ship24Tracker = {
  id: string;
  trackingNumber: string;
  carrier: string;
  sources: TrackingSource[];
  phase: "pending" | "active" | "uncertain";
  checkedAt: string | null;
  error: string | null;
  summary: TrackingSummary | null;
  currentConnection: boolean;
};
export type Ship24State = {
  error?: string;
  connected: boolean;
  supported: boolean;
  busy: boolean;
  autoEnabled: boolean;
  monthlyCap: number;
  usedThisMonth: number;
  month: string;
  cooldownUntil: number;
  sources: TrackingSource[];
  trackers: Ship24Tracker[];
};
export type Ship24Result = { ok: boolean; error?: string; state: Ship24State };
export type Ship24Registration = {
  source: { type: "package" | "shipment"; id: string; signature: string };
  confirmed: true;
  destinationCountryCode: string | null;
  destinationPostCode: string | null;
  shippingDate: string | null;
};
