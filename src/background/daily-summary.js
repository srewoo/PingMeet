/**
 * Daily Summary - Morning overview of meetings
 * Sends notification at 10:00 AM with today's meeting schedule
 */

import { StorageManager } from '../utils/storage.js';
import { NotificationManager } from './notification-manager.js';

export class DailySummary {
  /**
   * Initialize daily summary
   */
  static async init() {
    // Set up daily alarm for 10:00 AM
    await this.scheduleDailySummary();
  }

  /**
   * Schedule daily summary alarm
   */
  static async scheduleDailySummary() {
    // Calculate next 10 AM
    const now = new Date();
    let next10AM = new Date();
    next10AM.setHours(10, 0, 0, 0);

    // If it's already past 10 AM today, schedule for tomorrow
    if (now >= next10AM) {
      next10AM.setDate(next10AM.getDate() + 1);
    }

    await chrome.alarms.create('daily_summary', {
      when: next10AM.getTime(),
      periodInMinutes: 24 * 60, // Repeat every 24 hours
    });

    console.log(`PingMeet: Daily summary scheduled for ${next10AM.toLocaleString()}`);
  }

  /**
   * Generate and send daily summary
   */
  static async sendDailySummary() {
    try {
      // Check if daily summary is enabled in settings
      const isEnabled = await this.isEnabled();
      if (!isEnabled) {
        console.log('PingMeet: Daily summary is disabled in settings');
        return;
      }

      const events = await StorageManager.getEvents();
      const now = new Date();

      // Get start and end of today
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      // Filter for today's events (all events today, not just future ones)
      const todaysEvents = events.filter(event => {
        const startTime = new Date(event.startTime);
        return startTime >= startOfDay && startTime <= endOfDay;
      });

      // Sort by start time
      todaysEvents.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

      // Play sound alert
      await NotificationManager.playSound();

      // Show popup window with daily summary
      await this.showDailySummaryPopup(todaysEvents);

      // Also send OS notification as a secondary alert
      await this.sendOSNotification(todaysEvents);

      console.log(`PingMeet: Daily summary sent for ${todaysEvents.length} meetings`);
    } catch (error) {
      console.error('PingMeet: Error sending daily summary', error);
    }
  }

  /**
   * Show daily summary popup window
   * @param {Array} events - Today's events
   */
  static async showDailySummaryPopup(events) {
    try {
      // Sanitize events data for URL encoding
      const sanitizedEvents = events.map(event => ({
        id: event.id,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        meetingLink: event.meetingLink,
        htmlLink: event.htmlLink,
        attendees: (event.attendees || []).map(a => ({
          name: a.name,
          email: a.email
        })),
        hasConflict: event.hasConflict
      }));

      const eventsData = encodeURIComponent(JSON.stringify(sanitizedEvents));

      // Calculate optimal window position
      const windowConfig = await this.calculateOptimalWindowPosition();

      await chrome.windows.create({
        url: chrome.runtime.getURL(`src/daily-summary/daily-summary.html?events=${eventsData}`),
        type: 'popup',
        width: 480,
        height: 600,
        focused: true,
        top: windowConfig.top,
        left: windowConfig.left,
      });

      console.log('PingMeet: Daily summary popup opened');
    } catch (error) {
      console.error('PingMeet: Error creating daily summary popup', error);
    }
  }

  /**
   * Calculate optimal window position
   */
  static async calculateOptimalWindowPosition() {
    try {
      const currentWindow = await chrome.windows.getCurrent();

      if (currentWindow && currentWindow.top !== undefined && currentWindow.left !== undefined) {
        const windowWidth = 480;
        const windowHeight = 600;

        const left = currentWindow.left + Math.floor((currentWindow.width - windowWidth) / 2);
        const top = currentWindow.top + Math.floor((currentWindow.height - windowHeight) / 3);

        return {
          top: Math.max(50, top),
          left: Math.max(50, left),
        };
      }
    } catch (error) {
      console.warn('PingMeet: Could not determine optimal window position', error);
    }

    return { top: 100, left: 100 };
  }

  /**
   * Send OS notification as secondary alert
   * @param {Array} events - Today's events
   */
  static async sendOSNotification(events) {
    if (events.length === 0) {
      await chrome.notifications.create('daily_summary', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
        title: '📅 Your Day Ahead',
        message: 'No meetings scheduled for today. Enjoy your focus time!',
        priority: 1,
      });
    } else {
      const summary = this.formatSummaryMessage(events);

      await chrome.notifications.create('daily_summary', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
        title: `📅 Today: ${events.length} Meeting${events.length > 1 ? 's' : ''}`,
        message: summary,
        priority: 1,
        requireInteraction: false,
      });
    }
  }

  /**
   * Format summary message
   * @param {Array} events - Today's events
   * @returns {string} Formatted message
   */
  static formatSummaryMessage(events) {
    const lines = [];

    // Add up to 5 meetings
    const displayEvents = events.slice(0, 5);

    for (const event of displayEvents) {
      const startTime = new Date(event.startTime);
      const timeStr = startTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      const title = event.title.length > 30
        ? event.title.substring(0, 27) + '...'
        : event.title;

      const conflictMarker = event.hasConflict ? ' [conflict]' : '';

      lines.push(`${timeStr} - ${title}${conflictMarker}`);
    }

    // Add "and X more" if there are more than 5
    if (events.length > 5) {
      lines.push(`\n...and ${events.length - 5} more`);
    }

    // Calculate total meeting time
    const totalMinutes = this.calculateTotalMeetingTime(events);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;

    let timeTotal = '';
    if (hours > 0) {
      timeTotal = `\n\n${hours}h ${mins}m in meetings today`;
    } else if (mins > 0) {
      timeTotal = `\n\n${mins} minutes in meetings today`;
    }

    return lines.join('\n') + timeTotal;
  }

  /**
   * Calculate total meeting time
   * @param {Array} events - Events to calculate
   * @returns {number} Total minutes
   */
  static calculateTotalMeetingTime(events) {
    let totalMinutes = 0;

    for (const event of events) {
      const startTime = new Date(event.startTime);
      const endTime = event.endTime
        ? new Date(event.endTime)
        : new Date(startTime.getTime() + 60 * 60 * 1000); // Default 1 hour

      const duration = (endTime - startTime) / (1000 * 60);
      totalMinutes += duration;
    }

    return Math.round(totalMinutes);
  }

  /**
   * Check if daily summary is enabled
   * @returns {Promise<boolean>}
   */
  static async isEnabled() {
    const settings = await StorageManager.getSettings();
    return settings.dailySummary !== false; // Default to true
  }

  /**
   * Enable/disable daily summary
   * @param {boolean} enabled
   */
  static async setEnabled(enabled) {
    const settings = await StorageManager.getSettings();
    settings.dailySummary = enabled;
    await StorageManager.saveSettings(settings);

    if (enabled) {
      await this.scheduleDailySummary();
    } else {
      await chrome.alarms.clear('daily_summary');
    }
  }
}
