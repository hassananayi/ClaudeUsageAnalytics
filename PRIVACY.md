# Privacy Policy — Claude Usage Analytics

**Last updated:** April 12, 2025  
**Extension:** Claude Usage Analytics  

---

## Overview

Claude Usage Analytics is a browser extension that displays your real-time Claude usage limits directly on the page. This policy explains what data the extension accesses, how it is used, and what it never does.

---

## Data We Access

### Claude Session Data
The extension reads your active Claude session via the following internal API endpoints on `claude.ai`:

- `/api/bootstrap` — to identify your organization UUID for the current session
- `/api/organizations` — as a fallback to discover your organization UUID
- `/api/organizations/{orgId}/usage` — to retrieve your current usage metrics (session utilization, weekly utilization, and optional extra usage credits)

This data is fetched using your existing browser session cookies. **No credentials are ever extracted, stored, or transmitted.**

### Theme Preference
Your chosen UI theme (light or dark) is saved to `chrome.storage.sync` so your preference persists between sessions.

---

## Data We Do NOT Collect

- ❌ No personal information (name, email, account details)
- ❌ No conversation content or message history
- ❌ No browsing history outside of `claude.ai`
- ❌ No analytics, telemetry, or usage tracking of any kind
- ❌ No data is ever sent to any external server or third party
- ❌ No data is sold, shared, or monetized in any way

---

## How Data Is Used

| Data | Purpose | Stored? |
|------|---------|---------|
| Organization UUID | Fetching your usage metrics | In memory only (cleared on account switch) |
| Usage metrics (utilization %, reset times) | Displaying the usage widget | In memory only (never persisted) |
| Theme preference | Remembering light/dark mode | `chrome.storage.sync` (local to your browser) |

All usage data is fetched live on demand and held only in memory for the duration of the page session. It is never written to disk, logged, or transmitted anywhere.

---

## Permissions Explained

| Permission | Why It's Needed |
|------------|-----------------|
| `scripting` | To inject the usage widget into the `claude.ai` page |
| `storage` | To persist your theme preference (light/dark) across sessions |
| `tabs` | To locate an open `claude.ai` tab when the popup is used |
| `host_permissions: https://claude.ai/*` | To make same-origin API calls using your existing session |

---

## Data Storage

The only data persisted beyond a page session is your **theme preference** (`light` or `dark`), stored in `chrome.storage.sync`. This is a single string value and contains no personal or usage information.

You can clear this at any time by removing the extension or clearing your browser's extension storage.

---

## Third Parties

This extension does **not** communicate with any third-party server. All network requests originate from and terminate at `claude.ai` — the same domain you are already authenticated with.

---

## Security

Because the extension runs entirely within your existing `claude.ai` browser session:

- No additional authentication is performed
- No tokens or cookies are extracted or stored
- The extension cannot access Claude on your behalf outside of your active browser session

---

## Children's Privacy

This extension does not knowingly collect any information from users of any age. No personal data is collected at all.

---

## Changes to This Policy

If this policy is updated, the **Last updated** date at the top of this document will be revised. Continued use of the extension after changes constitutes acceptance of the updated policy.

---

## Contact

If you have questions about this privacy policy or the extension's data practices, please open an issue on the project's repository.