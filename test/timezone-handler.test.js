/**
 * Tests for TimezoneHandler
 * Verifies timezone conversion and detection
 */

import { jest } from '@jest/globals';
import { TimezoneHandler } from '../src/utils/timezone-handler.js';

describe('TimezoneHandler', () => {
  describe('toLocalTime', () => {
    test('should convert date string to local time', () => {
      const dateString = '2024-01-15T14:00:00Z';
      const result = TimezoneHandler.toLocalTime(dateString);

      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-01-15T14:00:00.000Z');
    });

    test('should handle date string without timezone', () => {
      const dateString = '2024-01-15T14:00:00';
      const result = TimezoneHandler.toLocalTime(dateString);

      expect(result).toBeInstanceOf(Date);
    });

    test('should handle ISO date strings', () => {
      const now = new Date();
      const isoString = now.toISOString();
      const result = TimezoneHandler.toLocalTime(isoString);

      expect(result.getTime()).toBe(now.getTime());
    });
  });

  describe('getUserTimezone', () => {
    test('should return user timezone', () => {
      const timezone = TimezoneHandler.getUserTimezone();

      expect(typeof timezone).toBe('string');
      expect(timezone.length).toBeGreaterThan(0);
    });

    test('should return IANA timezone format', () => {
      const timezone = TimezoneHandler.getUserTimezone();

      // Should contain '/' for IANA format (e.g., America/New_York)
      expect(timezone).toMatch(/\//);
    });
  });

  describe('parseTimezone', () => {
    test('should parse PST to America/Los_Angeles', () => {
      const result = TimezoneHandler.parseTimezone('PST');
      expect(result).toBe('America/Los_Angeles');
    });

    test('should parse EST to America/New_York', () => {
      const result = TimezoneHandler.parseTimezone('EST');
      expect(result).toBe('America/New_York');
    });

    test('should parse GMT to Europe/London', () => {
      const result = TimezoneHandler.parseTimezone('GMT');
      expect(result).toBe('Europe/London');
    });

    test('should parse CST to America/Chicago', () => {
      const result = TimezoneHandler.parseTimezone('CST');
      expect(result).toBe('America/Chicago');
    });

    test('should parse MST to America/Denver', () => {
      const result = TimezoneHandler.parseTimezone('MST');
      expect(result).toBe('America/Denver');
    });

    test('should handle lowercase abbreviations', () => {
      const result = TimezoneHandler.parseTimezone('pst');
      expect(result).toBe('America/Los_Angeles');
    });

    test('should return input if already IANA format', () => {
      const iana = 'Europe/Paris';
      const result = TimezoneHandler.parseTimezone(iana);
      expect(result).toBe(iana);
    });

    test('should return unknown timezones as-is', () => {
      const unknown = 'INVALID_TZ';
      const result = TimezoneHandler.parseTimezone(unknown);
      expect(result).toBe(unknown);
    });
  });

  describe('formatTimezone', () => {
    test('should format timezone for display', () => {
      const formatted = TimezoneHandler.formatTimezone('America/New_York');

      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    });

    test('should handle null timezone', () => {
      const formatted = TimezoneHandler.formatTimezone(null);

      expect(formatted).toBe('Local Time');
    });

    test('should handle undefined timezone', () => {
      const formatted = TimezoneHandler.formatTimezone(undefined);

      expect(formatted).toBe('Local Time');
    });
  });

  describe('getTimezoneOffset', () => {
    test('should return timezone offset in hours', () => {
      const offset = TimezoneHandler.getTimezoneOffset();

      expect(typeof offset).toBe('number');
      expect(offset).toBeGreaterThanOrEqual(-12);
      expect(offset).toBeLessThanOrEqual(14);
    });

    test('should return offset as decimal for half-hour timezones', () => {
      const offset = TimezoneHandler.getTimezoneOffset();

      // Offset should be a number (could be -5.5, 5.5, etc.)
      expect(isNaN(offset)).toBe(false);
    });
  });

  describe('isDST', () => {
    test('should determine if date is in daylight saving time', () => {
      const summerDate = new Date('2024-07-15T12:00:00');
      const winterDate = new Date('2024-01-15T12:00:00');

      const summerDST = TimezoneHandler.isDST(summerDate);
      const winterDST = TimezoneHandler.isDST(winterDate);

      expect(typeof summerDST).toBe('boolean');
      expect(typeof winterDST).toBe('boolean');
    });

    test('should handle Date objects', () => {
      const date = new Date();
      const result = TimezoneHandler.isDST(date);

      expect(typeof result).toBe('boolean');
    });
  });

  describe('convertTimezone', () => {
    test('should convert between timezones', () => {
      const date = new Date('2024-01-15T14:00:00Z');
      const targetTimezone = 'America/New_York';

      const converted = TimezoneHandler.convertTimezone(date, targetTimezone);

      expect(converted).toBeInstanceOf(Date);
    });

    test('should handle UTC timezone', () => {
      const date = new Date('2024-01-15T14:00:00Z');
      const converted = TimezoneHandler.convertTimezone(date, 'UTC');

      expect(converted.toISOString()).toBe(date.toISOString());
    });
  });

  describe('getTimezoneAbbreviation', () => {
    test('should return timezone abbreviation', () => {
      const abbr = TimezoneHandler.getTimezoneAbbreviation();

      expect(typeof abbr).toBe('string');
      expect(abbr.length).toBeGreaterThan(0);
      expect(abbr.length).toBeLessThanOrEqual(5);
    });

    test('should handle specific date', () => {
      const date = new Date('2024-01-15T12:00:00');
      const abbr = TimezoneHandler.getTimezoneAbbreviation(date);

      expect(typeof abbr).toBe('string');
    });
  });

  describe('isValidTimezone', () => {
    test('should validate IANA timezone names', () => {
      expect(TimezoneHandler.isValidTimezone('America/New_York')).toBe(true);
      expect(TimezoneHandler.isValidTimezone('Europe/London')).toBe(true);
      expect(TimezoneHandler.isValidTimezone('Asia/Tokyo')).toBe(true);
    });

    test('should reject invalid timezone names', () => {
      expect(TimezoneHandler.isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(TimezoneHandler.isValidTimezone('XYZ')).toBe(false);
      expect(TimezoneHandler.isValidTimezone('')).toBe(false);
    });

    test('should handle null and undefined', () => {
      expect(TimezoneHandler.isValidTimezone(null)).toBe(false);
      expect(TimezoneHandler.isValidTimezone(undefined)).toBe(false);
    });
  });
});
