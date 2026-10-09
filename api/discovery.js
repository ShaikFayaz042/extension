(function (root) {
	function serverOptions(config, options = {}) {
		if (!config?.url || !config?.jwt) throw new Error('Discovery server is not configured.');
		return { ...options, baseUrl: config.url, token: config.jwt };
	}

	function normalizeJdReadyJobs(data) {
		if (!Array.isArray(data?.jobs)) throw new Error('Invalid JD-ready response: expected a jobs array.');
		return data.jobs.map((job) => {
			const jobUrl = job.job_url || job.jobUrl || job.url;
			if (!job.id || typeof jobUrl !== 'string' || !jobUrl) {
				throw new Error('Invalid JD-ready job: expected id and job URL.');
			}
			return { ...job, job_url: jobUrl };
		});
	}

	async function importJobs(config, payload) {
		const body = JSON.stringify(payload);
		const sizeBytes = new Blob([body]).size;
		if (sizeBytes > 9 * 1024 * 1024) {
			throw new Error(`Payload too large (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB); limit is 10 MB.`);
		}
		return root.JobStackApiClient.request('/api/discovered-jobs/import', {
			...serverOptions(config), method: 'POST', body,
		});
	}

	async function testServer(config) {
		return root.JobStackApiClient.request('/api/discovered-jobs?limit=1', serverOptions(config));
	}

	async function getJdReadyJobs(config) {
		const data = await root.JobStackApiClient.request('/api/discovered-jobs/jd-ready', serverOptions(config));
		return normalizeJdReadyJobs(data);
	}

	async function submitJdResults(config, jobs, batchSize = 500) {
		let submitted = 0;
		let failed = 0;
		const errors = [];
		for (let index = 0; index < jobs.length; index += batchSize) {
			const batch = jobs.slice(index, index + batchSize);
			try {
				await root.JobStackApiClient.request('/api/discovered-jobs/jd-results', {
					...serverOptions(config), method: 'POST', body: JSON.stringify({ jobs: batch }),
				});
				submitted += batch.length;
			} catch (error) {
				failed += batch.length;
				errors.push(error.message);
				console.warn('[JobStack] JD result submission failed:', error.message);
			}
		}
		return { submitted, failed, errors };
	}

	root.JobStackDiscoveryApi = Object.freeze({ importJobs, testServer, getJdReadyJobs, submitJdResults });
})(globalThis);
