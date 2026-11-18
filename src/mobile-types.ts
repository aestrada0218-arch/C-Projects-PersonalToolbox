export type CompanionStatus = {
  running: boolean;
  error?: string;
  url: string | null;
  pairCode: string | null;
  pairExpiresAt: string | null;
  devices: { id: string; name: string; lastSeen: string; expiresAt: string }[];
};
export type CompanionResult = {
  ok: boolean;
  state: CompanionStatus;
  error?: string;
};
export type MobileSnapshot = {
  updatedAt: string;
  collection: {
    id: string;
    name: string;
    category: string;
    collectionType: string;
    quantity: number;
    purchaseCents: number;
    valueCents: number | null;
    purchaseDate: string | null;
  }[];
  outstanding: {
    id: string;
    description: string;
    quantity: number;
    receivedQty: number;
    unitCents: number;
    purchaseDate: string;
    expectedDate: string | null;
    version: string;
  }[];
  tasks: {
    id: string;
    name: string;
    shipBy: string | null;
    status: string;
    orderReference: string | null;
    version: string;
  }[];
  expenses: {
    id: string;
    description: string;
    category: string;
    amountCents: number;
    date: string;
  }[];
  monthExpenseCents: number;
  monthlyRecurringCents: number;
  today: string;
};
