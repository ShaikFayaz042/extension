(function (root) {
	async function getTrackerApplyQueue() {
		const baseUrl = await root.JobStackApiClient.getBackendBaseUrl();
		return root.JobStackApiClient.request('/api/discovered-jobs/apply-queue', { baseUrl });
	}

	async function getDiscoveryApplyQueue(config) {
		if (!config?.url || !config?.jwt) throw new Error('Discovery server is not configured.');
		const data = await root.JobStackApiClient.request('/api/discovered-jobs/apply-queue', {
			baseUrl: config.url,
			token: config.jwt,
		});
		return root.JobStackApplicationQueue.normalize(data);
	}

	async function submitSuccessfulApplications(applications) {
		const unique = Array.isArray(applications) ? applications.filter(Boolean) : [];
		if (!unique.length) return { submitted: [], results: [] };

		const payload = {
			applications: unique.map((application) => {
				const item = { id: String(application.id ?? application.queueId ?? application._id ?? '') };
				if (application.appliedAt || application.applied_at) item.appliedAt = new Date(application.appliedAt || application.applied_at).toISOString();
				return item;
			}).filter((item) => item.id),
		};

		if (!payload.applications.length) return { submitted: [], results: [] };
		const baseUrl = await root.JobStackApiClient.getBackendBaseUrl();
		return root.JobStackApiClient.request('/api/discovered-jobs/applications', {
			baseUrl,
			method: 'POST',
			body: JSON.stringify(payload),
		});
	}

	root.JobStackApplicationsApi = Object.freeze({
		getTrackerApplyQueue,
		getDiscoveryApplyQueue,
		submitSuccessfulApplications,
	});
})(globalThis);
