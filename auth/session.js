(function (root) {
	const TOKEN_KEY = 'authToken';
	const PLATFORMS_KEY = 'userPlatforms';
	const UPDATED_AT_KEY = 'tokenUpdatedAt';
	const INVALID_TOKEN_KEY = 'invalidAuthToken';

	function localStorageCall(method, value) {
		return new Promise((resolve, reject) => {
			chrome.storage.local[method](value, (result) => {
				const error = chrome.runtime.lastError;
				if (error) reject(new Error(error.message));
				else resolve(result);
			});
		});
	}

	async function getToken() {
		const data = await localStorageCall('get', [TOKEN_KEY]);
		return typeof data[TOKEN_KEY] === 'string' ? data[TOKEN_KEY] : null;
	}

	async function getPlatforms() {
		const data = await localStorageCall('get', [PLATFORMS_KEY]);
		return Array.isArray(data[PLATFORMS_KEY]) ? data[PLATFORMS_KEY] : [];
	}

	async function setSession(token, platforms = []) {
		const normalizedToken = typeof token === 'string' ? token.trim() : '';
		if (!normalizedToken) throw new Error('Cannot store an empty JobStack session token.');
		const stored = await localStorageCall('get', [INVALID_TOKEN_KEY]);
		if (stored[INVALID_TOKEN_KEY] === normalizedToken) {
			throw new Error('This JobStack session token was rejected. Log in again to refresh it.');
		}
		await localStorageCall('set', {
			[TOKEN_KEY]: normalizedToken,
			[PLATFORMS_KEY]: Array.isArray(platforms) ? platforms : [],
			[UPDATED_AT_KEY]: Date.now(),
		});
		await localStorageCall('remove', [INVALID_TOKEN_KEY]);
		return { token: normalizedToken, platforms: Array.isArray(platforms) ? platforms : [] };
	}

	async function setToken(token) {
		const normalizedToken = typeof token === 'string' ? token.trim() : '';
		if (!normalizedToken) throw new Error('Cannot store an empty JobStack session token.');
		const stored = await localStorageCall('get', [INVALID_TOKEN_KEY]);
		if (stored[INVALID_TOKEN_KEY] === normalizedToken) {
			throw new Error('This JobStack session token was rejected. Log in again to refresh it.');
		}
		await localStorageCall('set', {
			[TOKEN_KEY]: normalizedToken,
			[UPDATED_AT_KEY]: Date.now(),
		});
		await localStorageCall('remove', [INVALID_TOKEN_KEY]);
		return normalizedToken;
	}

	async function invalidateToken(token) {
		const normalizedToken = typeof token === 'string' ? token.trim() : '';
		if (normalizedToken) await localStorageCall('set', { [INVALID_TOKEN_KEY]: normalizedToken });
		await localStorageCall('remove', [TOKEN_KEY, UPDATED_AT_KEY]);
		if (chrome.action) {
			await chrome.action.setBadgeText({ text: '!Login' });
			await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
		}
	}

	async function clearSession() {
		await localStorageCall('remove', [TOKEN_KEY, UPDATED_AT_KEY, PLATFORMS_KEY, INVALID_TOKEN_KEY]);
		if (chrome.action) {
			await chrome.action.setBadgeText({ text: '!Login' });
			await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
		}
	}

	async function getStatus() {
		return { hasToken: !!(await getToken()) };
	}

	root.JobStackAuthSession = Object.freeze({
		getToken,
		getPlatforms,
		setSession,
		setToken,
		invalidateToken,
		clearSession,
		getStatus,
	});
})(globalThis);
