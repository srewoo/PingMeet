# 🔔 PingMeet

**Never miss a meeting again!**

PingMeet is a Chrome Extension that monitors your Google Calendar and alerts you 2 minutes before meetings start with multiple attention-grabbing mechanisms.

## ✨ Features

- 🔔 **OS Notifications** - Native system alerts
- 🪟 **Popup Window** - Countdown timer that brings Chrome forward
- 🔊 **Sound Alerts** - Audio notification to grab attention
- 📛 **Badge Flash** - Visual indicator on extension icon
- 🚀 **Quick Join** - One-click to join meetings (Google Meet, Zoom, Teams)

## 🚀 Installation

### From Source

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `PingMeet` directory

## 📋 Prerequisites

For PingMeet to work, do **either** of the following:

- **Recommended:** Click the extension icon and **Connect** your Google or
  Outlook account (one-click OAuth). Events then sync in the background — no tab
  needs to stay open. PingMeet keeps you signed in across browser restarts.
- **Or:** Keep a calendar tab open in Chrome and PingMeet will read from it.
  - Google Calendar: calendar.google.com
  - Outlook Calendar: outlook.office.com or outlook.live.com

Then:

1. **Allow notifications** when prompted by Chrome
2. **Allow sound** (optional, but recommended)

## 🎯 How It Works

1. Open **Google Calendar** or **Outlook Calendar** in a Chrome tab
2. PingMeet reads your upcoming meetings from the calendar
3. Schedules reminders for 2 minutes before each meeting
4. When the time comes, triggers multiple attention mechanisms to ensure you notice!

## 📅 Supported Calendars

- ✅ **Google Calendar** (calendar.google.com)
- ✅ **Outlook Calendar** (outlook.office.com, outlook.live.com)
- ✅ **Microsoft 365 Calendar**

## ⚙️ Settings

Click the extension icon to configure:

- **Reminder Time** - How many minutes before to alert (default: 2)
- **Play Sound** - Enable/disable audio alerts
- **Show Popup** - Enable/disable popup window
- **Auto-open Meeting** - Automatically open meeting link (optional)

## 🔒 Privacy & Security

PingMeet supports two ways to read your calendar:

1. **OAuth API access (recommended)** — Connect with Google or Outlook in one
   click. PingMeet authenticates via the official OAuth flow (`chrome.identity`),
   reads events directly from the Google Calendar / Microsoft Graph APIs, and
   refreshes tokens automatically so you stay connected.
2. **Open-tab reading (fallback)** — If you don't connect an account, PingMeet
   reads events from a Google/Outlook Calendar tab you keep open.

Security properties in both modes:

- **No Data Collection** - Everything stays local on your device
- **No External Servers** - PingMeet talks only to Google/Microsoft APIs; there
  is no PingMeet backend
- **Tokens stored securely** - Access tokens live in `chrome.storage.session`
  (in-memory, wiped on browser close) and never touch disk; only the refresh
  token and metadata persist locally so you stay signed in across restarts
- **Minimal scopes** - Calendar read/write and your email address, nothing more
- **Works Offline** - Once events are loaded, reminders fire without internet

## 🛠️ Development

```bash
# Install dependencies
npm install

# Run linter
npm run lint

# Format code
npm run format

# Run tests
npm test

# Create distribution package
npm run package
```

## 📁 Project Structure

```
PingMeet/
├── manifest.json              # Extension configuration
├── src/
│   ├── background/            # Service worker
│   ├── content/               # Calendar reader
│   ├── popup/                 # Extension popup UI
│   ├── reminder/              # Countdown window
│   ├── offscreen/             # Audio playback
│   └── utils/                 # Shared utilities
├── assets/                    # Icons and sounds
└── test/                      # Test files
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - feel free to use this project however you'd like!

## 🐛 Known Issues

- In open-tab (fallback) mode, a calendar tab must stay open; connecting an
  account via OAuth removes this requirement
- Chrome cannot force window focus on all operating systems

## 💡 Troubleshooting

**Not receiving notifications?**
- Check that Chrome has notification permissions
- Ensure your calendar tab (Google or Outlook) is open
- Verify the extension is enabled
- Try refreshing the calendar tab

**Sound not playing?**
- Check Chrome sound settings
- Ensure volume is not muted
- Try interacting with the page first (Chrome policy)

**Meeting not detected?**
- Ensure meeting has a clear start time
- Try refreshing the calendar tab
- Check that the meeting is within the next 24 hours
- For Outlook: Make sure you're on the calendar view (not mail)

## 🙏 Acknowledgments

Built with ❤️ to solve the universal problem of missing meetings while deep in work.

---

**Need help?** Open an issue or reach out!

