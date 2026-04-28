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
import { logger } from '../utils/logger.js';
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
    logger.debug('Service worker initialized');

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      this.handleMessage(message, _sender)
        .then(result => sendResponse(result))
        .catch(error => {
          logger.error('Error handling message', error);
          sendResponse({ error: error.message });
        });
      return true; // Keep channel open for async response
    });

    // Listen for alarms
    chrome.alarms.onAlarm.addListener(alarm => {
      this.handleAlarm(alarm).catch(error => {
        logger.error('Error handling alarm', error);
      });
    });

    // Listen for notification clicks
    chrome.notifications.onClicked.addListener(notificationId => {
      this.handleNotificationClick(notificationId).catch(error => {
        logger.error('Error handling notification click', error);
      });
    });

    // Listen for notification button clicks
    chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
      this.handleNotificationButtonClick(notificationId, buttonIndex).catch(error => {
        logger.error('Error handling notification button', error);
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

    // Set up connectivity monitoring (every 1 minute to detect network restoration)
    chrome.alarms.create('CONNECTIVITY_CHECK', { periodInMinutes: 1 });

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
  }

  /**
   * Check network connectivity and handle reconnection
   * Called by CONNECTIVITY_CHECK alarm every minute
   */
  async checkAndHandleConnectivity() {
    try {
      // Get stored connectivity state
      const result = await chrome.storage.local.get('lastConnectivityState');
      const wasOnline = result.lastConnectivityState !== false; // Default to true if not set

      // Check current connectivity
      const isOnline = await this.checkConnectivity();

      // Store current state
      await chrome.storage.local.set({ lastConnectivityState: isOnline });

      // If we just came back online after being offline
      if (isOnline && !wasOnline) {
        logger.debug('Network connectivity restored, refreshing tokens...');
        await this.proactiveTokenRefresh();
        await this.syncFromCalendarAPI();
      }
    } catch (error) {
      logger.error('Error checking connectivity', error);
      await chrome.storage.local.set({ lastConnectivityState: false });
    }
  }

  /**
   * Check if we have network connectivity
   * @returns {Promise<boolean>} True if online
   */
  async checkConnectivity() {
    try {
      // Use a lightweight endpoint to check connectivity
      await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', {
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
        logger.debug('Meeting tab closed, stopping duration tracking');
        await DurationTracker.stopTracking();
        this.activeMeetingTabId = null;
      }
    });

    // Track when user navigates away from meeting
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, _tab) => {
      if (this.activeMeetingTabId === tabId && changeInfo.url) {
        // Check if navigated away from meeting platform
        const isMeetingUrl = this.isMeetingUrl(changeInfo.url);
        if (!isMeetingUrl) {
          logger.debug('Navigated away from meeting, stopping duration tracking');
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
    logger.debug('Now tracking meeting tab:', tabId);

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
        logger.debug('Auto-stop alarm set for', new Date(endTime.getTime() + 5 * 60 * 1000));
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
          logger.debug('Restored active meeting tab tracking:', this.activeMeetingTabId);
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
        logger.debug('Syncing from Google Calendar API...');
        const result = await CalendarAPI.fetchGoogleEvents();

        if (result.success && result.events.length > 0) {
          logger.debug(`Received ${result.events.length} events from Google API`);
          allEvents = allEvents.concat(result.events);
        } else if (!result.success) {
          logger.warn('Google API sync failed:', result.error);
        }
      }

      if (status.outlook) {
        logger.debug('Syncing from Outlook Calendar API...');
        const result = await CalendarAPI.fetchOutlookEvents();

        if (result.success && result.events.length > 0) {
          logger.debug(`Received ${result.events.length} events from Outlook API`);
          allEvents = allEvents.concat(result.events);
        } else if (!result.success) {
          logger.warn('Outlook API sync failed:', result.error);
        }
      }

      if (allEvents.length > 0) {
        await this.handleNewEvents(allEvents);
        await CalendarAPI.updateLastSync();
      }
    } catch (error) {
      logger.error('Error syncing from Calendar API', error);
    }
  }

  /**
   * Trigger DOM sync — but only for providers WITHOUT an active OAuth connection.
   *
   * Why: previously API sync and DOM sync ran in parallel every 2 minutes. When
   * a user has OAuth connected, the API is the source of truth and DOM scraping
   * just produces duplicates and dedup churn. DOM is now strictly a fallback for
   * providers the user hasn't authenticated.
   */
  async triggerDOMSync() {
    try {
      const status = await CalendarAPI.getConnectionStatus();

      const tabQueries = [];
      if (!status.google) {
        tabQueries.push(chrome.tabs.query({ url: 'https://calendar.google.com/*' }));
      }
      if (!status.outlook) {
        tabQueries.push(
          chrome.tabs.query({
            url: ['https://outlook.office.com/*', 'https://outlook.live.com/*'],
          })
        );
      }

      if (tabQueries.length === 0) {
        // Both providers connected via API — DOM sync not needed.
        return;
      }

      const tabGroups = await Promise.all(tabQueries);
      const allCalendarTabs = tabGroups.flat();

      if (allCalendarTabs.length === 0) {
        return;
      }

      for (const tab of allCalendarTabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_DOM_SYNC' });
        } catch {
          // Tab might not have content script loaded yet — ignore.
        }
      }
    } catch (error) {
      logger.error('Error triggering DOM sync', error);
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
        logger.debug('Manual daily summary trigger received');
        await DailySummary.sendDailySummary();
        return { triggered: true };

      case 'TRIGGER_DOM_SYNC':
        await this.triggerDOMSync();
        await this.syncFromCalendarAPI();
        return { triggered: true };

      case 'SNOOZE_ALL':
        return { snoozed: await this.handleSnoozeAll(message.minutes || 15) };

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

      logger.debug(`Declined and removed meeting ${eventId}`);
    } catch (error) {
      logger.error('Error handling decline', error);
    }
  }

  /**
   * Handle new events from calendar
   */
  async handleNewEvents(events) {
    if (!events || events.length === 0) {
      logger.debug('No events received');
      return;
    }

    // Get old events before processing new ones (for cleanup comparison)
    const oldEvents = await StorageManager.getEvents();

    // Check which APIs are connected - if connected, prefer API over DOM
    const apiStatus = await CalendarAPI.getConnectionStatus();

    // Filter out DOM events when API is connected for that calendar
    // This prevents duplicate reminders from both sources
    const filteredEvents = events.filter(event => {
      const source = event.source || '';

      // If Google API is connected, skip Google DOM events
      if (apiStatus.google && source === 'google-dom') {
        logger.debug(`Skipping DOM event (API connected): ${event.title}`);
        return false;
      }

      // If Outlook API is connected, skip Outlook DOM events
      if (apiStatus.outlook && source === 'outlook-dom') {
        logger.debug(`Skipping DOM event (API connected): ${event.title}`);
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

    logger.debug(`Processing ${upcoming.length} upcoming events (API status: Google=${apiStatus.google}, Outlook=${apiStatus.outlook})`);

    // Deduplicate events from different sources (same event in Google and Outlook)
    const uniqueEvents = this.deduplicateEvents(upcoming);

    logger.debug(`${uniqueEvents.length} unique events after deduplication`);

    // Detect conflicts
    const conflicts = ConflictDetector.detectConflicts(uniqueEvents);
    if (conflicts.length > 0) {
      logger.warn(`${conflicts.length} scheduling conflicts detected`);

      // Add conflict info to events
      for (const event of uniqueEvents) {
        const eventConflicts = ConflictDetector.getConflictingEvents(event, uniqueEvents);
        if (eventConflicts.length > 0) {
          event.hasConflict = true;
          event.conflictCount = eventConflicts.length;
        }
      }
    }

    // Clean up alarms for removed events (before storing new events)
    await this.cleanupRemovedEventAlarms(oldEvents, uniqueEvents);

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
      logger.warn('Event has no start time', event);
      return;
    }

    // Skip notifications for declined meetings
    const userAttendee = event.attendees?.find(a => a.self);
    if (userAttendee?.responseStatus === 'declined') {
      logger.debug(`Skipping reminder for declined meeting: ${event.title || 'Untitled'}`);
      return;
    }

    // Skip Out-of-Office and Focus Time events — these are user-blocked time,
    // not meetings to be reminded of. Provided by Google Calendar's eventType.
    if (event.eventType === 'outOfOffice' || event.eventType === 'focusTime') {
      logger.debug(`Skipping reminder for ${event.eventType}: ${event.title || 'Untitled'}`);
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
      logger.debug(`Alarm already scheduled for ${event.title}`);
      return;
    }

    const settings = await StorageManager.getSettings();
    const offsetMinutes = this.computeReminderOffset(event, settings);
    const reminderTime = new Date(
      startTime.getTime() - offsetMinutes * TIME.ONE_MINUTE_MS
    );

    // Only schedule if reminder time is in the future
    if (reminderTime > new Date()) {
      await chrome.alarms.create(alarmName, {
        when: reminderTime.getTime(),
      });

      // Store event data using the ALARM NAME as key (not event.id)
      // This ensures we can retrieve it when the alarm fires
      await StorageManager.saveEvent(alarmName, event);

      logger.debug(`Scheduled reminder for "${event.title}" at ${reminderTime.toLocaleString()}`
      );
    } else {
      logger.debug(`Reminder time already passed for "${event.title}"`);
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
      logger.debug('Daily summary alarm fired');
      await DailySummary.sendDailySummary();
      return;
    }

    // Handle auto-stop meeting tracking alarm
    if (alarm.name === 'AUTO_STOP_MEETING_TRACKING') {
      logger.debug('Auto-stop meeting tracking alarm fired');
      await DurationTracker.stopTracking();
      this.activeMeetingTabId = null;
      await chrome.storage.local.remove('activeMeetingTabId');
      return;
    }

    // Handle proactive token health check alarm
    if (alarm.name === 'TOKEN_HEALTH_CHECK') {
      logger.debug('Token health check alarm fired');
      await this.proactiveTokenRefresh();
      return;
    }

    // Handle connectivity check alarm
    if (alarm.name === 'CONNECTIVITY_CHECK') {
      await this.checkAndHandleConnectivity();
      // Piggy-back the badge countdown on this 1-min alarm so the "Xm" tick
      // stays current without burning an extra alarm slot.
      try {
        const events = await StorageManager.getEvents();
        const upcoming = events.filter(e => new Date(e.startTime).getTime() > Date.now());
        await this.updateBadge(upcoming.length);
      } catch (e) {
        logger.warn('Badge tick failed', e?.message);
      }
      return;
    }

    // Handle meeting reminder alarms
    if (!alarm.name.startsWith(ALARM_NAMES.MEETING_PREFIX)) return;

    // Use the full alarm name as the storage key
    const event = await StorageManager.getEvent(alarm.name);

    if (event) {
      const isSnoozeAlarm = alarm.name.includes('_snooze');
      logger.debug(`Alarm fired for "${event.title}"${isSnoozeAlarm ? ' (snoozed)' : ''}`);
      // Tag VIP so NotificationManager can override DND for these.
      const settings = await StorageManager.getSettings();
      if (this.isVipEvent(event, settings)) {
        event._vip = true;
      }
      await NotificationManager.triggerAttention(event);

      // Cleanup stored event data using alarm name
      await StorageManager.removeEvent(alarm.name);
    } else {
      logger.warn(`No event found for alarm ${alarm.name}`);
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
  /**
   * Compute the reminder offset in minutes for an event. When
   * settings.smartReminderOffset is true, classify the meeting:
   *   - external (>=1 attendee whose email domain differs from organizer/self)
   *     → 5 min (more prep time for cross-org calls)
   *   - internal with attendees → 2 min
   *   - solo or 1-on-1 → 1 min
   * Otherwise returns the user's configured static offset.
   */
  computeReminderOffset(event, settings) {
    const fallback = Number.isFinite(settings.reminderMinutes) ? settings.reminderMinutes : 2;
    // VIP override always wins — give the user max prep time for these.
    if (this.isVipEvent(event, settings)) return Math.max(fallback, 5);
    if (!settings.smartReminderOffset) return fallback;

    const attendees = Array.isArray(event.attendees) ? event.attendees : [];
    if (attendees.length <= 1) return 1;

    // Find self / organizer domain to use as the "internal" baseline.
    const selfEmail = (attendees.find(a => a.self)?.email || event.organizer?.email || '').toLowerCase();
    const baseDomain = selfEmail.split('@')[1];
    if (!baseDomain) return fallback;

    const hasExternal = attendees.some(a => {
      const dom = (a.email || '').toLowerCase().split('@')[1];
      return dom && dom !== baseDomain;
    });

    if (hasExternal) return 5;
    return 2;
  }

  /**
   * Decide whether an event is "VIP" — meaning the organizer matches one of
   * the user's flagged emails or domains. VIP events bypass DND for the
   * popup and get a longer reminder offset.
   */
  isVipEvent(event, settings) {
    const list = Array.isArray(settings?.vipOrganizers) ? settings.vipOrganizers : [];
    if (list.length === 0) return false;
    const email = (event?.organizer?.email || '').toLowerCase();
    if (!email) return false;
    return list.some(entry => {
      const e = String(entry).toLowerCase().trim();
      if (!e) return false;
      if (e.startsWith('@')) return email.endsWith(e); // domain match
      if (e.includes('@')) return email === e;          // exact email
      return email.endsWith('@' + e);                   // bare domain
    });
  }

  async handleSnooze(event, minutes = 1) {
    const snoozeTime = Date.now() + minutes * TIME.ONE_MINUTE_MS;
    const alarmName = `${ALARM_NAMES.MEETING_PREFIX}${event.id}_snooze`;

    await chrome.alarms.create(alarmName, {
      when: snoozeTime,
    });

    // Use the full alarm name as storage key (consistent with scheduleReminder)
    await StorageManager.saveEvent(alarmName, event);

    logger.debug(`Snoozed "${event.title}" for ${minutes} minute(s)`);
  }

  /**
   * Snooze ALL pending meeting reminders by `minutes`. Returns the count of
   * alarms shifted. Alarms that would already fire later than the snooze
   * target are left untouched (no point pulling them earlier).
   */
  async handleSnoozeAll(minutes = 15) {
    const target = Date.now() + minutes * TIME.ONE_MINUTE_MS;
    const alarms = await chrome.alarms.getAll();
    let count = 0;
    for (const alarm of alarms) {
      if (!alarm.name.startsWith(ALARM_NAMES.MEETING_PREFIX)) continue;
      if (alarm.scheduledTime >= target) continue;
      // Reschedule by clearing + recreating; preserve the stored event payload.
      await chrome.alarms.clear(alarm.name);
      await chrome.alarms.create(alarm.name, { when: target });
      count++;
    }
    logger.debug(`Snoozed ${count} pending reminders by ${minutes} minute(s)`);
    return count;
  }

  /**
   * Update extension badge
   */
  async updateBadge(count, hasConflicts = false) {
    // Smart badge: when the next event is within an hour, show "Xm" countdown;
    // otherwise show the upcoming-count.
    let text = '';
    let color = BADGE_COLORS.DEFAULT;

    if (count > 0) {
      const events = await StorageManager.getEvents();
      const now = Date.now();
      const upcoming = events
        .map(e => ({ e, t: new Date(e.startTime).getTime() }))
        .filter(({ t }) => t > now)
        .sort((a, b) => a.t - b.t);

      if (upcoming.length) {
        const minsUntil = Math.round((upcoming[0].t - now) / 60000);
        if (minsUntil <= 60) {
          text = `${minsUntil}m`;
          color = minsUntil <= 5 ? BADGE_COLORS.URGENT : BADGE_COLORS.WARNING;
        } else {
          text = String(count);
          color = hasConflicts ? BADGE_COLORS.WARNING : BADGE_COLORS.DEFAULT;
        }
      } else {
        text = '';
      }
    }

    await chrome.action.setBadgeText({ text });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ color });
    }
  }

  /**
   * Load stored events and reschedule alarms
   */
  async loadStoredEvents() {
    const events = await StorageManager.getEvents();
    logger.debug(`Loading ${events.length} stored events`);

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
   * Generate normalized alarm name for an event
   * Uses the same logic as scheduleReminder to ensure consistency
   * @param {Object} event - Event object
   * @returns {string} Normalized alarm name
   */
  generateAlarmName(event) {
    if (!event.startTime) return null;

    const startTime = new Date(event.startTime);
    const roundedTime = Math.floor(startTime.getTime() / 60000) * 60000; // Round to minute
    const normalizedTitle = (event.title || '').toLowerCase().trim().replace(/\s+/g, '-');
    return `${ALARM_NAMES.MEETING_PREFIX}${normalizedTitle}_${roundedTime}`;
  }

  /**
   * Clean up alarms for events that were removed from calendar
   * @param {Array} oldEvents - Previous events list
   * @param {Array} newEvents - Updated events list
   */
  async cleanupRemovedEventAlarms(oldEvents, newEvents) {
    if (!oldEvents || oldEvents.length === 0) {
      return; // No old events to compare
    }

    // Create a Set of new event alarm names for fast lookup
    const newEventAlarmNames = new Set();
    for (const event of newEvents) {
      const alarmName = this.generateAlarmName(event);
      if (alarmName) {
        newEventAlarmNames.add(alarmName);
      }
    }

    // Find removed events by checking which old events are not in new events
    const removedEvents = [];
    for (const oldEvent of oldEvents) {
      const alarmName = this.generateAlarmName(oldEvent);
      if (alarmName && !newEventAlarmNames.has(alarmName)) {
        removedEvents.push(oldEvent);
      }
    }

    if (removedEvents.length === 0) {
      return; // No events were removed
    }

    logger.debug(`Detected ${removedEvents.length} removed event(s), cleaning up alarms...`);

    // Cancel alarms for removed events
    let canceledCount = 0;
    for (const event of removedEvents) {
      const alarmName = this.generateAlarmName(event);
      if (alarmName) {
        const wasCleared = await chrome.alarms.clear(alarmName);
        if (wasCleared) {
          canceledCount++;
          logger.debug(`Canceled alarm for removed event: ${event.title}`);

          // Also remove stored event data
          await StorageManager.removeEvent(alarmName);
        }
      }
    }

    logger.debug(`Cleaned up ${canceledCount} alarm(s) for removed events`);
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
        logger.debug(`Cleaned up ${events.length - uniqueEvents.length} duplicate events`);

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
      logger.error('Error deduplicating stored events', error);
    }
  }

  /**
   * Proactively refresh tokens to prevent disconnections
   * Called on service worker startup (wake from sleep) and periodically
   * This ensures tokens are always fresh and connections stay alive
   */
  async proactiveTokenRefresh() {
    try {
      logger.debug('Running proactive token refresh...');
      const status = await CalendarAPI.getConnectionStatus();

      // Refresh Google token if connected
      if (status.google) {
        try {
          logger.debug('Proactively refreshing Google token...');
          const token = await CalendarAPI.getValidToken();
          if (token) {
            logger.debug('Google token is valid/refreshed');
          } else {
            logger.warn('Google token refresh returned null (may need reconnection)');
          }
        } catch (error) {
          logger.warn('Proactive Google token refresh failed:', error.message);
          // Don't disconnect - the grace period logic in CalendarAPI handles this
        }
      }

      // Refresh Outlook token if connected
      if (status.outlook) {
        try {
          logger.debug('Proactively refreshing Outlook token...');
          const token = await CalendarAPI.getValidOutlookToken();
          if (token) {
            logger.debug('Outlook token is valid/refreshed');
          } else {
            logger.warn('Outlook token refresh returned null (may need reconnection)');
          }
        } catch (error) {
          logger.warn('Proactive Outlook token refresh failed:', error.message);
          // Don't disconnect - the grace period logic in CalendarAPI handles this
        }
      }

      logger.debug('Proactive token refresh complete');
    } catch (error) {
      logger.error('Error in proactive token refresh:', error);
    }
  }
}

// Initialize service
const service = new PingMeetService();
service.init();
