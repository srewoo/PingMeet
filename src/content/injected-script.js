/**
 * Injected Script - Runs in page's MAIN world to intercept fetch/XHR requests
 * This script is injected by calendar-reader.js and outlook-reader.js
 *
 * Extraction Methods:
 * 1. Fetch API interception
 * 2. XMLHttpRequest interception
 * 3. React/Angular state extraction
 * 4. LocalStorage/SessionStorage reading
 */

(function() {
  'use strict';

  console.log('PingMeet: Injected script running in page context (Enhanced v2)');

  // ============================================
  // METHOD 1: FETCH API INTERCEPTION
  // ============================================
  const originalFetch = window.fetch;

  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = args[0]?.toString() || '';

      // Google Calendar API - catch multiple patterns
      if ((url.includes('calendar.google.com') || url.includes('googleapis.com/calendar')) &&
          (url.includes('/events') || url.includes('calendarList'))) {
        const clone = response.clone();
        const data = await clone.json().catch(() => null);

        if (data) {
          console.log('PingMeet: Intercepted Google Calendar API:', url);
          const enhancedData = enhanceGoogleCalendarData(data);
          window.postMessage({
            type: 'PINGMEET_CALENDAR_DATA',
            source: 'google',
            data: enhancedData,
            url: url
          }, '*');
        }
      }

      // Microsoft Graph API (Outlook)
      if (url.includes('graph.microsoft.com') && url.includes('/events')) {
        const clone = response.clone();
        const data = await clone.json().catch(() => null);

        if (data) {
          console.log('PingMeet: Intercepted Outlook API:', url);
          const enhancedData = enhanceOutlookData(data);
          window.postMessage({
            type: 'PINGMEET_CALENDAR_DATA',
            source: 'outlook',
            data: enhancedData,
            url: url
          }, '*');
        }
      }
    } catch (e) {
      // Silently fail - don't break the page
    }

    return response;
  };

  // ============================================
  // METHOD 2: XMLHttpRequest INTERCEPTION
  // ============================================
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._pingmeetUrl = url;
    this._pingmeetMethod = method;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(body) {
    this.addEventListener('load', function() {
      try {
        const url = this._pingmeetUrl || '';

        // Google Calendar XHR
        if ((url.includes('calendar.google.com') || url.includes('googleapis.com/calendar')) &&
            (url.includes('/events') || url.includes('calendarList'))) {
          const data = JSON.parse(this.responseText);
          if (data) {
            console.log('PingMeet: Intercepted Google Calendar XHR:', url);
            const enhancedData = enhanceGoogleCalendarData(data);
            window.postMessage({
              type: 'PINGMEET_CALENDAR_DATA',
              source: 'google',
              data: enhancedData,
              url: url,
              method: 'xhr'
            }, '*');
          }
        }

        // Outlook XHR
        if (url.includes('graph.microsoft.com') && url.includes('/events')) {
          const data = JSON.parse(this.responseText);
          if (data) {
            console.log('PingMeet: Intercepted Outlook XHR:', url);
            const enhancedData = enhanceOutlookData(data);
            window.postMessage({
              type: 'PINGMEET_CALENDAR_DATA',
              source: 'outlook',
              data: enhancedData,
              url: url,
              method: 'xhr'
            }, '*');
          }
        }
      } catch (e) {
        // Silently fail
      }
    });
    return originalXHRSend.apply(this, [body]);
  };

  // ============================================
  // METHOD 3: REACT STATE EXTRACTION
  // ============================================
  function extractReactState() {
    try {
      const events = [];

      // Find React root
      const reactRoot = document.querySelector('[data-reactroot]') ||
                       document.getElementById('root') ||
                       document.getElementById('app');

      if (!reactRoot) return events;

      // Look for React fiber
      const fiberKey = Object.keys(reactRoot).find(key =>
        key.startsWith('__reactFiber$') ||
        key.startsWith('__reactInternalInstance$') ||
        key.startsWith('__reactContainer$')
      );

      if (fiberKey) {
        const fiber = reactRoot[fiberKey];
        traverseFiberForEvents(fiber, events);
      }

      // Also check for event data in DOM elements
      const eventElements = document.querySelectorAll('[data-eventid], [data-event-id], [data-eid]');
      eventElements.forEach(el => {
        const elFiberKey = Object.keys(el).find(key => key.startsWith('__reactFiber$'));
        if (elFiberKey) {
          const fiber = el[elFiberKey];
          extractEventFromFiber(fiber, events);
        }
      });

      if (events.length > 0) {
        console.log(`PingMeet: Extracted ${events.length} events from React state`);
        window.postMessage({
          type: 'PINGMEET_REACT_STATE',
          events: events
        }, '*');
      }

      return events;
    } catch (e) {
      console.warn('PingMeet: React state extraction failed', e);
      return [];
    }
  }

  function traverseFiberForEvents(fiber, events, depth = 0) {
    if (!fiber || depth > 50) return;

    try {
      // Check memoizedProps for event data
      if (fiber.memoizedProps) {
        const props = fiber.memoizedProps;
        if (props.event || props.eventData || props.calendarEvent) {
          const eventData = props.event || props.eventData || props.calendarEvent;
          if (eventData.id || eventData.summary || eventData.title) {
            events.push(normalizeEventData(eventData));
          }
        }
      }

      // Check memoizedState
      if (fiber.memoizedState && fiber.memoizedState.events) {
        fiber.memoizedState.events.forEach(e => {
          if (e.id || e.summary || e.title) {
            events.push(normalizeEventData(e));
          }
        });
      }

      // Traverse children
      if (fiber.child) traverseFiberForEvents(fiber.child, events, depth + 1);
      if (fiber.sibling) traverseFiberForEvents(fiber.sibling, events, depth + 1);
    } catch (e) {
      // Continue traversal on error
    }
  }

  function extractEventFromFiber(fiber, events) {
    try {
      if (fiber?.memoizedProps) {
        const props = fiber.memoizedProps;
        ['event', 'eventData', 'item', 'data'].forEach(key => {
          if (props[key] && (props[key].id || props[key].summary)) {
            events.push(normalizeEventData(props[key]));
          }
        });
      }
    } catch (e) {
      // Silently fail
    }
  }

  function normalizeEventData(raw) {
    return {
      id: raw.id || raw.eventId || raw.eid,
      title: raw.summary || raw.title || raw.subject || raw.name,
      startTime: raw.start?.dateTime || raw.startTime || raw.start,
      endTime: raw.end?.dateTime || raw.endTime || raw.end,
      description: raw.description || raw.body || raw.notes,
      location: raw.location?.displayName || raw.location || raw.place,
      attendees: raw.attendees || raw.participants || [],
      meetingLink: raw.hangoutLink || raw.conferenceData?.entryPoints?.[0]?.uri || raw.onlineMeeting?.joinUrl,
      organizer: raw.organizer?.email || raw.organizer?.displayName || raw.creator?.email,
      organizerName: raw.organizer?.displayName || raw.creator?.displayName,
      recurrence: raw.recurrence,
      status: raw.status,
      visibility: raw.visibility,
      colorId: raw.colorId,
      htmlLink: raw.htmlLink,
      source: 'react-state'
    };
  }

  // ============================================
  // METHOD 4: LOCALSTORAGE/SESSIONSTORAGE READING
  // ============================================
  function readStorageForEvents() {
    try {
      const events = [];

      // Check localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('calendar') || key.includes('event') || key.includes('meeting'))) {
          try {
            const value = localStorage.getItem(key);
            const data = JSON.parse(value);
            extractEventsFromStorageData(data, events);
          } catch (e) {
            // Not JSON or no events
          }
        }
      }

      // Check sessionStorage
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.includes('calendar') || key.includes('event') || key.includes('meeting'))) {
          try {
            const value = sessionStorage.getItem(key);
            const data = JSON.parse(value);
            extractEventsFromStorageData(data, events);
          } catch (e) {
            // Not JSON or no events
          }
        }
      }

      if (events.length > 0) {
        console.log(`PingMeet: Found ${events.length} events in storage`);
        window.postMessage({
          type: 'PINGMEET_STORAGE_DATA',
          events: events
        }, '*');
      }

      return events;
    } catch (e) {
      return [];
    }
  }

  function extractEventsFromStorageData(data, events) {
    if (!data) return;

    if (Array.isArray(data)) {
      data.forEach(item => {
        if (item.id && (item.summary || item.title || item.subject)) {
          events.push(normalizeEventData(item));
        }
      });
    } else if (data.items && Array.isArray(data.items)) {
      data.items.forEach(item => {
        if (item.id && (item.summary || item.title)) {
          events.push(normalizeEventData(item));
        }
      });
    } else if (data.events && Array.isArray(data.events)) {
      data.events.forEach(item => {
        if (item.id && (item.summary || item.title)) {
          events.push(normalizeEventData(item));
        }
      });
    } else if (data.id && (data.summary || data.title || data.subject)) {
      events.push(normalizeEventData(data));
    }
  }

  // ============================================
  // ENHANCED API DATA EXTRACTION
  // ============================================
  function enhanceGoogleCalendarData(data) {
    if (!data) return data;

    // Process items array
    if (data.items && Array.isArray(data.items)) {
      data.items = data.items.map(item => ({
        ...item,
        // Ensure all fields are extracted
        _enhanced: true,
        _extractedOrganizer: item.organizer?.email || item.creator?.email,
        _extractedOrganizerName: item.organizer?.displayName || item.creator?.displayName,
        _extractedRecurrence: item.recurrence || item.recurringEventId,
        _extractedVisibility: item.visibility || 'default',
        _extractedStatus: item.status || 'confirmed',
        _extractedColorId: item.colorId,
        _extractedAttachments: item.attachments || [],
        _extractedConferenceData: item.conferenceData || null,
        _extractedHtmlLink: item.htmlLink,
        _extractedCreated: item.created,
        _extractedUpdated: item.updated,
        // Extract dial-in info from conference data
        _extractedDialIn: extractDialInInfo(item.conferenceData),
      }));
    }

    return data;
  }

  function enhanceOutlookData(data) {
    if (!data) return data;

    // Process value array (Outlook uses 'value' instead of 'items')
    if (data.value && Array.isArray(data.value)) {
      data.value = data.value.map(item => ({
        ...item,
        _enhanced: true,
        _extractedOrganizer: item.organizer?.emailAddress?.address,
        _extractedOrganizerName: item.organizer?.emailAddress?.name,
        _extractedRecurrence: item.recurrence,
        _extractedVisibility: item.sensitivity || 'normal',
        _extractedStatus: item.showAs || 'busy',
        _extractedCategories: item.categories || [],
        _extractedImportance: item.importance || 'normal',
        _extractedIsOnlineMeeting: item.isOnlineMeeting,
        _extractedOnlineMeetingProvider: item.onlineMeetingProvider,
        _extractedWebLink: item.webLink,
        _extractedCreatedDateTime: item.createdDateTime,
        _extractedLastModifiedDateTime: item.lastModifiedDateTime,
        _extractedDialIn: extractOutlookDialInInfo(item.onlineMeeting),
      }));
    }

    return data;
  }

  // ============================================
  // DIAL-IN/CONFERENCE INFO EXTRACTION
  // ============================================
  function extractDialInInfo(conferenceData) {
    if (!conferenceData) return null;

    const dialIn = {
      phoneNumbers: [],
      conferenceId: null,
      pin: null,
      passcode: null,
      entryPoints: []
    };

    // Extract entry points
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
        }
      });
    }

    // Extract conference ID
    if (conferenceData.conferenceId) {
      dialIn.conferenceId = conferenceData.conferenceId;
    }

    // Extract from conference solution
    if (conferenceData.conferenceSolution) {
      dialIn.provider = conferenceData.conferenceSolution.name;
      dialIn.iconUri = conferenceData.conferenceSolution.iconUri;
    }

    return dialIn;
  }

  function extractOutlookDialInInfo(onlineMeeting) {
    if (!onlineMeeting) return null;

    const dialIn = {
      phoneNumbers: [],
      conferenceId: onlineMeeting.conferenceId,
      joinUrl: onlineMeeting.joinUrl,
      tollNumber: onlineMeeting.tollNumber,
      tollFreeNumber: onlineMeeting.tollFreeNumber
    };

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

    return dialIn;
  }

  // ============================================
  // PERIODIC EXTRACTION
  // ============================================
  function runExtractionMethods() {
    // Run React state extraction
    extractReactState();

    // Run storage reading
    readStorageForEvents();
  }

  // Run extraction methods after page load
  if (document.readyState === 'complete') {
    setTimeout(runExtractionMethods, 2000);
  } else {
    window.addEventListener('load', () => {
      setTimeout(runExtractionMethods, 2000);
    });
  }

  // Re-run extraction periodically (every 60 seconds)
  setInterval(runExtractionMethods, 60000);

  // Listen for manual extraction requests
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'PINGMEET_REQUEST_EXTRACTION') {
      runExtractionMethods();
    }
  });

  console.log('PingMeet: Enhanced injection complete - Fetch, XHR, React, Storage interception active');
})();

