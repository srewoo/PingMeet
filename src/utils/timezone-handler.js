import { logger } from '../utils/logger.js';
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
      logger.error('Error parsing datetime', error);
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
      // UTC is a no-op: the instant is already absolute, so return the same
      // moment rather than reconstructing wall-clock fields (which would be
      // reinterpreted in the runner's local zone and drift the value).
      if (sourceTimezone === 'UTC' || sourceTimezone === 'Etc/UTC') {
        return new Date(date.getTime());
      }

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
      logger.warn('Timezone conversion failed, using original date', error);
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
      const tzOffset = tzDate.getHours() - now.getHours();

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
      PST: 'America/Los_Angeles',
      PDT: 'America/Los_Angeles',
      MST: 'America/Denver',
      MDT: 'America/Denver',
      CST: 'America/Chicago',
      CDT: 'America/Chicago',
      EST: 'America/New_York',
      EDT: 'America/New_York',
      GMT: 'Europe/London',
      BST: 'Europe/London',
      CET: 'Europe/Paris',
      CEST: 'Europe/Paris',
      IST: 'Asia/Kolkata',
      JST: 'Asia/Tokyo',
      AEST: 'Australia/Sydney',
      AEDT: 'Australia/Sydney',
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
      // Not a recognized abbreviation or IANA id — return the input unchanged
      // so callers keep whatever the source provided rather than losing it.
      return timezoneString;
    }
  }

  /**
   * Map common IANA identifiers to short abbreviations for compact display.
   */
  static IANA_TO_ABBR = {
    'America/Los_Angeles': 'PST',
    'America/Denver': 'MST',
    'America/Chicago': 'CST',
    'America/New_York': 'EST',
    'Europe/London': 'GMT',
    'Europe/Paris': 'CET',
    'Asia/Kolkata': 'IST',
    'Asia/Tokyo': 'JST',
    'Australia/Sydney': 'AEST',
  };

  /**
   * Validate whether a string is a usable IANA timezone identifier.
   * @param {string} timezone
   * @returns {boolean}
   */
  static isValidTimezone(timezone) {
    if (!timezone || typeof timezone !== 'string') return false;
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get a short timezone abbreviation (e.g. "IST", "PST") for the given date.
   * @param {Date} date - Date to evaluate (defaults to now)
   * @param {string} timezone - IANA id (defaults to the user's timezone)
   * @returns {string} A short (<=5 char) abbreviation
   */
  static getTimezoneAbbreviation(date = new Date(), timezone = null) {
    const tz = timezone || this.getUserTimezone();
    if (this.IANA_TO_ABBR[tz]) return this.IANA_TO_ABBR[tz];
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'short',
      }).formatToParts(date);
      const name = parts.find(p => p.type === 'timeZoneName')?.value || '';
      // Intl may yield long forms like "GMT+5:30"; keep it compact.
      return (name.slice(0, 5) || 'UTC');
    } catch (error) {
      return 'UTC';
    }
  }

  /**
   * Format a timezone for human-readable display.
   * @param {string} timezone - IANA id (null/undefined → local time)
   * @returns {string}
   */
  static formatTimezone(timezone) {
    if (!timezone) return 'Local Time';
    const abbr = this.getTimezoneAbbreviation(new Date(), timezone);
    const label = timezone.includes('/')
      ? timezone.split('/').pop().replace(/_/g, ' ')
      : timezone;
    return `${label} (${abbr})`;
  }

  /**
   * Determine whether a date falls within daylight saving time in the local
   * environment (compares the date's offset to the year's standard offset).
   * @param {Date|string} date
   * @returns {boolean}
   */
  static isDST(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    const jan = new Date(d.getFullYear(), 0, 1).getTimezoneOffset();
    const jul = new Date(d.getFullYear(), 6, 1).getTimezoneOffset();
    // DST is in effect when the current offset is less than the standard
    // (largest) offset of the year.
    return Math.max(jan, jul) !== d.getTimezoneOffset();
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
        logger.warn('Invalid datetime string', isoString);
        return new Date();
      }

      return date;
    } catch (error) {
      logger.error('Error normalizing ISO string', error);
      return new Date();
    }
  }
}
