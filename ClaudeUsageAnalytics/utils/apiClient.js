/**
 * apiClient.js — Fetches real usage data from Claude's internal API
 *
 * Flow:
 *   1. Extract org UUID from the page URL, /api/bootstrap, or /api/organizations.
 *   2. Call /api/organizations/{orgId}/usage
 *   3. On 404 (account switch), bust the cache and retry once with a fresh org ID.
 *
 * Works because the content script runs on claude.ai — same origin,
 * so session cookies are sent automatically with fetch().
 */

const CUCApi = (() => {

  // Only cache IDs that were confirmed by a real API response.
  // Never cache URL-derived IDs — the URL changes as you navigate
  // and may belong to a different account after a switch.
  let _cachedOrgId = null;

  // ── Step 1: Discover the org UUID ──────────────────────────────────────

  /**
   * Try to extract org ID from the current URL path.
   * Returned raw — never written to _cachedOrgId directly.
   */
  function orgIdFromUrl() {
    const m = location.href.match(/\/organizations\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }

  /**
   * Discover the org UUID for the currently logged-in account.
   * Pass force=true to skip the cache (used after a 404).
   */
  async function discoverOrgId(force = false) {
    if (!force && _cachedOrgId) return _cachedOrgId;

    // 1. Try /api/bootstrap — most reliable, reflects current session
    try {
      const res = await fetch('/api/bootstrap', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        const uuid =
          json?.account?.memberships?.[0]?.organization?.uuid ||
          json?.organization?.uuid ||
          json?.uuid;
        if (uuid) { _cachedOrgId = uuid; return uuid; }
      }
    } catch (_) {}

    // 2. Fallback: list organizations endpoint
    try {
      const res = await fetch('/api/organizations', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        const uuid = Array.isArray(json) ? json[0]?.uuid : json?.uuid;
        if (uuid) { _cachedOrgId = uuid; return uuid; }
      }
    } catch (_) {}

    // 3. Last resort: try the URL (not cached — just used for this call)
    const fromUrl = orgIdFromUrl();
    if (fromUrl) return fromUrl;

    return null;
  }

  // ── Step 2: Fetch usage ────────────────────────────────────────────────

  /**
   * Returns the raw usage JSON from Claude's usage endpoint.
   * Shape (as of 2025):
   * {
   *   five_hour:  { utilization: 18.0, resets_at: "..." },
   *   seven_day:  { utilization: 10.0, resets_at: "..." },
   *   seven_day_opus: null | { ... },
   *   seven_day_sonnet: null | { ... },
   *   extra_usage: { is_enabled, monthly_limit, used_credits, utilization }
   * }
   *
   * On 404: the cached org ID is stale (account switch). We bust the cache,
   * re-discover the correct org ID, and retry exactly once.
   */
  async function fetchUsage() {
    const orgId = await discoverOrgId();
    if (!orgId) throw new Error('Could not determine org ID');

    const res = await fetch(
      `/api/organizations/${orgId}/usage`,
      { credentials: 'include' }
    );

    // 404 = stale org ID, almost always caused by an account switch.
    // Bust the cache and retry once with a freshly discovered org ID.
    if (res.status === 404) {
      _cachedOrgId = null;
      const freshOrgId = await discoverOrgId(true);
      if (!freshOrgId) throw new Error('Could not determine org ID after account switch');

      const retry = await fetch(
        `/api/organizations/${freshOrgId}/usage`,
        { credentials: 'include' }
      );
      if (!retry.ok) throw new Error(`Usage API ${retry.status}: ${retry.statusText}`);

      const data = await retry.json();
      return { orgId: freshOrgId, ...data };
    }

    if (!res.ok) throw new Error(`Usage API ${res.status}: ${res.statusText}`);

    const data = await res.json();
    return { orgId, ...data };
  }

  /** Expose cache-busting for external callers (e.g. content.js on account change). */
  function clearCache() {
    _cachedOrgId = null;
  }

  return { fetchUsage, discoverOrgId, clearCache };
})();

if (typeof window !== 'undefined') window.CUCApi = CUCApi;
