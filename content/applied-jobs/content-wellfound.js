// content-wellfound.js – extract jobs from Wellfound DOM (based on actual structure)
// Unified format: appliedDateRaw, statusRaw
console.log('✅ Wellfound content script loaded');

function extractJobsFromDOM() {
  const jobs = [];
  // Select all job application links
  const jobCards = document.querySelectorAll('a[href*="/jobs/applications/"]');
  console.log(`Found ${jobCards.length} job application cards`);

  jobCards.forEach(card => {
    // Company name
    const companyEl = card.querySelector('h3.styles_startupName__Ukhxe');
    const company = companyEl?.innerText?.trim() || '';

    // Job title – locate the span with text-md and text-gray-800 (first after company)
    const titleEl = card.querySelector('span.text-md.text-gray-800');
    const title = titleEl?.innerText?.trim() || '';

    // Status – within the flex row, the span with text-sm font-semibold
    const statusEl = card.querySelector('div.flex.flex-row.items-center span.text-sm.font-semibold.text-gray-800');
    const statusRaw = statusEl?.innerText?.trim() || 'Pending';

    // Date – span with class styles_date__VSPWb
    const dateEl = card.querySelector('span.styles_date__VSPWb');
    let appliedDateRaw = dateEl?.innerText?.trim() || '';

    // Job URL and ID
    const jobUrl = card.href;
    const jobIdMatch = jobUrl.match(/\/jobs\/applications\/(\d+)-(\d+)/);
    const jobId = jobIdMatch ? jobIdMatch[1] : '';

    if (title && company) {
      jobs.push({
        jobId: jobId,
        title: title,
        company: company,
        location: '',
        appliedDateRaw: appliedDateRaw || new Date().toISOString(),
        statusRaw: statusRaw,
        jobUrl: jobUrl,
        source: 'wellfound',
        extractedAt: new Date().toISOString()
      });
    }
  });

  console.log(`Extracted ${jobs.length} jobs`);
  return jobs;
}

// Function to wait for elements to appear (simple retry)
async function waitForCards(maxWaitMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const cards = document.querySelectorAll('a[href*="/jobs/applications/"]');
    if (cards.length > 0) return cards;
    await new Promise(r => setTimeout(r, 500));
  }
  return [];
}

// Main capture function
async function captureAndStore() {
  const cards = await waitForCards(5000);
  if (cards.length === 0) {
    console.warn('No job cards found after waiting.');
    return;
  }

  const jobs = extractJobsFromDOM();
  console.log(`📦 Captured ${jobs.length} Wellfound jobs from DOM`);

  if (jobs.length > 0) {
    await chrome.storage.local.set({
      wellfoundJobs: jobs,
      lastExtractedType: 'wellfound',
      lastExtractedAt: new Date().toISOString()
    });
    console.log(`✅ Stored ${jobs.length} Wellfound jobs`);

    // 🔁 AUTO-SEND to backend via background
    chrome.runtime.sendMessage({ action: 'sendWellfoundToBackend', jobs }, (response) => {
      if (!response?.success) {
        console.error('Wellfound backend send failed:', response?.error || 'Unknown error');
      } else {
        console.log('Wellfound backend send succeeded');
      }
    });
  } else {
    console.warn('No jobs extracted – check selectors.');
  }
  return jobs;
}

// Listen for popup messages
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'ping') {
    sendResponse({ status: 'alive', url: location.href });
    return true;
  }
  if (req.action === 'reExtractWellfound') {
    captureAndStore().then(jobs => sendResponse({ success: true, jobs })).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  return false;
});

// Run extraction when page is fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', captureAndStore);
} else {
  captureAndStore();
}