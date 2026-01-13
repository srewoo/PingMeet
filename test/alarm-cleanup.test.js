/**
 * Test alarm cleanup for removed events
 */

import { jest } from '@jest/globals';

// Mock Chrome APIs
global.chrome = {
  alarms: {
    create: jest.fn(),
    clear: jest.fn((name) => Promise.resolve(true)),
    get: jest.fn()
  },
  storage: {
    local: {
      get: jest.fn((keys) => Promise.resolve({})),
      set: jest.fn(() => Promise.resolve()),
      remove: jest.fn(() => Promise.resolve())
    }
  }
};

describe('Alarm Cleanup', () => {
  let service;
  const mockOldEvents = [
    {
      id: 'event1',
      title: 'Team Standup',
      startTime: '2024-01-15T10:00:00Z',
      source: 'google-api'
    },
    {
      id: 'event2',
      title: 'Client Meeting',
      startTime: '2024-01-15T14:00:00Z',
      source: 'google-api'
    },
    {
      id: 'event3',
      title: 'Code Review',
      startTime: '2024-01-15T16:00:00Z',
      source: 'google-api'
    }
  ];

  const mockNewEvents = [
    {
      id: 'event1',
      title: 'Team Standup',
      startTime: '2024-01-15T10:00:00Z',
      source: 'google-api'
    },
    {
      id: 'event3',
      title: 'Code Review',
      startTime: '2024-01-15T16:00:00Z',
      source: 'google-api'
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a mock service with the methods we need
    service = {
      generateAlarmName: (event) => {
        if (!event.startTime) return null;
        const startTime = new Date(event.startTime);
        const roundedTime = Math.floor(startTime.getTime() / 60000) * 60000;
        const normalizedTitle = (event.title || '').toLowerCase().trim().replace(/\s+/g, '-');
        return `meeting_${normalizedTitle}_${roundedTime}`;
      },

      cleanupRemovedEventAlarms: async (oldEvents, newEvents) => {
        if (!oldEvents || oldEvents.length === 0) {
          return;
        }

        const newEventAlarmNames = new Set();
        for (const event of newEvents) {
          const alarmName = service.generateAlarmName(event);
          if (alarmName) {
            newEventAlarmNames.add(alarmName);
          }
        }

        const removedEvents = [];
        for (const oldEvent of oldEvents) {
          const alarmName = service.generateAlarmName(oldEvent);
          if (alarmName && !newEventAlarmNames.has(alarmName)) {
            removedEvents.push(oldEvent);
          }
        }

        if (removedEvents.length === 0) {
          return;
        }

        let canceledCount = 0;
        for (const event of removedEvents) {
          const alarmName = service.generateAlarmName(event);
          if (alarmName) {
            const wasCleared = await chrome.alarms.clear(alarmName);
            if (wasCleared) {
              canceledCount++;
              await chrome.storage.local.remove(alarmName);
            }
          }
        }

        return { removedCount: removedEvents.length, canceledCount };
      }
    };
  });

  describe('generateAlarmName', () => {
    it('should generate consistent alarm names', () => {
      const event = {
        title: 'Team Standup',
        startTime: '2024-01-15T10:00:00Z'
      };

      const alarmName1 = service.generateAlarmName(event);
      const alarmName2 = service.generateAlarmName(event);

      expect(alarmName1).toBe(alarmName2);
      expect(alarmName1).toMatch(/^meeting_team-standup_\d+$/);
    });

    it('should normalize titles consistently', () => {
      const event1 = { title: 'Team  Standup', startTime: '2024-01-15T10:00:00Z' };
      const event2 = { title: 'Team Standup', startTime: '2024-01-15T10:00:00Z' };

      expect(service.generateAlarmName(event1)).toBe(service.generateAlarmName(event2));
    });

    it('should handle empty title', () => {
      const event = { title: '', startTime: '2024-01-15T10:00:00Z' };
      const alarmName = service.generateAlarmName(event);

      expect(alarmName).toMatch(/^meeting__\d+$/);
    });

    it('should return null for event without startTime', () => {
      const event = { title: 'Meeting' };
      expect(service.generateAlarmName(event)).toBeNull();
    });
  });

  describe('cleanupRemovedEventAlarms', () => {
    it('should identify removed events', async () => {
      const result = await service.cleanupRemovedEventAlarms(mockOldEvents, mockNewEvents);

      expect(result.removedCount).toBe(1); // event2 was removed
      expect(result.canceledCount).toBe(1);
    });

    it('should call chrome.alarms.clear for removed events', async () => {
      await service.cleanupRemovedEventAlarms(mockOldEvents, mockNewEvents);

      expect(chrome.alarms.clear).toHaveBeenCalledTimes(1);
      expect(chrome.alarms.clear).toHaveBeenCalledWith(
        expect.stringContaining('client-meeting')
      );
    });

    it('should remove stored event data', async () => {
      await service.cleanupRemovedEventAlarms(mockOldEvents, mockNewEvents);

      expect(chrome.storage.local.remove).toHaveBeenCalledTimes(1);
    });

    it('should handle empty old events array', async () => {
      const result = await service.cleanupRemovedEventAlarms([], mockNewEvents);

      expect(result).toBeUndefined();
      expect(chrome.alarms.clear).not.toHaveBeenCalled();
    });

    it('should handle no removed events', async () => {
      const result = await service.cleanupRemovedEventAlarms(mockNewEvents, mockNewEvents);

      expect(result).toBeUndefined();
      expect(chrome.alarms.clear).not.toHaveBeenCalled();
    });

    it('should handle all events removed', async () => {
      const result = await service.cleanupRemovedEventAlarms(mockOldEvents, []);

      expect(result.removedCount).toBe(3);
      expect(result.canceledCount).toBe(3);
      expect(chrome.alarms.clear).toHaveBeenCalledTimes(3);
    });

    it('should handle events with same title but different times', async () => {
      const oldEvents = [
        { title: 'Standup', startTime: '2024-01-15T10:00:00Z' },
        { title: 'Standup', startTime: '2024-01-15T14:00:00Z' }
      ];

      const newEvents = [
        { title: 'Standup', startTime: '2024-01-15T10:00:00Z' }
      ];

      const result = await service.cleanupRemovedEventAlarms(oldEvents, newEvents);

      expect(result.removedCount).toBe(1); // Only the 2pm standup should be removed
      expect(result.canceledCount).toBe(1);
    });
  });

  describe('integration scenarios', () => {
    it('should handle meeting host deleting a meeting', async () => {
      // User has 3 meetings scheduled
      const scheduled = mockOldEvents;

      // Host deletes the middle meeting
      const afterDeletion = mockNewEvents;

      const result = await service.cleanupRemovedEventAlarms(scheduled, afterDeletion);

      expect(result.removedCount).toBe(1);
      expect(chrome.alarms.clear).toHaveBeenCalledWith(
        expect.stringContaining('client-meeting')
      );
    });

    it('should handle meeting time change (appears as delete + add)', async () => {
      const oldMeeting = {
        title: 'Team Sync',
        startTime: '2024-01-15T10:00:00Z'
      };

      const newMeeting = {
        title: 'Team Sync',
        startTime: '2024-01-15T11:00:00Z' // Changed time
      };

      const result = await service.cleanupRemovedEventAlarms([oldMeeting], [newMeeting]);

      // Should detect as removed because time changed (different alarm name)
      expect(result.removedCount).toBe(1);
      expect(result.canceledCount).toBe(1);
    });

    it('should not remove events that are still present', async () => {
      const events = mockOldEvents;

      const result = await service.cleanupRemovedEventAlarms(events, events);

      expect(result).toBeUndefined();
      expect(chrome.alarms.clear).not.toHaveBeenCalled();
    });
  });
});
