/**
 * Content Script - Reads calendar events from Google Calendar DOM
 * Runs on calendar.google.com pages
 *
 * Enhanced Extraction Methods:
 * 1. API Interception (via injected script)
 * 2. XHR Interception (via injected script)
 * 3. DOM Parsing (multiple strategies)
 * 4. React State Extraction (via injected script)
 * 5. LocalStorage Reading (via injected script)
 * 6. Event Popup Scraping (this file)
 * 7. Enhanced Regex Patterns (this file)
 */

// Immediate log to confirm script is loaded by Chrome
console.log('🔔 PingMeet: Google Calendar content script loaded (Enhanced v2)');

class CalendarReader {
  constructor() {
    this.observer = null;
    this.popupObserver = null;
    this.lastEvents = [];
    this.isInitialized = false;
    this.readInterval = null;
    this.reloadNotificationShown = false;
    this.contextInvalidated = false;
    this.healthCheckInterval = null;
    this.eventDetailsCache = new Map(); // Cache scraped event details
  }

  /**
   * Check if extension context is valid
   * @returns {boolean}
   */
  isContextValid() {
    try {
      // Check if chrome.runtime exists and has an ID
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (error) {
      return false;
    }
  }

  /**
   * Start health check to detect context invalidation early
   */
  startHealthCheck() {
    // Check every 10 seconds if extension context is still valid
    this.healthCheckInterval = setInterval(() => {
      if (!this.isContextValid() && !this.contextInvalidated) {
        console.log('PingMeet: Extension was reloaded, cleaning up...');
        this.handleContextInvalidation();
      }
    }, 10000);
  }

  /**
   * Initialize the calendar reader
   */
  init() {
    console.log('PingMeet: Calendar reader initializing (Enhanced v2)...');

    // Verify context is valid before starting
    if (!this.isContextValid()) {
      console.error('PingMeet: Extension context is invalid at initialization');
      this.handleContextInvalidation();
      return;
    }

    // Start health check
    this.startHealthCheck();

    // Inject script into page's main world for fetch interception
    this.injectPageScript();

    // Listen for messages from injected script (multiple message types)
    window.addEventListener('message', (event) => {
      // Standard API data (Fetch/XHR)
      if (event.data?.type === 'PINGMEET_CALENDAR_DATA' && event.data?.source === 'google') {
        console.log('PingMeet: Received calendar data from page context');
        this.handleApiData(event.data.data);
      }

      // React state extraction data
      if (event.data?.type === 'PINGMEET_REACT_STATE') {
        console.log('PingMeet: Received React state data');
        this.handleReactStateData(event.data.events);
      }

      // LocalStorage/SessionStorage data
      if (event.data?.type === 'PINGMEET_STORAGE_DATA') {
        console.log('PingMeet: Received storage data');
        this.handleStorageData(event.data.events);
      }
    });

    // Wait for calendar to be fully loaded, then read DOM
    this.waitForCalendar().then(() => {
      console.log('PingMeet: Calendar DOM ready, reading events...');
      this.readEvents();
      this.observeChanges();
      this.observeEventPopups(); // NEW: Watch for event detail popups
      this.readInterval = setInterval(() => this.readEvents(), 30000);
      this.isInitialized = true;
    });
  }

  /**
   * Handle React state data from injected script
   */
  handleReactStateData(events) {
    if (this.contextInvalidated || !this.isContextValid()) return;

    if (events && events.length > 0) {
      console.log(`PingMeet: Processing ${events.length} events from React state`);
      // Merge with existing events, prefer API data
      const mergedEvents = this.mergeEventSources(this.lastEvents, events);
      if (mergedEvents.length > 0) {
        this.sendToBackground(mergedEvents);
      }
    }
  }

  /**
   * Handle storage data from injected script
   */
  handleStorageData(events) {
    if (this.contextInvalidated || !this.isContextValid()) return;

    if (events && events.length > 0) {
      console.log(`PingMeet: Processing ${events.length} events from storage`);
      // Merge with existing events
      const mergedEvents = this.mergeEventSources(this.lastEvents, events);
      if (mergedEvents.length > 0) {
        this.sendToBackground(mergedEvents);
      }
    }
  }

  /**
   * Merge events from multiple sources, preferring richer data
   */
  mergeEventSources(existing, newEvents) {
    const eventMap = new Map();

    // Add existing events
    existing.forEach(e => {
      const key = e.id || `${e.title}-${e.startTime}`;
      eventMap.set(key, e);
    });

    // Merge new events, enriching existing data
    newEvents.forEach(e => {
      const key = e.id || `${e.title}-${e.startTime}`;
      if (eventMap.has(key)) {
        // Merge: keep existing data but add missing fields from new
        const existing = eventMap.get(key);
        eventMap.set(key, this.mergeEventData(existing, e));
      } else {
        eventMap.set(key, e);
      }
    });

    return Array.from(eventMap.values());
  }

  /**
   * Merge two event objects, preferring non-null values
   */
  mergeEventData(primary, secondary) {
    const merged = { ...primary };

    // Fields to potentially fill from secondary
    const fields = [
      'description', 'location', 'attendees', 'organizer', 'organizerName',
      'meetingLink', 'recurrence', 'status', 'visibility', 'colorId',
      'htmlLink', 'dialIn', 'conferenceId', 'attachments'
    ];

    fields.forEach(field => {
      if (!merged[field] && secondary[field]) {
        merged[field] = secondary[field];
      }
      // For arrays, merge if primary is empty
      if (Array.isArray(merged[field]) && merged[field].length === 0 &&
          Array.isArray(secondary[field]) && secondary[field].length > 0) {
        merged[field] = secondary[field];
      }
    });

    return merged;
  }

  /**
   * Inject script into page's main world for fetch interception
   */
  injectPageScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('src/content/injected-script.js');
      script.onload = function() {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
      console.log('PingMeet: Injected page script for API interception');
    } catch (e) {
      console.warn('PingMeet: Could not inject page script', e);
    }
  }

  /**
   * Handle API data from injected script
   */
  handleApiData(data) {
    // Check context validity before processing
    if (this.contextInvalidated || !this.isContextValid()) {
      if (!this.contextInvalidated) {
        this.handleContextInvalidation();
      }
      return;
    }

    if (data?.items && Array.isArray(data.items)) {
      const events = this.parseApiEvents(data.items);
      if (events.length > 0) {
        console.log(`PingMeet: Parsed ${events.length} events from API`);
        this.sendToBackground(events);
      }
    }
  }

  /**
   * Wait for Google Calendar to load
   */
  async waitForCalendar() {
    return new Promise(resolve => {
      let attempts = 0;
      const maxAttempts = 30;

      const checkInterval = setInterval(() => {
        attempts++;
        
        // Look for various calendar indicators
        const mainElement = document.querySelector('[role="main"]');
        const calendarGrid = document.querySelector('[role="grid"]');
        const hasCalendarContent = mainElement || calendarGrid;

        if (hasCalendarContent) {
          clearInterval(checkInterval);
          console.log('PingMeet: Calendar DOM detected');
          resolve();
        } else if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          console.log('PingMeet: Calendar detection timeout, proceeding anyway');
          resolve();
        }
      }, 500);
    });
  }

  /**
   * Read events from the calendar DOM using multiple resilient strategies
   */
  readEvents() {
    // Early exit if context is invalidated
    if (this.contextInvalidated || !this.isContextValid()) {
      if (!this.contextInvalidated) {
        this.handleContextInvalidation();
      }
      return;
    }

    const events = [];

    try {
      // Strategy 1: Read from event chips with data-eventid (most reliable)
      const eventIdSelectors = [
        '[data-eventid]',
        '[data-event-id]',
        '[data-eid]',
      ];

      for (const selector of eventIdSelectors) {
        try {
          const eventElements = document.querySelectorAll(selector);
          if (eventElements.length > 0) {
            console.log(`PingMeet: Found ${eventElements.length} elements with ${selector}`);

            eventElements.forEach(el => {
              try {
                const event = this.parseEventElement(el);
                if (event) events.push(event);
              } catch (err) {
                console.warn('PingMeet: Failed to parse event element', err);
              }
            });
          }
        } catch (err) {
          console.warn(`PingMeet: Selector ${selector} failed`, err);
        }
      }

      // Strategy 2: Read from aria-label patterns (fallback)
      const ariaSelectors = [
        '[role="button"][aria-label*=":"]',
        '[role="link"][aria-label*=":"]',
        'div[aria-label*=":"][tabindex]',
      ];

      for (const selector of ariaSelectors) {
        try {
          const ariaEvents = document.querySelectorAll(selector);
          if (ariaEvents.length > 0) {
            console.log(`PingMeet: Found ${ariaEvents.length} aria-labeled elements with ${selector}`);

            ariaEvents.forEach(el => {
              try {
                const event = this.parseAriaEvent(el);
                if (event && !events.find(e => e.title === event.title && e.startTime === event.startTime)) {
                  events.push(event);
                }
              } catch (err) {
                console.warn('PingMeet: Failed to parse aria event', err);
              }
            });
          }
        } catch (err) {
          console.warn(`PingMeet: Aria selector ${selector} failed`, err);
        }
      }

      // Strategy 3: Look for event links (additional fallback)
      const linkSelectors = [
        'a[href*="/eventedit/"]',
        'a[data-eventid]',
        'a[href*="/event?eid="]',
      ];

      for (const selector of linkSelectors) {
        try {
          const eventLinks = document.querySelectorAll(selector);
          if (eventLinks.length > 0) {
            console.log(`PingMeet: Found ${eventLinks.length} event links with ${selector}`);

            eventLinks.forEach(el => {
              try {
                const event = this.parseEventLink(el);
                if (event && !events.find(e => e.id === event.id)) {
                  events.push(event);
                }
              } catch (err) {
                console.warn('PingMeet: Failed to parse event link', err);
              }
            });
          }
        } catch (err) {
          console.warn(`PingMeet: Link selector ${selector} failed`, err);
        }
      }

      // Strategy 4: Deep scan for any time patterns (last resort)
      if (events.length === 0) {
        console.log('PingMeet: No events found with standard selectors, trying deep scan...');
        try {
          this.deepScanForEvents(events);
        } catch (err) {
          console.warn('PingMeet: Deep scan failed', err);
        }
      }

      // Deduplicate and send
      const uniqueEvents = this.deduplicateEvents(events);
      console.log(`PingMeet: Total unique events found: ${uniqueEvents.length}`);

      if (uniqueEvents.length > 0 || this.hasChanges(uniqueEvents)) {
        this.lastEvents = uniqueEvents;
        this.sendToBackground(uniqueEvents);
      }
    } catch (error) {
      console.error('PingMeet: Error reading events', error);
    }
  }

  /**
   * Deep scan for events when standard selectors fail
   * @param {Array} events - Array to push found events into
   */
  deepScanForEvents(events) {
    // Look for any elements containing time patterns
    const allElements = document.querySelectorAll('div, span, a, button');

    allElements.forEach(el => {
      try {
        const text = el.textContent || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const combined = text + ' ' + ariaLabel;

        // Check if contains a time pattern
        if (/\d{1,2}:\d{2}\s*(AM|PM|am|pm)?/.test(combined)) {
          const startTime = this.extractTime(combined);
          if (startTime) {
            // Try to extract title
            const title = this.extractTitle(el) || text.split('\n')[0].trim();
            if (title && title.length > 2 && title.length < 200) {
              // Create a deterministic ID from title and startTime to avoid duplicates
              const hashBase = `${title.toLowerCase().trim()}-${startTime}`;
              const eventId = `deep-scan-${btoa(hashBase).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}`;

              const event = {
                id: eventId,
                title: title,
                startTime: startTime,
                meetingLink: this.extractMeetingLink(el),
                source: 'google-dom',
              };

              // Avoid duplicates
              if (!events.find(e => e.title === event.title && e.startTime === event.startTime)) {
                events.push(event);
              }
            }
          }
        }
      } catch (err) {
        // Silently skip problematic elements
      }
    });
  }

  /**
   * Parse event element with data-eventid
   */
  parseEventElement(el) {
    try {
      const eventId = el.getAttribute('data-eventid');
      if (!eventId) return null;

      // Get title from various sources
      const title = this.extractTitle(el);
      if (!title) return null;

      // Get time from aria-label or content
      const ariaLabel = el.getAttribute('aria-label') || el.textContent || '';
      const startTime = this.extractTime(ariaLabel);
      
      // Try to extract end time (usually 1 hour after start by default)
      const endTime = startTime ? new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString() : null;

      // Get meeting link
      const meetingLink = this.extractMeetingLink(el);

      return {
        id: eventId,
        title: title,
        startTime: startTime,
        endTime: endTime,
        meetingLink: meetingLink,
        attendees: [], // DOM parsing doesn't have attendee info, rely on API
        source: 'google-dom',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse event from aria-label (Schedule view)
   */
  parseAriaEvent(el) {
    try {
      const ariaLabel = el.getAttribute('aria-label') || '';
      if (!ariaLabel || ariaLabel.length < 5) return null;

      // Parse aria-label like "Meeting Title, January 15, 10:30 AM"
      const parts = ariaLabel.split(',');
      if (parts.length < 2) return null;

      const title = parts[0].trim();
      const timeStr = ariaLabel;
      const startTime = this.extractTime(timeStr);

      if (!startTime) return null;
      
      const endTime = startTime ? new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString() : null;

      return {
        id: `aria-${title.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`,
        title: title,
        startTime: startTime,
        endTime: endTime,
        meetingLink: this.extractMeetingLink(el),
        attendees: [],
        source: 'google-dom',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse event from link element
   */
  parseEventLink(el) {
    try {
      const eventId = el.getAttribute('data-eventid') || 
                     el.href?.match(/eventedit\/([^?]+)/)?.[1] ||
                     `link-${Date.now()}`;

      const title = this.extractTitle(el);
      if (!title) return null;

      const ariaLabel = el.getAttribute('aria-label') || el.textContent || '';
      const startTime = this.extractTime(ariaLabel);

      return {
        id: eventId,
        title: title,
        startTime: startTime,
        meetingLink: this.extractMeetingLink(el),
        source: 'google-dom',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract title from element
   */
  extractTitle(el) {
    // Try various selectors
    const titleEl = el.querySelector('[data-eventchip]') ||
                   el.querySelector('[role="heading"]') ||
                   el.querySelector('span');

    let title = titleEl?.textContent?.trim() ||
               el.getAttribute('aria-label')?.split(',')[0]?.trim() ||
               el.textContent?.trim();

    // Clean up title
    if (title) {
      title = title.split('\n')[0].trim();
      if (title.length > 100) title = title.substring(0, 100);
    }

    return title || null;
  }

  /**
   * Extract time from text with multi-language and format support
   */
  extractTime(text) {
    if (!text) return null;

    try {
      // Match various time patterns
      // Patterns: "10:30 AM", "2:45 PM", "14:30", "10h30", "10.30"
      const timePatterns = [
        /(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/,  // 12-hour with meridiem
        /(\d{1,2}):(\d{2})/,                   // 24-hour or 12-hour without meridiem
        /(\d{1,2})h(\d{2})/i,                  // French format (10h30)
        /(\d{1,2})\.(\d{2})/,                  // Dot separator (10.30)
      ];

      let timeMatch = null;
      for (const pattern of timePatterns) {
        timeMatch = text.match(pattern);
        if (timeMatch) break;
      }

      if (!timeMatch) return null;

      let hours = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2]);
      const meridiem = timeMatch[3]?.toUpperCase();

      // Convert to 24-hour
      if (meridiem === 'PM' && hours < 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;

      // Try to extract date with multi-language support
      const today = new Date();
      let eventDate = null;

      // Multi-language month names
      const monthNames = {
        en: ['january', 'february', 'march', 'april', 'may', 'june',
             'july', 'august', 'september', 'october', 'november', 'december'],
        es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
             'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
        fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
             'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
        de: ['januar', 'februar', 'märz', 'april', 'mai', 'juni',
             'juli', 'august', 'september', 'oktober', 'november', 'dezember'],
        it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
             'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
        pt: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
             'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
      };

      // Try different date patterns
      const datePatterns = [
        /(\w+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/,  // "January 15, 2024" or "January 15"
        /(\d{1,2})\s+(\w+)(?:,?\s*(\d{4}))?/,  // "15 January 2024" or "15 January"
        /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/, // "1/15/2024" or "15/1/2024"
        /(\d{1,2})-(\d{1,2})(?:-(\d{2,4}))?/,  // "1-15-2024" or "15-1-2024"
      ];

      for (const pattern of datePatterns) {
        const dateMatch = text.match(pattern);
        if (!dateMatch) continue;

        if (pattern.toString().includes('\\w+')) {
          // Text-based month
          const monthName = dateMatch[1].toLowerCase();
          const day = parseInt(dateMatch[2]) || parseInt(dateMatch[1]);
          const year = dateMatch[3] ? parseInt(dateMatch[3]) : today.getFullYear();

          // Check against all language month names
          let monthIndex = -1;
          for (const lang in monthNames) {
            monthIndex = monthNames[lang].findIndex(m =>
              monthName.startsWith(m.substring(0, 3))
            );
            if (monthIndex !== -1) break;
          }

          if (monthIndex !== -1) {
            // Handle year around New Year boundary
            let finalYear = year;
            if (!dateMatch[3]) {
              // If month is before current month but day is after today, assume next year
              if (monthIndex < today.getMonth() && day > today.getDate()) {
                finalYear = today.getFullYear() + 1;
              }
            }

            eventDate = new Date(finalYear, monthIndex, day, hours, minutes, 0, 0);
            break;
          }
        } else {
          // Numeric date format
          const num1 = parseInt(dateMatch[1]);
          const num2 = parseInt(dateMatch[2]);
          const year = dateMatch[3] ?
            (dateMatch[3].length === 2 ? 2000 + parseInt(dateMatch[3]) : parseInt(dateMatch[3])) :
            today.getFullYear();

          // Determine if it's MM/DD or DD/MM based on locale
          const locale = navigator.language || 'en-US';
          const isUSFormat = locale.startsWith('en-US');

          let month, day;
          if (isUSFormat) {
            month = num1 - 1; // Month is 0-indexed
            day = num2;
          } else {
            month = num2 - 1;
            day = num1;
          }

          // Validate date
          if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
            eventDate = new Date(year, month, day, hours, minutes, 0, 0);
            break;
          }
        }
      }

      // If no date found, default to today or tomorrow
      if (!eventDate) {
        eventDate = new Date(today);
        eventDate.setHours(hours, minutes, 0, 0);

        // If time has already passed today, assume tomorrow
        if (eventDate < today) {
          eventDate.setDate(eventDate.getDate() + 1);
        }
      }

      return eventDate.toISOString();
    } catch (error) {
      console.warn('PingMeet: Error extracting time', error);
      return null;
    }
  }

  /**
   * Extract meeting link from element
   */
  extractMeetingLink(el) {
    const html = el.innerHTML || '';
    const text = el.textContent || '';
    const combined = html + ' ' + text;

    // Try all known meeting platform patterns
    const patterns = [
      /https?:\/\/meet\.google\.com\/[a-z-]+/i,
      /https?:\/\/([\w-]+\.)?zoom\.(us|com)\/(j|w|wc|s)\/\d+[^\s"<>]*/i, // Extended Zoom regex
      /https?:\/\/teams\.microsoft\.com\/l\/(meetup-join|meeting)[^\s"]*/i,
      /https?:\/\/([\w-]+\.)?webex\.com\/(meet|join)\/[^\s"]*/i,
      /https?:\/\/(www\.)?gotomeeting\.com\/join\/\d+/i,
      /https?:\/\/([\w-]+\.)?slack\.com\/huddle\/[^\s"]*/i,
      /https?:\/\/discord\.(gg|com)\/[^\s"]*/i,
      /https?:\/\/join\.skype\.com\/[^\s"]*/i,
      /https?:\/\/bluejeans\.com\/\d+/i,
      /https?:\/\/meet\.jit\.si\/[^\s"]*/i,
    ];

    for (const pattern of patterns) {
      const match = combined.match(pattern);
      if (match) {
        console.log('PingMeet: Found meeting link via pattern:', match[0]);
        return match[0];
      }
    }

    // Check for anchor tags with any meeting platform domain
    const platforms = ['meet.google.com', 'zoom.us', 'zoom.com', 'teams.microsoft.com',
                      'webex.com', 'gotomeeting.com', 'slack.com', 'discord.gg',
                      'discord.com', 'skype.com', 'bluejeans.com', 'jit.si'];

    for (const platform of platforms) {
      const anchor = el.querySelector(`a[href*="${platform}"]`);
      if (anchor) {
        console.log('PingMeet: Found meeting link via anchor:', anchor.href);
        return anchor.href;
      }
    }

    // Also check parent and sibling elements
    if (el.parentElement) {
      for (const platform of platforms) {
        const anchor = el.parentElement.querySelector(`a[href*="${platform}"]`);
        if (anchor) {
          console.log('PingMeet: Found meeting link in parent:', anchor.href);
          return anchor.href;
        }
      }
    }

    return null;
  }

  /**
   * Parse events from API response (Enhanced with all fields)
   */
  parseApiEvents(items) {
    const events = [];

    for (const item of items) {
      try {
        if (!item.id || !item.summary) continue;

        const startTime = item.start?.dateTime || item.start?.date;
        if (!startTime) continue;

        // Extract timezone information if available
        const timezone = item.start?.timeZone || null;
        const endTime = item.end?.dateTime || item.end?.date || null;

        // Extract attendees with full details
        const attendees = [];
        if (item.attendees && Array.isArray(item.attendees)) {
          for (const attendee of item.attendees) {
            if (attendee.email) {
              attendees.push({
                email: attendee.email,
                name: attendee.displayName || attendee.email.split('@')[0],
                responseStatus: attendee.responseStatus || 'needsAction',
                organizer: attendee.organizer || false,
                self: attendee.self || false,
                optional: attendee.optional || false,
              });
            }
          }
        }

        // Extract meeting link from multiple sources
        let meetingLink = item.hangoutLink || null;
        if (!meetingLink && item.conferenceData?.entryPoints) {
          const videoEntry = item.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video');
          meetingLink = videoEntry?.uri || item.conferenceData.entryPoints[0]?.uri || null;
        }
        // Also check description for meeting links
        if (!meetingLink && item.description) {
          meetingLink = this.extractMeetingLinkFromText(item.description);
        }
        // Check location for meeting links
        if (!meetingLink && item.location) {
          meetingLink = this.extractMeetingLinkFromText(item.location);
        }

        // Extract dial-in information
        const dialIn = this.extractDialInFromConferenceData(item.conferenceData, item.description);

        // Extract additional meeting info from description
        const additionalInfo = this.extractAdditionalMeetingInfo(item.description);

        events.push({
          id: item.id,
          title: item.summary,
          startTime: new Date(startTime).toISOString(),
          endTime: endTime ? new Date(endTime).toISOString() : null,
          timezone: timezone,
          meetingLink: meetingLink,
          attendees: attendees,
          location: item.location || null,
          description: item.description || null,
          // Enhanced fields
          organizer: item.organizer?.email || item.creator?.email || null,
          organizerName: item.organizer?.displayName || item.creator?.displayName || null,
          recurrence: item.recurrence || null,
          recurringEventId: item.recurringEventId || null,
          status: item.status || 'confirmed',
          visibility: item.visibility || 'default',
          colorId: item.colorId || null,
          htmlLink: item.htmlLink || null,
          created: item.created || null,
          updated: item.updated || null,
          // Conference/dial-in info
          dialIn: dialIn,
          conferenceId: item.conferenceData?.conferenceId || additionalInfo.meetingId || null,
          conferenceProvider: item.conferenceData?.conferenceSolution?.name || null,
          // Additional extracted info
          passcode: additionalInfo.passcode || null,
          pin: additionalInfo.pin || null,
          phoneNumbers: dialIn?.phoneNumbers || [],
          // Attachments
          attachments: item.attachments || [],
          source: 'google-api',
        });
      } catch (error) {
        continue;
      }
    }

    return events;
  }

  /**
   * Extract dial-in information from conference data and description
   */
  extractDialInFromConferenceData(conferenceData, description) {
    const dialIn = {
      phoneNumbers: [],
      conferenceId: null,
      pin: null,
      provider: null,
      entryPoints: []
    };

    // From conference data
    if (conferenceData) {
      if (conferenceData.conferenceId) {
        dialIn.conferenceId = conferenceData.conferenceId;
      }

      if (conferenceData.conferenceSolution) {
        dialIn.provider = conferenceData.conferenceSolution.name;
      }

      if (conferenceData.entryPoints && Array.isArray(conferenceData.entryPoints)) {
        conferenceData.entryPoints.forEach(ep => {
          dialIn.entryPoints.push({
            type: ep.entryPointType,
            uri: ep.uri,
            label: ep.label,
            pin: ep.pin,
            regionCode: ep.regionCode
          });

          if (ep.entryPointType === 'phone') {
            dialIn.phoneNumbers.push({
              number: ep.uri?.replace('tel:', ''),
              label: ep.label,
              regionCode: ep.regionCode,
              pin: ep.pin
            });
            if (ep.pin) {
              dialIn.pin = ep.pin;
            }
          }
        });
      }
    }

    // Also extract from description text
    if (description) {
      const phoneNumbers = this.extractPhoneNumbers(description);
      phoneNumbers.forEach(num => {
        if (!dialIn.phoneNumbers.find(p => p.number === num)) {
          dialIn.phoneNumbers.push({ number: num, label: 'Extracted', regionCode: null });
        }
      });

      // Extract PIN/passcode from description
      const pinMatch = description.match(/(?:PIN|pin|Pin)[:\s]*(\d{4,})/);
      if (pinMatch && !dialIn.pin) {
        dialIn.pin = pinMatch[1];
      }
    }

    return dialIn.phoneNumbers.length > 0 || dialIn.conferenceId ? dialIn : null;
  }

  /**
   * Extract phone numbers from text using enhanced regex
   */
  extractPhoneNumbers(text) {
    if (!text) return [];

    const phonePatterns = [
      /\+1[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,           // US: +1 (xxx) xxx-xxxx
      /\+44[\s.-]?\d{4}[\s.-]?\d{6}/g,                             // UK: +44 xxxx xxxxxx
      /\+49[\s.-]?\d{3,4}[\s.-]?\d{6,8}/g,                         // Germany
      /\+33[\s.-]?\d{1}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}/g, // France
      /\+61[\s.-]?\d{1}[\s.-]?\d{4}[\s.-]?\d{4}/g,                 // Australia
      /\+91[\s.-]?\d{5}[\s.-]?\d{5}/g,                             // India
      /\+\d{1,3}[\s.-]?\d{1,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g,     // Generic international
      /\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}/g,                        // US without country code
      /\d{3}[\s.-]\d{3}[\s.-]\d{4}/g,                              // Simple US format
    ];

    const numbers = new Set();
    phonePatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(m => numbers.add(m.trim()));
      }
    });

    return Array.from(numbers);
  }

  /**
   * Extract additional meeting info from description (Meeting ID, Passcode, PIN)
   */
  extractAdditionalMeetingInfo(text) {
    const info = {
      meetingId: null,
      passcode: null,
      pin: null,
      dialInNumbers: []
    };

    if (!text) return info;

    // Meeting ID patterns
    const meetingIdPatterns = [
      /Meeting ID[:\s]*(\d{3}[\s-]?\d{4}[\s-]?\d{4})/i,          // Zoom style
      /Meeting ID[:\s]*(\d{9,12})/i,                               // Generic
      /Conference ID[:\s]*(\d+)/i,
      /Meeting code[:\s]*([a-z]{3}-[a-z]{4}-[a-z]{3})/i,          // Google Meet style
      /Webinar ID[:\s]*(\d+)/i,
    ];

    for (const pattern of meetingIdPatterns) {
      const match = text.match(pattern);
      if (match) {
        info.meetingId = match[1];
        break;
      }
    }

    // Passcode/Password patterns
    const passcodePatterns = [
      /Passcode[:\s]*([A-Za-z0-9]+)/i,
      /Password[:\s]*([A-Za-z0-9]+)/i,
      /Access Code[:\s]*(\d+)/i,
      /Participant Code[:\s]*(\d+)/i,
    ];

    for (const pattern of passcodePatterns) {
      const match = text.match(pattern);
      if (match) {
        info.passcode = match[1];
        break;
      }
    }

    // PIN patterns
    const pinPatterns = [
      /PIN[:\s]*(\d{4,})/i,
      /Host PIN[:\s]*(\d+)/i,
      /Attendee PIN[:\s]*(\d+)/i,
    ];

    for (const pattern of pinPatterns) {
      const match = text.match(pattern);
      if (match) {
        info.pin = match[1];
        break;
      }
    }

    return info;
  }

  /**
   * Extract meeting link from text content
   */
  extractMeetingLinkFromText(text) {
    if (!text) return null;

    const patterns = [
      /https?:\/\/meet\.google\.com\/[a-z-]+/gi,
      /https?:\/\/([\w-]+\.)?zoom\.(us|com)\/[jw]\/\d+(\?pwd=[A-Za-z0-9]+)?/gi,
      /https?:\/\/teams\.microsoft\.com\/l\/(meetup-join|meeting)[^\s"<>]*/gi,
      /https?:\/\/([\w-]+\.)?webex\.com\/(meet|join)\/[^\s"<>]*/gi,
      /https?:\/\/(www\.)?gotomeeting\.com\/join\/\d+/gi,
      /https?:\/\/([\w-]+\.)?slack\.com\/huddle\/[^\s"<>]*/gi,
      /https?:\/\/discord\.(gg|com)\/[^\s"<>]*/gi,
      /https?:\/\/join\.skype\.com\/[^\s"<>]*/gi,
      /https?:\/\/bluejeans\.com\/\d+/gi,
      /https?:\/\/meet\.jit\.si\/[^\s"<>]*/gi,
      /https?:\/\/chime\.aws\/\d+/gi,                              // Amazon Chime
      /https?:\/\/[\w-]+\.whereby\.com\/[^\s"<>]*/gi,              // Whereby
      /https?:\/\/app\.livestorm\.co\/[^\s"<>]*/gi,                // Livestorm
      /https?:\/\/[\w-]+\.webinarjam\.com\/[^\s"<>]*/gi,           // WebinarJam
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0];
      }
    }

    return null;
  }

  /**
   * Observe event popup/dialog for scraping details
   * METHOD 6: EVENT POPUP SCRAPING
   */
  observeEventPopups() {
    if (this.contextInvalidated) return;

    // Watch for event detail popups/dialogs
    this.popupObserver = new MutationObserver((mutations) => {
      if (this.contextInvalidated) return;

      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is an event popup/dialog
            if (node.matches('[role="dialog"]') ||
                node.querySelector('[role="dialog"]') ||
                node.matches('[data-eventid]') ||
                node.classList?.contains('event-popup')) {
              setTimeout(() => this.scrapeEventPopup(node), 100);
            }
          }
        });
      });
    });

    this.popupObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('PingMeet: Event popup observer active');
  }

  /**
   * Scrape event details from popup/dialog
   */
  scrapeEventPopup(popupElement) {
    try {
      const dialog = popupElement.matches('[role="dialog"]') ?
                    popupElement :
                    popupElement.querySelector('[role="dialog"]');

      if (!dialog) return;

      // Extract event ID
      const eventIdEl = dialog.querySelector('[data-eventid]') ||
                       dialog.querySelector('[data-event-id]');
      const eventId = eventIdEl?.getAttribute('data-eventid') ||
                     eventIdEl?.getAttribute('data-event-id');

      if (!eventId) return;

      // Check if we already have this event's details cached
      if (this.eventDetailsCache.has(eventId)) return;

      console.log('PingMeet: Scraping event popup for:', eventId);

      const details = {
        id: eventId,
        source: 'google-dom'
      };

      // Scrape title
      const titleEl = dialog.querySelector('[data-eventchip]') ||
                     dialog.querySelector('[role="heading"]') ||
                     dialog.querySelector('h1, h2, h3');
      if (titleEl) {
        details.title = titleEl.textContent?.trim();
      }

      // Scrape description (usually in a specific section)
      const descriptionSelectors = [
        '[data-description]',
        '[aria-label*="description"]',
        '.event-description',
        '[data-content="description"]',
        'div[dir="ltr"]' // Google Calendar often uses this
      ];

      for (const selector of descriptionSelectors) {
        const descEl = dialog.querySelector(selector);
        if (descEl && descEl.textContent?.length > 10) {
          details.description = descEl.innerHTML;
          break;
        }
      }

      // Scrape location
      const locationSelectors = [
        '[data-location]',
        '[aria-label*="location"]',
        '[aria-label*="where"]',
        '.event-location'
      ];

      for (const selector of locationSelectors) {
        const locEl = dialog.querySelector(selector);
        if (locEl) {
          details.location = locEl.textContent?.trim();
          break;
        }
      }

      // Scrape attendees/guests
      const attendeeSelectors = [
        '[data-guest-email]',
        '[data-attendee]',
        '[aria-label*="guest"]',
        '.guest-list span',
        '[data-email]'
      ];

      const attendees = [];
      for (const selector of attendeeSelectors) {
        const attendeeEls = dialog.querySelectorAll(selector);
        attendeeEls.forEach(el => {
          const email = el.getAttribute('data-guest-email') ||
                       el.getAttribute('data-email') ||
                       el.textContent?.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0];
          const name = el.textContent?.replace(email || '', '').trim() || email?.split('@')[0];

          if (email || name) {
            attendees.push({
              email: email || null,
              name: name,
              responseStatus: el.getAttribute('data-response') || 'unknown'
            });
          }
        });
        if (attendees.length > 0) break;
      }
      if (attendees.length > 0) {
        details.attendees = attendees;
      }

      // Scrape organizer
      const organizerSelectors = [
        '[data-organizer]',
        '[aria-label*="organizer"]',
        '.organizer-name'
      ];

      for (const selector of organizerSelectors) {
        const orgEl = dialog.querySelector(selector);
        if (orgEl) {
          details.organizerName = orgEl.textContent?.trim();
          const orgEmail = orgEl.getAttribute('data-email') ||
                          orgEl.textContent?.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0];
          if (orgEmail) details.organizer = orgEmail;
          break;
        }
      }

      // Scrape meeting link
      const linkSelectors = [
        'a[href*="meet.google.com"]',
        'a[href*="zoom"]',
        'a[href*="teams.microsoft"]',
        'a[href*="webex"]',
        '[data-meeting-link]'
      ];

      for (const selector of linkSelectors) {
        const linkEl = dialog.querySelector(selector);
        if (linkEl) {
          details.meetingLink = linkEl.href || linkEl.getAttribute('data-meeting-link');
          break;
        }
      }

      // Scrape time
      const timeSelectors = [
        '[data-daterange]',
        '[aria-label*="time"]',
        'time',
        '.event-time'
      ];

      for (const selector of timeSelectors) {
        const timeEl = dialog.querySelector(selector);
        if (timeEl) {
          const timeText = timeEl.textContent?.trim() ||
                          timeEl.getAttribute('datetime') ||
                          timeEl.getAttribute('aria-label');
          if (timeText) {
            const startTime = this.extractTime(timeText);
            if (startTime) details.startTime = startTime;
          }
          break;
        }
      }

      // Cache the scraped details
      if (Object.keys(details).length > 2) {
        this.eventDetailsCache.set(eventId, details);
        console.log('PingMeet: Scraped event details:', details);

        // Merge with existing events and send update
        const existingEvent = this.lastEvents.find(e => e.id === eventId);
        if (existingEvent) {
          const merged = this.mergeEventData(existingEvent, details);
          const updatedEvents = this.lastEvents.map(e =>
            e.id === eventId ? merged : e
          );
          this.sendToBackground(updatedEvents);
        }
      }
    } catch (error) {
      console.warn('PingMeet: Error scraping event popup', error);
    }
  }

  /**
   * Observe DOM changes
   */
  observeChanges() {
    const target = document.querySelector('[role="main"]') || document.body;

    this.observer = new MutationObserver(() => {
      // Don't proceed if context is invalidated
      if (this.contextInvalidated) {
        return;
      }

      clearTimeout(this.readTimeout);
      this.readTimeout = setTimeout(() => {
        // Double-check before reading
        if (!this.contextInvalidated) {
          this.readEvents();
        }
      }, 1000);
    });

    this.observer.observe(target, {
      childList: true,
      subtree: true,
    });

    console.log('PingMeet: Observing calendar changes');
  }

  /**
   * Deduplicate events
   */
  deduplicateEvents(events) {
    const seen = new Map();

    for (const event of events) {
      const key = event.id || `${event.title}-${event.startTime}`;
      if (!seen.has(key)) {
        seen.set(key, event);
      } else if (event.source === 'api') {
        seen.set(key, event); // Prefer API data
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Check if events have changed
   */
  hasChanges(newEvents) {
    if (newEvents.length !== this.lastEvents.length) return true;
    const oldIds = this.lastEvents.map(e => e.id).sort().join(',');
    const newIds = newEvents.map(e => e.id).sort().join(',');
    return oldIds !== newIds;
  }

  /**
   * Send events to background
   */
  sendToBackground(events) {
    if (events.length === 0) return;

    // Check if context is already invalidated
    if (this.contextInvalidated) {
      return;
    }

    // Check if extension context is still valid
    if (!this.isContextValid()) {
      console.warn('PingMeet: Extension context invalidated. Please refresh the page.');
      this.handleContextInvalidation();
      return;
    }

    try {
      chrome.runtime.sendMessage(
        { type: 'CALENDAR_EVENTS', events: events },
        (_response) => {
          // Double-check context validity before checking lastError
          if (!this.isContextValid()) {
            this.handleContextInvalidation();
            return;
          }

          if (chrome.runtime.lastError) {
            const error = chrome.runtime.lastError.message || '';

            // Check if context was invalidated
            if (error.includes('Extension context invalidated') || 
                error.includes('message port closed') ||
                error.includes('receiving end does not exist')) {
              console.warn('PingMeet: Extension context invalidated. Please refresh the page.');
              this.handleContextInvalidation();
            } else {
              console.error('PingMeet: Error sending events', chrome.runtime.lastError);
            }
          } else {
            console.log(`PingMeet: Sent ${events.length} events to background`);
          }
        }
      );
    } catch (error) {
      console.error('PingMeet: Failed to send message', error);
      // Check if it's a context invalidation error
      if (error.message && 
          (error.message.includes('Extension context invalidated') || 
           error.message.includes('Cannot access'))){
        this.handleContextInvalidation();
      }
    }
  }

  /**
   * Handle extension context invalidation
   * Cleanup timers and notify user
   */
  handleContextInvalidation() {
    // Only handle once
    if (this.contextInvalidated) {
      return;
    }

    console.log('PingMeet: Handling context invalidation - cleaning up...');
    this.contextInvalidated = true;

    // Clear any running intervals to prevent further errors
    if (this.readInterval) {
      clearInterval(this.readInterval);
      this.readInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.readTimeout) {
      clearTimeout(this.readTimeout);
      this.readTimeout = null;
    }

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Disconnect popup observer
    if (this.popupObserver) {
      this.popupObserver.disconnect();
      this.popupObserver = null;
    }

    // Clear event details cache
    this.eventDetailsCache.clear();

    // Mark as not initialized
    this.isInitialized = false;

    // Show a subtle notification to user
    this.showReloadNotification();
  }

  /**
   * Show a notification that page needs refresh
   */
  showReloadNotification() {
    // Only show once
    if (this.reloadNotificationShown) return;
    this.reloadNotificationShown = true;

    const notification = document.createElement('div');
    notification.id = 'pingmeet-reload-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 20px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      max-width: 360px;
      animation: slideIn 0.3s ease-out;
    `;

    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      #pingmeet-reload-notification button {
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.2s;
        margin-top: 8px;
        width: 100%;
      }
      #pingmeet-reload-notification button:hover {
        background: rgba(255, 255, 255, 0.3);
        transform: scale(1.02);
      }
    `;
    document.head.appendChild(style);

    notification.innerHTML = `
      <div style="display: flex; align-items: start; gap: 12px;">
        <span style="font-size: 20px; font-weight: bold; color: #f59e0b;">!</span>
        <div style="flex: 1;">
          <div style="font-weight: 700; margin-bottom: 6px; font-size: 15px;">PingMeet Extension Updated</div>
          <div style="font-size: 12px; opacity: 0.95; line-height: 1.4; margin-bottom: 8px;">
            The extension has been updated or reloaded. Please refresh this page to continue monitoring your meetings.
          </div>
          <button id="pingmeet-reload-btn">Refresh Page Now</button>
        </div>
      </div>
    `;

    // Add to body with safety check
    if (document.body) {
      document.body.appendChild(notification);
    } else {
      // If body doesn't exist yet, wait for it
      document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(notification);
      });
    }

    // Add click handler to button
    const reloadBtn = notification.querySelector('#pingmeet-reload-btn');
    if (reloadBtn) {
      reloadBtn.onclick = (e) => {
        e.stopPropagation();
        window.location.reload();
      };
    }

    // Auto-reload after 30 seconds with countdown
    let countdown = 30;
    const countdownInterval = setInterval(() => {
      countdown--;
      if (reloadBtn && countdown > 0) {
        reloadBtn.textContent = `Refresh Page Now (${countdown}s)`;
      }
    }, 1000);

    setTimeout(() => {
      clearInterval(countdownInterval);
      console.log('PingMeet: Auto-reloading page after context invalidation...');
      window.location.reload();
    }, 30000);
  }
}

// Initialize
const reader = new CalendarReader();
reader.init();
