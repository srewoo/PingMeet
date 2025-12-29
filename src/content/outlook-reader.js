/**
 * Content Script - Reads calendar events from Outlook Calendar DOM
 * Runs on outlook.office.com and outlook.live.com
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
console.log('🔔 PingMeet: Outlook Calendar content script loaded (Enhanced v2)');

class OutlookReader {
  constructor() {
    this.observer = null;
    this.popupObserver = null;
    this.lastEvents = [];
    this.isInitialized = false;
    this.readInterval = null;
    this.reloadNotificationShown = false;
    this.contextInvalidated = false;
    this.healthCheckInterval = null;
    this.eventDetailsCache = new Map();
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
   * Initialize the Outlook reader
   */
  init() {
    console.log('PingMeet: Outlook reader initializing (Enhanced v2)...');

    // Verify context is valid before starting
    if (!this.isContextValid()) {
      console.error('PingMeet: Extension context is invalid at initialization');
      this.handleContextInvalidation();
      return;
    }

    // Start health check
    this.startHealthCheck();

    // Listen for sync trigger from background service worker
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'TRIGGER_DOM_SYNC') {
        console.log('PingMeet: Received DOM sync trigger from background');
        this.readEvents();
        sendResponse({ success: true });
      }
      return true;
    });

    // Inject script into page's main world for fetch interception
    this.injectPageScript();

    // Listen for messages from injected script (multiple message types)
    window.addEventListener('message', (event) => {
      // Standard API data (Fetch/XHR)
      if (event.data?.type === 'PINGMEET_CALENDAR_DATA' && event.data?.source === 'outlook') {
        console.log('PingMeet: Received Outlook calendar data from page context');
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

    // Wait for calendar to load, then read DOM
    this.waitForCalendar().then(() => {
      console.log('PingMeet: Outlook calendar DOM ready, reading events...');
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
      const mergedEvents = this.mergeEventSources(this.lastEvents, events);
      if (mergedEvents.length > 0) {
        this.sendToBackground(mergedEvents);
      }
    }
  }

  /**
   * Merge events from multiple sources
   */
  mergeEventSources(existing, newEvents) {
    const eventMap = new Map();

    existing.forEach(e => {
      const key = e.id || `${e.title}-${e.startTime}`;
      eventMap.set(key, e);
    });

    newEvents.forEach(e => {
      const key = e.id || `${e.title}-${e.startTime}`;
      if (eventMap.has(key)) {
        const existing = eventMap.get(key);
        eventMap.set(key, this.mergeEventData(existing, e));
      } else {
        eventMap.set(key, e);
      }
    });

    return Array.from(eventMap.values());
  }

  /**
   * Merge two event objects
   */
  mergeEventData(primary, secondary) {
    const merged = { ...primary };
    const fields = [
      'description', 'location', 'attendees', 'organizer', 'organizerName',
      'meetingLink', 'recurrence', 'status', 'visibility', 'dialIn',
      'conferenceId', 'passcode', 'pin', 'phoneNumbers', 'htmlLink'
    ];

    fields.forEach(field => {
      if (!merged[field] && secondary[field]) {
        merged[field] = secondary[field];
      }
      if (Array.isArray(merged[field]) && merged[field].length === 0 &&
          Array.isArray(secondary[field]) && secondary[field].length > 0) {
        merged[field] = secondary[field];
      }
    });

    return merged;
  }

  /**
   * Inject script into page's main world
   */
  injectPageScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('src/content/injected-script.js');
      script.onload = function() {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
      console.log('PingMeet: Injected page script for Outlook API interception');
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

    if (data?.value && Array.isArray(data.value)) {
      const events = this.parseApiEvents(data.value);
      if (events.length > 0) {
        console.log(`PingMeet: Parsed ${events.length} Outlook events from API`);
        this.sendToBackground(events);
      }
    }
  }

  /**
   * Wait for Outlook Calendar to load
   */
  async waitForCalendar() {
    return new Promise(resolve => {
      let attempts = 0;
      const maxAttempts = 30;

      const checkInterval = setInterval(() => {
        attempts++;

        const calendarElement =
          document.querySelector('[role="main"]') ||
          document.querySelector('[data-app-section="CalendarSurface"]') ||
          document.querySelector('[role="grid"]');

        if (calendarElement) {
          clearInterval(checkInterval);
          console.log('PingMeet: Outlook calendar DOM detected');
          resolve();
        } else if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          console.log('PingMeet: Outlook detection timeout, proceeding anyway');
          resolve();
        }
      }, 500);
    });
  }

  /**
   * Read events from Outlook DOM
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
      // Strategy 1: Event items with data-event-id
      const eventElements = document.querySelectorAll('[data-event-id], [data-eventid]');
      console.log(`PingMeet: Found ${eventElements.length} Outlook event elements`);
      
      eventElements.forEach(el => {
        const event = this.parseEventElement(el);
        if (event) events.push(event);
      });

      // Strategy 2: List items with meeting-related aria-labels
      const listItems = document.querySelectorAll('[role="listitem"]');
      listItems.forEach(item => {
        const ariaLabel = item.getAttribute('aria-label') || '';
        if (ariaLabel.toLowerCase().includes('meeting') || 
            ariaLabel.toLowerCase().includes('event') ||
            ariaLabel.match(/\d{1,2}:\d{2}/)) {
          const event = this.parseListItem(item);
          if (event && !events.find(e => e.title === event.title)) {
            events.push(event);
          }
        }
      });

      // Strategy 3: Calendar event buttons
      const eventButtons = document.querySelectorAll('[role="button"][aria-label*=":"]');
      eventButtons.forEach(btn => {
        const event = this.parseEventButton(btn);
        if (event && !events.find(e => e.title === event.title)) {
          events.push(event);
        }
      });

      const uniqueEvents = this.deduplicateEvents(events);
      console.log(`PingMeet: Total unique Outlook events: ${uniqueEvents.length}`);

      if (uniqueEvents.length > 0 || this.hasChanges(uniqueEvents)) {
        this.lastEvents = uniqueEvents;
        this.sendToBackground(uniqueEvents);
      }
    } catch (error) {
      console.error('PingMeet: Error reading Outlook events', error);
    }
  }

  /**
   * Parse event element
   */
  parseEventElement(el) {
    try {
      const eventId = el.getAttribute('data-event-id') || 
                     el.getAttribute('data-eventid') ||
                     `outlook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const title = this.extractTitle(el);
      if (!title) return null;

      const ariaLabel = el.getAttribute('aria-label') || el.textContent || '';
      const startTime = this.extractTime(ariaLabel);
      const endTime = startTime ? new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString() : null;
      const meetingLink = this.extractMeetingLink(el);

      return {
        id: eventId,
        title: title,
        startTime: startTime,
        endTime: endTime,
        meetingLink: meetingLink,
        attendees: [],
        source: 'outlook-dom',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse list item
   */
  parseListItem(el) {
    try {
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = ariaLabel.split(',')[0]?.trim() || el.textContent?.trim()?.split('\n')[0];
      if (!title || title.length < 3) return null;

      const startTime = this.extractTime(ariaLabel || el.textContent);
      
      return {
        id: `outlook-list-${title.replace(/\s+/g, '-').toLowerCase()}`,
        title: title,
        startTime: startTime,
        meetingLink: this.extractMeetingLink(el),
        source: 'outlook-dom',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse event button
   */
  parseEventButton(el) {
    try {
      const ariaLabel = el.getAttribute('aria-label') || '';
      if (!ariaLabel.match(/\d{1,2}:\d{2}/)) return null;

      const title = ariaLabel.split(',')[0]?.trim();
      if (!title || title.length < 3) return null;

      return {
        id: `outlook-btn-${title.replace(/\s+/g, '-').toLowerCase()}`,
        title: title,
        startTime: this.extractTime(ariaLabel),
        meetingLink: this.extractMeetingLink(el),
        source: 'outlook-dom',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract title
   */
  extractTitle(el) {
    const titleEl = el.querySelector('[class*="subject"]') ||
                   el.querySelector('[role="heading"]') ||
                   el.querySelector('span');

    let title = titleEl?.textContent?.trim() ||
               el.getAttribute('aria-label')?.split(',')[0]?.trim() ||
               el.textContent?.trim()?.split('\n')[0];

    if (title && title.length > 100) title = title.substring(0, 100);
    return title || null;
  }

  /**
   * Extract time
   */
  extractTime(text) {
    if (!text) return null;

    try {
      const timeMatch = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/);
      if (!timeMatch) return null;

      let hours = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2]);
      const meridiem = timeMatch[3]?.toUpperCase();

      if (meridiem === 'PM' && hours < 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;

      const today = new Date();
      today.setHours(hours, minutes, 0, 0);
      return today.toISOString();
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract meeting link
   */
  extractMeetingLink(el) {
    const html = el.innerHTML || '';
    const text = el.textContent || '';
    const combined = html + ' ' + text;

    // Try all known meeting platform patterns
    const patterns = [
      /https?:\/\/meet\.google\.com\/[a-z-]+/i,
      /https?:\/\/([\w-]+\.)?zoom\.(us|com)\/[jw]\/\d+(\?pwd=[A-Za-z0-9]+)?/i,
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
      if (match) return match[0];
    }

    // Check for anchor tags with any meeting platform domain
    const platforms = ['meet.google.com', 'zoom.us', 'zoom.com', 'teams.microsoft.com',
                      'webex.com', 'gotomeeting.com', 'slack.com', 'discord.gg',
                      'discord.com', 'skype.com', 'bluejeans.com', 'jit.si'];

    for (const platform of platforms) {
      const anchor = el.querySelector(`a[href*="${platform}"]`);
      if (anchor) return anchor.href;
    }

    return null;
  }

  /**
   * Parse API events (Enhanced with all fields)
   */
  parseApiEvents(items) {
    const events = [];

    for (const item of items) {
      try {
        if (!item.id || !item.subject) continue;

        const startTime = item.start?.dateTime;
        if (!startTime) continue;

        // Extract timezone and end time
        const timezone = item.start?.timeZone || item.originalStartTimeZone || null;
        const endTime = item.end?.dateTime || null;

        // Extract attendees with full details
        const attendees = [];
        if (item.attendees && Array.isArray(item.attendees)) {
          for (const attendee of item.attendees) {
            if (attendee.emailAddress?.address) {
              attendees.push({
                email: attendee.emailAddress.address,
                name: attendee.emailAddress.name || attendee.emailAddress.address.split('@')[0],
                responseStatus: attendee.status?.response || 'none',
                type: attendee.type || 'required',
              });
            }
          }
        }

        // Extract meeting link from multiple sources
        let meetingLink = item.onlineMeeting?.joinUrl || null;
        if (!meetingLink && item.body?.content) {
          meetingLink = this.extractMeetingLinkFromText(item.body.content);
        }
        if (!meetingLink && item.location?.displayName) {
          meetingLink = this.extractMeetingLinkFromText(item.location.displayName);
        }

        // Extract dial-in information
        const dialIn = this.extractDialInInfo(item.onlineMeeting, item.body?.content);

        // Extract additional meeting info
        const additionalInfo = this.extractAdditionalMeetingInfo(item.body?.content || item.bodyPreview);

        events.push({
          id: item.id,
          title: item.subject,
          startTime: new Date(startTime).toISOString(),
          endTime: endTime ? new Date(endTime).toISOString() : null,
          timezone: timezone,
          meetingLink: meetingLink,
          attendees: attendees,
          location: item.location?.displayName || null,
          description: item.body?.content || item.bodyPreview || null,
          // Enhanced fields
          organizer: item.organizer?.emailAddress?.address || null,
          organizerName: item.organizer?.emailAddress?.name || null,
          recurrence: item.recurrence || null,
          status: item.showAs || 'busy',
          visibility: item.sensitivity || 'normal',
          importance: item.importance || 'normal',
          categories: item.categories || [],
          htmlLink: item.webLink || null,
          created: item.createdDateTime || null,
          updated: item.lastModifiedDateTime || null,
          // Conference/dial-in info
          dialIn: dialIn,
          conferenceId: item.onlineMeeting?.conferenceId || additionalInfo.meetingId || null,
          conferenceProvider: item.onlineMeetingProvider || null,
          isOnlineMeeting: item.isOnlineMeeting || false,
          // Additional extracted info
          passcode: additionalInfo.passcode || null,
          pin: additionalInfo.pin || null,
          phoneNumbers: dialIn?.phoneNumbers || [],
          source: 'outlook-api',
        });
      } catch (error) {
        continue;
      }
    }

    return events;
  }

  /**
   * Extract dial-in information from online meeting data
   */
  extractDialInInfo(onlineMeeting, bodyContent) {
    const dialIn = {
      phoneNumbers: [],
      conferenceId: null,
      pin: null,
      provider: null
    };

    if (onlineMeeting) {
      if (onlineMeeting.conferenceId) {
        dialIn.conferenceId = onlineMeeting.conferenceId;
      }

      if (onlineMeeting.tollNumber) {
        dialIn.phoneNumbers.push({
          number: onlineMeeting.tollNumber,
          type: 'toll'
        });
      }

      if (onlineMeeting.tollFreeNumber) {
        dialIn.phoneNumbers.push({
          number: onlineMeeting.tollFreeNumber,
          type: 'tollFree'
        });
      }

      if (onlineMeeting.phones && Array.isArray(onlineMeeting.phones)) {
        onlineMeeting.phones.forEach(phone => {
          dialIn.phoneNumbers.push({
            number: phone.number,
            type: phone.type,
            region: phone.region
          });
        });
      }
    }

    // Extract from body content
    if (bodyContent) {
      const phoneNumbers = this.extractPhoneNumbers(bodyContent);
      phoneNumbers.forEach(num => {
        if (!dialIn.phoneNumbers.find(p => p.number === num)) {
          dialIn.phoneNumbers.push({ number: num, type: 'extracted' });
        }
      });

      const pinMatch = bodyContent.match(/(?:PIN|pin|Pin)[:\s]*(\d{4,})/);
      if (pinMatch) {
        dialIn.pin = pinMatch[1];
      }
    }

    return dialIn.phoneNumbers.length > 0 || dialIn.conferenceId ? dialIn : null;
  }

  /**
   * Extract phone numbers from text
   */
  extractPhoneNumbers(text) {
    if (!text) return [];

    const phonePatterns = [
      /\+1[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,
      /\+44[\s.-]?\d{4}[\s.-]?\d{6}/g,
      /\+\d{1,3}[\s.-]?\d{1,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g,
      /\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}/g,
      /\d{3}[\s.-]\d{3}[\s.-]\d{4}/g,
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
   * Extract additional meeting info from text
   */
  extractAdditionalMeetingInfo(text) {
    const info = {
      meetingId: null,
      passcode: null,
      pin: null
    };

    if (!text) return info;

    // Meeting ID patterns
    const meetingIdPatterns = [
      /Meeting ID[:\s]*(\d{3}[\s-]?\d{4}[\s-]?\d{4})/i,
      /Conference ID[:\s]*(\d+)/i,
    ];

    for (const pattern of meetingIdPatterns) {
      const match = text.match(pattern);
      if (match) {
        info.meetingId = match[1];
        break;
      }
    }

    // Passcode patterns
    const passcodePatterns = [
      /Passcode[:\s]*([A-Za-z0-9]+)/i,
      /Password[:\s]*([A-Za-z0-9]+)/i,
    ];

    for (const pattern of passcodePatterns) {
      const match = text.match(pattern);
      if (match) {
        info.passcode = match[1];
        break;
      }
    }

    // PIN patterns
    const pinMatch = text.match(/PIN[:\s]*(\d{4,})/i);
    if (pinMatch) {
      info.pin = pinMatch[1];
    }

    return info;
  }

  /**
   * Extract meeting link from text
   */
  extractMeetingLinkFromText(text) {
    if (!text) return null;

    const patterns = [
      /https?:\/\/teams\.microsoft\.com\/l\/(meetup-join|meeting)[^\s"<>]*/gi,
      /https?:\/\/meet\.google\.com\/[a-z-]+/gi,
      /https?:\/\/([\w-]+\.)?zoom\.(us|com)\/[jw]\/\d+(\?pwd=[A-Za-z0-9]+)?/gi,
      /https?:\/\/([\w-]+\.)?webex\.com\/(meet|join)\/[^\s"<>]*/gi,
      /https?:\/\/bluejeans\.com\/\d+/gi,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }

    return null;
  }

  /**
   * Observe event popups
   */
  observeEventPopups() {
    if (this.contextInvalidated) return;

    this.popupObserver = new MutationObserver((mutations) => {
      if (this.contextInvalidated) return;

      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches('[role="dialog"]') ||
                node.querySelector('[role="dialog"]') ||
                node.matches('[data-event-id]')) {
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

    console.log('PingMeet: Outlook event popup observer active');
  }

  /**
   * Scrape event details from popup
   */
  scrapeEventPopup(popupElement) {
    try {
      const dialog = popupElement.matches('[role="dialog"]') ?
                    popupElement :
                    popupElement.querySelector('[role="dialog"]');

      if (!dialog) return;

      const eventIdEl = dialog.querySelector('[data-event-id]');
      const eventId = eventIdEl?.getAttribute('data-event-id');

      if (!eventId || this.eventDetailsCache.has(eventId)) return;

      console.log('PingMeet: Scraping Outlook event popup for:', eventId);

      const details = { id: eventId, source: 'outlook-dom' };

      // Scrape title
      const titleEl = dialog.querySelector('[role="heading"]') ||
                     dialog.querySelector('h1, h2');
      if (titleEl) {
        details.title = titleEl.textContent?.trim();
      }

      // Scrape description
      const bodyEl = dialog.querySelector('[data-body]') ||
                    dialog.querySelector('.event-body');
      if (bodyEl) {
        details.description = bodyEl.innerHTML;
      }

      // Scrape location
      const locEl = dialog.querySelector('[data-location]') ||
                   dialog.querySelector('.event-location');
      if (locEl) {
        details.location = locEl.textContent?.trim();
      }

      // Scrape attendees
      const attendeeEls = dialog.querySelectorAll('[data-attendee-email]');
      if (attendeeEls.length > 0) {
        details.attendees = Array.from(attendeeEls).map(el => ({
          email: el.getAttribute('data-attendee-email'),
          name: el.textContent?.trim(),
          responseStatus: el.getAttribute('data-response') || 'unknown'
        }));
      }

      // Cache and merge
      if (Object.keys(details).length > 2) {
        this.eventDetailsCache.set(eventId, details);
        console.log('PingMeet: Scraped Outlook event details:', details);

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
      console.warn('PingMeet: Error scraping Outlook event popup', error);
    }
  }

  /**
   * Observe changes
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

    console.log('PingMeet: Observing Outlook calendar changes');
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
      } else if (event.source === 'outlook-api') {
        seen.set(key, event);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Check if changed
   */
  hasChanges(newEvents) {
    if (newEvents.length !== this.lastEvents.length) return true;
    const oldIds = this.lastEvents.map(e => e.id).sort().join(',');
    const newIds = newEvents.map(e => e.id).sort().join(',');
    return oldIds !== newIds;
  }

  /**
   * Send to background
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
              console.error('PingMeet: Error sending Outlook events', chrome.runtime.lastError);
            }
          } else {
            console.log(`PingMeet: Sent ${events.length} Outlook events to background`);
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
const reader = new OutlookReader();
reader.init();
