/**
 * Daily Summary - Morning overview of meetings
 * Sends notification at 10:00 AM with today's meeting schedule
 */

import { StorageManager } from '../utils/storage.js';

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
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      // Filter for today's events
      const todaysEvents = events.filter(event => {
        const startTime = new Date(event.startTime);
        return startTime >= now && startTime <= endOfDay;
      });

      if (todaysEvents.length === 0) {
        // No meetings today
        await chrome.notifications.create('daily_summary', {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
          title: '📅 Your Day Ahead',
          message: 'No meetings scheduled for today. Enjoy your focus time!',
          priority: 1,
        });
        return;
      }

      // Sort by start time
      todaysEvents.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

      // Create summary message
      const summary = this.formatSummaryMessage(todaysEvents);

      // Send notification
      await chrome.notifications.create('daily_summary', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
        title: `📅 Today: ${todaysEvents.length} Meeting${todaysEvents.length > 1 ? 's' : ''}`,
        message: summary,
        priority: 1,
        requireInteraction: false,
      });

      console.log(`PingMeet: Daily summary sent for ${todaysEvents.length} meetings`);
    } catch (error) {
      console.error('PingMeet: Error sending daily summary', error);
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
