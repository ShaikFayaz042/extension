// content-script.js
// Captures JWT token and user platforms from web app's localStorage

console.log('[Content] Job Tracker content script loaded');

const TRUSTED_WEBAPP_ORIGINS = new Set([
  'https://jobstack-live.vercel.app'
]);

function isLocalDevOrigin(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isTrustedWebAppOrigin() {
  try {
    const { protocol, hostname } = window.location;
    if ((protocol === 'http:' || protocol === 'https:') && isLocalDevOrigin(hostname)) return true;
    return TRUSTED_WEBAPP_ORIGINS.has(window.location.origin);
  } catch {
    return false;
  }
}

async function getLocalPreferredMode() {
  try {
    const result = await chrome.storage.sync.get(['devMode']);
    return result.devMode === true;
  } catch {
    return false;
  }
}

async function sendUserDataToExtension() {
  if (!isTrustedWebAppOrigin()) return;

  const preferLocal = await getLocalPreferredMode();
  if (preferLocal && !isLocalDevOrigin(window.location.hostname)) return;

  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('mockmate_user');
  let platforms = [];

  if (userStr) {
    try {
      const user = JSON.parse(userStr);
      platforms = user.settings?.platforms || [];
    } catch (e) {
      console.warn('[Content] Failed to parse user data:', e);
    }
  }

  if (token) {
    chrome.storage.local.get(['invalidAuthToken'], (result) => {
      if (result.invalidAuthToken === token) return;
      chrome.runtime.sendMessage({
        type: 'SET_USER_DATA',
        token: token,
        platforms: platforms
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Content] Error sending user data:', chrome.runtime.lastError);
          return;
        }
        console.log('[Content] User data sent to extension:', response?.success ? '✅' : '❌');
      });
    });
    return;
  }

  chrome.runtime.sendMessage({ type: 'CLEAR_TOKEN' });
  console.log('[Content] No token found in localStorage on trusted JobStack page');
}

// Send immediately when content script loads
sendUserDataToExtension();

// Listen for changes in localStorage (login/logout/platform update)
window.addEventListener('storage', (event) => {
  if (event.key === 'token' || event.key === 'mockmate_user') {
    if (isTrustedWebAppOrigin()) {
      console.log('[Content] Storage changed, updating extension...');
      sendUserDataToExtension();
    }
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes.devMode) return;
  if (changes.devMode.newValue === true && !window.location.origin.startsWith('http://localhost:') && !window.location.origin.startsWith('http://127.0.0.1:') && !window.location.origin.startsWith('https://localhost:') && !window.location.origin.startsWith('https://127.0.0.1:')) {
    return;
  }
  chrome.storage.local.remove(['invalidAuthToken'], sendUserDataToExtension);
});

// Periodic check (backup) – every 30s
setInterval(() => {
  if (!isTrustedWebAppOrigin()) return;

  const currentToken = localStorage.getItem('token');
  chrome.storage.local.get(['authToken', 'userPlatforms'], (result) => {
    const storedToken = result.authToken;
    const storedPlatforms = result.userPlatforms || [];
    const userStr = localStorage.getItem('mockmate_user');
    let currentPlatforms = [];
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        currentPlatforms = user.settings?.platforms || [];
      } catch (e) {}
    }
    if (currentToken !== storedToken || JSON.stringify(currentPlatforms) !== JSON.stringify(storedPlatforms)) {
      console.log('[Content] Token or platforms mismatch, syncing...');
      sendUserDataToExtension();
    }
  });
}, 30000);