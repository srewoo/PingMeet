/**
 * AI Meeting Insights Service
 * Provides AI-powered analysis of meeting patterns
 * Requires user-provided API key (stored locally)
 */

import { AI_CONFIG } from './constants.js';

export class AIInsights {
  static API_ENDPOINTS = {
    openai: 'https://api.openai.com/v1/chat/completions',
    anthropic: 'https://api.anthropic.com/v1/messages',
    google: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
  };

  /**
   * Save AI configuration to local storage
   */
  static async saveConfig(config) {
    await chrome.storage.local.set({ [AI_CONFIG.STORAGE_KEY]: config });
  }

  /**
   * Get stored configuration
   */
  static async getConfig() {
    const data = await chrome.storage.local.get(AI_CONFIG.STORAGE_KEY);
    return data[AI_CONFIG.STORAGE_KEY] || null;
  }

  /**
   * Remove AI configuration
   */
  static async removeApiKey() {
    await chrome.storage.local.remove(AI_CONFIG.STORAGE_KEY);
    await chrome.storage.local.remove(AI_CONFIG.INSIGHTS_CACHE_KEY);
  }

  /**
   * Check if AI is configured
   */
  static async isConfigured() {
    const config = await this.getConfig();
    return !!config?.apiKey;
  }

  /**
   * Generate meeting insights using AI
   */
  static async generateInsights(events) {
    const config = await this.getConfig();
    if (!config?.apiKey) {
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

      // Call appropriate API based on provider
      let insights;
      if (config.provider === 'openai' || config.provider === 'custom') {
        insights = await this.callOpenAIAPI(config, meetingsSummary);
      } else if (config.provider === 'anthropic') {
        insights = await this.callAnthropicAPI(config, meetingsSummary);
      } else if (config.provider === 'google') {
        insights = await this.callGoogleAPI(config, meetingsSummary);
      } else {
        return { success: false, error: 'Unsupported provider' };
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
   * Call OpenAI-compatible API
   */
  static async callOpenAIAPI(config, meetingsSummary) {
    const endpoint = config.customEndpoint || this.API_ENDPOINTS.openai;
    const requestBody = {
      model: config.model,
      messages: [
        {
          role: 'system',
          content: `You are a productivity assistant analyzing meeting schedules. Provide brief, actionable insights about the user's meetings. Focus on: meeting load, potential conflicts, gaps for focus time, and patterns. Keep each insight to 1-2 sentences.

IMPORTANT: Return ONLY a valid JSON array (no markdown, no code blocks). Format:
[
  {"type": "warning", "text": "insight text here"},
  {"type": "suggestion", "text": "insight text here"},
  {"type": "info", "text": "insight text here"}
]

Type must be one of: warning, suggestion, info`
        },
        {
          role: 'user',
          content: `Analyze these meetings for today and provide insights:\n${meetingsSummary}`
        }
      ],
      max_tokens: 300
    };

    // Only add temperature if not a reasoning model
    if (!config.model.startsWith('o1') && config.temperature !== undefined) {
      requestBody.temperature = config.temperature;
    }

    // Try to use JSON mode if supported (GPT-4o, GPT-4-turbo)
    if (config.model.includes('gpt-4') && !config.model.startsWith('o1')) {
      requestBody.response_format = { type: "json_object" };
      // Modify prompt to ensure it asks for JSON object
      requestBody.messages[1].content = `Analyze these meetings for today and provide insights. Return a JSON object with an "insights" array:\n${meetingsSummary}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API error');
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    console.log('PingMeet: OpenAI raw response:', content);

    // If using JSON mode, content will be a JSON object with "insights" key
    let insights;
    if (config.model.includes('gpt-4') && !config.model.startsWith('o1')) {
      try {
        const jsonObj = JSON.parse(content);
        insights = jsonObj.insights || jsonObj;
      } catch (e) {
        insights = this.parseInsights(content);
      }
    } else {
      insights = this.parseInsights(content);
    }

    console.log('PingMeet: Parsed insights:', insights);

    return Array.isArray(insights) ? insights : this.parseInsights(content);
  }

  /**
   * Call Anthropic API
   */
  static async callAnthropicAPI(config, meetingsSummary) {
    const response = await fetch(this.API_ENDPOINTS.anthropic, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 300,
        temperature: config.temperature || 0.7,
        messages: [
          {
            role: 'user',
            content: `You are a productivity assistant analyzing meeting schedules. Provide brief, actionable insights about the user's meetings. Focus on: meeting load, potential conflicts, gaps for focus time, and patterns. Keep each insight to 1-2 sentences.

IMPORTANT: Return ONLY a valid JSON array (no markdown, no code blocks). Format:
[
  {"type": "warning", "text": "insight text here"},
  {"type": "suggestion", "text": "insight text here"},
  {"type": "info", "text": "insight text here"}
]

Type must be one of: warning, suggestion, info

Analyze these meetings for today and provide insights:\n${meetingsSummary}`
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API error');
    }

    const data = await response.json();
    const content = data.content[0]?.text;

    return this.parseInsights(content);
  }

  /**
   * Call Google Gemini API
   */
  static async callGoogleAPI(config, meetingsSummary) {
    const endpoint = this.API_ENDPOINTS.google.replace('{model}', config.model);
    const response = await fetch(`${endpoint}?key=${config.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are a productivity assistant analyzing meeting schedules. Provide brief, actionable insights about the user's meetings. Focus on: meeting load, potential conflicts, gaps for focus time, and patterns. Keep each insight to 1-2 sentences.

IMPORTANT: Return ONLY a valid JSON array (no markdown, no code blocks). Format:
[
  {"type": "warning", "text": "insight text here"},
  {"type": "suggestion", "text": "insight text here"},
  {"type": "info", "text": "insight text here"}
]

Type must be one of: warning, suggestion, info

Analyze these meetings for today and provide insights:\n${meetingsSummary}`
          }]
        }],
        generationConfig: {
          temperature: config.temperature || 0.7,
          maxOutputTokens: 300
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API error');
    }

    const data = await response.json();
    const content = data.candidates[0]?.content?.parts[0]?.text;

    return this.parseInsights(content);
  }

  /**
   * Parse AI response into insights array
   */
  static parseInsights(content) {
    if (!content) {
      console.warn('PingMeet: No content to parse');
      return [{ type: 'info', text: 'No insights available' }];
    }

    console.log('PingMeet: Parsing content:', content.substring(0, 100) + '...');

    // Remove markdown code blocks if present
    let cleanedContent = content.trim();

    // Remove ```json and ``` wrappers (more aggressive pattern)
    cleanedContent = cleanedContent.replace(/^```+\s*(?:json|JSON)?\s*\n?/gm, '');
    cleanedContent = cleanedContent.replace(/\n?```+\s*$/gm, '');
    cleanedContent = cleanedContent.trim();

    // Try to extract JSON array from content (in case there's extra text before/after)
    const jsonArrayMatch = cleanedContent.match(/\[[\s\S]*\]/);
    if (jsonArrayMatch) {
      cleanedContent = jsonArrayMatch[0];
    }

    console.log('PingMeet: Cleaned content:', cleanedContent.substring(0, 100) + '...');

    // Try parsing with progressively more aggressive fixes
    const parseAttempts = [
      // Attempt 1: Parse as-is
      () => JSON.parse(cleanedContent),

      // Attempt 2: Fix trailing commas before ] or }
      () => JSON.parse(cleanedContent.replace(/,\s*([\]}])/g, '$1')),

      // Attempt 3: Fix unescaped quotes in text values
      () => {
        // Replace problematic characters in text values
        let fixed = cleanedContent;
        // Fix smart quotes
        fixed = fixed.replace(/[\u201C\u201D]/g, '\\"');
        fixed = fixed.replace(/[\u2018\u2019]/g, "'");
        // Fix trailing commas
        fixed = fixed.replace(/,\s*([\]}])/g, '$1');
        return JSON.parse(fixed);
      },

      // Attempt 4: Extract individual objects and reconstruct array
      () => {
        const objects = [];
        // Match individual insight objects
        const objectPattern = /\{\s*"type"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"\s*\}/g;
        let match;
        while ((match = objectPattern.exec(cleanedContent)) !== null) {
          objects.push({ type: match[1], text: match[2].replace(/\\"/g, '"') });
        }
        if (objects.length > 0) return objects;
        throw new Error('No objects found');
      },

      // Attempt 5: More lenient object extraction (handles unescaped quotes in text)
      () => {
        const objects = [];
        // Split by }, and process each
        const parts = cleanedContent.split(/\}\s*,?\s*(?=\{|\])/);
        for (const part of parts) {
          const typeMatch = part.match(/"type"\s*:\s*"(warning|suggestion|info)"/);
          const textMatch = part.match(/"text"\s*:\s*"([\s\S]*?)(?:"\s*\}?$|(?=",?\s*"type"))/);
          if (typeMatch && textMatch) {
            objects.push({
              type: typeMatch[1],
              text: textMatch[1].replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
            });
          }
        }
        if (objects.length > 0) return objects;
        throw new Error('No objects found with lenient parsing');
      }
    ];

    for (let i = 0; i < parseAttempts.length; i++) {
      try {
        const parsed = parseAttempts[i]();

        // Ensure it's an array
        if (Array.isArray(parsed)) {
          console.log(`PingMeet: Successfully parsed array with ${parsed.length} insights (attempt ${i + 1})`);
          // Validate and clean each insight
          return parsed.filter(item => item && typeof item === 'object')
            .map(item => ({
              type: ['warning', 'suggestion', 'info'].includes(item.type) ? item.type : 'info',
              text: String(item.text || '').trim()
            }))
            .filter(item => item.text.length > 0);
        } else if (typeof parsed === 'object' && parsed !== null) {
          // If it's a single object or has insights key, handle it
          if (parsed.insights && Array.isArray(parsed.insights)) {
            console.log(`PingMeet: Extracted insights array from object (attempt ${i + 1})`);
            return parsed.insights;
          }
          console.log(`PingMeet: Wrapped single object into array (attempt ${i + 1})`);
          return [parsed];
        }
      } catch (e) {
        console.log(`PingMeet: Parse attempt ${i + 1} failed:`, e.message);
      }
    }

    console.error('PingMeet: All JSON parse attempts failed');
    console.log('PingMeet: Raw content that failed:', cleanedContent);

    // Final fallback: Try to extract meaningful insights from text
    const lines = content.split('\n').filter(line => {
      const trimmed = line.trim();
      // Skip empty lines and lines that look like JSON syntax
      return trimmed && !trimmed.match(/^[\[\]{},]*$/) && trimmed.length > 10;
    });

    if (lines.length > 0) {
      console.log('PingMeet: Using text fallback with', lines.length, 'lines');
      return lines.slice(0, 5).map(line => {
        let text = line
          .replace(/^[-•*]\s*/, '') // Remove bullet points
          .replace(/^["'{}\[\]]+/, '') // Remove leading JSON chars
          .replace(/["'{}\[\]]+$/, '') // Remove trailing JSON chars
          .replace(/^(type|text)\s*:\s*/i, '') // Remove field names
          .replace(/^(warning|suggestion|info)\s*[,:]?\s*/i, '') // Remove type values
          .trim();

        // Determine type from content
        let type = 'info';
        if (/warning|concern|careful|attention|alert/i.test(line)) type = 'warning';
        else if (/suggest|recommend|consider|try|could/i.test(line)) type = 'suggestion';

        return { type, text };
      }).filter(item => item.text.length > 5);
    }

    return [{ type: 'info', text: 'Unable to parse insights from AI response' }];
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
    const workStart = AI_CONFIG.DEFAULT_WORK_START_HOUR;
    const workEnd = AI_CONFIG.DEFAULT_WORK_END_HOUR;

    // Sort events by start time
    const sorted = [...events].sort((a, b) =>
      new Date(a.startTime) - new Date(b.startTime)
    );

    let currentTime = new Date();
    // If current time is before work start, use work start
    // If current time is after work start, use current time
    const currentHour = currentTime.getHours();
    if (currentHour < workStart) {
      currentTime.setHours(workStart, 0, 0, 0);
    } else if (currentHour >= workEnd) {
      // After work hours, no focus blocks
      return blocks;
    }

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
