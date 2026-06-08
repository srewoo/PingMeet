/**
 * Constants used throughout the PingMeet extension
 */

// Message types for communication between components
export const MESSAGE_TYPES = {
  CALENDAR_EVENTS: 'CALENDAR_EVENTS',
  CALENDAR_API_DATA: 'CALENDAR_API_DATA',
  PLAY_SOUND: 'PLAY_SOUND',
  SPEAK_REMINDER: 'SPEAK_REMINDER',
  SNOOZE: 'SNOOZE',
};

// Alarm name prefixes
export const ALARM_NAMES = {
  MEETING_PREFIX: 'meeting_',
};

// Storage keys
export const STORAGE_KEYS = {
  EVENTS: 'events',
  SETTINGS: 'settings',
  ALARM_PREFIX: 'alarm_',
};

// Default settings
export const DEFAULT_SETTINGS = {
  reminderMinutes: 2, // Minutes before meeting to alert
  playSound: true, // Play audio alert
  showPopup: true, // Show popup window
  autoOpen: false, // Auto-open meeting link
  soundVolume: 70, // 0-100
  dailySummary: true, // Daily summary at 10 AM
  voiceReminder: false, // Voice/spoken reminder toggle
  aiInsightsEnabled: false, // BETA: AI-powered insights (requires user API key)
  dndUntil: 0, // Epoch ms; suppress non-critical notifications until this time (0 = off)
  respectWorkingHours: false, // When true, suppress loud surfaces outside working hours
  workStartHour: 9, // 0-23, inclusive
  workEndHour: 18, // 0-23, exclusive
  workDays: [1, 2, 3, 4, 5], // 0=Sun, 1=Mon, ... 6=Sat
  smartReminderOffset: false, // When true, override reminderMinutes per meeting:
  //   external (cross-domain attendees) → 5 min
  //   internal multi-attendee            → 2 min
  //   solo / 1-on-1                       → 1 min
  dndSchedule: [], // Array of { days: [0..6], start: "HH:MM", end: "HH:MM" }.
  // When NOW falls in any window, loud surfaces are suppressed.
  // Example: [{ days: [0,6], start: "00:00", end: "23:59" }]
  // would silence weekends entirely.
  vipOrganizers: [], // Array of email addresses or domains. Meetings organized
  // by these get a 5-minute reminder regardless of other
  // settings (overrides smartReminderOffset/DND for popup).
};

// Meeting link patterns
export const MEETING_LINK_PATTERNS = {
  GOOGLE_MEET: /https?:\/\/meet\.google\.com\/[a-z-]+/i,
  ZOOM: /https?:\/\/([\w-]+\.)?zoom\.(us|com)\/(j|w|wc|s)\/\d+[^\s"<>]*/i, // Extended: j=join, w=webinar, wc=web client, s=share
  TEAMS: /https?:\/\/teams\.microsoft\.com\/l\/(meetup-join|meeting)[^\s"]*/i,
  WEBEX: /https?:\/\/([\w-]+\.)?webex\.com\/(meet|join)\/[^\s"]*/i,
  GOTOMEETING: /https?:\/\/(www\.)?gotomeeting\.com\/join\/\d+/i,
  SLACK: /https?:\/\/([\w-]+\.)?slack\.com\/huddle\/[^\s"]*/i,
  DISCORD: /https?:\/\/discord\.(gg|com)\/[^\s"]*/i,
  SKYPE: /https?:\/\/join\.skype\.com\/[^\s"]*/i,
  BLUEJEANS: /https?:\/\/bluejeans\.com\/\d+/i,
  JITSI: /https?:\/\/meet\.jit\.si\/[^\s"]*/i,
};

// Time constants
export const TIME = {
  ONE_MINUTE_MS: 60 * 1000,
  ONE_HOUR_MS: 60 * 60 * 1000,
  ONE_DAY_MS: 24 * 60 * 60 * 1000,
  SYNC_INTERVAL_SECONDS: 30,
};

// Badge colors
export const BADGE_COLORS = {
  DEFAULT: '#4285F4',
  URGENT: '#FF0000',
  WARNING: '#FF6600',
};

// Notification IDs
export const NOTIFICATION_PREFIX = 'pingmeet_';

// AI Configuration
export const AI_CONFIG = {
  STORAGE_KEY: 'aiApiKey',
  INSIGHTS_CACHE_KEY: 'aiInsightsCache',
  CACHE_DURATION_MS: 30 * 60 * 1000, // 30 minutes
  MAX_MEETINGS_FOR_CONCERN: 6, // Meetings per day threshold
  MIN_FOCUS_BLOCK_HOURS: 2, // Minimum gap to suggest focus block
  DEFAULT_WORK_START_HOUR: 9, // 9 AM
  DEFAULT_WORK_END_HOUR: 18, // 6 PM
};
