/**
 * Regression tests for the token-refresh guard in CalendarAPI.getValidToken.
 *
 * Bug: access tokens are stored in chrome.storage.session, which Chrome wipes
 * on every browser restart. The old guard returned null the moment the access
 * token was missing — reporting "disconnected" and forcing the user to click
 * Connect again every morning — instead of using the persisted refresh token
 * to silently mint a new one.
 */
import { jest } from '@jest/globals';
import { CalendarAPI } from '../src/utils/calendar-api.js';

/**
 * Build a chrome.storage mock where:
 *  - local holds the persisted connection metadata + credentials (survives restart)
 *  - session is EMPTY (simulating a browser restart that wiped access tokens)
 */
function mockStorage({ connection, credentials, session = {} }) {
  const localData = {
    calendarConnection: connection,
    calendarCredentials: credentials,
    calendarFailureTracking: {},
  };

  global.chrome.storage.local.get = jest.fn(key => {
    if (typeof key === 'string') return Promise.resolve({ [key]: localData[key] });
    return Promise.resolve(localData);
  });
  global.chrome.storage.local.set = jest.fn(() => Promise.resolve());
  global.chrome.storage.local.remove = jest.fn(() => Promise.resolve());

  global.chrome.storage.session = {
    get: jest.fn(() => Promise.resolve(session)),
    set: jest.fn(() => Promise.resolve()),
    remove: jest.fn(() => Promise.resolve()),
  };
}

describe('CalendarAPI.getValidToken — cold-start token recovery', () => {
  afterEach(() => jest.clearAllMocks());

  it('should refresh via refresh token when the access token is missing after a browser restart', async () => {
    mockStorage({
      connection: {
        google: {
          connected: true,
          authMode: 'advanced',
          refreshToken: 'persisted-refresh-token',
          // expiresAt in the past — but the key point is there is NO access
          // token in session storage (wiped on restart).
          expiresAt: Date.now() - 1000,
          email: 'user@example.com',
        },
      },
      credentials: { google: { clientId: 'cid', clientSecret: 'secret' } },
      session: {}, // wiped
    });

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ access_token: 'fresh-access-token', expires_in: 3600 }),
      })
    );

    const token = await CalendarAPI.getValidToken();

    // The regression: this used to return null. It must now recover silently.
    expect(token).toBe('fresh-access-token');
    expect(global.fetch).toHaveBeenCalledWith(
      CalendarAPI.GOOGLE_TOKEN_URL,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('should return the cached access token when it is still valid', async () => {
    mockStorage({
      connection: {
        google: {
          connected: true,
          authMode: 'advanced',
          refreshToken: 'persisted-refresh-token',
          expiresAt: Date.now() + 60 * 60 * 1000, // valid for an hour
        },
      },
      credentials: { google: { clientId: 'cid', clientSecret: 'secret' } },
      session: { session_access_token_google: 'still-valid-token' },
    });

    global.fetch = jest.fn();

    const token = await CalendarAPI.getValidToken();

    expect(token).toBe('still-valid-token');
    expect(global.fetch).not.toHaveBeenCalled(); // no needless refresh
  });

  it('should return null only when the user is genuinely not connected', async () => {
    mockStorage({
      connection: { google: { connected: false } },
      credentials: {},
      session: {},
    });

    const token = await CalendarAPI.getValidToken();
    expect(token).toBeNull();
  });
});
