import type { Order } from "./types";
import type { OwnedCollectible } from "./collection-types";
export const organizerKinds = [
  "line",
  "receipt",
  "package",
  "return",
  "details",
  "wishlist",
  "sale",
  "budget",
  "reminder",
  "attachment",
] as const;
export type OrganizerKind = (typeof organizerKinds)[number];
export type OrganizerRecord = {
  id: string;
  kind: OrganizerKind;
  data: Record<string, any>;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type HistoryEntry = {
  id: string;
  label: string;
  actor: string;
  createdAt: string;
  undoable: boolean;
  undoneAt: string | null;
  summary: string;
};
export type Reminder = {
  id: string;
  title: string;
  date: string;
  section: string;
  overdue: boolean;
};
export type BackupInfo = {
  id: string;
  createdAt: string;
  bytes: number;
  reason: string;
};
export type OrganizerState = {
  orders: Order[];
  collection: OwnedCollectible[];
  records: OrganizerRecord[];
  history: HistoryEntry[];
  reminders: Reminder[];
  duplicates: { source: string; name: string; ids: string[] }[];
  budgets: { category: string; budgetCents: number; spentCents: number }[];
  backups: BackupInfo[];
  backupError?: string;
  today: string;
};
export type OrganizerResult = {
  ok: boolean;
  error?: string;
  state: OrganizerState;
};
