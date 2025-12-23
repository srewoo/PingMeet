/**
 * Popup UI - Extension popup interface
 * Shows upcoming meetings and settings
 */

import { StorageManager } from '../utils/storage.js';
import { DurationTracker } from '../utils/duration-tracker.js';
import { ReportGenerator } from '../utils/report-generator.js';
import { CalendarAPI } from '../utils/calendar-api.js';
import { AIInsights } from '../utils/ai-insights.js';

class PopupUI {
  constructor() {
    this.events = [];
    this.settings = null;
    this.currentFilter = 'all'; // Track active calendar filter
  }

  /**
   * Initialize the popup
   */
  async init() {
    console.log('PingMeet: Popup initialized');

    // Load data
    await this.loadSettings();
    await this.loadEvents();

    // Set up event listeners
    this.setupEventListeners();
    this.setupAIEventListeners();
    this.setupQuickCreateListeners();

    // Update display
    this.renderEvents();
    this.populateSettings();
    await this.updateDurationStats();
    await this.updateCalendarConnectionStatus();
    await this.updateAIStatus();

    // Auto-refresh every 30 seconds
    setInterval(() => {
      this.loadEvents();
      this.updateDurationStats();
    }, 30000);
  }

  /**
   * Update duration statistics
   */
  async updateDurationStats() {
    try {
      const stats = await DurationTracker.getStatistics();
      document.getElementById('todayDuration').textContent = stats.today.formatted;
      document.getElementById('weekDuration').textContent = stats.week.formatted;
    } catch (error) {
      console.error('PingMeet: Error updating duration stats', error);
    }
  }

  /**
   * Set up button event listeners
   * Helper to safely add event listener with null check
   */
  safeAddEventListener(elementId, event, handler) {
    const element = document.getElementById(elementId);
    if (element) {
      element.addEventListener(event, handler);
    } else {
      console.warn(`PingMeet: Element '${elementId}' not found`);
    }
  }

  setupEventListeners() {
    this.safeAddEventListener('settingsBtn', 'click', () => this.showSettings());
    this.safeAddEventListener('backBtn', 'click', () => this.showMain());
    this.safeAddEventListener('saveBtn', 'click', () => this.saveSettings());
    this.safeAddEventListener('weeklyReportBtn', 'click', () => this.viewWeeklyReport());

    // Calendar filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const filter = e.currentTarget.dataset.filter;
        this.setCalendarFilter(filter);
      });
    });

    // Calendar connection toggle buttons
    this.safeAddEventListener('googleToggleBtn', 'click', () => this.toggleGoogleSetup());
    this.safeAddEventListener('outlookToggleBtn', 'click', () => this.toggleOutlookSetup());

    // Google Calendar connection buttons
    this.safeAddEventListener('googleConnectBtn', 'click', () => this.handleGoogleConnect());
    this.safeAddEventListener('googleDisconnectBtn', 'click', () => this.handleGoogleDisconnect());

    // Outlook Calendar buttons
    this.safeAddEventListener('outlookConnectBtn', 'click', () => this.handleOutlookConnect());
    this.safeAddEventListener('outlookDisconnectBtn', 'click', () => this.handleOutlookDisconnect());
    this.safeAddEventListener('outlookOpenBtn', 'click', () => this.openOutlookCalendar());

    // Footer help link
    const footerHelp = document.getElementById('footerHelp');
    if (footerHelp) {
      footerHelp.addEventListener('click', (e) => {
        e.preventDefault();
        this.showSettings();
        // Scroll to help section after a brief delay
        setTimeout(() => {
          const helpSection = document.querySelector('.help-section');
          if (helpSection) {
            helpSection.scrollIntoView({ behavior: 'smooth' });
          }
        }, 100);
      });
    }

    // Display actual extension ID in redirect URI
    this.displayRedirectUri();

    // Event delegation for decline buttons (dynamically created)
    document.addEventListener('click', async (e) => {
      if (e.target.closest('.event-decline-btn')) {
        const btn = e.target.closest('.event-decline-btn');
        const eventId = btn.dataset.eventId;
        const source = btn.dataset.source;
        await this.handleDeclineMeeting(eventId, source);
      }
    });
  }

  /**
   * Display the actual redirect URI for OAuth setup
   */
  displayRedirectUri() {
    const extensionId = chrome.runtime.id;
    const redirectUri = `https://${extensionId}.chromiumapp.org/`;

    const googleRedirectUriEl = document.getElementById('redirectUri');
    if (googleRedirectUriEl) {
      googleRedirectUriEl.textContent = redirectUri;
    }

    const outlookRedirectUriEl = document.getElementById('outlookRedirectUri');
    if (outlookRedirectUriEl) {
      outlookRedirectUriEl.textContent = redirectUri;
    }
  }

  /**
   * Toggle Google Calendar setup form visibility
   */
  toggleGoogleSetup() {
    const setup = document.getElementById('googleSetup');
    const toggleBtn = document.getElementById('googleToggleBtn');

    setup.classList.toggle('hidden');
    toggleBtn.classList.toggle('expanded');
  }

  /**
   * Toggle Outlook Calendar setup form visibility
   */
  toggleOutlookSetup() {
    const setup = document.getElementById('outlookSetup');
    const toggleBtn = document.getElementById('outlookToggleBtn');

    setup.classList.toggle('hidden');
    toggleBtn.classList.toggle('expanded');
  }

  /**
   * Open Outlook Calendar in new tab
   */
  openOutlookCalendar() {
    chrome.tabs.create({ url: 'https://outlook.office.com/calendar', active: true });
  }

  /**
   * Handle Outlook Calendar connect
   */
  async handleOutlookConnect() {
    const btn = document.getElementById('outlookConnectBtn');
    const clientIdInput = document.getElementById('outlookClientId');
    const clientId = clientIdInput.value.trim();

    // Validate Client ID
    if (!clientId) {
      alert('Please enter your Microsoft Application (client) ID');
      clientIdInput.focus();
      return;
    }

    // Basic GUID format validation
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!guidRegex.test(clientId)) {
      alert('Invalid Client ID format. It should be a GUID (e.g., xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)');
      clientIdInput.focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Connecting...';

    try {
      const result = await CalendarAPI.connectOutlook(clientId);
      if (result.success) {
        await this.updateCalendarConnectionStatus();
        // Fetch events from API
        await this.syncCalendarEvents();
      } else {
        alert('Failed to connect: ' + result.error);
      }
    } catch (error) {
      console.error('PingMeet: Outlook connection error', error);
      alert('Connection error: ' + error.message);
    } finally {
      btn.disabled = false;
      await this.updateCalendarConnectionStatus();
    }
  }

  /**
   * Handle Outlook Calendar disconnect
   */
  async handleOutlookDisconnect() {
    const btn = document.getElementById('outlookDisconnectBtn');

    btn.disabled = true;
    btn.textContent = 'Disconnecting...';

    try {
      const result = await CalendarAPI.disconnectOutlook();
      if (result.success) {
        await this.updateCalendarConnectionStatus();
        await this.loadEvents();
      } else {
        alert('Failed to disconnect: ' + result.error);
      }
    } catch (error) {
      console.error('PingMeet: Outlook disconnect error', error);
      alert('Disconnect error: ' + error.message);
    } finally {
      btn.disabled = false;
      await this.updateCalendarConnectionStatus();
    }
  }

  /**
   * Handle Google Calendar connect
   */
  async handleGoogleConnect() {
    const btn = document.getElementById('googleConnectBtn');
    const clientIdInput = document.getElementById('googleClientId');
    const clientSecretInput = document.getElementById('googleClientSecret');
    const clientId = clientIdInput.value.trim();
    const clientSecret = clientSecretInput.value.trim();

    // Validate Client ID
    if (!clientId) {
      alert('Please enter your Google OAuth Client ID');
      clientIdInput.focus();
      return;
    }

    if (!clientId.endsWith('.apps.googleusercontent.com')) {
      alert('Invalid Client ID. It should end with .apps.googleusercontent.com');
      clientIdInput.focus();
      return;
    }

    // Validate Client Secret
    if (!clientSecret) {
      alert('Please enter your Google OAuth Client Secret');
      clientSecretInput.focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Connecting...';

    try {
      const result = await CalendarAPI.connectGoogle(clientId, clientSecret);
      if (result.success) {
        await this.updateCalendarConnectionStatus();
        // Fetch events from API
        await this.syncCalendarEvents();
      } else {
        alert('Failed to connect: ' + result.error);
      }
    } catch (error) {
      console.error('PingMeet: Calendar connection error', error);
      alert('Connection error: ' + error.message);
    } finally {
      btn.disabled = false;
      await this.updateCalendarConnectionStatus();
    }
  }

  /**
   * Handle Google Calendar disconnect
   */
  async handleGoogleDisconnect() {
    const btn = document.getElementById('googleDisconnectBtn');

    btn.disabled = true;
    btn.textContent = 'Disconnecting...';

    try {
      const result = await CalendarAPI.disconnectGoogle();
      if (result.success) {
        await this.updateCalendarConnectionStatus();
        // Clear API-sourced events
        await this.loadEvents();
      } else {
        alert('Failed to disconnect: ' + result.error);
      }
    } catch (error) {
      console.error('PingMeet: Calendar disconnect error', error);
      alert('Disconnect error: ' + error.message);
    } finally {
      btn.disabled = false;
      await this.updateCalendarConnectionStatus();
    }
  }

  /**
   * Handle declining a meeting
   */
  async handleDeclineMeeting(eventId, source) {
    if (!confirm('Decline this meeting?')) {
      return;
    }

    try {
      let result;
      if (source.includes('google')) {
        result = await CalendarAPI.declineGoogleEvent(eventId);
      } else if (source.includes('outlook')) {
        result = await CalendarAPI.declineOutlookEvent(eventId);
      } else {
        alert('Cannot decline this event (unsupported source)');
        return;
      }

      if (result.success) {
        // Refresh events to show updated status
        await this.syncCalendarEvents();
        await this.loadEvents();
        this.renderEvents();
      } else {
        alert('Failed to decline meeting: ' + result.error);
      }
    } catch (error) {
      console.error('PingMeet: Error declining meeting', error);
      alert('Error declining meeting: ' + error.message);
    }
  }

  /**
   * Sync calendar events from connected APIs
   */
  async syncCalendarEvents() {
    const status = await CalendarAPI.getConnectionStatus();
    let allEvents = [];

    if (status.google) {
      const result = await CalendarAPI.fetchGoogleEvents();
      if (result.success && result.events.length > 0) {
        allEvents = allEvents.concat(result.events);
      }
    }

    if (status.outlook) {
      const result = await CalendarAPI.fetchOutlookEvents();
      if (result.success && result.events.length > 0) {
        allEvents = allEvents.concat(result.events);
      }
    }

    if (allEvents.length > 0) {
      // Send events to service worker
      await chrome.runtime.sendMessage({
        type: 'CALENDAR_EVENTS',
        events: allEvents,
        source: 'api'
      });
      await CalendarAPI.updateLastSync();
      await this.loadEvents();
    }
  }

  /**
   * Update calendar connection status UI
   */
  async updateCalendarConnectionStatus() {
    const status = await CalendarAPI.getConnectionStatus();
    const connection = await chrome.storage.local.get('calendarConnection');
    const googleCredentials = await CalendarAPI.getCredentials('google');
    const outlookCredentials = await CalendarAPI.getCredentials('outlook');

    // Google connection
    const googleCard = document.getElementById('googleConnection');
    const googleStatus = document.getElementById('googleStatus');
    const googleConnectBtn = document.getElementById('googleConnectBtn');
    const googleDisconnectBtn = document.getElementById('googleDisconnectBtn');
    const googleClientIdInput = document.getElementById('googleClientId');
    const googleClientSecretInput = document.getElementById('googleClientSecret');

    // Populate Google credentials fields if we have stored credentials
    if (googleCredentials?.clientId && googleClientIdInput) {
      googleClientIdInput.value = googleCredentials.clientId;
    }
    if (googleCredentials?.clientSecret && googleClientSecretInput) {
      googleClientSecretInput.value = googleCredentials.clientSecret;
    }

    if (status.google) {
      const email = connection.calendarConnection?.google?.email || 'Connected';
      googleCard.classList.add('connected');
      googleStatus.textContent = email;
      googleStatus.classList.add('connected');
      googleConnectBtn.classList.add('hidden');
      googleDisconnectBtn.classList.remove('hidden');
      googleDisconnectBtn.textContent = 'Disconnect';
    } else {
      googleCard.classList.remove('connected');
      googleStatus.textContent = 'Not connected';
      googleStatus.classList.remove('connected');
      googleConnectBtn.classList.remove('hidden');
      googleConnectBtn.textContent = 'Connect';
      googleDisconnectBtn.classList.add('hidden');
    }

    // Outlook connection
    const outlookCard = document.getElementById('outlookConnection');
    const outlookStatus = document.getElementById('outlookStatus');
    const outlookConnectBtn = document.getElementById('outlookConnectBtn');
    const outlookDisconnectBtn = document.getElementById('outlookDisconnectBtn');
    const outlookClientIdInput = document.getElementById('outlookClientId');

    // Populate Outlook Client ID field if we have stored credentials
    if (outlookCredentials?.clientId && outlookClientIdInput) {
      outlookClientIdInput.value = outlookCredentials.clientId;
    }

    if (status.outlook) {
      const email = connection.calendarConnection?.outlook?.email || 'Connected';
      outlookCard.classList.add('connected');
      outlookStatus.textContent = email;
      outlookStatus.classList.add('connected');
      outlookConnectBtn.classList.add('hidden');
      outlookDisconnectBtn.classList.remove('hidden');
      outlookDisconnectBtn.textContent = 'Disconnect';
    } else {
      outlookCard.classList.remove('connected');
      outlookStatus.textContent = 'Not connected';
      outlookStatus.classList.remove('connected');
      outlookConnectBtn.classList.remove('hidden');
      outlookConnectBtn.textContent = 'Connect';
      outlookDisconnectBtn.classList.add('hidden');
    }

    // Show API warning if neither Google nor Outlook API is connected
    const apiWarning = document.getElementById('apiWarning');
    if (apiWarning) {
      if (!status.google && !status.outlook) {
        apiWarning.classList.remove('hidden');
      } else {
        apiWarning.classList.add('hidden');
      }
    }

    // Update status text to show sync method and frequency
    const statusText = document.getElementById('statusText');
    if (statusText) {
      if (status.google || status.outlook) {
        const connectedServices = [];
        if (status.google) connectedServices.push('Google');
        if (status.outlook) connectedServices.push('Outlook');
        statusText.textContent = `API Connected (${connectedServices.join(' & ')}) • Syncing every 2 min`;
      } else {
        statusText.textContent = 'Monitoring calendar tabs...';
      }
    }
  }

  /**
   * View weekly report
   */
  async viewWeeklyReport() {
    try {
      await ReportGenerator.openReport();
    } catch (error) {
      console.error('PingMeet: Error generating report', error);
      alert('Error generating report. Please try again.');
    }
  }

  /**
   * Load settings from storage
   */
  async loadSettings() {
    this.settings = await StorageManager.getSettings();
  }

  /**
   * Load events from storage
   */
  async loadEvents() {
    this.events = await StorageManager.getEvents();
    this.renderEvents();
  }

  /**
   * Set calendar filter and re-render
   */
  setCalendarFilter(filter) {
    this.currentFilter = filter;

    // Update active button
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    this.renderEvents();
  }

  /**
   * Render events list
   */
  renderEvents() {
    const eventsList = document.getElementById('eventsList');

    if (!this.events || this.events.length === 0) {
      eventsList.innerHTML =
        '<div class="no-events">No upcoming meetings found.<br>Make sure Google Calendar or Outlook is open.</div>';
      return;
    }

    // Apply calendar filter
    let filteredEvents = this.events;
    if (this.currentFilter === 'google') {
      filteredEvents = this.events.filter(e =>
        e.source === 'google-api' || e.source === 'google-dom'
      );
    } else if (this.currentFilter === 'outlook') {
      filteredEvents = this.events.filter(e =>
        e.source === 'outlook-api' || e.source === 'outlook-dom'
      );
    }

    // Sort by start time
    const sortedEvents = [...filteredEvents].sort((a, b) => {
      return new Date(a.startTime) - new Date(b.startTime);
    });

    // Limit to next 10 events (increased from 5 for unified view)
    const displayEvents = sortedEvents.slice(0, 10);

    if (displayEvents.length === 0) {
      eventsList.innerHTML = '<div class="no-events">No events from this calendar.</div>';
      return;
    }

    eventsList.innerHTML = displayEvents.map(event => this.renderEventItem(event)).join('');
  }

  /**
   * Render a single event item
   */
  renderEventItem(event) {
    const startTime = new Date(event.startTime);
    const now = new Date();
    const diff = startTime - now;

    // Format time
    const timeStr = startTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    // Format countdown
    let countdownStr = '';
    if (diff > 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (hours > 0) {
        countdownStr = `in ${hours}h ${minutes}m`;
      } else if (minutes > 0) {
        countdownStr = `in ${minutes}m`;
      } else {
        countdownStr = 'starting now!';
      }
    } else {
      countdownStr = 'started';
    }

    // Add conflict warning if present
    const conflictWarning = event.hasConflict
      ? `<span class="conflict-warning" title="Overlaps with ${event.conflictCount} other meeting${event.conflictCount > 1 ? 's' : ''}">!</span>`
      : '';

    // Check user's response status
    const userAttendee = event.attendees?.find(a => a.self);
    const userStatus = userAttendee?.responseStatus || 'needsAction';
    const isDeclined = userStatus === 'declined';

    // Action buttons
    const meetingLinkHtml = event.meetingLink && !isDeclined
      ? `<a href="${event.meetingLink}" class="event-link" target="_blank" title="Join meeting"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 10l4-4M7 4h5v5M4 7v5h5"/></svg></a>`
      : '';

    const declineButtonHtml = !isDeclined && (event.source?.includes('google') || event.source?.includes('outlook'))
      ? `<button class="event-decline-btn" data-event-id="${event.id}" data-source="${event.source}" title="Decline meeting"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 4L4 12M4 4l8 8"/></svg></button>`
      : '';

    const actionsHtml = (meetingLinkHtml || declineButtonHtml)
      ? `<div class="event-actions">${meetingLinkHtml}${declineButtonHtml}</div>`
      : '';

    // Attendees preview
    const attendeesHtml = this.renderAttendees(event);

    // Description/location preview
    const detailsHtml = this.renderEventDetails(event);

    // Source badge
    const sourceType = event.source?.includes('google') ? 'google' :
                       event.source?.includes('outlook') ? 'outlook' : null;
    const sourceBadge = sourceType ?
      `<span class="event-source-badge ${sourceType}">${sourceType}</span>` : '';

    // Declined badge
    const declinedBadge = isDeclined
      ? `<span class="event-declined-badge">Declined</span>`
      : '';

    return `
      <div class="event-item ${event.hasConflict ? 'has-conflict' : ''} ${isDeclined ? 'declined' : ''}" data-event-id="${event.id}">
        <div class="event-time">${timeStr}</div>
        <div class="event-details">
          <div class="event-title">
            ${conflictWarning}
            <span class="event-title-text">${this.escapeHtml(event.title || 'Untitled Meeting')}</span>
            ${sourceBadge}
            ${declinedBadge}
          </div>
          <div class="event-countdown">${countdownStr}</div>
          ${attendeesHtml}
          ${detailsHtml}
        </div>
        ${actionsHtml}
      </div>
    `;
  }

  /**
   * Render attendees list
   */
  renderAttendees(event) {
    if (!event.attendees || event.attendees.length === 0) {
      return '';
    }

    const maxDisplay = 3;
    const displayAttendees = event.attendees.slice(0, maxDisplay);
    const remaining = event.attendees.length - maxDisplay;

    const attendeeNames = displayAttendees.map(a => {
      const name = a.name || a.email.split('@')[0];
      const statusClass = a.responseStatus === 'accepted' ? 'accepted' :
                          a.responseStatus === 'declined' ? 'declined' : 'tentative';
      const statusText = a.responseStatus === 'accepted' ? 'Y' :
                         a.responseStatus === 'declined' ? 'N' : '?';
      return `<span class="attendee" title="${this.escapeHtml(a.email)} (${a.responseStatus})"><span class="attendee-status ${statusClass}">${statusText}</span> ${this.escapeHtml(name)}</span>`;
    }).join('');

    const remainingHtml = remaining > 0 ? ` <span class="attendee-more">+${remaining}</span>` : '';

    return `<div class="event-attendees"><span class="attendees-label">With</span>${attendeeNames}${remainingHtml}</div>`;
  }

  /**
   * Render event details (description, location)
   */
  renderEventDetails(event) {
    const parts = [];

    if (event.location) {
      parts.push(`<span class="meta-location">${this.escapeHtml(event.location)}</span>`);
    }

    if (event.description && event.description.length > 0) {
      const shortDesc = event.description.length > 50
        ? event.description.substring(0, 47) + '...'
        : event.description;
      parts.push(`<span class="meta-description">${this.escapeHtml(shortDesc)}</span>`);
    }

    if (parts.length === 0) return '';

    return `<div class="event-meta">${parts.join('<span class="meta-separator">·</span>')}</div>`;
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Populate settings form
   */
  populateSettings() {
    document.getElementById('reminderMinutes').value = this.settings.reminderMinutes;
    document.getElementById('playSound').checked = this.settings.playSound;
    document.getElementById('voiceReminder').checked = this.settings.voiceReminder || false;
    document.getElementById('showPopup').checked = this.settings.showPopup;
    document.getElementById('autoOpen').checked = this.settings.autoOpen;
    document.getElementById('dailySummary').checked = this.settings.dailySummary !== false;
  }

  /**
   * Save settings
   */
  async saveSettings() {
    const newSettings = {
      reminderMinutes: parseInt(document.getElementById('reminderMinutes').value),
      playSound: document.getElementById('playSound').checked,
      voiceReminder: document.getElementById('voiceReminder').checked,
      showPopup: document.getElementById('showPopup').checked,
      autoOpen: document.getElementById('autoOpen').checked,
      dailySummary: document.getElementById('dailySummary').checked,
    };

    const saveBtn = document.getElementById('saveBtn');
    const originalText = saveBtn.textContent;

    try {
      await StorageManager.saveSettings(newSettings);
      this.settings = newSettings;

      // Visual feedback for success
      saveBtn.textContent = 'Saved';
      saveBtn.style.background = '#28a745';

      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.style.background = '';
        this.showMain();
      }, 1000);
    } catch (error) {
      console.error('PingMeet: Failed to save settings', error);

      // Visual feedback for error
      saveBtn.textContent = 'Error!';
      saveBtn.style.background = '#dc3545';

      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.style.background = '';
      }, 2000);

      alert('Failed to save settings: ' + error.message);
    }
  }

  /**
   * Show settings view
   */
  showSettings() {
    document.getElementById('mainView').classList.add('hidden');
    document.getElementById('settingsView').classList.remove('hidden');
  }

  /**
   * Show main view
   */
  showMain() {
    document.getElementById('settingsView').classList.add('hidden');
    document.getElementById('mainView').classList.remove('hidden');
  }

  /**
   * Set up AI-related event listeners
   */
  setupAIEventListeners() {
    document.getElementById('aiSaveKeyBtn').addEventListener('click', () => this.saveAIKey());
    document.getElementById('aiRemoveKeyBtn').addEventListener('click', () => this.removeAIKey());
    document.getElementById('refreshInsightsBtn').addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent toggling accordion
      e.preventDefault();
      this.loadInsights(true);
    });

    // Provider change handler
    document.getElementById('aiProvider').addEventListener('change', (e) => this.onProviderChange(e.target.value));

    // Temperature slider handler
    const tempSlider = document.getElementById('aiTemperature');
    const tempValue = document.getElementById('temperatureValue');
    tempSlider.addEventListener('input', (e) => {
      tempValue.textContent = e.target.value;
    });

    // Model change handler - hide temperature for reasoning models
    document.getElementById('aiModel').addEventListener('change', (e) => this.onModelChange(e.target.value));

    // Initialize provider-specific UI
    this.onProviderChange(document.getElementById('aiProvider').value);
  }

  /**
   * Handle provider change
   */
  onProviderChange(provider) {
    const modelSelect = document.getElementById('aiModel');
    const customEndpointGroup = document.getElementById('customEndpointGroup');
    const apiKeyInput = document.getElementById('aiApiKey');

    // Show/hide custom endpoint
    if (provider === 'custom') {
      customEndpointGroup.classList.remove('hidden');
    } else {
      customEndpointGroup.classList.add('hidden');
    }

    // Update model options based on provider
    const modelOptions = {
      openai: [
        { value: 'gpt-4o', label: 'GPT-4o' },
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
        { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
        { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
        { value: 'o1', label: 'O1 (Reasoning)' },
        { value: 'o1-mini', label: 'O1 Mini (Reasoning)' }
      ],
      anthropic: [
        { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4.5' },
        { value: 'claude-3-5-sonnet-20241022', label: 'Claude Sonnet 3.5' },
        { value: 'claude-3-5-haiku-20241022', label: 'Claude Haiku 3.5' },
        { value: 'claude-3-opus-20240229', label: 'Claude Opus 3' }
      ],
      google: [
        { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash' },
        { value: 'gemini-2.0-pro-exp', label: 'Gemini 2.0 Pro' },
        { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
        { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' }
      ],
      custom: [
        { value: 'custom-model', label: 'Custom Model (specify in endpoint)' }
      ]
    };

    // Update model dropdown
    modelSelect.innerHTML = '';
    modelOptions[provider].forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      modelSelect.appendChild(option);
    });

    // Update placeholder
    const placeholders = {
      openai: 'sk-...',
      anthropic: 'sk-ant-...',
      google: 'AIza...',
      custom: 'Enter your API key'
    };
    apiKeyInput.placeholder = placeholders[provider];

    // Add helper text for custom provider
    const customHelp = document.getElementById('customEndpointGroup');
    if (provider === 'custom' && customHelp) {
      const helpNote = customHelp.querySelector('.custom-help-note');
      if (!helpNote) {
        const note = document.createElement('p');
        note.className = 'custom-help-note';
        note.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-top: 4px;';
        note.textContent = 'Enter an OpenAI-compatible API endpoint (e.g., Ollama, LM Studio, local LLMs)';
        customHelp.appendChild(note);
      }
    }

    // Trigger model change to update temperature visibility
    this.onModelChange(modelSelect.value);
  }

  /**
   * Handle model change - hide temperature for reasoning models
   */
  onModelChange(model) {
    const temperatureGroup = document.getElementById('temperatureGroup');

    // O1 models don't support temperature parameter
    if (model.startsWith('o1')) {
      temperatureGroup.classList.add('hidden');
    } else {
      temperatureGroup.classList.remove('hidden');
    }
  }

  /**
   * Update AI configuration status
   */
  async updateAIStatus() {
    const config = await AIInsights.getConfig();
    const statusEl = document.getElementById('aiStatus');
    const saveBtn = document.getElementById('aiSaveKeyBtn');
    const removeBtn = document.getElementById('aiRemoveKeyBtn');
    const keyInput = document.getElementById('aiApiKey');
    const insightsCard = document.getElementById('insightsCard');

    if (config) {
      // Load saved configuration
      document.getElementById('aiProvider').value = config.provider || 'openai';
      this.onProviderChange(config.provider || 'openai');
      document.getElementById('aiModel').value = config.model || 'gpt-4o-mini';
      document.getElementById('aiTemperature').value = config.temperature || 0.7;
      document.getElementById('temperatureValue').textContent = config.temperature || 0.7;
      if (config.customEndpoint) {
        document.getElementById('aiCustomEndpoint').value = config.customEndpoint;
      }
      this.onModelChange(config.model || 'gpt-4o-mini');

      statusEl.classList.add('configured');
      statusEl.querySelector('.ai-status-text').textContent = `AI insights enabled (${config.provider})`;
      saveBtn.classList.add('hidden');
      removeBtn.classList.remove('hidden');
      keyInput.value = '••••••••••••••••';
      keyInput.disabled = true;
      insightsCard.classList.remove('hidden');

      // Disable selects
      document.getElementById('aiProvider').disabled = true;
      document.getElementById('aiModel').disabled = true;
      document.getElementById('aiTemperature').disabled = true;

      // Load insights
      await this.loadInsights();
    } else {
      statusEl.classList.remove('configured');
      statusEl.querySelector('.ai-status-text').textContent = 'Not configured';
      saveBtn.classList.remove('hidden');
      removeBtn.classList.add('hidden');
      keyInput.value = '';
      keyInput.disabled = false;
      insightsCard.classList.add('hidden');

      // Enable selects
      document.getElementById('aiProvider').disabled = false;
      document.getElementById('aiModel').disabled = false;
      document.getElementById('aiTemperature').disabled = false;
    }
  }

  /**
   * Save AI configuration
   */
  async saveAIKey() {
    const key = document.getElementById('aiApiKey').value.trim();
    const provider = document.getElementById('aiProvider').value;
    const model = document.getElementById('aiModel').value;
    const temperature = parseFloat(document.getElementById('aiTemperature').value);
    const customEndpoint = document.getElementById('aiCustomEndpoint').value.trim();

    if (!key) {
      alert('Please enter your API key');
      return;
    }

    // Validate key format based on provider
    const keyPatterns = {
      openai: /^sk-/,
      anthropic: /^sk-ant-/,
      google: /^AIza/,
      custom: /.+/ // Any non-empty key for custom
    };

    if (!keyPatterns[provider].test(key)) {
      const examples = {
        openai: 'sk-...',
        anthropic: 'sk-ant-...',
        google: 'AIza...',
        custom: 'valid API key'
      };
      alert(`Please enter a valid ${provider} API key (format: ${examples[provider]})`);
      return;
    }

    // Validate custom endpoint
    if (provider === 'custom' && !customEndpoint) {
      alert('Please enter a custom API endpoint URL');
      return;
    }

    const config = {
      apiKey: key,
      provider,
      model,
      temperature: model.startsWith('o1') ? undefined : temperature, // O1 models don't support temperature
      customEndpoint: provider === 'custom' ? customEndpoint : undefined
    };

    await AIInsights.saveConfig(config);
    await this.updateAIStatus();
  }

  /**
   * Remove AI API key
   */
  async removeAIKey() {
    if (confirm('Remove AI API key? Insights will no longer be generated.')) {
      await AIInsights.removeApiKey();
      await this.updateAIStatus();
    }
  }

  /**
   * Load and display AI insights
   * @param {boolean} forceRefresh - Whether to force refresh insights (default: false)
   */
  async loadInsights(forceRefresh = false) {
    // Ensure boolean type (fixes Issue #15: type coercion)
    forceRefresh = forceRefresh === true;

    const insightsList = document.getElementById('insightsList');
    const isConfigured = await AIInsights.isConfigured();

    // Show local insights even without AI key
    let insights;
    let isAIPowered = false;

    if (isConfigured) {
      insightsList.innerHTML = '<div class="insights-loading">Analyzing your schedule...</div>';

      if (forceRefresh) {
        await chrome.storage.local.remove('aiInsightsCache');
      }

      const result = await AIInsights.generateInsights(this.events);
      if (result.success) {
        insights = result.insights;
        isAIPowered = true;
      } else {
        // Fallback to local insights
        insights = AIInsights.generateLocalInsights(this.events);
        isAIPowered = false;
      }
    } else {
      // Use local insights only
      insights = AIInsights.generateLocalInsights(this.events);
      isAIPowered = false;

      // Show insights card if there are local insights
      if (insights.length > 0) {
        document.getElementById('insightsCard').classList.remove('hidden');
      }
    }

    this.renderInsights(insights, isAIPowered);
  }

  /**
   * Render insights list
   * @param {Array} insights - Array of insight objects
   * @param {boolean} isAIPowered - Whether insights are AI-generated or local
   */
  renderInsights(insights, isAIPowered = false) {
    const insightsList = document.getElementById('insightsList');

    if (!insights || insights.length === 0) {
      insightsList.innerHTML = '<div class="insight-item info"><span>Your schedule looks good!</span></div>';
      return;
    }

    const icons = {
      warning: `<svg class="insight-icon" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
      </svg>`,
      suggestion: `<svg class="insight-icon" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
      </svg>`,
      info: `<svg class="insight-icon" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
      </svg>`
    };

    // Add source indicator (Issue #27: distinguish AI vs local insights)
    const sourceLabel = isAIPowered
      ? '<div class="insights-source ai-powered"><span class="source-badge">AI</span></div>'
      : '<div class="insights-source local"><span class="source-badge">Local</span></div>';

    insightsList.innerHTML = sourceLabel + insights.map(insight => `
      <div class="insight-item ${insight.type || 'info'}">
        ${icons[insight.type] || icons.info}
        <span>${this.escapeHtml(insight.text)}</span>
      </div>
    `).join('');
  }

  /**
   * Set up quick create event listeners
   */
  setupQuickCreateListeners() {
    document.getElementById('quickCreateBtn').addEventListener('click', () => this.showQuickCreateForm());
    document.getElementById('closeFormBtn').addEventListener('click', () => this.hideQuickCreateForm());
    document.getElementById('cancelCreateBtn').addEventListener('click', () => this.hideQuickCreateForm());
    document.getElementById('createEventBtn').addEventListener('click', () => this.createEvent());

    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('eventDate').value = today;

    // Set default times (next hour to hour after)
    const now = new Date();
    const nextHour = new Date(now.setHours(now.getHours() + 1, 0, 0, 0));
    const hourAfter = new Date(nextHour.getTime() + 60 * 60 * 1000);

    document.getElementById('eventStartTime').value = nextHour.toTimeString().slice(0, 5);
    document.getElementById('eventEndTime').value = hourAfter.toTimeString().slice(0, 5);
  }

  /**
   * Show quick create form
   */
  async showQuickCreateForm() {
    // Update calendar options based on connections
    const status = await CalendarAPI.getConnectionStatus();
    const select = document.getElementById('eventCalendar');

    // Reset options
    select.innerHTML = '<option value="">Select calendar...</option>';

    if (status.google) {
      select.innerHTML += '<option value="google">Google Calendar</option>';
    }
    if (status.outlook) {
      select.innerHTML += '<option value="outlook">Outlook Calendar</option>';
    }

    if (!status.google && !status.outlook) {
      alert('Please connect a calendar first in Settings to create events.');
      return;
    }

    // Auto-select if only one option
    if (status.google && !status.outlook) {
      select.value = 'google';
    } else if (!status.google && status.outlook) {
      select.value = 'outlook';
    }

    document.getElementById('quickCreateBtn').classList.add('hidden');
    document.getElementById('quickCreateForm').classList.remove('hidden');
  }

  /**
   * Hide quick create form
   */
  hideQuickCreateForm() {
    document.getElementById('quickCreateForm').classList.add('hidden');
    document.getElementById('quickCreateBtn').classList.remove('hidden');

    // Reset form
    document.getElementById('eventTitle').value = '';
    document.getElementById('eventLocation').value = '';
    document.getElementById('eventDescription').value = '';
    document.getElementById('addMeetLink').checked = false;
  }

  /**
   * Create new calendar event
   */
  async createEvent() {
    const title = document.getElementById('eventTitle').value.trim();
    const date = document.getElementById('eventDate').value;
    const startTime = document.getElementById('eventStartTime').value;
    const endTime = document.getElementById('eventEndTime').value;
    const calendar = document.getElementById('eventCalendar').value;
    const location = document.getElementById('eventLocation').value.trim();
    const description = document.getElementById('eventDescription').value.trim();
    const addMeetLink = document.getElementById('addMeetLink').checked;

    // Validation
    if (!title) {
      alert('Please enter a meeting title');
      return;
    }
    if (!date || !startTime || !endTime) {
      alert('Please select date and time');
      return;
    }
    if (!calendar) {
      alert('Please select a calendar');
      return;
    }

    // Build datetime strings
    const startDateTime = `${date}T${startTime}:00`;
    const endDateTime = `${date}T${endTime}:00`;

    // Validate times
    if (new Date(endDateTime) <= new Date(startDateTime)) {
      alert('End time must be after start time');
      return;
    }

    const createBtn = document.getElementById('createEventBtn');
    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    try {
      const eventData = {
        title,
        startTime: startDateTime,
        endTime: endDateTime,
        location,
        description,
        addMeetLink
      };

      let result;
      if (calendar === 'google') {
        result = await CalendarAPI.createGoogleEvent(eventData);
      } else {
        result = await CalendarAPI.createOutlookEvent(eventData);
      }

      if (result.success) {
        // Show success
        createBtn.textContent = 'Created!';
        createBtn.style.background = '#28a745';

        // Refresh events list
        await this.syncCalendarEvents();

        setTimeout(() => {
          this.hideQuickCreateForm();
          createBtn.disabled = false;
          createBtn.textContent = 'Create Event';
          createBtn.style.background = '';
        }, 1500);
      } else {
        alert('Failed to create event: ' + result.error);
        createBtn.disabled = false;
        createBtn.textContent = 'Create Event';
      }
    } catch (error) {
      console.error('PingMeet: Error creating event', error);
      alert('Error creating event: ' + error.message);
      createBtn.disabled = false;
      createBtn.textContent = 'Create Event';
    }
  }
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const popup = new PopupUI();
    popup.init();
  });
} else {
  const popup = new PopupUI();
  popup.init();
}
