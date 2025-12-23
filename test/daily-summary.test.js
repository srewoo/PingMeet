/**
 * Tests for DailySummary
 * Verifies daily meeting summary notifications
 */

import { jest } from '@jest/globals';
import { DailySummary } from '../src/background/daily-summary.js';

describe('DailySummary', () => {
  beforeEach(() => {
    // Reset Date mock
    jest.restoreAllMocks();
    
    // Mock Chrome APIs
    global.chrome = {
      runtime: {
        getURL: jest.fn(path => `chrome-extension://test/${path}`),
      },
      alarms: {
        create: jest.fn(),
        clear: jest.fn(),
        get: jest.fn(() => Promise.resolve(null)),
      },
      notifications: {
        create: jest.fn((id, options) => Promise.resolve(id)),
      },
      storage: {
        local: {
          get: jest.fn(() => Promise.resolve({ events: [] })),
        },
        sync: {
          get: jest.fn(() =>
            Promise.resolve({
              settings: {
                dailySummary: true,
              },
            })
          ),
          set: jest.fn(() => Promise.resolve()),
        },
      },
    };
  });

  describe('scheduleDailySummary', () => {
    test('should schedule alarm for 10 AM', async () => {
      await DailySummary.scheduleDailySummary();

      expect(chrome.alarms.create).toHaveBeenCalledWith(
        'daily_summary',
        expect.objectContaining({
          when: expect.any(Number),
          periodInMinutes: expect.any(Number),
        })
      );
    });

    test('should schedule for next day if past 10 AM', async () => {
      // Create a fixed date at 11 AM
      const mockNow = new Date('2025-12-18T11:00:00');
      const RealDate = Date;
      
      global.Date = class extends RealDate {
        constructor(...args) {
          if (args.length === 0) {
            super(mockNow);
          } else {
            super(...args);
          }
        }
        
        static now() {
          return mockNow.getTime();
        }
      };

      await DailySummary.scheduleDailySummary();

      const callArgs = chrome.alarms.create.mock.calls[0][1];
      const scheduledTime = new RealDate(callArgs.when);

      expect(scheduledTime.getHours()).toBe(10);
      expect(scheduledTime.getDate()).toBe(19); // Next day
      
      global.Date = RealDate;
    });

    test('should use 24 hour period', async () => {
      await DailySummary.scheduleDailySummary();

      const callArgs = chrome.alarms.create.mock.calls[0][1];
      expect(callArgs.periodInMinutes).toBe(24 * 60);
    });
  });

  describe('sendDailySummary', () => {
    test('should send notification with meeting count', async () => {
      const mockEvents = [
        {
          id: '1',
          title: 'Meeting 1',
          startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: '2',
          title: 'Meeting 2',
          startTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        },
      ];

      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({ events: mockEvents })
      );

      await DailySummary.sendDailySummary();

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'daily_summary',
        expect.objectContaining({
          type: 'basic',
          title: expect.stringContaining('2 Meeting'),
        })
      );
    });

    test('should handle singular meeting', async () => {
      const mockEvents = [
        {
          id: '1',
          title: 'Single Meeting',
          startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        },
      ];

      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({ events: mockEvents })
      );

      await DailySummary.sendDailySummary();

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'daily_summary',
        expect.objectContaining({
          title: expect.stringContaining('1 Meeting'),
        })
      );
    });

    test('should send notification when no meetings', async () => {
      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({ events: [] })
      );

      await DailySummary.sendDailySummary();

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'daily_summary',
        expect.objectContaining({
          title: expect.stringContaining('Your Day Ahead'),
          message: expect.stringContaining('No meetings'),
        })
      );
    });

    test('should filter events for today only', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const today = new Date(Date.now() + 2 * 60 * 60 * 1000);

      const mockEvents = [
        {
          id: '1',
          title: 'Yesterday Meeting',
          startTime: yesterday.toISOString(),
        },
        {
          id: '2',
          title: 'Today Meeting',
          startTime: today.toISOString(),
        },
        {
          id: '3',
          title: 'Tomorrow Meeting',
          startTime: tomorrow.toISOString(),
        },
      ];

      global.chrome.storage.local.get = jest.fn(() =>
        Promise.resolve({ events: mockEvents })
      );

      await DailySummary.sendDailySummary();

      const callArgs = chrome.notifications.create.mock.calls[0][1];
      expect(callArgs.title).toContain('1 Meeting');
    });
  });

  describe('formatSummaryMessage', () => {
    test('should format message with meeting times', () => {
      const now = new Date();
      const events = [
        {
          id: '1',
          title: 'Morning Standup',
          startTime: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        },
        {
          id: '2',
          title: 'Lunch Meeting',
          startTime: new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(),
        },
      ];

      const message = DailySummary.formatSummaryMessage(events);

      expect(message).toContain('Morning Standup');
      expect(message).toContain('Lunch Meeting');
    });

    test('should limit to first 5 meetings', () => {
      const now = new Date();
      const events = Array.from({ length: 10 }, (_, i) => ({
        id: `${i}`,
        title: `Meeting ${i + 1}`,
        startTime: new Date(now.getTime() + (i + 1) * 60 * 60 * 1000).toISOString(),
      }));

      const message = DailySummary.formatSummaryMessage(events);

      expect(message).toContain('Meeting 1');
      expect(message).toContain('Meeting 5');
      expect(message).toContain('5 more');
    });

    test('should calculate total duration', () => {
      const now = new Date();
      const events = [
        {
          id: '1',
          title: 'Meeting 1',
          startTime: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 90 * 60 * 1000).toISOString(),
        },
        {
          id: '2',
          title: 'Meeting 2',
          startTime: new Date(now.getTime() + 120 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 165 * 60 * 1000).toISOString(),
        },
      ];

      const message = DailySummary.formatSummaryMessage(events);

      expect(message).toContain('⏱️');
      expect(message).toMatch(/1h\s+15m/);
    });

    test('should handle events without end time', () => {
      const now = new Date();
      const events = [
        {
          id: '1',
          title: 'Meeting without end',
          startTime: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        },
      ];

      const message = DailySummary.formatSummaryMessage(events);

      expect(message).toContain('Meeting without end');
    });
  });

  describe('isEnabled', () => {
    test('should return true when setting is enabled', async () => {
      global.chrome.storage.sync.get = jest.fn(() =>
        Promise.resolve({
          settings: {
            dailySummary: true,
          },
        })
      );

      const enabled = await DailySummary.isEnabled();
      expect(enabled).toBe(true);
    });

    test('should return false when setting is disabled', async () => {
      global.chrome.storage.sync.get = jest.fn(() =>
        Promise.resolve({
          settings: {
            dailySummary: false,
          },
        })
      );

      const enabled = await DailySummary.isEnabled();
      expect(enabled).toBe(false);
    });

    test('should default to true when setting is undefined', async () => {
      global.chrome.storage.sync.get = jest.fn(() =>
        Promise.resolve({
          settings: {},
        })
      );

      const enabled = await DailySummary.isEnabled();
      expect(enabled).toBe(true);
    });
  });

  describe('setEnabled', () => {
    test('should enable daily summary', async () => {
      await DailySummary.setEnabled(true);

      expect(chrome.storage.sync.set).toHaveBeenCalled();
      expect(chrome.alarms.create).toHaveBeenCalled();
    });

    test('should disable daily summary', async () => {
      await DailySummary.setEnabled(false);

      expect(chrome.storage.sync.set).toHaveBeenCalled();
      expect(chrome.alarms.clear).toHaveBeenCalledWith('daily_summary');
    });
  });

  describe('calculateTotalMeetingTime', () => {
    test('should calculate total time from events with endTime', () => {
      const events = [
        {
          startTime: '2024-01-15T09:00:00Z',
          endTime: '2024-01-15T10:00:00Z',
        },
        {
          startTime: '2024-01-15T14:00:00Z',
          endTime: '2024-01-15T15:30:00Z',
        },
      ];

      const total = DailySummary.calculateTotalMeetingTime(events);
      expect(total).toBe(150); // 60 + 90 minutes
    });

    test('should default to 1 hour when endTime is missing', () => {
      const events = [
        {
          startTime: '2024-01-15T09:00:00Z',
        },
      ];

      const total = DailySummary.calculateTotalMeetingTime(events);
      expect(total).toBe(60);
    });
  });

  describe('init', () => {
    test('should initialize daily summary', async () => {
      await DailySummary.init();

      expect(chrome.alarms.create).toHaveBeenCalled();
    });
  });
});
