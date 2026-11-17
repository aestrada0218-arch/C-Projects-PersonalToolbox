
CREATE TABLE entry_campaigns(id TEXT PRIMARY KEY,productKey TEXT NOT NULL UNIQUE,configJson TEXT NOT NULL,createdAt TEXT NOT NULL,cooldownUntil INTEGER NOT NULL DEFAULT 0);
CREATE TABLE entry_proxies(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,server TEXT NOT NULL,authenticated INTEGER NOT NULL,health TEXT NOT NULL DEFAULT 'Unknown',checkedAt TEXT);
CREATE TABLE entry_jobs(id TEXT PRIMARY KEY,campaignId TEXT NOT NULL REFERENCES entry_campaigns(id) ON DELETE RESTRICT,number INTEGER NOT NULL,profileCipher BLOB NOT NULL,emailKey TEXT NOT NULL,personKey TEXT NOT NULL,householdKey TEXT NOT NULL,proxyId TEXT REFERENCES entry_proxies(id) ON DELETE RESTRICT,status TEXT NOT NULL DEFAULT 'Pending',stage TEXT NOT NULL DEFAULT 'Queued',note TEXT NOT NULL DEFAULT '',attempts INTEGER NOT NULL DEFAULT 0,submissionStartedAt TEXT,completedAt TEXT,confirmation TEXT,updatedAt TEXT NOT NULL,UNIQUE(campaignId,emailKey),UNIQUE(campaignId,personKey));
CREATE INDEX entry_job_queue ON entry_jobs(campaignId,status,number);
CREATE TABLE entry_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,campaignId TEXT NOT NULL REFERENCES entry_campaigns(id) ON DELETE CASCADE,jobId TEXT,at TEXT NOT NULL,message TEXT NOT NULL);
CREATE TABLE entry_code_receipts(messageKey TEXT PRIMARY KEY,jobId TEXT NOT NULL REFERENCES entry_jobs(id) ON DELETE RESTRICT);
CREATE TABLE entry_settings(id INTEGER PRIMARY KEY CHECK(id=1),runnerEmail TEXT);
INSERT INTO entry_settings(id) VALUES(1);
