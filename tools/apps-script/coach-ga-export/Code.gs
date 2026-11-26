/**
 * PM.zip Galaxy Coach GA4 export (read-only). NEW standalone script.
 * - Does NOT modify or call the existing CoachData / CoachGlobalData scripts or sheets.
 * - GA property ID lives in Script Properties (GA_PROPERTY_ID), never in code or the repo.
 * - Output: pmzip.coach-ga-export v1 JSON, written to this (new) spreadsheet
 *   for PM.zip auto-sync, or downloaded via the web app for manual import.
 * Definition must match src/lib/connectors/coach-definition.ts (coach-ga4-1.2);
 * tests/unit/coach-export.test.ts checks these constants.
 */
var DEFINITION_VERSION = 'coach-ga4-1.2';
var GENERATOR = { name: 'coach-ga-export.gs', version: '1.0.0' };
var MAIN_EVENT = 'screen_view';
var MAIN_SCREEN_DIMENSION = 'unifiedScreenName';
var MAIN_SCREEN = 'GALAXY_COACH_SCREEN';
var START_EVENT = 'GALAXY_COACH_SIMULATION';
var DONE_EVENT = 'GALAXY_COACH_REPORT'; // galaxy_coach_simulation_Done is excluded.
var SCORE_DIMENSION = 'customEvent:nsp_value';
var COUNTRY_DIMENSION = 'countryId';
var SALES_CASE_DIMENSION = 'customEvent:nsp_category';
var VALID_SCORES = ['1', '2', '3', '4', '5'];
var EXPORT_FILE_NAME = 'pmzip-coach-ga-export.json';
var EXPORT_TAB = 'pmzip_export';
var SUMMARY_TAB = 'pmzip_summary';
var CHUNK_HEADER = 'pmzip.coach-ga-export.chunks';
var CHUNK_SIZE = 30000; // Sheets cell limit is 50,000 characters.

/** Web app (Execute as: Me, Access: Only myself). ?start=YYYY-MM-DD&end=YYYY-MM-DD optional; ?inbox=1 → Inbox.gs. */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.inbox) return inboxDownload_(); // Inbox.gs: private requirement intake file
  var periods = p.start && p.end ? [{ startDate: p.start, endDate: p.end }] : defaultPeriods_();
  var json = JSON.stringify(buildExport_(periods), null, 2);
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON)
    .downloadAsFile(EXPORT_FILE_NAME);
}

/**
 * Run from the editor, or by the daily trigger. Writes to THIS spreadsheet
 * (create a NEW spreadsheet and open Extensions > Apps Script there):
 * - tab pmzip_export: column A = export JSON in text chunks, read by PM.zip
 *   (share the spreadsheet as "Anyone with the link: Viewer").
 * - tab pmzip_summary: human-readable totals for checking against old reports.
 */
function exportToSheet() {
  var data = buildExport_(defaultPeriods_());
  var json = asciiJson_(data);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('새 스프레드시트의 확장 프로그램 > Apps Script에서 실행해 주세요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    writeChunks_(sheet_(ss, EXPORT_TAB), json);
    writeSummary_(sheet_(ss, SUMMARY_TAB), data);
  } finally {
    lock.releaseLock();
  }
}

/** Installs one daily trigger (06:00-07:00 script time zone). Safe to re-run. */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'exportToSheet' || h === 'dailyExport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyExport').timeBased().everyDays(1).atHour(6).create();
}

/** Daily job: GA export, then DART (Dart.gs) and StatCounter (StatCounter.gs) if configured. */
function dailyExport() {
  var errors = [];
  try { exportToSheet(); } catch (e) { errors.push('GA: ' + e.message); }
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DART_API_KEY') && props.getProperty('DART_CORP_CODE')) {
    try { exportDartToSheet(); } catch (e) { errors.push('DART: ' + e.message); }
  }
  if (props.getProperty('STATCOUNTER_COUNTRIES')) {
    try { exportStatCounterToSheet(); } catch (e) { errors.push('StatCounter: ' + e.message); }
  }
  if (errors.length) throw new Error(errors.join(' / '));
}

/** JSON with non-ASCII escaped, so chunk boundaries never split a character. */
function asciiJson_(data) {
  return JSON.stringify(data).replace(/[\u007f-\uffff]/g, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
}
function sheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ((b + 256) % 256).toString(16); })
    .map(function (h) { return h.length === 1 ? '0' + h : h; })
    .join('');
}
/** Each chunk is wrapped in "|" so Sheets never turns it into a number/formula. */
function writeChunks_(sheet, json, header) {
  var chunks = [];
  for (var i = 0; i < json.length; i += CHUNK_SIZE) chunks.push('|' + json.slice(i, i + CHUNK_SIZE) + '|');
  var rows = [[(header || CHUNK_HEADER) + '|v1|' + chunks.length + '|' + sha256Hex_(json)]].concat(
    chunks.map(function (c) { return [c]; }),
  );
  sheet.clearContents();
  var range = sheet.getRange(1, 1, rows.length, 1);
  range.setNumberFormat('@');
  range.setValues(rows);
}
function writeSummary_(sheet, data) {
  var header = ['기간 시작', '기간 끝', '진입 UU', '진입 횟수', '시작 UU', '시작 횟수', '완료 UU', 'REPORT 전체', '유효 점수(1~5)', '생성 시각', '정의'];
  var rows = data.periods.map(function (p) {
    var valid = VALID_SCORES.reduce(function (a, s) { return a === null || p.scores[s] === null ? null : a + p.scores[s]; }, 0);
    var v = function (x) { return x === null ? '미집계' : x; };
    return [p.startDate, p.endDate, v(p.totals.main.users), v(p.totals.main.count), v(p.totals.start.users), v(p.totals.start.count),
      v(p.totals.done.users), v(p.totals.done.count), v(valid), data.generatedAt, data.definitionVersion];
  });
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length + 1, header.length).setNumberFormat('@').setValues([header].concat(rows));
}

/** Last 7 full days, month-to-date (until yesterday), previous two full months. */
function defaultPeriods_() {
  var tz = Session.getScriptTimeZone();
  var fmt = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  var today = new Date();
  var yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
  var weekStart = new Date(today.getTime() - 7 * 24 * 3600 * 1000);
  var y = Number(Utilities.formatDate(today, tz, 'yyyy'));
  var m = Number(Utilities.formatDate(today, tz, 'MM')); // 1-12
  var periods = [{ startDate: fmt(weekStart), endDate: fmt(yesterday) }];
  var monthStart = y + '-' + pad_(m) + '-01';
  if (monthStart <= fmt(yesterday)) periods.push({ startDate: monthStart, endDate: fmt(yesterday) });
  for (var i = 1; i <= 2; i++) {
    var mm = m - i, yy = y;
    while (mm < 1) { mm += 12; yy -= 1; }
    var last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    periods.push({ startDate: yy + '-' + pad_(mm) + '-01', endDate: yy + '-' + pad_(mm) + '-' + pad_(last) });
  }
  return periods;
}
function pad_(n) { return (n < 10 ? '0' : '') + n; }

function buildExport_(periods) {
  var propertyId = PropertiesService.getScriptProperties().getProperty('GA_PROPERTY_ID');
  if (!propertyId || !/^\d+$/.test(propertyId))
    throw new Error('Script Properties에 GA_PROPERTY_ID(숫자)를 설정해 주세요.');
  var ctx = { propertyId: propertyId, timeZone: null };
  var out = periods.map(function (range) { return buildPeriod_(ctx, range); });
  return {
    format: 'pmzip.coach-ga-export',
    formatVersion: 1,
    definitionVersion: DEFINITION_VERSION,
    definition: {
      mainEvent: MAIN_EVENT,
      mainScreen: MAIN_SCREEN,
      startEvent: START_EVENT,
      doneEvent: DONE_EVENT,
      scoreDimension: SCORE_DIMENSION,
      countryDimension: COUNTRY_DIMENSION,
      salesCaseDimension: SALES_CASE_DIMENSION,
    },
    generatedAt: new Date().toISOString(),
    generator: GENERATOR,
    propertyTimeZone: ctx.timeZone,
    periods: out,
  };
}

function eq_(field, value) {
  return { filter: { fieldName: field, stringFilter: { matchType: 'EXACT', value: value, caseSensitive: true } } };
}
function filters_() {
  return {
    main: { andGroup: { expressions: [eq_('eventName', MAIN_EVENT), eq_(MAIN_SCREEN_DIMENSION, MAIN_SCREEN)] } },
    start: eq_('eventName', START_EVENT),
    done: eq_('eventName', DONE_EVENT),
  };
}

function report_(ctx, quality, range, dimension, metrics, filter) {
  var req = {
    dateRanges: [range],
    metrics: metrics.map(function (m) { return { name: m }; }),
    dimensionFilter: filter,
    limit: 10000,
    keepEmptyRows: false,
  };
  if (dimension) req.dimensions = [{ name: dimension }];
  var res = AnalyticsData.Properties.runReport(req, 'properties/' + ctx.propertyId);
  var meta = res.metadata || {};
  if (meta.timeZone) ctx.timeZone = meta.timeZone;
  if (meta.subjectToThresholding) quality.thresholded = true;
  if (meta.dataLossFromOtherRow) quality.dataLossFromOtherRow = true;
  if (meta.samplingMetadatas && meta.samplingMetadatas.length) quality.sampled = true;
  var rows = res.rows || [];
  if ((res.rowCount || 0) > rows.length) quality.truncated = true;
  return rows.map(function (r) {
    return {
      key: dimension ? r.dimensionValues[0].value : '',
      values: r.metricValues.map(function (v) { return Number(v.value); }),
    };
  });
}

/** No row from GA => null ("미집계"), never silently 0. */
function totals_(ctx, quality, range, filter) {
  var rows = report_(ctx, quality, range, null, ['totalUsers', 'eventCount'], filter);
  return rows.length ? { users: rows[0].values[0], count: rows[0].values[1] } : { users: null, count: null };
}
function breakdown_(ctx, quality, range, dimension, filters) {
  var get = function (filter) {
    return report_(ctx, quality, range, dimension, ['totalUsers', 'eventCount'], filter).map(function (r) {
      return { key: r.key, users: r.values[0], count: r.values[1] };
    });
  };
  return { main: get(filters.main), start: get(filters.start), done: get(filters.done) };
}

function buildPeriod_(ctx, range) {
  var quality = { thresholded: false, sampled: false, dataLossFromOtherRow: false, truncated: false, notes: [] };
  var f = filters_();
  // UU per period is queried directly for the whole range; never summed from days or dimensions.
  var totals = { main: totals_(ctx, quality, range, f.main), start: totals_(ctx, quality, range, f.start), done: totals_(ctx, quality, range, f.done) };
  var scoreRows = report_(ctx, quality, range, SCORE_DIMENSION, ['eventCount'], f.done);
  var scores = {};
  var invalid = [];
  VALID_SCORES.forEach(function (s) { scores[s] = scoreRows.length ? 0 : null; });
  scoreRows.forEach(function (r) {
    if (VALID_SCORES.indexOf(r.key) >= 0) scores[r.key] = r.values[0];
    else invalid.push({ value: r.key, count: r.values[0] });
  });
  if (Session.getScriptTimeZone() !== ctx.timeZone && ctx.timeZone)
    quality.notes.push('스크립트 시간대(' + Session.getScriptTimeZone() + ')와 GA 속성 시간대(' + ctx.timeZone + ')가 다릅니다. 기간은 GA 속성 시간대 기준입니다.');
  return {
    startDate: range.startDate,
    endDate: range.endDate,
    totals: totals,
    scores: scores,
    invalidScores: invalid,
    byCountry: breakdown_(ctx, quality, range, COUNTRY_DIMENSION, f),
    bySalesCase: breakdown_(ctx, quality, range, SALES_CASE_DIMENSION, f),
    quality: quality,
  };
}
