/**
 * PM.zip Galaxy Coach GA4 export (read-only). NEW standalone script.
 * - Does NOT modify or call the existing CoachData / CoachGlobalData scripts or sheets.
 * - GA property ID lives in Script Properties (GA_PROPERTY_ID), never in code or the repo.
 * - Output: pmzip.coach-ga-export v1 JSON, imported manually in PM.zip
 *   (백업·가져오기 > Galaxy Coach GA 가져오기).
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

/** Web app (Execute as: Me, Access: Only myself). ?start=YYYY-MM-DD&end=YYYY-MM-DD optional. */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var periods = p.start && p.end ? [{ startDate: p.start, endDate: p.end }] : defaultPeriods_();
  var json = JSON.stringify(buildExport_(periods), null, 2);
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON)
    .downloadAsFile(EXPORT_FILE_NAME);
}

/** Run from the editor, or by the daily trigger: writes the JSON to your Drive. */
function exportToDrive() {
  var json = JSON.stringify(buildExport_(defaultPeriods_()), null, 2);
  var props = PropertiesService.getScriptProperties();
  var fileId = props.getProperty('EXPORT_FILE_ID');
  if (fileId) {
    try {
      DriveApp.getFileById(fileId).setContent(json);
      return;
    } catch (err) {
      // File removed or not accessible: create a new one below.
    }
  }
  var file = DriveApp.createFile(EXPORT_FILE_NAME, json, MimeType.PLAIN_TEXT);
  props.setProperty('EXPORT_FILE_ID', file.getId());
}

/** Installs one daily trigger (06:00-07:00 script time zone). Safe to re-run. */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'exportToDrive') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('exportToDrive').timeBased().everyDays(1).atHour(6).create();
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
