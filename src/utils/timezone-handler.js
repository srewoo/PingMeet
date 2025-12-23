/**
 * Timezone Handler - Manages timezone conversions for calendar events
 */

export class TimezoneHandler {
  /**
   * Convert event time to local timezone
   * @param {string} dateTimeString - ISO 8601 datetime string
   * @param {string} timezone - Event timezone (optional)
   * @returns {Date} Date object in local timezone
   */
  static toLocalTime(dateTimeString, timezone = null) {
    try {
      // If already a Date object, return as-is
      if (dateTimeString instanceof Date) {
        return dateTimeString;
      }

      // Parse the datetime string
      const date = new Date(dateTimeString);

      // If timezone is provided and different from local
      if (timezone) {
        return this.convertTimezone(date, timezone);
      }

      return date;
    } catch (error) {
      console.error('PingMeet: Error parsing datetime', error);
      return new Date();
    }
  }

  /**
   * Convert a date from one timezone to another
   * @param {Date} date - Source date
   * @param {string} sourceTimezone - Source timezone identifier
   * @returns {Date} Converted date
   */
  static convertTimezone(date, sourceTimezone) {
    try {
      // Use Intl.DateTimeFormat to handle timezone conversion
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: sourceTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      const parts = formatter.formatToParts(date);
      const dateObj = {};

      for (const part of parts) {
        if (part.type !== 'literal') {
          dateObj[part.type] = part.value;
        }
      }

      // Reconstruct the date in local timezone
      const localDate = new Date(
        `${dateObj.year}-${dateObj.month}-${dateObj.day}T${dateObj.hour}:${dateObj.minute}:${dateObj.second}`
      );

      return localDate;
    } catch (error) {
      console.warn('PingMeet: Timezone conversion failed, using original date', error);
      return date;
    }
  }

  /**
   * Get the user's current timezone
   * @returns {string} IANA timezone identifier
   */
  static getUserTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (error) {
      return 'UTC';
    }
  }

  /**
   * Format date with timezone information
   * @param {Date} date - Date to format
   * @param {string} timezone - Timezone (optional)
   * @returns {string} Formatted string with timezone
   */
  static formatWithTimezone(date, timezone = null) {
    const tz = timezone || this.getUserTimezone();

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      });

      return formatter.format(date);
    } catch (error) {
      return date.toLocaleString();
    }
  }

  /**
   * Check if date is in a different timezone than local
   * @param {string} eventTimezone - Event timezone
   * @returns {boolean} True if different from local
   */
  static isDifferentTimezone(eventTimezone) {
    if (!eventTimezone) return false;
    const localTz = this.getUserTimezone();
    return eventTimezone !== localTz;
  }

  /**
   * Get timezone offset in hours
   * @param {string} timezone - IANA timezone identifier
   * @returns {number} Offset in hours
   */
  static getTimezoneOffset(timezone) {
    try {
      const now = new Date();
      const localOffset = now.getTimezoneOffset() / 60;

      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      });

      const tzDate = new Date(formatter.format(now));
      const tzOffset = (tzDate.getHours() - now.getHours());

      return tzOffset - localOffset;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Parse timezone from various formats
   * @param {string} timezoneString - Timezone string (various formats)
   * @returns {string|null} IANA timezone identifier or null
   */
  static parseTimezone(timezoneString) {
    if (!timezoneString) return null;

    // Common timezone abbreviation to IANA mapping
    const timezoneMap = {
      'PST': 'America/Los_Angeles',
      'PDT': 'America/Los_Angeles',
      'MST': 'America/Denver',
      'MDT': 'America/Denver',
      'CST': 'America/Chicago',
      'CDT': 'America/Chicago',
      'EST': 'America/New_York',
      'EDT': 'America/New_York',
      'GMT': 'Europe/London',
      'BST': 'Europe/London',
      'CET': 'Europe/Paris',
      'CEST': 'Europe/Paris',
      'IST': 'Asia/Kolkata',
      'JST': 'Asia/Tokyo',
      'AEST': 'Australia/Sydney',
      'AEDT': 'Australia/Sydney',
    };

    // Check if it's an abbreviation
    const upper = timezoneString.toUpperCase().trim();
    if (timezoneMap[upper]) {
      return timezoneMap[upper];
    }

    // Check if it's already an IANA identifier
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezoneString });
      return timezoneString;
    } catch (error) {
      return null;
    }
  }

  /**
   * Normalize ISO 8601 datetime with timezone
   * Handles formats like:
   * - 2024-01-15T10:30:00-08:00
   * - 2024-01-15T10:30:00Z
   * - 2024-01-15T10:30:00
   * @param {string} isoString - ISO datetime string
   * @returns {Date} Parsed date in local timezone
   */
  static normalizeISOString(isoString) {
    if (!isoString) return new Date();

    try {
      // ISO strings with timezone offset are automatically handled by Date constructor
      const date = new Date(isoString);

      // Check if valid
      if (isNaN(date.getTime())) {
        console.warn('PingMeet: Invalid datetime string', isoString);
        return new Date();
      }

      return date;
    } catch (error) {
      console.error('PingMeet: Error normalizing ISO string', error);
      return new Date();
    }
  }
}
