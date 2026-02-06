const { app, BrowserWindow, ipcMain, dialog, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Linux environments (VMs/containers) frequently lack a usable GPU stack.
if (process.platform === 'linux') {
  app.disableHardwareAcceleration();
}

// ============================================================
// SETTINGS PERSISTENCE
// ============================================================
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_SETTINGS = {
  orderSourceMode: 'wix',
  csvPath: '',
  wixApiKey: '',
  wixSiteId: '',
  savePath: app.getPath('documents'),
  autoSchedule: false,
  scheduleEntries: [{ day: 'Monday', time: '06:00' }],
  autoPrint: false,
  // Order type detection keywords
  weightLossKeywords: ['weight loss', 'wl pack', 'weightloss'],
  weeklyPackKeywords: ['weekly pack', 'weekly meal'],
  backOnTrackKeywords: ['back on track', 'back on track box', 'back on track bundle'],
  // Predefined pack items
  weightLossItems: [
    'Breakfast Protein Shake',
    'Grilled Chicken Salad (Lunch)',
    'Lean Turkey Wrap (Lunch)',
    'Baked Salmon & Veggies (Dinner)',
    'Grilled Chicken Breast & Rice (Dinner)',
    'Protein Snack Bar x2',
    'Green Smoothie x2'
  ],
  weeklyPackItems: [
    'Monday Meal',
    'Tuesday Meal',
    'Wednesday Meal',
    'Thursday Meal',
    'Friday Meal',
    'Weekend Brunch',
    'Snack Assortment'
  ],
  backOnTrackItems: [
    'Back On Track Bundle',
    'Snackle Box'
  ],
  // Time range for pulling orders (days)
  pullRangeDays: 7
};

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const merged = { ...DEFAULT_SETTINGS, ...parsed };

      // Backward compatibility: convert old hours-based range.
      if (!Number.isFinite(Number(merged.pullRangeDays)) || Number(merged.pullRangeDays) <= 0) {
        const oldHours = Number(parsed.pullRangeHours);
        if (Number.isFinite(oldHours) && oldHours > 0) {
          merged.pullRangeDays = Math.max(1, Math.ceil(oldHours / 24));
        }
      }

      // Backward compatibility: convert old scheduleTimes array to weekday-aware entries.
      if (
        (!Array.isArray(parsed.scheduleEntries) || !parsed.scheduleEntries.length) &&
        Array.isArray(parsed.scheduleTimes) &&
        parsed.scheduleTimes.length
      ) {
        merged.scheduleEntries = parsed.scheduleTimes
          .filter(Boolean)
          .map((time) => ({ day: 'Monday', time: String(time) }));
      }

      return merged;
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

let settings = loadSettings();
let mainWindow = null;
let scheduleTimers = [];

// ============================================================
// WINDOW CREATION
// ============================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Wix Label Generator',
    backgroundColor: '#f9fafb'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  setupSchedule();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============================================================
// WIX API
// ============================================================
function fetchWixOrders(apiKey, siteId, rangeDays) {
  return new Promise(async (resolve, reject) => {
    try {
      const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();
      const allOrders = [];
      let nextCursor = null;

      do {
        const search = {
          filter: {
            createdDate: { $gte: since },
            status: { $ne: 'CANCELED' }
          },
          sort: [{ fieldName: 'createdDate', order: 'DESC' }],
          cursorPaging: { limit: 100 }
        };
        if (nextCursor) {
          search.cursorPaging.next = nextCursor;
        }

        const body = JSON.stringify({ search });

        const options = {
          hostname: 'www.wixapis.com',
          path: '/ecom/v1/orders/search',
          method: 'POST',
          headers: {
            'Authorization': apiKey,
            'wix-site-id': siteId,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        };

        const parsed = await new Promise((pageResolve, pageReject) => {
          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const page = JSON.parse(data || '{}');
                if (res.statusCode >= 400) {
                  pageReject(new Error(`Wix API error ${res.statusCode}: ${JSON.stringify(page)}`));
                } else {
                  pageResolve(page);
                }
              } catch (e) {
                pageReject(new Error(`Failed to parse response: ${e.message}`));
              }
            });
          });

          req.on('error', pageReject);
          req.write(body);
          req.end();
        });

        allOrders.push(...(parsed.orders || []));

        // Wix docs commonly return metadata.pagingMetadata.nextCursor.
        // Keep compatibility with alternate metadata shapes.
        nextCursor =
          parsed?.metadata?.pagingMetadata?.nextCursor ||
          parsed?.metadata?.nextPaging?.token ||
          null;
      } while (nextCursor);

      resolve(allOrders);
    } catch (error) {
      reject(error);
    }
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function cleanCsvValue(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/^"+|"+$/g, '')
    .trim();
}

function parseAmount(value) {
  const cleaned = cleanCsvValue(value).replace(/[^0-9.-]/g, '');
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function formatAmount(value) {
  return (Number.isFinite(value) ? value : 0).toFixed(2);
}

function inferOrderTypeFromText(text) {
  const haystack = String(text || '').toLowerCase();
  const wlKeywords = settings.weightLossKeywords || ['weight loss'];
  const wpKeywords = settings.weeklyPackKeywords || ['weekly pack'];
  const botKeywords = settings.backOnTrackKeywords || ['back on track'];

  if (wlKeywords.some((kw) => haystack.includes(String(kw || '').toLowerCase()))) {
    return 'WEIGHT_LOSS_PACK';
  }
  if (wpKeywords.some((kw) => haystack.includes(String(kw || '').toLowerCase()))) {
    return 'WEEKLY_PACK';
  }
  if (botKeywords.some((kw) => haystack.includes(String(kw || '').toLowerCase()))) {
    return 'BACK_ON_TRACK_PACK';
  }
  return 'CUSTOM';
}

function inferOrderTypeFromCsvRecord(record) {
  const textType = inferOrderTypeFromText(
    `${record['Additional checkout info'] || ''} ${record['Note from customer'] || ''} ${record['Delivery method'] || ''}`
  );
  if (textType !== 'CUSTOM') return textType;

  const total = parseAmount(record['Total']);
  const shipping = parseAmount(record['Shipping rate']);
  const net = total - shipping;
  const qty = Math.max(1, Number.parseInt(record['Total order quantity'] || '1', 10) || 1);

  // CSV exports may omit line-item names. Use known single-item pack price signatures.
  if (qty === 1 && Math.abs(net - 135) < 0.01) return 'WEEKLY_PACK';
  if (qty === 1 && Math.abs(net - 150) < 0.01) return 'WEIGHT_LOSS_PACK';

  return 'CUSTOM';
}

function extractCsvItems(record, fallbackQty) {
  const candidateFields = [
    'Line items',
    'Line item',
    'Items',
    'Products',
    'Product name',
    'Product names',
    'Item name',
    'Item names',
    'Additional checkout info',
    'Note from customer'
  ];

  for (const field of candidateFields) {
    const raw = cleanCsvValue(record[field] || '');
    if (!raw) continue;
    if (raw.length < 2) continue;

    const parts = raw
      .split(/\r?\n| \| |;|•/g)
      .map((s) => cleanCsvValue(s))
      .filter(Boolean);

    if (parts.length > 1 || /x\s*\d+|\d+\s*x|qty|pack|meal|chicken|salmon|turkey/i.test(raw)) {
      return parts.map((name) => ({ name, option: '', qty: 1 }));
    }
  }

  return [{
    name: 'Order Items (summary from CSV export)',
    option: '',
    qty: fallbackQty
  }];
}

function parseCsvOrders(csvPath, rangeDays) {
  if (!csvPath) {
    throw new Error('Please choose a CSV file in Settings > Connection.');
  }
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const csvText = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(csvText);
  if (!rows.length) return [];

  const headers = rows[0].map(cleanCsvValue);
  const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c || '').trim().length > 0));
  const since = Date.now() - rangeDays * 24 * 60 * 60 * 1000;

  const mapped = dataRows.map((cols, idx) => {
    const record = {};
    headers.forEach((header, colIdx) => {
      record[header] = cleanCsvValue(cols[colIdx] || '');
    });

    const orderNumber = record['Order number'] || `CSV-${idx + 1}`;
    const createdRaw = `${record['Date created'] || ''} ${record['Time'] || ''}`.trim();
    const createdMillis = Date.parse(createdRaw);
    const createdDate = Number.isFinite(createdMillis) ? new Date(createdMillis).toISOString() : new Date().toISOString();

    const deliveryMethodRaw = (record['Delivery method'] || '').toLowerCase();
    const isPickup = deliveryMethodRaw.includes('pickup');
    const deliveryMethod = isPickup ? 'PICKUP' : 'DELIVERY';

    const deliveryCity = record['Delivery city'] || '';
    const deliveryState = record['Delivery state'] || '';
    const deliveryZip = cleanCsvValue(record['Delivery zip/postal code'] || '');
    const deliveryCountry = record['Delivery country'] || '';
    const deliveryAddress = record['Delivery address'] || '';
    const deliveryStateShort = deliveryState.includes('-') ? deliveryState.split('-').pop() : deliveryState;
    const locationHint = `${deliveryCity} ${deliveryAddress} ${record['Shipping label'] || ''}`.toLowerCase();
    let location = '';
    if (!isPickup) {
      if (locationHint.includes('temple')) location = 'TEMPLE';
      else if (locationHint.includes('waco')) location = 'WACO';
      else location = deliveryCity ? deliveryCity.toUpperCase() : 'UNKNOWN';
    }

    const customerName = record['Recipient name'] || record['Billing name'] || 'Unknown';
    const customerEmail = record['Contact email'] || '';
    const customerPhone = record['Recipient phone'] || record['Billing phone'] || '';
    const orderType = inferOrderTypeFromCsvRecord(record);

    const totalItemCount = Math.max(1, Number.parseInt(record['Total order quantity'] || '1', 10) || 1);
    let items = [];
    if (orderType === 'WEIGHT_LOSS_PACK') {
      items = (settings.weightLossItems || []).map((name) => ({ name, option: '', qty: 1 }));
    } else if (orderType === 'WEEKLY_PACK') {
      items = (settings.weeklyPackItems || []).map((name) => ({ name, option: '', qty: 1 }));
    } else if (orderType === 'BACK_ON_TRACK_PACK') {
      items = (settings.backOnTrackItems || []).map((name) => ({ name, option: '', qty: 1 }));
    } else {
      items = extractCsvItems(record, totalItemCount);
    }

    const shipping = parseAmount(record['Shipping rate']);
    const tax = parseAmount(record['Total tax']);
    const total = parseAmount(record['Total'] || record['Net amount']);
    const subtotal = Math.max(total - shipping - tax, 0);

    const formattedAddress = !isPickup
      ? [
          deliveryAddress,
          [deliveryCity, deliveryStateShort, deliveryZip].filter(Boolean).join(', '),
          deliveryCountry
        ].filter(Boolean).join('\n')
      : '';

    return {
      orderId: `csv-${orderNumber}`,
      orderNumber,
      createdDate,
      customerName,
      customerEmail,
      customerPhone,
      customerId: '',
      deliveryMethod,
      location,
      orderType,
      items,
      totalItemCount: items.reduce((sum, item) => sum + (item.qty || 0), 0),
      formattedAddress,
      deliveryNote: record['Delivery time'] || '',
      subtotal: formatAmount(subtotal),
      shipping: formatAmount(shipping),
      tax: formatAmount(tax),
      total: formatAmount(total)
    };
  });

  return mapped
    .filter((order) => Date.parse(order.createdDate) >= since)
    .sort((a, b) => Date.parse(b.createdDate) - Date.parse(a.createdDate));
}

// ============================================================
// ORDER PARSING
// ============================================================
function parseOrders(rawOrders) {
  return rawOrders.map(order => {
    // Delivery method
    const shippingInfo = order.shippingInfo || {};
    const logistics = shippingInfo.logistics || {};
    const isPickup = !!logistics.pickupDetails;
    const deliveryMethod = isPickup ? 'PICKUP' : 'DELIVERY';

    // Location
    let location = '';
    if (!isPickup) {
      const address = logistics.shippingDestination?.address ||
                      shippingInfo.shippingDestination?.address || {};
      const city = (address.city || '').toLowerCase();
      const fullAddr = JSON.stringify(address).toLowerCase();
      const shippingTitle = (
        shippingInfo.title || shippingInfo.shippingRegion ||
        logistics.deliveryOption || ''
      ).toString().toLowerCase();
      const combined = city + ' ' + fullAddr + ' ' + shippingTitle;

      if (combined.includes('temple')) location = 'TEMPLE';
      else if (combined.includes('waco')) location = 'WACO';
      else location = address.city ? address.city.toUpperCase() : 'UNKNOWN';
    }

    // Order type
    const lineItems = order.lineItems || [];
    const itemNames = lineItems.map(item => {
      return (item.name || item.productName?.translated ||
              item.productName?.original || item.catalogReference?.catalogItemName || '').toLowerCase();
    });
    const allItemsStr = itemNames.join(' | ');

    let orderType = 'CUSTOM';
    const wlKeywords = settings.weightLossKeywords || ['weight loss'];
    const wpKeywords = settings.weeklyPackKeywords || ['weekly pack'];
    const botKeywords = settings.backOnTrackKeywords || ['back on track'];

    if (wlKeywords.some(kw => allItemsStr.includes(kw.toLowerCase()))) {
      orderType = 'WEIGHT_LOSS_PACK';
    } else if (wpKeywords.some(kw => allItemsStr.includes(kw.toLowerCase()))) {
      orderType = 'WEEKLY_PACK';
    } else if (botKeywords.some(kw => allItemsStr.includes(kw.toLowerCase()))) {
      orderType = 'BACK_ON_TRACK_PACK';
    }

    // Items
    let items = [];
    if (orderType === 'WEIGHT_LOSS_PACK') {
      items = (settings.weightLossItems || []).map(name => ({ name, option: '', qty: 1 }));
    } else if (orderType === 'WEEKLY_PACK') {
      items = (settings.weeklyPackItems || []).map(name => ({ name, option: '', qty: 1 }));
    } else if (orderType === 'BACK_ON_TRACK_PACK') {
      items = (settings.backOnTrackItems || []).map(name => ({ name, option: '', qty: 1 }));
    } else {
      items = lineItems.map(item => {
        const name = item.name || item.productName?.translated || item.productName?.original || 'Unknown Item';
        const options = (item.descriptionLines || item.options || [])
          .map(opt => {
            if (typeof opt === 'string') return opt;
            if (opt.name && opt.selection) return `${opt.name}: ${opt.selection}`;
            if (opt.plainText) return opt.plainText.translated || opt.plainText.original || '';
            if (opt.colorInfo) return opt.colorInfo.translated || opt.colorInfo.original || '';
            return '';
          })
          .filter(Boolean)
          .join(', ');
        return { name, option: options, qty: item.quantity || 1 };
      });
    }

    // Customer info
    const buyer = order.buyerInfo || {};
    const billingContact = order.billingInfo?.contactDetails || {};
    const shippingContact = logistics.shippingDestination?.contactDetails || {};
    const address = logistics.shippingDestination?.address ||
                    shippingInfo.shippingDestination?.address || {};

    const customerName = billingContact.firstName
      ? `${billingContact.firstName} ${billingContact.lastName || ''}`.trim()
      : `${shippingContact.firstName || ''} ${shippingContact.lastName || ''}`.trim() || 'Unknown';

    const customerEmail = buyer.email || billingContact.email || '';
    const customerPhone = billingContact.phone || shippingContact.phone || '';
    const customerId = buyer.memberId || buyer.visitorId || buyer.id || '';

    // Address
    let formattedAddress = '';
    if (!isPickup && address) {
      const parts = [
        address.addressLine1 || address.streetAddress?.value || '',
        address.addressLine2 || '',
        [address.city, address.subdivision, address.postalCode].filter(Boolean).join(', '),
        address.country || ''
      ].filter(Boolean);
      formattedAddress = parts.join('\n');
    }

    const deliveryNote = shippingInfo.title || logistics.deliveryOption || '';

    // Pricing
    const pricing = order.priceSummary || {};
    const subtotal = pricing.subtotal?.amount || '0.00';
    const shipping = pricing.shipping?.amount || '0.00';
    const tax = pricing.tax?.amount || '0.00';
    const total = pricing.total?.amount || '0.00';

    const totalItemCount = items.reduce((sum, item) => sum + item.qty, 0);

    return {
      orderId: order.id || '',
      orderNumber: order.number || '',
      createdDate: order.createdDate || new Date().toISOString(),
      customerName, customerEmail, customerPhone, customerId,
      deliveryMethod, location, orderType,
      items, totalItemCount, formattedAddress, deliveryNote,
      subtotal, shipping, tax, total
    };
  });
}

// ============================================================
// SCHEDULING
// ============================================================
function setupSchedule() {
  // Clear existing timers
  scheduleTimers.forEach(t => clearInterval(t));
  scheduleTimers = [];

  if (!settings.autoSchedule || !settings.scheduleEntries?.length) return;

  // Check every 30 seconds if we've hit a scheduled time
  const checker = setInterval(() => {
    const now = new Date();
    const currentDay = WEEKDAY_NAMES[now.getDay()];
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentSeconds = now.getSeconds();

    // Only trigger within the first 30 seconds of the minute to avoid double-fires
    const hasMatch = (settings.scheduleEntries || []).some((entry) => {
      if (!entry || !entry.day || !entry.time) return false;
      return entry.day === currentDay && entry.time === currentTime;
    });

    if (currentSeconds < 30 && hasMatch) {
      console.log(`Scheduled pull triggered at ${currentTime}`);
      if (mainWindow) {
        mainWindow.webContents.send('scheduled-pull');
      }
    }
  }, 30000);

  scheduleTimers.push(checker);
}

// ============================================================
// IPC HANDLERS
// ============================================================

// Pull orders
ipcMain.handle('pull-orders', async () => {
  if (settings.orderSourceMode === 'csv') {
    return parseCsvOrders(settings.csvPath, settings.pullRangeDays);
  }

  if (!settings.wixApiKey || !settings.wixSiteId) {
    throw new Error('Please configure your Wix API Key and Site ID in Settings, or switch source mode to CSV.');
  }
  const raw = await fetchWixOrders(settings.wixApiKey, settings.wixSiteId, settings.pullRangeDays);
  return parseOrders(raw);
});

// Get settings
ipcMain.handle('get-settings', () => settings);

// Save settings
ipcMain.handle('save-settings', (event, newSettings) => {
  settings = { ...DEFAULT_SETTINGS, ...settings, ...newSettings };
  saveSettings(settings);
  setupSchedule();
  return settings;
});

// Get printer list
ipcMain.handle('get-printers', async () => {
  if (!mainWindow) return [];
  const printers = await mainWindow.webContents.getPrintersAsync();
  return printers.map(p => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: p.isDefault
  }));
});

// Print labels
ipcMain.handle('print-labels', async (event, { html, printerName }) => {
  // Create a hidden window for printing
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true }
  });

  await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  // Wait a moment for rendering
  await new Promise(r => setTimeout(r, 1000));

  return new Promise((resolve, reject) => {
    const printOptions = {
      silent: false,
      printBackground: true,
      margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    };

    printWindow.webContents.print(printOptions, (success, failureReason) => {
      printWindow.close();
      if (success) resolve(true);
      else reject(new Error(failureReason || 'Print failed'));
    });
  });
});

// Save as PDF
ipcMain.handle('save-pdf', async (event, { html, suggestedName }) => {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true }
  });

  await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise(r => setTimeout(r, 1000));

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(settings.savePath, suggestedName || 'order-labels.pdf'),
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });

  if (canceled || !filePath) {
    printWindow.close();
    return null;
  }

  const data = await printWindow.webContents.printToPDF({
    pageSize: 'Letter',
    printBackground: true,
    margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
  });

  fs.writeFileSync(filePath, data);
  printWindow.close();

  // Update default save path
  settings.savePath = path.dirname(filePath);
  saveSettings(settings);

  return filePath;
});

// Auto-save PDF (for scheduled pulls)
ipcMain.handle('auto-save-pdf', async (event, { html, fileName }) => {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true }
  });

  await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise(r => setTimeout(r, 1000));

  const filePath = path.join(settings.savePath, fileName);

  const data = await printWindow.webContents.printToPDF({
    pageSize: 'Letter',
    printBackground: true,
    margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
  });

  fs.writeFileSync(filePath, data);
  printWindow.close();

  return filePath;
});

// Choose directory
ipcMain.handle('choose-directory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: settings.savePath
  });
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
});

ipcMain.handle('choose-csv-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
});

ipcMain.handle('get-logo-data-url', async () => {
  const logoCandidates = [
    path.join(app.getAppPath(), 'assets', 'fuelup-logo-tagline.avif'),
    path.join(process.cwd(), 'assets', 'fuelup-logo-tagline.avif'),
    path.join(process.cwd(), 'BBD18 Fuel Up Logo Tagline.avif')
  ];

  for (const logoPath of logoCandidates) {
    if (!fs.existsSync(logoPath)) continue;
    const data = fs.readFileSync(logoPath);
    return `data:image/avif;base64,${data.toString('base64')}`;
  }
  return null;
});

ipcMain.handle('open-path', async (event, targetPath) => {
  if (!targetPath) return false;
  const result = await shell.openPath(targetPath);
  return result === '';
});
