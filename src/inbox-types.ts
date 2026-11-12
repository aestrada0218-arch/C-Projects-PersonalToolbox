export type ShipmentStatus = "In transit" | "Out for delivery" | "Delivered";
export type Shipment = {
  id: string;
  tracking: string;
  carrier: string;
  status: ShipmentStatus;
  received: string;
  subject: string;
  orderId: string | null;
};
export type ShipmentEvent = Omit<Shipment, "id" | "orderId">;
export type InboxAccount = {
  email: string;
  auto: boolean;
  lastSync: string | null;
  error: string | null;
  scanned: number;
  skipped: number;
  limited: boolean;
};
export type InboxState = {
  account: InboxAccount | null;
  shipments: Shipment[];
  updates?: EmailUpdate[];
  syncing: boolean;
  supported: boolean;
};
export type InboxResult = { ok: boolean; state: InboxState; error?: string };
export type GmailConnection = { email: string; appPassword: string };

export type EmailUpdateStatus =
  | "Order confirmed"
  | "In transit"
  | "Out for delivery"
  | "Delivered"
  | "Needs review";
export type EmailUpdate = {
  id: string;
  externalId: string;
  subject: string;
  received: string;
  status: EmailUpdateStatus;
  orderReference: string | null;
  orderId: string | null;
};
export type EmailUpdateEvent = Omit<EmailUpdate, "id" | "orderId">;
