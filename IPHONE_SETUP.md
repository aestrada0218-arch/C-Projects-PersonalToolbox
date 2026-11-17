# Add Personal Toolbox to your iPhone

This is a private mobile web companion. No App Store account or Mac is needed. Your existing Windows app remains the source of truth and must stay open on an awake PC. The first version supports:

- Viewing collection items, outstanding purchases, expenses and shipment tasks.
- Setting or clearing an expected-arrival date.
- Receiving all or part of an outstanding quantity into Cards, Comic books or Other collectibles.
- Updating a shipment task to Needs Shipment, Shipped or Cancelled.

Email connections, price-provider keys, full emails and destructive desktop controls are not exposed to the phone.

## 1. Update the Windows app

Close Personal Toolbox. Copy the extracted project contents containing `package.json` over `C:\Projects\PersonalToolbox`, replacing source files and keeping `node_modules`.

```powershell
cd C:\Projects\PersonalToolbox
npm install
npm run dev
```

Development startup now builds the companion assets automatically. For a production build use `npm run build` followed by `npm start`. The mobile companion remains disabled until you enable it in Settings. No new database migration is needed for v0.9.

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

Only pair devices you control. Desktop Settings lists paired device names and lets you revoke one immediately. Stopping the companion unpairs every device. Pairing codes and sessions are cleared when the app restarts; enable the companion and pair again afterward. Otherwise device sessions expire after seven days.

## Using the companion

Changes save directly to the same SQLite database used by Windows. The phone refreshes while visible and when brought back to the foreground. You can also use the refresh button. Expected-date and task changes reject an outdated version instead of overwriting a newer desktop edit; cancel the edit, refresh, review the item and try again. Receiving uses a unique request ID so retrying a lost response does not duplicate collection items.

The phone does not run Gmail scans, price refreshes, marketplace publishing or browser automation. Those continue on the desktop. Expense and collection browsing are read-only in this first mobile release. Email passwords and API keys remain in Windows Credential Manager.

## If it does not connect

- Confirm both devices are signed into and connected to the same Tailscale network.
- Keep the PC awake and Personal Toolbox open. Reopening the app requires enabling and pairing again.
- Confirm the exact HTTPS address matches the one entered in Settings and the address printed by `tailscale serve`.
- Check `tailscale serve status` on Windows and verify it forwards to `http://127.0.0.1:17863`.
- If enabling fails, run `npm run build` and restart the app. Another program may be using port 17863.
- If a code expires or is already used, generate a new code. After five pairing attempts in one minute, wait one minute before retrying.
- If the phone says the connection is lost, treat any displayed data as stale. No changes are queued offline. Once connected, refresh before editing.

You can remove the Tailscale Serve forwarding later with `tailscale serve reset`. That command resets this PC's Serve configuration, including any other Serve routes you configured; use the Tailscale controls if you need to preserve other routes.

## Security and validation

The companion uses a private HTTPS origin, single-use pairing codes, 256-bit session tokens, Secure/HttpOnly/SameSite cookies, server-side revocation, CSRF protection, input validation, origin/host checks and narrow API operations. Authentication exists only in memory on the PC and a secure cookie on the phone; it is not written to the database or logs. The offline service worker caches app files only and bypasses API responses. API responses use `Cache-Control: no-store`.

Automated tests use a real local server/database and a simulated private HTTPS origin in an iPhone-sized Chromium browser. They cover pairing, cookies, data reads, phone-to-desktop edits, receipt idempotency, task status, stale edits, revocation, expiry, rate limits, forbidden operations, offline behavior and the desktop enable/stop flow. A physical iPhone, Safari Home Screen installation and a live Tailscale connection must be checked on your devices.
