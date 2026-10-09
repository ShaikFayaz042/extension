// content-autofill.js – FINAL with manual registration support
console.log('🚀 JobStacker Autofill Engine loaded.');

// ---------- GLOBAL PENDING JOB CACHE ----------
let cachedJobDetails = null; // in‑memory cache

function clickApplyCta() {
    const applyLabels = [
        /^apply$/i,
        /^apply now$/i,
        /^easy apply$/i,
        /^apply for (this )?(job|position)$/i,
        /^apply to (this )?(job|position)$/i,
        /^apply on (the )?(company|employer) (site|website)$/i,
        /^apply (externally|via external site)$/i,
        /^continue to (the )?application$/i,
    ];
    const appliedLabels = [
        /^already applied$/i,
        /^applied$/i,
        /^application submitted$/i,
        /^you have applied$/i,
    ];
    const roots = [document];
    for (let index = 0; index < roots.length; index += 1) {
        roots[index].querySelectorAll('*').forEach((element) => {
            if (element.shadowRoot) roots.push(element.shadowRoot);
        });
    }
    const prioritizedApplyButtons = roots.flatMap((root) =>
        Array.from(root.querySelectorAll('#job_header button#apply-button, button#apply-button.apply-button'))
    );
    const candidates = Array.from(new Set([
        ...prioritizedApplyButtons,
        ...roots.flatMap((root) => Array.from(root.querySelectorAll('button, a, [role="button"], input[type="button"]'))),
    ]));

    for (const element of candidates) {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) continue;

        const label = (element.innerText || element.value || element.getAttribute('aria-label') || element.title || '')
            .replace(/\s+/g, ' ')
            .trim();
        if (appliedLabels.some((pattern) => pattern.test(label))) {
            return { success: true, clicked: false, alreadyApplied: true, label };
        }

        const isNaukriApplyButton = location.hostname.endsWith('naukri.com') &&
            element.matches('#job_header button#apply-button, button#apply-button.apply-button');
        if (element.disabled || element.getAttribute('aria-disabled') === 'true') continue;
        if (element.closest('form') && !isNaukriApplyButton) continue;
        if (!applyLabels.some((pattern) => pattern.test(label))) continue;

        const linkedDestination = element.matches('a[href]')
            ? element.href
            : element.querySelector('a[href]')?.href || '';
        element.click();
        return { success: true, clicked: true, label, destinationUrl: linkedDestination };
    }

    return { success: true, clicked: false, reason: 'No supported Apply button found; form submission was not triggered.' };
}

// ---------- 1. REACT-PROOF NATIVE SETTER ----------
function setNativeValue(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (valueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
        valueSetter.call(element, value);
    } else {
        element.value = value;
    }
}

// ---------- 2. FRAMEWORK EVENT MATRIX ----------
function simulateHumanTyping(element, value) {
    element.focus();
    element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    if (element.isContentEditable) {
        element.textContent = value;
        element.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: value,
        }));
    } else {
        setNativeValue(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
    if (element.tagName === 'SELECT' || element.type === 'checkbox' || element.type === 'radio') {
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    }
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    element.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'a' }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    element.blur();
    element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
}

// ---------- 3. SHADOW DOM TRAVERSAL ----------
function getAllFields(root = document) {
    let elements = [
        ...root.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select, .chatbot_DrawerContentWrapper [contenteditable="true"]')
    ];
    root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
            elements = elements.concat(getAllFields(el.shadowRoot));
        }
    });
    return elements;
}

// ---------- 4. CONTEXT EXTRACTION ----------
function getTextContext(element, maxDepth = 4) {
    let context = '';

    let sibling = element.previousElementSibling;
    let depth = 0;
    while (sibling && depth < 3 && !context) {
        const text = sibling.innerText?.trim();
        if (text) context = text;
        sibling = sibling.previousElementSibling;
        depth++;
    }

    let parent = element.parentElement;
    let level = 0;
    while (parent && level < maxDepth && !context) {
        const hasHeading = parent.getAttribute('role') === 'heading';
        const parentText = parent.innerText?.trim();
        const inputValue = element.value || element.placeholder || '';
        if (parentText && parentText !== inputValue) {
            const lines = parentText.split('\n').map(s => s.trim()).filter(Boolean);
            if (lines.length > 0) {
                context = lines[0];
            } else {
                context = parentText;
            }
            if (hasHeading) {
                const headingText = parent.innerText?.trim();
                if (headingText) context = headingText;
            }
        }
        parent = parent.parentElement;
        level++;
    }

    if (!context) {
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
            const ids = labelledBy.split(/\s+/);
            for (const id of ids) {
                const labelEl = document.getElementById(id);
                if (labelEl) {
                    const text = labelEl.innerText?.trim();
                    if (text) {
                        context = text;
                        break;
                    }
                }
            }
        }
    }

    if (!context) {
        context = element.getAttribute('title') || element.getAttribute('aria-label') || '';
    }

    return context.replace(/\s+/g, ' ').slice(0, 200).trim();
}

function getFieldIdentifier(element) {
    let labelText = '';

    if (element.matches('.chatbot_DrawerContentWrapper [contenteditable="true"]')) {
        const wrapper = element.closest('.chatbot_DrawerContentWrapper');
        const prompts = Array.from(wrapper?.querySelectorAll('.chatbot_MessageContainer .botMsg') || [])
            .map((prompt) => prompt.innerText?.trim())
            .filter(Boolean);
        labelText = prompts.at(-1) || '';
    }

    if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label) labelText = label.innerText.trim();
    }

    if (!labelText && element.closest('label')) {
        labelText = element.closest('label').innerText.trim();
    }

    if (!labelText) {
        const ariaLabel = element.getAttribute('aria-label') || '';
        const ariaLabelledBy = element.getAttribute('aria-labelledby');
        let labelledByText = '';
        if (ariaLabelledBy) {
            const ids = ariaLabelledBy.split(/\s+/);
            for (const id of ids) {
                const labelEl = document.getElementById(id);
                if (labelEl) {
                    labelledByText = labelEl.innerText.trim();
                    if (labelledByText) break;
                }
            }
        }
        labelText = ariaLabel || labelledByText || '';
    }

    if (!labelText && !element.placeholder && !element.name && !element.id) {
        labelText = getTextContext(element);
    }

    if (labelText === 'Your answer' || !labelText) {
        const deeper = getTextContext(element);
        if (deeper && deeper !== 'Your answer') {
            labelText = deeper;
        }
    }

    labelText = labelText.replace(/[\n\r*]/g, '').trim();

    const semantics = {
        label: labelText,
        placeholder: element.placeholder || element.getAttribute('data-placeholder') || '',
        name: element.name || '',
        id: element.id || '',
        type: element.type || '',
        className: element.className || ''
    };

    if (!semantics.label && !semantics.placeholder && !semantics.name && !semantics.id) {
        semantics.fallback = element.type || 'unknown';
    }

    return semantics;
}

// ---------- 5. MATCHING ENGINE ----------
function matchFieldToProfile(identifier, profile) {
    const text = `${identifier.label} ${identifier.placeholder} ${identifier.name} ${identifier.id} ${identifier.fallback || ''}`.toLowerCase();

    const map = {
        'email|e-mail|mail': 'email',
        'first.*name|fname|given': 'firstName',
        'last.*name|lname|surname|family': 'lastName',
        'phone|tel|mobile|cell': (identifier.type !== 'select-one' && identifier.type !== 'select') ? 'phone' : null,
        '^\\+\\d{1,4}$': (identifier.type !== 'select-one' && identifier.type !== 'select') ? 'phone' : null,
        'address|street|line1': 'address',
        'city|town|location': 'address.city',
        'state|province|region': 'address.state',
        'zip|postal|post code|pin': 'address.zipCode',
        'country': 'address.country',
        'company|organization|employer': 'currentCompany',
        'title|position|job title': 'jobTitle',
        'school|university|college': 'school',
        'skill|competency': 'skills',
        'linkedin|linkedin.*url': 'professionalLinks.linkedin',
        'github|github.*url': 'professionalLinks.github',
        'portfolio|website|personal.*url': 'professionalLinks.portfolio',
        'gender|sex': 'gender',
        'expected salary|desired salary|expected ctc|compensation': 'expectedSalary',
        'current salary|present salary|current ctc': 'currentSalary',
        'start date|available date|joining date|earliest start|notice period|availability': 'availableStartDate',
        'preferred locations|preferred cities|locations': 'preferredLocations',
        'degree|course|qualification': 'educationDegree',
        'field of study|specialisation|branch|major': 'educationField',
        'university|college|school name': 'educationSchool',
        'education start date|start of course|date of joining.*education': 'educationStartDate',
        'education location': 'educationLocation',
        'company name|organization': 'experienceCompany',
        'job title|designation|role': 'experienceTitle',
        'experience start date|date of joining': 'experienceStartDate',
        'experience end date|date of relieving': 'experienceEndDate',
        'currently working': 'experienceCurrentlyWorking',
        'education|degree|qualification': 'educationSummary',
        'experience|work experience|professional experience|years of experience|total experience': 'yearsOfExperience',
        'certification|credential': 'certificationSummary',
        'projects|portfolio|work samples': 'projectSummary'
    };

    for (const [pattern, key] of Object.entries(map)) {
        if (key === null) continue;
        if (new RegExp(pattern, 'i').test(text)) {
            return key;
        }
    }

    // Full name fallback
    if (identifier.type === 'text' || identifier.type === 'textarea') {
        const cleanLabel = identifier.label.toLowerCase().replace(/[^a-z\s]/g, '');
        if (cleanLabel.includes('full name') || cleanLabel === 'name' || cleanLabel.includes('your name')) {
            if (!cleanLabel.includes('company') && !cleanLabel.includes('school') && !cleanLabel.includes('organization')) {
                return 'fullName';
            }
        }
        if (cleanLabel.includes('name') && !cleanLabel.includes('first') && !cleanLabel.includes('last')) {
            if (!cleanLabel.includes('company') && !cleanLabel.includes('school') && !cleanLabel.includes('organization')) {
                return 'fullName';
            }
        }
    }

    return null;
}

// ---------- 6. HELPERS ----------
function getHighestEducation(educations) {
    if (!Array.isArray(educations) || educations.length === 0) return null;
    const sorted = [...educations].sort((a, b) => {
        const aEnd = a.endDate ? new Date(a.endDate) : new Date(8640000000000000);
        const bEnd = b.endDate ? new Date(b.endDate) : new Date(8640000000000000);
        return bEnd - aEnd;
    });
    return sorted[0];
}

function getMostRecentExperience(workExperiences) {
    if (!Array.isArray(workExperiences) || workExperiences.length === 0) return null;
    const sorted = [...workExperiences].sort((a, b) => {
        const aStart = a.startDate ? new Date(a.startDate) : new Date(0);
        const bStart = b.startDate ? new Date(b.startDate) : new Date(0);
        return bStart - aStart;
    });
    return sorted[0];
}

function getEducationSummary(educations) {
    if (!Array.isArray(educations) || educations.length === 0) return '';
    const summary = educations.map(edu =>
        `${edu.degree || ''} from ${edu.school || ''}`.trim()
    ).filter(Boolean).join('; ');
    return summary || educations.map(edu => edu.school).join('; ');
}

function getExperienceSummary(workExperiences) {
    if (!Array.isArray(workExperiences) || workExperiences.length === 0) return '';
    const summary = workExperiences.map(exp =>
        `${exp.title || ''} at ${exp.company || ''}`.trim()
    ).filter(Boolean).join('; ');
    return summary || workExperiences.map(exp => exp.company).join('; ');
}

function getCertificationSummary(certifications) {
    if (!Array.isArray(certifications) || certifications.length === 0) return '';
    return certifications.join('; ');
}

function getProjectSummary(projects) {
    if (!Array.isArray(projects) || projects.length === 0) return '';
    return projects.map(p => p.name || '').filter(Boolean).join('; ');
}

function computeYearsOfExperience(workExperiences) {
    if (!Array.isArray(workExperiences) || workExperiences.length === 0) return 0;
    let totalMonths = 0;
    const now = new Date();
    for (const exp of workExperiences) {
        let start = exp.startDate ? new Date(exp.startDate) : null;
        let end = exp.current ? now : (exp.endDate ? new Date(exp.endDate) : null);
        if (start && end && end > start) {
            const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
            totalMonths += months;
        }
    }
    const years = totalMonths / 12;
    return Math.round(years * 10) / 10;
}

function parseDays(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    const numbers = text.match(/\d+/);
    if (!numbers) {
        if (lower.includes('immediate') || lower.includes('now') || lower.includes('asap')) return 0;
        if (lower.includes('week')) return 7;
        if (lower.includes('month')) return 30;
        return null;
    }
    const num = parseInt(numbers[0]);
    if (lower.includes('week')) return num * 7;
    if (lower.includes('month')) return num * 30;
    if (lower.includes('day')) return num;
    return num;
}

function formatAddress(addressObj) {
    if (!addressObj || typeof addressObj !== 'object') return addressObj;
    const parts = [];
    if (addressObj.street) parts.push(addressObj.street);
    if (addressObj.city) parts.push(addressObj.city);
    if (addressObj.state) parts.push(addressObj.state);
    if (addressObj.zipCode) parts.push(addressObj.zipCode);
    if (addressObj.country) parts.push(addressObj.country);
    return parts.join(', ');
}

function getNestedValue(obj, path) {
    if (!path) return null;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === undefined || current === null) return null;
        current = current[part];
    }
    return current;
}

// ---------- 7. VALUE RESOLUTION HELPER ----------
function getProfileValue(profile, matchedKey, field, identifier) {
    let value = null;
    const highestEdu = getHighestEducation(profile.educations);
    const recentExp = getMostRecentExperience(profile.workExperiences);
    const yearsOfExperience = computeYearsOfExperience(profile.workExperiences);

    switch (matchedKey) {
        case 'fullName':
            value = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
            break;
        case 'address':
            value = formatAddress(getNestedValue(profile, 'address'));
            break;
        case 'address.city':
            value = profile.address?.city || '';
            break;
        case 'address.state':
            value = profile.address?.state || '';
            break;
        case 'address.zipCode':
            value = profile.address?.postalCode || '';
            break;
        case 'address.country':
            value = profile.address?.country || '';
            break;
        case 'preferredLocations':
            value = Array.isArray(profile.preferredLocations) ? profile.preferredLocations.join(', ') : '';
            break;
        case 'currentSalary':
            value = profile.currentSalary || '';
            break;
        case 'educationDegree':
            value = highestEdu ? highestEdu.degree || '' : '';
            break;
        case 'educationField':
            value = highestEdu ? highestEdu.field || '' : '';
            break;
        case 'educationSchool':
            value = highestEdu ? highestEdu.school || '' : '';
            break;
        case 'educationStartDate':
            value = highestEdu && highestEdu.startDate ? new Date(highestEdu.startDate).toLocaleDateString() : '';
            break;
        case 'educationLocation':
            value = highestEdu && highestEdu.location ? highestEdu.location : '';
            break;
        case 'experienceCompany':
            value = recentExp ? recentExp.company || '' : '';
            break;
        case 'experienceTitle':
            value = recentExp ? recentExp.title || '' : '';
            break;
        case 'experienceStartDate':
            value = recentExp && recentExp.startDate ? new Date(recentExp.startDate).toLocaleDateString() : '';
            break;
        case 'experienceEndDate':
            value = recentExp && recentExp.endDate ? new Date(recentExp.endDate).toLocaleDateString() : '';
            break;
        case 'experienceCurrentlyWorking':
            value = recentExp && !recentExp.endDate ? 'Yes' : 'No';
            break;
        case 'availableStartDate':
            if (field && field.tagName === 'SELECT') {
                const userText = profile.availableStartDate || '';
                const options = Array.from(field.options);
                let found = false;
                for (const opt of options) {
                    if (opt.text.trim().toLowerCase() === userText.trim().toLowerCase()) {
                        value = opt.text.trim();
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    const days = parseDays(userText);
                    if (days !== null) {
                        for (const opt of options) {
                            const optDays = parseDays(opt.text);
                            if (optDays !== null && Math.abs(optDays - days) < 3) {
                                value = opt.text.trim();
                                found = true;
                                break;
                            }
                        }
                    }
                }
                if (!found) value = userText;
            } else {
                const days = parseDays(profile.availableStartDate);
                value = days !== null ? String(days) : profile.availableStartDate || '';
            }
            break;
        case 'gender':
            value = profile.gender || '';
            break;
        case 'expectedSalary':
            value = profile.expectedSalary || '';
            break;
        case 'currentCompany':
            value = profile.currentCompany || '';
            break;
        case 'jobTitle':
            value = profile.jobTitle || '';
            break;
        case 'school':
            value = highestEdu ? highestEdu.school || '' : '';
            break;
        case 'skills':
            value = Array.isArray(profile.skills) ? profile.skills.join(', ') : '';
            break;
        case 'email':
            value = profile.email || '';
            break;
        case 'firstName':
            value = profile.firstName || '';
            break;
        case 'lastName':
            value = profile.lastName || '';
            break;
        case 'educationSummary':
            value = getEducationSummary(profile.educations);
            break;
        case 'experienceSummary':
            value = getExperienceSummary(profile.workExperiences);
            break;
        case 'certificationSummary':
            value = getCertificationSummary(profile.certifications);
            break;
        case 'projectSummary':
            value = getProjectSummary(profile.projects);
            break;
        case 'yearsOfExperience':
            value = yearsOfExperience;
            break;
        default:
            if (matchedKey.includes('.')) {
                value = getNestedValue(profile, matchedKey);
            } else {
                value = profile[matchedKey];
            }
            break;
    }
    return value;
}

// ---------- 8. JOB DETAILS SCRAPER ----------
function extractJobDetailsFromExternalPage() {
    let company = '';
    let jobTitle = '';
    let location = '';

    const metaTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    const metaSiteName = document.querySelector('meta[property="og:site_name"]')?.content || '';
    const metaDescription = document.querySelector('meta[name="description"]')?.content || '';

    const titleElement = document.querySelector(
        '.posting-title h1, .app-title, .job-title, ' +
        '[data-automation-id="jobTitle"], [itemprop="title"], ' +
        'h1[data-qa="job-title"], .position-title, .page-title'
    );
    const companyElement = document.querySelector(
        '.posting-title .company-name, .company-name, .organization-name, ' +
        '[itemprop="hiringOrganization"], [data-automation-id="companyName"], ' +
        '.employer-name, .company'
    );
    const locationElement = document.querySelector(
        '.posting-title .location, .location, [itemprop="jobLocation"], ' +
        '[data-automation-id="jobLocation"], .job-location'
    );

    if (titleElement) jobTitle = titleElement.innerText.trim();
    if (companyElement) company = companyElement.innerText.trim();
    if (locationElement) location = locationElement.innerText.trim();

    const pageTitle = document.title;
    if (!jobTitle || !company) {
        const titleParts = pageTitle.split(/[–—|:]/).map(s => s.trim());
        if (titleParts.length >= 2) {
            if (!company && titleParts[1]) company = titleParts[1];
            if (!jobTitle && titleParts[0]) jobTitle = titleParts[0];
        }
    }

    if (!company) {
        try {
            const url = new URL(window.location.href);
            const domainParts = url.hostname.split('.');
            company = domainParts[domainParts.length - 2] || domainParts[0];
            company = company.charAt(0).toUpperCase() + company.slice(1);
        } catch (e) {
            company = 'Unknown Company';
        }
    }

    return {
        company: company || 'Unknown Company',
        jobTitle: jobTitle || 'Unknown Position',
        location: location || 'Not Specified',
        jobUrl: window.location.href,
        source: window.location.hostname,
        extractedAt: new Date().toISOString()
    };
}

// ---------- 9. RESUME INJECTION ----------
async function injectResume(base64Data, fileName = 'Resume.pdf') {
    try {
        const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
        if (fileInputs.length === 0) {
            console.log('[Autofill] ℹ️ No file upload fields found.');
            return false;
        }

        let targetInput = fileInputs.find(input =>
            /resume|cv/i.test(input.name + input.id + input.className + (input.getAttribute('aria-label') || ''))
        ) || fileInputs[0];

        if (targetInput && (targetInput.offsetParent === null || targetInput.offsetWidth === 0)) {
            const visibleInput = fileInputs.find(input =>
                input.offsetParent !== null && input.offsetWidth > 0 &&
                (input.id === targetInput.id || input.name === targetInput.name)
            );
            if (visibleInput) targetInput = visibleInput;
        }

        const fetchResponse = await fetch(base64Data);
        const blob = await fetchResponse.blob();
        const file = new File([blob], fileName, { type: 'application/pdf' });

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        targetInput.files = dataTransfer.files;

        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));

        console.log(`[Autofill] ✅ Resume injected: "${fileName}"`);
        return true;
    } catch (error) {
        console.error('[Autofill] ❌ Failed to inject resume:', error);
        return false;
    }
}

// ---------- 10. SUBMISSION TRACKER ----------
let submitListenerAttached = false;

function setupSubmitListener(jobDetails) {
    if (submitListenerAttached) {
        console.log('[Autofill] Submit listener already attached.');
        return;
    }
    submitListenerAttached = true;

    let hasSubmitted = false;

    function sendJobLog() {
        if (hasSubmitted) return;
        // For manual registration, we skip the validation check.
        // But for auto-submit, we still check validation errors.
        const validationErrors = document.querySelector('[aria-invalid="true"], .error-message, .field-error, .validation-error');
        if (validationErrors) {
            console.log('[Autofill] ⚠️ Submit clicked but validation errors detected. Aborting log.');
            return;
        }
        hasSubmitted = true;
        console.log('[Autofill] 🚀 Submission detected! Logging application...');

        chrome.runtime.sendMessage({
            action: 'LOG_EXTERNAL_APPLICATION',
            data: {
                type: 'external-autofill',
                source: 'autofill-engine',
                jobs: [jobDetails],
                extractedAt: new Date().toISOString()
            }
        });

        // Clear caches
        cachedJobDetails = null;
        sessionStorage.removeItem('jobstacker_pending_job');
        submitListenerAttached = false; // allow re‑attachment on next job
    }

    // 1. Form submits
    const forms = document.querySelectorAll('form');
    forms.forEach(form => form.addEventListener('submit', (e) => {
        if (form.checkValidity && !form.checkValidity()) {
            console.log('[Autofill] Form validation failed, not logging.');
            return;
        }
        sendJobLog();
    }));

    // 2. Button clicks
    const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
    const submitButtons = allButtons.filter(b => {
        const text = (b.innerText || b.value || b.name || '').toLowerCase();
        return /(submit|apply|send|finish|complete|next|continue)( application)?/i.test(text);
    });
    submitButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            setTimeout(sendJobLog, 800);
        });
    });

    // 3. beforeunload fallback
    let lastClickTime = 0;
    document.addEventListener('click', (e) => {
        const target = e.target.closest('button, input[type="submit"]');
        if (target) {
            const text = (target.innerText || target.value || target.name || '').toLowerCase();
            if (/(submit|apply|send|finish|complete|next|continue)/i.test(text)) {
                lastClickTime = Date.now();
            }
        }
    });

    window.addEventListener('beforeunload', () => {
        if (hasSubmitted) return;
        if (Date.now() - lastClickTime < 3000) {
            sendJobLog();
        }
    });

    console.log(`[Autofill] 👀 Watching for submission of: ${jobDetails.jobTitle} at ${jobDetails.company}`);
}

// ---------- 11. MANUAL REGISTRATION ----------
function registerJobManually(jobDetails, skipValidation = false) {
    if (!jobDetails) {
        console.error('[Autofill] No job details to register.');
        return { success: false, error: 'No job details available.' };
    }
    console.log('[Autofill] 📝 Manually registering job...');
    chrome.runtime.sendMessage({
        action: 'LOG_EXTERNAL_APPLICATION',
        data: {
            type: 'external-autofill',
            source: 'autofill-engine',
            jobs: [jobDetails],
            extractedAt: new Date().toISOString()
        }
    }, (response) => {
        if (response && response.success) {
            console.log('[Autofill] ✅ Job registered manually.');
            // Clear cache
            cachedJobDetails = null;
            sessionStorage.removeItem('jobstacker_pending_job');
            submitListenerAttached = false;
        } else {
            console.warn('[Autofill] ❌ Manual registration failed:', response?.error);
        }
    });
    return { success: true };
}

// ---------- 12. MAIN AUTOFILL FUNCTION ----------
async function executeAutofill() {
    console.log('[Autofill] Starting...');

    let pendingJob = null;
    try {
        const stored = sessionStorage.getItem('jobstacker_pending_job');
        if (stored) {
            pendingJob = JSON.parse(stored);
            console.log('[Autofill] Found pending job in sessionStorage:', pendingJob);
            cachedJobDetails = pendingJob; // sync memory cache
            setupSubmitListener(pendingJob);
        }
    } catch (e) {
        console.warn('[Autofill] Failed to parse sessionStorage:', e);
    }

    const response = await chrome.runtime.sendMessage({ action: 'GET_PROFILE' });
    if (!response.success) {
        return { success: false, error: response.error, count: 0 };
    }

    const profile = response.data;
    if (!profile || Object.keys(profile).length === 0) {
        return { success: false, error: 'Profile data is empty.', count: 0 };
    }

    const isGoogleForm = window.location.hostname.includes('google.com') &&
        window.location.pathname.includes('/forms/');
    if (isGoogleForm) {
        await new Promise(r => setTimeout(r, 800));
    }

    let fields = getAllFields();
    if (isGoogleForm && fields.length === 0) {
        await new Promise(r => setTimeout(r, 500));
        fields = getAllFields();
    }

    if (fields.length === 0) {
        return { success: false, error: 'No form fields found.', count: 0 };
    }

    // ---- Generic form detection ----
    const labels = fields.map(f => getFieldIdentifier(f).label).filter(Boolean);
    const genericLabels = ['Your answer', 'Choose', 'Select', '', 'unknown'];
    const nonGeneric = labels.filter(l => !genericLabels.includes(l));
    const unique = new Set(nonGeneric);
    if (labels.length > 0 && labels.filter(l => genericLabels.includes(l)).length / labels.length > 0.7 && unique.size < 2) {
        return { success: false, error: 'Generic form detected.', count: 0 };
    }

    let filledCount = 0;
    const matchedFields = [];
    const unmatchedFields = [];

    for (const field of fields) {
        if (field.disabled || field.readOnly) continue;

        const identifier = getFieldIdentifier(field);
        const matchedKey = matchFieldToProfile(identifier, profile);

        if (!matchedKey) {
            unmatchedFields.push(identifier);
            continue;
        }

        const existingValue = field.isContentEditable ? field.innerText : field.value;
        if (matchedKey !== 'phone' && existingValue && existingValue.trim() !== '') {
            continue;
        }

        let value = getProfileValue(profile, matchedKey, field, identifier);

        if (value === undefined || value === null || value === '') {
            continue;
        }

        // ---- Dropdown handling ----
        if (field.tagName === 'SELECT') {
            let selected = false;
            const target = String(value).trim();
            for (const option of field.options) {
                if (option.text.trim() === target || option.value.trim() === target) {
                    field.value = option.value;
                    field.dispatchEvent(new Event('change', { bubbles: true }));
                    filledCount++;
                    matchedFields.push({ key: matchedKey, value: option.text.trim(), field });
                    selected = true;
                    break;
                }
            }
            if (!selected && (matchedKey === 'yearsOfExperience' || matchedKey === 'availableStartDate')) {
                const numValue = parseFloat(value);
                if (!isNaN(numValue)) {
                    for (const option of field.options) {
                        const optText = option.text.trim().toLowerCase();
                        if (optText.includes(String(numValue)) || optText.includes(String(Math.floor(numValue)))) {
                            field.value = option.value;
                            field.dispatchEvent(new Event('change', { bubbles: true }));
                            filledCount++;
                            matchedFields.push({ key: matchedKey, value: option.text.trim(), field });
                            selected = true;
                            break;
                        }
                    }
                }
            }
            if (selected) continue;
        }

        // ---- Phone handling ----
        if (matchedKey === 'phone') {
            let countryCode = '';
            let number = '';

            if (typeof value === 'object' && value.number !== undefined) {
                countryCode = value.countryCode || '';
                number = value.number || '';
            } else if (typeof value === 'string') {
                const match = value.match(/^(\+?\d{1,4})\s*(.*)/);
                if (match) {
                    countryCode = match[1];
                    number = match[2].replace(/\s/g, '');
                } else {
                    number = value.replace(/\s/g, '');
                }
            }

            if (!number) {
                console.log('[Autofill] Phone number not found in profile.');
                continue;
            }

            const labelIsCountryCode = /^\+\d{1,4}$/.test(identifier.label.trim());

            const fieldMaxLength = field.maxLength || 0;
            const fieldType = field.type || '';
            const fieldPlaceholder = (field.placeholder || '').toLowerCase();
            const fieldLabel = (identifier.label || '').toLowerCase();

            const expectsOnlyLocalNumber =
                (fieldMaxLength >= 8 && fieldMaxLength <= 12 && !fieldPlaceholder.includes('+') && !fieldPlaceholder.includes('country')) ||
                (field.pattern && /^[0-9]+$/.test(field.pattern)) ||
                fieldType === 'number' ||
                (fieldPlaceholder === 'phone' || fieldPlaceholder === 'mobile' || fieldPlaceholder === 'phone number' || fieldPlaceholder === 'mobile number') ||
                (fieldLabel === 'phone' || fieldLabel === 'mobile' || fieldLabel === 'phone number' || fieldLabel === 'mobile number');

            const digitsOnly = number.replace(/\D/g, '');
            let localNumber = digitsOnly;
            if (countryCode) {
                const ccDigits = countryCode.replace(/\D/g, '');
                if (digitsOnly.startsWith(ccDigits)) {
                    localNumber = digitsOnly.slice(ccDigits.length);
                }
            }
            if (fieldMaxLength && localNumber.length > fieldMaxLength) {
                localNumber = localNumber.slice(0, fieldMaxLength);
            }

            let finalValue = '';
            if (labelIsCountryCode) {
                finalValue = countryCode ? `${countryCode} ${localNumber}` : localNumber;
            } else if (expectsOnlyLocalNumber) {
                finalValue = localNumber;
            } else {
                finalValue = countryCode ? `${countryCode} ${localNumber}` : localNumber;
            }

            if (countryCode && !expectsOnlyLocalNumber) {
                const normalizedCode = countryCode.replace('+', '');
                const countrySelect = document.querySelector('select[name*="country"], select[id*="country"], select[aria-label*="country"]');
                if (countrySelect && countrySelect.tagName === 'SELECT') {
                    for (const option of countrySelect.options) {
                        if (option.value.includes(normalizedCode) || option.text.includes(normalizedCode)) {
                            countrySelect.value = option.value;
                            countrySelect.dispatchEvent(new Event('change', { bubbles: true }));
                            console.log('[Autofill] Set country code dropdown to:', option.value);
                            break;
                        }
                    }
                }
            }

            value = finalValue;
        }

        // ---- Convert and fill ----
        if (Array.isArray(value)) value = value.join(', ');
        value = String(value);

        simulateHumanTyping(field, value);
        filledCount++;
        matchedFields.push({ key: matchedKey, value, field });
        console.log(`[Autofill] ✅ Filled "${matchedKey}" → "${value}"`);
    }

    // ---- Resume injection ----
    console.log('[Autofill] Checking for resume upload...');
    let resumeBase64 = null;

    const resumeStorage = await new Promise(resolve => {
        chrome.storage.local.get(['cachedResume'], resolve);
    });
    resumeBase64 = resumeStorage.cachedResume;

    if (!resumeBase64) {
        console.log('[Autofill] Resume not cached, requesting from background...');
        const resumeResponse = await chrome.runtime.sendMessage({ action: 'GET_RESUME' });
        if (resumeResponse && resumeResponse.success) {
            resumeBase64 = resumeResponse.data;
            console.log('[Autofill] Resume fetched from background.');
        } else {
            console.warn('[Autofill] Failed to fetch resume:', resumeResponse?.error);
        }
    }

    if (resumeBase64) {
        const fileName = profile.firstName && profile.lastName
            ? `${profile.firstName}_${profile.lastName}_Resume.pdf`
            : 'Resume.pdf';
        await injectResume(resumeBase64, fileName);
    } else {
        console.log('[Autofill] ℹ️ No resume available.');
    }

    console.log(`[Autofill] Summary: ${filledCount} fields filled, ${unmatchedFields.length} unmatched.`);

    // ---- Defer logging until submission or manual register ----
    // Check if the page appears to be a job application: file input or submit button
    const hasFileInput = document.querySelector('input[type="file"]');
    const hasSubmitButton = document.querySelector('button[type="submit"], input[type="submit"]');
    const isApplicationPage = hasFileInput || hasSubmitButton || filledCount >= 1;

    if (isApplicationPage) {
        let jobDetails = pendingJob;
        if (!jobDetails) {
            jobDetails = extractJobDetailsFromExternalPage();
            jobDetails.jobId = `ext-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            jobDetails.jobUrl = jobDetails.jobUrl || window.location.href;
            jobDetails.source = jobDetails.source || 'autofill-engine';
            jobDetails.appliedDateRaw = new Date().toISOString();
            jobDetails.statusRaw = 'Applied';
            jobDetails.extractedAt = new Date().toISOString();

            try {
                sessionStorage.setItem('jobstacker_pending_job', JSON.stringify(jobDetails));
            } catch (e) {
                console.warn('[Autofill] Failed to save job to sessionStorage:', e);
            }
        }
        cachedJobDetails = jobDetails; // store in memory

        // Attach the submit listener
        setupSubmitListener(jobDetails);
        console.log(`[Autofill] 📦 Job details cached, waiting for submission.`);
    } else {
        console.log(`[Autofill] ℹ️ Not enough fields filled to track submission (filled: ${filledCount})`);
        // Clear any stale pending job
        sessionStorage.removeItem('jobstacker_pending_job');
        cachedJobDetails = null;
    }

    return { success: true, count: filledCount };
}

// ---------- 13. MESSAGE LISTENERS ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Autofill] Received message:', message);
    if (message.action === 'CLICK_APPLY_CTA') {
        try {
            sendResponse(clickApplyCta());
        } catch (err) {
            sendResponse({ success: false, clicked: false, error: err.message });
        }
        return true;
    }
    if (message.action === 'PING_AUTOFILL') {
        sendResponse({ status: 'alive' });
        return true;
    }
    if (message.action === 'START_AUTOFILL') {
        executeAutofill()
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ success: false, error: err.message, count: 0 }));
        return true;
    }
    if (message.action === 'GET_FIELD_PREVIEW') {
        (async () => {
            try {
                const profileResponse = await chrome.runtime.sendMessage({ action: 'GET_PROFILE' });
                if (!profileResponse.success) {
                    sendResponse({ success: false, error: profileResponse.error });
                    return;
                }
                const profile = profileResponse.data;
                if (!profile || Object.keys(profile).length === 0) {
                    sendResponse({ success: false, error: 'Profile data is empty.' });
                    return;
                }

                let previewText = '';

                // Education
                previewText += '📚 EDUCATION\n';
                if (profile.educations && Array.isArray(profile.educations) && profile.educations.length > 0) {
                    profile.educations.forEach((edu, index) => {
                        previewText += `\nEducation #${index + 1}\n`;
                        if (edu.school) previewText += `School: ${edu.school}\n`;
                        if (edu.degree) previewText += `Degree: ${edu.degree}\n`;
                        if (edu.field) previewText += `Field: ${edu.field}\n`;
                        if (edu.startDate) previewText += `Start Date: ${edu.startDate}\n`;
                        if (edu.endDate) previewText += `End Date: ${edu.endDate}\n`;
                        if (edu.location) previewText += `Location: ${edu.location}\n`;
                    });
                } else {
                    previewText += '(No education entries found)\n';
                }

                // Experience
                previewText += '\n💼 EXPERIENCE\n';
                if (profile.workExperiences && Array.isArray(profile.workExperiences) && profile.workExperiences.length > 0) {
                    profile.workExperiences.forEach((exp, index) => {
                        previewText += `\nExperience #${index + 1}\n`;
                        if (exp.company) previewText += `Company: ${exp.company}\n`;
                        if (exp.title) previewText += `Title: ${exp.title}\n`;
                        if (exp.startDate) previewText += `Start Date: ${exp.startDate}\n`;
                        if (exp.endDate) previewText += `End Date: ${exp.endDate}\n`;
                        if (exp.current) previewText += `Currently working: Yes\n`;
                        if (exp.description) previewText += `Description: ${exp.description}\n`;
                    });
                } else {
                    previewText += '(No experience entries found)\n';
                }

                // Matched fields
                previewText += '\n📋 MATCHED FIELDS\n';
                const fields = getAllFields();
                for (const field of fields) {
                    if (field.disabled || field.readOnly) continue;
                    const identifier = getFieldIdentifier(field);
                    const matchedKey = matchFieldToProfile(identifier, profile);
                    if (!matchedKey) continue;
                    let value = getProfileValue(profile, matchedKey, field, identifier);
                    if (field.tagName === 'SELECT' && value !== undefined && value !== null && value !== '') {
                        const target = String(value).trim();
                        for (const option of field.options) {
                            if (option.text.trim() === target || option.value.trim() === target) {
                                value = option.text.trim();
                                break;
                            }
                        }
                    }
                    if (value === undefined || value === null || value === '') continue;
                    if (Array.isArray(value)) value = value.join(', ');
                    value = String(value);
                    const label = identifier.label || identifier.name || identifier.id || 'Field';
                    previewText += `${label}: ${value}\n`;
                }

                sendResponse({ success: true, preview: previewText });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }
    // ---- GET PENDING JOB STATUS ----
    if (message.action === 'GET_PENDING_JOB_STATUS') {
        const pending = !!cachedJobDetails;
        sendResponse({ pending, jobDetails: cachedJobDetails });
        return true;
    }
    // ---- MANUAL REGISTER (for both action names) ----
    if (message.action === 'REGISTER_JOB' || message.action === 'FORCE_LOG_JOB') {
        let job = cachedJobDetails;
        if (!job) {
            try {
                const stored = sessionStorage.getItem('jobstacker_pending_job');
                if (stored) job = JSON.parse(stored);
            } catch (e) {}
        }
        if (!job) {
            sendResponse({ success: false, error: 'No pending job to register.' });
            return true;
        }
        // Use manual registration with skipValidation = true
        const result = registerJobManually(job, true);
        sendResponse(result);
        return true;
    }
});

console.log('✅ JobStacker Autofill engine ready – waiting for messages.');