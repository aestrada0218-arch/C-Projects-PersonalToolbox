export type MailboxInput = {
  label: string;
  email: string;
  host: string;
  port: number;
  folder: string;
  password: string;
};
export type MailboxAccount = {
  id: string;
  label: string;
  email: string;
  host: string;
  port: number;
  folder: string;
  enabled: boolean;
  lastSync: string | null;
  error: string | null;
  scanned: number;
  skipped: number;
  limited: boolean;
  legacy: boolean;
};
export type OutstandingLine = {
  id: string;
  transactionId: string;
  line: number;
  description: string;
  unitCents: number;
  quantity: number;
  amountCents: number;
  purchaseDate: string;
  kind: "item" | "shipping";
  receivedQty: number;
  accountId: string | null;
  collectionId: string | null;
};
export type Receipt = {
  transactionId: string;
  purchaseDate: string;
  lines: {
    description: string;
    unitCents: number;
    quantity: number;
    amountCents: number;
    kind: "item" | "shipping";
  }[];
};
export type MailboxState = {
  accounts: MailboxAccount[];
  outstanding: OutstandingLine[];
  busy: boolean;
  supported: boolean;
};
export type MailboxResult = {
  ok: boolean;
  state: MailboxState;
  error?: string;
};
