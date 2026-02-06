# Wix Label Generator - Desktop App

A desktop app for Linux/Windows that pulls orders from a Wix eCommerce store and generates color-coded printable labels.

## Features

- **Pull orders** from Wix with one click
- **Dual source mode**: Pull from Wix API or import orders from CSV
- **Color-coded labels**: Red border/bar for delivery, green for pickup
- **Location routing**: Temple vs Waco shown in delivery header bar
- **Order type badges**: Weight Loss Pack, Weekly Pack, Custom Order
- **Print directly** to any connected printer
- **Save as PDF** to any folder
- **Scheduled auto-pull** at configurable times with optional auto-print
- **Configurable pack contents**: Edit predefined items for Weight Loss and Weekly packs
- **Settings persist** between sessions

## Visual System

| Signal | Meaning |
|--------|---------|
| 🔴 Red border + red top bar | DELIVERY order |
| 🟢 Green border + green top bar | PICKUP order |
| Location in top-right of bar | Delivery destination (TEMPLE / WACO) |
| Big red uppercase name | Always at top of every label |
| Red address block | Only on delivery labels |
| Green "Customer will pick up" | Only on pickup labels |

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or later
- Linux or Windows

### Install & Run

```bash
# Clone or unzip the app folder
cd wix-label-app

# Install dependencies
npm install

# Run in development mode
npm start
```

### Build Artifacts

```bash
# Build Linux AppImage (default build script)
npm run build

# Explicit Linux build
npm run build:linux

# Build Windows installer (.exe) from environments configured for Windows cross-build
npm run build:win
```

Build output is written to the `dist/` folder.

## First-Time Setup

1. **Open the app** and go to the **Connection** tab in the sidebar
2. Choose **Order Source**:
   `Wix API`: enter **Wix API Key** and **Wix Site ID**  
   `CSV Import`: choose your exported `Orders.csv`
3. Set the time range (default: 24 hours)
4. Click **Save Connection**

### Configure Pack Items (Optional)

1. Go to the **Packs** tab
2. Update the **keywords** that identify each pack type in order names
3. Update the **predefined item lists** for Weight Loss Pack and Weekly Pack
4. Click **Save Pack Config**

### Set Up a Schedule (Optional)

1. Go to the **Schedule** tab
2. Toggle **Enable auto-pull** on
3. Add times (e.g., 06:00, 14:00)
4. Optionally toggle **Auto-print on pull** to send labels straight to the printer
5. Click **Save Schedule**

### Configure Printer (Optional)

1. Go to the **Printing** tab
2. Select your printer from the dropdown (or leave as System Default)
3. Set a default save folder for PDFs
4. Click **Save Print Settings**

## Usage

### Manual Pull
Click the big red **Pull Orders** button. Labels appear in the preview area. Then click **Print** or **Save PDF** in the sidebar.

### Scheduled Pull
If a schedule is configured, the app will automatically pull orders at the set times. If auto-print is enabled, labels go straight to the printer. The app needs to be running for schedules to work.

## Project Structure

```
wix-label-app/
  package.json          # Dependencies and build config
  scripts/
    start-electron.js   # Linux-friendly dev launcher
  src/
    main.js             # Electron main process (API, printing, scheduling)
    preload.js          # Secure bridge between main and renderer
    index.html          # App UI + label generation logic
```

## Troubleshooting

**"Please configure your Wix API Key and Site ID"**
Go to Settings > Connection and enter your credentials.

**No orders found**
Increase the pull range (hours) or check that there are recent orders in your Wix dashboard.

**Labels show wrong order type**
Go to Settings > Packs and update the detection keywords to match your actual Wix product names.

**Print fails silently**
Try saving as PDF first to confirm labels generate correctly. Check that the selected printer is online.

**Scheduled pulls not firing**
The app must be running (not minimized to tray). Check that the schedule is enabled and times are set.

**Linux startup error about `chrome-sandbox` / SUID helper**
By default, `npm start` now launches Electron with `--no-sandbox --in-process-gpu` on Linux for local dev compatibility.  
If you want sandbox enabled, set `ELECTRON_ENABLE_SANDBOX=1` before starting and ensure Electron's `chrome-sandbox` binary has correct owner/mode on your system.
