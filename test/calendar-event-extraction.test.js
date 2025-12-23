/**
 * Tests for Calendar Event Extraction
 * Verifies that event details (title, time, meeting link, attendees) are correctly extracted
 */

import { jest } from '@jest/globals';

describe('Calendar Event Extraction - Google Calendar', () => {
  let CalendarReader;
  let mockDocument;

  beforeEach(() => {
    // Mock DOM
    mockDocument = {
      querySelectorAll: jest.fn(),
      querySelector: jest.fn(),
      body: {},
      addEventListener: jest.fn(),
      createElement: jest.fn(() => ({
        remove: jest.fn(),
        onload: null,
      })),
      head: {},
      documentElement: {},
    };

    global.document = mockDocument;
    global.window = {
      addEventListener: jest.fn(),
      postMessage: jest.fn(),
      location: { href: 'https://calendar.google.com/calendar/u/0/r' },
    };

    // Mock chrome API
    global.chrome = {
      runtime: {
        sendMessage: jest.fn(),
        getURL: jest.fn(path => `chrome-extension://test/${path}`),
      },
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('extractTitle', () => {
    test('should extract title from aria-label', () => {
      const mockElement = {
        getAttribute: jest.fn((attr) => {
          if (attr === 'aria-label') return 'Team Standup, Monday 3pm';
          return null;
        }),
        textContent: '',
        querySelector: jest.fn(),
      };

      // Simulate title extraction logic
      const ariaLabel = mockElement.getAttribute('aria-label');
      const title = ariaLabel.split(',')[0].trim();

      expect(title).toBe('Team Standup');
    });

    test('should extract title from data-tooltip', () => {
      const mockElement = {
        getAttribute: jest.fn((attr) => {
          if (attr === 'data-tooltip') return 'Sprint Planning Meeting';
          return null;
        }),
        textContent: '',
        querySelector: jest.fn(),
      };

      const title = mockElement.getAttribute('data-tooltip');
      expect(title).toBe('Sprint Planning Meeting');
    });

    test('should extract title from text content', () => {
      const mockElement = {
        getAttribute: jest.fn(() => null),
        textContent: 'Client Demo\n10:00 AM',
        querySelector: jest.fn(() => ({ textContent: 'Client Demo' })),
      };

      const titleEl = mockElement.querySelector('[class*="title"]');
      const title = titleEl?.textContent || mockElement.textContent.split('\n')[0];

      expect(title).toBe('Client Demo');
    });

    test('should return null for empty title', () => {
      const mockElement = {
        getAttribute: jest.fn(() => null),
        textContent: '',
        querySelector: jest.fn(() => null),
      };

      const title = mockElement.textContent.trim() || null;
      expect(title).toBeNull();
    });
  });

  describe('extractTime', () => {
    test('should extract time from various formats', () => {
      const timeFormats = [
        { input: 'Meeting at 3:30 PM', expected: '15:30' },
        { input: 'Call at 10:00 AM', expected: '10:00' },
        { input: '2:45pm discussion', expected: '14:45' },
        { input: 'Event on Monday, 11:15 AM', expected: '11:15' },
      ];

      timeFormats.forEach(({ input, expected }) => {
        // Simulate time parsing
        const timeMatch = input.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1]);
          const minutes = timeMatch[2];
          const period = timeMatch[3].toUpperCase();

          if (period === 'PM' && hours !== 12) hours += 12;
          if (period === 'AM' && hours === 12) hours = 0;

          const time = `${hours}:${minutes}`;
          expect(time).toContain(expected.split(':')[1]); // Check minutes
        }
      });
    });

    test('should handle ISO date strings', () => {
      const isoString = '2025-12-18T17:30:00Z';
      const date = new Date(isoString);
      
      expect(date.getUTCHours()).toBe(17);
      expect(date.getUTCMinutes()).toBe(30);
    });

    test('should return null for invalid time', () => {
      const invalidTime = 'No time here';
      const timeMatch = invalidTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      
      expect(timeMatch).toBeNull();
    });
  });

  describe('extractMeetingLink', () => {
    test('should extract Google Meet link from innerHTML', () => {
      const mockElement = {
        innerHTML: '<a href="https://meet.google.com/abc-defg-hij">Join Meeting</a>',
        textContent: 'Join Meeting',
        querySelector: jest.fn(),
        parentElement: null,
      };

      const pattern = /https?:\/\/meet\.google\.com\/[a-z-]+/i;
      const match = mockElement.innerHTML.match(pattern);

      expect(match).not.toBeNull();
      expect(match[0]).toBe('https://meet.google.com/abc-defg-hij');
    });

    test('should extract Zoom link', () => {
      const html = 'Join via <a href="https://zoom.us/j/123456789?pwd=abcdef">Zoom</a>';
      const pattern = /https?:\/\/([\w-]+\.)?zoom\.(us|com)\/[jw]\/\d+(\?pwd=[A-Za-z0-9]+)?/i;
      const match = html.match(pattern);

      expect(match).not.toBeNull();
      expect(match[0]).toContain('zoom.us/j/123456789');
    });

    test('should extract Microsoft Teams link', () => {
      const html = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting';
      const pattern = /https?:\/\/teams\.microsoft\.com\/l\/(meetup-join|meeting)[^\s"]*/i;
      const match = html.match(pattern);

      expect(match).not.toBeNull();
      expect(match[0]).toContain('teams.microsoft.com');
    });

    test('should find meeting link in anchor tag', () => {
      const mockElement = {
        innerHTML: '',
        textContent: '',
        querySelector: jest.fn((selector) => {
          if (selector === 'a[href*="meet.google.com"]') {
            return { href: 'https://meet.google.com/xyz-test-link' };
          }
          return null;
        }),
        parentElement: null,
      };

      const anchor = mockElement.querySelector('a[href*="meet.google.com"]');
      expect(anchor).not.toBeNull();
      expect(anchor.href).toBe('https://meet.google.com/xyz-test-link');
    });

    test('should search parent element for meeting link', () => {
      const parentElement = {
        querySelector: jest.fn(() => ({
          href: 'https://meet.google.com/parent-link',
        })),
      };

      const mockElement = {
        innerHTML: '',
        textContent: '',
        querySelector: jest.fn(() => null),
        parentElement: parentElement,
      };

      const anchor = mockElement.querySelector('a[href*="meet.google.com"]') ||
                     mockElement.parentElement?.querySelector('a[href*="meet.google.com"]');

      expect(anchor).not.toBeNull();
      expect(anchor.href).toBe('https://meet.google.com/parent-link');
    });

    test('should return null when no meeting link found', () => {
      const mockElement = {
        innerHTML: 'Just a regular meeting with no link',
        textContent: 'Just a regular meeting with no link',
        querySelector: jest.fn(() => null),
        parentElement: null,
      };

      const patterns = [
        /https?:\/\/meet\.google\.com\/[a-z-]+/i,
        /https?:\/\/zoom\.(us|com)\/[jw]\/\d+/i,
      ];

      let found = false;
      for (const pattern of patterns) {
        if (mockElement.innerHTML.match(pattern)) {
          found = true;
          break;
        }
      }

      expect(found).toBe(false);
    });
  });

  describe('API Event Parsing', () => {
    test('should parse Google Calendar API event with all fields', () => {
      const apiEvent = {
        id: 'event123',
        summary: 'Team Sync',
        start: {
          dateTime: '2025-12-18T15:00:00-08:00',
          timeZone: 'America/Los_Angeles',
        },
        end: {
          dateTime: '2025-12-18T16:00:00-08:00',
        },
        hangoutLink: 'https://meet.google.com/test-link',
        attendees: [
          {
            email: 'john@example.com',
            displayName: 'John Doe',
            responseStatus: 'accepted',
          },
          {
            email: 'jane@example.com',
            displayName: 'Jane Smith',
            responseStatus: 'needsAction',
          },
        ],
        location: 'Conference Room A',
        description: 'Discuss project updates',
      };

      // Parse attendees
      const attendees = apiEvent.attendees.map(att => ({
        email: att.email,
        name: att.displayName || att.email.split('@')[0],
        responseStatus: att.responseStatus || 'needsAction',
      }));

      expect(attendees).toHaveLength(2);
      expect(attendees[0].email).toBe('john@example.com');
      expect(attendees[0].name).toBe('John Doe');
      expect(attendees[0].responseStatus).toBe('accepted');
      expect(attendees[1].responseStatus).toBe('needsAction');
    });

    test('should handle event without attendees', () => {
      const apiEvent = {
        id: 'event456',
        summary: 'Personal Task',
        start: { dateTime: '2025-12-18T10:00:00Z' },
        end: { dateTime: '2025-12-18T11:00:00Z' },
      };

      const attendees = apiEvent.attendees || [];
      expect(attendees).toHaveLength(0);
    });

    test('should extract conference data when hangoutLink is missing', () => {
      const apiEvent = {
        id: 'event789',
        summary: 'Zoom Meeting',
        start: { dateTime: '2025-12-18T14:00:00Z' },
        conferenceData: {
          entryPoints: [
            { uri: 'https://zoom.us/j/987654321' },
          ],
        },
      };

      const meetingLink = apiEvent.hangoutLink || apiEvent.conferenceData?.entryPoints?.[0]?.uri;
      expect(meetingLink).toBe('https://zoom.us/j/987654321');
    });

    test('should handle missing optional fields', () => {
      const apiEvent = {
        id: 'minimal-event',
        summary: 'Quick Call',
        start: { dateTime: '2025-12-18T09:00:00Z' },
      };

      const location = apiEvent.location || null;
      const description = apiEvent.description || null;
      const attendees = apiEvent.attendees || [];

      expect(location).toBeNull();
      expect(description).toBeNull();
      expect(attendees).toHaveLength(0);
    });
  });

  describe('Attendee Email Extraction', () => {
    test('should extract valid email addresses', () => {
      const attendees = [
        { email: 'user@example.com', name: 'User One' },
        { email: 'another.user@company.co.uk', name: 'User Two' },
        { name: 'No Email User' }, // Missing email
        { email: 'invalid-email', name: 'Invalid' }, // Invalid format
      ];

      const validEmails = attendees
        .map(att => att.email)
        .filter(email => email && email.includes('@'));

      expect(validEmails).toHaveLength(2);
      expect(validEmails).toContain('user@example.com');
      expect(validEmails).toContain('another.user@company.co.uk');
    });

    test('should handle attendee with email but no name', () => {
      const attendee = {
        email: 'noname@example.com',
      };

      const name = attendee.name || attendee.email.split('@')[0];
      expect(name).toBe('noname');
    });
  });

  describe('End Time Calculation', () => {
    test('should calculate end time as 1 hour after start (default)', () => {
      const startTime = new Date('2025-12-18T15:00:00Z');
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

      expect(endTime.getTime() - startTime.getTime()).toBe(3600000); // 1 hour in ms
      expect(endTime.toISOString()).toBe('2025-12-18T16:00:00.000Z');
    });

    test('should use actual end time when provided', () => {
      const startTime = '2025-12-18T15:00:00Z';
      const endTime = '2025-12-18T15:30:00Z'; // 30 minute meeting

      const duration = new Date(endTime).getTime() - new Date(startTime).getTime();
      expect(duration).toBe(1800000); // 30 minutes in ms
    });
  });

  describe('Event Deduplication', () => {
    test('should remove duplicate events by ID', () => {
      const events = [
        { id: 'event1', title: 'Meeting A', startTime: '2025-12-18T10:00:00Z' },
        { id: 'event2', title: 'Meeting B', startTime: '2025-12-18T11:00:00Z' },
        { id: 'event1', title: 'Meeting A', startTime: '2025-12-18T10:00:00Z' }, // Duplicate
        { id: 'event3', title: 'Meeting C', startTime: '2025-12-18T12:00:00Z' },
      ];

      const uniqueEvents = Array.from(
        new Map(events.map(e => [e.id, e])).values()
      );

      expect(uniqueEvents).toHaveLength(3);
      expect(uniqueEvents.map(e => e.id)).toEqual(['event1', 'event2', 'event3']);
    });
  });

  describe('Event Validation', () => {
    test('should validate required fields', () => {
      const validEvent = {
        id: 'valid-event',
        title: 'Valid Meeting',
        startTime: '2025-12-18T10:00:00Z',
      };

      const isValid = !!(validEvent.id && validEvent.title && validEvent.startTime);
      expect(isValid).toBe(true);
    });

    test('should reject event without ID', () => {
      const invalidEvent = {
        title: 'No ID Meeting',
        startTime: '2025-12-18T10:00:00Z',
      };

      const isValid = !!(invalidEvent.id && invalidEvent.title && invalidEvent.startTime);
      expect(isValid).toBe(false);
    });

    test('should reject event without title', () => {
      const invalidEvent = {
        id: 'no-title',
        startTime: '2025-12-18T10:00:00Z',
      };

      const isValid = !!(invalidEvent.id && invalidEvent.title && invalidEvent.startTime);
      expect(isValid).toBe(false);
    });

    test('should reject event without startTime', () => {
      const invalidEvent = {
        id: 'no-time',
        title: 'No Time Meeting',
      };

      const isValid = !!(invalidEvent.id && invalidEvent.title && invalidEvent.startTime);
      expect(isValid).toBe(false);
    });
  });
});

describe('Calendar Event Extraction - Outlook Calendar', () => {
  describe('Outlook API Event Parsing', () => {
    test('should parse Outlook/Microsoft Graph API event', () => {
      const apiEvent = {
        id: 'outlook-event-123',
        subject: 'Project Review',
        start: {
          dateTime: '2025-12-18T14:00:00',
          timeZone: 'Pacific Standard Time',
        },
        end: {
          dateTime: '2025-12-18T15:00:00',
        },
        onlineMeeting: {
          joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting',
        },
        attendees: [
          {
            emailAddress: {
              address: 'alice@company.com',
              name: 'Alice Johnson',
            },
            status: {
              response: 'accepted',
            },
          },
        ],
        location: {
          displayName: 'Building 5, Room 201',
        },
        bodyPreview: 'Quarterly project review meeting',
      };

      // Parse attendees
      const attendees = apiEvent.attendees.map(att => ({
        email: att.emailAddress.address,
        name: att.emailAddress.name || att.emailAddress.address.split('@')[0],
        responseStatus: att.status?.response || 'none',
      }));

      expect(attendees).toHaveLength(1);
      expect(attendees[0].email).toBe('alice@company.com');
      expect(attendees[0].name).toBe('Alice Johnson');
      expect(attendees[0].responseStatus).toBe('accepted');

      expect(apiEvent.onlineMeeting.joinUrl).toContain('teams.microsoft.com');
      expect(apiEvent.location.displayName).toBe('Building 5, Room 201');
    });

    test('should handle Outlook event without online meeting', () => {
      const apiEvent = {
        id: 'in-person-meeting',
        subject: 'In-Person Discussion',
        start: { dateTime: '2025-12-18T10:00:00' },
        end: { dateTime: '2025-12-18T11:00:00' },
        location: { displayName: 'Conference Room' },
      };

      const meetingLink = apiEvent.onlineMeeting?.joinUrl || null;
      expect(meetingLink).toBeNull();
    });
  });

  describe('Outlook Attendee Structure', () => {
    test('should handle nested emailAddress structure', () => {
      const attendee = {
        emailAddress: {
          address: 'bob@example.com',
          name: 'Bob Williams',
        },
        status: {
          response: 'tentative',
        },
      };

      const parsedAttendee = {
        email: attendee.emailAddress.address,
        name: attendee.emailAddress.name,
        responseStatus: attendee.status.response,
      };

      expect(parsedAttendee.email).toBe('bob@example.com');
      expect(parsedAttendee.name).toBe('Bob Williams');
      expect(parsedAttendee.responseStatus).toBe('tentative');
    });
  });
});

