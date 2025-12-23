/**
 * Tests for NotificationManager
 * These tests verify the attention mechanisms work correctly
 */

import { jest } from '@jest/globals';
import { NotificationManager } from '../src/background/notification-manager.js';

describe('NotificationManager', () => {
  // Mock event data
  const mockEvent = {
    id: 'test-event-123',
    title: 'Daily Standup',
    startTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    meetingLink: 'https://meet.google.com/abc-defg-hij',
  };

  beforeEach(() => {
    // Reset chrome API mocks before each test
    global.chrome = {
      notifications: {
        create: jest.fn((id, options, callback) => {
          if (callback) callback(id);
          return Promise.resolve(id);
        }),
      },
      windows: {
        create: jest.fn((options) => Promise.resolve({ id: 1 })),
        getCurrent: jest.fn(() => Promise.resolve({
          id: 1,
          left: 100,
          top: 100,
          width: 1920,
          height: 1080,
        })),
      },
      action: {
        setBadgeText: jest.fn(() => Promise.resolve()),
        setBadgeBackgroundColor: jest.fn(() => Promise.resolve()),
      },
      runtime: {
        getURL: jest.fn((path) => `chrome-extension://test/${path}`),
        getContexts: jest.fn(() => Promise.resolve([])),
        sendMessage: jest.fn(() => Promise.resolve()),
      },
      offscreen: {
        createDocument: jest.fn(() => Promise.resolve()),
      },
      tabs: {
        create: jest.fn(() => Promise.resolve({ id: 1 })),
      },
      storage: {
        sync: {
          get: jest.fn(() => Promise.resolve({
            settings: {
              reminderMinutes: 2,
              playSound: true,
              showPopup: true,
              autoOpen: false,
            }
          })),
        },
      },
    };
  });

  test('should create OS notification with correct priority', async () => {
    await NotificationManager.showOSNotification(mockEvent);

    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.stringContaining('pingmeet_'),
      expect.objectContaining({
        type: 'basic',
        title: expect.stringContaining('Meeting'),
        priority: 2,
      })
    );
  });

  test('should include Join button when meeting link exists', async () => {
    await NotificationManager.showOSNotification(mockEvent);

    const callArgs = chrome.notifications.create.mock.calls[0][1];
    expect(callArgs.buttons).toBeDefined();
    expect(callArgs.buttons[0].title).toContain('Join');
  });

  test('should create reminder window with correct parameters', async () => {
    await NotificationManager.showReminderWindow(mockEvent);

    expect(chrome.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'popup',
        width: 400,
        height: 280,
        focused: true,
      })
    );
  });

  test('should flash badge with correct colors', async () => {
    await NotificationManager.flashBadge();

    expect(chrome.action.setBadgeText).toHaveBeenCalled();
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalled();
  });

  test('should create offscreen document for audio playback', async () => {
    await NotificationManager.playSound();

    expect(chrome.offscreen.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        reasons: ['AUDIO_PLAYBACK'],
      })
    );
  });

  test('should trigger all mechanisms when configured', async () => {
    await NotificationManager.triggerAttention(mockEvent);

    expect(chrome.notifications.create).toHaveBeenCalled();
    expect(chrome.windows.create).toHaveBeenCalled();
  });
});

