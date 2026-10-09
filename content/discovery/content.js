// ============================================================
// Job Capture — Content Script (Generic Dispatcher)
// ============================================================
// Requires: extractors registered on window.JobCaptureExtractors

const EXTRACTORS = window.JobCaptureExtractors || {};
const JOBSTACK_COMMANDS = new Set([
  'OPEN_PANEL',
  'CLOSE_PANEL',
  'START_APPLY',
  'RUN_SCAN',
  'RUN_AUTO_SCAN',
  'RUN_JD_EXTRACTION',
  'SEND_TO_SERVER',
  'OPEN_FILTERS_TAB',
  'OPEN_SERVER_TAB',
  'START_NEW_BATCH',
  'REFRESH_CONFIG',
]);

function getActiveExtractor() {
  for (const key of Object.keys(EXTRACTORS)) {
    try {
      if (EXTRACTORS[key].matches()) return EXTRACTORS[key];
    } catch (err) {
      console.warn('[Job Capture] Extractor error:', key, err);
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let autoScanCancelled = false;

function syncJobstackJwtFromPage() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return;
    chrome.runtime.sendMessage({ type: 'JOBSTACK_JWT', token });
  } catch (err) {
    console.warn('[Job Capture] Failed to sync JobStack JWT from localStorage:', err);
  }
}

function waitForUrlChange(previousUrl, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (autoScanCancelled) return resolve('cancelled');
      if (location.href !== previousUrl) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(check, 200);
    };
    check();
  });
}

async function waitForCards(extractor, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (autoScanCancelled) return false;
    if (extractor.hasListingCards()) return true;
    await sleep(200);
  }
  return false;
}

async function waitForNewJobIds(extractor, previousIds, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (autoScanCancelled) return false;
    const currentIds = extractor.getCurrentJobIds();
    for (const id of currentIds) {
      if (!previousIds.has(id)) return true;
    }
    await sleep(250);
  }
  return false;
}

async function reportAutoScanProgress(progress) {
  try {
    await chrome.runtime.sendMessage({ type: 'AUTO_SCAN_PROGRESS', ...progress });
  } catch (err) {
    // Panel may have closed.
  }
}

async function extractAllPages(extractor, maxPages = 10) {
  const allJobs = [];
  const seenUrls = new Set();
  let pageNum = 1;
  let pagesScanned = 0;

  while (pageNum <= maxPages && !autoScanCancelled) {
    if (!(await waitForCards(extractor, 5000))) break;

    const jobs = extractor.extractListing();
    let newOnThisPage = 0;
    for (const job of jobs) {
      if (!seenUrls.has(job.job_url)) {
        seenUrls.add(job.job_url);
        allJobs.push(job);
        newOnThisPage++;
      }
    }
    pagesScanned++;

    await reportAutoScanProgress({
      page: pageNum,
      maxPages,
      newOnThisPage,
      total: allJobs.length,
      done: false,
    });

    if ((pageNum > 1 && newOnThisPage === 0) || pageNum >= maxPages) break;

    const nextButton = extractor.findNextButton();
    if (!nextButton) break;

    const previousUrl = location.href;
    const previousIds = extractor.getCurrentJobIds();
    nextButton.click();

    const urlChanged = await waitForUrlChange(previousUrl, 10000);
    if (urlChanged !== true) break;
    if (!(await waitForNewJobIds(extractor, previousIds, 10000))) break;

    await sleep(800);
    await sleep(1500 + Math.random() * 1500);
    pageNum++;
  }

  await reportAutoScanProgress({
    page: pagesScanned,
    maxPages,
    newOnThisPage: 0,
    total: allJobs.length,
    done: true,
    cancelled: autoScanCancelled,
  });

  return allJobs;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const extractor = getActiveExtractor();

  if (msg.type === 'PING') {
    if (!extractor) {
      sendResponse({ status: 'pong', site: null, pageType: 'unknown', url: location.href });
      return true;
    }
    sendResponse({
      status: 'pong',
      site: extractor.name,
      pageType: extractor.detectPageType(),
      url: location.href,
    });
    return true;
  }

  if (msg.type === 'CAPTURE_FILTERS') {
    try {
      const filterApi = window.JobCaptureFilters;
      const captured = filterApi ? filterApi.captureFromUrl(location.href) : {};
      const baseUrl = filterApi ? filterApi.getBaseUrl(location.href) : location.href;
      sendResponse({ status: 'ok', filters: captured, baseUrl });
    } catch (err) {
      sendResponse({ status: 'error', message: err.message, filters: {} });
    }
    return true;
  }

  if (msg.type === 'APPLY_FILTERS') {
    try {
      const filterApi = window.JobCaptureFilters;
      const newUrl = filterApi
        ? filterApi.buildUrl(msg.baseUrl || location.href, msg.filters || {})
        : location.href;
      sendResponse({ status: 'ok', url: newUrl });
    } catch (err) {
      sendResponse({ status: 'error', message: err.message });
    }
    return true;
  }

  if (msg.type === 'EXTRACT_LISTING') {
    if (!extractor) {
      sendResponse({ status: 'unsupported', message: 'No extractor for this site', jobs: [] });
      return true;
    }
    try {
      const jobs = extractor.extractListing();
      sendResponse({ status: 'ok', jobs });
    } catch (err) {
      sendResponse({ status: 'error', message: err.message, jobs: [] });
    }
    return true;
  }

  if (msg.type === 'EXTRACT_JD') {
    if (!extractor || typeof extractor.extractDetail !== 'function') {
      sendResponse({ status: 'unsupported', message: 'Detail extraction not supported', data: null });
      return true;
    }
    try {
      const data = extractor.extractDetail();
      if (!data?.jd_full || data.jd_full.length <= 50) {
        sendResponse({ status: 'not-ready', message: 'JD content not rendered yet', data });
        return true;
      }
      sendResponse({ status: 'ok', data });
    } catch (err) {
      sendResponse({ status: 'error', message: err.message, data: null });
    }
    return true;
  }

  if (msg.type === 'AUTO_SCAN_ALL') {
    if (!extractor) {
      sendResponse({ status: 'unsupported', message: 'No extractor for this site', jobs: [] });
      return true;
    }
    autoScanCancelled = false;
    const requested = Number.parseInt(msg.maxPages, 10) || 10;
    const maxPages = Math.min(50, Math.max(1, requested));

    extractAllPages(extractor, maxPages)
      .then((jobs) => {
        sendResponse({
          status: 'ok',
          jobs,
          count: jobs.length,
          cancelled: autoScanCancelled,
        });
      })
      .catch((err) => {
        sendResponse({ status: 'error', message: err.message, jobs: [] });
      });
    return true;
  }

  if (msg.type === 'CANCEL_AUTO_SCAN') {
    autoScanCancelled = true;
    sendResponse({ status: 'ok' });
    return true;
  }
});

const _ext = getActiveExtractor();

if (/^https?:\/\/(localhost|127\.0\.0\.1):5173\//.test(location.href)) {
  syncJobstackJwtFromPage();
  window.addEventListener('storage', (event) => {
    if (event.key === 'token') syncJobstackJwtFromPage();
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.type !== 'JOBSTACK_CMD' || !JOBSTACK_COMMANDS.has(data.action)) return;

    const requestId = typeof data.requestId === 'string'
      ? data.requestId
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    chrome.runtime.sendMessage({
      type: 'JOBSTACK_CMD',
      action: data.action,
      payload: data.payload,
      requestId,
    }).then((response) => {
      window.postMessage({
        ...(response || { status: 'ok' }),
        type: 'JOBSTACK_CMD_RESULT',
        action: data.action,
        requestId,
      }, event.origin);
    }).catch(() => {
      window.postMessage({
        type: 'JOBSTACK_CMD_RESULT',
        action: data.action,
        requestId,
        status: 'extension-unavailable',
      }, event.origin);
    });
  });
}

console.log(
  '[Job Capture] Content script loaded:',
  _ext ? _ext.name : 'no extractor',
  _ext ? _ext.detectPageType() : '',
  '| Registered:',
  Object.keys(window.JobCaptureExtractors || {})
);
