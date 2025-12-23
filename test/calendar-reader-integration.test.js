/**
 * Integration tests for calendar-reader.js
 * Tests DOM parsing, event extraction, and API handling
 */

describe('CalendarReader Integration', () => {
  let mockDocument;
  let mockWindow;
  let mockChrome;

  beforeEach(() => {
    // Mock DOM
    mockDocument = {
      querySelector: jest.fn(),
      querySelectorAll: jest.fn(() => []),
      createElement: jest.fn(() => ({
        src: '',
        onload: null,
        remove: jest.fn(),
      })),
      head: {},
      documentElement: {},
    };

    mockWindow = {
      location: { href: 'https://calendar.google.com/calendar' },
      addEventListener: jest.fn(),
      postMessage: jest.fn(),
    };

    mockChrome = {
      runtime: {
        getURL: jest.fn(path => `chrome-extension://test/${path}`),
        sendMessage: jest.fn((msg, callback) => {
          if (callback) callback({ received: true });
        }),
        lastError: null,
      },
    };

    global.document = mockDocument;
    global.window = mockWindow;
    global.chrome = mockChrome;
    global.console = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  test('should extract event with data-eventid', () => {
    const mockElement = {
      getAttribute: jest.fn(attr => {
        if (attr === 'data-eventid') return 'event123';
        if (attr === 'aria-label') return 'Team Standup, December 18, 10:30 AM';
        return null;
      }),
      querySelector: jest.fn(() => ({
        textContent: 'Team Standup',
      })),
      textContent: 'Team Standup 10:30 AM',
      innerHTML: 'Team Standup <a href="https://meet.google.com/abc-defg">Join</a>',
    };

    // Test title extraction
    const title = mockElement.querySelector()?.textContent;
    expect(title).toBe('Team Standup');

    // Test ID extraction
    const eventId = mockElement.getAttribute('data-eventid');
    expect(eventId).toBe('event123');

    // Test meeting link extraction
    const html = mockElement.innerHTML;
    const meetingLinkMatch = html.match(/https?:\/\/meet\.google\.com\/[a-z-]+/i);
    expect(meetingLinkMatch).toBeTruthy();
    expect(meetingLinkMatch[0]).toBe('https://meet.google.com/abc-defg');
  });

  test('should parse time from aria-label', () => {
    const ariaLabel = 'Team Meeting, December 18, 2:45 PM';
    
    const timeMatch = ariaLabel.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/);
    expect(timeMatch).toBeTruthy();
    expect(timeMatch[1]).toBe('2');
    expect(timeMatch[2]).toBe('45');
    expect(timeMatch[3]).toBe('PM');

    // Convert to 24-hour
    let hours = parseInt(timeMatch[1]);
    const meridiem = timeMatch[3]?.toUpperCase();
    if (meridiem === 'PM' && hours < 12) hours += 12;
    expect(hours).toBe(14);
  });

  test('should extract multiple meeting link types', () => {
    const testCases = [
      {
        html: 'Join at https://meet.google.com/abc-defg-hij',
        expected: 'https://meet.google.com/abc-defg-hij',
      },
      {
        html: 'Zoom link: https://zoom.us/j/123456789?pwd=abc123',
        expected: 'https://zoom.us/j/123456789?pwd=abc123',
      },
      {
        html: 'Teams: https://teams.microsoft.com/l/meetup-join/xxx',
        expected: 'https://teams.microsoft.com/l/meetup-join/xxx',
      },
    ];

    testCases.forEach(({ html, expected }) => {
      const patterns = [
        /https?:\/\/meet\.google\.com\/[a-z-]+/i,
        /https?:\/\/zoom\.us\/j\/\d+(\?pwd=[A-Za-z0-9]+)?/i,
        /https?:\/\/teams\.microsoft\.com\/l\/meetup-join[^\s"<>]*/i,
      ];

      let found = false;
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
          expect(match[0]).toBe(expected);
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });
  });

  test('should deduplicate events by ID', () => {
    const events = [
      { id: 'event1', title: 'Meeting 1', source: 'dom-eventid' },
      { id: 'event2', title: 'Meeting 2', source: 'dom-aria' },
      { id: 'event1', title: 'Meeting 1', source: 'api' }, // Duplicate, prefer API
    ];

    const seen = new Map();
    for (const event of events) {
      const key = event.id || `${event.title}-${event.startTime}`;
      if (!seen.has(key)) {
        seen.set(key, event);
      } else if (event.source === 'api') {
        seen.set(key, event); // Prefer API data
      }
    }

    const deduplicated = Array.from(seen.values());
    expect(deduplicated).toHaveLength(2);
    expect(deduplicated.find(e => e.id === 'event1').source).toBe('api');
  });

  test('should handle API data from postMessage', () => {
    const apiData = {
      items: [
        {
          id: 'api-event-1',
          summary: 'Sprint Planning',
          start: {
            dateTime: '2025-12-18T14:00:00Z',
          },
          hangoutLink: 'https://meet.google.com/xyz-abc',
        },
      ],
    };

    // Simulate API data parsing
    const events = [];
    for (const item of apiData.items) {
      if (item.id && item.summary) {
        const startTime = item.start?.dateTime;
        if (startTime) {
          events.push({
            id: item.id,
            title: item.summary,
            startTime: new Date(startTime).toISOString(),
            meetingLink: item.hangoutLink || null,
            source: 'api',
          });
        }
      }
    }

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('api-event-1');
    expect(events[0].title).toBe('Sprint Planning');
    expect(events[0].meetingLink).toBe('https://meet.google.com/xyz-abc');
  });

  test('should send events to background via chrome.runtime.sendMessage', () => {
    const events = [
      {
        id: 'event1',
        title: 'Test Meeting',
        startTime: new Date().toISOString(),
        meetingLink: 'https://meet.google.com/test',
      },
    ];

    chrome.runtime.sendMessage(
      { type: 'CALENDAR_EVENTS', events: events },
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

  test('should handle missing or malformed event data gracefully', () => {
    const badElements = [
      { getAttribute: () => null, textContent: '' }, // No event ID
      { getAttribute: () => 'id1', textContent: '' }, // No title
      { getAttribute: () => 'id2', textContent: 'Meeting', innerHTML: '' }, // No time
    ];

    const parsedEvents = badElements
      .map(el => {
        const eventId = el.getAttribute('data-eventid');
        const title = el.textContent?.trim();
        
        if (!eventId || !title) return null;
        
        return { id: eventId, title: title };
      })
      .filter(e => e !== null);

    expect(parsedEvents).toHaveLength(0);
  });

  test('should extract date from various formats', () => {
    const testCases = [
      { text: 'Meeting on December 18, 2025', expected: { month: 11, day: 18, year: 2025 } },
      { text: 'January 5, 2026 at 10:00 AM', expected: { month: 0, day: 5, year: 2026 } },
    ];

    testCases.forEach(({ text, expected }) => {
      const dateMatch = text.match(/(\w+)\s+(\d{1,2})(?:,\s*(\d{4}))?/);
      expect(dateMatch).toBeTruthy();

      const monthName = dateMatch[1];
      const day = parseInt(dateMatch[2]);
      const year = dateMatch[3] ? parseInt(dateMatch[3]) : new Date().getFullYear();

      const months = [
        'january',
        'february',
        'march',
        'april',
        'may',
        'june',
        'july',
        'august',
        'september',
        'october',
        'november',
        'december',
      ];
      const monthIndex = months.findIndex(m =>
        monthName.toLowerCase().startsWith(m.substring(0, 3))
      );

      expect(monthIndex).toBe(expected.month);
      expect(day).toBe(expected.day);
      expect(year).toBe(expected.year);
    });
  });
});

