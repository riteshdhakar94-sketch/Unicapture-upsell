/**
 * UniCapture Prospect Dashboard — Google Sheets Auto-Sync
 * ─────────────────────────────────────────────────────────
 * Already deployed at:
 * https://script.google.com/macros/s/AKfycbxycMPxcJszbsnjYhPHfq7U1vJXGIk3UEr9K0vZzFjdiL2VQOnttXt8xMIRAz05m0_r/exec
 *
 * To redeploy after edits: Deploy → Manage deployments → Edit → New version
 */

var SHEET_ID  = '13Y3g1VeeQXjcRG-u48LQaLQ3ZqixYFeprOEMMOsJPKI';
var SHEET_TAB = 'Pitched Sellers';

var HEADERS = [
  'Tenant Code',
  'Seller Name',
  'Segment',
  'Prospect Score',
  'Priority',
  'Monthly Return Rate',
  'Monthly Shipments',
  'Monthly Return Volume',
  'Avg Order Value (₹)',
  'Myntra Shipments',
  'Flipkart Shipments',
  'None Trace Facilities',
  'Item/SKU Trace Facilities',
  'VMS Readiness',
  'Pitched Date',
  'Synced At'
];

function getOrCreateSheet() {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TAB);
    // Header row
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    var hdrRange = sheet.getRange(1, 1, 1, HEADERS.length);
    hdrRange.setFontWeight('bold')
            .setBackground('#1E3A5F')
            .setFontColor('#ffffff')
            .setFontSize(10);
    sheet.setFrozenRows(1);
    // Column widths
    sheet.setColumnWidth(1, 160);   // Tenant Code
    sheet.setColumnWidth(2, 160);   // Seller Name
    sheet.setColumnWidth(3, 90);    // Segment
    sheet.setColumnWidth(4, 90);    // Score
    sheet.setColumnWidth(5, 70);    // Priority
    sheet.setColumnWidth(6, 110);   // Return Rate
    sheet.setColumnWidth(7, 120);   // Shipments
    sheet.setColumnWidth(8, 130);   // Return Vol
    sheet.setColumnWidth(9, 120);   // AOV
    sheet.setColumnWidth(10, 120);  // Myntra
    sheet.setColumnWidth(11, 120);  // Flipkart
    sheet.setColumnWidth(12, 130);  // None Trace
    sheet.setColumnWidth(13, 140);  // Item/SKU Trace
    sheet.setColumnWidth(14, 110);  // VMS Readiness
    sheet.setColumnWidth(15, 100);  // Pitched Date
    sheet.setColumnWidth(16, 160);  // Synced At
  }
  return sheet;
}

function alreadyExists(sheet, code) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(code).toLowerCase()) return true;
  }
  return false;
}

function doPost(e) {
  try {
    // Works with both application/json and text/plain content-type
    var raw = (e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var payload = JSON.parse(raw);
    var sheet   = getOrCreateSheet();
    var now     = new Date().toISOString();

    if (payload.action === 'pitched' && payload.seller) {
      var s = payload.seller;

      // Deduplicate — once pitched, don't overwrite
      if (alreadyExists(sheet, s.code)) {
        return respond({ status: 'exists', code: s.code });
      }

      var row = [
        s.code        || '',
        s.name        || s.code || '',
        s.segment     || '',
        s.score       || '',
        s.priority    || '',
        s.return_rate || '',
        s.shipments   || '',
        s.return_vol  || '',
        s.aov         || '',
        s.myntra      || '',
        s.flipkart    || '',
        s.none_trace  || '',
        s.item_trace  || '',
        s.vms         || '',
        s.date        || now.slice(0, 10),
        now
      ];

      sheet.appendRow(row);

      // Alternate row shading
      var lastRow = sheet.getLastRow();
      if (lastRow % 2 === 0) {
        sheet.getRange(lastRow, 1, 1, HEADERS.length).setBackground('#F8FAFC');
      }

      return respond({ status: 'ok', code: s.code });
    }

    return respond({ status: 'unknown_action' });

  } catch (err) {
    return respond({ status: 'error', message: err.toString() });
  }
}

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  // ── Write path (called from dashboard via GET to avoid CORS/redirect issues) ──
  if (params.action === 'pitched') {
    try {
      var sheet = getOrCreateSheet();
      var now   = new Date().toISOString();
      var s     = params;   // URL params map directly to field names

      if (alreadyExists(sheet, s.code)) {
        return respond({ status: 'exists', code: s.code });
      }

      var row = [
        s.code        || '',
        s.name        || s.code || '',
        s.segment     || '',
        s.score       || '',
        s.priority    || '',
        s.return_rate || '',
        s.shipments   || '',
        s.return_vol  || '',
        s.aov         || '',
        s.myntra      || '',
        s.flipkart    || '',
        s.none_trace  || '',
        s.item_trace  || '',
        s.vms         || '',
        s.date        || now.slice(0, 10),
        now
      ];
      sheet.appendRow(row);

      var lastRow = sheet.getLastRow();
      if (lastRow % 2 === 0) {
        sheet.getRange(lastRow, 1, 1, HEADERS.length).setBackground('#F8FAFC');
      }
      return respond({ status: 'ok', code: s.code });

    } catch (err) {
      return respond({ status: 'error', message: err.toString() });
    }
  }

  // ── List path — returns all pitched codes so dashboard can sync shared state ──
  // Called via JSONP: ?action=list&callback=__ucPitchedSync
  if (params.action === 'list') {
    try {
      var sheet = getOrCreateSheet();
      var data  = sheet.getDataRange().getValues();
      var codes = [];
      for (var i = 1; i < data.length; i++) {
        if (data[i][0]) codes.push(String(data[i][0]));
      }
      return jsonpRespond(params.callback, { status: 'ok', codes: codes });
    } catch (err) {
      return jsonpRespond(params.callback, { status: 'error', message: err.toString() });
    }
  }

  // ── Login log ──
  if (params.action === 'logLogin') {
    try {
      var ss        = SpreadsheetApp.openById(SHEET_ID);
      var logSheet  = ss.getSheetByName('Login Log');
      if (!logSheet) {
        logSheet = ss.insertSheet('Login Log');
        logSheet.appendRow(['Timestamp (IST)', 'Email', 'Browser / Device']);
        logSheet.getRange('1:1').setFontWeight('bold');
        logSheet.setFrozenRows(1);
      }
      // Convert UTC ISO string to IST (UTC+5:30)
      var now     = new Date();
      var istMs   = now.getTime() + (5.5 * 3600 * 1000);
      var istDate = new Date(istMs);
      var istStr  = Utilities.formatDate(istDate, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
      logSheet.appendRow([
        istStr,
        params.email || '',
        (params.ua   || '').substring(0, 150)
      ]);
      return jsonpRespond(params.callback, { status: 'ok' });
    } catch (err) {
      return jsonpRespond(params.callback, { status: 'error', message: err.toString() });
    }
  }

  // ── Health check (default) — open this URL in a browser tab to confirm deployment is live ──
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_TAB);
  var rowCount = sheet ? Math.max(sheet.getLastRow() - 1, 0) : 0;
  return jsonpRespond(params.callback, {
    status:  'UniCapture Sync Active',
    sheet:   SHEET_ID,
    tab:     SHEET_TAB,
    synced:  rowCount
  });
}

// ── Check which account is running the script ──
function checkRunningAs() {
  Logger.log('Running as: ' + Session.getActiveUser().getEmail());
  Logger.log('Effective user: ' + Session.getEffectiveUser().getEmail());
}

// ── Manual test — run from Apps Script editor to verify sheet write ──
function testWrite() {
  var fakeEvent = {
    postData: {
      contents: JSON.stringify({
        action: 'pitched',
        seller: {
          code: 'test-seller', name: 'Test Seller', segment: 'Enterprise',
          score: '500', priority: 'Hot', return_rate: '15%',
          shipments: '20000', return_vol: '3000', aov: '₹500',
          myntra: '5000', flipkart: '3000', none_trace: '2',
          item_trace: '3', vms: 'Mixed VMS', date: new Date().toISOString().slice(0,10)
        }
      })
    }
  };
  var result = doPost(fakeEvent);
  Logger.log(result.getContent());
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Wraps response as JSONP if callback param is present, else plain JSON.
// JSONP is used by the dashboard to read data cross-origin without CORS issues.
function jsonpRespond(callback, obj) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
