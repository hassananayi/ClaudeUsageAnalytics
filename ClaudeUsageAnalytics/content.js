/**
 * content.js — Claude Usage Control
 *
 * Injects #cuc-root as a FIXED overlay on the page (not tied to the input).
 * Shows real usage from /api/organizations/{orgId}/usage.
 * Auto-refreshes every 60s. Has a manual refresh button.
 */

(async function () {
  'use strict';

  const POLL_INTERVAL_MS = 60_000;
  let usageData   = null;
  let lastUpdated = null;
  let refreshTimer = null;
  let isRefreshing = false;

  // ⚠️ FIX: declare countdownInterval at the top, before any function that references it.
  // Previously declared after startCountdown() causing a TDZ error on first call.
  let countdownInterval = null;

  injectStyles();
  mountWidget();
  await loadAndRender();

  // Auto-refresh every 60s
  refreshTimer = setInterval(loadAndRender, POLL_INTERVAL_MS);

  // ── Account-switch detection ──────────────────────────────────────────────
  // Claude fires a cookie change or navigates to a new URL when you switch
  // accounts. We watch for URL changes (SPA navigation) and for the page
  // unloading a session, then bust the org cache and re-fetch immediately.
  let _lastHref = location.href;
  const _navObserver = new MutationObserver(() => {
    if (location.href !== _lastHref) {
      _lastHref = location.href;
      // If the new URL contains a different org UUID, the cache is stale.
      CUCApi.clearCache();
      clearInterval(refreshTimer);
      loadAndRender();
      refreshTimer = setInterval(loadAndRender, POLL_INTERVAL_MS);
    }
  });
  _navObserver.observe(document.body, { childList: true, subtree: true });

  // ── Data ──────────────────────────────────────────────────────────────────
  async function loadAndRender() {
    setRefreshing(true);
    try {
      usageData   = await CUCApi.fetchUsage();
      lastUpdated = new Date();
      renderData(usageData);
      startCountdown();
    } catch (err) {
      renderError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  // ── Mount fixed widget (once, on page load) ───────────────────────────────
  function mountWidget() {
    if (document.getElementById('cuc-root')) return;

    const root = document.createElement('div');
    root.id = 'cuc-root';
    root.innerHTML = `
      <div id="cuc-widget">

        <div id="cuc-header">
          <span id="cuc-logo">Claude Usage</span>
          <div id="cuc-header-right">
            <span id="cuc-countdown" title="Next auto-refresh"></span>
            <button id="cuc-refresh-btn" title="Refresh now">
              <svg id="cuc-refresh-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13.6 2.4A7 7 0 1 0 14.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M14.5 2v3.5H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        <div id="cuc-body">

          <!-- 5-hour window -->
          <div class="cuc-row">
            <div class="cuc-row-meta">
              <span class="cuc-row-label">Current session:</span>
              <span class="cuc-row-pct" id="cuc-five-pct">—</span>
            </div>
            <div class="cuc-track"><div class="cuc-fill" id="cuc-five-fill"></div></div>
            <span class="cuc-row-sub" id="cuc-five-reset"></span>
          </div>

          <!-- 7-day window -->
          <div class="cuc-row">
            <div class="cuc-row-meta">
              <span class="cuc-row-label">Weekly:</span>
              <span class="cuc-row-pct" id="cuc-seven-pct">—</span>
            </div>
            <div class="cuc-track"><div class="cuc-fill" id="cuc-seven-fill"></div></div>
            <span class="cuc-row-sub" id="cuc-seven-reset"></span>
          </div>

          <!-- Extra usage (hidden unless enabled) -->
          <div class="cuc-row cuc-hidden" id="cuc-extra-row">
            <div class="cuc-row-meta">
              <span class="cuc-row-label">Extra usage</span>
              <span class="cuc-row-pct" id="cuc-extra-pct">—</span>
            </div>
            <div class="cuc-track"><div class="cuc-fill" id="cuc-extra-fill"></div></div>
            <span class="cuc-row-sub" id="cuc-extra-sub"></span>
          </div>

        </div>

        <div id="cuc-footer">
          <span id="cuc-org-label">—</span>
          <span id="cuc-updated">—</span>
        </div>

      </div>
    `;

    document.body.appendChild(root);

    // Refresh button
    root.querySelector('#cuc-refresh-btn').addEventListener('click', () => {
      clearInterval(refreshTimer);
      loadAndRender();
      refreshTimer = setInterval(loadAndRender, POLL_INTERVAL_MS);
    });

    // Collapse/expand on logo click
    root.querySelector('#cuc-logo').addEventListener('click', () => {
      root.querySelector('#cuc-body').classList.toggle('cuc-collapsed');
      root.querySelector('#cuc-footer').classList.toggle('cuc-collapsed');
    });
  }

  // ── Render data ───────────────────────────────────────────────────────────
  function renderData(data) {
    const fh = data.five_hour   || {};
    const sd = data.seven_day   || {};
    const ex = data.extra_usage || {};

    setRow('five',  fh.utilization ?? null, fh.resets_at ?? null);
    setRow('seven', sd.utilization ?? null, sd.resets_at ?? null);

    // Extra usage row
    const extraRow = document.getElementById('cuc-extra-row');
    if (ex.is_enabled && ex.utilization != null) {
      extraRow?.classList.remove('cuc-hidden');
      setRow('extra', ex.utilization, null);
      const sub = document.getElementById('cuc-extra-sub');
      if (sub && ex.used_credits != null && ex.monthly_limit != null)
        sub.textContent = `$${ex.used_credits} of $${ex.monthly_limit} used`;
    } else {
      extraRow?.classList.add('cuc-hidden');
    }

    // Org chip
    const orgLabel = document.getElementById('cuc-org-label');
    if (orgLabel && data.orgId) {
      orgLabel.textContent = data.orgId.slice(0, 8) + '…';
      orgLabel.title = data.orgId;
    }

    // Last updated
    const updEl = document.getElementById('cuc-updated');
    if (updEl) updEl.textContent = `updated ${formatTime(lastUpdated)}`;

    // Clear any error state
    document.getElementById('cuc-body')?.classList.remove('cuc-error-state');
  }

  function setRow(id, pct, resetsAt) {
    const fillEl  = document.getElementById(`cuc-${id}-fill`);
    const pctEl   = document.getElementById(`cuc-${id}-pct`);
    const resetEl = document.getElementById(`cuc-${id}-reset`);
    if (!fillEl) return;

    const value = pct != null ? Math.min(100, Math.max(0, pct)) : 0;
    const color = fillColor(value);

    fillEl.style.width      = pct != null ? `${value}%` : '0%';
    fillEl.style.background = color;

    if (pctEl) {
      pctEl.textContent = pct != null ? `${value}%` : '—';
      pctEl.style.color = pct != null ? color : 'var(--cuc-text)';
    }
    if (resetEl) {
      resetEl.textContent = resetsAt ? `resets ${formatReset(resetsAt)}` : '';
    }
  }

  function renderError(msg) {
    const pctEls = document.querySelectorAll('.cuc-row-pct');
    pctEls.forEach(el => { el.textContent = '—'; el.style.color = ''; });
    const updEl = document.getElementById('cuc-updated');
    if (updEl) { updEl.textContent = `⚠ ${msg}`; updEl.style.color = 'var(--cuc-danger)'; }
  }

  function setRefreshing(state) {
    isRefreshing = state;
    const icon = document.getElementById('cuc-refresh-icon');
    if (icon) icon.style.animation = state ? 'cucSpin .6s linear infinite' : '';
  }

  // ── Countdown to next refresh ─────────────────────────────────────────────
  function startCountdown() {
    clearInterval(countdownInterval);
    let remaining = Math.floor(POLL_INTERVAL_MS / 1000);
    const el = document.getElementById('cuc-countdown');
    const tick = () => {
      if (el) el.textContent = `${remaining}s`;
      if (--remaining < 0) clearInterval(countdownInterval);
    };
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fillColor(pct) {
    if (pct < 50) return 'var(--cuc-ok)';
    if (pct < 75) return 'var(--cuc-warn-mid)';
    if (pct < 90) return 'var(--cuc-warn)';
    return 'var(--cuc-danger)';
  }

  function formatReset(isoStr) {
    const diffMs = new Date(isoStr).getTime() - Date.now();
    if (diffMs < 0) return 'soon';
    const h = Math.floor(diffMs / 3_600_000);
    const m = Math.floor((diffMs % 3_600_000) / 60_000);
    if (h > 24) return new Date(isoStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (h > 0)  return `in ${h}h ${m}m`;
    return `in ${m}m`;
  }

  function formatTime(date) {
    if (!date) return '—';
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('cuc-styles')) return;
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches ||
      document.documentElement.classList.contains('dark') ||
      document.body.classList.contains('dark');

    const style = document.createElement('style');
    style.id = 'cuc-styles';
    style.textContent = `
      :root {
        --cuc-ok:       #4ade80;
        --cuc-warn-mid: #facc15;
        --cuc-warn:     #fb923c;
        --cuc-danger:   #f87171;
        --cuc-bg:       ${isDark ? '#1c1c24' : '#ffffff'};
        --cuc-border:   ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)'};
        --cuc-text:     ${isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)'};
        --cuc-text-hi:  ${isDark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.82)'};
        --cuc-track:    ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'};
        --cuc-shadow:   ${isDark ? '0 8px 32px rgba(0,0,0,0.55)' : '0 8px 32px rgba(0,0,0,0.14)'};
        --cuc-font:     -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      /* ── Fixed container ── */
      #cuc-root {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 999999;
        font-family: var(--cuc-font);
        animation: cucIn .3s cubic-bezier(.16,1,.3,1);
      }

      /* ── Card ── */
      #cuc-widget {
        background: var(--cuc-bg);
        border: 1px solid var(--cuc-border);
        border-radius: 14px;
        box-shadow: var(--cuc-shadow);
        width: 240px;
        overflow: hidden;
      }

      /* ── Header ── */
      #cuc-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px 8px;
        border-bottom: 1px solid var(--cuc-border);
      }

      #cuc-logo {
        font-size: 11px;
        font-weight: 700;
        color: var(--cuc-text-hi);
        letter-spacing: -.01em;
        cursor: pointer;
        user-select: none;
      }

      #cuc-header-right {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      #cuc-countdown {
        font-size: 10px;
        color: var(--cuc-text);
        font-variant-numeric: tabular-nums;
        min-width: 26px;
        text-align: right;
      }

      #cuc-refresh-btn {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--cuc-text);
        padding: 2px;
        line-height: 0;
        border-radius: 4px;
        transition: color .15s, background .15s;
        display: flex;
        align-items: center;
      }
      #cuc-refresh-btn:hover { color: var(--cuc-text-hi); background: var(--cuc-track); }
      #cuc-refresh-btn svg { width: 13px; height: 13px; }

      /* ── Body ── */
      #cuc-body {
        padding: 10px 12px 8px;
        display: flex;
        flex-direction: column;
        gap: 9px;
        transition: all .2s ease;
      }
      #cuc-body.cuc-collapsed { display: none; }

      /* ── Each row ── */
      .cuc-row { display: flex; flex-direction: column; gap: 4px; }

      .cuc-row-meta {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
      }

      .cuc-row-label {
        font-size: 10px;
        color: var(--cuc-text);
        text-transform: uppercase;
        letter-spacing: .05em;
      }

      .cuc-row-pct {
        font-size: 12px;
        font-weight: 700;
        color: var(--cuc-text-hi);
        transition: color .3s;
        font-variant-numeric: tabular-nums;
      }

      .cuc-track {
        height: 4px;
        background: var(--cuc-track);
        border-radius: 2px;
        overflow: hidden;
      }

      .cuc-fill {
        height: 100%;
        width: 0%;
        border-radius: 2px;
        transition: width .6s cubic-bezier(.16,1,.3,1), background .4s ease;
      }

      .cuc-row-sub {
        font-size: 9.5px;
        color: var(--cuc-text);
      }

      .cuc-hidden { display: none !important; }

      /* ── Footer ── */
      #cuc-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 12px 9px;
        border-top: 1px solid var(--cuc-border);
      }
      #cuc-footer.cuc-collapsed { display: none; }

      #cuc-org-label {
        font-size: 9px;
        color: var(--cuc-text);
        font-family: 'SF Mono', 'Fira Code', monospace;
        opacity: .6;
        cursor: default;
      }

      #cuc-updated {
        font-size: 9px;
        color: var(--cuc-text);
      }

      /* ── Animations ── */
      @keyframes cucIn {
        from { opacity: 0; transform: translateY(10px) scale(.97); }
        to   { opacity: 1; transform: translateY(0)    scale(1); }
      }
      @keyframes cucSpin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      document.getElementById('cuc-styles')?.remove();
      injectStyles();
    });
  }

})();
