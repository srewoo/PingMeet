# PingMeet Feature Implementation Plan

This document outlines the implementation plan for four new features in the PingMeet Chrome extension.

---

## Table of Contents
1. [Feature 1: Voice/Spoken Reminders Toggle](#feature-1-voicespoken-reminders-toggle)
2. [Feature 2: Unified Calendar View](#feature-2-unified-calendar-view)
3. [Feature 3: AI Meeting Insights](#feature-3-ai-meeting-insights)
4. [Feature 4: Quick Event Creation](#feature-4-quick-event-creation)

---

## Feature 1: Voice/Spoken Reminders Toggle

### Overview
Add a setting to enable voice/spoken reminders that read meeting details aloud using the Web Speech API (SpeechSynthesis).

### Files to Modify

| File | Changes |
|------|---------|
| `src/utils/constants.js` | Add `voiceReminder: false` to `DEFAULT_SETTINGS` |
| `src/utils/storage.js` | No changes needed (generic settings handler) |
| `src/popup/popup.html` | Add toggle checkbox for voice reminders |
| `src/popup/popup.js` | Handle voice reminder setting save/load |
| `src/offscreen/offscreen.js` | Add voice synthesis function |
| `src/offscreen/offscreen.html` | No changes needed |
| `src/background/notification-manager.js` | Trigger voice reminder when enabled |

### Implementation Steps

#### Step 1: Update Constants (`src/utils/constants.js`)
```javascript
// Add to DEFAULT_SETTINGS object (line ~26)
export const DEFAULT_SETTINGS = {
  reminderMinutes: 2,
  playSound: true,
  showPopup: true,
  autoOpen: false,
  soundVolume: 70,
  dailySummary: true,
  voiceReminder: false,  // NEW: Voice/spoken reminder toggle
};
```

#### Step 2: Update Popup HTML (`src/popup/popup.html`)
Add new setting item after the "Play sound alert" checkbox (~line 168):
```html
<div class="setting-item">
  <label class="checkbox-label">
    <input type="checkbox" id="voiceReminder" />
    <span>Voice reminder (speak meeting details)</span>
  </label>
</div>
```

#### Step 3: Update Popup JS (`src/popup/popup.js`)

In `populateSettings()` method (~line 553):
```javascript
document.getElementById('voiceReminder').checked = this.settings.voiceReminder || false;
```

In `saveSettings()` method (~line 564):
```javascript
const newSettings = {
  // ... existing settings
  voiceReminder: document.getElementById('voiceReminder').checked,
};
```

#### Step 4: Update Offscreen Script (`src/offscreen/offscreen.js`)
Add voice synthesis handler:
```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PLAY_SOUND') {
    playAlert();
    sendResponse({ played: true });
  }
  if (message.type === 'SPEAK_REMINDER') {
    speakReminder(message.text);
    sendResponse({ spoken: true });
  }
  return true;
});

function speakReminder(text) {
  try {
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';

    window.speechSynthesis.speak(utterance);
    console.log('PingMeet: Voice reminder spoken');
  } catch (error) {
    console.error('PingMeet: Error speaking reminder', error);
  }
}
```

#### Step 5: Update Notification Manager (`src/background/notification-manager.js`)
Add voice reminder trigger in `triggerAttention()` method:
```javascript
// After sound alert, check for voice reminder
const settings = await StorageManager.getSettings();
if (settings.voiceReminder) {
  const minutesUntil = Math.round((new Date(event.startTime) - new Date()) / 60000);
  const speechText = `Meeting reminder: ${event.title} starts in ${minutesUntil} minutes.`;

  await this.ensureOffscreenDocument();
  await chrome.runtime.sendMessage({
    type: 'SPEAK_REMINDER',
    text: speechText
  });
}
```

#### Step 6: Add Message Type Constant (`src/utils/constants.js`)
```javascript
export const MESSAGE_TYPES = {
  // ... existing types
  SPEAK_REMINDER: 'SPEAK_REMINDER',
};
```

### Testing Checklist
- [ ] Toggle appears in settings
- [ ] Setting persists after extension reload
- [ ] Voice speaks meeting title and time when enabled
- [ ] Voice does not speak when disabled
- [ ] Sound and voice can work together
- [ ] Speech synthesis works in Chrome

---

## Feature 2: Unified Calendar View

### Overview
Display events from both Google Calendar and Outlook Calendar together in the extension popup, with visual indicators showing which calendar each event is from.

### Files to Modify

| File | Changes |
|------|---------|
| `src/popup/popup.html` | Add calendar filter tabs/badges |
| `src/popup/popup.css` | Add styles for calendar source indicators |
| `src/popup/popup.js` | Merge and display events from both sources |
| `src/utils/storage.js` | Add method to get events by source |
| `src/background/service-worker.js` | Ensure events retain source info when merged |

### Implementation Steps

#### Step 1: Update Storage Manager (`src/utils/storage.js`)
Add helper to get events grouped by source:
```javascript
/**
 * Get events grouped by calendar source
 * @returns {Promise<Object>} Events grouped by source
 */
static async getEventsBySource() {
  const events = await this.getEvents();
  return {
    google: events.filter(e => e.source === 'google-api' || e.source === 'google-dom'),
    outlook: events.filter(e => e.source === 'outlook-api' || e.source === 'outlook-dom'),
    all: events
  };
}
```

#### Step 2: Update Popup HTML (`src/popup/popup.html`)
Add calendar filter tabs above events list (~line 41):
```html
<section class="events-section">
  <div class="events-header">
    <h2 class="section-title">Upcoming Meetings</h2>
    <div class="calendar-filter" id="calendarFilter">
      <button class="filter-btn active" data-filter="all">All</button>
      <button class="filter-btn" data-filter="google">
        <span class="source-dot google"></span>Google
      </button>
      <button class="filter-btn" data-filter="outlook">
        <span class="source-dot outlook"></span>Outlook
      </button>
    </div>
  </div>
  <div class="events-list" id="eventsList">
    <div class="loading">Loading events...</div>
  </div>
</section>
```

#### Step 3: Update Popup CSS (`src/popup/popup.css`)
Add styles for unified view:
```css
/* Calendar Filter Tabs */
.events-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.calendar-filter {
  display: flex;
  gap: 4px;
}

.filter-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid #ddd;
  border-radius: 12px;
  background: white;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-btn:hover {
  background: #f5f5f5;
}

.filter-btn.active {
  background: #4285F4;
  color: white;
  border-color: #4285F4;
}

/* Calendar Source Indicators */
.source-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.source-dot.google {
  background: #4285F4;
}

.source-dot.outlook {
  background: #0078D4;
}

/* Event item source badge */
.event-source-badge {
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 8px;
  text-transform: uppercase;
  font-weight: 500;
}

.event-source-badge.google {
  background: #E8F0FE;
  color: #4285F4;
}

.event-source-badge.outlook {
  background: #E5F1FB;
  color: #0078D4;
}
```

#### Step 4: Update Popup JS (`src/popup/popup.js`)

Add filter state and methods:
```javascript
class PopupUI {
  constructor() {
    this.events = [];
    this.settings = null;
    this.currentFilter = 'all';  // NEW: Track active filter
  }
```

Add filter event listeners in `setupEventListeners()`:
```javascript
// Calendar filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    this.setCalendarFilter(e.target.dataset.filter);
  });
});
```

Add filter method:
```javascript
/**
 * Set calendar filter and re-render
 */
setCalendarFilter(filter) {
  this.currentFilter = filter;

  // Update active button
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });

  this.renderEvents();
}
```

Update `renderEvents()` to apply filter:
```javascript
renderEvents() {
  const eventsList = document.getElementById('eventsList');

  if (!this.events || this.events.length === 0) {
    eventsList.innerHTML = '<div class="no-events">No upcoming meetings found.</div>';
    return;
  }

  // Apply calendar filter
  let filteredEvents = this.events;
  if (this.currentFilter === 'google') {
    filteredEvents = this.events.filter(e =>
      e.source === 'google-api' || e.source === 'google-dom'
    );
  } else if (this.currentFilter === 'outlook') {
    filteredEvents = this.events.filter(e =>
      e.source === 'outlook-api' || e.source === 'outlook-dom'
    );
  }

  // Sort by start time
  const sortedEvents = [...filteredEvents].sort((a, b) =>
    new Date(a.startTime) - new Date(b.startTime)
  );

  // Limit to next 10 events (increased from 5 for unified view)
  const displayEvents = sortedEvents.slice(0, 10);

  if (displayEvents.length === 0) {
    eventsList.innerHTML = '<div class="no-events">No events from this calendar.</div>';
    return;
  }

  eventsList.innerHTML = displayEvents.map(event => this.renderEventItem(event)).join('');
}
```

Update `renderEventItem()` to show source badge:
```javascript
// Add source badge to event item (inside the event-details div)
const sourceType = event.source?.includes('google') ? 'google' : 'outlook';
const sourceBadge = `<span class="event-source-badge ${sourceType}">${sourceType}</span>`;

return `
  <div class="event-item ${event.hasConflict ? 'has-conflict' : ''}" data-event-id="${event.id}">
    <div class="event-time">${timeStr}</div>
    <div class="event-details">
      <div class="event-title-row">
        ${conflictWarning}
        <span class="event-title-text">${this.escapeHtml(event.title)}</span>
        ${sourceBadge}
      </div>
      <div class="event-countdown">${countdownStr}</div>
      ${attendeesHtml}
      ${detailsHtml}
    </div>
    ${meetingLinkHtml}
  </div>
`;
```

#### Step 5: Update Service Worker Event Handling
Ensure events from both sources are properly merged without duplicates in `handleNewEvents()` (`src/background/service-worker.js`):
```javascript
async handleNewEvents(events) {
  // ... existing code ...

  // Deduplicate events from different sources (same event in Google and Outlook)
  const uniqueEvents = this.deduplicateEvents(upcoming);

  // Store events
  await StorageManager.saveEvents(uniqueEvents);
  // ... rest of method
}

/**
 * Deduplicate events that may appear in both calendars
 */
deduplicateEvents(events) {
  const seen = new Map();

  return events.filter(event => {
    // Create a key based on title and start time
    const key = `${event.title.toLowerCase()}_${new Date(event.startTime).getTime()}`;

    if (seen.has(key)) {
      // Keep the one with more details (e.g., meeting link, attendees)
      const existing = seen.get(key);
      if (this.hasMoreDetails(event, existing)) {
        seen.set(key, event);
        return false; // Will be included via the map
      }
      return false; // Duplicate, skip
    }

    seen.set(key, event);
    return true;
  });
}

hasMoreDetails(a, b) {
  const scoreA = (a.meetingLink ? 1 : 0) + (a.attendees?.length || 0);
  const scoreB = (b.meetingLink ? 1 : 0) + (b.attendees?.length || 0);
  return scoreA > scoreB;
}
```

### Testing Checklist
- [ ] Events from both Google and Outlook appear in unified list
- [ ] Filter tabs work correctly (All, Google, Outlook)
- [ ] Source badges display correctly on each event
- [ ] Duplicate events are properly deduplicated
- [ ] Events are sorted by start time regardless of source
- [ ] Clicking on events still opens meeting links correctly

---

## Feature 3: AI Meeting Insights

### Overview
Provide AI-powered meeting insights and suggestions (e.g., "You have too many meetings today", "Suggest focus blocks") when the user provides an AI API key. The key is stored locally in browser storage.

### Files to Create

| File | Purpose |
|------|---------|
| `src/utils/ai-insights.js` | AI service for generating insights |

### Files to Modify

| File | Changes |
|------|---------|
| `src/utils/constants.js` | Add AI-related constants |
| `src/popup/popup.html` | Add AI settings section and insights display |
| `src/popup/popup.css` | Add styles for AI insights cards |
| `src/popup/popup.js` | Handle AI key management and insights display |

### Implementation Steps

#### Step 1: Add Constants (`src/utils/constants.js`)
```javascript
// Add to constants
export const AI_CONFIG = {
  STORAGE_KEY: 'aiApiKey',
  INSIGHTS_CACHE_KEY: 'aiInsightsCache',
  CACHE_DURATION_MS: 30 * 60 * 1000, // 30 minutes
  MAX_MEETINGS_FOR_CONCERN: 6, // Meetings per day threshold
  MIN_FOCUS_BLOCK_HOURS: 2, // Minimum gap to suggest focus block
};
```

#### Step 2: Create AI Insights Service (`src/utils/ai-insights.js`)
```javascript
/**
 * AI Meeting Insights Service
 * Provides AI-powered analysis of meeting patterns
 * Requires user-provided API key (stored locally)
 */

import { AI_CONFIG } from './constants.js';
import { StorageManager } from './storage.js';

export class AIInsights {
  static OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

  /**
   * Save AI API key to local storage
   */
  static async saveApiKey(apiKey) {
    await chrome.storage.local.set({ [AI_CONFIG.STORAGE_KEY]: apiKey });
  }

  /**
   * Get stored API key
   */
  static async getApiKey() {
    const data = await chrome.storage.local.get(AI_CONFIG.STORAGE_KEY);
    return data[AI_CONFIG.STORAGE_KEY] || null;
  }

  /**
   * Remove API key
   */
  static async removeApiKey() {
    await chrome.storage.local.remove(AI_CONFIG.STORAGE_KEY);
    await chrome.storage.local.remove(AI_CONFIG.INSIGHTS_CACHE_KEY);
  }

  /**
   * Check if AI is configured
   */
  static async isConfigured() {
    const key = await this.getApiKey();
    return !!key;
  }

  /**
   * Generate meeting insights using AI
   */
  static async generateInsights(events) {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      return { success: false, error: 'No API key configured' };
    }

    // Check cache first
    const cached = await this.getCachedInsights();
    if (cached && !this.isCacheExpired(cached.timestamp)) {
      return { success: true, insights: cached.insights, fromCache: true };
    }

    try {
      // Prepare meeting data for AI analysis
      const meetingsSummary = this.prepareMeetingsSummary(events);

      const response = await fetch(this.OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `You are a productivity assistant analyzing meeting schedules.
              Provide brief, actionable insights about the user's meetings.
              Focus on: meeting load, potential conflicts, gaps for focus time, and patterns.
              Keep each insight to 1-2 sentences. Return as JSON array of insight objects with 'type' (warning/suggestion/info) and 'text' fields.`
            },
            {
              role: 'user',
              content: `Analyze these meetings for today and provide insights:\n${meetingsSummary}`
            }
          ],
          max_tokens: 300,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const error = await response.json();
        return { success: false, error: error.error?.message || 'API error' };
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      // Parse AI response
      let insights;
      try {
        insights = JSON.parse(content);
      } catch {
        // If AI doesn't return valid JSON, create a simple insight
        insights = [{ type: 'info', text: content }];
      }

      // Cache the results
      await this.cacheInsights(insights);

      return { success: true, insights };
    } catch (error) {
      console.error('PingMeet: AI insights error', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate local insights without AI (fallback)
   */
  static generateLocalInsights(events) {
    const insights = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Filter to today's events
    const todayEvents = events.filter(e => {
      const start = new Date(e.startTime);
      return start >= today && start < tomorrow;
    });

    // Insight: Meeting count
    if (todayEvents.length >= AI_CONFIG.MAX_MEETINGS_FOR_CONCERN) {
      insights.push({
        type: 'warning',
        text: `You have ${todayEvents.length} meetings today. Consider declining non-essential ones.`
      });
    } else if (todayEvents.length === 0) {
      insights.push({
        type: 'info',
        text: 'No meetings scheduled for today. Great time for focused work!'
      });
    }

    // Insight: Total meeting time
    const totalMinutes = todayEvents.reduce((sum, e) => {
      const start = new Date(e.startTime);
      const end = new Date(e.endTime || start);
      return sum + (end - start) / 60000;
    }, 0);

    if (totalMinutes > 300) { // More than 5 hours
      insights.push({
        type: 'warning',
        text: `${Math.round(totalMinutes / 60)} hours in meetings today. Schedule breaks!`
      });
    }

    // Insight: Find focus blocks
    const focusBlocks = this.findFocusBlocks(todayEvents);
    if (focusBlocks.length > 0) {
      const block = focusBlocks[0];
      insights.push({
        type: 'suggestion',
        text: `Focus block available: ${block.start} - ${block.end} (${block.duration}h)`
      });
    }

    // Insight: Back-to-back meetings
    const backToBack = this.findBackToBackMeetings(todayEvents);
    if (backToBack > 2) {
      insights.push({
        type: 'warning',
        text: `${backToBack} back-to-back meetings detected. Consider adding buffer time.`
      });
    }

    return insights;
  }

  /**
   * Find available focus blocks
   */
  static findFocusBlocks(events) {
    const blocks = [];
    const workStart = 9; // 9 AM
    const workEnd = 18; // 6 PM

    // Sort events by start time
    const sorted = [...events].sort((a, b) =>
      new Date(a.startTime) - new Date(b.startTime)
    );

    let currentTime = new Date();
    currentTime.setHours(workStart, 0, 0, 0);

    for (const event of sorted) {
      const eventStart = new Date(event.startTime);
      const gapHours = (eventStart - currentTime) / (1000 * 60 * 60);

      if (gapHours >= AI_CONFIG.MIN_FOCUS_BLOCK_HOURS) {
        blocks.push({
          start: currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          end: eventStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          duration: Math.round(gapHours * 10) / 10
        });
      }

      const eventEnd = new Date(event.endTime || eventStart);
      if (eventEnd > currentTime) {
        currentTime = eventEnd;
      }
    }

    // Check gap after last meeting until end of day
    const endOfDay = new Date();
    endOfDay.setHours(workEnd, 0, 0, 0);
    const finalGap = (endOfDay - currentTime) / (1000 * 60 * 60);

    if (finalGap >= AI_CONFIG.MIN_FOCUS_BLOCK_HOURS && currentTime < endOfDay) {
      blocks.push({
        start: currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        end: endOfDay.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        duration: Math.round(finalGap * 10) / 10
      });
    }

    return blocks;
  }

  /**
   * Count back-to-back meetings
   */
  static findBackToBackMeetings(events) {
    const sorted = [...events].sort((a, b) =>
      new Date(a.startTime) - new Date(b.startTime)
    );

    let count = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = new Date(sorted[i-1].endTime || sorted[i-1].startTime);
      const currStart = new Date(sorted[i].startTime);
      const gap = (currStart - prevEnd) / 60000; // minutes

      if (gap <= 5) { // 5 minutes or less gap
        count++;
      }
    }

    return count;
  }

  /**
   * Prepare meetings summary for AI
   */
  static prepareMeetingsSummary(events) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return events
      .filter(e => new Date(e.startTime) >= today)
      .map(e => {
        const start = new Date(e.startTime);
        const end = new Date(e.endTime || start);
        const duration = Math.round((end - start) / 60000);
        return `- ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}: ${e.title} (${duration} min, ${e.attendees?.length || 0} attendees)`;
      })
      .join('\n');
  }

  /**
   * Cache insights
   */
  static async cacheInsights(insights) {
    await chrome.storage.local.set({
      [AI_CONFIG.INSIGHTS_CACHE_KEY]: {
        insights,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Get cached insights
   */
  static async getCachedInsights() {
    const data = await chrome.storage.local.get(AI_CONFIG.INSIGHTS_CACHE_KEY);
    return data[AI_CONFIG.INSIGHTS_CACHE_KEY] || null;
  }

  /**
   * Check if cache is expired
   */
  static isCacheExpired(timestamp) {
    return Date.now() - timestamp > AI_CONFIG.CACHE_DURATION_MS;
  }
}
```

#### Step 3: Update Popup HTML (`src/popup/popup.html`)

Add AI settings section in settings view (after daily summary setting ~line 189):
```html
<div class="settings-divider"></div>

<!-- AI Insights Section -->
<div class="ai-section">
  <div class="section-label">AI Meeting Insights (Optional)</div>
  <div class="ai-description">
    Get AI-powered insights about your meeting patterns and suggestions for focus time.
  </div>

  <div class="ai-key-form" id="aiKeyForm">
    <input type="password" id="aiApiKey" class="credential-input"
           placeholder="Enter OpenAI API key (sk-...)" />
    <div class="ai-key-actions">
      <button class="connect-btn" id="aiSaveKeyBtn">Save Key</button>
      <button class="connect-btn disconnect hidden" id="aiRemoveKeyBtn">Remove Key</button>
    </div>
  </div>

  <div class="ai-status" id="aiStatus">
    <span class="ai-status-indicator"></span>
    <span class="ai-status-text">Not configured</span>
  </div>

  <div class="privacy-note">
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
    </svg>
    <span>API key stored locally. Your data is sent directly to OpenAI, never to us.</span>
  </div>
</div>
```

Add AI insights display in main view (after duration stats ~line 39):
```html
<!-- AI Insights Card -->
<div class="insights-card hidden" id="insightsCard">
  <div class="insights-header">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM6.5 7.5h3v5h-1v-4h-2v-1z"/>
    </svg>
    <span>Insights</span>
    <button class="refresh-insights-btn" id="refreshInsightsBtn" title="Refresh insights">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 4v6h6M15 12V6H9"/>
        <path d="M13.5 5.5A6 6 0 0 0 2 8M2.5 10.5A6 6 0 0 0 14 8"/>
      </svg>
    </button>
  </div>
  <div class="insights-list" id="insightsList">
    <!-- Insights will be rendered here -->
  </div>
</div>
```

#### Step 4: Update Popup CSS (`src/popup/popup.css`)
```css
/* AI Insights Styles */
.ai-section {
  margin-top: 16px;
}

.ai-description {
  font-size: 12px;
  color: #666;
  margin-bottom: 12px;
}

.ai-key-form {
  margin-bottom: 8px;
}

.ai-key-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.ai-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #666;
}

.ai-status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ccc;
}

.ai-status.configured .ai-status-indicator {
  background: #28a745;
}

/* Insights Card */
.insights-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 12px;
  color: white;
}

.insights-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 10px;
}

.refresh-insights-btn {
  margin-left: auto;
  background: rgba(255,255,255,0.2);
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: white;
}

.refresh-insights-btn:hover {
  background: rgba(255,255,255,0.3);
}

.insights-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.insight-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.4;
  padding: 8px;
  background: rgba(255,255,255,0.15);
  border-radius: 8px;
}

.insight-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.insight-item.warning .insight-icon {
  color: #ffd700;
}

.insight-item.suggestion .insight-icon {
  color: #90EE90;
}

.insight-item.info .insight-icon {
  color: #87CEEB;
}

.insights-loading {
  text-align: center;
  padding: 20px;
  font-size: 12px;
  opacity: 0.8;
}
```

#### Step 5: Update Popup JS (`src/popup/popup.js`)

Add import:
```javascript
import { AIInsights } from '../utils/ai-insights.js';
```

Add AI methods:
```javascript
/**
 * Set up AI-related event listeners
 */
setupAIEventListeners() {
  document.getElementById('aiSaveKeyBtn').addEventListener('click', () => this.saveAIKey());
  document.getElementById('aiRemoveKeyBtn').addEventListener('click', () => this.removeAIKey());
  document.getElementById('refreshInsightsBtn').addEventListener('click', () => this.loadInsights(true));
}

/**
 * Update AI configuration status
 */
async updateAIStatus() {
  const isConfigured = await AIInsights.isConfigured();
  const statusEl = document.getElementById('aiStatus');
  const saveBtn = document.getElementById('aiSaveKeyBtn');
  const removeBtn = document.getElementById('aiRemoveKeyBtn');
  const keyInput = document.getElementById('aiApiKey');
  const insightsCard = document.getElementById('insightsCard');

  if (isConfigured) {
    statusEl.classList.add('configured');
    statusEl.querySelector('.ai-status-text').textContent = 'AI insights enabled';
    saveBtn.classList.add('hidden');
    removeBtn.classList.remove('hidden');
    keyInput.value = '••••••••••••••••';
    keyInput.disabled = true;
    insightsCard.classList.remove('hidden');

    // Load insights
    await this.loadInsights();
  } else {
    statusEl.classList.remove('configured');
    statusEl.querySelector('.ai-status-text').textContent = 'Not configured';
    saveBtn.classList.remove('hidden');
    removeBtn.classList.add('hidden');
    keyInput.value = '';
    keyInput.disabled = false;
    insightsCard.classList.add('hidden');
  }
}

/**
 * Save AI API key
 */
async saveAIKey() {
  const keyInput = document.getElementById('aiApiKey');
  const key = keyInput.value.trim();

  if (!key || !key.startsWith('sk-')) {
    alert('Please enter a valid OpenAI API key (starts with sk-)');
    return;
  }

  await AIInsights.saveApiKey(key);
  await this.updateAIStatus();
}

/**
 * Remove AI API key
 */
async removeAIKey() {
  if (confirm('Remove AI API key? Insights will no longer be generated.')) {
    await AIInsights.removeApiKey();
    await this.updateAIStatus();
  }
}

/**
 * Load and display AI insights
 */
async loadInsights(forceRefresh = false) {
  const insightsList = document.getElementById('insightsList');
  const isConfigured = await AIInsights.isConfigured();

  // Show local insights even without AI key
  let insights;

  if (isConfigured) {
    insightsList.innerHTML = '<div class="insights-loading">Analyzing your schedule...</div>';

    if (forceRefresh) {
      await chrome.storage.local.remove('aiInsightsCache');
    }

    const result = await AIInsights.generateInsights(this.events);
    if (result.success) {
      insights = result.insights;
    } else {
      // Fallback to local insights
      insights = AIInsights.generateLocalInsights(this.events);
    }
  } else {
    // Use local insights only
    insights = AIInsights.generateLocalInsights(this.events);

    // Show insights card if there are local insights
    if (insights.length > 0) {
      document.getElementById('insightsCard').classList.remove('hidden');
    }
  }

  this.renderInsights(insights);
}

/**
 * Render insights list
 */
renderInsights(insights) {
  const insightsList = document.getElementById('insightsList');

  if (!insights || insights.length === 0) {
    insightsList.innerHTML = '<div class="insight-item info">Your schedule looks good!</div>';
    return;
  }

  const icons = {
    warning: '<svg class="insight-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 14h14L8 1zm0 4v4m0 2v1"/></svg>',
    suggestion: '<svg class="insight-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm1 10H7V9h2v2zm0-3H7V4h2v4z"/></svg>',
    info: '<svg class="insight-icon" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6"/></svg>'
  };

  insightsList.innerHTML = insights.map(insight => `
    <div class="insight-item ${insight.type || 'info'}">
      ${icons[insight.type] || icons.info}
      <span>${this.escapeHtml(insight.text)}</span>
    </div>
  `).join('');
}
```

Update `init()` to include AI setup:
```javascript
async init() {
  // ... existing code ...
  this.setupAIEventListeners();
  await this.updateAIStatus();
}
```

### Testing Checklist
- [ ] API key input appears in settings
- [ ] API key is saved and persists
- [ ] API key can be removed
- [ ] Insights display when AI is configured
- [ ] Local insights work without API key
- [ ] Refresh button reloads insights
- [ ] Warning/suggestion/info types display correctly
- [ ] Insights update when events change

---

## Feature 4: Quick Event Creation

### Overview
Allow users to create calendar events directly from the extension popup without opening the calendar website.

### Files to Modify

| File | Changes |
|------|---------|
| `src/utils/calendar-api.js` | Add event creation methods for Google & Outlook |
| `src/popup/popup.html` | Add quick event creation form |
| `src/popup/popup.css` | Add styles for event creation form |
| `src/popup/popup.js` | Handle event creation logic |
| `manifest.json` | Add write permission for calendar APIs |

### Implementation Steps

#### Step 1: Update Manifest Permissions
Update OAuth scopes in the calendar connection flow to include write access. Note: This requires users to reconnect their calendars.

#### Step 2: Update Calendar API (`src/utils/calendar-api.js`)

Add event creation methods:
```javascript
/**
 * Create a new Google Calendar event
 */
static async createGoogleEvent(eventData) {
  try {
    const token = await this.getValidToken();
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    const event = {
      summary: eventData.title,
      start: {
        dateTime: eventData.startTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      end: {
        dateTime: eventData.endTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      description: eventData.description || '',
      location: eventData.location || ''
    };

    // Add conference data if meeting link requested
    if (eventData.addMeetLink) {
      event.conferenceData = {
        createRequest: {
          requestId: `pingmeet_${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      };
    }

    const response = await fetch(
      `${this.GOOGLE_CALENDAR_API}/calendars/primary/events?conferenceDataVersion=1`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.error?.message || 'Failed to create event' };
    }

    const created = await response.json();
    console.log('PingMeet: Created Google Calendar event', created.id);

    return {
      success: true,
      event: {
        id: created.id,
        htmlLink: created.htmlLink,
        meetingLink: created.conferenceData?.entryPoints?.[0]?.uri
      }
    };
  } catch (error) {
    console.error('PingMeet: Error creating Google event', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create a new Outlook Calendar event
 */
static async createOutlookEvent(eventData) {
  try {
    const token = await this.getValidOutlookToken();
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    const event = {
      subject: eventData.title,
      start: {
        dateTime: eventData.startTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      end: {
        dateTime: eventData.endTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      body: {
        contentType: 'text',
        content: eventData.description || ''
      },
      location: {
        displayName: eventData.location || ''
      }
    };

    // Add Teams meeting if requested
    if (eventData.addMeetLink) {
      event.isOnlineMeeting = true;
      event.onlineMeetingProvider = 'teamsForBusiness';
    }

    const response = await fetch(
      `${this.MS_GRAPH_API}/me/events`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.error?.message || 'Failed to create event' };
    }

    const created = await response.json();
    console.log('PingMeet: Created Outlook event', created.id);

    return {
      success: true,
      event: {
        id: created.id,
        webLink: created.webLink,
        meetingLink: created.onlineMeeting?.joinUrl
      }
    };
  } catch (error) {
    console.error('PingMeet: Error creating Outlook event', error);
    return { success: false, error: error.message };
  }
}
```

#### Step 3: Update Popup HTML (`src/popup/popup.html`)

Add quick create button and form in main view (after events section ~line 46):
```html
<!-- Quick Event Creation -->
<div class="quick-create-section">
  <button class="quick-create-btn" id="quickCreateBtn">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="8" y1="3" x2="8" y2="13"/>
      <line x1="3" y1="8" x2="13" y2="8"/>
    </svg>
    Quick Create Event
  </button>
</div>

<!-- Quick Create Form (hidden by default) -->
<div class="quick-create-form hidden" id="quickCreateForm">
  <div class="form-header">
    <h3>Create Event</h3>
    <button class="close-form-btn" id="closeFormBtn">&times;</button>
  </div>

  <div class="form-body">
    <div class="form-group">
      <label for="eventTitle">Title *</label>
      <input type="text" id="eventTitle" placeholder="Meeting title" required />
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="eventDate">Date *</label>
        <input type="date" id="eventDate" required />
      </div>
      <div class="form-group">
        <label for="eventStartTime">Start *</label>
        <input type="time" id="eventStartTime" required />
      </div>
      <div class="form-group">
        <label for="eventEndTime">End *</label>
        <input type="time" id="eventEndTime" required />
      </div>
    </div>

    <div class="form-group">
      <label for="eventCalendar">Calendar *</label>
      <select id="eventCalendar">
        <option value="">Select calendar...</option>
        <option value="google">Google Calendar</option>
        <option value="outlook">Outlook Calendar</option>
      </select>
    </div>

    <div class="form-group">
      <label for="eventLocation">Location</label>
      <input type="text" id="eventLocation" placeholder="Room or address" />
    </div>

    <div class="form-group">
      <label for="eventDescription">Description</label>
      <textarea id="eventDescription" rows="2" placeholder="Optional notes"></textarea>
    </div>

    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="addMeetLink" />
        <span>Add video meeting link</span>
      </label>
    </div>
  </div>

  <div class="form-actions">
    <button class="cancel-btn" id="cancelCreateBtn">Cancel</button>
    <button class="create-btn" id="createEventBtn">Create Event</button>
  </div>
</div>
```

#### Step 4: Update Popup CSS (`src/popup/popup.css`)
```css
/* Quick Create Section */
.quick-create-section {
  margin: 12px 0;
}

.quick-create-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  border: 2px dashed #ddd;
  border-radius: 8px;
  background: transparent;
  color: #666;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.quick-create-btn:hover {
  border-color: #4285F4;
  color: #4285F4;
  background: #f8f9ff;
}

/* Quick Create Form */
.quick-create-form {
  background: white;
  border: 1px solid #ddd;
  border-radius: 12px;
  margin: 12px 0;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f8f9fa;
  border-bottom: 1px solid #eee;
}

.form-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.close-form-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #666;
  line-height: 1;
}

.form-body {
  padding: 16px;
}

.form-group {
  margin-bottom: 12px;
}

.form-group label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: #333;
  margin-bottom: 4px;
}

.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  box-sizing: border-box;
}

.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #4285F4;
  box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.2);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  background: #f8f9fa;
  border-top: 1px solid #eee;
}

.cancel-btn {
  padding: 8px 16px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
  color: #666;
  cursor: pointer;
}

.create-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: #4285F4;
  color: white;
  font-weight: 500;
  cursor: pointer;
}

.create-btn:hover {
  background: #3367d6;
}

.create-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}
```

#### Step 5: Update Popup JS (`src/popup/popup.js`)

Add event creation methods:
```javascript
/**
 * Set up quick create event listeners
 */
setupQuickCreateListeners() {
  document.getElementById('quickCreateBtn').addEventListener('click', () => this.showQuickCreateForm());
  document.getElementById('closeFormBtn').addEventListener('click', () => this.hideQuickCreateForm());
  document.getElementById('cancelCreateBtn').addEventListener('click', () => this.hideQuickCreateForm());
  document.getElementById('createEventBtn').addEventListener('click', () => this.createEvent());

  // Set default date to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('eventDate').value = today;

  // Set default times (next hour to hour after)
  const now = new Date();
  const nextHour = new Date(now.setHours(now.getHours() + 1, 0, 0, 0));
  const hourAfter = new Date(nextHour.getTime() + 60 * 60 * 1000);

  document.getElementById('eventStartTime').value = nextHour.toTimeString().slice(0, 5);
  document.getElementById('eventEndTime').value = hourAfter.toTimeString().slice(0, 5);
}

/**
 * Show quick create form
 */
async showQuickCreateForm() {
  // Update calendar options based on connections
  const status = await CalendarAPI.getConnectionStatus();
  const select = document.getElementById('eventCalendar');

  // Reset options
  select.innerHTML = '<option value="">Select calendar...</option>';

  if (status.google) {
    select.innerHTML += '<option value="google">Google Calendar</option>';
  }
  if (status.outlook) {
    select.innerHTML += '<option value="outlook">Outlook Calendar</option>';
  }

  if (!status.google && !status.outlook) {
    alert('Please connect a calendar first in Settings to create events.');
    return;
  }

  // Auto-select if only one option
  if (status.google && !status.outlook) {
    select.value = 'google';
  } else if (!status.google && status.outlook) {
    select.value = 'outlook';
  }

  document.getElementById('quickCreateBtn').classList.add('hidden');
  document.getElementById('quickCreateForm').classList.remove('hidden');
}

/**
 * Hide quick create form
 */
hideQuickCreateForm() {
  document.getElementById('quickCreateForm').classList.add('hidden');
  document.getElementById('quickCreateBtn').classList.remove('hidden');

  // Reset form
  document.getElementById('eventTitle').value = '';
  document.getElementById('eventLocation').value = '';
  document.getElementById('eventDescription').value = '';
  document.getElementById('addMeetLink').checked = false;
}

/**
 * Create new calendar event
 */
async createEvent() {
  const title = document.getElementById('eventTitle').value.trim();
  const date = document.getElementById('eventDate').value;
  const startTime = document.getElementById('eventStartTime').value;
  const endTime = document.getElementById('eventEndTime').value;
  const calendar = document.getElementById('eventCalendar').value;
  const location = document.getElementById('eventLocation').value.trim();
  const description = document.getElementById('eventDescription').value.trim();
  const addMeetLink = document.getElementById('addMeetLink').checked;

  // Validation
  if (!title) {
    alert('Please enter a meeting title');
    return;
  }
  if (!date || !startTime || !endTime) {
    alert('Please select date and time');
    return;
  }
  if (!calendar) {
    alert('Please select a calendar');
    return;
  }

  // Build datetime strings
  const startDateTime = `${date}T${startTime}:00`;
  const endDateTime = `${date}T${endTime}:00`;

  // Validate times
  if (new Date(endDateTime) <= new Date(startDateTime)) {
    alert('End time must be after start time');
    return;
  }

  const createBtn = document.getElementById('createEventBtn');
  createBtn.disabled = true;
  createBtn.textContent = 'Creating...';

  try {
    const eventData = {
      title,
      startTime: startDateTime,
      endTime: endDateTime,
      location,
      description,
      addMeetLink
    };

    let result;
    if (calendar === 'google') {
      result = await CalendarAPI.createGoogleEvent(eventData);
    } else {
      result = await CalendarAPI.createOutlookEvent(eventData);
    }

    if (result.success) {
      // Show success
      createBtn.textContent = 'Created!';
      createBtn.style.background = '#28a745';

      // Refresh events list
      await this.syncCalendarEvents();

      setTimeout(() => {
        this.hideQuickCreateForm();
        createBtn.disabled = false;
        createBtn.textContent = 'Create Event';
        createBtn.style.background = '';
      }, 1500);
    } else {
      alert('Failed to create event: ' + result.error);
      createBtn.disabled = false;
      createBtn.textContent = 'Create Event';
    }
  } catch (error) {
    console.error('PingMeet: Error creating event', error);
    alert('Error creating event: ' + error.message);
    createBtn.disabled = false;
    createBtn.textContent = 'Create Event';
  }
}
```

Update `init()` to include quick create setup:
```javascript
async init() {
  // ... existing code ...
  this.setupQuickCreateListeners();
}
```

#### Step 6: Update OAuth Scopes

For Google Calendar, update the scopes in `connectGoogle()` (`src/utils/calendar-api.js`):
```javascript
const scopes = [
  'https://www.googleapis.com/auth/calendar.events',  // Changed from calendar.readonly
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');
```

For Outlook Calendar, update the scopes in `connectOutlook()`:
```javascript
const scopes = [
  'openid',
  'profile',
  'email',
  'Calendars.ReadWrite'  // Changed from Calendars.Read
].join(' ');
```

### Testing Checklist
- [ ] Quick create button appears in popup
- [ ] Form opens when button clicked
- [ ] Form validation works (required fields)
- [ ] Calendar dropdown shows only connected calendars
- [ ] Google Calendar events are created correctly
- [ ] Outlook Calendar events are created correctly
- [ ] Meeting links are added when checkbox selected
- [ ] Events appear in list after creation
- [ ] Form resets after successful creation
- [ ] Error handling works for API failures

---

## Summary

### Implementation Order (Recommended)
1. **Feature 1: Voice Reminders** - Simplest, builds on existing notification infrastructure
2. **Feature 2: Unified Calendar View** - Medium complexity, improves core UX
3. **Feature 4: Quick Event Creation** - Requires OAuth scope changes
4. **Feature 3: AI Meeting Insights** - Optional feature, can be done last

### Total Files to Modify/Create
- **Modify**: 9 files
- **Create**: 1 new file (`src/utils/ai-insights.js`)

### Dependencies
- Web Speech API (built-in browser)
- OpenAI API (optional, user-provided key)
- Updated OAuth scopes for calendar write access

### Privacy Considerations
- All API keys stored locally in browser storage
- No data sent to external servers (except user's own AI provider)
- OAuth tokens managed by Chrome identity API
