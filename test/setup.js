/**
 * Test setup - Mock Chrome APIs
 */

// Import jest from @jest/globals for ESM support
import { jest } from '@jest/globals';

// Mock chrome global
global.chrome = {
  runtime: {
    id: 'test-extension-id',
    getURL: jest.fn(path => `chrome-extension://test/${path}`),
    sendMessage: jest.fn((message, callback) => {
      if (callback) callback({ received: true });
      return Promise.resolve({ received: true });
    }),
    onMessage: {
      addListener: jest.fn(),
    },
    getContexts: jest.fn(() => Promise.resolve([])),
    lastError: null,
  },
  storage: {
    local: {
      get: jest.fn(() => Promise.resolve({})),
      set: jest.fn(() => Promise.resolve()),
      remove: jest.fn(() => Promise.resolve()),
      clear: jest.fn(() => Promise.resolve()),
    },
    sync: {
      get: jest.fn(() => Promise.resolve({})),
      set: jest.fn(() => Promise.resolve()),
      clear: jest.fn(() => Promise.resolve()),
    },
  },
  notifications: {
    create: jest.fn((id, options, callback) => {
      if (callback) callback(id);
      return Promise.resolve(id);
    }),
    clear: jest.fn(() => Promise.resolve()),
    onClicked: {
      addListener: jest.fn(),
    },
    onButtonClicked: {
      addListener: jest.fn(),
    },
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    get: jest.fn(),
    getAll: jest.fn(() => Promise.resolve([])),
    onAlarm: {
      addListener: jest.fn(),
    },
  },
  action: {
    setBadgeText: jest.fn(() => Promise.resolve()),
    setBadgeBackgroundColor: jest.fn(() => Promise.resolve()),
  },
  tabs: {
    create: jest.fn(() => Promise.resolve({ id: 1 })),
    query: jest.fn(() => Promise.resolve([])),
  },
  windows: {
    create: jest.fn(() => Promise.resolve({ id: 1 })),
    getCurrent: jest.fn(() => Promise.resolve({
      id: 1,
      left: 100,
      top: 100,
      width: 1920,
      height: 1080,
    })),
  },
  offscreen: {
    createDocument: jest.fn(() => Promise.resolve()),
  },
};

// Mock screen global
global.screen = {
  width: 1920,
  height: 1080,
};

// Mock Audio
global.Audio = jest.fn().mockImplementation(() => ({
  play: jest.fn(() => Promise.resolve()),
  pause: jest.fn(),
  volume: 1,
}));

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({}),
    clone: () => ({
      json: () => Promise.resolve({}),
    }),
  })
);

// Mock setInterval and setTimeout for tests
global.setInterval = jest.fn((fn, delay) => {
  return 1; // Return a fake timer ID
});

global.clearInterval = jest.fn();

// Use real setTimeout but make it immediate for tests
global.setTimeout = jest.fn((fn, delay) => {
  const id = 1;
  // Execute immediately in tests to avoid timeouts
  Promise.resolve().then(() => fn());
  return id;
});

global.clearTimeout = jest.fn();

