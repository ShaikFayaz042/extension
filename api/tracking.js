(function (root) {
	function localStorageCall(method, value) {
		return new Promise((resolve, reject) => {
			chrome.storage.local[method](value, (result) => {
				const error = chrome.runtime.lastError;
				if (error) reject(new Error(error.message));
				else resolve(result || {});
			});
		});
	}

	async function sendApplications(jobs, type, source = 'auto-background') {
		if (!Array.isArray(jobs) || jobs.length === 0) return null;

		const previous = await localStorageCall('get', ['lastBackendSendAt']);
		const lastSentAt = previous.lastBackendSendAt ? new Date(previous.lastBackendSendAt).getTime() : 0;
		const now = Date.now();
		if (now - lastSentAt < 30000) {
			console.warn(`Skipping tracking send: ${Math.round((now - lastSentAt) / 1000)}s since last send`);
			return null;
		}

		const payload = {
			type,
			source,
			totalJobs: jobs.length,
			jobs,
			extractedAt: new Date().toISOString(),
		};
		const endpoint = await root.JobStackApiClient.getBackendUrl();
		const result = await root.JobStackApiClient.request(endpoint, {
			method: 'POST',
			body: JSON.stringify(payload),
		});
		await localStorageCall('set', { lastBackendSendAt: new Date().toISOString() });
		return result;
	}

	root.JobStackTrackingApi = Object.freeze({ sendApplications });
})(globalThis);
