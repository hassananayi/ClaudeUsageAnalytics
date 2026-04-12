/**
 * popup.js — Fetches live usage from Claude's API and renders it.
 * Also owns the theme toggle (light / dark) and persists the choice
 * to chrome.storage.sync so it survives popup close/reopen.
 */

(async function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function show(id) { $(id).style.display = '';     }
  function hide(id) { $(id).style.display = 'none'; }

  // ── Theme ─────────────────────────────────────────────────────────────────

  const html = document.documentElement;

  /** Return the theme that is visually active right now. */
  function currentTheme() {
    return html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  /** Write data-theme and persist to chrome.storage.sync + sessionStorage. */
  function applyAndSave(theme) {
    html.setAttribute('data-theme', theme);
    sessionStorage.setItem('cuc-theme', theme);
    chrome.storage.sync.set({ 'cuc-theme': theme });
  }

  // The <head> inline script already painted the correct theme before first
  // render — we just wire the button here.
  $('theme-btn').addEventListener('click', () => {
    applyAndSave(currentTheme() === 'dark' ? 'light' : 'dark');
  });

  // ── Fetch & render ────────────────────────────────────────────────────────

  async function load() {
    show('state-loading');
    hide('state-error');
    hide('state-data');
    hide('data-footer');
    setSpinning(true);

    try {
      const data = await fetchViaTab();
      hide('state-loading');
      show('state-data');
      show('data-footer');
      render(data);
    } catch (err) {
      hide('state-loading');
      show('state-error');
      $('state-error').textContent =
        '⚠ ' + err.message + '\n\nMake sure claude.ai is open in a tab.';
    } finally {
      setSpinning(false);
    }
  }

  /**
   * Run CUCApi.fetchUsage() inside the active claude.ai tab.
   * Handles tabs that are still loading or that pre-date the extension install.
   */
  async function fetchViaTab() {
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    if (!tabs.length) throw new Error('No claude.ai tab found. Open Claude first.');

    let tab = tabs[0];
    if (tab.status !== 'complete') tab = await waitForTabComplete(tab.id, 5000);

    await ensureCUCApi(tab.id);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        try   { return await window.CUCApi.fetchUsage(); }
        catch (e) { return { __error: e.message }; }
      },
    });

    const result = results?.[0]?.result;
    if (!result)        throw new Error('No response from tab.');
    if (result.__error) throw new Error(result.__error);
    return result;
  }

  /** Poll until tab.status === 'complete' or timeout. */
  function waitForTabComplete(tabId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      function check() {
        chrome.tabs.get(tabId, (t) => {
          if (chrome.runtime.lastError)
            return reject(new Error(chrome.runtime.lastError.message));
          if (t.status === 'complete') return resolve(t);
          if (Date.now() >= deadline)  return reject(new Error('Tab took too long to load.'));
          setTimeout(check, 250);
        });
      }
      check();
    });
  }

  /** Inject apiClient.js into the tab if CUCApi isn't already on window. */
  async function ensureCUCApi(tabId) {
    const [{ result: loaded }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => typeof window.CUCApi !== 'undefined',
    });
    if (!loaded) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['utils/apiClient.js'],
      });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render(data) {
    const fh = data.five_hour   || {};
    const sd = data.seven_day   || {};
    const ex = data.extra_usage || {};

    setRow('five',  fh.utilization ?? null, fh.resets_at ?? null);
    setRow('seven', sd.utilization ?? null, sd.resets_at ?? null);

    if (ex.is_enabled && ex.utilization != null) {
      show('row-extra');
      setRow('extra', ex.utilization, null);
      const sub = $('sub-extra');
      if (sub && ex.used_credits != null && ex.monthly_limit != null)
        sub.textContent = `$${ex.used_credits} of $${ex.monthly_limit} used`;
    } else {
      hide('row-extra');
    }

    const org = $('footer-org');
    if (org && data.orgId) {
      org.textContent = data.orgId.slice(0, 8) + '…';
      org.title = data.orgId;
    }
    const ts = $('footer-ts');
    if (ts) {
      ts.textContent = 'updated ' + new Date().toLocaleTimeString(undefined, {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    }
  }

  function setRow(id, pct, resetsAt) {
    const fillEl = $(`fill-${id}`);
    const pctEl  = $(`pct-${id}`);
    const subEl  = $(`sub-${id}`);
    if (!fillEl) return;

    const value = pct != null ? Math.min(100, Math.max(0, pct)) : 0;
    const color = fillColor(value);

    fillEl.style.width      = pct != null ? `${value}%` : '0%';
    fillEl.style.background = color;

    if (pctEl) {
      pctEl.textContent = pct != null ? `${value}%` : '—';
      pctEl.style.color = pct != null ? color : '';
    }
    if (subEl && resetsAt) {
      subEl.textContent = `resets ${formatReset(resetsAt)}`;
    }
  }

  function fillColor(pct) {
    if (pct < 50) return '#4ade80';
    if (pct < 75) return '#facc15';
    if (pct < 90) return '#fb923c';
    return '#f87171';
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

  function setSpinning(on) {
    $('refresh-icon').classList.toggle('spinning', on);
  }

  // ── Events ────────────────────────────────────────────────────────────────

  $('refresh-btn').addEventListener('click', load);
  $('open-btn').addEventListener('click', () => chrome.tabs.create({ url: 'https://claude.ai/' }));

  // ── Boot ──────────────────────────────────────────────────────────────────
  //apply theme from storage in case user changed it in a previous session
  chrome.storage.sync.get('cuc-theme', ({ 'cuc-theme': theme }) => {
    if (theme) applyAndSave(theme);
  }); 
  await load();


})();
