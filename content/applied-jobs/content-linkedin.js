// content-linkedin.js – supports manual extraction + background multi‑stage
// Unified format: appliedDateRaw, statusRaw
// Pagination using LinkedIn's "Next" button (data-testid selector)
console.log('✅ LinkedIn content script loaded at', location.href);

function getStage() {
  return new URLSearchParams(location.search).get('stage') || 'unknown';
}

// Extract jobs from current page (no pagination, just current DOM)
function extractJobsFromCurrentPage() {
  const jobs = [];
  const stage = getStage();
  const jobLinks = document.querySelectorAll('a[href*="/jobs/view/"]');
  console.log(`Found ${jobLinks.length} job links on current page`);

  for (const link of jobLinks) {
    const jobUrl = link.href;
    const jobIdMatch = jobUrl.match(/\/jobs\/view\/(\d+)/);
    const jobId = jobIdMatch ? jobIdMatch[1] : '';
    
    // --- Robust card selection ---
    let card = null;
    // Try known selectors first
    card = link.closest('[data-entity-urn*="jobPosting"]') ||
           link.closest('div[class*="application-card"]') ||
           link.closest('div[class*="jobs-s-application-card"]');
    
    // If still null, climb up max 10 levels and find a div that contains both title and company
    if (!card) {
      let el = link.parentElement;
      let levels = 0;
      while (el && levels < 10) {
        // Check if this element has a <p> with title and another with company (approx)
        const hasTitle = el.querySelector('p:first-of-type')?.innerText?.trim();
        const hasCompany = el.querySelectorAll('p').length > 1;
        if (hasTitle && hasCompany) {
          card = el;
          break;
        }
        el = el.parentElement;
        levels++;
      }
    }
    // Final fallback: just use the link's parent three levels up (original)
    if (!card) {
      card = link.parentElement?.parentElement?.parentElement;
    }
    
    if (!card) continue; // skip if no card found

    // --- Extract title & company (keep your existing logic) ---
    const titleEl = link.querySelector('p:first-of-type');
    const title = titleEl ? titleEl.innerText.trim() : '';
    const paras = link.querySelectorAll('p');
    let company = '', location = '';
    if (paras.length > 1) {
      const text = paras[1].innerText.trim();
      const parts = text.split('·').map(s => s.trim());
      company = parts[0] || '';
      location = parts[1] || '';
    }

    // --- Extract applied date (ONLY from first <p> that starts with "Applied") ---
    let appliedDateRaw = '';
    // Search only inside the card
    const pElements = card.querySelectorAll('p');
    for (const elem of pElements) {
      const text = elem.innerText?.trim() || '';
      if (text.startsWith('Applied')) {
        // Extract exactly "Applied X ago" (handles "d", "w", "h", "m", "s")
        const match = text.match(/Applied\s+\d+(?:mo|[dwhmy])\s*ago/i);
        if (match) {
          appliedDateRaw = match[0];
          break;
        }
      }
    }
    // Fallback: if still empty, scan the entire card's text
    if (!appliedDateRaw) {
      const match = card.innerText.match(/Applied\s+[\d]+[dwhms]?\s*ago/i);
      if (match) appliedDateRaw = match[0];
    }

    if (title && company) {
      jobs.push({
        jobId,
        title,
        company,
        location: location || '',
        appliedDateRaw,
        statusRaw: stage,
        jobUrl,
        source: 'linkedin',
        extractedAt: new Date().toISOString()
      });
    }
  }
  console.log(`Extracted ${jobs.length} jobs from current page (stage ${stage})`);
  return jobs;
}

// Wait for a selector to appear
function waitForSelector(selector, maxWait = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = setInterval(() => {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        clearInterval(check);
        resolve(elements);
      } else if (Date.now() - start > maxWait) {
        clearInterval(check);
        resolve([]);
      }
    }, 300);
  });
}

// Click "Next" button and wait for new content
async function clickNextAndWait() {
  // Use the exact data-testid attribute from LinkedIn's pagination
  const nextButton = document.querySelector('[data-testid="pagination-controls-next-button-visible"]');
  if (!nextButton || nextButton.disabled) {
    console.log('Next button not found or disabled');
    return false;
  }

  console.log('Clicking Next button...');
  nextButton.click();

  // Wait for new job cards to appear (compare count before and after)
  const getJobLinkCount = () => document.querySelectorAll('a[href*="/jobs/view/"]').length;
  const initialCount = getJobLinkCount();

  // Wait up to 10 seconds for the count to change
  let attempts = 0;
  const maxAttempts = 20; // 20 * 500ms = 10 seconds
  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 500));
    const newCount = getJobLinkCount();
    if (newCount !== initialCount) {
      console.log(`Page changed: job links from ${initialCount} to ${newCount}`);
      // Extra delay for DOM to fully settle
      await new Promise(r => setTimeout(r, 1000));
      return true;
    }
    attempts++;
  }

  console.warn('Timeout waiting for new content after clicking Next');
  return true; // assume page changed
}

// Main extraction function with pagination
async function extractJobsFromPage() {
  const allJobs = [];
  let page = 1;
  const maxPages = 50;

  // Wait for initial job cards
  await waitForSelector('a[href*="/jobs/view/"]', 10000);

  // First page
  let pageJobs = extractJobsFromCurrentPage();
  allJobs.push(...pageJobs);
  console.log(`Page ${page}: ${pageJobs.length} jobs`);

  // Continue while Next button exists
  while (page < maxPages) {
    const hasNext = await clickNextAndWait();
    if (!hasNext) break;
    page++;
    pageJobs = extractJobsFromCurrentPage();
    if (pageJobs.length === 0) {
      console.warn(`Page ${page} has 0 jobs – stopping`);
      break;
    }
    allJobs.push(...pageJobs);
    console.log(`Page ${page}: ${pageJobs.length} jobs (total ${allJobs.length})`);
  }

  console.log(`Total extracted across ${page} pages: ${allJobs.length} jobs`);

  // Deduplicate by jobId (keep first occurrence)
  const uniqueMap = new Map();
  for (const job of allJobs) {
    if (!uniqueMap.has(job.jobId)) {
      uniqueMap.set(job.jobId, job);
    }
  }
  const uniqueJobs = Array.from(uniqueMap.values());
  console.log(`After dedupe: ${uniqueJobs.length} unique jobs`);
  return uniqueJobs;
}

// Message handlers
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractLinkedInJobsFromPage') {
    extractJobsFromPage().then(jobs => sendResponse({ success: true, jobs }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.action === 'ping') {
    sendResponse({ status: 'alive', url: location.href });
    return true;
  }
  if (request.action === 'extractLinkedInJobs') {
    extractJobsFromPage().then(jobs => sendResponse({ success: true, data: jobs, stage: getStage() }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  return false;
});

// Auto‑trigger background multi‑stage extraction
const urlParams = new URLSearchParams(location.search);
if (window.location.href.includes('/jobs-tracker') && !urlParams.has('_ext')) {
  console.log('User‑initiated LinkedIn page – starting background extraction');
  chrome.runtime.sendMessage({ action: 'autoExtractAllLinkedInStages' });
}