/**
 * Tests for StorageManager
 * Verifies Chrome storage interactions work correctly
 */

import { jest } from '@jest/globals';
import { StorageManager } from '../src/utils/storage.js';
import { DEFAULT_SETTINGS } from '../src/utils/constants.js';

describe('StorageManager', () => {
  beforeEach(() => {
    // Mock Chrome storage API
    global.chrome = {
      storage: {
        sync: {
          get: jest.fn((keys) => Promise.resolve({})),
          set: jest.fn(() => Promise.resolve()),
          clear: jest.fn(() => Promise.resolve()),
        },
        local: {
          get: jest.fn((keys) => Promise.resolve({})),
          set: jest.fn(() => Promise.resolve()),
          remove: jest.fn(() => Promise.resolve()),
          clear: jest.fn(() => Promise.resolve()),
        },
      },
    };
  });

  test('should return default settings when none are stored', async () => {
    const settings = await StorageManager.getSettings();
    
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  test('should save settings to sync storage', async () => {
    const newSettings = {
      reminderMinutes: 5,
      playSound: false,
    };

    await StorageManager.saveSettings(newSettings);

    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining(newSettings),
      })
    );
  });

  test('should merge new settings with defaults', async () => {
    const partialSettings = { reminderMinutes: 5 };

    await StorageManager.saveSettings(partialSettings);

    const savedSettings = chrome.storage.sync.set.mock.calls[0][0].settings;
    expect(savedSettings.playSound).toBe(DEFAULT_SETTINGS.playSound);
    expect(savedSettings.reminderMinutes).toBe(5);
  });

  test('should save and retrieve events', async () => {
    const events = [
      {
        id: 'event1',
        title: 'Meeting 1',
        startTime: new Date().toISOString(),
      },
    ];

    await StorageManager.saveEvents(events);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ events })
    );
  });

  test('should save event with alarm prefix', async () => {
    const event = {
      id: 'event1',
      title: 'Test Meeting',
      startTime: new Date().toISOString(),
    };

    await StorageManager.saveEvent('event1', event);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        alarm_event1: event,
      })
    );
  });

  test('should remove event by ID', async () => {
    await StorageManager.removeEvent('event1');

    expect(chrome.storage.local.remove).toHaveBeenCalledWith('alarm_event1');
  });

  test('should clear all storage', async () => {
    await StorageManager.clearAll();

    expect(chrome.storage.local.clear).toHaveBeenCalled();
    expect(chrome.storage.sync.clear).toHaveBeenCalled();
  });
});

