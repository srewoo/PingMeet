/**
 * Tests for ConflictDetector
 * Verifies meeting overlap detection and severity calculation
 */

import { jest } from '@jest/globals';
import { ConflictDetector } from '../src/utils/conflict-detector.js';

describe('ConflictDetector', () => {
  describe('detectConflicts', () => {
    test('should detect no conflicts when events do not overlap', () => {
      const events = [
        {
          id: '1',
          title: 'Meeting 1',
          startTime: '2024-01-15T09:00:00Z',
          endTime: '2024-01-15T10:00:00Z',
        },
        {
          id: '2',
          title: 'Meeting 2',
          startTime: '2024-01-15T10:00:00Z',
          endTime: '2024-01-15T11:00:00Z',
        },
      ];

      const conflicts = ConflictDetector.detectConflicts(events);
      expect(conflicts).toHaveLength(0);
    });

    test('should detect conflict when events overlap', () => {
      const events = [
        {
          id: '1',
          title: 'Meeting 1',
          startTime: '2024-01-15T09:00:00Z',
          endTime: '2024-01-15T10:00:00Z',
        },
        {
          id: '2',
          title: 'Meeting 2',
          startTime: '2024-01-15T09:30:00Z',
          endTime: '2024-01-15T10:30:00Z',
        },
      ];

      const conflicts = ConflictDetector.detectConflicts(events);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe('overlap');
      expect(conflicts[0].events).toHaveLength(2);
    });

    test('should detect multiple conflicts', () => {
      const events = [
        {
          id: '1',
          title: 'Meeting 1',
          startTime: '2024-01-15T09:00:00Z',
          endTime: '2024-01-15T10:00:00Z',
        },
        {
          id: '2',
          title: 'Meeting 2',
          startTime: '2024-01-15T09:30:00Z',
          endTime: '2024-01-15T10:30:00Z',
        },
        {
          id: '3',
          title: 'Meeting 3',
          startTime: '2024-01-15T09:45:00Z',
          endTime: '2024-01-15T11:00:00Z',
        },
      ];

      const conflicts = ConflictDetector.detectConflicts(events);
      expect(conflicts.length).toBeGreaterThan(1);
    });

    test('should handle events without endTime (default 1 hour)', () => {
      const events = [
        {
          id: '1',
          title: 'Meeting 1',
          startTime: '2024-01-15T09:00:00Z',
        },
        {
          id: '2',
          title: 'Meeting 2',
          startTime: '2024-01-15T09:30:00Z',
        },
      ];

      const conflicts = ConflictDetector.detectConflicts(events);
      expect(conflicts).toHaveLength(1);
    });

    test('should handle empty events array', () => {
      const conflicts = ConflictDetector.detectConflicts([]);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe('eventsOverlap', () => {
    test('should return true when events overlap', () => {
      const event1 = {
        startTime: '2024-01-15T09:00:00Z',
        endTime: '2024-01-15T10:00:00Z',
      };
      const event2 = {
        startTime: '2024-01-15T09:30:00Z',
        endTime: '2024-01-15T10:30:00Z',
      };

      expect(ConflictDetector.eventsOverlap(event1, event2)).toBe(true);
    });

    test('should return false when events do not overlap', () => {
      const event1 = {
        startTime: '2024-01-15T09:00:00Z',
        endTime: '2024-01-15T10:00:00Z',
      };
      const event2 = {
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T11:00:00Z',
      };

      expect(ConflictDetector.eventsOverlap(event1, event2)).toBe(false);
    });

    test('should return true when event2 starts before event1 ends', () => {
      const event1 = {
        startTime: '2024-01-15T09:00:00Z',
        endTime: '2024-01-15T10:00:00Z',
      };
      const event2 = {
        startTime: '2024-01-15T09:59:00Z',
        endTime: '2024-01-15T10:30:00Z',
      };

      expect(ConflictDetector.eventsOverlap(event1, event2)).toBe(true);
    });
  });

  describe('calculateSeverity', () => {
    test('should return high severity for complete overlap', () => {
      const event1 = {
        startTime: '2024-01-15T09:00:00Z',
        endTime: '2024-01-15T10:00:00Z',
      };
      const event2 = {
        startTime: '2024-01-15T09:00:00Z',
        endTime: '2024-01-15T10:00:00Z',
      };

      const severity = ConflictDetector.calculateSeverity(event1, event2);
      expect(severity).toBe('high');
    });

    test('should return medium severity for partial overlap', () => {
      const event1 = {
        startTime: '2024-01-15T09:00:00Z',
        endTime: '2024-01-15T10:00:00Z',
      };
      const event2 = {
        startTime: '2024-01-15T09:30:00Z',
        endTime: '2024-01-15T10:30:00Z',
      };

      const severity = ConflictDetector.calculateSeverity(event1, event2);
      expect(severity).toBe('medium');
    });

    test('should return low severity for minimal overlap', () => {
      const event1 = {
        startTime: '2024-01-15T09:00:00Z',
        endTime: '2024-01-15T10:00:00Z',
      };
      const event2 = {
        startTime: '2024-01-15T09:50:00Z',
        endTime: '2024-01-15T10:30:00Z',
      };

      const severity = ConflictDetector.calculateSeverity(event1, event2);
      expect(severity).toBe('low');
    });
  });

  describe('getConflictingEvents', () => {
    test('should return events that conflict with target event', () => {
      const target = {
        id: '1',
        startTime: '2024-01-15T09:00:00Z',
        endTime: '2024-01-15T10:00:00Z',
      };
      const allEvents = [
        target,
        {
          id: '2',
          startTime: '2024-01-15T09:30:00Z',
          endTime: '2024-01-15T10:30:00Z',
        },
        {
          id: '3',
          startTime: '2024-01-15T11:00:00Z',
          endTime: '2024-01-15T12:00:00Z',
        },
      ];

      const conflicting = ConflictDetector.getConflictingEvents(target, allEvents);
      expect(conflicting).toHaveLength(1);
      expect(conflicting[0].id).toBe('2');
    });

    test('should exclude the target event itself', () => {
      const target = {
        id: '1',
        startTime: '2024-01-15T09:00:00Z',
        endTime: '2024-01-15T10:00:00Z',
      };
      const allEvents = [target];

      const conflicting = ConflictDetector.getConflictingEvents(target, allEvents);
      expect(conflicting).toHaveLength(0);
    });
  });

  describe('hasConflict', () => {
    test('should return true when event has conflicts', () => {
      const target = {
        id: '1',
        startTime: '2024-01-15T09:00:00Z',
        endTime: '2024-01-15T10:00:00Z',
      };
      const allEvents = [
        target,
        {
          id: '2',
          startTime: '2024-01-15T09:30:00Z',
          endTime: '2024-01-15T10:30:00Z',
        },
      ];

      const hasConflict = ConflictDetector.hasConflict(target, allEvents);
      expect(hasConflict).toBe(true);
    });

    test('should return false when no conflicts', () => {
      const target = {
        id: '1',
        startTime: '2024-01-15T09:00:00Z',
        endTime: '2024-01-15T10:00:00Z',
      };
      const allEvents = [
        target,
        {
          id: '2',
          startTime: '2024-01-15T10:00:00Z',
          endTime: '2024-01-15T11:00:00Z',
        },
      ];

      const hasConflict = ConflictDetector.hasConflict(target, allEvents);
      expect(hasConflict).toBe(false);
    });
  });

  describe('getUpcomingConflicts', () => {
    test('should return conflicts within specified hours', () => {
      const now = new Date();
      const events = [
        {
          id: '1',
          startTime: new Date(now.getTime() + 1 * 60 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: '2',
          startTime: new Date(now.getTime() + 1.5 * 60 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 2.5 * 60 * 60 * 1000).toISOString(),
        },
      ];

      const conflicts = ConflictDetector.getUpcomingConflicts(events, 24);
      expect(conflicts.length).toBeGreaterThan(0);
    });

    test('should filter out past conflicts', () => {
      const now = new Date();
      const events = [
        {
          id: '1',
          startTime: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: '2',
          startTime: new Date(now.getTime() - 1.5 * 60 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() - 0.5 * 60 * 60 * 1000).toISOString(),
        },
      ];

      const conflicts = ConflictDetector.getUpcomingConflicts(events, 24);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe('generateConflictSummary', () => {
    test('should generate summary of conflicts', () => {
      const conflicts = [
        {
          type: 'overlap',
          events: [
            { title: 'Meeting 1' },
            { title: 'Meeting 2' },
          ],
          severity: 'high',
        },
      ];

      const summary = ConflictDetector.generateConflictSummary(conflicts);
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
    });

    test('should handle empty conflicts array', () => {
      const summary = ConflictDetector.generateConflictSummary([]);
      expect(typeof summary).toBe('string');
    });
  });
});
