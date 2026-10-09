// JobStack side panel – unified shell + applications tracker + autofill.
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DOMAINS = {
  naukri: ['naukri.com'], wellfound: ['wellfound.com'], internshala: ['internshala.com']
};
const LOCAL = { be: 'http://localhost:5000/api/extract/store', fe: 'http://localhost:5173/' };
const PROD = { be: 'https://jobstack-api.onrender.com/api/extract/store', fe: 'https://jobstack-live.vercel.app/' };
let WEB_APP_URL = PROD.fe;
let applyQueue = [];
let applyIndex = 0;
let applyTabId = null;
let isApplyQueueBusy = false;
let isApplyQueueLoading = false;
let isProcessingApplyQueue = false;
let successfulApplyIds = [];

const isLocalUrl = (v) => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(v).hostname); } catch { return false; } };
const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

function sendToTab(tabId, message, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
    chrome.tabs.sendMessage(tabId, message, (res) => {
      clearTimeout(t);
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(res);
    });
  });
}
async function inject(tabId, file) {
  try { await chrome.scripting.executeScript({ target: { tabId }, files: [file] }); await sleep(300); } catch { /* ignore */ }
}
function setMsg(el, text, type = 'info') {
  if (!el) return;
  el.textContent = text;
  el.style.color = type === 'error' ? 'var(--err)' : type === 'success' ? 'var(--ok)' : '';
}

// ---------- Navigation ----------
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === name));
  if (name === 'applications') loadCounts();
}
document.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => showView(n.dataset.view)));
$('authBadge').addEventListener('click', () => showView('settings'));
window.addEventListener('jobstacker:show-discovery', () => showView('discover'));
window.JobStackUI = { showView, setMsg };

// Discover sub-tabs (Scan / Filters) – idempotent with discovery's own handler
document.querySelectorAll('.seg .tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.seg .tab').forEach((x) => x.classList.toggle('active', x === t));
  document.querySelectorAll('#discovery-panel-root .tab-content').forEach((c) => c.classList.toggle('active', c.id === 'tab-' + t.dataset.tab));
}));

// ---------- Theme ----------
function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  document.querySelectorAll('.theme-btn').forEach((b) => b.classList.toggle('active', b.dataset.theme === t));
  localStorage.setItem('jobstack_theme', t);
}
document.querySelectorAll('.theme-btn').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.theme)));
applyTheme(localStorage.getItem('jobstack_theme') || 'auto');
$('brandLogo').addEventListener('error', (e) => { e.target.style.visibility = 'hidden'; });

// ---------- Auth ----------
async function updateAuthStatus() {
  const badge = $('authBadge');
  let state = 'unknown', label = 'Unknown';
  try {
    const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'GET_TOKEN_STATUS' }, r));
    state = res?.hasToken ? 'on' : 'off';
    label = res?.hasToken ? 'Connected' : 'Disconnected';
  } catch { /* unknown */ }
  badge.className = 'chip chip-status ' + (state === 'on' ? '' : state);
  badge.querySelector('span').textContent = label;
  $('settingsAuth').textContent = label;
}
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.authToken) {
    updateAuthStatus();
    refreshJdButton();
  }
});

// ---------- Applications: counts & stack ----------
const PLATFORMS = ['linkedin', 'naukri', 'wellfound', 'internshala'];
async function loadCounts() {
  const s = await chrome.storage.local.get([...PLATFORMS.map((p) => p + 'Jobs'), 'lastBackendSendAt']);
  let total = 0;
  const counts = {};
  PLATFORMS.forEach((p) => { counts[p] = (s[p + 'Jobs'] || []).length; total += counts[p]; $(p + 'Count').textContent = counts[p]; });
  $('jobsDetected').textContent = total;
  $('stackTotalLabel').textContent = total + (total === 1 ? ' job' : ' jobs');
  PLATFORMS.forEach((p) => { $('stackBar').querySelector(`[data-platform="${p}"]`).style.width = (total ? (counts[p] / total) * 100 : 0) + '%'; });
  const t = s.lastBackendSendAt;
  if (!t) { $('lastSync').textContent = '—'; return; }
  const m = Math.floor((Date.now() - new Date(t).getTime()) / 60000);
  $('lastSync').textContent = m < 1 ? 'Just now' : m < 60 ? `${m}m ago` : new Date(t).toLocaleTimeString();
}

async function detectPlatform() {
  const chip = $('detectedPlatform');
  try {
    const url = (await activeTab())?.url || '';
    let p = 'Unsupported';
    if (url.includes('linkedin.com/jobs-tracker')) p = 'LinkedIn';
    else if (DOMAINS.naukri.some((d) => url.includes(d))) p = 'Naukri';
    else if (DOMAINS.wellfound.some((d) => url.includes(d))) p = 'Wellfound';
    else if (DOMAINS.internshala.some((d) => url.includes(d))) p = 'Internshala';
    else if (url.includes('jobstack')) p = 'JobStack';
    chip.textContent = p;
    chip.className = 'chip ' + (['Unsupported', 'JobStack'].includes(p) ? '' : 'active');
  } catch { chip.textContent = 'Unable to detect'; }
}

// ---------- Applications: sync from current page ----------
function setSyncLoading(on) {
  const b = $('extractBtn');
  b.disabled = on;
  if (on) { b.dataset.label = b.textContent; b.innerHTML = '<span class="spinner"></span> Syncing…'; }
  else b.textContent = b.dataset.label || 'Sync applications from this page';
}
$('extractBtn').addEventListener('click', async () => {
  const out = $('syncStatus');
  setSyncLoading(true); setMsg(out, 'Reading applications from this page…');
  try {
    const tab = await activeTab(); const url = tab.url || '';
    let res, name, list = (r) => r.jobs;
    if (url.includes('linkedin.com/jobs-tracker')) {
      name = 'LinkedIn'; list = (r) => r.data;
      await inject(tab.id, 'content/applied-jobs/content-linkedin.js');
      let alive = false;
      for (let i = 0; i < 3 && !alive; i++) {
        try { alive = (await sendToTab(tab.id, { action: 'ping' }, 2000))?.status === 'alive'; } catch { await sleep(500); }
      }
      if (!alive) return setMsg(out, 'Cannot connect. Refresh the LinkedIn page.', 'error');
      res = await sendToTab(tab.id, { action: 'extractLinkedInJobs' });
    } else if (DOMAINS.naukri.some((d) => url.includes(d))) {
      name = 'Naukri'; await inject(tab.id, 'content/applied-jobs/content-naukri.js');
      res = await sendToTab(tab.id, { action: 'fetchNaukriJobs' }, 15000);
    } else if (DOMAINS.wellfound.some((d) => url.includes(d))) {
      name = 'Wellfound'; await inject(tab.id, 'content/applied-jobs/content-wellfound.js');
      res = await sendToTab(tab.id, { action: 'reExtractWellfound' }, 15000);
    } else if (DOMAINS.internshala.some((d) => url.includes(d))) {
      name = 'Internshala'; res = await chrome.runtime.sendMessage({ action: 'fetchInternshalaJobsFromBackground' });
    } else return setMsg(out, 'Open an applied-jobs page on LinkedIn, Naukri, Wellfound or Internshala.', 'error');
    if (res?.success) { setMsg(out, `${name}: synced ${list(res).length} applications`, 'success'); await loadCounts(); }
    else setMsg(out, `${name} sync failed: ${res?.error || 'Unknown error'}`, 'error');
  } catch (e) { setMsg(out, e.message, 'error'); }
  finally { setSyncLoading(false); }
});

// ---------- Autofill / register / preview ----------
async function ensureAutofill(tab) {
  const alive = async () => { try { return (await sendToTab(tab.id, { action: 'PING_AUTOFILL' }, 2000))?.status === 'alive'; } catch { return false; } };
  if (await alive()) return true;
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['autofill/content.js'] }); await sleep(500); } catch { return false; }
  return alive();
}
const afOut = () => $('autofillStatus');

// ---------- Discovery: scan + buffer state ----------
let currentTab = null;
let currentSite = null;
let currentPageType = null;
let scannedJobs = [];
let isAutoScanning = false;
let autoScanTabId = null;
let isSendingBuffer = false;
let filterSchema = null;
let filterPresets = {};
let activeFilterPreset = null;
let workingFilters = {};
let isJdExtracting = false;
let jdCancelled = false;
const activeJdTabIds = new Set();

function setStatus(msg, type = 'info') {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === 'error' ? 'var(--err)' : type === 'success' ? 'var(--ok)' : '';
}

function setDiscoveryBadge(text, cls = '') {
  const badge = $('site-badge');
  if (!badge) return;
  badge.textContent = text;
  badge.className = 'chip ' + (cls || '');
}

function setFilterStatus(text, type = 'info') {
  const el = $('filter-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = type === 'error' ? 'var(--err)' : type === 'success' ? 'var(--ok)' : '';
}

async function loadFilterPresets() {
  const stored = await chrome.storage.sync.get(['filterPresets', 'activePreset']);
  filterPresets = stored.filterPresets && typeof stored.filterPresets === 'object' ? stored.filterPresets : {};
  if (!Object.keys(filterPresets).length) filterPresets = { Default: { name: 'Default', filters: {} } };
  activeFilterPreset = filterPresets[stored.activePreset] ? stored.activePreset : Object.keys(filterPresets)[0];
  await chrome.storage.sync.set({ filterPresets, activePreset: activeFilterPreset });
}

async function saveFilterPresets() {
  await chrome.storage.sync.set({ filterPresets, activePreset: activeFilterPreset });
}

function renderFilterPresets() {
  const select = $('preset-select');
  if (!select) return;
  select.replaceChildren();
  Object.keys(filterPresets).forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    option.selected = name === activeFilterPreset;
    select.appendChild(option);
  });
}

function filterIsSelected(key, value) {
  const selected = workingFilters[key];
  return Array.isArray(selected) ? selected.map(String).includes(String(value)) : String(selected ?? '') === String(value);
}

function renderFilterGroups() {
  const container = $('filter-groups');
  if (!container) return;
  container.replaceChildren();
  if (!filterSchema) return;

  Object.entries(filterSchema).forEach(([key, definition]) => {
    const group = document.createElement('section');
    group.className = 'filter-group';
    const header = document.createElement('div');
    header.className = 'filter-group-header';
    const title = document.createElement('span');
    title.className = 'filter-group-title';
    title.textContent = definition.label || key;
    const toggle = document.createElement('span');
    toggle.className = 'filter-group-toggle';
    toggle.textContent = '▼';
    header.append(title, toggle);
    header.addEventListener('click', () => group.classList.toggle('collapsed'));

    const body = document.createElement('div');
    body.className = 'filter-group-body';
    if (definition.type === 'multi' && Array.isArray(definition.options)) {
      definition.options.forEach((option) => {
        const row = document.createElement('label');
        row.className = 'filter-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = filterIsSelected(key, option.value);
        input.addEventListener('change', () => {
          const values = Array.isArray(workingFilters[key]) ? workingFilters[key].map(String) : (workingFilters[key] == null ? [] : [String(workingFilters[key])]);
          const value = String(option.value);
          if (input.checked && !values.includes(value)) values.push(value);
          if (!input.checked) values.splice(values.indexOf(value), 1);
          if (values.length) workingFilters[key] = values;
          else delete workingFilters[key];
        });
        const label = document.createElement('span');
        label.textContent = option.label || String(option.value);
        row.append(input, label);
        body.appendChild(row);
      });
    } else if (definition.type === 'single' && Array.isArray(definition.options)) {
      [{ value: '', label: 'Any' }, ...definition.options].forEach((option) => {
        const row = document.createElement('label');
        row.className = 'filter-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `filter-${key}`;
        input.checked = filterIsSelected(key, option.value) || (!option.value && workingFilters[key] == null);
        input.addEventListener('change', () => {
          if (option.value) workingFilters[key] = String(option.value);
          else delete workingFilters[key];
        });
        const label = document.createElement('span');
        label.textContent = option.label;
        row.append(input, label);
        body.appendChild(row);
      });
    } else if (definition.custom) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'filter-number-input';
      input.placeholder = definition.hint || 'Comma-separated IDs';
      input.value = (Array.isArray(workingFilters[key]) ? workingFilters[key] : workingFilters[key] == null ? [] : [workingFilters[key]]).join(', ');
      input.addEventListener('input', () => {
        const values = input.value.split(',').map((item) => item.trim()).filter(Boolean);
        if (values.length) workingFilters[key] = values;
        else delete workingFilters[key];
      });
      body.appendChild(input);
    } else if (definition.type === 'text' || definition.type === 'number') {
      const input = document.createElement('input');
      input.type = definition.type;
      input.className = 'filter-number-input';
      input.placeholder = definition.placeholder || '';
      if (definition.min != null) input.min = definition.min;
      if (definition.max != null) input.max = definition.max;
      input.value = workingFilters[key] ?? '';
      input.addEventListener('input', () => {
        if (input.value.trim()) workingFilters[key] = input.value.trim();
        else delete workingFilters[key];
      });
      body.appendChild(input);
    }

    group.append(header, body);
    container.appendChild(group);
  });
}

async function initFilters() {
  await loadFilterPresets();
  renderFilterPresets();
  const preset = filterPresets[activeFilterPreset];
  workingFilters = JSON.parse(JSON.stringify(preset?.filters || {}));
  filterSchema = null;

  if (currentTab?.id && currentSite === 'naukri') {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: () => window.JobCaptureFilters?.schema || null,
      });
      filterSchema = result?.result || null;
    } catch {}
  }

  if (!filterSchema) {
    $('filter-groups')?.replaceChildren();
    setFilterStatus(currentSite === 'naukri' ? 'Filter schema unavailable. Reload the Naukri page and retry.' : 'Open a Naukri listing page to configure filters.');
    return;
  }
  renderFilterGroups();
  setFilterStatus(`Loaded preset: ${activeFilterPreset}`, 'success');
}

async function captureFiltersFromUrl() {
  if (!currentTab?.id) return;
  try {
    const result = await chrome.tabs.sendMessage(currentTab.id, { type: 'CAPTURE_FILTERS' });
    if (result?.status !== 'ok') throw new Error(result?.message || 'Capture failed');
    workingFilters = result.filters || {};
    renderFilterGroups();
    setFilterStatus(`Captured ${Object.keys(workingFilters).length} filter(s) from URL`, 'success');
  } catch (error) {
    setFilterStatus(`Capture failed: ${error.message}`, 'error');
  }
}

async function applyFilters(andScan = false) {
  if (!currentTab?.id || !activeFilterPreset) return;
  filterPresets[activeFilterPreset] = { name: activeFilterPreset, filters: JSON.parse(JSON.stringify(workingFilters)) };
  await saveFilterPresets();
  try {
    const response = await chrome.tabs.sendMessage(currentTab.id, { type: 'APPLY_FILTERS', filters: workingFilters });
    if (response?.status !== 'ok' || !response.url) throw new Error(response?.message || 'No filtered URL returned');
    const tabId = currentTab.id;
    const loaded = new Promise((resolve) => {
      const listener = (updatedTabId, info) => {
        if (updatedTabId !== tabId || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 20000);
    });
    await chrome.tabs.update(tabId, { url: response.url });
    setFilterStatus('Applying filters…', 'success');
    await loaded;
    await refreshDiscoveryState();
    await initFilters();
    if (andScan) await autoScanAll();
  } catch (error) {
    setFilterStatus(`Apply failed: ${error.message}`, 'error');
  }
}

async function saveCurrentFilterPreset() {
  if (!activeFilterPreset) return;
  filterPresets[activeFilterPreset] = { name: activeFilterPreset, filters: JSON.parse(JSON.stringify(workingFilters)) };
  await saveFilterPresets();
  setFilterStatus(`Saved: ${activeFilterPreset}`, 'success');
}

async function createFilterPreset() {
  const input = $('preset-name-input');
  const name = input?.value.trim();
  if (!name) return setFilterStatus('Enter a preset name first', 'error');
  if (filterPresets[name]) return setFilterStatus(`Preset "${name}" already exists`, 'error');
  filterPresets[name] = { name, filters: {} };
  activeFilterPreset = name;
  workingFilters = {};
  if (input) input.value = '';
  await saveFilterPresets();
  renderFilterPresets();
  renderFilterGroups();
  setFilterStatus(`Created preset: ${name}`, 'success');
}

async function resetCurrentFilters() {
  workingFilters = {};
  await saveCurrentFilterPreset();
  renderFilterGroups();
  setFilterStatus(`Cleared filters in ${activeFilterPreset}`, 'success');
}

async function deleteCurrentFilterPreset() {
  if (Object.keys(filterPresets).length <= 1) return setFilterStatus('Cannot delete the last preset', 'error');
  delete filterPresets[activeFilterPreset];
  activeFilterPreset = Object.keys(filterPresets)[0];
  workingFilters = JSON.parse(JSON.stringify(filterPresets[activeFilterPreset].filters || {}));
  await saveFilterPresets();
  renderFilterPresets();
  renderFilterGroups();
  setFilterStatus(`Deleted preset: ${activeFilterPreset}`, 'success');
}

async function getBuffer() {
  const res = await chrome.storage.local.get('jobBuffer');
  return Array.isArray(res.jobBuffer) ? res.jobBuffer : [];
}

async function setBuffer(jobs) {
  await chrome.storage.local.set({ jobBuffer: jobs });
}

async function addToBuffer(newJobs) {
  const buffer = await getBuffer();
  const seen = new Set(buffer.map((job) => job.job_url));
  let added = 0;
  for (const job of newJobs) {
    if (!job?.job_url || seen.has(job.job_url)) continue;
    buffer.push(job);
    seen.add(job.job_url);
    added += 1;
  }
  await setBuffer(buffer);
  return { added, total: buffer.length };
}

async function refreshBufferCount() {
  const buffer = await getBuffer();
  const countEl = $('buffer-count');
  if (countEl) countEl.textContent = String(buffer.length);
  const saveBtn = $('save-btn');
  if (saveBtn) saveBtn.disabled = scannedJobs.length === 0;
  const clearBtn = $('clear-btn');
  if (clearBtn) clearBtn.disabled = buffer.length === 0;
  const downloadBtn = $('download-btn');
  if (downloadBtn) downloadBtn.disabled = buffer.length === 0;
  const sendBtn = $('send-server-btn');
  if (sendBtn) sendBtn.disabled = buffer.length === 0 || isSendingBuffer;
}

function renderJobs(jobs) {
  const list = $('jobs-list');
  const countEl = $('job-count');
  if (countEl) countEl.textContent = `${jobs.length} jobs`;
  if (!list) return;

  if (!jobs.length) {
    list.innerHTML = '<div class="empty-state">No jobs found on this page</div>';
    return;
  }

  list.innerHTML = '';
  jobs.forEach((job) => {
    const card = document.createElement('div');
    card.className = 'job-card';
    const skillsText = Array.isArray(job.skills) ? job.skills.slice(0, 6).join(' · ') : '';

    card.innerHTML = `
      <div class="title"></div>
      <div class="company"></div>
      <div class="meta">
        <span class="exp"></span>
        <span class="sal"></span>
        <span class="loc"></span>
      </div>
      <div class="skills"></div>
    `;

    card.querySelector('.title').textContent = job.title || 'Untitled';
    card.querySelector('.company').textContent = job.company || '';
    card.querySelector('.exp').textContent = job.experience || '';
    card.querySelector('.sal').textContent = job.salary || '';
    card.querySelector('.loc').textContent = job.location || '';
    card.querySelector('.skills').textContent = skillsText;
    list.appendChild(card);
  });
}

async function scanPage() {
  if (!currentTab?.id) return;
  setStatus('Scanning...');

  try {
    const res = await chrome.tabs.sendMessage(currentTab.id, { type: 'EXTRACT_LISTING' });
    if (!res) {
      setStatus('No response from page', 'error');
      return;
    }
    if (res.status === 'unsupported') {
      setStatus(res.message || 'Unsupported page', 'error');
      return;
    }
    if (res.status === 'error') {
      setStatus(`Error: ${res.message}`, 'error');
      return;
    }

    scannedJobs = Array.isArray(res.jobs) ? res.jobs : [];
    renderJobs(scannedJobs);

    const saveBtn = $('save-btn');
    if (saveBtn) saveBtn.disabled = scannedJobs.length === 0;

    if (scannedJobs.length === 0) setStatus('No jobs detected on this page', 'error');
    else setStatus(`Found ${scannedJobs.length} jobs`, 'success');
  } catch (err) {
    setStatus('Content script not ready — reload the page', 'error');
  }
}

async function saveToBuffer() {
  if (!scannedJobs.length) return;
  const { added, total } = await addToBuffer(scannedJobs);
  setStatus(`Added ${added} new jobs (${total} total in buffer)`, 'success');
  await refreshBufferCount();
}

async function sendBufferToBackend() {
  if (isSendingBuffer) return;
  const buffer = await getBuffer();
  if (!buffer.length) {
    setStatus('Buffer empty — nothing to send', 'error');
    return;
  }

  const button = $('send-server-btn');
  isSendingBuffer = true;
  if (button) {
    button.disabled = true;
    button.dataset.label = button.textContent;
    button.textContent = 'Sending…';
  }
  setStatus(`Sending ${buffer.length} jobs to discovery backend…`);

  try {
    const [url, jwt, storedBatch] = await Promise.all([
      JobStackApiClient.getBackendBaseUrl(),
      JobStackAuthSession.getToken(),
      chrome.storage.sync.get('currentBatchId'),
    ]);
    if (!jwt) throw new Error('Connect your JobStack account before sending the discovery buffer.');

    const batchId = storedBatch.currentBatchId || crypto.randomUUID();
    if (!storedBatch.currentBatchId) await chrome.storage.sync.set({ currentBatchId: batchId });
    const payload = {
      batch_id: batchId,
      stage: 'listing',
      source: currentSite || buffer.find((job) => job.source)?.source || 'naukri',
      sent_at: new Date().toISOString(),
      job_count: buffer.length,
      jobs: buffer,
    };
    const result = await JobStackDiscoveryApi.importJobs({ url, jwt }, payload);
    const resultId = result?.id || result?._id || 'saved';
    await chrome.storage.sync.set({
      lastDiscoverySendAt: new Date().toISOString(),
      lastDiscoverySendResult: `OK · ${resultId} · ${buffer.length} jobs`,
    });
    setStatus(`Sent ${buffer.length} jobs to discovery backend · batch ${batchId.slice(0, 8)}…`, 'success');
  } catch (err) {
    setStatus(`Discovery send failed: ${err.message}`, 'error');
  } finally {
    isSendingBuffer = false;
    if (button) button.textContent = button.dataset.label || 'Send';
    await refreshBufferCount();
  }
}

async function getDiscoveryApiConfig() {
  const [url, jwt] = await Promise.all([
    JobStackApiClient.getBackendBaseUrl(),
    JobStackAuthSession.getToken(),
  ]);
  if (!jwt) throw new Error('Connect your JobStack account before extracting job descriptions.');
  return { url, jwt };
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = async () => {
      if (jdCancelled) return resolve(false);
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') return resolve(true);
      } catch {
        return resolve(false);
      }
      if (Date.now() - started >= timeoutMs) return resolve(false);
      setTimeout(check, 300);
    };
    check();
  });
}

async function extractJobDescription(job) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: job.job_url, active: false });
    activeJdTabIds.add(tab.id);
    if (!(await waitForTabComplete(tab.id))) throw new Error('Page load timed out');

    let ready = false;
    for (let attempt = 0; attempt < 20 && !jdCancelled; attempt += 1) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
        ready = true;
        break;
      } catch {
        await sleep(400);
      }
    }
    if (jdCancelled) throw new Error('Cancelled');
    if (!ready) throw new Error('Discovery content script did not load');

    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (jdCancelled) throw new Error('Cancelled');
      response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_JD' });
      if (response?.status !== 'not-ready') break;
      await sleep(1200);
    }
    if (response?.status !== 'ok') throw new Error(response?.message || 'JD extraction failed');
    return response.data;
  } finally {
    if (tab?.id) {
      activeJdTabIds.delete(tab.id);
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
  }
}

async function mergeJdIntoBuffer(jobUrl, details) {
  const buffer = await getBuffer();
  const job = buffer.find((item) => item.job_url === jobUrl);
  if (!job) return;
  for (const key of [
    'job_id', 'title', 'company', 'location', 'experience', 'salary', 'posted',
    'jd_full', 'jd_description', 'jd_required_skills', 'jd_preferred_qualifications',
    'key_skills_all', 'highlights', 'applicants', 'openings', 'role', 'industry',
    'department', 'role_category', 'employment_type', 'education_ug', 'education_pg',
    'company_description',
  ]) {
    if (details[key] != null && details[key] !== '') job[key] = details[key];
  }
  job.jd_extracted_at = details.extracted_at || new Date().toISOString();
  await setBuffer(buffer);
}

function updateJdProgress(completed, total, succeeded, failed) {
  const progress = $('jd-progress');
  if (!progress) return;
  progress.hidden = false;
  progress.querySelector('.jd-progress-fill').style.width = `${total ? Math.round((completed / total) * 100) : 0}%`;
  progress.querySelector('.jd-progress-text').textContent = `${completed} / ${total} · ${succeeded} ok · ${failed} fail`;
}

async function extractJdsForBuffer() {
  if (isJdExtracting) return;
  isJdExtracting = true;
  jdCancelled = false;
  const button = $('extract-jd-btn');
  const cancelButton = $('cancel-btn');
  button.disabled = true;
  button.textContent = 'Loading…';
  cancelButton.hidden = false;
  try {
    const config = await getDiscoveryApiConfig();
    setStatus('Loading JD-ready jobs from backend…');
    const targets = await JobStackDiscoveryApi.getJdReadyJobs(config);
    if (!targets.length) {
      setStatus('No jobs are ready for JD extraction');
      return;
    }

    let succeeded = 0;
    let failed = 0;
    let completed = 0;
    const results = [];
    updateJdProgress(0, targets.length, 0, 0);
    for (const job of targets) {
      if (jdCancelled) break;
      try {
        const details = await extractJobDescription(job);
        const { jd_full, ...extractedFields } = details;
        results.push({
          id: job.id,
          status: 'completed',
          jobDescription: jd_full || details.jd_description || '',
          extractedFields,
        });
        await mergeJdIntoBuffer(job.job_url, details);
        succeeded += 1;
      } catch (error) {
        if (!jdCancelled) {
          failed += 1;
          console.warn('[JobStack] JD extraction failed:', job.job_url, error.message);
        }
      }
      completed += 1;
      updateJdProgress(completed, targets.length, succeeded, failed);
      setStatus(`Extracting job descriptions… ${completed}/${targets.length} · ${succeeded} ok · ${failed} fail`);
    }

    let submitted = 0;
    let submitFailed = 0;
    if (results.length) {
      setStatus(`Submitting ${results.length} job descriptions…`);
      const result = await JobStackDiscoveryApi.submitJdResults(config, results);
      submitted = result.submitted;
      submitFailed = result.failed;
    }
    await refreshBufferCount();
    setStatus(jdCancelled
      ? `JD extraction cancelled · ${submitted} submitted · ${failed} failed`
      : `JD extraction complete · ${submitted} submitted · ${failed + submitFailed} failed`,
    failed + submitFailed ? 'error' : 'success');
  } catch (error) {
    setStatus(`JD extraction failed: ${error.message}`, 'error');
  } finally {
    isJdExtracting = false;
    activeJdTabIds.clear();
    button.textContent = 'Extract JD';
    cancelButton.hidden = true;
    await refreshJdButton();
  }
}

async function cancelJdExtraction() {
  if (!isJdExtracting) return;
  jdCancelled = true;
  setStatus('Cancelling JD extraction…');
  await Promise.all(Array.from(activeJdTabIds, async (tabId) => {
    try { await chrome.tabs.remove(tabId); } catch {}
  }));
  activeJdTabIds.clear();
}

async function refreshJdButton() {
  const button = $('extract-jd-btn');
  try {
    const token = await JobStackAuthSession.getToken();
    button.disabled = !token || isJdExtracting;
    button.title = token ? 'Extract job descriptions queued on the backend' : 'Connect your JobStack account first';
  } catch {
    button.disabled = true;
    button.title = 'Connect your JobStack account first';
  }
}

async function autoScanAll() {
  if (!currentTab?.id || isAutoScanning) return;

  isAutoScanning = true;
  autoScanTabId = currentTab.id;
  scannedJobs = [];

  const scanBtn = $('scan-btn');
  const autoBtn = $('auto-scan-btn');
  const saveBtn = $('save-btn');
  const cancelBtn = $('cancel-btn');
  const refreshBtn = $('refresh-btn');

  if (scanBtn) scanBtn.disabled = true;
  if (autoBtn) autoBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;
  if (cancelBtn) cancelBtn.hidden = false;
  if (refreshBtn) refreshBtn.disabled = true;

  setStatus('Auto-scan starting...');
  renderJobs([]);

  try {
    const res = await chrome.tabs.sendMessage(autoScanTabId, { type: 'AUTO_SCAN_ALL', maxPages: 10 });
    if (!res) {
      setStatus('No response from page', 'error');
      return;
    }
    if (res.status === 'error') {
      setStatus(`Error: ${res.message}`, 'error');
      return;
    }

    scannedJobs = Array.isArray(res.jobs) ? res.jobs : [];
    renderJobs(scannedJobs);
    if (saveBtn) saveBtn.disabled = scannedJobs.length === 0;

    if (res.cancelled) setStatus(`Cancelled · ${scannedJobs.length} jobs collected`, 'error');
    else if (scannedJobs.length === 0) setStatus('No jobs found', 'error');
    else setStatus(`Auto-scan complete: ${scannedJobs.length} jobs`, 'success');
  } catch (err) {
    setStatus('Content script error — reload page', 'error');
  } finally {
    isAutoScanning = false;
    autoScanTabId = null;
    if (scanBtn) scanBtn.disabled = !(currentSite === 'naukri' && currentPageType === 'listing');
    if (autoBtn) autoBtn.disabled = !(currentSite === 'naukri' && currentPageType === 'listing');
    if (cancelBtn) cancelBtn.hidden = true;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

async function cancelAutoScan() {
  if (!autoScanTabId || !isAutoScanning) return;
  setStatus('Cancelling...');
  try {
    await chrome.tabs.sendMessage(autoScanTabId, { type: 'CANCEL_AUTO_SCAN' });
  } catch (err) {
    setStatus('Unable to cancel scan', 'error');
  }
}

async function refreshDiscoveryState() {
  const scanBtn = $('scan-btn');
  const autoBtn = $('auto-scan-btn');
  const refreshBtn = $('refresh-btn');

  currentTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
  if (!currentTab) {
    setDiscoveryBadge('No tab', '');
    setStatus('No active tab found');
    if (scanBtn) scanBtn.disabled = true;
    if (autoBtn) autoBtn.disabled = true;
    if (refreshBtn) refreshBtn.disabled = false;
    return;
  }

  if (!currentTab.url) {
    setDiscoveryBadge('No URL', '');
    setStatus('Tab URL not accessible — check permissions');
    if (scanBtn) scanBtn.disabled = true;
    if (autoBtn) autoBtn.disabled = true;
    return;
  }

  try {
    const res = await chrome.tabs.sendMessage(currentTab.id, { type: 'PING' });
    currentSite = res?.site || null;
    currentPageType = res?.pageType || 'unknown';
    if (currentSite) setDiscoveryBadge(currentSite, 'active');
    else setDiscoveryBadge('Unsupported', '');

    const isNaukriListing = currentSite === 'naukri' && currentPageType === 'listing';
    if (scanBtn) scanBtn.disabled = !isNaukriListing || isAutoScanning;
    if (autoBtn) autoBtn.disabled = !isNaukriListing || isAutoScanning;

    if (isNaukriListing) setStatus('Naukri listing detected — click Scan');
    else if (currentSite === 'naukri' && currentPageType === 'detail') setStatus('Naukri detail detected — JD extraction uses server-ready jobs');
    else if (currentSite) setStatus(`Extractor for ${currentSite} coming soon`);
    else setStatus('Open a supported listing page');
  } catch (err) {
    setDiscoveryBadge('Reload needed', '');
    setStatus('Reload the page to activate extension', 'error');
    if (scanBtn) scanBtn.disabled = true;
    if (autoBtn) autoBtn.disabled = true;
  }

  await refreshBufferCount();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'AUTO_SCAN_PROGRESS' || !isAutoScanning) return;

  if (msg.done) {
    if (msg.cancelled) setStatus(`Cancelled at page ${msg.page} · ${msg.total} jobs collected`, 'error');
    else setStatus(`Completed ${msg.page} pages · ${msg.total} jobs`, 'success');
  } else {
    setStatus(`Page ${msg.page}/${msg.maxPages} · +${msg.newOnThisPage} new · ${msg.total} total`);
  }
});

$('scan-btn').addEventListener('click', scanPage);
$('save-btn').addEventListener('click', saveToBuffer);
$('send-server-btn').addEventListener('click', sendBufferToBackend);
$('extract-jd-btn').addEventListener('click', extractJdsForBuffer);
$('auto-scan-btn').addEventListener('click', autoScanAll);
$('cancel-btn').addEventListener('click', () => {
  if (isJdExtracting) cancelJdExtraction();
  else if (isAutoScanning) cancelAutoScan();
});
$('refresh-btn').addEventListener('click', async () => {
  await refreshDiscoveryState();
  await initFilters();
  await refreshJdButton();
});
$('clear-btn').addEventListener('click', async () => {
  await chrome.storage.local.set({ jobBuffer: [] });
  await refreshBufferCount();
  setStatus('Buffer cleared', 'success');
});
$('download-btn').addEventListener('click', async () => {
  const jobs = await getBuffer();
  if (!jobs.length) return;
  const csv = [
    ['title', 'company', 'location', 'experience', 'salary', 'job_url'],
    ...jobs.map((job) => [job.title || '', job.company || '', job.location || '', job.experience || '', job.salary || '', job.job_url || ''])
  ].map((row) => row.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'jobstack-discovery-buffer.csv'; a.click();
  URL.revokeObjectURL(url);
  setStatus(`Downloaded ${jobs.length} jobs`, 'success');
});

async function initDiscoveryPanel() {
  const scanBtn = $('scan-btn');
  const autoBtn = $('auto-scan-btn');
  const saveBtn = $('save-btn');
  if (scanBtn) scanBtn.disabled = true;
  if (autoBtn) autoBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;
  await refreshDiscoveryState();
  await initFilters();
  await refreshJdButton();
  await refreshBufferCount();
}

$('preset-select').addEventListener('change', async (event) => {
  activeFilterPreset = event.target.value;
  workingFilters = JSON.parse(JSON.stringify(filterPresets[activeFilterPreset]?.filters || {}));
  await saveFilterPresets();
  renderFilterGroups();
  setFilterStatus(`Switched to: ${activeFilterPreset}`, 'success');
});
$('preset-new-btn').addEventListener('click', createFilterPreset);
$('preset-save-btn').addEventListener('click', saveCurrentFilterPreset);
$('preset-delete-btn').addEventListener('click', deleteCurrentFilterPreset);
$('reset-filters-btn').addEventListener('click', resetCurrentFilters);
$('capture-filters-btn').addEventListener('click', captureFiltersFromUrl);
$('apply-filters-btn').addEventListener('click', () => applyFilters(false));
$('apply-scan-btn').addEventListener('click', () => applyFilters(true));

$('autofillBtn').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab) return setMsg(afOut(), 'No active tab found', 'error');
  setMsg(afOut(), 'Preparing autofill…');
  if (!(await ensureAutofill(tab))) return setMsg(afOut(), 'Autofill is not available on this page.', 'error');
  setMsg(afOut(), 'Autofilling…');
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { action: 'START_AUTOFILL' });
    if (r?.success) { setMsg(afOut(), `Autofilled ${r.count} fields`, 'success'); checkPendingJob(); }
    else setMsg(afOut(), `Autofill failed: ${r?.error || 'Unknown error'}`, 'error');
  } catch (e) { setMsg(afOut(), `Could not reach page: ${e.message}`, 'error'); }
});

async function checkPendingJob() {
  const btn = $('forceLogBtn'); btn.style.display = 'none';
  try {
    const tab = await activeTab();
    if (!tab || !(await ensureAutofill(tab))) return;
    const r = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PENDING_JOB_STATUS' });
    if (r?.pending) {
      btn.style.display = '';
      btn.textContent = r.jobDetails?.jobTitle ? `Register "${r.jobDetails.jobTitle}"` : 'Register site';
    }
  } catch { /* none */ }
}
$('forceLogBtn').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab || !(await ensureAutofill(tab))) return setMsg(afOut(), 'Cannot connect to page. Refresh and retry.', 'error');
  setMsg(afOut(), 'Registering…');
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { action: 'REGISTER_JOB' });
    if (r?.success) { setMsg(afOut(), 'Job registered', 'success'); $('forceLogBtn').style.display = 'none'; }
    else setMsg(afOut(), `Registration failed: ${r?.error || 'No pending job'}`, 'error');
  } catch (e) { setMsg(afOut(), e.message, 'error'); }
});

$('previewBtn').addEventListener('click', async () => {
  const box = $('previewContainer');
  if (!box.hidden) { box.hidden = true; return; }
  const tab = await activeTab();
  if (!tab) return setMsg(afOut(), 'No active tab', 'error');
  box.hidden = false; $('previewText').value = 'Loading…';
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { action: 'GET_FIELD_PREVIEW' });
    $('previewText').value = r?.success ? (r.preview || 'No preview data.') : `Failed: ${r?.error || 'Unknown error'}`;
  } catch (e) { $('previewText').value = `Could not reach page: ${e.message}`; }
});
$('closePreviewBtn').addEventListener('click', () => { $('previewContainer').hidden = true; });
$('copyPreviewBtn').addEventListener('click', async () => {
  const v = $('previewText').value; if (!v) return;
  try { await navigator.clipboard.writeText(v); } catch { $('previewText').select(); document.execCommand('copy'); }
  setMsg(afOut(), 'Copied to clipboard', 'success');
});

// ---------- Apply queue ----------
async function refreshApplyQueueState() {
  if (!window.JobStackApplicationQueue) return;
  const state = await window.JobStackApplicationQueue.loadState();
  applyQueue = Array.isArray(state.jobs) ? state.jobs : [];
  applyIndex = Math.min(Math.max(Number(state.index) || 0, 0), Math.max(applyQueue.length - 1, 0));
  applyTabId = state.tabId ?? null;
  renderApplyQueueState();
}

async function reloadApplyQueue() {
  if (isApplyQueueLoading) return;
  isApplyQueueLoading = true;
  const reloadButton = $('apply-reload-btn');
  if (reloadButton) reloadButton.disabled = true;
  $('apply-status').textContent = 'Loading apply queue from server…';
  try {
    const response = await JobStackApplicationsApi.getTrackerApplyQueue();
    applyQueue = JobStackApplicationQueue.normalize(response);
    applyIndex = Math.min(Math.max(applyIndex, 0), Math.max(applyQueue.length - 1, 0));
    await saveApplyQueueState();
    renderApplyQueueState();
    $('apply-status').textContent = applyQueue.length
      ? `Loaded ${applyQueue.length} jobs from server`
      : 'Apply queue is empty';
  } catch (error) {
    $('apply-status').textContent = `Could not load queue: ${error.message}`;
    $('apply-status').style.color = 'var(--err)';
  } finally {
    isApplyQueueLoading = false;
    if (reloadButton) reloadButton.disabled = false;
  }
}

async function flushSuccessfulApplications() {
  if (!successfulApplyIds.length) return;
  const unique = [...new Map(successfulApplyIds.map((id) => [String(id), { id: String(id), appliedAt: new Date().toISOString() }])).values()];
  successfulApplyIds = [];

  try {
    const response = await JobStackApplicationsApi.submitSuccessfulApplications(unique);
    const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
    const failed = results.filter((item) => item?.success === false || item?.status === 'failed');
    if (failed.length) {
      $('apply-status').textContent = `Recorded ${results.length - failed.length} applications, ${failed.length} failed to sync.`;
      $('apply-status').style.color = 'var(--err)';
      return;
    }
    $('apply-status').textContent = `Recorded ${results.length || unique.length} successful applications.`;
    $('apply-status').style.color = 'var(--ok)';
  } catch (error) {
    $('apply-status').textContent = `Could not sync successful applications: ${error.message}`;
    $('apply-status').style.color = 'var(--err)';
  }
}

async function markCurrentApplySuccessful(job) {
  const id = job?.id ?? job?._id ?? null;
  if (id) {
    const asString = String(id);
    if (!successfulApplyIds.includes(asString)) successfulApplyIds.push(asString);
  }

  const nextIndex = applyIndex + 1;
  if (nextIndex < applyQueue.length) {
    applyIndex = nextIndex;
    await saveApplyQueueState();
    renderApplyQueueState();
    await openQueuedJobAt(applyIndex);
    await processApplyQueue();
    return;
  }

  await flushSuccessfulApplications();
  $('apply-status').textContent = 'Apply queue complete.';
  $('apply-status').style.color = 'var(--ok)';
}

async function processApplyQueue() {
  if (isApplyQueueBusy || !applyQueue.length) return;
  const job = applyQueue[applyIndex];
  if (!job) {
    await flushSuccessfulApplications();
    return;
  }

  const tab = await activeTab();
  if (!tab) {
    $('apply-status').textContent = 'No active tab found for the queued application.';
    $('apply-status').style.color = 'var(--err)';
    return;
  }

  try {
    const result = await window.JobStackApplyCoordinator.clickApplyCta(tab.id, job.job_url);
    if (result?.alreadyApplied) {
      $('apply-status').textContent = `Application already submitted for ${job.title || 'this role'}. Moving on…`;
      $('apply-status').style.color = 'var(--ok)';
      await markCurrentApplySuccessful(job);
      return;
    }

    if (result?.clicked) {
      $('apply-status').textContent = `Apply CTA clicked for ${job.title || 'this role'}. Complete the form manually and submit.`;
      $('apply-status').style.color = 'var(--ok)';

      const waitStarted = Date.now();
      while (Date.now() - waitStarted < 90000) {
        const latest = await chrome.tabs.get(tab.id).catch(() => null);
        if (!latest || !latest.url || latest.url === 'about:blank') {
          await sleep(2000);
          continue;
        }

        const followUp = await window.JobStackApplyCoordinator.clickApplyCta(tab.id, job.job_url).catch(() => ({ clicked: false }));
        if (followUp?.alreadyApplied) {
          await markCurrentApplySuccessful(job);
          return;
        }
        await sleep(3000);
      }

      $('apply-status').textContent = `Application form is open for ${job.title || 'this role'}. Please submit it, then continue.`;
      $('apply-status').style.color = 'var(--warn)';
      return;
    }

    $('apply-status').textContent = `Apply button not visible for ${job.title || 'this role'}. Reloading page and retrying…`;
    $('apply-status').style.color = 'var(--err)';
    await chrome.tabs.reload(tab.id).catch(() => {});
    await sleep(3500);
    const retry = await window.JobStackApplyCoordinator.clickApplyCta(tab.id, job.job_url).catch(() => ({ clicked: false }));
    if (retry?.alreadyApplied) {
      await markCurrentApplySuccessful(job);
      return;
    }
    if (retry?.clicked) {
      await processApplyQueue();
      return;
    }

    $('apply-status').textContent = `Apply button missing for ${job.title || 'this role'}. Please reload this page and try again manually.`;
    $('apply-status').style.color = 'var(--err)';
  } catch (error) {
    $('apply-status').textContent = `Apply processing failed: ${error.message}`;
    $('apply-status').style.color = 'var(--err)';
  }
}

async function startApplyFlow() {
  if (isProcessingApplyQueue) return;
  isProcessingApplyQueue = true;
  showView('apply');
  try {
    await reloadApplyQueue();
    if (!applyQueue.length) {
      $('apply-status').textContent = 'Apply queue is empty.';
      $('apply-status').style.color = 'var(--err)';
      return;
    }

    if (applyIndex >= applyQueue.length) applyIndex = 0;
    await openQueuedJobAt(applyIndex);
    await processApplyQueue();
  } catch (error) {
    $('apply-status').textContent = `Could not start apply flow: ${error.message}`;
    $('apply-status').style.color = 'var(--err)';
  } finally {
    isProcessingApplyQueue = false;
  }
}

async function consumePendingApply() {
  const pending = await chrome.storage.local.get('pendingApply');
  if (!pending.pendingApply) return;
  await chrome.storage.local.remove('pendingApply');
  await startApplyFlow();
}

async function saveApplyQueueState() {
  if (!window.JobStackApplicationQueue) return;
  await window.JobStackApplicationQueue.saveState({ jobs: applyQueue, index: applyIndex, tabId: applyTabId });
}

function renderApplyQueueState() {
  const total = applyQueue.length;
  const job = applyQueue[applyIndex] || null;
  const countEl = $('apply-queue-count');
  const totalEl = $('apply-total-display');
  const indexEl = $('apply-index-display');
  const prevBtn = $('apply-prev-btn');
  const nextBtn = $('apply-next-btn');
  const card = $('apply-current-card');
  const empty = $('apply-empty');
  const status = $('apply-status');

  if (countEl) countEl.textContent = String(total);
  if (totalEl) totalEl.textContent = String(total);
  if (indexEl) indexEl.textContent = job ? String(applyIndex + 1) : '0';
  if (prevBtn) prevBtn.disabled = !job || applyIndex <= 0;
  if (nextBtn) nextBtn.disabled = !job || applyIndex >= total - 1;
  if (card) card.classList.toggle('hidden', !job);
  if (empty) empty.hidden = !!job;

  if (!job) {
    if (status) status.textContent = 'No queue loaded';
    return;
  }

  $('apply-current-title').textContent = job.title || 'Untitled';
  $('apply-current-company').textContent = job.company || '—';
  $('apply-current-exp').textContent = job.experience || '';
  $('apply-current-sal').textContent = job.salary || '';
  $('apply-current-loc').textContent = job.location || '';
  if (status) status.textContent = `Queued job ${applyIndex + 1} of ${total}`;
}

async function openQueuedJobAt(index) {
  if (!window.JobStackApplyCoordinator || isApplyQueueBusy) return;
  const job = applyQueue[index];
  if (!job) return;
  isApplyQueueBusy = true;
  renderApplyQueueState();
  try {
    applyIndex = index;
    applyTabId = await window.JobStackApplyCoordinator.openQueuedJob(job, applyTabId);
    await saveApplyQueueState();
    renderApplyQueueState();
    $('apply-status').textContent = `Opened job ${applyIndex + 1} of ${applyQueue.length}`;
    $('apply-status').style.color = 'var(--ok)';
  } catch (error) {
    $('apply-status').textContent = `Could not open job: ${error.message}`;
    $('apply-status').style.color = 'var(--err)';
  } finally {
    isApplyQueueBusy = false;
    renderApplyQueueState();
  }
}

async function applyPrevJob() { if (applyIndex > 0) await openQueuedJobAt(applyIndex - 1); }
async function applyNextJob() { if (applyIndex < applyQueue.length - 1) await openQueuedJobAt(applyIndex + 1); }

$('apply-prev-btn').addEventListener('click', applyPrevJob);
$('apply-next-btn').addEventListener('click', applyNextJob);
$('apply-reload-btn').addEventListener('click', reloadApplyQueue);
$('apply-clear-btn').addEventListener('click', async () => {
  await window.JobStackApplicationQueue.clearState();
  applyQueue = [];
  applyIndex = 0;
  applyTabId = null;
  renderApplyQueueState();
});
$('apply-open-btn').addEventListener('click', () => openQueuedJobAt(applyIndex));
$('apply-click-btn').addEventListener('click', async () => {
  if (!window.JobStackApplyCoordinator) return setMsg(afOut(), 'Apply coordinator is unavailable.', 'error');
  const job = applyQueue[applyIndex];
  if (!job) return setMsg(afOut(), 'No queued job selected.', 'error');
  const tab = await activeTab();
  if (!tab) return setMsg(afOut(), 'No active tab found.', 'error');
  setMsg(afOut(), 'Clicking Apply…');
  try {
    const result = await window.JobStackApplyCoordinator.clickApplyCta(tab.id, job.job_url);
    if (result?.clicked) setMsg(afOut(), 'Apply CTA clicked successfully.', 'success');
    else setMsg(afOut(), result?.reason || 'Apply CTA not found on this page.', 'error');
  } catch (e) { setMsg(afOut(), e.message, 'error'); }
});
$('apply-autofill-btn').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab) return setMsg(afOut(), 'No active tab found.', 'error');
  setMsg(afOut(), 'Preparing autofill…');
  if (!(await ensureAutofill(tab))) return setMsg(afOut(), 'Autofill is not available on this page.', 'error');
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { action: 'START_AUTOFILL' });
    if (r?.success) setMsg(afOut(), `Autofilled ${r.count} fields`, 'success');
    else setMsg(afOut(), `Autofill failed: ${r?.error || 'Unknown error'}`, 'error');
  } catch (e) { setMsg(afOut(), `Could not reach page: ${e.message}`, 'error'); }
});

document.addEventListener('keydown', (event) => {
  if (!$('view-apply').classList.contains('active')) return;
  if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    applyNextJob();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    applyPrevJob();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.pendingApply?.newValue) {
    consumePendingApply();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'SIDE_PANEL_CMD') return true;

  switch (message.action) {
    case 'START_APPLY':
      showView('apply');
      consumePendingApply();
      sendResponse({ status: 'ok' });
      return true;
    case 'OPEN_FILTERS_TAB':
      showView('discover');
      document.querySelectorAll('.seg .tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'filters'));
      document.querySelectorAll('#discovery-panel-root .tab-content').forEach((content) => content.classList.toggle('active', content.id === 'tab-filters'));
      sendResponse({ status: 'ok' });
      return true;
    default:
      sendResponse({ status: 'ok' });
      return true;
  }
});

// ---------- Settings / developer mode ----------
$('openAppBtn').addEventListener('click', () => chrome.tabs.create({ url: WEB_APP_URL }));
chrome.runtime.onMessage.addListener((m) => { if (m.action === 'TOGGLE_ADVANCED_SETTINGS') { $('advancedToggleWrapper').classList.toggle('visible'); showView('settings'); } });

function paintDevMode(on) {
  const b = $('devModeToggleBtn');
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('primary', on);
  b.textContent = `Development mode: ${on ? 'ON' : 'OFF'}`;
}
async function loadUrls() {
  const { backendUrl, frontendUrl, devMode } = await chrome.storage.sync.get(['backendUrl', 'frontendUrl', 'devMode']);
  const dev = devMode === true || localStorage.getItem('jobstacker_dev_mode') === 'true';
  $('backendUrl').value = dev ? LOCAL.be : backendUrl && !isLocalUrl(backendUrl) ? backendUrl : PROD.be;
  $('frontendUrl').value = dev ? LOCAL.fe : frontendUrl && !isLocalUrl(frontendUrl) ? frontendUrl : PROD.fe;
  WEB_APP_URL = $('frontendUrl').value;
  paintDevMode(dev);
}
$('devModeToggleBtn').addEventListener('click', async () => {
  const on = $('devModeToggleBtn').getAttribute('aria-pressed') !== 'true';
  localStorage.setItem('jobstacker_dev_mode', String(on));
  await chrome.storage.sync.set({ devMode: on });
  await loadUrls();
});

$('testConnectionBtn').addEventListener('click', async () => {
  const out = $('connectionStatus');
  const backendUrl = $('backendUrl').value.trim(), frontendUrl = $('frontendUrl').value.trim();
  if (!/^https?:\/\//i.test(backendUrl)) return setMsg(out, 'Backend URL must start with http:// or https://', 'error');
  setMsg(out, 'Testing connection…');
  try {
    await chrome.storage.sync.set({ backendUrl, frontendUrl: frontendUrl || WEB_APP_URL, devMode: $('devModeToggleBtn').getAttribute('aria-pressed') === 'true' });
    const token = await JobStackAuthSession.getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(backendUrl, { method: 'POST', headers, mode: 'cors', signal: ctl.signal,
      body: JSON.stringify({ source: 'ext-connection-check', test: true, totalJobs: 0, jobs: [], extractedAt: new Date().toISOString() }) });
    clearTimeout(t);
    if (res.status === 404) return setMsg(out, 'Endpoint not found (404). Check the backend URL.', 'error');
    if (res.ok || [400, 401, 403, 405].includes(res.status)) return setMsg(out, `Connected (${res.status})`, 'success');
    setMsg(out, `Server responded with ${res.status}`, 'error');
  } catch (e) { setMsg(out, e.name === 'AbortError' ? 'Timed out reaching the backend.' : `Network error: ${e.message}`, 'error'); }
});

// ---------- Init ----------
(async function init() {
  await Promise.all([loadUrls(), updateAuthStatus(), detectPlatform(), loadCounts(), initDiscoveryPanel(), refreshApplyQueueState()]);
  checkPendingJob();
  await consumePendingApply();
  setInterval(() => { updateAuthStatus(); loadCounts(); detectPlatform(); }, 5000);
})();
