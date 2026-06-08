/**
 * Notification Manager - Handles all attention-grabbing mechanisms
 * OS notifications, popup windows, sounds, and badge flashing
 */

import { StorageManager } from '../utils/storage.js';
import { logger } from '../utils/logger.js';
import { MESSAGE_TYPES, NOTIFICATION_PREFIX, BADGE_COLORS } from '../utils/constants.js';

export class NotificationManager {
  /**
   * Trigger all configured attention mechanisms
   * @param {Object} event - Meeting event object
   */
  static async triggerAttention(event) {
    const settings = await StorageManager.getSettings();

    logger.debug(`Triggering attention for "${event.title}"`);

    // DND / focus mode: active if either a manual "Quiet for X" timer is set
    // or NOW falls inside one of the user's recurring DND windows.
    const manualDnd = !!(settings.dndUntil && Date.now() < settings.dndUntil);
    const scheduledDnd = this.isInScheduledDnd(settings);
    const dndActive = manualDnd || scheduledDnd;
    if (dndActive) {
      logger.debug(
        `DND active (manual=${manualDnd}, scheduled=${scheduledDnd}) — suppressing loud surfaces`
      );
    }

    // Auto-snooze: if the user already has a tab open for this meeting's
    // join URL, they're either already in or about to be. Skip the loud
    // surfaces so we don't interrupt with a redundant popup over the meeting.
    const inMeeting = await this.isMeetingTabOpen(event);
    if (inMeeting) {
      logger.debug(`Meeting tab already open for "${event.title}" — auto-snoozing loud surfaces`);
    }

    // Working-hours respect: when enabled, suppress loud surfaces outside the
    // user's configured hours. Still rings for events the user has explicitly
    // accepted with a meeting invite (i.e., not declined/no response), since
    // those are deliberate.
    const outsideWorkHours = this.isOutsideWorkingHours(settings);
    if (outsideWorkHours) {
      logger.debug('Outside working hours — suppressing loud surfaces');
    }

    // VIP events override DND/working-hours suppression — these are flagged
    // by the user as important enough to interrupt for. Auto-snooze (already
    // in the meeting) still applies because firing a popup over the meeting
    // tab is never useful.
    const isVip = !!event._vip;
    const suppressLoud = inMeeting || (!isVip && (dndActive || outsideWorkHours));

    // 1. OS Notification (always — silent visual, respects OS DND if user has it)
    await this.showOSNotification(event);

    // 2. Popup Window (brings Chrome forward!)
    if (settings.showPopup !== false && !suppressLoud) {
      await this.showReminderWindow(event);
    }

    // 3. Sound
    if (settings.playSound !== false && !suppressLoud) {
      await this.playSound();
    }

    // 4. Voice Reminder
    if (settings.voiceReminder && !suppressLoud) {
      await this.speakReminder(event, settings);
    }

    // 5. Flash Badge
    await this.flashBadge(settings.reminderMinutes || 2);

    // 6. Auto-open meeting (optional)
    if (settings.autoOpen && event.meetingLink) {
      setTimeout(async () => {
        try {
          await chrome.tabs.create({ url: event.meetingLink, active: true });
        } catch (error) {
          logger.error('Auto-open error', error);
        }
      }, 500); // Small delay to ensure other mechanisms show first
    }
  }

  /**
   * Show OS notification
   * @param {Object} event - Meeting event object
   * @returns {Promise<string>} Notification ID
   */
  static async showOSNotification(event) {
    const notificationId = `${NOTIFICATION_PREFIX}${event.id}`;
    const settings = await StorageManager.getSettings();

    // Create dynamic title based on reminder time
    const reminderMinutes = settings.reminderMinutes || 2;
    let title = '⏰ Meeting starting ';
    if (reminderMinutes === 1) {
      title += 'in 1 minute!';
    } else if (reminderMinutes < 60) {
      title += `in ${reminderMinutes} minutes!`;
    } else {
      const hours = Math.floor(reminderMinutes / 60);
      const mins = reminderMinutes % 60;
      title += mins > 0 ? `in ${hours}h ${mins}m!` : `in ${hours} hour${hours > 1 ? 's' : ''}!`;
    }

    const notificationOptions = {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
      title: title,
      message: event.title || 'Untitled Meeting',
      priority: 2,
      requireInteraction: true,
    };

    // Add "Join Now" button if meeting link exists
    if (event.meetingLink) {
      notificationOptions.buttons = [{ title: '🚀 Join Now' }];
    }

    await chrome.notifications.create(notificationId, notificationOptions);

    logger.debug(`OS notification created for "${event.title}"`);
    return notificationId;
  }

  /**
   * Sanitize event data for JSON serialization
   * Removes complex nested objects that might cause circular references
   */
  static sanitizeEventData(event) {
    return {
      id: event.id,
      title: event.title,
      startTime: event.startTime,
      endTime: event.endTime,
      location: event.location,
      description: event.description,
      meetingLink: event.meetingLink,
      htmlLink: event.htmlLink,
      source: event.source,
      organizer: event.organizer
        ? {
            name: event.organizer.name,
            email: event.organizer.email,
          }
        : null,
      attendees: (event.attendees || []).map(a => ({
        name: a.name,
        email: a.email,
        responseStatus: a.responseStatus,
        self: a.self,
      })),
      dialIn: event.dialIn,
    };
  }

  /**
   * Show reminder popup window (key mechanism for bringing Chrome forward)
   * @param {Object} event - Meeting event object
   */
  static async showReminderWindow(event) {
    // Sanitize event data to avoid JSON serialization issues
    const sanitizedEvent = this.sanitizeEventData(event);
    const eventData = encodeURIComponent(JSON.stringify(sanitizedEvent));

    try {
      // Get all displays to determine optimal positioning
      const windowConfig = await this.calculateOptimalWindowPosition();

      await chrome.windows.create({
        url: chrome.runtime.getURL(`src/reminder/reminder.html?event=${eventData}`),
        type: 'popup',
        width: 480,
        height: 620,
        focused: true,
        top: windowConfig.top,
        left: windowConfig.left,
      });

      logger.debug(`Reminder window opened for "${event.title}"`);
    } catch (error) {
      logger.error('Error creating reminder window', error);
    }
  }

  /**
   * Calculate optimal window position based on available displays
   * @returns {Promise<{top: number, left: number}>}
   */
  static async calculateOptimalWindowPosition() {
    try {
      // Get the current focused window
      const currentWindow = await chrome.windows.getCurrent();

      if (currentWindow && currentWindow.top !== undefined && currentWindow.left !== undefined) {
        // Position relative to current window (centered)
        const windowWidth = 400;
        const windowHeight = 280;

        const left = currentWindow.left + Math.floor((currentWindow.width - windowWidth) / 2);
        const top = currentWindow.top + Math.floor((currentWindow.height - windowHeight) / 3);

        return {
          top: Math.max(50, top), // Ensure minimum distance from top
          left: Math.max(50, left), // Ensure minimum distance from left
        };
      }
    } catch (error) {
      logger.warn('Could not determine optimal window position', error);
    }

    // Fallback to safe default position
    return { top: 100, left: 100 };
  }

  /**
   * Play sound alert via offscreen document
   */
  static async playSound() {
    try {
      // Ensure offscreen document exists
      await this.ensureOffscreenDocument();

      // Wait a bit for offscreen document to initialize
      await this.sleep(100);

      // Send message to play sound with error handling
      try {
        await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.PLAY_SOUND });
        logger.debug('Sound alert triggered');
      } catch (msgError) {
        // If message fails, the offscreen document might not be ready
        logger.warn('Failed to send message to offscreen document:', msgError.message);

        // Try recreating the offscreen document and retry once
        await this.recreateOffscreenDocument();
        await this.sleep(150);
        await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.PLAY_SOUND });
        logger.debug('Sound alert triggered (retry succeeded)');
      }
    } catch (error) {
      logger.error('Error playing sound', error);
    }
  }

  /**
   * Ensure offscreen document exists (create if needed)
   */
  static async ensureOffscreenDocument() {
    // Check if offscreen document already exists
    const offscreenUrl = chrome.runtime.getURL('src/offscreen/offscreen.html');

    try {
      // Try to check existing contexts (Chrome 116+)
      if (chrome.runtime.getContexts) {
        const existingContexts = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT'],
          documentUrls: [offscreenUrl],
        });

        if (existingContexts.length > 0) {
          return; // Already exists
        }
      }
    } catch (e) {
      // getContexts not available, try creating anyway
    }

    // Try to create the offscreen document
    try {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play meeting reminder sound',
      });
    } catch (error) {
      // If error is "already exists", that's fine - ignore it
      if (!error.message?.includes('single offscreen document')) {
        throw error;
      }
    }
  }

  /**
   * Recreate offscreen document (close and create new)
   * Used when the existing document is unresponsive
   */
  static async recreateOffscreenDocument() {
    try {
      // Close existing offscreen document
      await chrome.offscreen.closeDocument();
      logger.debug('Closed existing offscreen document');
    } catch (error) {
      // Ignore error if no document exists
      logger.debug('No offscreen document to close');
    }

    // Create new offscreen document
    try {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play meeting reminder sound',
      });
      logger.debug('Created new offscreen document');
    } catch (error) {
      logger.error('Error creating offscreen document:', error);
      throw error;
    }
  }

  /**
   * Flash the extension badge for attention
   * @param {number} reminderMinutes - Minutes until meeting
   */
  static async flashBadge(reminderMinutes = 2) {
    const colors = [
      BADGE_COLORS.URGENT,
      BADGE_COLORS.WARNING,
      BADGE_COLORS.URGENT,
      BADGE_COLORS.WARNING,
      BADGE_COLORS.URGENT,
    ];

    try {
      for (let i = 0; i < colors.length; i++) {
        await chrome.action.setBadgeText({ text: '⏰' });
        await chrome.action.setBadgeBackgroundColor({ color: colors[i] });
        await this.sleep(300);
      }

      // Keep the urgent badge with actual reminder time
      await chrome.action.setBadgeText({ text: `${reminderMinutes}m` });
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.URGENT });

      logger.debug('Badge flashed');
    } catch (error) {
      logger.error('Error flashing badge', error);
    }
  }

  /**
   * Speak meeting reminder via Web Speech API
   * @param {Object} event - Meeting event object
   * @param {Object} _settings - User settings (reserved; not currently used)
   */
  static async speakReminder(event, _settings) {
    try {
      // Ensure offscreen document exists
      await this.ensureOffscreenDocument();

      // Wait a bit for offscreen document to initialize
      await this.sleep(100);

      // Calculate minutes until meeting
      const minutesUntil = Math.round((new Date(event.startTime) - new Date()) / 60000);

      // Create speech text
      const speechText = `Meeting reminder: ${event.title} starts in ${minutesUntil} minute${minutesUntil !== 1 ? 's' : ''}.`;

      // Send message to speak with error handling
      try {
        await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.SPEAK_REMINDER,
          text: speechText,
        });
        logger.debug('Voice reminder triggered');
      } catch (msgError) {
        // If message fails, the offscreen document might not be ready
        logger.warn('Failed to send message to offscreen document:', msgError.message);

        // Try recreating the offscreen document and retry once
        await this.recreateOffscreenDocument();
        await this.sleep(150);
        await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.SPEAK_REMINDER,
          text: speechText,
        });
        logger.debug('Voice reminder triggered (retry succeeded)');
      }
    } catch (error) {
      logger.error('Error speaking reminder', error);
    }
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise}
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Detect whether the user already has a tab open for this meeting's join URL.
   * If they do, skip loud surfaces — they're either already in the meeting or
   * about to join. Falls back to provider-domain match when the exact URL
   * doesn't show up (Meet/Zoom/Teams sometimes redirect on entry).
   */
  /**
   * Check whether NOW falls outside the user's configured working hours.
   * Returns false if the feature is off (default).
   */
  /**
   * Is NOW inside any of the user's recurring DND windows?
   * Each window: { days: [0..6], start: "HH:MM", end: "HH:MM" }.
   * Windows where end <= start are interpreted as crossing midnight
   * (e.g. start "22:00" end "07:00" ⇒ active 22:00 today through 07:00 tomorrow).
   */
  static isInScheduledDnd(settings) {
    const windows = Array.isArray(settings?.dndSchedule) ? settings.dndSchedule : [];
    if (windows.length === 0) return false;

    const now = new Date();
    const day = now.getDay();
    const minutes = now.getHours() * 60 + now.getMinutes();

    const parse = hhmm => {
      const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    };

    for (const w of windows) {
      const days = Array.isArray(w.days) ? w.days : [];
      const start = parse(w.start);
      const end = parse(w.end);
      if (start === null || end === null) continue;

      if (end > start) {
        if (days.includes(day) && minutes >= start && minutes < end) return true;
      } else {
        // Crosses midnight: active if (today is in days AND minutes >= start)
        // OR (yesterday is in days AND minutes < end)
        const yesterday = (day + 6) % 7;
        if (days.includes(day) && minutes >= start) return true;
        if (days.includes(yesterday) && minutes < end) return true;
      }
    }
    return false;
  }

  static isOutsideWorkingHours(settings) {
    if (!settings?.respectWorkingHours) return false;
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const workDays = Array.isArray(settings.workDays) ? settings.workDays : [1, 2, 3, 4, 5];
    const start = Number.isFinite(settings.workStartHour) ? settings.workStartHour : 9;
    const end = Number.isFinite(settings.workEndHour) ? settings.workEndHour : 18;
    if (!workDays.includes(day)) return true;
    if (hour < start || hour >= end) return true;
    return false;
  }

  static async isMeetingTabOpen(event) {
    if (!event?.meetingLink) return false;
    try {
      const link = String(event.meetingLink);
      const tabs = await chrome.tabs.query({});
      const lower = link.toLowerCase();

      // Exact match (post-normalize) wins.
      if (tabs.some(t => t.url && t.url.toLowerCase().startsWith(lower))) {
        return true;
      }

      // Fallback: provider host match. Pull a meeting code segment from the URL
      // to avoid matching unrelated zoom.us / meet.google.com tabs.
      const m = lower.match(/^https?:\/\/([^/]+)\/(.+)$/);
      if (!m) return false;
      const host = m[1];
      const path = m[2].split(/[?#]/)[0]; // strip query/fragment
      // Use first non-empty path segment as a meeting key
      const key = path.split('/').filter(Boolean)[0] || '';
      if (key.length < 3) return false;
      return tabs.some(t => {
        if (!t.url) return false;
        const u = t.url.toLowerCase();
        return u.includes(host) && u.includes(key);
      });
    } catch (error) {
      logger.warn('isMeetingTabOpen failed', error?.message);
      return false;
    }
  }
}
