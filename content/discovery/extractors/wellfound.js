// ============================================================
// Wellfound Extractor
// ============================================================
(function () {
  const HOST = 'wellfound.com';

  function matches() {
    return location.hostname.replace('www.', '').includes(HOST);
  }

  function detectPageType() {
    if (document.querySelector('a[href*="/jobs/"]')) return 'listing';
    if (location.pathname.startsWith('/jobs/')) return 'detail';
    return 'unknown';
  }

  function text(el, attr = null) {
    if (!el) return '';
    if (attr) return (el.getAttribute(attr) || '').trim();
    return (el.innerText || '').trim();
  }

  function absoluteUrl(href) {
    if (!href) return '';
    try { return new URL(href, location.origin).href; } catch { return href; }
  }

  function hasListingCards() {
    return !!document.querySelector('a[href*="/jobs/"]');
  }

  function extractListing() {
    const jobs = [];
    const seen = new Set();

    const links = document.querySelectorAll('a[href*="/jobs/"]');
    links.forEach((link) => {
      const href = link.getAttribute('href');
      if (!href || !href.match(/\/jobs\/\d+/)) return;

      const jobUrl = absoluteUrl(href);
      if (seen.has(jobUrl)) return;
      seen.add(jobUrl);

      const card = link.closest('div[class*="styles_"]') || link.parentElement;
      const title = text(link) || text(card?.querySelector('h3, h2, [class*="title"]'));

      if (!title) return;

      jobs.push({
        source: 'wellfound',
        job_id: href.match(/\/jobs\/(\d+)/)?.[1] || '',
        title,
        company: '',
        posted_by: '',
        location: '',
        experience: '',
        salary: '',
        skills: [],
        description_snippet: '',
        posted: '',
        job_url: jobUrl,
        captured_at: new Date().toISOString(),
        captured_from: 'listing_page',
      });
    });

    return jobs;
  }

  function findNextButton() {
    for (const link of document.querySelectorAll('a, button')) {
      const txt = (link.innerText || '').trim().toLowerCase();
      if (txt === 'next' || txt === 'next page') return link;
    }
    return null;
  }

  function getCurrentJobIds() {
    const ids = new Set();
    document.querySelectorAll('a[href*="/jobs/"]').forEach((link) => {
      const m = (link.getAttribute('href') || '').match(/\/jobs\/(\d+)/);
      if (m) ids.add(m[1]);
    });
    return ids;
  }

  window.JobCaptureExtractors = window.JobCaptureExtractors || {};
  window.JobCaptureExtractors.wellfound = {
    name: 'wellfound',
    matches,
    detectPageType,
    extractListing,
    findNextButton,
    getCurrentJobIds,
    hasListingCards,
  };
})();
