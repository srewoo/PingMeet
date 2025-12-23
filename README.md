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

For PingMeet to work:

1. **Keep Google Calendar OR Outlook Calendar open** in at least one Chrome tab
   - Google Calendar: calendar.google.com
   - Outlook Calendar: outlook.office.com or outlook.live.com
2. **Allow notifications** when prompted by Chrome
3. **Allow sound** (optional, but recommended)

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

- **No OAuth Required** - Works by reading your open calendar tab
- **No Data Collection** - Everything stays local on your device
- **Minimal Permissions** - Only accesses calendar sites you use
- **No External Servers** - All processing happens in your browser
- **Works Offline** - Once events are loaded, reminders work without internet

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

- Extension requires Google Calendar tab to be open
- May need manual refresh if calendar is updated in another tab
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

