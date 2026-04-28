/**
 * SettingsView — owns the settings panel render + save flow.
 *
 * Extracted from popup.js so the popup orchestrator stops growing every time
 * a new setting lands. Each new toggle / input is added here, in one place.
 *
 * Surface area on purpose:
 *   - render(settings)       populate every form input from the current settings
 *   - collect()              read every form input and return a settings patch
 *   - save()                 collect + persist + return success/error tuple
 *
 * The orchestrator (PopupUI) holds settings state and calls render/save —
 * SettingsView itself doesn't touch StorageManager so it stays test-friendly.
 */

import { StorageManager } from '../utils/storage.js';
import { logger } from '../utils/logger.js';

export class SettingsView {
  constructor() {
    // No DOM lookups in constructor — popup.html may not be parsed yet.
  }

  /**
   * Populate every settings form input from the supplied settings object.
   * Missing keys fall back to sensible defaults.
   */
  render(settings) {
    const s = settings || {};

    this.setValue('reminderMinutes', s.reminderMinutes ?? 2);
    this.setChecked('playSound', s.playSound !== false);
    this.setChecked('voiceReminder', !!s.voiceReminder);
    this.setChecked('showPopup', s.showPopup !== false);
    this.setChecked('autoOpen', !!s.autoOpen);
    this.setChecked('dailySummary', s.dailySummary !== false);

    // Smart behaviour group
    this.setChecked('smartReminderOffset', !!s.smartReminderOffset);
    this.setChecked('respectWorkingHours', !!s.respectWorkingHours);
    this.setValue('workStartHour', Number.isFinite(s.workStartHour) ? s.workStartHour : 9);
    this.setValue('workEndHour', Number.isFinite(s.workEndHour) ? s.workEndHour : 18);

    const workDays = Array.isArray(s.workDays) ? s.workDays : [1, 2, 3, 4, 5];
    document.querySelectorAll('#workDaysRow input[type="checkbox"][data-day]').forEach(cb => {
      const day = parseInt(cb.dataset.day, 10);
      cb.checked = workDays.includes(day);
    });

    // VIP organizers — newline-separated for easy editing
    const vipList = Array.isArray(s.vipOrganizers) ? s.vipOrganizers : [];
    this.setValue('vipOrganizers', vipList.join('\n'));

    // DND schedule — pretty JSON for hand editing
    const schedule = Array.isArray(s.dndSchedule) ? s.dndSchedule : [];
    this.setValue('dndSchedule', schedule.length ? JSON.stringify(schedule, null, 2) : '');
  }

  /**
   * Read every form input and return a settings patch. Performs validation —
   * malformed dndSchedule JSON falls back to existing schedule (returned via
   * the second tuple item) so a typo doesn't wipe the user's config.
   *
   * @param {Object} previousSettings - used as fallback for invalid inputs
   * @returns {{ settings: Object, errors: string[] }}
   */
  collect(previousSettings = {}) {
    const errors = [];

    const reminderMinutes = parseInt(this.getValue('reminderMinutes'), 10);
    const workStartHour = this.parseHour(this.getValue('workStartHour'), 9);
    const workEndHour = this.parseHour(this.getValue('workEndHour'), 18);

    const workDays = Array.from(
      document.querySelectorAll('#workDaysRow input[type="checkbox"][data-day]:checked')
    ).map(cb => parseInt(cb.dataset.day, 10));

    // VIP list: split by newline, trim, drop empties
    const vipOrganizers = this.getValue('vipOrganizers')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    // DND schedule: parse JSON, accept array of {days, start, end}
    let dndSchedule = previousSettings.dndSchedule || [];
    const scheduleRaw = this.getValue('dndSchedule').trim();
    if (scheduleRaw) {
      try {
        const parsed = JSON.parse(scheduleRaw);
        if (Array.isArray(parsed) && parsed.every(this.isValidDndWindow)) {
          dndSchedule = parsed;
        } else {
          errors.push('DND schedule: must be a JSON array of {days, start, end}.');
        }
      } catch (e) {
        errors.push(`DND schedule: invalid JSON (${e.message}).`);
      }
    } else {
      dndSchedule = [];
    }

    const settings = {
      reminderMinutes: Number.isFinite(reminderMinutes) ? reminderMinutes : 2,
      playSound: this.getChecked('playSound'),
      voiceReminder: this.getChecked('voiceReminder'),
      showPopup: this.getChecked('showPopup'),
      autoOpen: this.getChecked('autoOpen'),
      dailySummary: this.getChecked('dailySummary'),

      smartReminderOffset: this.getChecked('smartReminderOffset'),
      respectWorkingHours: this.getChecked('respectWorkingHours'),
      workStartHour,
      workEndHour,
      workDays: workDays.length ? workDays : [1, 2, 3, 4, 5],
      vipOrganizers,
      dndSchedule,

      // Preserve transient fields the form doesn't own.
      dndUntil: previousSettings.dndUntil || 0,
      aiInsightsEnabled: !!previousSettings.aiInsightsEnabled,
      soundVolume: previousSettings.soundVolume ?? 70,
    };

    return { settings, errors };
  }

  /**
   * Collect + persist. Returns { ok, settings, errors }.
   */
  async save(previousSettings) {
    const { settings, errors } = this.collect(previousSettings);
    if (errors.length) {
      return { ok: false, settings: previousSettings, errors };
    }
    try {
      await StorageManager.saveSettings(settings);
      return { ok: true, settings, errors: [] };
    } catch (error) {
      logger.error('Failed to save settings', error);
      return { ok: false, settings: previousSettings, errors: [error.message || 'Save failed'] };
    }
  }

  // ==================== helpers ====================

  setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }
  getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }
  setChecked(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = !!checked;
  }
  getChecked(id) {
    const el = document.getElementById(id);
    return el ? !!el.checked : false;
  }
  parseHour(raw, fallback) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    if (n < 0 || n > 23) return fallback;
    return n;
  }
  isValidDndWindow(w) {
    if (!w || typeof w !== 'object') return false;
    if (!Array.isArray(w.days)) return false;
    if (!w.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) return false;
    if (typeof w.start !== 'string' || !/^\d{1,2}:\d{2}$/.test(w.start)) return false;
    if (typeof w.end !== 'string' || !/^\d{1,2}:\d{2}$/.test(w.end)) return false;
    return true;
  }
}
