/**
 * PM.zip mobile vendor market share by country (StatCounter Global Stats,
 * CC BY-SA 3.0 — attribution required). Same Apps Script project as Code.gs.
 * - Script Properties: STATCOUNTER_COUNTRIES = "KR,US,IN" (ISO 3166-1 alpha-2)
 *   optional STATCOUNTER_URL_TEMPLATE (if the CSV download URL changes).
 * - Writes tab pmzip_statcounter (chunked JSON + SHA-256) for PM.zip and
 *   pmzip_statcounter_summary for people. Monthly, last 24 months.
 * StatCounter has no official API; the default template mirrors the site's
 * "Download Data" CSV link. One request per country, at most once a day.
 */
var SC_TAB = 'pmzip_statcounter';
var SC_SUMMARY_TAB = 'pmzip_statcounter_summary';
var SC_CHUNK_HEADER = 'pmzip.market-share.chunks';
var SC_GENERATOR = { name: 'StatCounter.gs', version: '1.0.0' };
var SC_MONTHS = 24;
var SC_DEFAULT_TEMPLATE =
  'https://gs.statcounter.com/chart.php?device=Mobile&device_hidden=mobile' +
  '&statType_hidden=vendor&region_hidden={CODE}&granularity=monthly' +
  '&statType=Mobile%20Vendor&region={CODE}&fromInt={FROM}&toInt={TO}' +
  '&fromMonthYear={FROM_DASH}&toMonthYear={TO_DASH}&multi-device=true&csv=1';

function exportStatCounterToSheet() {
  var data = buildStatCounterExport_();
  var json = asciiJson_(data);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('PM.zip용 스프레드시트의 확장 프로그램 > Apps Script에서 실행해 주세요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    writeChunks_(sheet_(ss, SC_TAB), json, SC_CHUNK_HEADER);
    var rows = [['국가', '월', '제조사', '점유율(%)']].concat(data.series.map(function (p) {
      return [p.country, p.month, p.vendor, p.share === null ? '' : String(p.share)];
    }));
    var summary = sheet_(ss, SC_SUMMARY_TAB);
    summary.clearContents();
    summary.getRange(1, 1, rows.length, 4).setNumberFormat('@').setValues(rows);
  } finally {
    lock.releaseLock();
  }
}

function scMonth_(offset) {
  var now = new Date();
  var y = Number(Utilities.formatDate(now, 'Asia/Seoul', 'yyyy'));
  var m = Number(Utilities.formatDate(now, 'Asia/Seoul', 'MM')) + offset;
  while (m < 1) { m += 12; y -= 1; }
  return { y: y, m: m, int: String(y) + pad_(m), dash: y + '-' + pad_(m) };
}

/** Parses a StatCounter CSV (Date, Vendor…) for one country. */
function parseStatCounterCsv_(text, code) {
  var rows = Utilities.parseCsv(text.replace(/^﻿/, ''));
  if (!rows.length || String(rows[0][0]).trim().toLowerCase() !== 'date')
    throw new Error(code + ': StatCounter CSV 형식이 아닙니다 (URL 템플릿을 확인해 주세요).');
  var header = rows[0];
  var out = [];
  rows.slice(1).forEach(function (r) {
    var m = String(r[0] || '').trim().match(/^(\d{4})-(\d{2})/);
    if (!m) return;
    for (var i = 1; i < header.length; i++) {
      var vendor = String(header[i] || '').trim();
      if (!vendor) continue;
      var raw = String(r[i] === undefined ? '' : r[i]).trim();
      var n = raw === '' ? null : Number(raw);
      if (n !== null && (!isFinite(n) || n < 0 || n > 100)) n = null;
      out.push({ country: code, month: m[1] + '-' + m[2], vendor: vendor, share: n });
    }
  });
  return out;
}

function buildStatCounterExport_() {
  var props = PropertiesService.getScriptProperties();
  var countries = String(props.getProperty('STATCOUNTER_COUNTRIES') || '')
    .split(',').map(function (c) { return c.trim().toUpperCase(); }).filter(String);
  if (!countries.length || countries.some(function (c) { return !/^[A-Z]{2}$/.test(c); }))
    throw new Error('Script Properties에 STATCOUNTER_COUNTRIES(예: KR,US,IN)를 설정해 주세요.');
  var template = props.getProperty('STATCOUNTER_URL_TEMPLATE') || SC_DEFAULT_TEMPLATE;
  var from = scMonth_(-SC_MONTHS);
  var to = scMonth_(-1); // last complete month
  var series = [];
  var notes = [];
  countries.forEach(function (code, i) {
    if (i) Utilities.sleep(1500); // be polite: one request per country
    var url = template.replace(/\{CODE\}/g, code).replace('{FROM}', from.int).replace('{TO}', to.int)
      .replace('{FROM_DASH}', from.dash).replace('{TO_DASH}', to.dash);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) {
      notes.push(code + ': HTTP ' + res.getResponseCode() + ' (건너뜀)');
      return;
    }
    try {
      series = series.concat(parseStatCounterCsv_(res.getContentText(), code));
    } catch (e) {
      notes.push(e.message);
    }
  });
  if (!series.length) throw new Error('StatCounter 데이터를 하나도 받지 못했습니다. ' + notes.join(' / '));
  return {
    format: 'pmzip.market-share',
    formatVersion: 1,
    source: 'statcounter',
    metric: 'mobile-vendor-share',
    attribution: 'StatCounter Global Stats',
    generatedAt: new Date().toISOString(),
    generator: SC_GENERATOR,
    notes: notes,
    series: series,
  };
}
