# Windows Testing Guide

Use **PowerShell** (recommended) or **Command Prompt**. Both work.

## 1) Install prerequisites
- Install Node.js LTS from: https://nodejs.org/
- Verify install:

```powershell
node -v
npm -v
```

## 2) Get the app

### Option A: Git clone
```powershell
git clone https://github.com/am-will/wix-label-app.git
cd wix-label-app
```

### Option B: ZIP download
- Download ZIP from GitHub -> Extract -> open folder in terminal.

## 3) Install dependencies
```powershell
npm install
```

## 4) Run app for testing
```powershell
npm start
```

## 5) Build Windows installer (.exe)
```powershell
npm run build:win
```
- Installer output will be in `dist/`.

## Notes
- SmartScreen warning can appear for unsigned apps. For testing: **More info** -> **Run anyway**.
- If `npm` command is not found, close/reopen terminal after Node install.
- If printer dialog/save fails, first test with CSV import mode and Save PDF.

## PowerShell vs CMD
- **PowerShell is recommended** for copy/paste and modern defaults.
- CMD works too; use the same commands.
