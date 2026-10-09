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

	function unwrapProfile(data) {
		return data?.success && data.data ? data.data : data;
	}

	async function cacheResume(resumeUrl) {
		if (!resumeUrl) {
			await localStorageCall('remove', ['cachedResume', 'cachedResumeUrl']);
			return;
		}

		const cached = await localStorageCall('get', ['cachedResumeUrl']);
		if (cached.cachedResumeUrl === resumeUrl) return;

		try {
			const response = await fetch(resumeUrl);
			if (!response.ok) throw new Error(`Resume download failed (${response.status})`);
			const blob = await response.blob();
			const dataUrl = await new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(reader.result);
				reader.onerror = () => reject(new Error('Could not read downloaded resume.'));
				reader.readAsDataURL(blob);
			});
			await localStorageCall('set', { cachedResume: dataUrl, cachedResumeUrl: resumeUrl });
		} catch (error) {
			console.error('[Profile] Resume cache failed:', error);
		}
	}

	async function getProfile() {
		if (!(await root.JobStackAuthSession.getToken())) {
			const authState = await localStorageCall('get', ['invalidAuthToken']);
			if (authState.invalidAuthToken) {
				throw new Error('JobStack session expired or was rejected. Log in to the JobStack web app again, then retry.');
			}
			throw new Error('No authentication token. Please log in to the JobStack web app.');
		}

		const baseUrl = await root.JobStackApiClient.getBackendBaseUrl();
		let profile = null;
		let primaryError = 'No profile data returned.';

		try {
			profile = unwrapProfile(await root.JobStackApiClient.request('/api/user/extension-profile', { baseUrl }));
		} catch (error) {
			if (error.status === 401) {
				throw new Error('JobStack session expired or is invalid. Log in to the JobStack web app again, then retry.');
			}
			primaryError = error.message;
		}

		if (!profile || !profile.resumeUrl) {
			try {
				const fallback = unwrapProfile(await root.JobStackApiClient.request('/api/user/profile', { baseUrl }));
				if (fallback) {
					profile = profile || {};
					for (const key of Object.keys(fallback)) {
						if (!(key in profile) || (key === 'resumeUrl' && !profile.resumeUrl)) profile[key] = fallback[key];
					}
				}
			} catch (error) {
				if (!profile) throw new Error(`Both profile endpoints failed. Primary error: ${primaryError}. Fallback error: ${error.message}`);
			}
		}

		if (profile) void cacheResume(profile.resumeUrl);
		else await cacheResume(null);
		return profile;
	}

	async function saveProfile(profileData) {
		const baseUrl = await root.JobStackApiClient.getBackendBaseUrl();
		return root.JobStackApiClient.request('/api/user/profile', {
			baseUrl,
			method: 'PUT',
			body: JSON.stringify(profileData),
		});
	}

	async function getCachedResume() {
		const data = await localStorageCall('get', ['cachedResume']);
		return data.cachedResume || null;
	}

	root.JobStackProfileApi = Object.freeze({ getProfile, saveProfile, getCachedResume, cacheResume });
})(globalThis);
