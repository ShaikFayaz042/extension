// background.js – supports LinkedIn, Naukri, Wellfound, Internshala
// Unified format: appliedDateRaw, statusRaw
// Now with JWT authentication and platform filtering
// Added autofill support: GET_PROFILE, LOG_EXTERNAL_APPLICATION
// Added resume caching from Cloudinary

importScripts(
  '../auth/session.js',
  '../api/client.js',
  '../api/profiles.js',
  '../api/applications.js',
  '../api/tracking.js',
  '../application/queue.js',
  '../application/apply-coordinator.js'
);

// ---------- INIT ----------
chrome.runtime.onInstalled.addListener(() => {
  console.log('JobStacker Extractor background service worker started');
  checkTokenStatus();

  // Set side panel to open when action icon is clicked
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Side panel setup error:', error));
});

// Update badge icon
function updateBadge(hasToken) {
  if (hasToken) {
    chrome.action.setBadgeText({ text: '✔️' });
    chrome.action.setBadgeBackgroundColor({ color: '#22C55E' });
  } else {
    chrome.action.setBadgeText({ text: '!Login' });
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
  }
}
// background.js

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-advanced-settings') {
    chrome.runtime.sendMessage({ action: 'TOGGLE_ADVANCED_SETTINGS' });
  } else if (command === 'open-panel') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) {
        chrome.sidePanel.open({ tabId: tab.id }).catch((error) => console.error(error));
      }
    });
  }
});

async function getAuthToken() {
  return JobStackAuthSession.getToken();
}

async function getUserPlatforms() {
  return JobStackAuthSession.getPlatforms();
}

async function checkTokenStatus() {
  const token = await getAuthToken();
  updateBadge(!!token);
}

// ---------- STORAGE HELPERS ----------
function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
function setStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// ---------- API CLIENT (AUTHENTICATED) ----------
// ---------- SEND TO BACKEND ----------
async function sendToBackend(jobs, type, source = 'auto-background') {
  try {
    const result = await JobStackTrackingApi.sendApplications(jobs, type, source);
    if (result) console.log(`Sent ${jobs.length} ${type} jobs. Record ID: ${result.recordId || 'saved'}`);
    return result;
  } catch (err) {
    console.warn('Application tracking send failed', err);
    throw err;
  }
}

// ---------- NAUKRI HELPERS ----------
// (unchanged, same as before)
async function getNaukriToken() {
  const cookie = await chrome.cookies.get({ url: 'https://www.naukri.com', name: 'nauk_at' });
  return cookie?.value || null;
}

function parseNaukriJobs(data) {
  const applyDetails = data.applyDetails || [];
  return applyDetails.map(job => ({
    jobId: job.jobId,
    title: job.jobTitle,
    company: job.company,
    location: job.location || '',
    appliedDateRaw: job.status?.[0]?.dateTime || job.jobActivityDate || '',
    statusRaw: job.status?.map(s => s.statusValue).join(' → ') || 'Applied',
    jobUrl: `https://www.naukri.com/job-listings-${job.jobId}`,
    source: 'naukri',
    extractedAt: new Date().toISOString()
  }));
}

async function fetchNaukriJobsFromAPI() {
  const platforms = await getUserPlatforms();
  if (!platforms.includes('naukri')) {
    console.log('[Naukri] Platform not enabled by user, skipping.');
    return [];
  }

  const token = await getNaukriToken();
  if (!token) {
    console.error('No nauk_at cookie');
    throw new Error('Naukri session expired. Please login again.');
  }
  const allJobs = [];
  let pageNumber = 1;
  let hasMore = true;
  const pageSize = 50;
  while (hasMore) {
    const url = `https://www.naukri.com/cloudgateway-apply/whtma-services/v0/applyapi/v5/history?pageSize=${pageSize}&days=365&filterInfo=2&pageNumber=${pageNumber}`;
    const response = await fetch(url, {
      method: 'GET', credentials: 'include',
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}`, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json', 'Appid': '107', 'Systemid': '107' }
    });
    if (!response.ok) break;
    const data = await response.json();
    const jobs = parseNaukriJobs(data);
    allJobs.push(...jobs);
    const total = parseInt(data.matchingRowsCount, 10);
    hasMore = (pageNumber * pageSize) < total;
    pageNumber++;
  }
  console.log(`Fetched ${allJobs.length} Naukri jobs`);
  if (allJobs.length) await sendToBackend(allJobs, 'naukri');
  await chrome.storage.local.set({ naukriJobs: allJobs, lastExtractedType: 'naukri', lastExtractedAt: new Date().toISOString() });
  return allJobs;
}

// ---------- WELLFOUND ----------
async function getWellfoundSessionCookie() {
  const urls = [
    'https://wellfound.com',
    'https://www.wellfound.com',
    'https://.wellfound.com'
  ];
  for (const url of urls) {
    const cookie = await chrome.cookies.get({ url, name: '_wellfound' });
    if (cookie?.value) {
      console.log(`✅ Found _wellfound cookie via ${url}`);
      return cookie.value;
    }
  }
  const allCookies = await chrome.cookies.getAll({ domain: 'wellfound.com' });
  const found = allCookies.find(c => c.name === '_wellfound');
  if (found) {
    console.log(`✅ Found _wellfound cookie via getAll: ${found.value.substring(0, 20)}...`);
    return found.value;
  }
  console.error('❌ No _wellfound cookie found');
  return null;
}

// ---------- INTERNSHALA HELPERS ----------
async function getInternshalaSessionCookies() {
  const csrfCookie = await chrome.cookies.get({ url: 'https://internshala.com', name: 'csrf_cookie_name' });
  const sessionCookie = await chrome.cookies.get({ url: 'https://internshala.com', name: 'isjl' });
  const roleCookie = await chrome.cookies.get({ url: 'https://internshala.com', name: 'role' });
  return {
    csrf: csrfCookie?.value || '',
    session: sessionCookie?.value || '',
    role: roleCookie?.value || ''
  };
}

async function fetchInternshalaApplications() {
  const platforms = await getUserPlatforms();
  if (!platforms.includes('internshala')) {
    console.log('[Internshala] Platform not enabled by user, skipping.');
    return [];
  }

  const allJobs = [];
  let page = 1;
  let totalPages = 1;
  const { csrf } = await getInternshalaSessionCookies();

  while (page <= totalPages) {
    const url = `https://internshala.com/api/candidate/dashboard/paginated_applications/new/${page}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Auth-Token-Is': '1',
          'X-Frontend-Request': '1',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-CSRF-TOKEN': csrf || ''
        },
        body: new URLSearchParams()
      });

      if (!response.ok) {
        console.error(`Internshala page ${page} failed: ${response.status}`);
        break;
      }

      const data = await response.json();
      if (!data.success) {
        console.warn(`Internshala API returned success=false:`, data);
        break;
      }

      totalPages = data.total_pages || 1;
      const applications = data.applications || [];
      console.log(`📦 Internshala page ${page}: ${applications.length} applications`);

      for (const app of applications) {
        allJobs.push({
          jobId: app.id.toString(),
          title: app.profile_to_display,
          company: app.company_name,
          location: '',
          appliedDateRaw: app.applied_at,
          statusRaw: app.application_status,
          jobUrl: app.url,
          source: 'internshala',
          extractedAt: new Date().toISOString()
        });
      }

      page++;
    } catch (err) {
      console.error('Internshala fetch error:', err);
      break;
    }
  }

  console.log(`✅ Internshala total: ${allJobs.length} jobs`);
  if (allJobs.length) await sendToBackend(allJobs, 'internshala');
  await chrome.storage.local.set({
    internshalaJobs: allJobs,
    lastExtractedType: 'internshala',
    lastExtractedAt: new Date().toISOString()
  });
  return allJobs;
}

// ---------- LINKEDIN MULTI‑STAGE AUTO EXTRACTION ----------
const LINKEDIN_BASE = 'https://www.linkedin.com/jobs-tracker/';
const STAGES = ['applied', 'saved', 'draft', 'clicked_apply', 'interview'];

async function extractJobsFromTab(tabId, stage) {
  console.log(`[LinkedIn] Extracting stage "${stage}" from tab ${tabId}...`);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/applied-jobs/content-linkedin.js']
    });
    await new Promise(r => setTimeout(r, 500));
    const response = await chrome.tabs.sendMessage(tabId, { action: 'extractLinkedInJobsFromPage' });
    if (response && response.success) {
      console.log(`[LinkedIn] Stage "${stage}" extracted ${response.jobs.length} jobs`);
      return response.jobs;
    }
    console.warn(`[LinkedIn] Stage "${stage}" extraction returned no jobs or failed`);
    return [];
  } catch (err) {
    console.error(`[LinkedIn] Error extracting stage "${stage}":`, err);
    return [];
  }
}

async function extractStageInTab(stage) {
  const url = `${LINKEDIN_BASE}?stage=${stage}&_ext=bg`;
  console.log(`[LinkedIn] Opening tab for stage "${stage}": ${url}`);
  const tab = await chrome.tabs.create({ url, active: false });

  await new Promise((resolve) => {
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  await new Promise(r => setTimeout(r, 3000));

  const jobs = await extractJobsFromTab(tab.id, stage);
  await chrome.tabs.remove(tab.id);
  console.log(`[LinkedIn] Closed tab for stage "${stage}" – extracted ${jobs.length} jobs`);
  return jobs;
}

async function autoExtractAllLinkedInStages() {
  const platforms = await getUserPlatforms();
  if (!platforms.includes('linkedin')) {
    console.log('[LinkedIn] Platform not enabled by user, skipping.');
    return [];
  }

  console.log('🚀 [LinkedIn] Starting multi‑stage extraction for all stages:', STAGES);
  const allJobs = [];
  for (const stage of STAGES) {
    console.log(`📂 [LinkedIn] Processing stage: ${stage}...`);
    const jobs = await extractStageInTab(stage);
    allJobs.push(...jobs);
    console.log(`[LinkedIn] Stage "${stage}" done. Running total: ${allJobs.length} jobs`);
  }
  console.log(`✅ [LinkedIn] Extraction complete. Total jobs across all stages: ${allJobs.length}`);

  if (allJobs.length > 0) {
    await chrome.storage.local.set({
      linkedinJobs: allJobs,
      lastExtractedType: 'linkedin',
      lastExtractedAt: new Date().toISOString()
    });
    console.log(`[LinkedIn] Stored ${allJobs.length} jobs locally – now sending to backend...`);
    await sendToBackend(allJobs, 'linkedin', 'auto-multi-stage');
  } else {
    console.warn('[LinkedIn] No jobs found – nothing sent to backend.');
  }
  return allJobs;
}

const TRUSTED_JOBSTACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'jobstack-live.vercel.app'
]);

function isTrustedJobStackSender(sender) {
  if (!sender?.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isTrustedJobStackPage(sender) {
  if (!sender?.url) return false;
  try {
    const url = new URL(sender.url);
    const allowed = url.protocol === 'http:' || url.protocol === 'https:';
    const host = url.hostname.replace(/^www\./, '');
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(host);
    const isVercel = host === 'jobstack-live.vercel.app';
    return allowed && (isLocal || isVercel);
  } catch {
    return false;
  }
}

// ---------- MESSAGE HANDLER (combined) ----------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Token & platform management
  if (request.type === 'SET_USER_DATA') {
    if (!isTrustedJobStackPage(sender)) {
      sendResponse({ success: false, error: 'Untrusted JobStack sender' });
      return true;
    }

    const { token, platforms } = request;
    JobStackAuthSession.setSession(token, platforms || []).then(() => {
      console.log('[Background] User data stored. Platforms:', platforms);
      updateBadge(true);
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.type === 'CLEAR_TOKEN') {
    if (!isTrustedJobStackPage(sender)) {
      sendResponse({ success: false, error: 'Untrusted JobStack sender' });
      return true;
    }

    JobStackAuthSession.clearSession().then(() => {
      console.log('[Background] Token and platforms cleared');
      updateBadge(false);
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.type === 'GET_TOKEN_STATUS') {
    JobStackAuthSession.getStatus().then(sendResponse);
    return true;
  }

  if (request.type === 'PING') {
    sendResponse({ status: 'pong' });
    return true;
  }

  if (request.type === 'JOBSTACK_JWT') {
    let senderUrl;
    try {
      senderUrl = new URL(sender.url);
    } catch {
      sendResponse({ status: 'error', message: 'Invalid JWT sender' });
      return true;
    }
    const trustedPage = sender.frameId === 0 &&
      ['http:', 'https:'].includes(senderUrl.protocol) &&
      ['localhost', '127.0.0.1'].includes(senderUrl.hostname) &&
      senderUrl.port === '5173';
    if (!trustedPage || typeof request.token !== 'string') {
      sendResponse({ status: 'error', message: 'Untrusted JWT sender' });
      return true;
    }
    JobStackAuthSession.setToken(request.token).then((token) => {
      updateBadge(!!token);
      sendResponse({ status: 'ok', stored: !!token });
    }).catch((error) => {
      sendResponse({ status: 'error', message: error.message });
    });
    return true;
  }

  if (request.type === 'GET_JOBSTACK_JWT') {
    JobStackAuthSession.getToken().then((token) => sendResponse({ token }));
    return true;
  }

  if (request.type === 'JOBSTACK_CMD') {
    let senderUrl;
    try {
      senderUrl = new URL(sender.url);
    } catch {
      sendResponse({ status: 'error', message: 'Untrusted command sender', requestId: request.requestId });
      return true;
    }
    const trustedSender = sender.frameId === 0 &&
      ['http:', 'https:'].includes(senderUrl.protocol) &&
      ['localhost', '127.0.0.1'].includes(senderUrl.hostname) &&
      senderUrl.port === '5173';
    const allowedActions = new Set([
      'OPEN_PANEL', 'CLOSE_PANEL', 'START_APPLY', 'RUN_SCAN', 'RUN_AUTO_SCAN',
      'RUN_JD_EXTRACTION', 'SEND_TO_SERVER', 'OPEN_FILTERS_TAB', 'OPEN_SERVER_TAB',
      'START_NEW_BATCH', 'REFRESH_CONFIG',
    ]);
    if (!trustedSender || !allowedActions.has(request.action)) {
      sendResponse({ status: 'error', message: 'Untrusted command or sender', requestId: request.requestId });
      return true;
    }

    if (request.action === 'OPEN_PANEL') {
      if (sender.tab?.windowId == null) {
        sendResponse({ status: 'error', message: 'No window id', requestId: request.requestId });
        return true;
      }
      chrome.sidePanel.open({ windowId: sender.tab.windowId })
        .then(() => sendResponse({ status: 'ok', requestId: request.requestId }))
        .catch((error) => sendResponse({ status: 'error', message: error.message, requestId: request.requestId }));
      return true;
    }

    if (request.action === 'CLOSE_PANEL') {
      if (sender.tab?.windowId == null) {
        sendResponse({ status: 'error', message: 'No window id', requestId: request.requestId });
        return true;
      }
      if (typeof chrome.sidePanel.close !== 'function') {
        sendResponse({ status: 'error', message: 'Closing the side panel requires Chrome 141 or later', requestId: request.requestId });
        return true;
      }
      chrome.sidePanel.close({ windowId: sender.tab.windowId })
        .then(() => sendResponse({ status: 'ok', requestId: request.requestId }))
        .catch((error) => sendResponse({ status: 'error', message: error.message, requestId: request.requestId }));
      return true;
    }

    if (request.action === 'START_APPLY') {
      if (sender.tab?.windowId == null) {
        sendResponse({ status: 'error', message: 'No window id', requestId: request.requestId });
        return true;
      }
      const openPanel = chrome.sidePanel.open({ windowId: sender.tab.windowId });
      const savePendingApply = chrome.storage.local.set({ pendingApply: true });
      Promise.all([openPanel, savePendingApply])
        .then(() => sendResponse({ status: 'ok', requestId: request.requestId }))
        .catch(async (error) => {
          await savePendingApply.catch(() => {});
          await chrome.storage.local.remove('pendingApply').catch(() => {});
          sendResponse({ status: 'error', message: error.message, requestId: request.requestId });
        });
      return true;
    }

    chrome.runtime.sendMessage({
      type: 'SIDE_PANEL_CMD',
      action: request.action,
      payload: request.payload,
    }).then((response) => {
      sendResponse({ ...(response || { status: 'ok' }), requestId: request.requestId });
    }).catch(() => {
      sendResponse({ status: 'panel-closed', requestId: request.requestId });
    });
    return true;
  }

  if (request.action === 'GET_APPLY_QUEUE') {
    JobStackApplicationsApi.getTrackerApplyQueue()
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // ---------- Scraping actions (with platform check) ----------

  if (request.action === 'fetchNaukriJobsFromBackground') {
    fetchNaukriJobsFromAPI()
      .then(jobs => sendResponse({ success: true, jobs }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'fetchInternshalaJobsFromBackground') {
    fetchInternshalaApplications()
      .then(jobs => sendResponse({ success: true, jobs }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'naukriScriptReady') {
    sendResponse({ received: true });
    return true;
  }

  if (request.action === 'sendWellfoundToBackend') {
    getUserPlatforms().then(platforms => {
      if (!platforms.includes('wellfound')) {
        sendResponse({ success: false, error: 'Wellfound platform not enabled' });
        return;
      }
      sendToBackend(request.jobs, 'wellfound', 'auto-content-script')
        .then(result => sendResponse({ success: true, result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (request.action === 'sendLinkedinToBackend') {
    getUserPlatforms().then(platforms => {
      if (!platforms.includes('linkedin')) {
        sendResponse({ success: false, error: 'LinkedIn platform not enabled' });
        return;
      }
      sendToBackend(request.jobs, 'linkedin', 'auto-content-script')
        .then(result => sendResponse({ success: true, result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (request.action === 'autoExtractAllLinkedInStages') {
    autoExtractAllLinkedInStages()
      .then(jobs => sendResponse({ success: true, jobs }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'sendJobsToBackend') {
    if (request.platform) {
      getUserPlatforms().then(platforms => {
        if (!platforms.includes(request.platform)) {
          sendResponse({ success: false, error: `Platform "${request.platform}" not enabled` });
          return;
        }
        sendToBackend(request.jobs, request.platform, request.source || 'popup-manual')
          .then(result => sendResponse({ success: true, result }))
          .catch(err => sendResponse({ success: false, error: err.message }));
      });
      return true;
    } else {
      sendToBackend(request.jobs, request.platform || 'unknown', request.source || 'popup-manual')
        .then(result => sendResponse({ success: true, result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  }

  // ---------- AUTOFILL ACTIONS ----------
  if (request.action === 'GET_PROFILE') {
    JobStackProfileApi.getProfile()
      .then(profile => sendResponse({ success: true, data: profile }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'SAVE_PROFILE') {
    JobStackProfileApi.saveProfile(request.profileData)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'LOG_EXTERNAL_APPLICATION') {
    const { type, source, jobs, extractedAt } = request.data;
    if (!jobs || !jobs.length) {
      sendResponse({ success: false, error: 'No jobs to log' });
      return true;
    }
    sendToBackend(jobs, type || 'external-autofill', source || 'autofill-engine')
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ---------- NEW: GET_RESUME ----------
  if (request.action === 'GET_RESUME') {
    (async () => {
      try {
        const cachedResume = await JobStackProfileApi.getCachedResume();
        if (cachedResume) {
          sendResponse({ success: true, data: cachedResume });
          return;
        }
        const profile = await JobStackProfileApi.getProfile();
        if (profile && profile.resumeUrl) {
          await new Promise(r => setTimeout(r, 1000));
          const newResume = await JobStackProfileApi.getCachedResume();
          if (newResume) {
            sendResponse({ success: true, data: newResume });
          } else {
            sendResponse({ success: false, error: 'Resume not available after caching.' });
          }
        } else {
          sendResponse({ success: false, error: 'No resume URL in profile.' });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  return false;
});

// ---------- INITIALIZATION ----------
checkTokenStatus();