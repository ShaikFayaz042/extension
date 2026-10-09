// content-naukri.js – lightweight: just asks background to fetch
// Background uses unified format (appliedDateRaw, statusRaw)
console.log('✅ Naukri content script loaded');

// Listen for popup requests
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'ping') {
    sendResponse({ status: 'alive', url: location.href });
    return true;
  }
  if (req.action === 'getNaukriJobs') {
    chrome.storage.local.get(['naukriJobs'], (res) => {
      sendResponse({ success: true, jobs: res.naukriJobs || [] });
    });
    return true;
  }
  if (req.action === 'fetchNaukriJobs') {
    // Manual trigger from popup – re‑fetch and auto‑send
    chrome.runtime.sendMessage({ action: 'fetchNaukriJobsFromBackground' }, (response) => {
      if (response?.success) {
        sendResponse({ success: true, jobs: response.jobs });
      } else {
        sendResponse({ success: false, error: response?.error });
      }
    });
    return true;
  }
  return false;
});

// optional auto-capture on page load
(async function autoCapture() {
  if (window.location.href.includes('/myapply/historypage')) {
    console.log('🔄 Auto-capturing Naukri jobs...');
    const response = await chrome.runtime.sendMessage({ action: 'fetchNaukriJobsFromBackground' });
    if (response?.success) {
      console.log(`✅ Auto-captured ${response.jobs.length} jobs (auto-sent to backend)`);
      chrome.runtime.sendMessage({ action: 'naukriDataUpdated', jobs: response.jobs });
    } else {
      console.error('Auto-capture failed:', response?.error);
    }
  }
})();