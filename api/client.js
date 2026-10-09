(function (root) {
	const DEFAULT_BACKEND_URL = 'https://jobstack-api.onrender.com/api/extract/store';
	const LOCAL_BACKEND_URL = 'http://localhost:5000/api/extract/store';

	function syncStorageGet(keys) {
		return new Promise((resolve, reject) => {
			chrome.storage.sync.get(keys, (result) => {
				const error = chrome.runtime.lastError;
				if (error) reject(new Error(error.message));
				else resolve(result || {});
			});
		});
	}

	async function getBackendUrl() {
		const config = await syncStorageGet(['backendUrl', 'devMode']);
		if (config.devMode === true) return LOCAL_BACKEND_URL;
		const backendUrl = (config.backendUrl || '').trim();
		try {
			if (backendUrl && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(backendUrl).hostname)) {
				return DEFAULT_BACKEND_URL;
			}
		} catch {}
		return backendUrl || DEFAULT_BACKEND_URL;
	}

	async function getBackendBaseUrl() {
		const configuredUrl = await getBackendUrl();
		const baseUrl = configuredUrl.replace(/\/api\/extract\/store\/?$/, '').replace(/\/+$/, '');
		return baseUrl || 'https://jobstack-api.onrender.com';
	}

	function makeApiError(status, message) {
		const error = new Error(message);
		error.name = 'JobStackApiError';
		error.status = status;
		return error;
	}

	async function request(path, options = {}) {
		const {
			baseUrl,
			token: explicitToken,
			auth = true,
			...fetchOptions
		} = options;
		const url = /^https?:\/\//i.test(path)
			? path
			: `${(baseUrl || await getBackendBaseUrl()).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
		const usesSessionToken = auth && !explicitToken;
		const token = auth ? (explicitToken || await root.JobStackAuthSession.getToken()) : null;
		if (auth && !token) throw new Error('No authentication token. Please log in to the JobStack web app.');

		const headers = new Headers(fetchOptions.headers || {});
		if (!headers.has('Content-Type') && fetchOptions.body != null) headers.set('Content-Type', 'application/json');
		if (token) headers.set('Authorization', `Bearer ${token}`);

		const response = await fetch(url, { ...fetchOptions, headers });
		if (response.status === 401 && usesSessionToken) {
			await root.JobStackAuthSession.invalidateToken(token);
		}
		if (!response.ok) {
			const message = await response.text().catch(() => '');
			throw makeApiError(response.status, `Backend error (${response.status})${message ? `: ${message}` : ''}`);
		}
		if (response.status === 204) return null;

		const text = await response.text();
		if (!text) return null;
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}

	root.JobStackApiClient = Object.freeze({
		DEFAULT_BACKEND_URL,
		getBackendUrl,
		getBackendBaseUrl,
		request,
	});
})(globalThis);
