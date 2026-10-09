(function (root) {
	const STATE_KEYS = ['applyQueue', 'applyIndex', 'applyTabId'];

	function normalize(payload) {
		const jobs = Array.isArray(payload?.jobs)
			? payload.jobs
			: Array.isArray(payload?.data?.jobs)
				? payload.data.jobs
				: Array.isArray(payload?.data)
					? payload.data
					: Array.isArray(payload)
						? payload
						: [];

		return jobs.map((job) => ({
			id: job.id || job._id || '',
			job_url: job.job_url || job.jobUrl || job.url || '',
			title: job.title || '',
			company: job.company || '',
			location: job.location || '',
			experience: job.experience || '',
			salary: job.salary || '',
		})).filter((job) => {
			try {
				return ['http:', 'https:'].includes(new URL(job.job_url).protocol);
			} catch {
				return false;
			}
		});
	}

	function storageCall(method, value) {
		return new Promise((resolve, reject) => {
			chrome.storage.local[method](value, (result) => {
				const error = chrome.runtime.lastError;
				if (error) reject(new Error(error.message));
				else resolve(result || {});
			});
		});
	}

	async function loadState() {
		const state = await storageCall('get', STATE_KEYS);
		const jobs = Array.isArray(state.applyQueue) ? state.applyQueue : [];
		const index = Math.min(Math.max(state.applyIndex || 0, 0), Math.max(jobs.length - 1, 0));
		return { jobs, index, tabId: state.applyTabId ?? null };
	}

	async function saveState(state) {
		await storageCall('set', {
			applyQueue: Array.isArray(state.jobs) ? state.jobs : [],
			applyIndex: Math.max(0, Number(state.index) || 0),
			applyTabId: state.tabId ?? null,
		});
	}

	async function clearState() {
		await storageCall('remove', STATE_KEYS);
	}

	root.JobStackApplicationQueue = Object.freeze({ normalize, loadState, saveState, clearState });
})(globalThis);
