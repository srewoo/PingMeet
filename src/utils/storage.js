/**
 * Chrome storage utilities
 */

import { STORAGE_KEYS, DEFAULT_SETTINGS } from './constants.js';

export class StorageManager {
  // Flag for sync storage availability
  static useSyncStorage = true;

  /**
   * Get user settings with fallback to local storage
   * @returns {Promise<Object>} Settings object
   */
  static async getSettings() {
    try {
      if (this.useSyncStorage) {
        const result = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
        return result[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;
      }
    } catch (error) {
      console.warn('PingMeet: Sync storage unavailable, falling back to local storage', error);
      this.useSyncStorage = false;
    }

    // Fallback to local storage
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return result[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;
  }

  /**
   * Save user settings with fallback to local storage
   * @param {Object} settings - Settings to save
   */
  static async saveSettings(settings) {
    const settingsData = { [STORAGE_KEYS.SETTINGS]: { ...DEFAULT_SETTINGS, ...settings } };

    try {
      if (this.useSyncStorage) {
        await chrome.storage.sync.set(settingsData);
        return;
      }
    } catch (error) {
      console.warn('PingMeet: Sync storage unavailable, falling back to local storage', error);
      this.useSyncStorage = false;
    }

    // Fallback to local storage
    await chrome.storage.local.set(settingsData);
  }

  /**
   * Get all stored events
   * @returns {Promise<Array>} Array of event objects
   */
  static async getEvents() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.EVENTS);
    return result[STORAGE_KEYS.EVENTS] || [];
  }

  /**
   * Save events
   * @param {Array} events - Events to save
   */
  static async saveEvents(events) {
    await chrome.storage.local.set({ [STORAGE_KEYS.EVENTS]: events });
  }

  /**
   * Get a specific event by ID
   * @param {string} eventId - Event ID
   * @returns {Promise<Object|null>} Event object or null
   */
  static async getEvent(eventId) {
    const key = `${STORAGE_KEYS.ALARM_PREFIX}${eventId}`;
    const result = await chrome.storage.local.get(key);
    return result[key] || null;
  }

  /**
   * Save an event with alarm prefix
   * @param {string} eventId - Event ID
   * @param {Object} event - Event object
   */
  static async saveEvent(eventId, event) {
    const key = `${STORAGE_KEYS.ALARM_PREFIX}${eventId}`;
    await chrome.storage.local.set({ [key]: event });
  }

  /**
   * Remove an event
   * @param {string} eventId - Event ID
   */
  static async removeEvent(eventId) {
    const key = `${STORAGE_KEYS.ALARM_PREFIX}${eventId}`;
    await chrome.storage.local.remove(key);
  }

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

  /**
   * Clear all stored data (useful for debugging)
   */
  static async clearAll() {
    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();
  }
}
