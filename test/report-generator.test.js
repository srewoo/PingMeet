/**
 * Tests for ReportGenerator
 * Verifies weekly report generation and HTML formatting
 */

import { jest } from '@jest/globals';
import { ReportGenerator } from '../src/utils/report-generator.js';
import { DurationTracker } from '../src/utils/duration-tracker.js';

describe('ReportGenerator', () => {
  let mockStats;
  let mockBreakdown;
  let mockPlatformBreakdown;

  beforeEach(() => {
    // Mock DurationTracker methods
    mockStats = {
      week: {
        minutes: 450,
        formatted: '7h 30m',
        meetingCount: 15,
        dailyAverage: 64,
      },
      averageMeetingLength: {
        minutes: 30,
        formatted: '30m',
      },
      longestMeeting: {
        minutes: 90,
        formatted: '1h 30m',
        title: 'Sprint Planning',
      },
    };

    mockBreakdown = {
      '2025-12-15': 60,
      '2025-12-16': 90,
      '2025-12-17': 45,
      '2025-12-18': 120,
      '2025-12-19': 75,
      '2025-12-20': 60,
      '2025-12-21': 0,
    };

    mockPlatformBreakdown = {
      'Google Meet': 240,
      'Zoom': 150,
      'Microsoft Teams': 60,
    };

    jest.spyOn(DurationTracker, 'getStatistics').mockResolvedValue(mockStats);
    jest.spyOn(DurationTracker, 'getWeeklyBreakdown').mockResolvedValue(mockBreakdown);
    jest.spyOn(DurationTracker, 'getPlatformBreakdown').mockResolvedValue(mockPlatformBreakdown);
    jest.spyOn(DurationTracker, 'formatDuration').mockImplementation(minutes => {
      if (minutes === 0) return '0m';
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      if (hours > 0) {
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
      }
      return `${mins}m`;
    });

    // Mock Chrome APIs
    global.chrome = {
      downloads: {
        download: jest.fn(() => Promise.resolve()),
      },
      tabs: {
        create: jest.fn(() => Promise.resolve({ id: 1 })),
      },
    };

    // Mock Blob and URL
    global.Blob = jest.fn((content, options) => ({
      content,
      options,
    }));
    global.URL = {
      createObjectURL: jest.fn(() => 'blob:mock-url'),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generateWeeklyReport', () => {
    test('should generate HTML report with all sections', async () => {
      const html = await ReportGenerator.generateWeeklyReport();

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Weekly Meeting Report');
      expect(html).toContain('Total Meeting Time');
      expect(html).toContain('Number of Meetings');
      expect(html).toContain('Daily Breakdown');
      expect(html).toContain('Meeting Platforms');
      expect(html).toContain('Insights');
    });

    test('should include statistics in report', async () => {
      const html = await ReportGenerator.generateWeeklyReport();

      expect(html).toContain('7h 30m'); // Total time
      expect(html).toContain('15'); // Meeting count
    });

    test('should call DurationTracker methods', async () => {
      await ReportGenerator.generateWeeklyReport();

      expect(DurationTracker.getStatistics).toHaveBeenCalled();
      expect(DurationTracker.getWeeklyBreakdown).toHaveBeenCalled();
      expect(DurationTracker.getPlatformBreakdown).toHaveBeenCalled();
    });

    test('should include CSS styles', async () => {
      const html = await ReportGenerator.generateWeeklyReport();

      expect(html).toContain('<style>');
      expect(html).toContain('.header');
      expect(html).toContain('.stat-card');
      expect(html).toContain('.bar-chart');
    });

    test('should include print functionality', async () => {
      const html = await ReportGenerator.generateWeeklyReport();

      expect(html).toContain('<script>');
      expect(html).toContain('window.print()');
    });
  });

  describe('renderDailyBreakdown', () => {
    test('should render bars for each day', () => {
      const html = ReportGenerator.renderDailyBreakdown(mockBreakdown);

      expect(html).toContain('bar-row');
      expect(html).toContain('bar-fill');
      expect(html).toContain('Mon'); // Monday
      expect(html).toContain('Tue'); // Tuesday
    });

    test('should calculate percentage correctly', () => {
      const html = ReportGenerator.renderDailyBreakdown(mockBreakdown);

      // Max is 120 minutes on Dec 18
      // 60 minutes should be 50% of 120
      expect(html).toContain('width: 50%'); // 60/120
      expect(html).toContain('width: 100%'); // 120/120
    });

    test('should handle zero minutes', () => {
      const breakdown = {
        '2025-12-21': 0,
      };

      const html = ReportGenerator.renderDailyBreakdown(breakdown);

      expect(html).toContain('0m');
      expect(html).toContain('width: 0%');
    });

    test('should format durations correctly', () => {
      const html = ReportGenerator.renderDailyBreakdown(mockBreakdown);

      expect(html).toContain('1h'); // 60 minutes
      expect(html).toContain('1h 30m'); // 90 minutes
      expect(html).toContain('2h'); // 120 minutes
    });
  });

  describe('renderPlatformBreakdown', () => {
    test('should render platform list', () => {
      const html = ReportGenerator.renderPlatformBreakdown(mockPlatformBreakdown);

      expect(html).toContain('Google Meet');
      expect(html).toContain('Zoom');
      expect(html).toContain('Microsoft Teams');
    });

    test('should sort platforms by usage', () => {
      const html = ReportGenerator.renderPlatformBreakdown(mockPlatformBreakdown);

      const googleIndex = html.indexOf('Google Meet');
      const zoomIndex = html.indexOf('Zoom');
      const teamsIndex = html.indexOf('Microsoft Teams');

      // Google Meet (240) should come before Zoom (150) before Teams (60)
      expect(googleIndex).toBeLessThan(zoomIndex);
      expect(zoomIndex).toBeLessThan(teamsIndex);
    });

    test('should handle empty platform data', () => {
      const html = ReportGenerator.renderPlatformBreakdown({});

      expect(html).toContain('No platform data available');
    });

    test('should format platform durations', () => {
      const html = ReportGenerator.renderPlatformBreakdown(mockPlatformBreakdown);

      expect(html).toContain('4h'); // 240 minutes
      expect(html).toContain('2h 30m'); // 150 minutes
      expect(html).toContain('1h'); // 60 minutes
    });
  });

  describe('generateInsights', () => {
    test('should identify busiest day', () => {
      const html = ReportGenerator.generateInsights(
        mockStats,
        mockBreakdown,
        mockPlatformBreakdown
      );

      expect(html).toContain('Busiest Day');
      expect(html).toContain('2h'); // 120 minutes on Dec 18
    });

    test('should identify lightest day', () => {
      const html = ReportGenerator.generateInsights(
        mockStats,
        mockBreakdown,
        mockPlatformBreakdown
      );

      expect(html).toContain('Lightest Day');
      expect(html).toContain('45m'); // Minimum non-zero
    });

    test('should identify top platform', () => {
      const html = ReportGenerator.generateInsights(
        mockStats,
        mockBreakdown,
        mockPlatformBreakdown
      );

      expect(html).toContain('Top Platform');
      expect(html).toContain('Google Meet');
    });

    test('should include longest meeting', () => {
      const html = ReportGenerator.generateInsights(
        mockStats,
        mockBreakdown,
        mockPlatformBreakdown
      );

      expect(html).toContain('Longest Meeting');
      expect(html).toContain('Sprint Planning');
      expect(html).toContain('1h 30m');
    });

    test('should include daily average', () => {
      const html = ReportGenerator.generateInsights(
        mockStats,
        mockBreakdown,
        mockPlatformBreakdown
      );

      expect(html).toContain('Daily Average');
      expect(html).toContain('per day');
    });

    test('should wrap insights in paragraph tags', () => {
      const html = ReportGenerator.generateInsights(
        mockStats,
        mockBreakdown,
        mockPlatformBreakdown
      );

      expect(html).toContain('<p>');
      expect(html).toContain('</p>');
      expect(html).toContain('<strong>');
    });
  });

  describe('formatDate', () => {
    test('should format date correctly', () => {
      const date = new Date('2025-12-18');
      const formatted = ReportGenerator.formatDate(date);

      expect(formatted).toMatch(/Dec/);
      expect(formatted).toMatch(/18/);
      expect(formatted).toMatch(/2025/);
    });

    test('should use short month format', () => {
      const date = new Date('2025-01-15');
      const formatted = ReportGenerator.formatDate(date);

      expect(formatted).toContain('Jan');
      expect(formatted).not.toContain('January');
    });
  });

  describe('formatDateTime', () => {
    test('should format datetime with time', () => {
      const date = new Date('2025-12-18T14:30:00');
      const formatted = ReportGenerator.formatDateTime(date);

      expect(formatted).toMatch(/Dec/);
      expect(formatted).toMatch(/18/);
      expect(formatted).toMatch(/2025/);
      expect(formatted).toMatch(/\d{1,2}:\d{2}/); // Time format
    });

    test('should include AM/PM', () => {
      const date = new Date('2025-12-18T14:30:00');
      const formatted = ReportGenerator.formatDateTime(date);

      expect(formatted).toMatch(/PM|AM/);
    });
  });

  describe('downloadReport', () => {
    test('should create blob with HTML content', async () => {
      await ReportGenerator.downloadReport();

      expect(global.Blob).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('<!DOCTYPE html>')]),
        { type: 'text/html' }
      );
    });

    test('should create object URL', async () => {
      await ReportGenerator.downloadReport();

      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });

    test('should trigger Chrome download', async () => {
      await ReportGenerator.downloadReport();

      expect(chrome.downloads.download).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'blob:mock-url',
          filename: expect.stringContaining('PingMeet-Weekly-Report'),
          saveAs: true,
        })
      );
    });

    test('should use correct filename format', async () => {
      await ReportGenerator.downloadReport();

      expect(chrome.downloads.download).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: expect.stringMatching(/PingMeet-Weekly-Report-\d{4}-\d{2}-\d{2}\.html/),
        })
      );
    });

    test('should handle download errors', async () => {
      chrome.downloads.download.mockRejectedValue(new Error('Download failed'));

      await expect(ReportGenerator.downloadReport()).rejects.toThrow('Download failed');
    });
  });

  describe('openReport', () => {
    test('should create blob with HTML content', async () => {
      await ReportGenerator.openReport();

      expect(global.Blob).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('<!DOCTYPE html>')]),
        { type: 'text/html' }
      );
    });

    test('should create object URL', async () => {
      await ReportGenerator.openReport();

      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });

    test('should open new tab with report', async () => {
      await ReportGenerator.openReport();

      expect(chrome.tabs.create).toHaveBeenCalledWith({
        url: 'blob:mock-url',
      });
    });

    test('should handle tab creation errors', async () => {
      chrome.tabs.create.mockRejectedValue(new Error('Tab creation failed'));

      await expect(ReportGenerator.openReport()).rejects.toThrow('Tab creation failed');
    });
  });

  describe('edge cases', () => {
    test('should handle empty stats', async () => {
      DurationTracker.getStatistics.mockResolvedValue({
        week: {
          minutes: 0,
          formatted: '0m',
          meetingCount: 0,
          dailyAverage: 0,
        },
        averageMeetingLength: {
          minutes: 0,
          formatted: '0m',
        },
        longestMeeting: {
          minutes: 0,
          formatted: '0m',
          title: '',
        },
      });

      const html = await ReportGenerator.generateWeeklyReport();

      expect(html).toContain('0m');
      expect(html).toContain('0');
    });

    test('should handle all zero breakdown', async () => {
      const zeroBreakdown = {
        '2025-12-15': 0,
        '2025-12-16': 0,
        '2025-12-17': 0,
      };

      const html = ReportGenerator.renderDailyBreakdown(zeroBreakdown);

      expect(html).toContain('width: 0%');
      expect(html).toContain('0m');
    });

    test('should handle single platform', async () => {
      const singlePlatform = { 'Google Meet': 120 };

      const html = ReportGenerator.renderPlatformBreakdown(singlePlatform);

      expect(html).toContain('Google Meet');
      expect(html).toContain('2h');
    });
  });
});

