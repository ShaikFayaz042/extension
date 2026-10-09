(function (root) {
	function sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async function openQueuedJob(job, existingTabId = null) {
		const jobUrl = job?.job_url || job?.jobUrl || job?.url;
		let parsedUrl;
		try {
			parsedUrl = new URL(jobUrl);
		} catch {
			throw new Error('Queued job has no valid URL.');
		}
		if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Queued job URL must use HTTP or HTTPS.');

		if (existingTabId != null) {
			try {
				await chrome.tabs.get(existingTabId);
				await chrome.tabs.update(existingTabId, { url: parsedUrl.href, active: true });
				return existingTabId;
			} catch {
				// The saved tab was closed; open a replacement.
			}
		}

		const tab = await chrome.tabs.create({ url: parsedUrl.href, active: true });
		return tab.id;
	}

	async function sendApplyCta(tabId, timeoutMs = 12000) {
		const startedAt = Date.now();
		let lastError = null;
		let lastResponse = null;
		while (Date.now() - startedAt < timeoutMs) {
			try {
				const tab = await chrome.tabs.get(tabId);
				if (tab.status === 'complete') {
					lastResponse = await chrome.tabs.sendMessage(tabId, { action: 'CLICK_APPLY_CTA' });
					if (lastResponse?.clicked) return lastResponse;
					if (lastResponse) return lastResponse;
				}
			} catch (error) {
				lastError = error;
			}
			await sleep(400);
		}
		if (lastResponse) return lastResponse;
		if (lastError) throw new Error(`Apply page did not become ready: ${lastError.message}`);
		throw new Error('Apply page did not become ready before timeout.');
	}

	async function clickApplyCta(tabId, expectedJobUrl) {
		const initialTab = await chrome.tabs.get(tabId);
		const initialUrl = [initialTab.url, expectedJobUrl].find((value) => {
			try {
				return ['http:', 'https:'].includes(new URL(value).protocol);
			} catch {
				return false;
			}
		});
		if (!initialUrl) throw new Error('Could not determine a valid job page URL.');
		const initialOrigin = new URL(initialUrl).origin;
		const initialTabs = await chrome.tabs.query({ windowId: initialTab.windowId });
		const initialTabIds = new Set(initialTabs.map((tab) => tab.id));
		const firstClick = await sendApplyCta(tabId);
		if (!firstClick?.clicked) return firstClick;

		let destinationTab = null;
		const transitionDeadline = Date.now() + 3000;
		while (Date.now() < transitionDeadline && !destinationTab) {
			const tabs = await chrome.tabs.query({ windowId: initialTab.windowId });
			const newTab = tabs.find((tab) => !initialTabIds.has(tab.id));
			if (newTab) {
				destinationTab = newTab;
				break;
			}

			try {
				const currentTab = await chrome.tabs.get(tabId);
				if (currentTab.url) {
					try {
						if (new URL(currentTab.url).origin !== initialOrigin) destinationTab = currentTab;
					} catch {
						// A transient or restricted tab URL should not block the current apply step.
					}
				}
			} catch {
				break;
			}
			if (!destinationTab) await sleep(200);
		}

		if (!destinationTab) return firstClick;
		const destinationDeadline = Date.now() + 10000;
		while (Date.now() < destinationDeadline) {
			try {
				const current = await chrome.tabs.get(destinationTab.id);
				if (current.status === 'complete' && current.url && current.url !== 'about:blank') {
					let destinationOrigin;
					try {
						destinationOrigin = new URL(current.url).origin;
					} catch {
						return firstClick;
					}
					if (destinationOrigin !== initialOrigin) {
						const followUp = await sendApplyCta(current.id, 4000);
						return { ...firstClick, followUp };
					}
					return firstClick;
				}
			} catch {
				return firstClick;
			}
			await sleep(250);
		}
		return firstClick;
	}

	root.JobStackApplyCoordinator = Object.freeze({ openQueuedJob, clickApplyCta });
})(globalThis);
