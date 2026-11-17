export const entryStatuses = [
  "Pending",
  "Running",
  "Waiting",
  "Ready",
  "Completed",
  "Needs review",
  "Failed",
  "Skipped",
] as const;
export type EntryStatus = (typeof entryStatuses)[number];
export type EntryProfile = {
  email: string;
  first_name: string;
  last_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  label: string;
};
export type EntryCampaignInput = {
  name: string;
  url: string;
  concurrency: 1 | 2 | 3 | 4;
  browser: "msedge" | "chrome" | "chromium";
  gmailSource: "off" | "inbox" | "runner";
  senderDomains: string[];
  onePerHousehold: boolean;
};
export type EntryCampaign = EntryCampaignInput & {
  id: string;
  productKey: string;
  createdAt: string;
  cooldownUntil: number;
};
export type EntryJob = {
  id: string;
  campaignId: string;
  number: number;
  label: string;
  profileName: string;
  maskedEmail: string;
  proxyId: string | null;
  status: EntryStatus;
  stage: string;
  note: string;
  attempts: number;
  submissionStartedAt: string | null;
  completedAt: string | null;
  confirmation: string | null;
  updatedAt: string;
  readable: boolean;
};
export type EntryProxy = {
  id: string;
  name: string;
  server: string;
  authenticated: boolean;
  health: "Unknown" | "Reachable" | "Failed";
  checkedAt: string | null;
};
export type EntryProxyInput = {
  id?: string;
  name: string;
  server: string;
  username: string;
  password: string;
};
export type EntryPrompt = {
  id: string;
  jobId: string;
  kind: "manual" | "code" | "review" | "verify";
  message: string;
  createdAt: string;
};
export type EntryLog = {
  id: number;
  campaignId: string;
  jobId: string | null;
  at: string;
  message: string;
};
export type EntryState = {
  campaigns: EntryCampaign[];
  jobs: EntryJob[];
  proxies: EntryProxy[];
  logs: EntryLog[];
  prompts: EntryPrompt[];
  activeCampaignId: string | null;
  running: boolean;
  paused: boolean;
  stopping: boolean;
  secureStorage: boolean;
  credentialSupport: boolean;
  inboxEmail: string | null;
  runnerEmail: string | null;
};
export type EntryResult = { ok: boolean; state: EntryState; error?: string };
export type EntryImportPreview = {
  cancelled?: boolean;
  error?: string;
  token?: string;
  total?: number;
  duplicates?: number;
  rows?: {
    number: number;
    label: string;
    maskedEmail: string;
    proxyName: string;
  }[];
};
export type EntryAnswer = {
  promptId: string;
  action: "continue" | "submit" | "skip";
  code?: string;
  confirmed?: boolean;
};
