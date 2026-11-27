/**
 * PM.zip requirement intake from Gmail and Google Calendar (read-only).
 * Same Apps Script project as Code.gs. PRIVATE path: message bodies are NOT
 * written to the link-shared sheet. Download the JSON from the web app
 * (Deploy > Web app, Execute as: Me, Who has access: Only myself) with
 * ?inbox=1 and import it in PM.zip (수집함 > 요구사항 수집 > Gmail·캘린더 파일).
 * - Script Properties: INBOX_GMAIL_LABEL (default "PMZIP"), INBOX_DAYS (default 30),
 *   INBOX_CALENDAR_DAYS (default 14, 0 = off).
 * - Sender is reduced to its domain. Nothing is modified in Gmail or Calendar.
 */
var INBOX_GENERATOR = { name: 'Inbox.gs', version: '1.6.0' };
/** One-line result of the last buildInboxExport_ (counts + reasons), no message content. */
var INBOX_LAST_STATUS_ = '';
// Separate caps so one source cannot crowd out another (PM.zip accepts ≤1000).
var INBOX_MAX_ITEMS = 300; // Gmail messages
var INBOX_MAX_CALENDAR = 100;
var INBOX_MAX_SLACK = 300;
var INBOX_SHEET_MAX_BODY = 8000; // per item in the shared sheet (keeps the tab small)
var INBOX_SHEET_ATTACH_TEXT = 4000; // per attachment in the shared sheet
var INBOX_MAX_BODY = 20000;

function inboxDomain_(from) {
  var m = String(from || '').match(/@([A-Za-z0-9.-]+)/);
  return m ? '@' + m[1].toLowerCase() : null;
}

/**
 * Gmail search: INBOX_GMAIL_QUERY (advanced, used as is) or one or more labels
 * from INBOX_GMAIL_LABEL ("PMZIP, 고객요청"), always limited to recent days.
 */
function inboxQuery_(label, query, days) {
  var scope = query
    ? '(' + query + ')'
    : '(' + String(label).split(',').map(function (l) { return l.trim().replace(/"/g, ''); })
        .filter(String).map(function (l) { return 'label:"' + l + '"'; }).join(' OR ') + ')';
  return scope + ' newer_than:' + days + 'd';
}

/**
 * Settings typed directly in the sheet: tab pmzip_settings, column B.
 * A value there wins over the Script Property of the same key; an empty
 * cell means "default". The Slack token is never read from or written to
 * the sheet (it is link-shared) — it stays in Script Properties.
 */
var PMZIP_SETTINGS_TAB = 'pmzip_settings';
var PMZIP_SETTINGS = [
  ['INBOX_GMAIL_LABEL', 'Gmail 라벨', 'PMZIP', '쉼표로 직접 입력. 아래 "Gmail 라벨 목록"에서 체크하면 체크한 라벨이 우선합니다.'],
  ['INBOX_GMAIL_QUERY', 'Gmail 검색식 (고급)', '', '채우면 라벨 대신 이 검색식을 씁니다. 예: from:@고객사.com 요청'],
  ['INBOX_DAYS', '메일 기간(일)', '30', '최근 며칠 메일을 가져올지 (1~365)'],
  ['INBOX_CALENDAR_DAYS', '캘린더 기간(일)', '14', '0이면 캘린더 수집 끔'],
  ['SLACK_CHANNELS', 'Slack 채널', '', '쉼표로 여러 개. 봇을 채널에 초대해야 합니다. 토큰은 여기 쓰지 마세요.'],
  ['INBOX_ATTACHMENTS', '메일 첨부 글자 가져오기', 'off', 'on이면 PDF·워드·엑셀·PPT·텍스트 첨부를 글자로 바꿔 함께 가져옵니다(메일당 3개, 개당 4,000자). 이 시트는 링크 공유라 민감한 첨부가 있는 라벨은 빼세요.'],
];

function pmzipSettingDef_(key) {
  for (var i = 0; i < PMZIP_SETTINGS.length; i++) if (PMZIP_SETTINGS[i][0] === key) return PMZIP_SETTINGS[i];
  return null;
}

function pmzipSettingsRows_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss && ss.getSheetByName(PMZIP_SETTINGS_TAB);
  return sh ? sh.getDataRange().getValues() : [];
}

/** Sheet cell (if the row exists) → Script Property → ''. */
function pmzipSetting_(key) {
  var def = pmzipSettingDef_(key);
  var rows = pmzipSettingsRows_();
  for (var i = 0; def && i < rows.length; i++)
    if (String(rows[i][0]).trim() === def[1]) return String(rows[i][1] === null ? '' : rows[i][1]).trim();
  return String(PropertiesService.getScriptProperties().getProperty(key) || '').trim();
}

/** Creates pmzip_settings (seeded from current values) if it is missing. */
function pmzipEnsureSettingsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  var sh = ss.getSheetByName(PMZIP_SETTINGS_TAB);
  if (sh && sh.getDataRange().getValues().length > 1) return sh;
  var rows = [['설정', '값 (여기에 입력)', '설명']].concat(PMZIP_SETTINGS.map(function (d) {
    return [d[1], pmzipSetting_(d[0]) || d[2], d[3]];
  }));
  sh = sh || ss.insertSheet(PMZIP_SETTINGS_TAB);
  sh.getRange(1, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
  return sh;
}

function pmzipSaveSetting_(key, value) {
  var def = pmzipSettingDef_(key);
  var sh = pmzipEnsureSettingsSheet_();
  var rows = sh.getDataRange().getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === def[1]) {
      sh.getRange(i + 1, 2).setNumberFormat('@').setValue(value);
      return;
    }
  }
  sh.getRange(rows.length + 1, 1, 1, 3).setNumberFormat('@').setValues([[def[1], value, def[3]]]);
}

/**
 * Pick lists with checkboxes in pmzip_settings. Gmail labels sit under the
 * settings (columns A–C), Slack channels beside them (columns E–G), so the
 * two lists never overwrite each other. Lists are refreshed on every run
 * (checks kept by name); checked items win over the typed setting.
 */
var PMZIP_LISTS = {
  gmail: {
    title: 'Gmail 라벨 목록', col: 1, setting: 'INBOX_GMAIL_LABEL', fallback: 'PMZIP',
    note: '체크한 라벨의 메일만 가져옵니다. 목록은 수집할 때마다 실행한 계정의 라벨로 갱신됩니다.',
  },
  slack: {
    title: 'Slack 채널 목록', col: 5, setting: 'SLACK_CHANNELS', fallback: '',
    note: '체크한 채널만 가져옵니다. "초대 필요" 채널은 그 채널에서 /invite 로 봇을 넣어야 읽힙니다.',
  },
};
var PMZIP_LABEL_LIST = PMZIP_LISTS.gmail.title;
var PMZIP_LABEL_MAX = 300;

function pmzipIsChecked_(v) {
  return v === true || String(v).toLowerCase() === 'true';
}
function pmzipListAt_(rows, spec) {
  for (var i = 0; i < rows.length; i++) if (String(rows[i][spec.col - 1] === undefined ? '' : rows[i][spec.col - 1]).trim() === spec.title) return i;
  return -1;
}
/** Item rows below the title: consecutive non-empty names in the list column. */
function pmzipListItems_(rows, spec, at) {
  var out = [];
  for (var j = at + 1; j < rows.length; j++) {
    var name = String(rows[j][spec.col - 1] === undefined ? '' : rows[j][spec.col - 1]).trim();
    if (!name) break;
    out.push({ name: name, checked: pmzipIsChecked_(rows[j][spec.col]) });
  }
  return out;
}
/** Checked names, or null when the list does not exist / nothing is checked. */
function pmzipCheckedIn_(spec) {
  var rows = pmzipSettingsRows_();
  var at = pmzipListAt_(rows, spec);
  if (at < 0) return null;
  var out = pmzipListItems_(rows, spec, at).filter(function (x) { return x.checked; })
    .map(function (x) { return x.name; });
  return out.length ? out : null;
}

/**
 * Writes `items` ([{name, note}]) as checkbox rows of `spec`. Checks are kept
 * by name; `checkOnly` (array) replaces them. Returns the number of items.
 */
function pmzipWriteList_(spec, items, checkOnly) {
  var sh = pmzipEnsureSettingsSheet_();
  if (!sh) return -1;
  var rows = sh.getDataRange().getValues();
  var at = pmzipListAt_(rows, spec);
  var old = at >= 0 ? pmzipListItems_(rows, spec, at) : [];
  var keep = checkOnly;
  if (!keep) {
    keep = at >= 0
      ? old.filter(function (x) { return x.checked; }).map(function (x) { return x.name; })
      : String(pmzipSetting_(spec.setting) || spec.fallback).split(',');
  }
  var checked = {};
  keep.forEach(function (n) { checked[String(n).trim().replace(/^#/, '')] = true; });
  // 1-based title row: existing, else below the settings (Gmail) or row 1 (Slack).
  var head = at >= 0 ? at + 1 : (spec.col === 1 ? PMZIP_SETTINGS.length + 3 : 1);
  if (old.length) {
    var stale = sh.getRange(head + 1, spec.col, old.length, 3);
    stale.clearDataValidations();
    stale.clearContent();
  }
  sh.getRange(head, spec.col, 1, 3).setValues([[spec.title, '가져오기 (체크)', spec.note]]);
  if (items.length) {
    sh.getRange(head + 1, spec.col, items.length, 1).setNumberFormat('@')
      .setValues(items.map(function (x) { return [x.name]; }));
    var boxes = sh.getRange(head + 1, spec.col + 1, items.length, 1);
    boxes.insertCheckboxes();
    boxes.setValues(items.map(function (x) { return [!!checked[x.name]]; }));
    sh.getRange(head + 1, spec.col + 2, items.length, 1).setNumberFormat('@')
      .setValues(items.map(function (x) { return [x.note || '']; }));
  }
  return items.length;
}

function pmzipLabelSectionAt_(rows) {
  return pmzipListAt_(rows, PMZIP_LISTS.gmail);
}
function pmzipCheckedLabels_() {
  return pmzipCheckedIn_(PMZIP_LISTS.gmail);
}
/** This account's Gmail labels as checkboxes. -1 when labels cannot be read. */
function pmzipRefreshLabelList_(checkOnly) {
  var names;
  try {
    names = GmailApp.getUserLabels().map(function (l) { return l.getName(); });
  } catch (e) {
    return -1;
  }
  names.sort();
  return pmzipWriteList_(PMZIP_LISTS.gmail, names.slice(0, PMZIP_LABEL_MAX).map(function (n) {
    return { name: n, note: '' };
  }), checkOnly);
}

function buildInboxExport_() {
  var props = PropertiesService.getScriptProperties();
  var picked = pmzipCheckedLabels_();
  var label = (picked && picked.join(', ')) || pmzipSetting_('INBOX_GMAIL_LABEL') || 'PMZIP';
  var query = pmzipSetting_('INBOX_GMAIL_QUERY');
  var days = Number(pmzipSetting_('INBOX_DAYS') || 30);
  var calDays = Number(pmzipSetting_('INBOX_CALENDAR_DAYS') || 14);
  if (!(days >= 1 && days <= 365)) days = 30;
  if (!(calDays >= 0)) calDays = 14;
  var items = [];
  var attach = {
    on: String(pmzipSetting_('INBOX_ATTACHMENTS') || 'off').trim().toLowerCase() === 'on',
    converted: 0,
    started: Date.now(),
    files: 0,
    skipped: 0,
  };
  var threads = GmailApp.search(inboxQuery_(label, query, days), 0, 100);
  threads.forEach(function (thread) {
    var link = thread.getPermalink();
    thread.getMessages().forEach(function (m) {
      if (items.length >= INBOX_MAX_ITEMS) return;
      var it = {
        channel: 'gmail',
        externalId: 'gmail:' + m.getId(),
        title: String(m.getSubject() || '(제목 없음)').slice(0, 300),
        body: String(m.getPlainBody() || '').slice(0, INBOX_MAX_BODY),
        fromDomain: inboxDomain_(m.getFrom()),
        receivedAt: m.getDate().toISOString(),
        link: link,
      };
      if (attach.on) it.attachments = inboxAttachments_(m, attach);
      items.push(it);
    });
  });
  if (calDays > 0) {
    var cal = CalendarApp.getDefaultCalendar();
    var end = new Date();
    var start = new Date(end.getTime() - calDays * 864e5);
    var nCalendar = 0;
    cal.getEvents(start, end).forEach(function (e) {
      if (nCalendar >= INBOX_MAX_CALENDAR) return;
      var desc = String(e.getDescription() || '').replace(/<[^>]+>/g, ' ');
      if (!desc.trim()) return; // only meetings with notes/agenda
      var eid = Utilities.base64EncodeWebSafe(e.getId().split('@')[0] + ' ' + cal.getId()).replace(/=+$/, '');
      nCalendar++;
      items.push({
        channel: 'calendar',
        externalId: 'calendar:' + e.getId() + ':' + e.getStartTime().toISOString(),
        title: String(e.getTitle() || '(제목 없음)').slice(0, 300),
        body: desc.slice(0, INBOX_MAX_BODY),
        fromDomain: null,
        receivedAt: e.getStartTime().toISOString(),
        link: 'https://www.google.com/calendar/event?eid=' + eid,
      });
    });
  }
  var nGmail = items.filter(function (it) { return it.channel === 'gmail'; }).length;
  var nCal = items.length - nGmail;
  var notes = [];
  var slackPart = 'Slack 미설정';
  if (typeof slackItems_ === 'function') {
    try {
      var slack = slackItems_(INBOX_MAX_SLACK);
      items = items.concat(slack.items);
      notes = slack.notes;
      var on = props.getProperty('SLACK_BOT_TOKEN') && (pmzipCheckedIn_(PMZIP_LISTS.slack) || pmzipSetting_('SLACK_CHANNELS'));
      slackPart = on ? 'Slack ' + slack.items.length + '건' + (slack.items.length >= INBOX_MAX_SLACK ? '(상한 도달)' : '') : 'Slack 미설정(토큰·채널)';
    } catch (e) {
      // Mail and calendar still go out when Slack fails.
      slackPart = 'Slack 실패';
      notes.push(String(e && e.message || e).slice(0, 200));
    }
  }
  INBOX_LAST_STATUS_ = [
    'Gmail ' + nGmail + '건' + (nGmail >= INBOX_MAX_ITEMS ? '(상한 도달)' : '') + ' (' + (query ? '검색식' : '라벨 ' + label) + ', 최근 ' + days + '일)' +
      (attach.on ? ', 첨부 ' + attach.files + '개' + (attach.skipped ? '(못 읽음 ' + attach.skipped + ')' : '') : ''),
    calDays > 0 ? '캘린더 ' + nCal + '건' : '캘린더 끔',
    slackPart,
  ].join(' · ') + (notes.length ? ' — ' + notes.join(' / ') : '');
  Logger.log(INBOX_LAST_STATUS_);
  return {
    format: 'pmzip.inbox-export',
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    generator: INBOX_GENERATOR,
    query: { gmailLabel: query ? 'query: ' + query.slice(0, 180) : label, calendarDays: calDays > 0 ? calDays : null },
    items: items,
  };
}

/**
 * Text of a message's attachments (setting INBOX_ATTACHMENTS = on).
 * Plain text/CSV is read directly; PDF, Word, Excel and PowerPoint are
 * converted to a temporary Google file in the runner's Drive, exported as
 * text and deleted at once. Caps: 3 per message, 10MB per file, 30
 * conversions or ~4 minutes per run; a file that cannot be read keeps its
 * name with a note. Nothing is changed in Gmail.
 */
var INBOX_ATTACH_PER_MESSAGE = 3;
var INBOX_ATTACH_TEXT = 8000;
var INBOX_ATTACH_MAX_BYTES = 10 * 1024 * 1024;
var INBOX_ATTACH_MAX_CONVERT = 30;
var INBOX_ATTACH_TIME_MS = 4 * 60 * 1000;
var INBOX_CONVERT_ = {
  'application/pdf': ['application/vnd.google-apps.document', 'text/plain'],
  'application/msword': ['application/vnd.google-apps.document', 'text/plain'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['application/vnd.google-apps.document', 'text/plain'],
  'application/vnd.ms-excel': ['application/vnd.google-apps.spreadsheet', 'text/csv'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['application/vnd.google-apps.spreadsheet', 'text/csv'],
  'application/vnd.ms-powerpoint': ['application/vnd.google-apps.presentation', 'text/plain'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['application/vnd.google-apps.presentation', 'text/plain'],
};
var INBOX_EXT_TYPE_ = {
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', md: 'text/plain',
};

function inboxAttachments_(m, state) {
  if (typeof m.getAttachments !== 'function') return [];
  var out = [];
  var list = m.getAttachments({ includeInlineImages: false, includeAttachments: true }) || [];
  for (var i = 0; i < list.length && out.length < INBOX_ATTACH_PER_MESSAGE; i++) {
    var a = list[i];
    var name = String(a.getName() || '첨부').slice(0, 200);
    var ext = (name.match(/\.([A-Za-z0-9]+)$/) || [])[1];
    var type = String(a.getContentType() || '').split(';')[0].toLowerCase();
    if (!INBOX_CONVERT_[type] && !/^text\//.test(type)) type = INBOX_EXT_TYPE_[String(ext || '').toLowerCase()] || type;
    if (!INBOX_CONVERT_[type] && !/^text\//.test(type)) continue; // images etc.
    var entry = { name: name, mimeType: type.slice(0, 120), text: '', note: null };
    try {
      if (a.getSize() > INBOX_ATTACH_MAX_BYTES) {
        entry.note = '10MB 초과라 읽지 않음';
      } else if (/^text\//.test(type)) {
        entry.text = a.getDataAsString('UTF-8');
      } else if (state.converted >= INBOX_ATTACH_MAX_CONVERT || Date.now() - state.started > INBOX_ATTACH_TIME_MS) {
        entry.note = '이번 실행의 변환 한도에 걸려 다음 실행에 읽음';
      } else {
        state.converted++;
        entry.text = inboxConvert_(a, INBOX_CONVERT_[type]);
      }
    } catch (e) {
      entry.note = '읽지 못함: ' + String(e && e.message || e).slice(0, 120);
    }
    entry.text = String(entry.text || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, INBOX_ATTACH_TEXT);
    if (entry.note) state.skipped++;
    else state.files++;
    out.push(entry);
  }
  return out;
}

/** Upload with conversion, export as text, delete. Drive scope: drive.file. */
function inboxConvert_(blob, how) {
  var token = ScriptApp.getOAuthToken();
  var boundary = 'pmzip' + Date.now();
  var meta = JSON.stringify({ name: 'pmzip-temp-' + Date.now(), mimeType: how[0] });
  var head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
    '\r\n--' + boundary + '\r\nContent-Type: ' + blob.getContentType() + '\r\n\r\n';
  var payload = Utilities.newBlob(head).getBytes()
    .concat(blob.getBytes())
    .concat(Utilities.newBlob('\r\n--' + boundary + '--').getBytes());
  var up = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'post',
    contentType: 'multipart/related; boundary=' + boundary,
    payload: payload,
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  if (up.getResponseCode() >= 300) throw new Error('변환 실패 ' + up.getResponseCode());
  var id = JSON.parse(up.getContentText()).id;
  try {
    var ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=' + encodeURIComponent(how[1]), {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    if (ex.getResponseCode() >= 300) throw new Error('글자 추출 실패 ' + ex.getResponseCode());
    return ex.getContentText('UTF-8');
  } finally {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id, {
      method: 'delete',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });
  }
}

/** Called from doGet(?inbox=1) in Code.gs. */
function inboxDownload_() {
  return ContentService.createTextOutput(JSON.stringify(buildInboxExport_()))
    .setMimeType(ContentService.MimeType.JSON)
    .downloadAsFile('pmzip-inbox-export.json');
}

/**
 * OPT-IN shared-sheet path (Script Property INBOX_SHEET = "on"). Run
 * exportInboxToSheet / installInboxTrigger while signed in as the account
 * whose Gmail holds the requirement mails (it may differ from the GA
 * account that installed dailyExport). Writes the
 * export to tab pmzip_inbox of this link-shared spreadsheet so PM.zip can
 * read it without a file download. Anyone with the sheet link can read it,
 * so bodies are reduced first: quoted replies, forwarded headers and
 * signatures are cut, e-mail addresses and phone numbers are masked, and the
 * sender stays a domain only.
 */
var INBOX_TAB = 'pmzip_inbox';
var INBOX_CHUNK_HEADER = 'pmzip.inbox-export.chunks';

function inboxClean_(text) {
  var out = [];
  var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (/^-{2,}\s*(original message|원본 메시지|forwarded message|전달된 메시지)/i.test(t) ||
        /^on .+wrote:$/i.test(t) || /^(보낸 사람|from)\s*:/i.test(t) || t === '--') break;
    if (t.charAt(0) === '>') continue;
    out.push(lines[i]);
  }
  return out.join('\n')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[이메일]')
    .replace(/(\+?\d{1,3}[-.\s]?)?(0\d{1,2}|\(\d{2,3}\))[-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[전화번호]')
    .trim();
}

function exportInboxToSheet() {
  if (PropertiesService.getScriptProperties().getProperty('INBOX_SHEET') !== 'on')
    throw new Error('스크립트 속성 INBOX_SHEET=on 을 설정한 뒤 실행해 주세요 (공유 시트에 메일 내용이 기록됩니다).');
  pmzipRefreshLabelList_(); // this account's labels as checkboxes, checks kept
  if (typeof pmzipRefreshSlackList_ === 'function') {
    try {
      pmzipRefreshSlackList_();
    } catch (e) {
      // A Slack error is reported in the status line by buildInboxExport_.
    }
  }
  var data = buildInboxExport_();
  data.items.forEach(function (it) {
    it.title = inboxClean_(it.title).slice(0, 300);
    it.body = inboxClean_(it.body).slice(0, INBOX_SHEET_MAX_BODY);
    // Link-shared sheet: attachment text is masked and shorter too.
    (it.attachments || []).forEach(function (a) {
      a.text = inboxClean_(a.text).slice(0, INBOX_SHEET_ATTACH_TEXT);
    });
  });
  data.generator = { name: INBOX_GENERATOR.name, version: INBOX_GENERATOR.version + '+sheet' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('PM.zip용 스프레드시트의 확장 프로그램 > Apps Script에서 실행해 주세요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    pmzipEnsureSettingsSheet_(); // so the label can be typed in the sheet next time
    var tab = sheet_(ss, INBOX_TAB);
    writeChunks_(tab, asciiJson_(data), INBOX_CHUNK_HEADER);
    // Column B is not read by PM.zip; it shows when and what was collected.
    tab.getRange(1, 2).setNumberFormat('@').setValue(
      '마지막 실행 ' + data.generatedAt + ' · ' + INBOX_LAST_STATUS_,
    );
  } finally {
    lock.releaseLock();
  }
  Logger.log('pmzip_inbox: ' + data.items.length + '건');
  return INBOX_LAST_STATUS_;
}

/** Daily 07:00-08:00 trigger for exportInboxToSheet, owned by the account running this. */
function installInboxTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'exportInboxToSheet') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('exportInboxToSheet').timeBased().everyDays(1).atHour(7).create();
  // No account e-mail in the log: that would need the userinfo.email scope.
  Logger.log('매일 07시대 메일 수집 트리거를 설치했습니다.');
}
