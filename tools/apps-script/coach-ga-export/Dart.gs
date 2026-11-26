/**
 * PM.zip public financials from DART OpenAPI (금융감독원 전자공시, read-only).
 * Same Apps Script project as Code.gs (bound to the NEW PM.zip spreadsheet).
 * - DART_API_KEY and DART_CORP_CODE live in Script Properties only.
 * - Writes tab pmzip_dart (chunked JSON + SHA-256) for PM.zip, and
 *   pmzip_dart_summary for people. Public disclosures only; no estimates.
 * API: https://opendart.fss.or.kr  (fnlttSinglAcnt: 단일회사 주요계정)
 */
var DART_TAB = 'pmzip_dart';
var DART_SUMMARY_TAB = 'pmzip_dart_summary';
var DART_CHUNK_HEADER = 'pmzip.public-financials.chunks';
var DART_GENERATOR = { name: 'Dart.gs', version: '1.0.0' };
var DART_YEARS = 3; // current year and the two before
// reprt_code → quarter. 11011 = 사업보고서 (full year, Q4 is derived).
var DART_REPORTS = [
  { code: '11013', quarter: 1 },
  { code: '11012', quarter: 2 },
  { code: '11014', quarter: 3 },
  { code: '11011', quarter: 4 },
];

function exportDartToSheet() {
  var data = buildDartExport_();
  var json = asciiJson_(data);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('PM.zip용 스프레드시트의 확장 프로그램 > Apps Script에서 실행해 주세요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    writeChunks_(sheet_(ss, DART_TAB), json, DART_CHUNK_HEADER);
    writeDartSummary_(sheet_(ss, DART_SUMMARY_TAB), data);
  } finally {
    lock.releaseLock();
  }
}

/** Parses "1,234" / "-1,234" / "" / "-" → number | null (never 0 for missing). */
function dartAmount_(value) {
  if (value === undefined || value === null) return null;
  var s = String(value).replace(/,/g, '').trim();
  if (s === '' || s === '-') return null;
  var n = Number(s);
  return isFinite(n) ? n : null;
}
function dartAccount_(name) {
  var n = String(name || '').replace(/\s/g, '');
  if (n.indexOf('매출원가') >= 0) return null;
  if (n === '매출액' || n === '수익(매출액)' || n === '영업수익') return 'revenue';
  if (n.indexOf('영업이익') === 0) return 'operatingIncome';
  if (n.indexOf('당기순이익') === 0) return 'netIncome';
  return null;
}

function dartFetch_(key, corp, year, reportCode) {
  var url = 'https://opendart.fss.or.kr/api/fnlttSinglAcnt.json' +
    '?crtfc_key=' + encodeURIComponent(key) +
    '&corp_code=' + encodeURIComponent(corp) +
    '&bsns_year=' + year + '&reprt_code=' + reportCode;
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('DART HTTP ' + res.getResponseCode());
  var body = JSON.parse(res.getContentText());
  if (body.status === '013') return []; // 조회된 데이터 없음 (not yet filed)
  if (body.status !== '000') throw new Error('DART ' + body.status + ': ' + body.message);
  return body.list || [];
}

function buildDartExport_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('DART_API_KEY');
  var corp = props.getProperty('DART_CORP_CODE');
  if (!key) throw new Error('Script Properties에 DART_API_KEY를 설정해 주세요.');
  if (!corp || !/^\d{8}$/.test(corp)) throw new Error('Script Properties에 DART_CORP_CODE(8자리 고유번호)를 설정해 주세요.');
  var thisYear = Number(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy'));
  var rows = [];
  var notes = [];
  var seen = {};
  var push = function (row) {
    var k = [row.year, row.quarter, row.fsDiv, row.account].join('|');
    if (seen[k]) return; // first matching account wins (e.g. 당기순이익 vs 당기순이익(손실))
    seen[k] = true;
    rows.push(row);
  };
  for (var y = thisYear - DART_YEARS + 1; y <= thisYear; y++) {
    var byQuarter = {};
    DART_REPORTS.forEach(function (r) {
      var list = dartFetch_(key, corp, y, r.code);
      byQuarter[r.quarter] = list.filter(function (x) { return x.sj_div === 'IS' || x.sj_div === 'CIS'; });
    });
    [1, 2, 3].forEach(function (q) {
      byQuarter[q].forEach(function (x) {
        var account = dartAccount_(x.account_nm);
        if (!account) return;
        push({
          year: y, quarter: q, fsDiv: x.fs_div, account: account, accountName: x.account_nm,
          amount: dartAmount_(x.thstrm_amount), basis: 'reported',
          reportCode: x.reprt_code, rceptNo: x.rcept_no, currency: x.currency || 'KRW',
        });
      });
    });
    // Q4 = full year (사업보고서) − Q1~Q3 cumulative (3분기보고서 누적). Derived, labelled.
    byQuarter[4].forEach(function (x) {
      var account = dartAccount_(x.account_nm);
      if (!account) return;
      var annual = dartAmount_(x.thstrm_amount);
      var q3 = byQuarter[3].filter(function (z) { return z.fs_div === x.fs_div && dartAccount_(z.account_nm) === account; })[0];
      var cum = q3 ? dartAmount_(q3.thstrm_add_amount) : null;
      push({
        year: y, quarter: 4, fsDiv: x.fs_div, account: account, accountName: x.account_nm,
        amount: annual === null || cum === null ? null : annual - cum, basis: 'derived_q4',
        reportCode: x.reprt_code, rceptNo: x.rcept_no, currency: x.currency || 'KRW',
      });
      if (cum === null) notes.push(y + '년 4분기는 3분기 누적값이 없어 미집계입니다.');
    });
  }
  return {
    format: 'pmzip.public-financials',
    formatVersion: 1,
    source: 'dart-opendart-fnlttSinglAcnt',
    corpCode: corp,
    generatedAt: new Date().toISOString(),
    generator: DART_GENERATOR,
    unit: 'KRW',
    notes: notes,
    rows: rows,
  };
}

function writeDartSummary_(sheet, data) {
  var header = ['연도', '분기', '연결/별도', '계정', '금액(원)', '산출', '접수번호'];
  var rows = data.rows.map(function (r) {
    return [String(r.year), 'Q' + r.quarter, r.fsDiv === 'CFS' ? '연결' : '별도', r.accountName,
      r.amount === null ? '미집계' : String(r.amount), r.basis === 'derived_q4' ? '연간-3분기누적' : '공시', r.rceptNo];
  });
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length + 1, header.length).setNumberFormat('@').setValues([header].concat(rows));
}

/**
 * Helper (run once from the editor): finds the 8-digit DART 고유번호 for a
 * 6-digit stock code using the official corpCode.zip, and logs it.
 * Usage: set STOCK below or Script Property DART_STOCK_CODE, then run.
 */
function findDartCorpCode() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('DART_API_KEY');
  var stock = props.getProperty('DART_STOCK_CODE');
  if (!key || !/^\d{6}$/.test(stock || '')) throw new Error('DART_API_KEY와 DART_STOCK_CODE(6자리 종목코드)를 설정해 주세요.');
  var res = UrlFetchApp.fetch('https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=' + encodeURIComponent(key), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('DART HTTP ' + res.getResponseCode());
  var xml = Utilities.unzip(res.getBlob())[0].getDataAsString('UTF-8');
  var re = new RegExp('<corp_code>(\\d{8})</corp_code>\\s*<corp_name>([^<]*)</corp_name>(?:\\s*<corp_eng_name>[^<]*</corp_eng_name>)?\\s*<stock_code>' + stock + '</stock_code>');
  var m = xml.match(re);
  if (!m) throw new Error('종목코드 ' + stock + '에 해당하는 고유번호를 찾지 못했습니다.');
  Logger.log('고유번호 ' + m[1] + ' (' + m[2] + '). Script Properties의 DART_CORP_CODE에 넣어 주세요.');
  return m[1];
}
