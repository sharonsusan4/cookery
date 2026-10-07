/**
 * Recipe app backend. Lives inside Mom's Google Sheet (Extensions > Apps Script)
 * and is deployed as a web app. The sheet stays the only copy of the data:
 * this script just reads rows and adds/updates them.
 *
 * Column positions are found by header name, so the columns can be moved
 * around in the sheet without breaking anything.
 */

// The tab in "Recepies 2.0". If it's renamed, the script uses the first tab instead.
var SHEET_NAME = 'Sheet1';

var HEADERS = {
  name: 'Recipe Name',
  category: 'Category',
  status: 'Status',
  link: 'Recipe Link',
  source: 'Source',
  notes: 'Notes'
};

var STATUSES = ['To Try', 'Tried - Loved', 'Tried - Okay', 'Tried - Skip Next Time', 'Not Interested'];

// Fields the app is allowed to change on an existing row.
var EDITABLE = ['name', 'category', 'status', 'notes'];

/**
 * Run this once from the Apps Script editor (select "setup" > Run).
 * It adds the Notes column if it's missing and creates the secret key
 * the app needs. The key is printed in the execution log.
 */
function setup() {
  var sheet = getSheet_();
  var cols = columns_(sheet);
  if (!cols.notes) {
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue(HEADERS.notes);
  }
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('APP_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('APP_KEY', key);
  }
  Logger.log('App key: ' + key);
  return key;
}

function doGet(e) {
  return handle_(e.parameter || {});
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  return handle_(body);
}

function handle_(req) {
  try {
    var key = PropertiesService.getScriptProperties().getProperty('APP_KEY');
    if (!key || req.key !== key) {
      return json_({ ok: false, error: 'Not allowed' });
    }
    switch (req.action) {
      case 'list': return json_(listRecipes_());
      case 'add': return json_(addRecipe_(req.recipe || {}, req.force));
      case 'update': return json_(updateRecipe_(req.row, req.link, req.fields || {}));
      case 'meta': return json_(linkMeta_(req.url));
      default: return json_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function listRecipes_() {
  var sheet = getSheet_();
  var cols = columns_(sheet);
  var values = sheet.getDataRange().getValues();
  var recipes = [];
  for (var i = 1; i < values.length; i++) {
    var r = rowToRecipe_(values[i], cols, i + 1);
    if (r.link || r.name) recipes.push(r);
  }
  return { ok: true, recipes: recipes, hasNotes: !!cols.notes };
}

function addRecipe_(recipe, force) {
  var link = clean_(recipe.link);
  if (!link) return { ok: false, error: 'Missing link' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    var cols = columns_(sheet);
    if (!force) {
      var existing = findByLink_(sheet, cols, link);
      if (existing) return { ok: true, duplicate: true, recipe: existing };
    }
    var fields = {
      name: clean_(recipe.name),
      category: clean_(recipe.category),
      status: STATUSES.indexOf(recipe.status) >= 0 ? recipe.status : 'To Try',
      link: link,
      source: sourceFor(link),
      notes: clean_(recipe.notes)
    };
    var width = sheet.getLastColumn();
    var row = [];
    for (var c = 0; c < width; c++) row.push('');
    Object.keys(fields).forEach(function (f) {
      if (cols[f]) row[cols[f] - 1] = safe_(fields[f]);
    });
    sheet.appendRow(row);
    var rowNum = sheet.getLastRow();
    return { ok: true, recipe: rowToRecipe_(row, cols, rowNum) };
  } finally {
    lock.releaseLock();
  }
}

function updateRecipe_(row, link, fields) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    var cols = columns_(sheet);
    // Rows can shift if the sheet is sorted or rows are inserted, so make
    // sure the row still holds the same link before writing to it.
    var target = Number(row);
    var ok = target >= 2 && target <= sheet.getLastRow() &&
      String(sheet.getRange(target, cols.link).getValue()).trim() === String(link).trim();
    if (!ok) {
      var found = findByLink_(sheet, cols, link);
      if (!found) return { ok: false, error: 'Recipe not found' };
      target = found.row;
    }
    EDITABLE.forEach(function (f) {
      if (!(f in fields) || !cols[f]) return;
      var v = clean_(fields[f]);
      if (f === 'status' && STATUSES.indexOf(v) < 0) return;
      sheet.getRange(target, cols[f]).setValue(safe_(v));
    });
    var width = sheet.getLastColumn();
    var values = sheet.getRange(target, 1, 1, width).getValues()[0];
    return { ok: true, recipe: rowToRecipe_(values, cols, target) };
  } finally {
    lock.releaseLock();
  }
}

/** Title and thumbnail for a link. Only YouTube allows this without a login. */
function linkMeta_(url) {
  var id = youTubeId(url);
  if (!id) return { ok: true, title: '', thumbnail: '' };
  var title = '';
  try {
    var res = UrlFetchApp.fetch(
      'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() === 200) title = JSON.parse(res.getContentText()).title || '';
  } catch (err) {
    // No title is fine; she can type the name.
  }
  return { ok: true, title: title, thumbnail: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' };
}

// ---- helpers ----

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

/** Map of field -> 1-based column number, looked up from the header row. */
function columns_(sheet) {
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var cols = {};
  Object.keys(HEADERS).forEach(function (f) {
    for (var c = 0; c < header.length; c++) {
      if (String(header[c]).trim().toLowerCase() === HEADERS[f].toLowerCase()) {
        cols[f] = c + 1;
        break;
      }
    }
  });
  if (!cols.link) throw new Error('Could not find the "' + HEADERS.link + '" column');
  return cols;
}

function rowToRecipe_(values, cols, rowNum) {
  var r = { row: rowNum };
  Object.keys(HEADERS).forEach(function (f) {
    r[f] = cols[f] ? String(values[cols[f] - 1] == null ? '' : values[cols[f] - 1]) : '';
  });
  return r;
}

function findByLink_(sheet, cols, link) {
  var key = linkKey(link);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var other = String(values[i][cols.link - 1] || '');
    if (other && linkKey(other) === key) return rowToRecipe_(values[i], cols, i + 1);
  }
  return null;
}

function clean_(v) {
  return v == null ? '' : String(v).trim();
}

/** Stop text that starts with "=" or "+" from being treated as a formula. */
function safe_(v) {
  return /^[=+]/.test(v) ? "'" + v : v;
}

// These three are also used by the app (copied in app/links.js), so keep them in sync.

function sourceFor(link) {
  var l = String(link).toLowerCase();
  if (/youtube\.com|youtu\.be/.test(l)) return 'YouTube';
  if (/instagram\.com/.test(l)) return 'Instagram';
  if (/facebook\.com|fb\.watch/.test(l)) return 'Facebook';
  return 'Other';
}

function youTubeId(link) {
  var m = String(link).match(/(?:youtu\.be\/|youtube\.com\/(?:shorts\/|watch\?(?:.*&)?v=|embed\/|live\/))([\w-]{11})/i);
  return m ? m[1] : '';
}

/** A comparable form of a link, so the same video shared twice is spotted. */
function linkKey(link) {
  var s = String(link).trim();
  var yt = youTubeId(s);
  if (yt) return 'yt:' + yt;
  var ig = s.match(/instagram\.com\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/([\w-]+)/i);
  if (ig) return 'ig:' + ig[1];
  return s.replace(/^https?:\/\/(www\.|m\.)?/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
