/**
 * Notification Manager - Handles all attention-grabbing mechanisms
 * OS notifications, popup windows, sounds, and badge flashing
 */

import { StorageManager } from '../utils/storage.js';
import { MESSAGE_TYPES, NOTIFICATION_PREFIX, BADGE_COLORS } from '../utils/constants.js';

export class NotificationManager {
  /**
   * Trigger all configured attention mechanisms
   * @param {Object} event - Meeting event object
   */
  static async triggerAttention(event) {
    const settings = await StorageManager.getSettings();

    console.log(`PingMeet: Triggering attention for "${event.title}"`);

    // 1. OS Notification (always)
    await this.showOSNotification(event);

    // 2. Popup Window (brings Chrome forward!)
    if (settings.showPopup !== false) {
      await this.showReminderWindow(event);
    }

    // 3. Sound
    if (settings.playSound !== false) {
      await this.playSound();
    }

    // 4. Voice Reminder
    if (settings.voiceReminder) {
      await this.speakReminder(event, settings);
    }

    // 5. Flash Badge
    await this.flashBadge(settings.reminderMinutes || 2);

    // 6. Auto-open meeting (optional)
    if (settings.autoOpen && event.meetingLink) {
      setTimeout(async () => {
        try {
          await chrome.tabs.create({ url: event.meetingLink, active: true });
        } catch (error) {
          console.error('PingMeet: Auto-open error', error);
        }
      }, 500); // Small delay to ensure other mechanisms show first
    }
  }

  /**
   * Show OS notification
   * @param {Object} event - Meeting event object
   * @returns {Promise<string>} Notification ID
   */
  static async showOSNotification(event) {
    const notificationId = `${NOTIFICATION_PREFIX}${event.id}`;
    const settings = await StorageManager.getSettings();

    // Create dynamic title based on reminder time
    const reminderMinutes = settings.reminderMinutes || 2;
    let title = '⏰ Meeting starting ';
    if (reminderMinutes === 1) {
      title += 'in 1 minute!';
    } else if (reminderMinutes < 60) {
      title += `in ${reminderMinutes} minutes!`;
    } else {
      const hours = Math.floor(reminderMinutes / 60);
      const mins = reminderMinutes % 60;
      title += mins > 0 ? `in ${hours}h ${mins}m!` : `in ${hours} hour${hours > 1 ? 's' : ''}!`;
    }

    const notificationOptions = {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
      title: title,
      message: event.title || 'Untitled Meeting',
      priority: 2,
      requireInteraction: true,
    };

    // Add "Join Now" button if meeting link exists
    if (event.meetingLink) {
      notificationOptions.buttons = [{ title: '🚀 Join Now' }];
    }

    await chrome.notifications.create(notificationId, notificationOptions);

    console.log(`PingMeet: OS notification created for "${event.title}"`);
    return notificationId;
  }

  /**
   * Show reminder popup window (key mechanism for bringing Chrome forward)
   * @param {Object} event - Meeting event object
   */
  static async showReminderWindow(event) {
    const eventData = encodeURIComponent(JSON.stringify(event));

    try {
      // Get all displays to determine optimal positioning
      const windowConfig = await this.calculateOptimalWindowPosition();

      await chrome.windows.create({
        url: chrome.runtime.getURL(`src/reminder/reminder.html?event=${eventData}`),
        type: 'popup',
        width: 480,
        height: 620,
        focused: true,
        top: windowConfig.top,
        left: windowConfig.left,
      });

      console.log(`PingMeet: Reminder window opened for "${event.title}"`);
    } catch (error) {
      console.error('PingMeet: Error creating reminder window', error);
    }
  }

  /**
   * Calculate optimal window position based on available displays
   * @returns {Promise<{top: number, left: number}>}
   */
  static async calculateOptimalWindowPosition() {
    try {
      // Get the current focused window
      const currentWindow = await chrome.windows.getCurrent();

      if (currentWindow && currentWindow.top !== undefined && currentWindow.left !== undefined) {
        // Position relative to current window (centered)
        const windowWidth = 400;
        const windowHeight = 280;

        const left = currentWindow.left + Math.floor((currentWindow.width - windowWidth) / 2);
        const top = currentWindow.top + Math.floor((currentWindow.height - windowHeight) / 3);

        return {
          top: Math.max(50, top), // Ensure minimum distance from top
          left: Math.max(50, left), // Ensure minimum distance from left
        };
      }
    } catch (error) {
      console.warn('PingMeet: Could not determine optimal window position', error);
    }

    // Fallback to safe default position
    return { top: 100, left: 100 };
  }

  /**
   * Play sound alert via offscreen document
   */
  static async playSound() {
    try {
      // Ensure offscreen document exists
      await this.ensureOffscreenDocument();

      // Wait a bit for offscreen document to initialize
      await this.sleep(100);

      // Send message to play sound with error handling
      try {
        await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.PLAY_SOUND });
        console.log('PingMeet: Sound alert triggered');
      } catch (msgError) {
        // If message fails, the offscreen document might not be ready
        console.warn('PingMeet: Failed to send message to offscreen document:', msgError.message);

        // Try recreating the offscreen document and retry once
        await this.recreateOffscreenDocument();
        await this.sleep(150);
        await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.PLAY_SOUND });
        console.log('PingMeet: Sound alert triggered (retry succeeded)');
      }
    } catch (error) {
      console.error('PingMeet: Error playing sound', error);
    }
  }

  /**
   * Ensure offscreen document exists (create if needed)
   */
  static async ensureOffscreenDocument() {
    // Check if offscreen document already exists
    const offscreenUrl = chrome.runtime.getURL('src/offscreen/offscreen.html');

    try {
      // Try to check existing contexts (Chrome 116+)
      if (chrome.runtime.getContexts) {
        const existingContexts = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT'],
          documentUrls: [offscreenUrl]
        });

        if (existingContexts.length > 0) {
          return; // Already exists
        }
      }
    } catch (e) {
      // getContexts not available, try creating anyway
    }

    // Try to create the offscreen document
    try {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play meeting reminder sound',
      });
    } catch (error) {
      // If error is "already exists", that's fine - ignore it
      if (!error.message?.includes('single offscreen document')) {
        throw error;
      }
    }
  }

  /**
   * Recreate offscreen document (close and create new)
   * Used when the existing document is unresponsive
   */
  static async recreateOffscreenDocument() {
    try {
      // Close existing offscreen document
      await chrome.offscreen.closeDocument();
      console.log('PingMeet: Closed existing offscreen document');
    } catch (error) {
      // Ignore error if no document exists
      console.log('PingMeet: No offscreen document to close');
    }

    // Create new offscreen document
    try {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play meeting reminder sound',
      });
      console.log('PingMeet: Created new offscreen document');
    } catch (error) {
      console.error('PingMeet: Error creating offscreen document:', error);
      throw error;
    }
  }

  /**
   * Flash the extension badge for attention
   * @param {number} reminderMinutes - Minutes until meeting
   */
  static async flashBadge(reminderMinutes = 2) {
    const colors = [
      BADGE_COLORS.URGENT,
      BADGE_COLORS.WARNING,
      BADGE_COLORS.URGENT,
      BADGE_COLORS.WARNING,
      BADGE_COLORS.URGENT,
    ];

    try {
      for (let i = 0; i < colors.length; i++) {
        await chrome.action.setBadgeText({ text: '⏰' });
        await chrome.action.setBadgeBackgroundColor({ color: colors[i] });
        await this.sleep(300);
      }

      // Keep the urgent badge with actual reminder time
      await chrome.action.setBadgeText({ text: `${reminderMinutes}m` });
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.URGENT });

      console.log('PingMeet: Badge flashed');
    } catch (error) {
      console.error('PingMeet: Error flashing badge', error);
    }
  }

  /**
   * Speak meeting reminder via Web Speech API
   * @param {Object} event - Meeting event object
   * @param {Object} settings - User settings
   */
  static async speakReminder(event, settings) {
    try {
      // Ensure offscreen document exists
      await this.ensureOffscreenDocument();

      // Wait a bit for offscreen document to initialize
      await this.sleep(100);

      // Calculate minutes until meeting
      const minutesUntil = Math.round((new Date(event.startTime) - new Date()) / 60000);

      // Create speech text
      const speechText = `Meeting reminder: ${event.title} starts in ${minutesUntil} minute${minutesUntil !== 1 ? 's' : ''}.`;

      // Send message to speak with error handling
      try {
        await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.SPEAK_REMINDER,
          text: speechText
        });
        console.log('PingMeet: Voice reminder triggered');
      } catch (msgError) {
        // If message fails, the offscreen document might not be ready
        console.warn('PingMeet: Failed to send message to offscreen document:', msgError.message);

        // Try recreating the offscreen document and retry once
        await this.recreateOffscreenDocument();
        await this.sleep(150);
        await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.SPEAK_REMINDER,
          text: speechText
        });
        console.log('PingMeet: Voice reminder triggered (retry succeeded)');
      }
    } catch (error) {
      console.error('PingMeet: Error speaking reminder', error);
    }
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise}
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
