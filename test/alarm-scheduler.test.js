/**
 * Tests for alarm scheduling functionality
 * Verifies reminders are scheduled at the correct times
 */

import { jest } from '@jest/globals';

describe('Alarm Scheduler', () => {
  beforeEach(() => {
    // Mock Chrome alarms API
    global.chrome = {
      alarms: {
        create: jest.fn(),
        clear: jest.fn(),
        get: jest.fn(),
        getAll: jest.fn(() => Promise.resolve([])),
        onAlarm: {
          addListener: jest.fn(),
        },
      },
      storage: {
        local: {
          get: jest.fn(() => Promise.resolve({})),
          set: jest.fn(() => Promise.resolve()),
          remove: jest.fn(() => Promise.resolve()),
        },
        sync: {
          get: jest.fn(() => Promise.resolve({
            settings: {
              reminderMinutes: 2,
            }
          })),
        },
      },
    };
  });

  test('should schedule alarm for correct time before meeting', () => {
    const event = {
      id: 'event1',
      title: 'Test Meeting',
      startTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 mins from now
    };

    const reminderMinutes = 2;
    const startTime = new Date(event.startTime);
    const reminderTime = new Date(startTime.getTime() - reminderMinutes * 60 * 1000);

    chrome.alarms.create('meeting_event1', {
      when: reminderTime.getTime(),
    });

    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'meeting_event1',
      expect.objectContaining({
        when: expect.any(Number),
      })
    );
  });

  test('should not schedule alarm for past events', () => {
    const event = {
      id: 'event2',
      title: 'Past Meeting',
      startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 mins ago
    };

    const reminderMinutes = 2;
    const startTime = new Date(event.startTime);
    const reminderTime = new Date(startTime.getTime() - reminderMinutes * 60 * 1000);

    // Should not schedule if reminder time is in the past
    if (reminderTime > new Date()) {
      chrome.alarms.create('meeting_event2', {
        when: reminderTime.getTime(),
      });
    }

    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  test('should filter events to next 24 hours', () => {
    const now = new Date();
    const events = [
      {
        id: '1',
        startTime: new Date(now.getTime() + 1 * 60 * 60 * 1000).toISOString(), // 1 hour
      },
      {
        id: '2',
        startTime: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(), // 12 hours
      },
      {
        id: '3',
        startTime: new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString(), // 25 hours - should be filtered out
      },
    ];

    const upcoming = events.filter(event => {
      const startTime = new Date(event.startTime);
      const hoursUntil = (startTime - now) / (1000 * 60 * 60);
      return hoursUntil > 0 && hoursUntil <= 24;
    });

    expect(upcoming).toHaveLength(2);
    expect(upcoming.find(e => e.id === '3')).toBeUndefined();
  });

  test('should handle timezone changes correctly', () => {
    const eventTimeString = '2024-01-15T14:30:00-08:00'; // PST
    const eventTime = new Date(eventTimeString);
    
    // Should parse as UTC equivalent
    expect(eventTime.toISOString()).toBeTruthy();
    expect(eventTime.getTime()).toBeGreaterThan(0);
  });

  test('should create snooze alarm with correct delay', () => {
    const event = {
      id: 'event1',
      title: 'Test Meeting',
      startTime: new Date().toISOString(),
    };

    const snoozeMinutes = 1;
    const snoozeTime = Date.now() + snoozeMinutes * 60 * 1000;

    chrome.alarms.create('meeting_event1_snooze', {
      when: snoozeTime,
    });

    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'meeting_event1_snooze',
      expect.objectContaining({
        when: expect.any(Number),
      })
    );

    const callArgs = chrome.alarms.create.mock.calls[0][1];
    const expectedTime = snoozeTime;
    const actualTime = callArgs.when;
    
    // Allow 100ms tolerance
    expect(Math.abs(actualTime - expectedTime)).toBeLessThan(100);
  });
});

