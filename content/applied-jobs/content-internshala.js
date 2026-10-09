// content-internshala.js – trigger background fetch when on applications page
// Background uses unified format (appliedDateRaw, statusRaw)
console.log('✅ Internshala content script loaded');

(async function triggerFetch() {
  console.log('🔄 Internshala: Triggering background fetch...');
  const response = await chrome.runtime.sendMessage({ action: 'fetchInternshalaJobsFromBackground' });
  if (response?.success) {
    console.log(`✅ Internshala: ${response.jobs?.length || 0} jobs fetched and auto-sent`);
  } else {
    console.error('❌ Internshala fetch failed:', response?.error);
  }
})();

// Also listen for popup requests for stored jobs
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'getInternshalaJobs') {
    chrome.storage.local.get(['internshalaJobs'], (res) => {
      sendResponse({ success: true, jobs: res.internshalaJobs || [] });
    });
    return true;
  }
  return false;
});