/**
 * PM.zip records sync (standalone Apps Script project, NOT the GA export one).
 * Stores the records bundle written by the PM.zip app in a private
 * spreadsheet in the deploying user's Drive, so PC and phone see the same
 * records. The spreadsheet is never shared; the web app runs as the owner and
 * answers only requests carrying PMZIP_SYNC_TOKEN (Script Properties).
 *
 * Setup: run setupSync() once from the editor, then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone),
 * and enter the /exec URL and the token in PM.zip > 설정 > 기기 간 기록 동기화.
 *
 * Protocol (POST, text/plain JSON body):
 *   {action:"pull", token}                         -> {ok, revision, hash, bundle}
 *   {action:"push", token, baseRevision, hash, bundle}
 *       -> {ok:true, revision} | {ok:false, conflict:true, revision}
 * Old revisions are kept (KEEP_REVISIONS) so an overwrite can be undone.
 */
var SYNC_VERSION = '1.0.0';
var SYNC_TAB = 'pmzip_records';
var SYNC_FORMAT = 'pmzip.records-sync';
var CHUNK = 40000; // Sheets cell limit is 50,000 characters.
var KEEP_REVISIONS = 20;
var MAX_BODY = 14000000;

function setupSync() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('PMZIP_SYNC_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('PMZIP_SYNC_TOKEN', token);
  }
  var id = props.getProperty('PMZIP_SYNC_SHEET_ID');
  if (!id) {
    var ss = SpreadsheetApp.create('PM.zip 기록 동기화 (공유하지 마세요)');
    id = ss.getId();
    props.setProperty('PMZIP_SYNC_SHEET_ID', id);
  }
  syncSheet_();
  Logger.log('동기화 토큰(PM.zip 설정에 붙여넣기, 남에게 보내지 마세요): ' + token);
  Logger.log('기록 시트: https://docs.google.com/spreadsheets/d/' + id + ' (공유하지 마세요)');
  Logger.log('다음: 배포 > 새 배포 > 웹 앱 (실행: 나, 액세스: 모든 사용자) → /exec 주소를 PM.zip에 입력');
}

/** Makes a new token; every device must enter it again. */
function rotateSyncToken() {
  PropertiesService.getScriptProperties().deleteProperty('PMZIP_SYNC_TOKEN');
  setupSync();
}

function doGet() {
  return json_({ ok: false, error: 'POST만 받습니다.' });
}

function doPost(e) {
  try {
    var raw = e && e.postData ? e.postData.contents : '';
    if (!raw || raw.length > MAX_BODY) return json_({ ok: false, error: '요청이 비었거나 너무 큽니다.' });
    var req = JSON.parse(raw);
    if (!tokenOk_(req.token)) return json_({ ok: false, error: '동기화 토큰이 맞지 않습니다.' });
    if (req.action === 'pull') return json_(pull_());
    if (req.action === 'push') return json_(push_(req));
    return json_({ ok: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    return json_({ ok: false, error: '시트 처리 오류: ' + String(err && err.message || err).slice(0, 200) });
  }
}

function tokenOk_(given) {
  var want = PropertiesService.getScriptProperties().getProperty('PMZIP_SYNC_TOKEN');
  if (!want || typeof given !== 'string' || given.length !== want.length) return false;
  var diff = 0;
  for (var i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

function syncSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('PMZIP_SYNC_SHEET_ID');
  if (!id) throw new Error('setupSync()를 먼저 실행해 주세요.');
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName(SYNC_TAB) || ss.insertSheet(SYNC_TAB);
  if (sh.getLastRow() === 0)
    sh.appendRow(['revision', 'hash', 'savedAt', 'chunk', 'chunks', 'data']);
  return sh;
}

/** Rows of the latest revision joined back into the stored JSON. */
function latest_(sh) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return null;
  var rows = sh.getRange(2, 1, n, 6).getValues();
  var rev = 0;
  rows.forEach(function (r) { if (Number(r[0]) > rev) rev = Number(r[0]); });
  if (!rev) return null;
  var parts = rows.filter(function (r) { return Number(r[0]) === rev; })
    .sort(function (a, b) { return Number(a[3]) - Number(b[3]); });
  if (parts.length !== Number(parts[0][4])) throw new Error('최신 기록 조각이 모자랍니다. 이전 버전을 확인해 주세요.');
  return { revision: rev, hash: String(parts[0][1]), data: parts.map(function (r) { return String(r[5]).replace(/^~/, ''); }).join('') };
}

function pull_() {
  var sh = syncSheet_();
  var cur = latest_(sh);
  if (!cur) return { ok: true, revision: 0, hash: null, bundle: null };
  return { ok: true, revision: cur.revision, hash: cur.hash, bundle: JSON.parse(cur.data) };
}

function push_(req) {
  var b = req.bundle;
  if (!b || b.format !== SYNC_FORMAT || b.formatVersion !== 1 || !b.items)
    return { ok: false, error: '기록 형식이 아닙니다.' };
  if (!/^[0-9a-f]{64}$/.test(String(req.hash))) return { ok: false, error: '해시 형식이 아닙니다.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = syncSheet_();
    var cur = latest_(sh);
    var rev = cur ? cur.revision : 0;
    if (Number(req.baseRevision) !== rev) return { ok: false, conflict: true, revision: rev };
    var next = rev + 1;
    var text = JSON.stringify(b);
    var chunks = [];
    for (var i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));
    var at = new Date().toISOString();
    var rows = chunks.map(function (c, k) {
      // A "~" marker keeps Sheets from reading a chunk as a number/formula.
      return [next, req.hash, at, k, chunks.length, '~' + c];
    });
    var range = sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6);
    range.setNumberFormat('@');
    range.setValues(rows);
    prune_(sh, next);
    return { ok: true, revision: next };
  } finally {
    lock.releaseLock();
  }
}

/** Keeps the newest KEEP_REVISIONS revisions; older rows are deleted. */
function prune_(sh, latestRev) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return;
  var revs = sh.getRange(2, 1, n, 1).getValues();
  for (var i = revs.length - 1; i >= 0; i--) {
    if (Number(revs[i][0]) <= latestRev - KEEP_REVISIONS) sh.deleteRow(i + 2);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
