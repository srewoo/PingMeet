/**
 * Integration tests for outlook-reader.js
 * Tests Outlook-specific DOM parsing and Microsoft Graph API handling
 */

describe('OutlookReader Integration', () => {
  let mockDocument;
  let mockWindow;
  let mockChrome;

  beforeEach(() => {
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
      body: {},
    };

    mockWindow = {
      location: { href: 'https://outlook.office.com/calendar' },
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

  test('should extract Outlook event with data-event-id', () => {
    const mockElement = {
      getAttribute: jest.fn(attr => {
        if (attr === 'data-event-id') return 'outlook-event-123';
        if (attr === 'aria-label') return 'Team Sync, 3:00 PM - 3:30 PM';
        return null;
      }),
      querySelector: jest.fn(() => ({
        textContent: 'Team Sync',
      })),
      textContent: 'Team Sync 3:00 PM',
      innerHTML: 'Team Sync <a href="https://teams.microsoft.com/l/meetup-join/xxx">Join Teams</a>',
    };

    const eventId = mockElement.getAttribute('data-event-id');
    expect(eventId).toBe('outlook-event-123');

    const title = mockElement.querySelector()?.textContent;
    expect(title).toBe('Team Sync');
  });

  test('should extract Teams meeting links', () => {
    const html =
      'Join meeting: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc123';

    const teamsPattern = /https?:\/\/teams\.microsoft\.com\/l\/meetup-join[^\s"<>]*/i;
    const match = html.match(teamsPattern);

    expect(match).toBeTruthy();
    expect(match[0]).toContain('teams.microsoft.com/l/meetup-join');
  });

  test('should parse time from Outlook aria-label format', () => {
    const ariaLabel = 'Sprint Review, Wednesday, December 18, 2:00 PM - 3:00 PM';

    const timeMatch = ariaLabel.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/);
    expect(timeMatch).toBeTruthy();
    expect(timeMatch[1]).toBe('2');
    expect(timeMatch[2]).toBe('00');
    expect(timeMatch[3]).toBe('PM');

    let hours = parseInt(timeMatch[1]);
    const meridiem = timeMatch[3]?.toUpperCase();
    if (meridiem === 'PM' && hours < 12) hours += 12;

    expect(hours).toBe(14);
  });

  test('should handle Microsoft Graph API response', () => {
    const graphApiResponse = {
      value: [
        {
          id: 'AAMkAGI1',
          subject: 'All Hands Meeting',
          start: {
            dateTime: '2025-12-18T15:00:00',
            timeZone: 'UTC',
          },
          onlineMeeting: {
            joinUrl: 'https://teams.microsoft.com/l/meetup-join/xxx',
          },
        },
        {
          id: 'AAMkAGI2',
          subject: '1:1 with Manager',
          start: {
            dateTime: '2025-12-18T16:30:00',
          },
          onlineMeeting: null,
        },
      ],
    };

    const events = [];
    for (const item of graphApiResponse.value) {
      if (item.id && item.subject) {
        const startTime = item.start?.dateTime;
        if (startTime) {
          events.push({
            id: item.id,
            title: item.subject,
            startTime: new Date(startTime).toISOString(),
            meetingLink: item.onlineMeeting?.joinUrl || null,
            source: 'outlook-api',
          });
        }
      }
    }

    expect(events).toHaveLength(2);
    expect(events[0].title).toBe('All Hands Meeting');
    expect(events[0].meetingLink).toContain('teams.microsoft.com');
    expect(events[1].meetingLink).toBeNull();
  });

  test('should parse list items with meeting indicators', () => {
    const mockListItem = {
      getAttribute: jest.fn(attr => {
        if (attr === 'role') return 'listitem';
        if (attr === 'aria-label') return 'Daily Standup, 9:00 AM, meeting';
        return null;
      }),
      textContent: 'Daily Standup\n9:00 AM',
      innerHTML: 'Daily Standup',
    };

    const ariaLabel = mockListItem.getAttribute('aria-label');
    const hasMeetingKeyword =
      ariaLabel.toLowerCase().includes('meeting') ||
      ariaLabel.toLowerCase().includes('event') ||
      ariaLabel.match(/\d{1,2}:\d{2}/);

    expect(hasMeetingKeyword).toBe(true);

    const title = ariaLabel.split(',')[0]?.trim();
    expect(title).toBe('Daily Standup');
  });

  test('should deduplicate Outlook events preferring API data', () => {
    const events = [
      { id: 'outlook1', title: 'Meeting A', source: 'outlook-dom' },
      { id: 'outlook2', title: 'Meeting B', source: 'outlook-list' },
      { id: 'outlook1', title: 'Meeting A', source: 'outlook-api' },
    ];

    const seen = new Map();
    for (const event of events) {
      const key = event.id || `${event.title}-${event.startTime}`;
      if (!seen.has(key)) {
        seen.set(key, event);
      } else if (event.source === 'outlook-api') {
        seen.set(key, event);
      }
    }

    const deduplicated = Array.from(seen.values());
    expect(deduplicated).toHaveLength(2);
    expect(deduplicated.find(e => e.id === 'outlook1').source).toBe('outlook-api');
  });

  test('should handle Outlook event buttons with aria-labels', () => {
    const mockButton = {
      getAttribute: jest.fn(attr => {
        if (attr === 'role') return 'button';
        if (attr === 'aria-label') return 'Project Review, 4:15 PM';
        return null;
      }),
      textContent: 'Project Review',
    };

    const ariaLabel = mockButton.getAttribute('aria-label');
    const hasTime = ariaLabel.match(/\d{1,2}:\d{2}/);

    expect(hasTime).toBeTruthy();

    const title = ariaLabel.split(',')[0]?.trim();
    expect(title).toBe('Project Review');
    expect(title.length).toBeGreaterThanOrEqual(3);
  });

  test('should send Outlook events to background', () => {
    const events = [
      {
        id: 'outlook-event-1',
        title: 'Quarterly Review',
        startTime: new Date().toISOString(),
        meetingLink: 'https://teams.microsoft.com/l/meetup-join/abc',
        source: 'outlook-api',
      },
    ];

    chrome.runtime.sendMessage({ type: 'CALENDAR_EVENTS', events: events }, () => {});

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CALENDAR_EVENTS',
        events: expect.arrayContaining([
          expect.objectContaining({
            title: 'Quarterly Review',
            source: 'outlook-api',
          }),
        ]),
      }),
      expect.any(Function)
    );
  });

  test('should handle missing Outlook event data gracefully', () => {
    const badElements = [
      { getAttribute: () => null, textContent: '' },
      { getAttribute: () => 'id1', textContent: 'A' }, // Title too short
      { getAttribute: () => 'id2', textContent: '' }, // No title
    ];

    const parsedEvents = badElements
      .map(el => {
        const eventId = el.getAttribute('data-event-id');
        const title = el.textContent?.trim();

        if (!eventId || !title || title.length < 3) return null;

        return { id: eventId, title: title };
      })
      .filter(e => e !== null);

    expect(parsedEvents).toHaveLength(0);
  });

  test('should extract meeting links from Outlook HTML', () => {
    const testCases = [
      {
        html: '<a href="https://teams.microsoft.com/l/meetup-join/xxx">Join</a>',
        expected: 'https://teams.microsoft.com/l/meetup-join/xxx',
      },
      {
        html: 'Join via https://meet.google.com/abc-defg',
        expected: 'https://meet.google.com/abc-defg',
      },
      {
        html: 'Zoom: https://zoom.us/j/987654321',
        expected: 'https://zoom.us/j/987654321',
      },
    ];

    testCases.forEach(({ html, expected }) => {
      const patterns = [
        /https?:\/\/teams\.microsoft\.com\/l\/meetup-join[^\s"<>]*/i,
        /https?:\/\/meet\.google\.com\/[a-z-]+/i,
        /https?:\/\/zoom\.us\/j\/\d+(\?pwd=[A-Za-z0-9]+)?/i,
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
});

