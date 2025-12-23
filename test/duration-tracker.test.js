/**
 * Tests for DurationTracker
 * Verifies meeting duration tracking and statistics
 */

import { jest } from '@jest/globals';
import { DurationTracker } from '../src/utils/duration-tracker.js';

describe('DurationTracker', () => {
  beforeEach(() => {
    // Mock chrome storage
    global.chrome = {
      storage: {
        local: {
          get: jest.fn(() => Promise.resolve({})),
          set: jest.fn(() => Promise.resolve()),
        },
      },
    };
  });

  describe('startTracking', () => {
    test('should store event start time', async () => {
      const event = {
        id: 'event1',
        title: 'Test Meeting',
        meetingLink: 'https://meet.google.com/test',
      };

      await DurationTracker.startTracking(event);

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          active_meeting: expect.objectContaining({
            eventId: 'event1',
            event: expect.objectContaining({
              title: 'Test Meeting',
            }),
          }),
        })
      );
    });

    test('should handle event without meeting link', async () => {
      const event = {
        id: 'event2',
        title: 'Test Meeting 2',
      };

      await DurationTracker.startTracking(event);

      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('stopTracking', () => {
    test('should record meeting duration', async () => {
      const startTime = new Date('2024-01-15T10:00:00Z');

      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({
          active_meeting: {
            eventId: 'event1',
            event: {
              id: 'event1',
              title: 'Test Meeting',
              meetingLink: 'https://meet.google.com/test',
            },
            startTime: startTime.toISOString(),
          },
          meeting_durations: [],
        })
      );

      global.chrome.storage.local.remove = jest.fn(() => Promise.resolve());

      await DurationTracker.stopTracking();

      expect(chrome.storage.local.set).toHaveBeenCalled();
      expect(chrome.storage.local.remove).toHaveBeenCalledWith('active_meeting');
    });

    test('should handle missing tracking data', async () => {
      global.chrome.storage.local.get = jest.fn(() => Promise.resolve({}));

      await DurationTracker.stopTracking();

      // Should not throw error and not record
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });

  describe('recordMeeting', () => {
    test('should record meeting with all details', async () => {
      const event = {
        id: 'event1',
        title: 'Daily Standup',
        meetingLink: 'https://meet.google.com/abc',
      };
      const startTime = new Date('2024-01-15T10:00:00Z');
      const endTime = new Date('2024-01-15T10:30:00Z');

      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({ meeting_durations: [] })
      );

      await DurationTracker.recordMeeting(event, startTime, endTime);

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          meeting_durations: expect.arrayContaining([
            expect.objectContaining({
              eventId: 'event1',
              title: 'Daily Standup',
              durationMinutes: 30,
              platform: 'Google Meet',
            }),
          ]),
        })
      );
    });

    test('should detect correct platform from meeting link', async () => {
      const event = {
        id: 'event2',
        title: 'Zoom Meeting',
        meetingLink: 'https://zoom.us/j/123456789',
      };
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + 45 * 60 * 1000);

      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({ meeting_durations: [] })
      );

      await DurationTracker.recordMeeting(event, startTime, endTime);

      const callArgs = chrome.storage.local.set.mock.calls[0][0];
      expect(callArgs.meeting_durations[0].platform).toBe('Zoom');
    });
  });

  describe('getStatistics', () => {
    test('should calculate daily and weekly statistics', async () => {
      const now = new Date();
      const today = new Date(now).toISOString().split('T')[0];

      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({
          meeting_durations: [
            {
              eventId: '1',
              title: 'Meeting 1',
              startTime: now.toISOString(),
              endTime: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
              durationMinutes: 30,
              platform: 'Google Meet',
              date: today,
            },
            {
              eventId: '2',
              title: 'Meeting 2',
              startTime: now.toISOString(),
              endTime: new Date(now.getTime() + 45 * 60 * 1000).toISOString(),
              durationMinutes: 45,
              platform: 'Zoom',
              date: today,
            },
          ],
        })
      );

      const stats = await DurationTracker.getStatistics();

      expect(stats).toHaveProperty('today');
      expect(stats).toHaveProperty('week');
      expect(stats.today.minutes).toBe(75);
      expect(stats.today.formatted).toBeTruthy();
    });

    test('should return zero statistics when no meetings', async () => {
      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({ meeting_durations: [] })
      );

      const stats = await DurationTracker.getStatistics();

      expect(stats.today.minutes).toBe(0);
      expect(stats.week.minutes).toBe(0);
    });
  });

  describe('getTodaysDuration', () => {
    test('should calculate total duration for today', async () => {
      const today = new Date().toISOString().split('T')[0];

      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({
          meeting_durations: [
            {
              eventId: '1',
              durationMinutes: 30,
              date: today,
            },
            {
              eventId: '2',
              durationMinutes: 45,
              date: today,
            },
          ],
        })
      );

      const duration = await DurationTracker.getTodaysDuration();
      expect(duration).toBe(75);
    });

    test('should ignore meetings from other days', async () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({
          meeting_durations: [
            {
              eventId: '1',
              durationMinutes: 30,
              date: today,
            },
            {
              eventId: '2',
              durationMinutes: 45,
              date: yesterday,
            },
          ],
        })
      );

      const duration = await DurationTracker.getTodaysDuration();
      expect(duration).toBe(30);
    });
  });

  describe('getWeekDuration', () => {
    test('should calculate total duration for the week', async () => {
      const today = new Date();
      const thisWeek = [];

      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        thisWeek.push({
          eventId: `event${i}`,
          durationMinutes: 30,
          date: date.toISOString().split('T')[0],
        });
      }

      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({ meeting_durations: thisWeek })
      );

      const duration = await DurationTracker.getWeekDuration();
      expect(duration).toBe(210); // 7 * 30
    });
  });

  describe('getWeeklyBreakdown', () => {
    test('should provide daily breakdown for the week', async () => {
      const today = new Date();
      const meetings = [
        {
          eventId: '1',
          durationMinutes: 60,
          date: today.toISOString().split('T')[0],
        },
      ];

      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({ meeting_durations: meetings })
      );

      const breakdown = await DurationTracker.getWeeklyBreakdown();

      expect(breakdown).toHaveProperty('Monday');
      expect(breakdown).toHaveProperty('Tuesday');
      expect(breakdown).toHaveProperty('Sunday');
      expect(Object.keys(breakdown)).toHaveLength(7);
    });
  });

  describe('getPlatformBreakdown', () => {
    test('should categorize meetings by platform', async () => {
      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({
          meeting_durations: [
            {
              eventId: '1',
              durationMinutes: 30,
              platform: 'Google Meet',
            },
            {
              eventId: '2',
              durationMinutes: 45,
              platform: 'Zoom',
            },
            {
              eventId: '3',
              durationMinutes: 20,
              platform: 'Google Meet',
            },
          ],
        })
      );

      const breakdown = await DurationTracker.getPlatformBreakdown();

      expect(breakdown['Google Meet']).toBe(50);
      expect(breakdown['Zoom']).toBe(45);
    });
  });

  describe('formatDuration', () => {
    test('should format minutes to hours and minutes', () => {
      expect(DurationTracker.formatDuration(90)).toBe('1h 30m');
      expect(DurationTracker.formatDuration(60)).toBe('1h');
      expect(DurationTracker.formatDuration(45)).toBe('45m');
      expect(DurationTracker.formatDuration(0)).toBe('0m');
    });

    test('should handle large durations', () => {
      expect(DurationTracker.formatDuration(300)).toBe('5h');
      expect(DurationTracker.formatDuration(365)).toBe('6h 5m');
    });
  });

  describe('detectPlatform', () => {
    test('should detect Google Meet', () => {
      expect(DurationTracker.detectPlatform('https://meet.google.com/abc')).toBe(
        'Google Meet'
      );
    });

    test('should detect Zoom', () => {
      expect(DurationTracker.detectPlatform('https://zoom.us/j/123')).toBe('Zoom');
    });

    test('should detect Microsoft Teams', () => {
      expect(
        DurationTracker.detectPlatform('https://teams.microsoft.com/l/meetup')
      ).toBe('Microsoft Teams');
    });

    test('should return Unknown for unrecognized links', () => {
      expect(DurationTracker.detectPlatform('https://example.com')).toBe('Unknown');
    });

    test('should handle null or undefined', () => {
      expect(DurationTracker.detectPlatform(null)).toBe('Unknown');
      expect(DurationTracker.detectPlatform(undefined)).toBe('Unknown');
    });
  });

  describe('getActiveTracking', () => {
    test('should return active tracking info', async () => {
      const activeTracking = {
        eventId: 'event1',
        event: { id: 'event1', title: 'Active Meeting' },
        startTime: new Date().toISOString(),
      };

      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({ active_meeting: activeTracking })
      );

      const result = await DurationTracker.getActiveTracking();

      expect(result).toEqual(activeTracking);
    });

    test('should return null when no active tracking', async () => {
      global.chrome.storage.local.get = jest.fn(() => Promise.resolve({}));

      const result = await DurationTracker.getActiveTracking();

      expect(result).toBeNull();
    });
  });

  describe('getAllDurations', () => {
    test('should retrieve all meeting durations', async () => {
      const durations = [
        { eventId: '1', durationMinutes: 30 },
        { eventId: '2', durationMinutes: 45 },
      ];

      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({ meeting_durations: durations })
      );

      const result = await DurationTracker.getAllDurations();

      expect(result).toEqual(durations);
    });

    test('should return empty array when no durations stored', async () => {
      global.chrome.storage.local.get = jest.fn(() => Promise.resolve({}));

      const result = await DurationTracker.getAllDurations();

      expect(result).toEqual([]);
    });
  });
});
