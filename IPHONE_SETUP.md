# Add Personal Toolbox to your iPhone

This is a private mobile web companion. No App Store account or Mac is needed. Your existing Windows app remains the source of truth and must stay open on an awake PC. Version 0.11 opens the **full toolbox** by default after pairing, using the same editors and validation as Windows:

- Orders: add, edit, search, delete and export CSV.
- Collection: search cards, add items, edit quantities/prices/sections, attach photos, delete items and refresh values.
- Outstanding orders: scan connected mailboxes, receive items, set expected-arrival dates and select/delete multiple lines.
- Expenses: add/edit/delete charges, manage recurring schedules and import/export CSV with preview.
- Tasks: add/edit/delete shipment tasks and update their status.
- Inbox: connect and manage Gmail/IMAP inboxes and run supported checks.
- Selling: manage drafts, add photos and use the existing eBay and assisted Mercari controls, including the same publish confirmations.

**Quick view** remains available for the compact companion. Phone changes save to the same database immediately. Connecting an account from the phone sends its credential over your private HTTPS connection to Windows Credential Manager; saved passwords and API keys are never returned to the phone.

## 1. Update the Windows app

Close Personal Toolbox. Copy the extracted project contents containing `package.json` over `C:\Projects\PersonalToolbox`, replacing source files and keeping `node_modules`.

```powershell
cd C:\Projects\PersonalToolbox
npm install
npm run dev
```

Development startup now builds the companion assets automatically. For a production build use `npm run build` followed by `npm start`. The mobile companion remains disabled until you first enable it in Settings. After that it starts automatically with Personal Toolbox; Pause turns automatic startup off. No new database migration is needed when upgrading from v0.9 to v0.10. Your existing Tailscale Serve configuration can stay in place. After updating Windows, refresh/reopen the iPhone app and pair again if prompted.

## 2. Connect your devices privately

1. Install [Tailscale for Windows](https://tailscale.com/download/windows) on your PC and [Tailscale for iPhone](https://tailscale.com/download/ios) on your iPhone.
2. Sign in to the same Tailscale account/private network on both devices. Keep Tailscale connected.
3. On Windows, open a new PowerShell window and run:

```powershell
tailscale serve --bg http://127.0.0.1:17863
```

If PowerShell cannot find the command, use:

```powershell
& "$env:ProgramFiles\Tailscale\tailscale.exe" serve --bg http://127.0.0.1:17863
```

Follow any Tailscale prompt to enable HTTPS for your private network. Copy the **HTTPS address ending in `.ts.net`** printed by Tailscale, such as `https://your-pc.your-tailnet.ts.net`. Use your actual address, not this example. Tailscale Serve is private to your tailnet; do not use Funnel or router port forwarding.

The local app server binds **127.0.0.1:17863 only**. Tailscale Serve provides the HTTPS connection and private network access. The phone cannot use `127.0.0.1`, the PC's LAN address, or an ordinary HTTP bookmark as a substitute.

## 3. Enable and pair

1. In Personal Toolbox on Windows, open **Settings → iPhone companion**.
2. Paste the private HTTPS address and click **Enable iPhone companion**.
3. On your iPhone, open that same address in **Safari**.
4. Enter a device name and the **8-digit pairing code** shown on your PC. Codes expire after five minutes and work once; use **New pairing code** if necessary.
5. In Safari, choose **Share → Add to Home Screen**. Open the saved Toolbox icon. iOS may use separate cookies for the saved app, so generate another code on your PC and pair there if prompted.

Only pair devices you control. The HTTPS address is remembered on Windows, including after pausing or closing the app. Enabling the companion also enables automatic startup the next time you open Personal Toolbox. A remembered iPhone stays paired for **30 days from pairing**, including across normal PC app restarts, Tailscale disconnections and phone restarts. The app does not start Windows or wake a sleeping PC.

**Pause companion** stops phone access and automatic startup but retains the address and remembered phones. Click **Enable iPhone companion** to resume without pasting the URL or pairing again. **Revoke**, the phone's **Unpair** button, and **Stop companion and unpair all devices** explicitly forget the affected phone(s). The last address remains saved. Changing the configured HTTPS address also forgets devices. Clearing browser data, switching Safari/Home Screen storage, expiration or deleting desktop settings requires pairing again. Pairing codes themselves remain single-use, expire after five minutes and are never saved across app restarts.

Upgrading from v0.10.0 requires entering the address and pairing once more because that version did not save them. Subsequent normal restarts remember both.

## Using the companion

Changes save directly to the same SQLite database used by Windows. After a successful phone save, the open desktop dashboard and data panels refresh automatically, usually within a second; restarting or switching tabs is unnecessary. View refreshes preserve searches and unfinished form inputs. The full interface has touch-sized controls, horizontally scrolling navigation and tables that become labeled cards on narrow screens. Use **Refresh** when needed. **Quick view** switches to the compact companion; **Full toolbox** returns to all editors.

Local lists default to 25 rows with a 50-row dropdown. Search applies to all records in the selected tab before pagination. Saved collection references open their web page, and Analytics collection categories open matching inventory inside Toolbox.

Phone file/photo buttons use the iPhone picker; CSV exports download in Safari. Collection photos are resized before upload. eBay listing photos are validated and processed on Windows. TCGplayer browsing opens in Safari; copy a product URL into the collection search to look it up. The embedded Windows browser's product-selection menu is available only on the PC.

Gmail scans, price requests and marketplace operations initiated from your phone execute on the connected Windows app using its existing services and limits. No scans or background jobs run independently on iOS. Mercari remains an assisted/manual listing workflow; phone access does not add automatic Mercari publishing or delisting.

An open phone editor keeps the version you started editing. If the same record changes on Windows, saving fails with a clear message instead of overwriting it. Close the editor, refresh, review the latest record and edit again. Repeating the same interrupted request is protected against duplicates for ten minutes; check saved data before starting another action. No edits are queued offline.

Companion enabling, pairing-code generation and device revocation remain in **Windows Settings**. Phone Settings explains these controls. The phone cannot access arbitrary PC files, execute shell commands or read saved credentials.

## If it does not connect

- Confirm both devices are signed into and connected to the same Tailscale network.
- Keep the PC awake and Personal Toolbox open. Reopening the app automatically resumes an enabled companion. If you deliberately paused it, enable it again; pairing is retained.
- Confirm the exact HTTPS address matches the one entered in Settings and the address printed by `tailscale serve`.
- Check `tailscale serve status` on Windows and verify it forwards to `http://127.0.0.1:17863`.
- If enabling fails, run `npm run build` and restart the app. Another program may be using port 17863.
- If a code expires or is already used, generate a new code. After five pairing attempts in one minute, wait one minute before retrying.
- If the phone says the connection is lost, treat any displayed data as stale. No changes are queued offline. Once connected, refresh before editing.

You can remove the Tailscale Serve forwarding later with `tailscale serve reset`. That command resets this PC's Serve configuration, including any other Serve routes you configured; use the Tailscale controls if you need to preserve other routes.

## Security and validation

The companion uses a private HTTPS origin, single-use pairing codes, 256-bit session tokens, Secure/HttpOnly/SameSite cookies, server-side revocation, CSRF protection, input validation, origin/host checks and narrow API operations. The bearer token lives only in the phone's secure cookie. Windows remembers its SHA-256 hash, device identity/expiry, configured origin and enabled state in an atomically replaced `companion-settings.json` file in the app data folder. Bearer tokens, pairing codes, CSRF secrets and account credentials are never written to that file or logs. CSRF secrets rotate on desktop restart. Interrupted full-workspace writes from an earlier process are rejected so a remembered session cannot replay an uncertain save after restart. The offline service worker caches app files only and bypasses API responses. API responses use `Cache-Control: no-store`.

Automated tests use a real local server/database and a simulated private HTTPS origin in an iPhone-sized Chromium browser. They cover pairing, cookies, data reads, full phone editors, photo selection, CSV download/import, recurring expenses, bulk outstanding edits/deletes, request idempotency, stale edits, revocation, expiry, remembered pairing, automatic restart, pause/resume, durable revocation, corrupt settings, storage failures, rate limits, forbidden operations, offline behavior and the desktop enable/stop flow. A physical iPhone, Safari Home Screen installation and a live Tailscale connection must be checked on your devices.
