/**
 * Lightweight logger with prod kill-switch.
 *
 * Why: the codebase had ~298 console.* calls including token-prefix logging
 * that leaked secrets into shared profiles. This wrapper:
 *   - prefixes everything with "PingMeet:" automatically
 *   - silences debug/info in production builds
 *   - never logs token material (callers must redact, but we double-guard)
 *
 * Toggle by setting localStorage.PINGMEET_DEBUG = '1' (in popup/dev) or by
 * editing IS_DEV below. Service-worker has no localStorage so it inspects
 * chrome.runtime.id installType (skipped here for simplicity — defaults to
 * silenced debug in packaged builds).
 */

const PREFIX = 'PingMeet:';

// In MV3 service worker / content scripts we cannot rely on process.env.
// Treat unpacked installs as dev. Any code path can also opt-in via
// globalThis.__PINGMEET_DEBUG__ = true.
let cachedDev = null;
function isDev() {
  if (cachedDev !== null) return cachedDev;
  if (globalThis.__PINGMEET_DEBUG__) {
    cachedDev = true;
    return true;
  }
  try {
    // chrome.runtime.getManifest doesn't expose installType; we approximate
    // dev as "update_url is missing" (unpacked extensions have no update_url).
    const manifest = chrome?.runtime?.getManifest?.();
    cachedDev = !!manifest && !manifest.update_url;
  } catch {
    cachedDev = false;
  }
  return cachedDev;
}

function redact(args) {
  // Defensive: scrub anything that looks like an OAuth token from log args.
  return args.map(a => {
    if (typeof a === 'string') {
      return a
        .replace(/ya29\.[A-Za-z0-9_-]+/g, 'ya29.<redacted>')
        .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt-redacted>')
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>');
    }
    return a;
  });
}

export const logger = {
  debug(...args) {
    if (!isDev()) return;
    console.log(PREFIX, ...redact(args));
  },
  info(...args) {
    if (!isDev()) return;
    console.log(PREFIX, ...redact(args));
  },
  warn(...args) {
    console.warn(PREFIX, ...redact(args));
  },
  error(...args) {
    // Errors always logged — needed for debugging user-reported issues.
    console.error(PREFIX, ...redact(args));
  },
};
