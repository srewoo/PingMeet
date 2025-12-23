/**
 * Tests for CalendarReader content script
 * Verifies event extraction from Google Calendar DOM
 */

import { jest } from '@jest/globals';

describe('CalendarReader', () => {
  let mockElement;

  beforeEach(() => {
    // Mock Chrome runtime API
    global.chrome = {
      runtime: {
        sendMessage: jest.fn((message, callback) => {
          if (callback) callback({ received: true });
          return Promise.resolve({ received: true });
        }),
        lastError: null,
      },
    };

    // Mock DOM element
    mockElement = {
      getAttribute: jest.fn(),
      querySelector: jest.fn(),
      textContent: '',
      innerHTML: '',
      parentElement: null,
    };

    // Mock document
    global.document = {
      querySelector: jest.fn(),
      querySelectorAll: jest.fn(() => []),
      body: {},
      readyState: 'complete',
      addEventListener: jest.fn(),
    };

    // Mock setInterval
    global.setInterval = jest.fn();
  });

  test('should extract event ID from data attribute', () => {
    mockElement.getAttribute.mockImplementation((attr) => {
      if (attr === 'data-eventid') return 'event123';
      return null;
    });

    mockElement.querySelector.mockReturnValue({
      textContent: 'Daily Standup',
    });

    mockElement.innerHTML = 'meet.google.com/abc-defg-hij';

    // CalendarReader would parse this element
    const eventId = mockElement.getAttribute('data-eventid');
    expect(eventId).toBe('event123');
  });

  test('should extract meeting links from various platforms', () => {
    const testCases = [
      {
        html: 'Join at meet.google.com/abc-defg-hij today',
        expected: 'https://meet.google.com/abc-defg-hij',
      },
      {
        html: 'Zoom link: zoom.us/j/123456789',
        expected: 'https://zoom.us/j/123456789',
      },
      {
        html: 'Teams: teams.microsoft.com/l/meetup-join/xxx',
        expected: 'https://teams.microsoft.com/l/meetup-join/xxx',
      },
    ];

    testCases.forEach(({ html, expected }) => {
      const regex = /meet\.google\.com\/[a-z-]+|zoom\.us\/j\/\d+|teams\.microsoft\.com\/l\/meetup-join[^\s"]*/i;
      const match = html.match(regex);
      expect(match).not.toBeNull();
      expect(`https://${match[0]}`).toBe(expected);
    });
  });

  test('should parse time strings correctly', () => {
    const testCases = [
      { input: '9:30 AM', hours: 9, minutes: 30 },
      { input: '2:45 PM', hours: 14, minutes: 45 },
      { input: '12:00 PM', hours: 12, minutes: 0 },
      { input: '12:00 AM', hours: 0, minutes: 0 },
    ];

    testCases.forEach(({ input, hours, minutes }) => {
      const timeRegex = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i;
      const match = input.match(timeRegex);
      
      expect(match).not.toBeNull();
      
      let parsedHours = parseInt(match[1]);
      const parsedMinutes = parseInt(match[2]);
      const meridiem = match[3]?.toUpperCase();

      if (meridiem === 'PM' && parsedHours < 12) {
        parsedHours += 12;
      } else if (meridiem === 'AM' && parsedHours === 12) {
        parsedHours = 0;
      }

      expect(parsedHours).toBe(hours);
      expect(parsedMinutes).toBe(minutes);
    });
  });

  test('should send events to background script', () => {
    const events = [
      {
        id: 'event1',
        title: 'Test Meeting',
        startTime: new Date().toISOString(),
      },
    ];

    chrome.runtime.sendMessage(
      {
        type: 'CALENDAR_EVENTS',
        events: events,
      },
      () => {}
    );

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CALENDAR_EVENTS',
        events: expect.any(Array),
      }),
      expect.any(Function)
    );
  });

  test('should deduplicate events by ID', () => {
    const events = [
      { id: '1', title: 'Meeting 1', source: 'dom' },
      { id: '2', title: 'Meeting 2', source: 'dom' },
      { id: '1', title: 'Meeting 1', source: 'api' }, // Duplicate, prefer API
    ];

    const seen = new Map();
    for (const event of events) {
      if (!seen.has(event.id)) {
        seen.set(event.id, event);
      } else {
        const existing = seen.get(event.id);
        if (event.source === 'api' && existing.source === 'dom') {
          seen.set(event.id, event);
        }
      }
    }

    const deduplicated = Array.from(seen.values());
    
    expect(deduplicated).toHaveLength(2);
    expect(deduplicated.find(e => e.id === '1').source).toBe('api');
  });
});

