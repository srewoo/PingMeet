/**
 * Conflict Detector - Identifies overlapping meetings and scheduling conflicts
 */

export class ConflictDetector {
  /**
   * Detect overlapping events
   * @param {Array} events - Array of event objects with startTime and endTime
   * @returns {Array} Array of conflict objects
   */
  static detectConflicts(events) {
    const conflicts = [];

    // Sort events by start time
    const sortedEvents = [...events].sort((a, b) => {
      return new Date(a.startTime) - new Date(b.startTime);
    });

    // Check each pair of events
    for (let i = 0; i < sortedEvents.length; i++) {
      for (let j = i + 1; j < sortedEvents.length; j++) {
        const event1 = sortedEvents[i];
        const event2 = sortedEvents[j];

        if (this.eventsOverlap(event1, event2)) {
          conflicts.push({
            type: 'overlap',
            events: [event1, event2],
            message: `"${event1.title}" overlaps with "${event2.title}"`,
            severity: this.calculateSeverity(event1, event2),
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Check if two events overlap
   * @param {Object} event1 - First event
   * @param {Object} event2 - Second event
   * @returns {boolean} True if events overlap
   */
  static eventsOverlap(event1, event2) {
    const start1 = new Date(event1.startTime);
    const end1 = event1.endTime ? new Date(event1.endTime) : new Date(start1.getTime() + 60 * 60 * 1000); // Default 1 hour

    const start2 = new Date(event2.startTime);
    const end2 = event2.endTime ? new Date(event2.endTime) : new Date(start2.getTime() + 60 * 60 * 1000); // Default 1 hour

    return start1 < end2 && start2 < end1;
  }

  /**
   * Calculate conflict severity
   * @param {Object} event1 - First event
   * @param {Object} event2 - Second event
   * @returns {string} Severity level: 'high', 'medium', 'low'
   */
  static calculateSeverity(event1, event2) {
    const start1 = new Date(event1.startTime);
    const start2 = new Date(event2.startTime);

    // If events start at exactly the same time
    if (start1.getTime() === start2.getTime()) {
      return 'high';
    }

    // Calculate overlap duration
    const end1 = event1.endTime ? new Date(event1.endTime) : new Date(start1.getTime() + 60 * 60 * 1000);
    const end2 = event2.endTime ? new Date(event2.endTime) : new Date(start2.getTime() + 60 * 60 * 1000);

    const overlapStart = new Date(Math.max(start1, start2));
    const overlapEnd = new Date(Math.min(end1, end2));
    const overlapMinutes = (overlapEnd - overlapStart) / (1000 * 60);

    // High severity if overlap is more than 30 minutes
    if (overlapMinutes > 30) {
      return 'high';
    } else if (overlapMinutes > 15) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Get upcoming conflicts within a time window
   * @param {Array} events - Array of event objects
   * @param {number} hoursAhead - Hours to look ahead (default 24)
   * @returns {Array} Array of upcoming conflicts
   */
  static getUpcomingConflicts(events, hoursAhead = 24) {
    const now = new Date();
    const cutoff = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

    // Filter to upcoming events
    const upcomingEvents = events.filter(event => {
      const startTime = new Date(event.startTime);
      return startTime >= now && startTime <= cutoff;
    });

    return this.detectConflicts(upcomingEvents);
  }

  /**
   * Check if an event has a conflict
   * @param {Object} event - Event to check
   * @param {Array} allEvents - All events to check against
   * @returns {boolean} True if event has conflicts
   */
  static hasConflict(event, allEvents) {
    return allEvents.some(otherEvent => {
      if (otherEvent.id === event.id) return false;
      return this.eventsOverlap(event, otherEvent);
    });
  }

  /**
   * Find all events that conflict with a given event
   * @param {Object} event - Event to check
   * @param {Array} allEvents - All events to check against
   * @returns {Array} Array of conflicting events
   */
  static getConflictingEvents(event, allEvents) {
    return allEvents.filter(otherEvent => {
      if (otherEvent.id === event.id) return false;
      return this.eventsOverlap(event, otherEvent);
    });
  }

  /**
   * Generate a conflict summary message
   * @param {Array} conflicts - Array of conflict objects
   * @returns {string} Summary message
   */
  static generateConflictSummary(conflicts) {
    if (conflicts.length === 0) {
      return 'No scheduling conflicts detected.';
    }

    const highSeverity = conflicts.filter(c => c.severity === 'high').length;
    const mediumSeverity = conflicts.filter(c => c.severity === 'medium').length;
    const lowSeverity = conflicts.filter(c => c.severity === 'low').length;

    let summary = `${conflicts.length} scheduling conflict${conflicts.length > 1 ? 's' : ''} detected`;

    if (highSeverity > 0) {
      summary += ` (${highSeverity} high priority)`;
    } else if (mediumSeverity > 0) {
      summary += ` (${mediumSeverity} medium priority)`;
    } else {
      summary += ` (${lowSeverity} low priority)`;
    }

    return summary;
  }
}
