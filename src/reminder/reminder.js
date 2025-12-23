/**
 * Reminder Window - Countdown timer popup (Enhanced v2)
 * Opens 2 minutes before meeting starts
 * Now displays: title, participants, time, description, location, organizer, dial-in, meeting ID, passcode
 */

import { DurationTracker } from '../utils/duration-tracker.js';

class ReminderWindow {
  constructor() {
    this.event = null;
    this.endTime = null;
    this.intervalId = null;
    this.userInteracted = false; // Track if user has interacted with the window
  }

  /**
   * Initialize the reminder window
   */
  init() {
    // Parse event from URL query parameter
    const params = new URLSearchParams(window.location.search);
    const eventData = params.get('event');

    if (eventData) {
      try {
        // Decode URI component first
        const decodedData = decodeURIComponent(eventData);

        // Parse JSON with validation
        this.event = JSON.parse(decodedData);

        // Validate essential fields
        if (!this.event || !this.event.startTime) {
          throw new Error('Invalid event data: missing required fields');
        }

        this.endTime = new Date(this.event.startTime);

        console.log('PingMeet: Loaded event data:', this.event);

        // Set event title
        const titleElement = document.getElementById('eventTitle');
        titleElement.textContent = this.event.title || 'Untitled Meeting';

        // Set participants (enhanced with response status)
        this.displayParticipants();

        // Set meeting time
        this.displayMeetingTime();

        // NEW: Display enhanced event details
        this.displayEnhancedDetails();

        // Start countdown
        this.updateCountdown();
        this.intervalId = setInterval(() => this.updateCountdown(), 1000);

        // Hide join button if no meeting link
        if (!this.event.meetingLink) {
          document.getElementById('joinBtn').style.display = 'none';
        }
      } catch (error) {
        console.error('PingMeet: Error parsing event data', error);

        // Show error message to user
        const titleElement = document.getElementById('eventTitle');
        if (titleElement) {
          titleElement.textContent = 'Error Loading Meeting Data';
        }

        // Optionally display error details in the UI
        const participantsElement = document.getElementById('participants');
        if (participantsElement) {
          participantsElement.innerHTML = `<div style="color: #ff6b6b; padding: 10px;">Unable to load meeting details. Please check the calendar.</div>`;
        }
      }
    }

    // Set up event listeners
    this.setupEventListeners();
  }

  /**
   * Display participants (Enhanced with response status icons)
   */
  displayParticipants() {
    const participantsElement = document.getElementById('participants');

    // Validate attendees is an array
    const attendees = Array.isArray(this.event.attendees) ? this.event.attendees : [];

    if (attendees.length === 0) {
      participantsElement.style.display = 'none';
      return;
    }

    const count = attendees.length;

    // Build participant display with response status as chips
    const displayAttendees = attendees.slice(0, 3).map(attendee => {
      const name = typeof attendee === 'string' ? attendee : (attendee.name || attendee.email?.split('@')[0] || 'Unknown');
      const status = typeof attendee === 'object' ? attendee.responseStatus : null;
      const statusClass = this.getResponseStatusClass(status);
      const statusIcon = this.getResponseStatusIcon(status);
      return `<span class="participant-chip ${statusClass}">${statusIcon}<span class="participant-name">${this.escapeHtml(name)}</span></span>`;
    });

    let html = '<span class="participants-label">Attendees</span>';
    html += '<div class="participants-list">' + displayAttendees.join('');
    if (count > 3) {
      html += `<span class="more-attendees">+${count - 3} more</span>`;
    }
    html += '</div>';

    participantsElement.innerHTML = html;
  }

  /**
   * Get response status CSS class
   */
  getResponseStatusClass(status) {
    const classes = {
      'accepted': 'status-accepted',
      'declined': 'status-declined',
      'tentative': 'status-tentative',
      'needsAction': 'status-pending'
    };
    return classes[status] || 'status-pending';
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Get response status icon (using simple text indicators)
   */
  getResponseStatusIcon(status) {
    const icons = {
      'accepted': '<span class="status-icon status-accepted">Y</span>',
      'declined': '<span class="status-icon status-declined">N</span>',
      'tentative': '<span class="status-icon status-tentative">?</span>',
      'needsAction': '<span class="status-icon status-pending">-</span>',
      'none': '',
      'unknown': ''
    };
    return icons[status] || '';
  }

  /**
   * Display meeting time
   */
  displayMeetingTime() {
    const timeElement = document.getElementById('meetingTime');

    if (!this.event.startTime || !this.event.endTime) {
      timeElement.style.display = 'none';
      return;
    }

    const start = new Date(this.event.startTime);
    const end = new Date(this.event.endTime);

    const startTime = start.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    const endTime = end.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    timeElement.textContent = `${startTime} - ${endTime}`;
  }

  /**
   * Display all enhanced event details
   * Shows the event-meta container only if there's data to display
   */
  displayEnhancedDetails() {
    const eventMeta = document.getElementById('eventMeta');
    let hasAnyData = false;

    // Try to display each field and track if any data exists
    hasAnyData = this.displayOrganizer() || hasAnyData;
    hasAnyData = this.displayLocation() || hasAnyData;
    hasAnyData = this.displayDescription() || hasAnyData;
    hasAnyData = this.displayDialInInfo() || hasAnyData;
    hasAnyData = this.displayMeetingId() || hasAnyData;
    hasAnyData = this.displayPasscode() || hasAnyData;
    hasAnyData = this.displayCalendarLink() || hasAnyData;

    // Show or hide the entire event-meta section
    if (hasAnyData) {
      eventMeta.classList.remove('hidden');
      console.log('PingMeet: Enhanced event details displayed');
    } else {
      eventMeta.classList.add('hidden');
      console.log('PingMeet: No enhanced event details to display');
    }
  }

  /**
   * Display organizer
   * @returns {boolean} True if data was displayed
   */
  displayOrganizer() {
    const row = document.getElementById('organizerRow');
    const element = document.getElementById('organizer');

    const organizerName = this.event.organizerName || this.event.organizer;
    if (!organizerName) {
      row.classList.add('hidden');
      return false;
    }

    element.textContent = organizerName;
    row.classList.remove('hidden');
    return true;
  }

  /**
   * Display location
   * @returns {boolean} True if data was displayed
   */
  displayLocation() {
    const row = document.getElementById('locationRow');
    const element = document.getElementById('location');

    if (!this.event.location) {
      row.classList.add('hidden');
      return false;
    }

    // Check if location is a URL (virtual meeting)
    if (this.event.location.startsWith('http')) {
      element.innerHTML = `<a href="${this.event.location}" target="_blank" style="color: #98d860;">${this.event.location}</a>`;
    } else {
      element.textContent = this.event.location;
    }
    row.classList.remove('hidden');
    return true;
  }

  /**
   * Display description
   * @returns {boolean} True if data was displayed
   */
  displayDescription() {
    const row = document.getElementById('descriptionRow');
    const element = document.getElementById('description');

    if (!this.event.description) {
      row.classList.add('hidden');
      return false;
    }

    // Sanitize and truncate description
    let desc = this.event.description;

    // If it's HTML, extract text content
    if (desc.includes('<') && desc.includes('>')) {
      const div = document.createElement('div');
      div.innerHTML = desc;
      desc = div.textContent || div.innerText;
    }

    // Truncate if too long
    if (desc.length > 300) {
      desc = desc.substring(0, 300) + '...';
    }

    // Skip if description is too short or just whitespace
    if (!desc.trim() || desc.trim().length < 5) {
      row.classList.add('hidden');
      return false;
    }

    element.textContent = desc.trim();
    row.classList.remove('hidden');
    return true;
  }

  /**
   * Display dial-in information
   * @returns {boolean} True if data was displayed
   */
  displayDialInInfo() {
    const row = document.getElementById('dialInRow');
    const phoneElement = document.getElementById('phoneNumber');
    const confIdElement = document.getElementById('conferenceId');
    const pinElement = document.getElementById('pinCode');

    // Check multiple sources for dial-in info
    const dialIn = this.event.dialIn;
    const phoneNumbers = this.event.phoneNumbers || dialIn?.phoneNumbers || [];
    const conferenceId = this.event.conferenceId || dialIn?.conferenceId;
    const pin = this.event.pin || dialIn?.pin;

    if (phoneNumbers.length === 0 && !conferenceId && !pin) {
      row.classList.add('hidden');
      return false;
    }

    // Display phone number(s)
    if (phoneNumbers.length > 0) {
      const primaryPhone = phoneNumbers[0];
      const phoneNum = typeof primaryPhone === 'string' ? primaryPhone : primaryPhone.number;
      if (phoneNum) {
        phoneElement.innerHTML = `<span class="copyable" data-copy="${phoneNum}">${phoneNum}</span>`;
        if (phoneNumbers.length > 1) {
          phoneElement.innerHTML += ` <span style="font-size: 11px; opacity: 0.7;">(+${phoneNumbers.length - 1} more)</span>`;
        }
        phoneElement.style.display = '';
      } else {
        phoneElement.style.display = 'none';
      }
    } else {
      phoneElement.style.display = 'none';
    }

    // Display conference ID
    if (conferenceId) {
      confIdElement.innerHTML = `Conference ID: <span class="copyable" data-copy="${conferenceId}">${conferenceId}</span>`;
      confIdElement.style.display = '';
    } else {
      confIdElement.style.display = 'none';
    }

    // Display PIN
    if (pin) {
      pinElement.innerHTML = `PIN: <span class="copyable" data-copy="${pin}">${pin}</span>`;
      pinElement.style.display = '';
    } else {
      pinElement.style.display = 'none';
    }

    row.classList.remove('hidden');

    // Add click-to-copy functionality
    this.setupCopyHandlers(row);
    return true;
  }

  /**
   * Display meeting ID
   * @returns {boolean} True if data was displayed
   */
  displayMeetingId() {
    const row = document.getElementById('meetingIdRow');
    const element = document.getElementById('meetingId');

    // Skip if dial-in already shows conference ID
    const dialInRow = document.getElementById('dialInRow');
    if (!dialInRow.classList.contains('hidden')) {
      // Don't duplicate conference ID
      row.classList.add('hidden');
      return false;
    }

    const meetingId = this.event.conferenceId || this.event.meetingId;
    if (!meetingId) {
      row.classList.add('hidden');
      return false;
    }

    element.textContent = meetingId;
    element.setAttribute('data-copy', meetingId);
    row.classList.remove('hidden');

    // Add click to copy
    element.addEventListener('click', () => this.copyToClipboard(meetingId, element));
    return true;
  }

  /**
   * Display passcode
   * @returns {boolean} True if data was displayed
   */
  displayPasscode() {
    const row = document.getElementById('passcodeRow');
    const element = document.getElementById('passcode');

    // Skip if dial-in already shows PIN
    const dialInRow = document.getElementById('dialInRow');
    if (!dialInRow.classList.contains('hidden') && this.event.pin) {
      // Don't duplicate PIN
      row.classList.add('hidden');
      return false;
    }

    const passcode = this.event.passcode;
    if (!passcode) {
      row.classList.add('hidden');
      return false;
    }

    element.textContent = passcode;
    element.setAttribute('data-copy', passcode);
    row.classList.remove('hidden');

    // Add click to copy
    element.addEventListener('click', () => this.copyToClipboard(passcode, element));
    return true;
  }

  /**
   * Display calendar link
   * @returns {boolean} True if data was displayed
   */
  displayCalendarLink() {
    const row = document.getElementById('calendarLinkRow');
    const linkElement = document.getElementById('calendarLink');

    const calendarUrl = this.event.htmlLink;
    if (!calendarUrl) {
      row.classList.add('hidden');
      return false;
    }

    linkElement.href = calendarUrl;
    row.classList.remove('hidden');
    return true;
  }

  /**
   * Setup copy handlers for copyable elements
   */
  setupCopyHandlers(container) {
    const copyables = container.querySelectorAll('.copyable[data-copy]');
    copyables.forEach(el => {
      el.addEventListener('click', () => {
        const text = el.getAttribute('data-copy');
        this.copyToClipboard(text, el);
      });
    });
  }

  /**
   * Copy text to clipboard with visual feedback
   */
  async copyToClipboard(text, element) {
    try {
      await navigator.clipboard.writeText(text);
      element.classList.add('copied');
      element.classList.add('copy-flash');

      setTimeout(() => {
        element.classList.remove('copied');
        element.classList.remove('copy-flash');
      }, 1500);

      console.log('PingMeet: Copied to clipboard:', text);
    } catch (error) {
      console.error('PingMeet: Copy failed', error);
    }
  }

  /**
   * Set up button event listeners
   */
  setupEventListeners() {
    document.getElementById('joinBtn').addEventListener('click', () => this.join());
    document.getElementById('lateBtn').addEventListener('click', () => this.sendRunningLateMessage());
    document.getElementById('snooze30s').addEventListener('click', () => this.snooze(0.5));
    document.getElementById('snooze1m').addEventListener('click', () => this.snooze(1));
    document.getElementById('snooze5m').addEventListener('click', () => this.snooze(5));
    document.getElementById('declineBtn').addEventListener('click', () => this.decline());
    document.getElementById('dismissBtn').addEventListener('click', () => this.dismiss());
    document.getElementById('closeBtn').addEventListener('click', () => this.dismiss());

    // Close on escape key (bind to instance for cleanup)
    this.escapeHandler = (e) => {
      if (e.key === 'Escape') {
        this.dismiss();
      }
    };
    document.addEventListener('keydown', this.escapeHandler);
  }

  /**
   * Send running late message via email
   */
  async sendRunningLateMessage() {
    // Get participant emails
    const recipients = this.getParticipantEmails();
    
    if (recipients.length === 0) {
      // No recipients, just copy to clipboard as fallback
      await this.copyRunningLateMessage();
      return;
    }

    // Prepare email content
    const subject = `Running late - ${this.event.title}`;
    const body = `Hi All,\n\nI am running a bit late for this meeting, will join soon.`;
    
    // Try to open email compose
    await this.openEmailCompose(recipients, subject, body);
  }

  /**
   * Get participant email addresses
   * @returns {Array<string>} Array of email addresses
   */
  getParticipantEmails() {
    if (!this.event.attendees || this.event.attendees.length === 0) {
      return [];
    }

    // Extract emails from attendees
    return this.event.attendees
      .map(attendee => {
        if (typeof attendee === 'string') {
          return attendee;
        }
        return attendee.email || attendee.name || null;
      })
      .filter(email => email && email.includes('@'));
  }

  /**
   * Open email compose window (Gmail or Outlook)
   * @param {Array<string>} recipients - Email addresses
   * @param {string} subject - Email subject
   * @param {string} body - Email body
   */
  async openEmailCompose(recipients, subject, body) {
    try {
      // Get all open tabs to detect Gmail or Outlook
      const tabs = await chrome.tabs.query({});
      const gmailTab = tabs.find(tab => tab.url && tab.url.includes('mail.google.com'));
      const outlookTab = tabs.find(tab => tab.url && (tab.url.includes('outlook.office.com') || tab.url.includes('outlook.live.com')));

      const to = recipients.join(',');
      const encodedSubject = encodeURIComponent(subject);
      const encodedBody = encodeURIComponent(body);

      let composeUrl;

      if (gmailTab) {
        // Gmail compose URL
        composeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${encodedSubject}&body=${encodedBody}`;
        await chrome.tabs.create({ url: composeUrl, active: true });
        this.showSuccessFeedback('Opening Gmail compose...');
      } else if (outlookTab) {
        // Outlook compose URL
        composeUrl = `https://outlook.office.com/mail/deeplink/compose?to=${to}&subject=${encodedSubject}&body=${encodedBody}`;
        await chrome.tabs.create({ url: composeUrl, active: true });
        this.showSuccessFeedback('Opening Outlook compose...');
      } else {
        // No email client detected, try Gmail as default
        composeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${encodedSubject}&body=${encodedBody}`;
        await chrome.tabs.create({ url: composeUrl, active: true });
        this.showSuccessFeedback('Opening Gmail compose...');
      }

      console.log('PingMeet: Opened email compose for running late message');
    } catch (error) {
      console.error('PingMeet: Error opening email compose', error);
      // Fallback to mailto
      this.openMailtoLink(recipients, subject, body);
    }
  }

  /**
   * Open mailto link as fallback
   * @param {Array<string>} recipients - Email addresses
   * @param {string} subject - Email subject
   * @param {string} body - Email body
   */
  openMailtoLink(recipients, subject, body) {
    const to = recipients.join(',');
    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(body);
    const mailtoUrl = `mailto:${to}?subject=${encodedSubject}&body=${encodedBody}`;
    
    window.open(mailtoUrl, '_blank');
    this.showSuccessFeedback('Opening email client...');
  }

  /**
   * Copy running late message to clipboard (fallback)
   */
  async copyRunningLateMessage() {
    const message = `Hi All,\n\nI am running a bit late for this meeting, will join soon.`;

    try {
      await navigator.clipboard.writeText(message);
      this.showSuccessFeedback('Copied to Clipboard');
      console.log('PingMeet: Running late message copied to clipboard');
    } catch (error) {
      console.error('PingMeet: Error copying to clipboard', error);
      alert(message);
    }
  }

  /**
   * Show success feedback on button
   * @param {string} message - Success message
   */
  showSuccessFeedback(message) {
    const btn = document.getElementById('lateBtn');
    const originalText = btn.textContent;
    const originalBackground = btn.style.background;
    
    btn.textContent = message;
    btn.style.background = 'rgba(40, 167, 69, 0.3)';

    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = originalBackground;
    }, 2000);
  }

  /**
   * Update countdown display
   */
  updateCountdown() {
    const now = new Date();
    const diff = this.endTime - now;

    const countdownElement = document.getElementById('countdown');

    if (diff <= 0) {
      countdownElement.textContent = 'NOW!';
      countdownElement.classList.add('urgent');
      document.querySelector('.countdown-label').textContent = 'starting now';

      // Auto-close after 10 seconds when meeting has started, unless user has interacted
      if (diff < -10000 && !this.userInteracted) {
        this.dismiss();
      }
      return;
    }

    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    countdownElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Add urgent class when less than 30 seconds
    if (diff < 30000) {
      countdownElement.classList.add('urgent');
    }
  }

  /**
   * Join the meeting
   */
  async join() {
    if (this.event?.meetingLink) {
      try {
        // Start tracking when user joins
        await DurationTracker.startTracking(this.event);

        // Open the meeting tab
        const tab = await chrome.tabs.create({ url: this.event.meetingLink, active: true });

        // Tell service worker to track this tab for duration
        await chrome.runtime.sendMessage({
          type: 'MEETING_TAB_OPENED',
          tabId: tab.id
        });

        console.log('PingMeet: Opened meeting link and started tracking tab:', tab.id);
      } catch (error) {
        console.error('PingMeet: Error opening meeting link', error);
        // Fallback to window.open
        window.open(this.event.meetingLink, '_blank');
      }
    }
    this.dismiss();
  }

  /**
   * Snooze the reminder
   * @param {number} minutes - Minutes to snooze (0.5 = 30 seconds)
   */
  async snooze(minutes = 1) {
    this.userInteracted = true; // Mark user interaction to prevent auto-close
    try {
      await chrome.runtime.sendMessage({
        type: 'SNOOZE',
        event: this.event,
        minutes: minutes,
      });
      const label = minutes < 1 ? `${minutes * 60} seconds` : `${minutes} minute${minutes > 1 ? 's' : ''}`;
      console.log(`PingMeet: Snoozed for ${label}`);
    } catch (error) {
      console.error('PingMeet: Error snoozing', error);
    }
    this.dismiss();
  }

  /**
   * Decline the meeting
   */
  async decline() {
    this.userInteracted = true; // Mark user interaction to prevent auto-close
    try {
      // Send message to mark as declined (prevents future reminders)
      await chrome.runtime.sendMessage({
        type: 'DECLINE_MEETING',
        eventId: this.event.id,
      });

      // Get participant emails
      const recipients = this.getParticipantEmails();
      
      if (recipients.length > 0) {
        // Send decline email
        const subject = `Unable to attend - ${this.event.title}`;
        const body = `Hi,\n\nUnfortunately, I won't be able to attend "${this.event.title}".\n\nApologies for any inconvenience.\n\nBest regards`;
        
        await this.openEmailCompose(recipients, subject, body);
      } else {
        // Fallback: copy to clipboard
        const message = `I won't be able to attend "${this.event.title}". Apologies for any inconvenience.`;
        try {
          await navigator.clipboard.writeText(message);
          console.log('PingMeet: Decline message copied to clipboard');
        } catch (error) {
          console.warn('PingMeet: Could not copy to clipboard', error);
        }
      }

      console.log('PingMeet: Meeting declined');
    } catch (error) {
      console.error('PingMeet: Error declining meeting', error);
    }
    this.dismiss();
  }

  /**
   * Dismiss the reminder window
   */
  dismiss() {
    // Cleanup interval
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Cleanup escape key listener (Issue #22)
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }

    window.close();
  }
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const reminder = new ReminderWindow();
    reminder.init();
  });
} else {
  const reminder = new ReminderWindow();
  reminder.init();
}
