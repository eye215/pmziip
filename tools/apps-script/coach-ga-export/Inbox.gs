/**
 * PM.zip requirement intake from Gmail and Google Calendar (read-only).
 * Same Apps Script project as Code.gs. PRIVATE path: message bodies are NOT
 * written to the link-shared sheet. Download the JSON from the web app
 * (Deploy > Web app, Execute as: Me, Who has access: Only myself) with
 * ?inbox=1 and import it in PM.zip (통합 수집함 > 요구사항 수집 > Gmail·캘린더 파일).
 * - Script Properties: INBOX_GMAIL_LABEL (default "PMZIP"), INBOX_DAYS (default 30),
 *   INBOX_CALENDAR_DAYS (default 14, 0 = off).
 * - Sender is reduced to its domain. Nothing is modified in Gmail or Calendar.
 */
var INBOX_GENERATOR = { name: 'Inbox.gs', version: '1.1.0' };
/** One-line result of the last buildInboxExport_ (counts + reasons), no message content. */
var INBOX_LAST_STATUS_ = '';
var INBOX_MAX_ITEMS = 300;
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

function buildInboxExport_() {
  var props = PropertiesService.getScriptProperties();
  var label = props.getProperty('INBOX_GMAIL_LABEL') || 'PMZIP';
  var query = (props.getProperty('INBOX_GMAIL_QUERY') || '').trim();
  var days = Number(props.getProperty('INBOX_DAYS') || 30);
  var calDays = Number(props.getProperty('INBOX_CALENDAR_DAYS') || 14);
  var items = [];
  var threads = GmailApp.search(inboxQuery_(label, query, days), 0, 100);
  threads.forEach(function (thread) {
    var link = thread.getPermalink();
    thread.getMessages().forEach(function (m) {
      if (items.length >= INBOX_MAX_ITEMS) return;
      items.push({
        channel: 'gmail',
        externalId: 'gmail:' + m.getId(),
        title: String(m.getSubject() || '(제목 없음)').slice(0, 300),
        body: String(m.getPlainBody() || '').slice(0, INBOX_MAX_BODY),
        fromDomain: inboxDomain_(m.getFrom()),
        receivedAt: m.getDate().toISOString(),
        link: link,
      });
    });
  });
  if (calDays > 0) {
    var cal = CalendarApp.getDefaultCalendar();
    var end = new Date();
    var start = new Date(end.getTime() - calDays * 864e5);
    cal.getEvents(start, end).forEach(function (e) {
      if (items.length >= INBOX_MAX_ITEMS) return;
      var desc = String(e.getDescription() || '').replace(/<[^>]+>/g, ' ');
      if (!desc.trim()) return; // only meetings with notes/agenda
      var eid = Utilities.base64EncodeWebSafe(e.getId().split('@')[0] + ' ' + cal.getId()).replace(/=+$/, '');
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
      var slack = slackItems_(INBOX_MAX_ITEMS - items.length);
      items = items.concat(slack.items);
      notes = slack.notes;
      var on = props.getProperty('SLACK_BOT_TOKEN') && props.getProperty('SLACK_CHANNELS');
      slackPart = on ? 'Slack ' + slack.items.length + '건' : 'Slack 미설정(토큰·채널)';
    } catch (e) {
      // Mail and calendar still go out when Slack fails.
      slackPart = 'Slack 실패';
      notes.push(String(e && e.message || e).slice(0, 200));
    }
  }
  INBOX_LAST_STATUS_ = [
    'Gmail ' + nGmail + '건 (' + (query ? '검색식' : '라벨 ' + label) + ', 최근 ' + days + '일)',
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
  var data = buildInboxExport_();
  data.items.forEach(function (it) {
    it.title = inboxClean_(it.title).slice(0, 300);
    it.body = inboxClean_(it.body).slice(0, INBOX_MAX_BODY);
  });
  data.generator = { name: INBOX_GENERATOR.name, version: INBOX_GENERATOR.version + '+sheet' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('PM.zip용 스프레드시트의 확장 프로그램 > Apps Script에서 실행해 주세요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
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
