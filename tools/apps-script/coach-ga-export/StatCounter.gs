/**
 * PM.zip mobile vendor market share by country (StatCounter Global Stats,
 * CC BY-SA 3.0 — attribution required). Same Apps Script project as Code.gs.
 * - Script Properties: STATCOUNTER_COUNTRIES = "KR,US,IN" (ISO 3166-1 alpha-2,
 *   many countries are fine), optional STATCOUNTER_URL_TEMPLATE.
 * - Resumable: countries are fetched in small parallel batches and cached in
 *   tab pmzip_statcounter_cache. A run stops before the 6-minute limit and the
 *   next run continues; cached countries are refreshed after 7 days.
 * - Writes tab pmzip_statcounter (chunked JSON + SHA-256) for PM.zip and
 *   pmzip_statcounter_summary for people. Monthly, last 24 complete months.
 * StatCounter has no official API; the default template mirrors the site's
 * "Download Data" CSV link.
 */
var SC_TAB = 'pmzip_statcounter';
var SC_SUMMARY_TAB = 'pmzip_statcounter_summary';
var SC_CACHE_TAB = 'pmzip_statcounter_cache';
var SC_CHUNK_HEADER = 'pmzip.market-share.chunks';
var SC_GENERATOR = { name: 'StatCounter.gs', version: '1.1.0' };
var SC_MONTHS = 24;
var SC_BATCH = 5; // parallel requests per batch
var SC_PAUSE_MS = 1000; // pause between batches
var SC_MAX_AGE_DAYS = 7; // refresh cached countries after this
var SC_TOP_VENDORS = 8; // per country; the rest is summed into "Other"
var SC_BUDGET_MS = 4.5 * 60 * 1000; // stop fetching after this (limit is 6 min)
var SC_RUN_START = Date.now(); // start of this execution (globals load per run)
var SC_DEFAULT_TEMPLATE =
  'https://gs.statcounter.com/chart.php?device=Mobile&device_hidden=mobile' +
  '&statType_hidden=vendor&region_hidden={CODE}&granularity=monthly' +
  '&statType=Mobile%20Vendor&region={CODE}&fromInt={FROM}&toInt={TO}' +
  '&fromMonthYear={FROM_DASH}&toMonthYear={TO_DASH}&multi-device=true&csv=1';
// ISO 3166-1 alpha-2 (plus XK, widely used for Kosovo).
var SC_ISO = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK').split(' ');

function exportStatCounterToSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('PM.zip용 스프레드시트의 확장 프로그램 > Apps Script에서 실행해 주세요.');
  var data = buildStatCounterExport_(ss);
  var json = asciiJson_(data);
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
  var rows = Utilities.parseCsv(String(text).replace(/^﻿/, ''));
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

/**
 * Keeps the top vendors of a country (by average share) and sums the rest per
 * month into "Other", so ~100 countries stay within browser storage limits.
 * A month where every merged value is missing stays null (not 0).
 */
function scTopVendors_(points) {
  var total = {};
  points.forEach(function (p) {
    if (p.vendor === 'Other') return;
    total[p.vendor] = (total[p.vendor] || 0) + (p.share || 0);
  });
  var keep = Object.keys(total).sort(function (a, b) { return total[b] - total[a]; }).slice(0, SC_TOP_VENDORS);
  var out = [];
  var other = {};
  points.forEach(function (p) {
    if (keep.indexOf(p.vendor) >= 0) { out.push(p); return; }
    var o = other[p.month] || (other[p.month] = { country: p.country, month: p.month, vendor: 'Other', share: null });
    if (p.share !== null) o.share = Math.round(((o.share || 0) + p.share) * 100) / 100;
  });
  Object.keys(other).sort().forEach(function (m) {
    if (other[m].share !== null && other[m].share > 100) other[m].share = 100;
    out.push(other[m]);
  });
  return out;
}
function scNote_(text) {
  return text.length > 480 ? text.slice(0, 477) + '…' : text;
}

/** Cache rows: [country, fetchedAt ISO, 'ok'|'error', '|' + CSV or message + '|']. */
function scReadCache_(sheet) {
  var cache = {};
  var values = sheet.getDataRange().getValues();
  values.forEach(function (r) {
    var code = String(r[0] || '');
    if (!/^[A-Z]{2}$/.test(code)) return;
    var body = String(r[3] || '');
    cache[code] = { fetchedAt: String(r[1]), status: String(r[2]), body: body.slice(1, -1) };
  });
  return cache;
}
function scWriteCache_(sheet, cache) {
  var rows = [['country', 'fetchedAt', 'status', 'body']];
  Object.keys(cache).sort().forEach(function (code) {
    var c = cache[code];
    rows.push([code, c.fetchedAt, c.status, '|' + c.body.slice(0, 45000) + '|']);
  });
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 4).setNumberFormat('@').setValues(rows);
}

function buildStatCounterExport_(ss) {
  var props = PropertiesService.getScriptProperties();
  var requested = String(props.getProperty('STATCOUNTER_COUNTRIES') || '')
    .split(',').map(function (c) { return c.trim().toUpperCase(); }).filter(String);
  if (!requested.length) throw new Error('Script Properties에 STATCOUNTER_COUNTRIES(예: KR,US,IN)를 설정해 주세요.');
  var notes = [];
  var invalid = requested.filter(function (c) { return SC_ISO.indexOf(c) < 0; });
  if (invalid.length) notes.push(scNote_('국가 코드가 아니어서 건너뜀: ' + invalid.join(', ')));
  var countries = requested.filter(function (c, i) { return SC_ISO.indexOf(c) >= 0 && requested.indexOf(c) === i; });

  var template = props.getProperty('STATCOUNTER_URL_TEMPLATE') || SC_DEFAULT_TEMPLATE;
  var from = scMonth_(-SC_MONTHS);
  var to = scMonth_(-1); // last complete month
  var url = function (code) {
    return template.replace(/\{CODE\}/g, code).replace('{FROM}', from.int).replace('{TO}', to.int)
      .replace('{FROM_DASH}', from.dash).replace('{TO_DASH}', to.dash);
  };

  var cacheSheet = sheet_(ss, SC_CACHE_TAB);
  var cache = scReadCache_(cacheSheet);
  var fresh = function (code) {
    var c = cache[code];
    return c && c.status === 'ok' && Date.now() - new Date(c.fetchedAt).getTime() < SC_MAX_AGE_DAYS * 864e5;
  };
  // Never fetched first, then the oldest.
  var due = countries.filter(function (c) { return !fresh(c); }).sort(function (a, b) {
    var ta = cache[a] ? new Date(cache[a].fetchedAt).getTime() : 0;
    var tb = cache[b] ? new Date(cache[b].fetchedAt).getTime() : 0;
    return ta - tb;
  });
  Logger.log('StatCounter: 대상 ' + countries.length + '개국 · 이번에 받을 국가 ' + due.length + '개');

  var done = 0;
  for (var i = 0; i < due.length; i += SC_BATCH) {
    if (Date.now() - SC_RUN_START > SC_BUDGET_MS) break;
    var batch = due.slice(i, i + SC_BATCH);
    var responses = UrlFetchApp.fetchAll(batch.map(function (code) {
      return { url: url(code), muteHttpExceptions: true, followRedirects: true };
    }));
    var now = new Date().toISOString();
    responses.forEach(function (res, j) {
      var code = batch[j];
      if (res.getResponseCode() !== 200) {
        cache[code] = { fetchedAt: now, status: 'error', body: 'HTTP ' + res.getResponseCode() };
      } else {
        var text = res.getContentText();
        try {
          parseStatCounterCsv_(text, code); // validate before caching
          cache[code] = { fetchedAt: now, status: 'ok', body: text };
        } catch (e) {
          cache[code] = { fetchedAt: now, status: 'error', body: e.message };
        }
      }
      done++;
      Logger.log(code + ' ' + (cache[code].status === 'ok' ? '완료' : '실패: ' + cache[code].body) +
        ' (' + done + '/' + due.length + ')');
    });
    scWriteCache_(cacheSheet, cache); // keep progress even if the run is stopped
    if (i + SC_BATCH < due.length) Utilities.sleep(SC_PAUSE_MS);
  }
  var remaining = due.length - done;
  if (remaining > 0) {
    notes.push('시간 제한으로 ' + remaining + '개국은 다음 실행에서 이어서 받습니다.');
    Logger.log('남은 국가 ' + remaining + '개: exportStatCounterToSheet를 다시 실행하거나 다음 자동 실행을 기다려 주세요.');
  }

  var series = [];
  var failed = [];
  countries.forEach(function (code) {
    var c = cache[code];
    if (!c) return; // not fetched yet
    if (c.status !== 'ok') { failed.push(code + '(' + c.body + ')'); return; }
    series = series.concat(scTopVendors_(parseStatCounterCsv_(c.body, code)));
  });
  if (failed.length) notes.push(scNote_('받지 못한 국가 ' + failed.length + '개: ' + failed.join(', ')));
  if (!series.length) {
    if (remaining > 0) {
      Logger.log('아직 저장할 국가가 없습니다. 다시 실행하면 이어서 받습니다.');
      throw new Error('아직 받은 국가가 없습니다 (남은 국가 ' + remaining + '개). 다시 실행해 주세요.');
    }
    throw new Error('StatCounter 데이터를 하나도 받지 못했습니다. ' + notes.join(' / '));
  }
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
