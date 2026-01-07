/**
 * Background Service Worker - Main orchestration for PingMeet
 * Handles event scheduling, alarms, and notification triggering
 */

import { StorageManager } from '../utils/storage.js';
import { MESSAGE_TYPES, ALARM_NAMES, TIME, BADGE_COLORS } from '../utils/constants.js';
import { NotificationManager } from './notification-manager.js';
import { ConflictDetector } from '../utils/conflict-detector.js';
import { DailySummary } from './daily-summary.js';
import { CalendarAPI } from '../utils/calendar-api.js';
import { DurationTracker } from '../utils/duration-tracker.js';

class PingMeetService {
  constructor() {
    // Note: Avoid storing critical state in memory as service worker can be terminated
    // Use chrome.storage or chrome.alarms API for persistence
    this.activeMeetingTabId = null;
    this.isSyncing = false; // Mutex flag for sync operations (acceptable to lose on restart)
  }

  /**
   * Initialize the service worker
   */
  async init() {
    console.log('PingMeet: Service worker initialized');

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      this.handleMessage(message, _sender)
        .then(result => sendResponse(result))
        .catch(error => {
          console.error('PingMeet: Error handling message', error);
          sendResponse({ error: error.message });
        });
      return true; // Keep channel open for async response
    });

    // Listen for alarms
    chrome.alarms.onAlarm.addListener(alarm => {
      this.handleAlarm(alarm).catch(error => {
        console.error('PingMeet: Error handling alarm', error);
      });
    });

    // Listen for notification clicks
    chrome.notifications.onClicked.addListener(notificationId => {
      this.handleNotificationClick(notificationId).catch(error => {
        console.error('PingMeet: Error handling notification click', error);
      });
    });

    // Listen for notification button clicks
    chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
      this.handleNotificationButtonClick(notificationId, buttonIndex).catch(error => {
        console.error('PingMeet: Error handling notification button', error);
      });
    });

    // Load any previously stored events and reschedule
    await this.loadStoredEvents();

    // Initialize daily summary
    await DailySummary.init();

    // Set up periodic calendar API sync (every 2 minutes for better reliability)
    chrome.alarms.create('CALENDAR_API_SYNC', { periodInMinutes: 2 });

    // Set up periodic DOM sync trigger (every 2 minutes) for content scripts
    chrome.alarms.create('DOM_SYNC_TRIGGER', { periodInMinutes: 2 });

    // Set up proactive token refresh (every 15 minutes to keep tokens fresh)
    chrome.alarms.create('TOKEN_HEALTH_CHECK', { periodInMinutes: 15 });

    // Proactively refresh tokens on service worker startup (handles wake from sleep)
    await this.proactiveTokenRefresh();

    // Initial API sync if connected (with deduplication after)
    await this.syncFromCalendarAPI();

    // Deduplicate after initial sync to handle any race condition
    await this.deduplicateStoredEvents();

    // Listen for tab events to track meeting duration
    this.setupMeetingTabTracking();

    // Restore any active meeting tracking from before service worker restart
    await this.restoreActiveTabTracking();

    // Set up network connectivity monitoring
    this.setupConnectivityMonitoring();
  }

  /**
   * Set up monitoring for network connectivity changes
   * When network is restored after being offline, proactively refresh tokens
   */
  setupConnectivityMonitoring() {
    // Track last known online state
    let wasOnline = true;

    // Check connectivity periodically since service workers can't use addEventListener('online')
    // This runs every 30 seconds to detect connectivity changes
    setInterval(async () => {
      try {
        // Try a simple fetch to check connectivity
        const isOnline = await this.checkConnectivity();

        // If we just came back online after being offline
        if (isOnline && !wasOnline) {
          console.log('PingMeet: Network connectivity restored, refreshing tokens...');
          await this.proactiveTokenRefresh();
          await this.syncFromCalendarAPI();
        }

        wasOnline = isOnline;
      } catch (error) {
        wasOnline = false;
      }
    }, 30000); // Check every 30 seconds

    console.log('PingMeet: Network connectivity monitoring initialized');
  }

  /**
   * Check if we have network connectivity
   * @returns {Promise<boolean>} True if online
   */
  async checkConnectivity() {
    try {
      // Use a lightweight endpoint to check connectivity
      const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', {
        method: 'HEAD',
        mode: 'no-cors'
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Set up tab tracking for meeting duration
   */
  setupMeetingTabTracking() {
    // Track when tabs are closed
    chrome.tabs.onRemoved.addListener(async (tabId) => {
      if (this.activeMeetingTabId === tabId) {
        console.log('PingMeet: Meeting tab closed, stopping duration tracking');
        await DurationTracker.stopTracking();
        this.activeMeetingTabId = null;
      }
    });

    // Track when user navigates away from meeting
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (this.activeMeetingTabId === tabId && changeInfo.url) {
        // Check if navigated away from meeting platform
        const isMeetingUrl = this.isMeetingUrl(changeInfo.url);
        if (!isMeetingUrl) {
          console.log('PingMeet: Navigated away from meeting, stopping duration tracking');
          await DurationTracker.stopTracking();
          this.activeMeetingTabId = null;
        }
      }
    });
  }

  /**
   * Check if URL is a meeting platform
   */
  isMeetingUrl(url) {
    if (!url) return false;
    const meetingPatterns = [
      'meet.google.com',
      'zoom.us',
      'teams.microsoft.com',
      'webex.com',
      'gotomeeting.com',
      'bluejeans.com'
    ];
    return meetingPatterns.some(pattern => url.includes(pattern));
  }

  /**
   * Track meeting tab when user joins
   */
  async setActiveMeetingTab(tabId) {
    this.activeMeetingTabId = tabId;
    // Also store in storage in case service worker restarts
    await chrome.storage.local.set({ activeMeetingTabId: tabId });
    console.log('PingMeet: Now tracking meeting tab:', tabId);

    // Set up auto-stop based on scheduled meeting end time
    const activeTracking = await DurationTracker.getActiveTracking();
    if (activeTracking?.event?.endTime) {
      const endTime = new Date(activeTracking.event.endTime);
      const now = new Date();
      const msUntilEnd = endTime - now;

      if (msUntilEnd > 0) {
        // Create alarm to auto-stop tracking at meeting end time + 5 min buffer
        chrome.alarms.create('AUTO_STOP_MEETING_TRACKING', {
          when: endTime.getTime() + 5 * 60 * 1000
        });
        console.log('PingMeet: Auto-stop alarm set for', new Date(endTime.getTime() + 5 * 60 * 1000));
      }
    }
  }

  /**
   * Restore active meeting tab tracking on service worker restart
   */
  async restoreActiveTabTracking() {
    const result = await chrome.storage.local.get('activeMeetingTabId');
    if (result.activeMeetingTabId) {
      // Check if tab still exists
      try {
        const tab = await chrome.tabs.get(result.activeMeetingTabId);
        if (tab && this.isMeetingUrl(tab.url)) {
          this.activeMeetingTabId = result.activeMeetingTabId;
          console.log('PingMeet: Restored active meeting tab tracking:', this.activeMeetingTabId);
        } else {
          // Tab no longer on meeting site, stop tracking
          await DurationTracker.stopTracking();
          await chrome.storage.local.remove('activeMeetingTabId');
        }
      } catch (e) {
        // Tab no longer exists, stop tracking
        await DurationTracker.stopTracking();
        await chrome.storage.local.remove('activeMeetingTabId');
      }
    }
  }

  /**
   * Sync events from Calendar API (if connected)
   */
  async syncFromCalendarAPI() {
    try {
      const status = await CalendarAPI.getConnectionStatus();
      let allEvents = [];

      if (status.google) {
        console.log('PingMeet: Syncing from Google Calendar API...');
        const result = await CalendarAPI.fetchGoogleEvents();

        if (result.success && result.events.length > 0) {
          console.log(`PingMeet: Received ${result.events.length} events from Google API`);
          allEvents = allEvents.concat(result.events);
        } else if (!result.success) {
          console.warn('PingMeet: Google API sync failed:', result.error);
        }
      }

      if (status.outlook) {
        console.log('PingMeet: Syncing from Outlook Calendar API...');
        const result = await CalendarAPI.fetchOutlookEvents();

        if (result.success && result.events.length > 0) {
          console.log(`PingMeet: Received ${result.events.length} events from Outlook API`);
          allEvents = allEvents.concat(result.events);
        } else if (!result.success) {
          console.warn('PingMeet: Outlook API sync failed:', result.error);
        }
      }

      if (allEvents.length > 0) {
        await this.handleNewEvents(allEvents);
        await CalendarAPI.updateLastSync();
      }
    } catch (error) {
      console.error('PingMeet: Error syncing from Calendar API', error);
    }
  }

  /**
   * Trigger DOM sync by sending message to all calendar tabs
   * This ensures content scripts re-read the DOM even if the tab is idle
   */
  async triggerDOMSync() {
    try {
      // Find all tabs with Google Calendar or Outlook Calendar open
      const googleTabs = await chrome.tabs.query({ url: 'https://calendar.google.com/*' });
      const outlookTabs = await chrome.tabs.query({ url: ['https://outlook.office.com/*', 'https://outlook.live.com/*'] });

      const allCalendarTabs = [...googleTabs, ...outlookTabs];

      if (allCalendarTabs.length === 0) {
        console.log('PingMeet: No calendar tabs open for DOM sync');
        return;
      }

      console.log(`PingMeet: Triggering DOM sync on ${allCalendarTabs.length} calendar tab(s)`);

      // Send sync message to each tab
      for (const tab of allCalendarTabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_DOM_SYNC' });
        } catch (error) {
          // Tab might not have content script loaded yet, ignore
          console.log(`PingMeet: Could not send sync message to tab ${tab.id}:`, error.message);
        }
      }
    } catch (error) {
      console.error('PingMeet: Error triggering DOM sync', error);
    }
  }

  /**
   * Handle messages from content script or other components
   */
  async handleMessage(message, _sender) {
    switch (message.type) {
      case MESSAGE_TYPES.CALENDAR_EVENTS:
        await this.handleNewEvents(message.events);
        return { received: true, count: message.events.length };

      case MESSAGE_TYPES.SNOOZE:
        await this.handleSnooze(message.event, message.minutes);
        return { snoozed: true };

      case 'DECLINE_MEETING':
        await this.handleDecline(message.eventId);
        return { declined: true };

      case 'MEETING_TAB_OPENED':
        this.setActiveMeetingTab(message.tabId);
        return { tracking: true };

      case 'STOP_MEETING_TRACKING':
        await DurationTracker.stopTracking();
        this.activeMeetingTabId = null;
        return { stopped: true };

      case 'TEST_DAILY_SUMMARY':
        // Manual trigger for testing daily summary popup
        console.log('PingMeet: Manual daily summary trigger received');
        await DailySummary.sendDailySummary();
        return { triggered: true };

      default:
        return { error: 'Unknown message type' };
    }
  }

  /**
   * Handle meeting decline
   */
  async handleDecline(eventId) {
    try {
      // Cancel any pending alarms for this meeting
      await chrome.alarms.clear(`${ALARM_NAMES.MEETING_PREFIX}${eventId}`);

      // Remove from storage
      await StorageManager.removeEvent(eventId);

      console.log(`PingMeet: Declined and removed meeting ${eventId}`);
    } catch (error) {
      console.error('PingMeet: Error handling decline', error);
    }
  }

  /**
   * Handle new events from calendar
   */
  async handleNewEvents(events) {
    if (!events || events.length === 0) {
      console.log('PingMeet: No events received');
      return;
    }

    // Check which APIs are connected - if connected, prefer API over DOM
    const apiStatus = await CalendarAPI.getConnectionStatus();

    // Filter out DOM events when API is connected for that calendar
    // This prevents duplicate reminders from both sources
    let filteredEvents = events.filter(event => {
      const source = event.source || '';

      // If Google API is connected, skip Google DOM events
      if (apiStatus.google && source === 'google-dom') {
        console.log(`PingMeet: Skipping DOM event (API connected): ${event.title}`);
        return false;
      }

      // If Outlook API is connected, skip Outlook DOM events
      if (apiStatus.outlook && source === 'outlook-dom') {
        console.log(`PingMeet: Skipping DOM event (API connected): ${event.title}`);
        return false;
      }

      return true;
    });

    // Filter to only upcoming events (within next 24 hours)
    const now = new Date();
    const upcoming = filteredEvents.filter(event => {
      if (!event.startTime) return false;
      const startTime = new Date(event.startTime);
      const hoursUntil = (startTime - now) / TIME.ONE_HOUR_MS;
      return hoursUntil > 0 && hoursUntil <= 24;
    });

    console.log(`PingMeet: Processing ${upcoming.length} upcoming events (API status: Google=${apiStatus.google}, Outlook=${apiStatus.outlook})`);

    // Deduplicate events from different sources (same event in Google and Outlook)
    const uniqueEvents = this.deduplicateEvents(upcoming);

    console.log(`PingMeet: ${uniqueEvents.length} unique events after deduplication`);

    // Detect conflicts
    const conflicts = ConflictDetector.detectConflicts(uniqueEvents);
    if (conflicts.length > 0) {
      console.warn(`PingMeet: ${conflicts.length} scheduling conflicts detected`);

      // Add conflict info to events
      for (const event of uniqueEvents) {
        const eventConflicts = ConflictDetector.getConflictingEvents(event, uniqueEvents);
        if (eventConflicts.length > 0) {
          event.hasConflict = true;
          event.conflictCount = eventConflicts.length;
        }
      }
    }

    // Store events (with conflict info)
    await StorageManager.saveEvents(uniqueEvents);

    // Schedule alarms for each event
    for (const event of uniqueEvents) {
      await this.scheduleReminder(event);
    }

    // Update badge with count (show warning color if conflicts)
    await this.updateBadge(uniqueEvents.length, conflicts.length > 0);
  }

  /**
   * Schedule a reminder alarm for an event
   */
  async scheduleReminder(event) {
    if (!event.startTime) {
      console.warn('PingMeet: Event has no start time', event);
      return;
    }

    // Skip notifications for declined meetings
    const userAttendee = event.attendees?.find(a => a.self);
    if (userAttendee?.responseStatus === 'declined') {
      console.log(`PingMeet: Skipping reminder for declined meeting: ${event.title || 'Untitled'}`);
      return;
    }

    // Use normalized alarm key based on title + rounded start time
    // This prevents duplicate alarms for the same meeting from different sources
    const startTime = new Date(event.startTime);
    const roundedTime = Math.floor(startTime.getTime() / 60000) * 60000; // Round to minute
    const normalizedTitle = (event.title || '').toLowerCase().trim().replace(/\s+/g, '-');
    const alarmName = `${ALARM_NAMES.MEETING_PREFIX}${normalizedTitle}_${roundedTime}`;

    // Check Chrome's actual alarms (survives service worker restart)
    const existingAlarm = await chrome.alarms.get(alarmName);
    if (existingAlarm) {
      console.log(`PingMeet: Alarm already scheduled for ${event.title}`);
      return;
    }

    const settings = await StorageManager.getSettings();
    const reminderTime = new Date(
      startTime.getTime() - settings.reminderMinutes * TIME.ONE_MINUTE_MS
    );

    // Only schedule if reminder time is in the future
    if (reminderTime > new Date()) {
      await chrome.alarms.create(alarmName, {
        when: reminderTime.getTime(),
      });

      // Store event data using the ALARM NAME as key (not event.id)
      // This ensures we can retrieve it when the alarm fires
      await StorageManager.saveEvent(alarmName, event);

      console.log(
        `PingMeet: Scheduled reminder for "${event.title}" at ${reminderTime.toLocaleString()}`
      );
    } else {
      console.log(`PingMeet: Reminder time already passed for "${event.title}"`);
    }
  }

  /**
   * Handle alarm firing
   */
  async handleAlarm(alarm) {
    // Handle calendar API sync alarm
    if (alarm.name === 'CALENDAR_API_SYNC') {
      await this.syncFromCalendarAPI();
      return;
    }

    // Handle DOM sync trigger - notify content scripts to re-read calendar
    if (alarm.name === 'DOM_SYNC_TRIGGER') {
      await this.triggerDOMSync();
      return;
    }

    // Handle daily summary alarm
    if (alarm.name === 'daily_summary') {
      console.log('PingMeet: Daily summary alarm fired');
      await DailySummary.sendDailySummary();
      return;
    }

    // Handle auto-stop meeting tracking alarm
    if (alarm.name === 'AUTO_STOP_MEETING_TRACKING') {
      console.log('PingMeet: Auto-stop meeting tracking alarm fired');
      await DurationTracker.stopTracking();
      this.activeMeetingTabId = null;
      await chrome.storage.local.remove('activeMeetingTabId');
      return;
    }

    // Handle proactive token health check alarm
    if (alarm.name === 'TOKEN_HEALTH_CHECK') {
      console.log('PingMeet: Token health check alarm fired');
      await this.proactiveTokenRefresh();
      return;
    }

    // Handle meeting reminder alarms
    if (!alarm.name.startsWith(ALARM_NAMES.MEETING_PREFIX)) return;

    // Use the full alarm name as the storage key
    const event = await StorageManager.getEvent(alarm.name);

    if (event) {
      const isSnoozeAlarm = alarm.name.includes('_snooze');
      console.log(`PingMeet: Alarm fired for "${event.title}"${isSnoozeAlarm ? ' (snoozed)' : ''}`);
      await NotificationManager.triggerAttention(event);

      // Cleanup stored event data using alarm name
      await StorageManager.removeEvent(alarm.name);
    } else {
      console.warn(`PingMeet: No event found for alarm ${alarm.name}`);
    }
  }

  /**
   * Handle notification click
   */
  async handleNotificationClick(notificationId) {
    const eventId = notificationId.replace('pingmeet_', '');
    const event = await StorageManager.getEvent(eventId);

    if (event?.meetingLink) {
      await chrome.tabs.create({ url: event.meetingLink, active: true });
    }

    // Close notification
    await chrome.notifications.clear(notificationId);
  }

  /**
   * Handle notification button click
   */
  async handleNotificationButtonClick(notificationId, buttonIndex) {
    if (buttonIndex === 0) {
      // "Join Now" button
      await this.handleNotificationClick(notificationId);
    }
  }

  /**
   * Handle snooze request
   */
  async handleSnooze(event, minutes = 1) {
    const snoozeTime = Date.now() + minutes * TIME.ONE_MINUTE_MS;
    const alarmName = `${ALARM_NAMES.MEETING_PREFIX}${event.id}_snooze`;

    await chrome.alarms.create(alarmName, {
      when: snoozeTime,
    });

    // Use the full alarm name as storage key (consistent with scheduleReminder)
    await StorageManager.saveEvent(alarmName, event);

    console.log(`PingMeet: Snoozed "${event.title}" for ${minutes} minute(s)`);
  }

  /**
   * Update extension badge
   */
  async updateBadge(count, hasConflicts = false) {
    if (count > 0) {
      await chrome.action.setBadgeText({ text: count.toString() });
      // Use warning color if there are conflicts
      const color = hasConflicts ? BADGE_COLORS.WARNING : BADGE_COLORS.DEFAULT;
      await chrome.action.setBadgeBackgroundColor({ color });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  }

  /**
   * Load stored events and reschedule alarms
   */
  async loadStoredEvents() {
    const events = await StorageManager.getEvents();
    console.log(`PingMeet: Loading ${events.length} stored events`);

    for (const event of events) {
      await this.scheduleReminder(event);
    }
  }

  /**
   * Deduplicate events that may appear in both calendars
   * @param {Array} events - Array of events
   * @returns {Array} Deduplicated events
   */
  deduplicateEvents(events) {
    const seen = new Map();
    const result = [];

    for (const event of events) {
      // Create a key based on title and start time (within 1 minute tolerance)
      const startTime = new Date(event.startTime);
      const roundedTime = Math.floor(startTime.getTime() / 60000) * 60000; // Round to nearest minute
      const key = `${event.title.toLowerCase().trim()}_${roundedTime}`;

      if (seen.has(key)) {
        // Duplicate found - keep the one with more details
        const existing = seen.get(key);
        if (this.hasMoreDetails(event, existing)) {
          // Replace with the more detailed version
          const index = result.indexOf(existing);
          if (index !== -1) {
            result[index] = event;
            seen.set(key, event);
          }
        }
        // Skip this duplicate
      } else {
        // New event
        seen.set(key, event);
        result.push(event);
      }
    }

    return result;
  }

  /**
   * Compare two events to determine which has more details
   * @param {Object} a - First event
   * @param {Object} b - Second event
   * @returns {boolean} True if 'a' has more details than 'b'
   */
  hasMoreDetails(a, b) {
    const scoreA = (a.meetingLink ? 2 : 0) +
                   (a.attendees?.length || 0) +
                   (a.description?.length || 0) +
                   (a.location?.length || 0);

    const scoreB = (b.meetingLink ? 2 : 0) +
                   (b.attendees?.length || 0) +
                   (b.description?.length || 0) +
                   (b.location?.length || 0);

    return scoreA > scoreB;
  }

  /**
   * Deduplicate stored events and clean up duplicate alarms
   * Called after initial sync to handle any race conditions
   */
  async deduplicateStoredEvents() {
    try {
      const events = await StorageManager.getEvents();
      const uniqueEvents = this.deduplicateEvents(events);

      if (events.length !== uniqueEvents.length) {
        console.log(`PingMeet: Cleaned up ${events.length - uniqueEvents.length} duplicate events`);

        // Clear and re-save unique events
        await chrome.storage.local.set({ events: uniqueEvents });

        // Clear all existing meeting alarms and reschedule
        const alarms = await chrome.alarms.getAll();
        for (const alarm of alarms) {
          if (alarm.name.startsWith('meeting_')) {
            await chrome.alarms.clear(alarm.name);
          }
        }

        // Reschedule unique events
        for (const event of uniqueEvents) {
          await this.scheduleReminder(event);
        }
      }
    } catch (error) {
      console.error('PingMeet: Error deduplicating stored events', error);
    }
  }

  /**
   * Proactively refresh tokens to prevent disconnections
   * Called on service worker startup (wake from sleep) and periodically
   * This ensures tokens are always fresh and connections stay alive
   */
  async proactiveTokenRefresh() {
    try {
      console.log('PingMeet: Running proactive token refresh...');
      const status = await CalendarAPI.getConnectionStatus();

      // Refresh Google token if connected
      if (status.google) {
        try {
          console.log('PingMeet: Proactively refreshing Google token...');
          const token = await CalendarAPI.getValidToken();
          if (token) {
            console.log('PingMeet: Google token is valid/refreshed');
          } else {
            console.warn('PingMeet: Google token refresh returned null (may need reconnection)');
          }
        } catch (error) {
          console.warn('PingMeet: Proactive Google token refresh failed:', error.message);
          // Don't disconnect - the grace period logic in CalendarAPI handles this
        }
      }

      // Refresh Outlook token if connected
      if (status.outlook) {
        try {
          console.log('PingMeet: Proactively refreshing Outlook token...');
          const token = await CalendarAPI.getValidOutlookToken();
          if (token) {
            console.log('PingMeet: Outlook token is valid/refreshed');
          } else {
            console.warn('PingMeet: Outlook token refresh returned null (may need reconnection)');
          }
        } catch (error) {
          console.warn('PingMeet: Proactive Outlook token refresh failed:', error.message);
          // Don't disconnect - the grace period logic in CalendarAPI handles this
        }
      }

      console.log('PingMeet: Proactive token refresh complete');
    } catch (error) {
      console.error('PingMeet: Error in proactive token refresh:', error);
    }
  }
}

// Initialize service
const service = new PingMeetService();
service.init();
