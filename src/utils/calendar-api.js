/**
 * Google Calendar API Service
 * Handles OAuth authentication and calendar event fetching
 * All data stays in browser - no external servers
 * Users provide their own OAuth credentials
 */

export class CalendarAPI {
  // Google API endpoints
  static GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
  static GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  static GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

  // Microsoft Graph API endpoints
  static MS_GRAPH_API = 'https://graph.microsoft.com/v1.0';
  static MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
  static MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

  // Pre-configured Outlook Client ID for one-click auth
  // This is a multi-tenant app registered by the developer
  // Users can connect with any Microsoft account without creating their own app
  static OUTLOOK_CLIENT_ID = '95657014-019b-42bc-b0c1-23719004637c';

  static STORAGE_KEY = 'calendarConnection';
  static CREDENTIALS_KEY = 'calendarCredentials';

  // ==================== PKCE Helper Functions ====================

  /**
   * Generate a cryptographically random code verifier for PKCE
   * @returns {string} Base64URL-encoded random string
   */
  static generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return this.base64UrlEncode(array);
  }

  /**
   * Generate code challenge from verifier using SHA-256
   * @param {string} verifier - The code verifier
   * @returns {Promise<string>} Base64URL-encoded SHA-256 hash
   */
  static async generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return this.base64UrlEncode(new Uint8Array(hash));
  }

  /**
   * Base64URL encode (URL-safe base64 without padding)
   * @param {Uint8Array} buffer
   * @returns {string}
   */
  static base64UrlEncode(buffer) {
    let binary = '';
    for (let i = 0; i < buffer.length; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Notify user that calendar token has expired
   * @param {string} calendarName - Name of the calendar (Google/Outlook)
   */
  static notifyTokenExpired(calendarName) {
    try {
      chrome.notifications.create(`token_expired_${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
        title: 'PingMeet: Calendar Disconnected',
        message: `${calendarName} connection expired. Please reconnect in Settings to continue syncing events.`,
        priority: 1
      });
      console.log(`PingMeet: ${calendarName} token expired notification sent`);
    } catch (error) {
      console.error('PingMeet: Error showing token expired notification', error);
    }
  }

  /**
   * Get the redirect URI for OAuth
   */
  static getRedirectUri() {
    return `https://${chrome.runtime.id}.chromiumapp.org/`;
  }

  /**
   * Save user's OAuth credentials
   */
  static async saveCredentials(provider, credentials) {
    const current = await chrome.storage.local.get(this.CREDENTIALS_KEY);
    const allCredentials = current[this.CREDENTIALS_KEY] || {};
    allCredentials[provider] = credentials;
    await chrome.storage.local.set({ [this.CREDENTIALS_KEY]: allCredentials });
  }

  /**
   * Get user's OAuth credentials
   */
  static async getCredentials(provider) {
    const data = await chrome.storage.local.get(this.CREDENTIALS_KEY);
    return data[this.CREDENTIALS_KEY]?.[provider] || null;
  }

  /**
   * Check if user has provided credentials
   */
  static async hasCredentials(provider) {
    const credentials = await this.getCredentials(provider);
    return !!credentials?.clientId;
  }

  /**
   * Check if user is connected to Google Calendar
   */
  static async isConnected() {
    const connection = await chrome.storage.local.get(this.STORAGE_KEY);
    return connection[this.STORAGE_KEY]?.google?.connected || false;
  }

  /**
   * Get connection status for all providers
   */
  static async getConnectionStatus() {
    const connection = await chrome.storage.local.get(this.STORAGE_KEY);
    return {
      google: connection[this.STORAGE_KEY]?.google?.connected || false,
      outlook: connection[this.STORAGE_KEY]?.outlook?.connected || false
    };
  }

  /**
   * Connect to Google Calendar using user-provided Client ID and Secret
   * Uses PKCE flow for secure authorization with refresh tokens
   * @param {string} clientId - Google OAuth Client ID
   * @param {string} clientSecret - Google OAuth Client Secret (required for Web Application type)
   */
  static async connectGoogle(clientId, clientSecret) {
    try {
      if (!clientId) {
        // Check if we have stored credentials
        const credentials = await this.getCredentials('google');
        clientId = credentials?.clientId;
        clientSecret = clientSecret || credentials?.clientSecret;
      }

      if (!clientId) {
        return { success: false, error: 'Please enter your Google OAuth Client ID' };
      }

      if (!clientSecret) {
        return { success: false, error: 'Please enter your Google OAuth Client Secret' };
      }

      // Save the credentials (client ID and secret)
      await this.saveCredentials('google', { clientId, clientSecret });

      const redirectUri = this.getRedirectUri();
      const scopes = [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email'
      ].join(' ');

      // Generate PKCE code verifier and challenge
      const codeVerifier = this.generateCodeVerifier();
      const codeChallenge = await this.generateCodeChallenge(codeVerifier);

      // Build OAuth URL with PKCE (authorization code flow)
      const authParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',           // Authorization code, not token
        scope: scopes,
        access_type: 'offline',          // Request refresh token
        prompt: 'consent',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });

      const authUrl = `${this.GOOGLE_AUTH_URL}?${authParams.toString()}`;

      // Launch OAuth flow
      const responseUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
          { url: authUrl, interactive: true },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (!response) {
              reject(new Error('No response from OAuth flow'));
            } else {
              resolve(response);
            }
          }
        );
      });

      // Extract authorization code from response URL
      const url = new URL(responseUrl);
      const authCode = url.searchParams.get('code');

      if (!authCode) {
        return { success: false, error: 'No authorization code received' };
      }

      // Exchange authorization code for tokens (clientSecret already passed as parameter)
      const tokenParams = {
        client_id: clientId,
        client_secret: clientSecret,
        code: authCode,
        code_verifier: codeVerifier,   // PKCE proof
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      };

      const tokenResponse = await fetch(this.GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(tokenParams)
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.json();
        return { success: false, error: error.error_description || 'Token exchange failed' };
      }

      const tokens = await tokenResponse.json();
      const { access_token, refresh_token, expires_in } = tokens;

      if (!access_token) {
        return { success: false, error: 'No access token received' };
      }

      // Calculate expiry time
      const expiresAt = Date.now() + (parseInt(expires_in) * 1000);

      // Verify token by fetching user info
      const userInfo = await this.fetchGoogleUserInfo(access_token);

      // Store connection status with tokens (including refresh token!)
      await this.saveConnection('google', {
        connected: true,
        email: userInfo.email,
        accessToken: access_token,
        refreshToken: refresh_token,     // Save refresh token for auto-refresh
        expiresAt: expiresAt,
        connectedAt: new Date().toISOString()
      });

      console.log('PingMeet: Connected to Google Calendar with refresh token', userInfo.email);
      return { success: true, email: userInfo.email };
    } catch (error) {
      console.error('PingMeet: Google Calendar connection failed', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Connect to Google Calendar using chrome.identity (simplified, no credentials needed)
   * This uses the extension's built-in OAuth credentials from manifest.json
   * Tokens are automatically managed by Chrome
   */
  static async connectGoogleSimple() {
    try {
      // Use chrome.identity.getAuthToken for simplified auth
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!token) {
            reject(new Error('No token received'));
          } else {
            resolve(token);
          }
        });
      });

      // Verify token by fetching user info
      const userInfo = await this.fetchGoogleUserInfo(token);

      // Store connection status (no refresh token needed - Chrome manages it)
      await this.saveConnection('google', {
        connected: true,
        email: userInfo.email,
        accessToken: token,
        authMode: 'simple',  // Mark as simple auth mode
        expiresAt: Date.now() + (3600 * 1000),  // Chrome tokens typically last 1 hour
        connectedAt: new Date().toISOString()
      });

      console.log('PingMeet: Connected to Google Calendar (Simple Mode)', userInfo.email);
      return { success: true, email: userInfo.email };
    } catch (error) {
      console.error('PingMeet: Google Calendar simple connection failed', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Refresh Google access token using refresh token with retry logic
   * @param {string} refreshToken - The refresh token
   * @param {string} clientId - The client ID
   * @param {string} clientSecret - The client secret (required for web app OAuth)
   * @param {number} retries - Number of retries (default 3)
   * @returns {Promise<Object>} New tokens
   */
  static async refreshGoogleToken(refreshToken, clientId, clientSecret, retries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`PingMeet: Google token refresh attempt ${attempt}/${retries}`);

        const params = {
          client_id: clientId,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        };

        // Include client_secret if provided (required for Web Application OAuth clients)
        if (clientSecret) {
          params.client_secret = clientSecret;
        }

        const response = await fetch(this.GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(params)
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error_description || `Token refresh failed: ${response.status}`);
        }

        return response.json();
      } catch (error) {
        lastError = error;
        console.warn(`PingMeet: Google token refresh attempt ${attempt} failed:`, error.message);

        // Don't retry on auth errors (invalid_grant, etc.)
        if (error.message.includes('invalid_grant') || 
            error.message.includes('expired') ||
            error.message.includes('revoked')) {
          throw error;
        }

        // Wait before retry (exponential backoff)
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
        }
      }
    }

    throw lastError;
  }

  /**
   * Disconnect from Google Calendar
   */
  static async disconnectGoogle() {
    try {
      // Get stored token
      const connection = await chrome.storage.local.get(this.STORAGE_KEY);
      const googleConnection = connection[this.STORAGE_KEY]?.google;

      if (googleConnection?.accessToken) {
        // Revoke token on Google's end
        try {
          await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${googleConnection.accessToken}`);
        } catch (e) {
          // Ignore revoke errors
        }
      }

      // Clear connection status but keep credentials
      await this.saveConnection('google', { connected: false });

      console.log('PingMeet: Disconnected from Google Calendar');
      return { success: true };
    } catch (error) {
      console.error('PingMeet: Error disconnecting', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Connect to Outlook Calendar using Microsoft Graph API
   * Uses PKCE flow for secure authorization with refresh tokens
   */
  static async connectOutlook(clientId) {
    try {
      if (!clientId) {
        const credentials = await this.getCredentials('outlook');
        clientId = credentials?.clientId;
      }

      if (!clientId) {
        return { success: false, error: 'Please enter your Microsoft Application ID' };
      }

      // Save the client ID
      await this.saveCredentials('outlook', { clientId });

      const redirectUri = this.getRedirectUri();
      const scopes = [
        'openid',
        'profile',
        'email',
        'offline_access',              // Required for refresh tokens
        'Calendars.ReadWrite'
      ].join(' ');

      // Generate PKCE code verifier and challenge
      const codeVerifier = this.generateCodeVerifier();
      const codeChallenge = await this.generateCodeChallenge(codeVerifier);

      // Build OAuth URL with PKCE (authorization code flow)
      const authParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',           // Authorization code, not token
        scope: scopes,
        response_mode: 'query',
        prompt: 'consent',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });

      const authUrl = `${this.MS_AUTH_URL}?${authParams.toString()}`;

      // Launch OAuth flow
      const responseUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
          { url: authUrl, interactive: true },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (!response) {
              reject(new Error('No response from OAuth flow'));
            } else {
              resolve(response);
            }
          }
        );
      });

      // Extract authorization code from response URL
      const url = new URL(responseUrl);
      const authCode = url.searchParams.get('code');

      if (!authCode) {
        const error = url.searchParams.get('error_description') || 'No authorization code received';
        return { success: false, error };
      }

      // Exchange authorization code for tokens (with PKCE - no client_secret needed)
      const tokenResponse = await fetch(this.MS_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          code: authCode,
          code_verifier: codeVerifier,   // PKCE proof
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          scope: scopes
        })
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.json();
        return { success: false, error: error.error_description || 'Token exchange failed' };
      }

      const tokens = await tokenResponse.json();
      const { access_token, refresh_token, expires_in } = tokens;

      if (!access_token) {
        return { success: false, error: 'No access token received' };
      }

      // Calculate expiry time
      const expiresAt = Date.now() + (parseInt(expires_in) * 1000);

      // Try to fetch user info (optional - may fail if User.Read permission not granted)
      let userEmail = 'Connected';
      try {
        const userInfo = await this.fetchOutlookUserInfo(access_token);
        userEmail = userInfo.mail || userInfo.userPrincipalName || 'Connected';
      } catch (error) {
        console.warn('PingMeet: Could not fetch user info, but connection successful', error);
      }

      // Store connection status with tokens (including refresh token!)
      await this.saveConnection('outlook', {
        connected: true,
        email: userEmail,
        accessToken: access_token,
        refreshToken: refresh_token,     // Save refresh token for auto-refresh
        expiresAt: expiresAt,
        connectedAt: new Date().toISOString()
      });

      console.log('PingMeet: Connected to Outlook Calendar with refresh token', userEmail);
      return { success: true, email: userEmail };
    } catch (error) {
      console.error('PingMeet: Outlook Calendar connection failed', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Connect to Outlook Calendar using pre-configured client ID (one-click)
   * No user setup required - uses developer's multi-tenant Azure AD app
   */
  static async connectOutlookSimple() {
    try {
      // Check if we have a pre-configured client ID
      if (!this.OUTLOOK_CLIENT_ID || this.OUTLOOK_CLIENT_ID === 'YOUR_OUTLOOK_CLIENT_ID_HERE') {
        return {
          success: false,
          error: 'One-click Outlook not configured. Please use Advanced mode.',
          needsAdvanced: true
        };
      }

      const clientId = this.OUTLOOK_CLIENT_ID;
      const redirectUri = this.getRedirectUri();
      const scopes = [
        'openid',
        'profile',
        'email',
        'offline_access',
        'User.Read',
        'Calendars.ReadWrite'
      ].join(' ');

      // Generate PKCE code verifier and challenge
      const codeVerifier = this.generateCodeVerifier();
      const codeChallenge = await this.generateCodeChallenge(codeVerifier);

      // Build OAuth URL with PKCE
      const authParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes,
        response_mode: 'query',
        prompt: 'select_account',  // Let user choose account
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });

      const authUrl = `${this.MS_AUTH_URL}?${authParams.toString()}`;

      // Launch OAuth flow
      const responseUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
          { url: authUrl, interactive: true },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (!response) {
              reject(new Error('No response from OAuth flow'));
            } else {
              resolve(response);
            }
          }
        );
      });

      // Extract authorization code from response URL
      const url = new URL(responseUrl);
      const authCode = url.searchParams.get('code');

      if (!authCode) {
        const error = url.searchParams.get('error_description') || 'No authorization code received';
        return { success: false, error };
      }

      // Exchange authorization code for tokens (with PKCE - no client_secret needed)
      const tokenResponse = await fetch(this.MS_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          code: authCode,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          scope: scopes
        })
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.json();
        return { success: false, error: error.error_description || 'Token exchange failed' };
      }

      const tokens = await tokenResponse.json();
      const { access_token, refresh_token, expires_in } = tokens;

      if (!access_token) {
        return { success: false, error: 'No access token received' };
      }

      // Calculate expiry time
      const expiresAt = Date.now() + (parseInt(expires_in) * 1000);

      // Fetch user info
      let userEmail = 'Connected';
      try {
        const userInfo = await this.fetchOutlookUserInfo(access_token);
        userEmail = userInfo.mail || userInfo.userPrincipalName || 'Connected';
      } catch (error) {
        console.warn('PingMeet: Could not fetch user info, but connection successful', error);
      }

      // Store connection status with tokens
      await this.saveConnection('outlook', {
        connected: true,
        email: userEmail,
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: expiresAt,
        authMode: 'simple',  // Mark as simple auth mode
        connectedAt: new Date().toISOString()
      });

      // Save the client ID used (for token refresh)
      await this.saveCredentials('outlook', { clientId });

      console.log('PingMeet: Connected to Outlook Calendar (Simple Mode)', userEmail);
      return { success: true, email: userEmail };
    } catch (error) {
      console.error('PingMeet: Outlook Calendar simple connection failed', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Refresh Outlook access token using refresh token with retry logic
   * @param {string} refreshToken - The refresh token
   * @param {string} clientId - The client ID
   * @param {number} retries - Number of retries (default 3)
   * @returns {Promise<Object>} New tokens
   */
  static async refreshOutlookToken(refreshToken, clientId, retries = 3) {
    const scopes = [
      'openid',
      'profile',
      'email',
      'offline_access',
      'User.Read',
      'Calendars.ReadWrite'
    ].join(' ');

    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`PingMeet: Outlook token refresh attempt ${attempt}/${retries}`);

        const response = await fetch(this.MS_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            scope: scopes
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error_description || `Token refresh failed: ${response.status}`);
        }

        return response.json();
      } catch (error) {
        lastError = error;
        console.warn(`PingMeet: Outlook token refresh attempt ${attempt} failed:`, error.message);

        // Don't retry on auth errors (invalid_grant, etc.)
        if (error.message.includes('invalid_grant') || 
            error.message.includes('expired') ||
            error.message.includes('revoked')) {
          throw error;
        }

        // Wait before retry (exponential backoff)
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
        }
      }
    }

    throw lastError;
  }

  /**
   * Disconnect from Outlook Calendar
   */
  static async disconnectOutlook() {
    try {
      // Clear connection status but keep credentials
      await this.saveConnection('outlook', { connected: false });

      console.log('PingMeet: Disconnected from Outlook Calendar');
      return { success: true };
    } catch (error) {
      console.error('PingMeet: Error disconnecting from Outlook', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch user info from Microsoft Graph
   */
  static async fetchOutlookUserInfo(token) {
    const response = await fetch(`${this.MS_GRAPH_API}/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user info');
    }

    return response.json();
  }

  /**
   * Get valid Outlook access token (auto-refresh if expired using refresh token)
   */
  static async getValidOutlookToken() {
    const connection = await chrome.storage.local.get(this.STORAGE_KEY);
    const outlookConnection = connection[this.STORAGE_KEY]?.outlook;

    if (!outlookConnection?.connected || !outlookConnection?.accessToken) {
      return null;
    }

    // Check if token is expired (with 5 min buffer)
    if (outlookConnection.expiresAt && Date.now() > outlookConnection.expiresAt - 300000) {
      console.log('PingMeet: Outlook token expired, attempting auto-refresh...');

      // Try to refresh using refresh token
      if (outlookConnection.refreshToken) {
        try {
          const credentials = await this.getCredentials('outlook');
          if (!credentials?.clientId) {
            throw new Error('No client ID found');
          }

          const tokens = await this.refreshOutlookToken(outlookConnection.refreshToken, credentials.clientId);

          // Calculate new expiry time
          const expiresAt = Date.now() + (parseInt(tokens.expires_in) * 1000);

          // Update stored tokens
          await this.saveConnection('outlook', {
            ...outlookConnection,
            accessToken: tokens.access_token,
            // Keep existing refresh token if new one not provided
            refreshToken: tokens.refresh_token || outlookConnection.refreshToken,
            expiresAt: expiresAt
          });

          console.log('PingMeet: Outlook token refreshed successfully');
          return tokens.access_token;
        } catch (error) {
          console.error('PingMeet: Outlook token refresh failed', error);
          // Refresh failed - disconnect and notify user
          await this.saveConnection('outlook', { connected: false });
          this.notifyTokenExpired('Outlook Calendar');
          return null;
        }
      } else {
        // No refresh token available - legacy connection
        console.log('PingMeet: No refresh token, need re-authentication');
        await this.saveConnection('outlook', { connected: false });
        this.notifyTokenExpired('Outlook Calendar');
        return null;
      }
    }

    return outlookConnection.accessToken;
  }

  /**
   * Fetch calendar events from Outlook/Microsoft Graph API
   */
  static async fetchOutlookEvents() {
    try {
      const token = await this.getValidOutlookToken();

      if (!token) {
        return { success: false, error: 'Not authenticated', events: [] };
      }

      // Fetch all events for the entire day (not just next 24 hours)
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      const params = new URLSearchParams({
        startDateTime: startOfDay.toISOString(),
        endDateTime: endOfDay.toISOString(),
        $orderby: 'start/dateTime',
        $top: '100'
      });

      const response = await fetch(
        `${this.MS_GRAPH_API}/me/calendarView?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired - disconnect and notify user
          await this.saveConnection('outlook', { connected: false });
          this.notifyTokenExpired('Outlook Calendar');
          return { success: false, error: 'Token expired. Please reconnect in Settings.', events: [] };
        }
        // Get error details
        const errorText = await response.text();
        console.error('PingMeet: Outlook API error response:', errorText);
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const events = this.parseOutlookEvents(data.value || []);

      console.log(`PingMeet: Fetched ${events.length} events from Outlook Calendar API`);
      return { success: true, events };
    } catch (error) {
      console.error('PingMeet: Error fetching Outlook events', error);
      return { success: false, error: error.message, events: [] };
    }
  }

  /**
   * Parse Outlook/Microsoft Graph events into PingMeet format
   */
  static parseOutlookEvents(items) {
    return items
      .filter(item => item.start?.dateTime) // Only timed events
      .map(item => ({
        id: `outlook_${item.id}`,
        title: item.subject || 'Untitled Meeting',
        startTime: item.start.dateTime + (item.start.timeZone === 'UTC' ? 'Z' : ''),
        endTime: item.end?.dateTime + (item.end?.timeZone === 'UTC' ? 'Z' : ''),
        location: item.location?.displayName || '',
        description: item.bodyPreview || '',
        meetingLink: this.extractOutlookMeetingLink(item),
        organizer: item.organizer?.emailAddress ? {
          name: item.organizer.emailAddress.name,
          email: item.organizer.emailAddress.address
        } : null,
        attendees: (item.attendees || []).map(a => ({
          name: a.emailAddress?.name || a.emailAddress?.address?.split('@')[0],
          email: a.emailAddress?.address,
          responseStatus: this.mapOutlookResponseStatus(a.status?.response),
          self: false
        })),
        htmlLink: item.webLink,
        source: 'outlook-api'
      }));
  }

  /**
   * Extract meeting link from Outlook event
   */
  static extractOutlookMeetingLink(item) {
    // Priority 1: Online meeting URL
    if (item.onlineMeetingUrl) return item.onlineMeetingUrl;

    // Priority 2: Online meeting join URL
    if (item.onlineMeeting?.joinUrl) return item.onlineMeeting.joinUrl;

    // Priority 3: Look in location and body for meeting links
    const location = item.location?.displayName || '';
    const body = item.bodyPreview || '';
    const combined = location + ' ' + body;

    const linkPatterns = [
      /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<]+/i,
      /https:\/\/meet\.google\.com\/[a-z-]+/i,
      /https:\/\/[\w-]+\.zoom\.us\/j\/\d+[^\s"<]*/i,
      /https:\/\/[\w-]+\.webex\.com\/[^\s"<]+/i,
      /https:\/\/[\w-]+\.my\.webex\.com\/[^\s"<]+/i,
      /https:\/\/meetings\.ringcentral\.com\/[^\s"<]+/i,
      /https:\/\/v\.ringcentral\.com\/[^\s"<]+/i
    ];

    for (const pattern of linkPatterns) {
      const match = combined.match(pattern);
      if (match) return match[0];
    }

    return null;
  }

  /**
   * Map Outlook response status to standard format
   */
  static mapOutlookResponseStatus(status) {
    const statusMap = {
      'accepted': 'accepted',
      'tentativelyAccepted': 'tentative',
      'declined': 'declined',
      'notResponded': 'needsAction',
      'none': 'needsAction'
    };
    return statusMap[status] || 'needsAction';
  }

  /**
   * Get valid access token (auto-refresh if expired using refresh token or chrome.identity)
   */
  static async getValidToken() {
    const connection = await chrome.storage.local.get(this.STORAGE_KEY);
    const googleConnection = connection[this.STORAGE_KEY]?.google;

    if (!googleConnection?.connected || !googleConnection?.accessToken) {
      return null;
    }

    // Check if token is expired (with 5 min buffer)
    if (googleConnection.expiresAt && Date.now() > googleConnection.expiresAt - 300000) {
      console.log('PingMeet: Google token expired, attempting auto-refresh...');

      // Simple mode: Use chrome.identity to refresh with retry
      if (googleConnection.authMode === 'simple') {
        const maxRetries = 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            console.log(`PingMeet: Simple mode token refresh attempt ${attempt}/${maxRetries}`);

            // Remove cached token first
            await new Promise((resolve) => {
              chrome.identity.removeCachedAuthToken({ token: googleConnection.accessToken }, () => {
                resolve();
              });
            });

            // Get fresh token
            const newToken = await new Promise((resolve, reject) => {
              chrome.identity.getAuthToken({ interactive: false }, (token) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else if (!token) {
                  reject(new Error('No token received'));
                } else {
                  resolve(token);
                }
              });
            });

            // Update stored token
            await this.saveConnection('google', {
              ...googleConnection,
              accessToken: newToken,
              expiresAt: Date.now() + (3600 * 1000)
            });

            console.log('PingMeet: Google token refreshed successfully (Simple Mode)');
            return newToken;
          } catch (error) {
            lastError = error;
            console.warn(`PingMeet: Simple mode token refresh attempt ${attempt} failed:`, error.message);

            // Don't retry on certain errors
            if (error.message.includes('user') || 
                error.message.includes('denied') ||
                error.message.includes('not signed in')) {
              break;
            }

            // Wait before retry
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
            }
          }
        }

        console.error('PingMeet: Simple mode token refresh failed after retries', lastError);
        await this.saveConnection('google', { connected: false });
        this.notifyTokenExpired('Google Calendar');
        return null;
      }
      // Advanced mode: Try to refresh using refresh token
      else if (googleConnection.refreshToken) {
        try {
          const credentials = await this.getCredentials('google');
          if (!credentials?.clientId) {
            throw new Error('No client ID found');
          }

          const tokens = await this.refreshGoogleToken(
            googleConnection.refreshToken, 
            credentials.clientId,
            credentials.clientSecret  // Include client secret for Web Application OAuth
          );

          // Calculate new expiry time
          const expiresAt = Date.now() + (parseInt(tokens.expires_in) * 1000);

          // Update stored tokens
          await this.saveConnection('google', {
            ...googleConnection,
            accessToken: tokens.access_token,
            // Keep existing refresh token if new one not provided
            refreshToken: tokens.refresh_token || googleConnection.refreshToken,
            expiresAt: expiresAt
          });

          console.log('PingMeet: Google token refreshed successfully (Advanced Mode)');
          return tokens.access_token;
        } catch (error) {
          console.error('PingMeet: Token refresh failed', error);
          // Refresh failed - disconnect and notify user
          await this.saveConnection('google', { connected: false });
          this.notifyTokenExpired('Google Calendar');
          return null;
        }
      } else {
        // No refresh token available - legacy connection
        console.log('PingMeet: No refresh token, need re-authentication');
        await this.saveConnection('google', { connected: false });
        this.notifyTokenExpired('Google Calendar');
        return null;
      }
    }

    return googleConnection.accessToken;
  }

  /**
   * Fetch user info from Google
   */
  static async fetchGoogleUserInfo(token) {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user info');
    }

    return response.json();
  }

  /**
   * Fetch calendar events from Google Calendar API
   * Returns all events for the entire day
   */
  static async fetchGoogleEvents() {
    try {
      const token = await this.getValidToken();

      if (!token) {
        return { success: false, error: 'Not authenticated', events: [] };
      }

      // Fetch all events for the entire day (not just next 24 hours)
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      const params = new URLSearchParams({
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '100'
      });

      const response = await fetch(
        `${this.GOOGLE_CALENDAR_API}/calendars/primary/events?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired - disconnect and notify user
          await this.saveConnection('google', { connected: false });
          this.notifyTokenExpired('Google Calendar');
          return { success: false, error: 'Token expired. Please reconnect in Settings.', events: [] };
        }
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const events = this.parseGoogleEvents(data.items || []);

      console.log(`PingMeet: Fetched ${events.length} events from Google Calendar API`);
      return { success: true, events };
    } catch (error) {
      console.error('PingMeet: Error fetching Google events', error);
      return { success: false, error: error.message, events: [] };
    }
  }

  /**
   * Parse Google Calendar API events into PingMeet format
   */
  static parseGoogleEvents(items) {
    return items
      .filter(item => item.start?.dateTime) // Only timed events, not all-day
      .map(item => ({
        id: item.id,
        title: item.summary || 'Untitled Meeting',
        startTime: item.start.dateTime,
        endTime: item.end?.dateTime,
        location: item.location || '',
        description: item.description || '',
        meetingLink: this.extractMeetingLink(item),
        organizer: item.organizer ? {
          name: item.organizer.displayName || item.organizer.email,
          email: item.organizer.email
        } : null,
        attendees: (item.attendees || []).map(a => ({
          name: a.displayName || a.email?.split('@')[0],
          email: a.email,
          responseStatus: a.responseStatus || 'needsAction',
          self: a.self || false
        })),
        htmlLink: item.htmlLink,
        conferenceData: item.conferenceData,
        // Extract dial-in info from conference data
        dialIn: this.extractDialInInfo(item.conferenceData),
        // Source marker
        source: 'google-api'
      }));
  }

  /**
   * Extract meeting link from event
   */
  static extractMeetingLink(item) {
    // Priority 1: Google Meet link from conference data
    if (item.conferenceData?.entryPoints) {
      const videoEntry = item.conferenceData.entryPoints.find(e => e.entryPointType === 'video');
      if (videoEntry?.uri) return videoEntry.uri;
    }

    // Priority 2: hangoutLink
    if (item.hangoutLink) return item.hangoutLink;

    // Priority 3: Look in description for meeting links
    const description = item.description || '';
    const location = item.location || '';
    const combined = description + ' ' + location;

    const linkPatterns = [
      /https:\/\/meet\.google\.com\/[a-z-]+/i,
      /https:\/\/[\w-]+\.zoom\.us\/j\/\d+[^\s"<]*/i,
      /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<]+/i,
      /https:\/\/[\w-]+\.webex\.com\/[^\s"<]+/i,
      /https:\/\/[\w-]+\.my\.webex\.com\/[^\s"<]+/i,
      /https:\/\/meetings\.ringcentral\.com\/[^\s"<]+/i,
      /https:\/\/v\.ringcentral\.com\/[^\s"<]+/i
    ];

    for (const pattern of linkPatterns) {
      const match = combined.match(pattern);
      if (match) return match[0];
    }

    return null;
  }

  /**
   * Extract dial-in information from conference data
   */
  static extractDialInInfo(conferenceData) {
    if (!conferenceData?.entryPoints) return null;

    const phoneEntry = conferenceData.entryPoints.find(e => e.entryPointType === 'phone');
    if (!phoneEntry) return null;

    return {
      phoneNumber: phoneEntry.uri?.replace('tel:', '') || phoneEntry.label,
      pin: phoneEntry.pin,
      regionCode: phoneEntry.regionCode
    };
  }

  /**
   * Save connection status
   */
  static async saveConnection(provider, data) {
    const current = await chrome.storage.local.get(this.STORAGE_KEY);
    const connections = current[this.STORAGE_KEY] || {};

    connections[provider] = data;

    await chrome.storage.local.set({ [this.STORAGE_KEY]: connections });
  }

  /**
   * Get last sync time
   */
  static async getLastSync() {
    const data = await chrome.storage.local.get('lastCalendarSync');
    return data.lastCalendarSync || null;
  }

  /**
   * Update last sync time
   */
  static async updateLastSync() {
    await chrome.storage.local.set({ lastCalendarSync: new Date().toISOString() });
  }

  /**
   * Create a new Google Calendar event
   */
  static async createGoogleEvent(eventData) {
    try {
      const token = await this.getValidToken();
      if (!token) {
        return { success: false, error: 'Not authenticated' };
      }

      // Get timezone with fallback
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

      const event = {
        summary: eventData.title,
        start: {
          dateTime: eventData.startTime,
          timeZone: timeZone
        },
        end: {
          dateTime: eventData.endTime,
          timeZone: timeZone
        },
        description: eventData.description || '',
        location: eventData.location || ''
      };

      // Add conference data if meeting link requested
      if (eventData.addMeetLink) {
        event.conferenceData = {
          createRequest: {
            requestId: `pingmeet_${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        };
      }

      const response = await fetch(
        `${this.GOOGLE_CALENDAR_API}/calendars/primary/events?conferenceDataVersion=1`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(event)
        }
      );

      if (!response.ok) {
        const error = await response.json();
        return { success: false, error: error.error?.message || 'Failed to create event' };
      }

      const created = await response.json();
      console.log('PingMeet: Created Google Calendar event', created.id);

      return {
        success: true,
        event: {
          id: created.id,
          htmlLink: created.htmlLink,
          meetingLink: created.conferenceData?.entryPoints?.[0]?.uri
        }
      };
    } catch (error) {
      console.error('PingMeet: Error creating Google event', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create a new Outlook Calendar event
   */
  static async createOutlookEvent(eventData) {
    try {
      const token = await this.getValidOutlookToken();
      if (!token) {
        return { success: false, error: 'Not authenticated' };
      }

      // Get timezone with fallback
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

      const event = {
        subject: eventData.title,
        start: {
          dateTime: eventData.startTime,
          timeZone: timeZone
        },
        end: {
          dateTime: eventData.endTime,
          timeZone: timeZone
        },
        body: {
          contentType: 'text',
          content: eventData.description || ''
        },
        location: {
          displayName: eventData.location || ''
        }
      };

      // Add Teams meeting if requested
      if (eventData.addMeetLink) {
        event.isOnlineMeeting = true;
        event.onlineMeetingProvider = 'teamsForBusiness';
      }

      const response = await fetch(
        `${this.MS_GRAPH_API}/me/events`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(event)
        }
      );

      if (!response.ok) {
        const error = await response.json();
        return { success: false, error: error.error?.message || 'Failed to create event' };
      }

      const created = await response.json();
      console.log('PingMeet: Created Outlook event', created.id);

      return {
        success: true,
        event: {
          id: created.id,
          webLink: created.webLink,
          meetingLink: created.onlineMeeting?.joinUrl
        }
      };
    } catch (error) {
      console.error('PingMeet: Error creating Outlook event', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Decline a Google Calendar event
   */
  static async declineGoogleEvent(eventId) {
    try {
      const token = await this.getValidToken();
      if (!token) {
        return { success: false, error: 'Not authenticated' };
      }

      // Remove prefix if present (e.g., "outlook_abc123" -> "abc123")
      const cleanEventId = eventId.replace(/^(google_|outlook_)/, '');

      // First, fetch the event to get current attendees
      const getResponse = await fetch(
        `${this.GOOGLE_CALENDAR_API}/calendars/primary/events/${cleanEventId}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      if (!getResponse.ok) {
        const error = await getResponse.json();
        return { success: false, error: error.error?.message || 'Failed to fetch event' };
      }

      const event = await getResponse.json();

      // Find the current user's attendee entry and update their response
      let attendees = event.attendees || [];
      const userAttendee = attendees.find(a => a.self);

      if (userAttendee) {
        userAttendee.responseStatus = 'declined';
      } else {
        // If not found in attendees (unlikely), add as declined
        attendees.push({
          email: event.organizer?.email || '',
          responseStatus: 'declined',
          self: true
        });
      }

      // Update the event with the modified attendees list
      const patchResponse = await fetch(
        `${this.GOOGLE_CALENDAR_API}/calendars/primary/events/${cleanEventId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ attendees })
        }
      );

      if (!patchResponse.ok) {
        const error = await patchResponse.json();
        return { success: false, error: error.error?.message || 'Failed to decline event' };
      }

      console.log('PingMeet: Declined Google Calendar event', cleanEventId);
      return { success: true };
    } catch (error) {
      console.error('PingMeet: Error declining Google event', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Decline an Outlook Calendar event
   */
  static async declineOutlookEvent(eventId) {
    try {
      const token = await this.getValidOutlookToken();
      if (!token) {
        return { success: false, error: 'Not authenticated' };
      }

      // Remove prefix if present
      const cleanEventId = eventId.replace(/^(google_|outlook_)/, '');

      const response = await fetch(
        `${this.MS_GRAPH_API}/me/events/${cleanEventId}/decline`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            comment: 'Declined via PingMeet',
            sendResponse: true
          })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        return { success: false, error: error.error?.message || 'Failed to decline event' };
      }

      console.log('PingMeet: Declined Outlook event', cleanEventId);
      return { success: true };
    } catch (error) {
      console.error('PingMeet: Error declining Outlook event', error);
      return { success: false, error: error.message };
    }
  }
}
