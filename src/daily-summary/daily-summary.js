/**
 * Daily Summary Popup - JavaScript
 * Displays today's meeting overview
 */

class DailySummaryPopup {
  constructor() {
    this.events = [];
    this.init();
  }

  /**
   * Initialize the popup
   */
  async init() {
    // Parse events from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const eventsData = urlParams.get('events');

    if (eventsData) {
      try {
        this.events = JSON.parse(decodeURIComponent(eventsData));
      } catch (error) {
        console.error('PingMeet: Failed to parse events data', error);
        this.events = [];
      }
    }

    // Set up the UI
    this.setupUI();
    this.bindEvents();
  }

  /**
   * Set up the UI with event data
   */
  setupUI() {
    // Set date subtitle
    const subtitle = document.getElementById('subtitle');
    const today = new Date();
    subtitle.textContent = today.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });

    // Update stats
    const meetingCount = document.getElementById('meetingCount');
    const totalTime = document.getElementById('totalTime');
    const conflictCount = document.getElementById('conflictCount');
    const conflictStat = document.getElementById('conflictStat');

    meetingCount.textContent = this.events.length;

    // Calculate total meeting time
    const totalMinutes = this.calculateTotalTime();
    totalTime.textContent = this.formatDuration(totalMinutes);

    // Count conflicts
    const conflicts = this.events.filter(e => e.hasConflict).length;
    if (conflicts > 0) {
      conflictStat.style.display = 'flex';
      conflictCount.textContent = conflicts;
    }

    // Populate meetings list or show no meetings message
    if (this.events.length === 0) {
      document.getElementById('meetingsList').classList.add('hidden');
      document.getElementById('noMeetings').classList.remove('hidden');
      document.getElementById('title').textContent = 'No Meetings Today!';
    } else {
      this.populateMeetingsList();
    }
  }

  /**
   * Calculate total meeting time in minutes
   */
  calculateTotalTime() {
    let totalMinutes = 0;

    for (const event of this.events) {
      const startTime = new Date(event.startTime);
      const endTime = event.endTime
        ? new Date(event.endTime)
        : new Date(startTime.getTime() + 60 * 60 * 1000); // Default 1 hour

      const duration = (endTime - startTime) / (1000 * 60);
      totalMinutes += duration;
    }

    return Math.round(totalMinutes);
  }

  /**
   * Format duration from minutes to human readable
   */
  formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hours > 0 && mins > 0) {
      return `${hours}h ${mins}m`;
    } else if (hours > 0) {
      return `${hours}h`;
    } else {
      return `${mins}m`;
    }
  }

  /**
   * Populate the meetings list
   */
  populateMeetingsList() {
    const meetingsList = document.getElementById('meetingsList');
    meetingsList.innerHTML = '';

    // Sort events by start time
    const sortedEvents = [...this.events].sort((a, b) =>
      new Date(a.startTime) - new Date(b.startTime)
    );

    for (const event of sortedEvents) {
      const meetingItem = this.createMeetingItem(event);
      meetingsList.appendChild(meetingItem);
    }
  }

  /**
   * Create a meeting item element
   */
  createMeetingItem(event) {
    const item = document.createElement('div');
    item.className = 'meeting-item';
    if (event.hasConflict) {
      item.classList.add('has-conflict');
    }

    const startTime = new Date(event.startTime);
    const endTime = event.endTime
      ? new Date(event.endTime)
      : new Date(startTime.getTime() + 60 * 60 * 1000);

    const durationMins = Math.round((endTime - startTime) / (1000 * 60));

    // Time block
    const timeBlock = document.createElement('div');
    timeBlock.className = 'meeting-time-block';

    const startTimeEl = document.createElement('div');
    startTimeEl.className = 'meeting-start-time';
    startTimeEl.textContent = startTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    const durationEl = document.createElement('div');
    durationEl.className = 'meeting-duration';
    durationEl.textContent = this.formatDuration(durationMins);

    timeBlock.appendChild(startTimeEl);
    timeBlock.appendChild(durationEl);

    // Meeting info
    const info = document.createElement('div');
    info.className = 'meeting-info';

    const title = document.createElement('div');
    title.className = 'meeting-title';
    title.textContent = event.title || 'Untitled Meeting';

    const meta = document.createElement('div');
    meta.className = 'meeting-meta';

    // Attendees count
    if (event.attendees && event.attendees.length > 0) {
      const attendeesEl = document.createElement('span');
      attendeesEl.className = 'meeting-attendees';
      attendeesEl.innerHTML = `<span>&#128101;</span> ${event.attendees.length}`;
      meta.appendChild(attendeesEl);
    }

    // Conflict badge
    if (event.hasConflict) {
      const conflictBadge = document.createElement('span');
      conflictBadge.className = 'conflict-badge';
      conflictBadge.innerHTML = '&#9888; Conflict';
      meta.appendChild(conflictBadge);
    }

    // Meeting link indicator
    if (event.meetingLink) {
      const linkIndicator = document.createElement('span');
      linkIndicator.className = 'meeting-link-indicator';
      linkIndicator.innerHTML = '&#128279;'; // Link emoji
      linkIndicator.title = 'Has meeting link';
      meta.appendChild(linkIndicator);
    }

    info.appendChild(title);
    info.appendChild(meta);

    item.appendChild(timeBlock);
    item.appendChild(info);

    // Click to open meeting link if available
    if (event.meetingLink) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        chrome.tabs.create({ url: event.meetingLink, active: true });
      });
    } else if (event.htmlLink) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        chrome.tabs.create({ url: event.htmlLink, active: true });
      });
    }

    return item;
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    // Close button
    document.getElementById('closeBtn').addEventListener('click', () => {
      window.close();
    });

    // Dismiss button
    document.getElementById('dismissBtn').addEventListener('click', () => {
      window.close();
    });

    // Open Calendar button
    document.getElementById('openCalendarBtn').addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://calendar.google.com', active: true });
      window.close();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.close();
      }
    });
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new DailySummaryPopup();
});
