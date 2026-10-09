// ============================================================
// Naukri Extractor
// ============================================================
(function () {
  const NAUKRI_HOST = 'naukri.com';

  function matches() {
    return location.hostname.replace('www.', '').includes(NAUKRI_HOST);
  }

  function detectPageType() {
    if (document.querySelector('.srp-jobtuple-wrapper, [data-job-id]')) return 'listing';
    if (document.querySelector('#listContainer')) return 'listing';
    if (document.querySelector('.jd-header-title') ||
        location.pathname.includes('/job-listings-')) return 'detail';
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

  function splitJdSections(jdText) {
    const empty = { description: '', required: '', preferred: '' };
    if (!jdText || !jdText.trim()) return empty;

    const lower = jdText.toLowerCase();
    const requiredMarkers = [
      'required skills and experience',
      'required skills:',
      'required skills',
      'required qualifications:',
      'desired skills:',
      'must have skills:',
      'must have:',
      'must-have:',
      'key skills required:',
    ];
    const preferredMarkers = [
      'preferred qualifications:',
      'preferred qualifications',
      'preferred skills:',
      'preferred skills',
      'good to have:',
      'good-to-have:',
      'nice to have:',
      'nice-to-have:',
      'bonus points:',
      'added advantage:',
    ];

    const findEarliest = (markers) => {
      let bestIdx = -1;
      let bestMarker = '';
      for (const marker of markers) {
        const idx = lower.indexOf(marker);
        if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) {
          bestIdx = idx;
          bestMarker = marker;
        }
      }
      return { idx: bestIdx, marker: bestMarker };
    };

    const req = findEarliest(requiredMarkers);
    const pref = findEarliest(preferredMarkers);
    let description = '';
    let required = '';
    let preferred = '';

    if (req.idx >= 0 && pref.idx >= 0) {
      if (req.idx < pref.idx) {
        description = jdText.slice(0, req.idx).trim();
        required = jdText.slice(req.idx, pref.idx).trim();
        preferred = jdText.slice(pref.idx).trim();
      } else {
        description = jdText.slice(0, pref.idx).trim();
        preferred = jdText.slice(pref.idx, req.idx).trim();
        required = jdText.slice(req.idx).trim();
      }
    } else if (req.idx >= 0) {
      description = jdText.slice(0, req.idx).trim();
      required = jdText.slice(req.idx).trim();
    } else if (pref.idx >= 0) {
      description = jdText.slice(0, pref.idx).trim();
      preferred = jdText.slice(pref.idx).trim();
    } else {
      description = jdText.trim();
    }

    return { description, required, preferred };
  }

  function hasListingCards() {
    return !!document.querySelector('.srp-jobtuple-wrapper, [data-job-id]');
  }

  function extractListing() {
    const jobs = [];
    let cards = document.querySelectorAll('#listContainer .srp-jobtuple-wrapper');
    if (cards.length === 0) cards = document.querySelectorAll('.srp-jobtuple-wrapper');
    if (cards.length === 0) cards = document.querySelectorAll('[data-job-id]');

    cards.forEach((card) => {
      const titleEl = card.querySelector('.row1 .title');
      if (!titleEl) return;
      const href = titleEl.getAttribute('href');
      if (!href) return;

      const companyEl = card.querySelector('.row2 .comp-name');
      const postedByEl = card.querySelector('.row2 .client-company-name a');
      const expEl = card.querySelector('.row3 .expwdth');
      const salEl = card.querySelector('.row3 .sal');
      const locEl = card.querySelector('.row3 .locWdth');
      const descEl = card.querySelector('.row4 .job-desc');
      const tagEls = card.querySelectorAll('.row5 .tags-gt .tag-li');
      const postedEl = card.querySelector('.row6 .job-post-day');

      const skills = Array.from(tagEls)
        .map((el) => (el.innerText || '').trim())
        .filter(Boolean);

      jobs.push({
        source: 'naukri',
        job_id: card.getAttribute('data-job-id') || '',
        title: titleEl.getAttribute('title') || text(titleEl),
        company: companyEl ? (companyEl.getAttribute('title') || text(companyEl)) : '',
        posted_by: postedByEl ? (postedByEl.getAttribute('title') || text(postedByEl)) : '',
        location: locEl ? (locEl.getAttribute('title') || text(locEl)) : '',
        experience: expEl ? (expEl.getAttribute('title') || text(expEl)) : '',
        salary: salEl ? (salEl.getAttribute('title') || text(salEl)) : '',
        skills,
        description_snippet: text(descEl),
        posted: text(postedEl),
        job_url: absoluteUrl(href),
        captured_at: new Date().toISOString(),
        captured_from: 'listing_page',
      });
    });

    return jobs;
  }

  function extractDetail() {
    const q = (selector, root = document) => root.querySelector(selector);
    const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const readText = (element) => (element?.innerText || element?.textContent || '').trim();

    const titleEl = q('#job_header h1') || q('[class*="jd-header-title"]');
    const companyEl = q('[class*="jd-header-comp-name"] a');
    const experienceEl = q('[class*="jhc__exp__"] span') || q('[class*="jhc__exp"] span');
    const salaryEl = q('[class*="jhc__salary__"] span') || q('[class*="jhc__salary"] span');
    const locationEl = q('[class*="jhc__location__"]') || q('[class*="jhc__location"]');
    const locationLinks = locationEl ? qa('a', locationEl).map(readText).filter(Boolean) : [];

    const findStatByLabel = (labelText) => {
      for (const stat of qa('[class*="jhc__stat__"], [class*="jhc__stat"]')) {
        const label = q('label', stat);
        if (!label) continue;
        const labelValue = readText(label).replace(/:\s*$/, '');
        if (labelValue.toLowerCase() !== labelText.toLowerCase()) continue;
        return readText(stat).replace(readText(label), '').trim();
      }
      return '';
    };

    const detailRoots = [
      q('[class*="other-details"]'),
      q('[class*="education"]'),
    ].filter(Boolean);
    const findDetailByLabel = (labelText) => {
      for (const root of detailRoots) {
        for (const label of qa('label', root)) {
          if (readText(label).replace(/:\s*$/, '').toLowerCase() !== labelText.toLowerCase()) continue;
          const sibling = label.nextElementSibling;
          if (sibling) return readText(sibling);
          const parent = label.parentElement;
          if (parent) {
            const value = Array.from(parent.children).find((child) => child !== label);
            if (value) return readText(value);
          }
        }
      }
      return '';
    };

    const jdEl = q('[class*="JDC__dang-inner-html"]');
    const jdText = readText(jdEl);
    const sections = splitJdSections(jdText);
    const aboutEl = q('[class*="about-company"] [class*="dang-inner-html"]') || q('[class*="about-company"] [class*="detail__"]') || q('[class*="about-company"]');
    const pathMatch = location.pathname.match(/(\d+)\/?$/);

    return {
      job_id: pathMatch ? pathMatch[1] : '',
      title: readText(titleEl),
      company: readText(companyEl),
      experience: readText(experienceEl),
      salary: readText(salaryEl),
      location: locationLinks.length ? locationLinks.join(', ') : readText(locationEl),
      posted: findStatByLabel('Posted'),
      openings: findStatByLabel('Openings'),
      applicants: findStatByLabel('Applicants'),
      jd_full: jdText,
      jd_description: sections.description,
      jd_required_skills: sections.required,
      jd_preferred_qualifications: sections.preferred,
      highlights: qa('[class*="job-highlight-list"] li').map(readText).filter(Boolean),
      key_skills_all: qa('[class*="key-skill"] [class*="chip"] span').map(readText).filter(Boolean),
      role: findDetailByLabel('Role'),
      industry: findDetailByLabel('Industry Type'),
      department: findDetailByLabel('Department'),
      role_category: findDetailByLabel('Role Category'),
      employment_type: findDetailByLabel('Employment Type'),
      education_ug: findDetailByLabel('UG'),
      education_pg: findDetailByLabel('PG'),
      company_description: readText(aboutEl),
      extracted_at: new Date().toISOString(),
    };
  }

  function findNextButton() {
    for (const link of document.querySelectorAll('a')) {
      if ((link.innerText || '').trim() === 'Next' &&
          !link.hasAttribute('disabled') &&
          link.getAttribute('href')) {
        return link;
      }
    }
    return null;
  }

  function getCurrentJobIds() {
    return new Set(
      Array.from(document.querySelectorAll('.srp-jobtuple-wrapper, [data-job-id]'))
        .map((card) => card.getAttribute('data-job-id'))
        .filter(Boolean)
    );
  }

  window.JobCaptureExtractors = window.JobCaptureExtractors || {};
  window.JobCaptureExtractors.naukri = {
    name: 'naukri',
    matches,
    detectPageType,
    extractListing,
    extractDetail,
    findNextButton,
    getCurrentJobIds,
    hasListingCards,
  };
})();
