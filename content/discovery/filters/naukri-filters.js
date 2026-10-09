// ============================================================
// Naukri Filter Schema + URL Builder + URL Capture
// ============================================================
(function () {
  const FILTER_SCHEMA = {
    k: {
      label: 'Keyword',
      type: 'text',
      placeholder: 'e.g. fullstack developer, mern stack',
    },
    l: {
      label: 'Location (text)',
      type: 'text',
      placeholder: 'e.g. hyderabad, bengaluru',
    },
    wfhType: {
      label: 'Work Mode',
      type: 'multi',
      options: [
        { value: '0', label: 'Work from office' },
        { value: '2', label: 'Remote' },
        { value: '3', label: 'Hybrid' },
      ],
    },
    ctcFilter: {
      label: 'Salary',
      type: 'multi',
      options: [
        { value: '0to3', label: '0-3 Lakhs' },
        { value: '3to6', label: '3-6 Lakhs' },
        { value: '6to10', label: '6-10 Lakhs' },
        { value: '10to15', label: '10-15 Lakhs' },
        { value: '15to25', label: '15-25 Lakhs' },
        { value: '25to50', label: '25-50 Lakhs' },
      ],
    },
    jobAge: {
      label: 'Date Posted / Freshness',
      type: 'single',
      options: [
        { value: '1', label: 'Last 1 day' },
        { value: '3', label: 'Last 3 days' },
        { value: '7', label: 'Last 7 days' },
        { value: '15', label: 'Last 15 days' },
        { value: '30', label: 'Last 30 days' },
      ],
    },
    experience: {
      label: 'Experience',
      type: 'number',
      min: 0,
      max: 30,
    },
    jobPostType: {
      label: 'Posted By',
      type: 'multi',
      options: [
        { value: 'company', label: 'Company Jobs' },
        { value: 'consultant', label: 'Consultant Jobs' },
      ],
    },
    cityTypeGid: {
      label: 'Location (ID)',
      type: 'multi',
      custom: true,
      hint: 'e.g. 17 = Hyderabad, 97 = Bengaluru',
    },
    functionAreaIdGid: {
      label: 'Department (ID)',
      type: 'multi',
      custom: true,
      hint: 'e.g. 5 = Engineering - Software & QA',
    },
    qbusinessSize: {
      label: 'Company Type (ID)',
      type: 'multi',
      custom: true,
      hint: 'e.g. 211',
    },
    ugTypeGid: {
      label: 'Education (ID)',
      type: 'multi',
      custom: true,
      hint: 'e.g. 12 = B.Tech / B.E.',
    },
    glbl_qcrc: {
      label: 'Role Category (ID)',
      type: 'multi',
      custom: true,
      hint: 'e.g. 1028 = Software Development',
    },
    industryTypeGid: {
      label: 'Industry (ID)',
      type: 'multi',
      custom: true,
    },
    topGroupId: {
      label: 'Top Companies (ID)',
      type: 'multi',
      custom: true,
    },
  };

  const FILTER_KEYS = Object.keys(FILTER_SCHEMA);

  function buildUrl(baseUrl, filters) {
    let url;
    try {
      url = new URL(baseUrl, location.origin);
    } catch (e) {
      return baseUrl;
    }

    FILTER_KEYS.forEach((key) => url.searchParams.delete(key));

    for (const [key, value] of Object.entries(filters || {})) {
      if (value == null || value === '') continue;
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item != null && item !== '') url.searchParams.append(key, item);
        });
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  function captureFromUrl(urlStr) {
    let url;
    try {
      url = new URL(urlStr || location.href);
    } catch (e) {
      return {};
    }

    const captured = {};
    for (const key of FILTER_KEYS) {
      const values = url.searchParams.getAll(key);
      if (values.length === 1) captured[key] = values[0];
      else if (values.length > 1) captured[key] = values;
    }
    return captured;
  }

  function getBaseUrl(urlStr) {
    let url;
    try {
      url = new URL(urlStr || location.href);
    } catch (e) {
      return urlStr;
    }

    FILTER_KEYS.forEach((key) => url.searchParams.delete(key));
    return url.toString();
  }

  window.JobCaptureFilters = window.JobCaptureFilters || {
    schema: FILTER_SCHEMA,
    filterKeys: FILTER_KEYS,
    buildUrl,
    captureFromUrl,
    getBaseUrl,
  };
})();
