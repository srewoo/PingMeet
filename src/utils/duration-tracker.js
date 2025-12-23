/**
 * Duration Tracker - Tracks time spent in meetings
 */

import { StorageManager } from './storage.js';

export class DurationTracker {
  static STORAGE_KEY = 'meeting_durations';

  /**
   * Record a meeting's duration
   * @param {Object} event - Meeting event
   * @param {Date} startTime - When meeting started
   * @param {Date} endTime - When meeting ended
   */
  static async recordMeeting(event, startTime, endTime) {
    try {
      const duration = (endTime - startTime) / (1000 * 60); // minutes
      if (duration <= 0) return;

      const record = {
        eventId: event.id,
        title: event.title,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        durationMinutes: Math.round(duration),
        platform: this.detectPlatform(event.meetingLink),
        date: new Date(startTime).toISOString().split('T')[0], // YYYY-MM-DD
      };

      const durations = await this.getAllDurations();
      durations.push(record);

      // Keep only last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const filtered = durations.filter(d => new Date(d.startTime) >= thirtyDaysAgo);

      await chrome.storage.local.set({ [this.STORAGE_KEY]: filtered });
      console.log(`PingMeet: Recorded ${duration.toFixed(1)} minutes for "${event.title}"`);
    } catch (error) {
      console.error('PingMeet: Error recording meeting duration', error);
    }
  }

  /**
   * Get all recorded durations
   * @returns {Promise<Array>}
   */
  static async getAllDurations() {
    try {
      const result = await chrome.storage.local.get(this.STORAGE_KEY);
      return result[this.STORAGE_KEY] || [];
    } catch (error) {
      console.error('PingMeet: Error getting durations', error);
      return [];
    }
  }

  /**
   * Get today's meeting time
   * @returns {Promise<number>} Minutes
   */
  static async getTodaysDuration() {
    const durations = await this.getAllDurations();
    const today = new Date().toISOString().split('T')[0];

    const todaysDurations = durations.filter(d => d.date === today);
    return todaysDurations.reduce((sum, d) => sum + d.durationMinutes, 0);
  }

  /**
   * Get this week's meeting time
   * @returns {Promise<number>} Minutes
   */
  static async getWeekDuration() {
    const durations = await this.getAllDurations();
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const weekDurations = durations.filter(d => new Date(d.startTime) >= weekAgo);
    return weekDurations.reduce((sum, d) => sum + d.durationMinutes, 0);
  }

  /**
   * Get daily breakdown for the week
   * @returns {Promise<Object>} { date: minutes }
   */
  static async getWeeklyBreakdown() {
    const durations = await this.getAllDurations();
    const today = new Date();
    const breakdown = {};

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      breakdown[dateStr] = 0;
    }

    durations.forEach(d => {
      if (breakdown.hasOwnProperty(d.date)) {
        breakdown[d.date] += d.durationMinutes;
      }
    });

    return breakdown;
  }

  /**
   * Get platform breakdown
   * @returns {Promise<Object>} { platform: minutes }
   */
  static async getPlatformBreakdown() {
    const durations = await this.getAllDurations();
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const breakdown = {};
    const weekDurations = durations.filter(d => new Date(d.startTime) >= weekAgo);

    weekDurations.forEach(d => {
      const platform = d.platform || 'Unknown';
      breakdown[platform] = (breakdown[platform] || 0) + d.durationMinutes;
    });

    return breakdown;
  }

  /**
   * Detect platform from meeting link
   * @param {string} link - Meeting link
   * @returns {string} Platform name
   */
  static detectPlatform(link) {
    if (!link) return 'Unknown';

    if (link.includes('meet.google.com')) return 'Google Meet';
    if (link.includes('zoom.us') || link.includes('zoom.com')) return 'Zoom';
    if (link.includes('teams.microsoft.com')) return 'Microsoft Teams';
    if (link.includes('webex.com')) return 'Webex';
    if (link.includes('gotomeeting.com')) return 'GoToMeeting';
    if (link.includes('slack.com')) return 'Slack';
    if (link.includes('discord')) return 'Discord';
    if (link.includes('skype.com')) return 'Skype';
    if (link.includes('bluejeans.com')) return 'BlueJeans';
    if (link.includes('jit.si')) return 'Jitsi';

    return 'Other';
  }

  /**
   * Format duration for display
   * @param {number} minutes - Duration in minutes
   * @returns {string} Formatted string
   */
  static formatDuration(minutes) {
    // Handle negative or invalid duration
    if (minutes < 0 || !Number.isFinite(minutes)) {
      return '0m';
    }

    minutes = Math.round(minutes);

    if (minutes < 60) {
      return `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (mins === 0) {
      return `${hours}h`;
    }

    return `${hours}h ${mins}m`;
  }

  /**
   * Track active meeting (when user joins)
   * @param {Object} event - Meeting event
   */
  static async startTracking(event) {
    const activeTracking = {
      eventId: event.id,
      event: event,
      startTime: new Date().toISOString(),
    };

    await chrome.storage.local.set({ active_meeting: activeTracking });
    console.log(`PingMeet: Started tracking "${event.title}"`);
  }

  /**
   * Stop tracking active meeting
   */
  static async stopTracking() {
    try {
      const result = await chrome.storage.local.get('active_meeting');
      const activeTracking = result.active_meeting;

      if (activeTracking) {
        const startTime = new Date(activeTracking.startTime);
        const endTime = new Date();

        await this.recordMeeting(activeTracking.event, startTime, endTime);
        await chrome.storage.local.remove('active_meeting');
      }
    } catch (error) {
      console.error('PingMeet: Error stopping tracking', error);
    }
  }

  /**
   * Get active meeting tracking info
   * @returns {Promise<Object|null>}
   */
  static async getActiveTracking() {
    try {
      const result = await chrome.storage.local.get('active_meeting');
      return result.active_meeting || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get statistics summary
   * @returns {Promise<Object>}
   */
  static async getStatistics() {
    const todayMinutes = await this.getTodaysDuration();
    const weekMinutes = await this.getWeekDuration();
    const weeklyBreakdown = await this.getWeeklyBreakdown();
    const platformBreakdown = await this.getPlatformBreakdown();
    const allDurations = await this.getAllDurations();

    // Calculate averages
    const weekDurations = allDurations.filter(d => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return new Date(d.startTime) >= weekAgo;
    });

    const avgMeetingLength = weekDurations.length > 0
      ? Math.round(weekDurations.reduce((sum, d) => sum + d.durationMinutes, 0) / weekDurations.length)
      : 0;

    const longestMeeting = weekDurations.reduce((max, d) =>
      d.durationMinutes > max.durationMinutes ? d : max,
      { durationMinutes: 0 }
    );

    return {
      today: {
        minutes: todayMinutes,
        formatted: this.formatDuration(todayMinutes),
      },
      week: {
        minutes: weekMinutes,
        formatted: this.formatDuration(weekMinutes),
        dailyAverage: Math.round(weekMinutes / 7),
        meetingCount: weekDurations.length,
      },
      averageMeetingLength: {
        minutes: avgMeetingLength,
        formatted: this.formatDuration(avgMeetingLength),
      },
      longestMeeting: {
        title: longestMeeting.title || 'N/A',
        minutes: longestMeeting.durationMinutes,
        formatted: this.formatDuration(longestMeeting.durationMinutes),
      },
      weeklyBreakdown,
      platformBreakdown,
    };
  }
}
