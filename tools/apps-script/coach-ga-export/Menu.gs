/**
 * "PM.zip" menu in the spreadsheet: set which Gmail labels (or a search) to
 * collect without editing Script Properties, and run the exports now.
 * Settings are stored in Script Properties (INBOX_GMAIL_LABEL, INBOX_GMAIL_QUERY,
 * INBOX_DAYS, INBOX_SHEET). Run the mail items while signed in as the mail account.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('PM.zip')
    .addItem('가져올 Gmail 라벨 설정', 'pmzipSetInboxLabels')
    .addItem('Gmail 검색식으로 설정 (고급)', 'pmzipSetInboxQuery')
    .addItem('메일 가져올 기간(일) 설정', 'pmzipSetInboxDays')
    .addItem('Slack 채널 설정', 'pmzipSetSlackChannels')
    .addSeparator()
    .addItem('요구사항 메일 지금 가져오기', 'pmzipRunInboxNow')
    .addItem('GA·공시·점유율 지금 갱신', 'dailyExport')
    .addSeparator()
    .addItem('현재 설정 보기', 'pmzipShowSettings')
    .addToUi();
}

function pmzipProps_() {
  return PropertiesService.getScriptProperties();
}

/** Labels of the signed-in Gmail, for the prompt (first 30). */
function pmzipLabelNames_() {
  try {
    return GmailApp.getUserLabels().map(function (l) { return l.getName(); }).slice(0, 30);
  } catch (e) {
    return [];
  }
}

function pmzipSetInboxLabels() {
  var ui = SpreadsheetApp.getUi();
  var props = pmzipProps_();
  var current = props.getProperty('INBOX_GMAIL_LABEL') || 'PMZIP';
  var names = pmzipLabelNames_();
  var res = ui.prompt(
    '가져올 Gmail 라벨',
    '라벨 이름을 쉼표로 구분해 입력하세요. 예: PMZIP, 고객요청\n현재: ' + current +
      (names.length ? '\n\n내 라벨: ' + names.join(', ') : ''),
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var labels = res.getResponseText().split(',').map(function (s) { return s.trim(); }).filter(String);
  if (!labels.length) {
    ui.alert('라벨을 하나 이상 입력해 주세요.');
    return;
  }
  props.setProperty('INBOX_GMAIL_LABEL', labels.join(', '));
  props.deleteProperty('INBOX_GMAIL_QUERY'); // labels take over from an old search
  var missing = names.length ? labels.filter(function (l) { return names.indexOf(l) < 0; }) : [];
  ui.alert(
    '저장했습니다: ' + labels.join(', ') +
      (missing.length ? '\n\n주의: 이 계정에 없는 라벨이 있습니다 — ' + missing.join(', ') : ''),
  );
}

function pmzipSetInboxQuery() {
  var ui = SpreadsheetApp.getUi();
  var props = pmzipProps_();
  var current = props.getProperty('INBOX_GMAIL_QUERY') || '(없음 — 라벨 사용)';
  var res = ui.prompt(
    'Gmail 검색식 (고급)',
    'Gmail 검색창에 쓰는 형식 그대로 입력하세요. 비우면 라벨 설정으로 돌아갑니다.\n' +
      '예: from:@고객사.com (요청 OR 오류 OR 개선) -from:noreply\n현재: ' + current,
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var q = res.getResponseText().trim();
  if (q) props.setProperty('INBOX_GMAIL_QUERY', q);
  else props.deleteProperty('INBOX_GMAIL_QUERY');
  ui.alert(q ? '검색식을 저장했습니다. 라벨 대신 이 검색식을 씁니다.' : '검색식을 지웠습니다. 라벨 설정을 씁니다.');
}

function pmzipSetInboxDays() {
  var ui = SpreadsheetApp.getUi();
  var props = pmzipProps_();
  var res = ui.prompt(
    '메일 가져올 기간',
    '최근 며칠 동안의 메일을 가져올까요? (1~365)\n현재: ' + (props.getProperty('INBOX_DAYS') || '30') + '일',
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var n = Number(res.getResponseText().trim());
  if (!(n >= 1 && n <= 365)) {
    ui.alert('1에서 365 사이의 숫자를 입력해 주세요.');
    return;
  }
  props.setProperty('INBOX_DAYS', String(Math.round(n)));
  ui.alert('저장했습니다: 최근 ' + Math.round(n) + '일');
}

function pmzipSetSlackChannels() {
  var ui = SpreadsheetApp.getUi();
  var props = pmzipProps_();
  var res = ui.prompt(
    'Slack 채널',
    '수집할 채널 이름을 쉼표로 입력하세요. 예: next-ai-technology-team, pj-넥삼플-운영dev\n' +
      '봇을 각 채널에 /invite 해야 합니다. 토큰(SLACK_BOT_TOKEN)은 스크립트 속성에 넣으세요.\n현재: ' +
      (props.getProperty('SLACK_CHANNELS') || '없음') +
      ' · 토큰 ' + (props.getProperty('SLACK_BOT_TOKEN') ? '설정됨' : '없음'),
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var channels = res.getResponseText().split(',').map(function (s) { return s.trim().replace(/^#/, ''); }).filter(String);
  if (channels.length) props.setProperty('SLACK_CHANNELS', channels.join(', '));
  else props.deleteProperty('SLACK_CHANNELS');
  ui.alert(channels.length ? '저장했습니다: ' + channels.join(', ') : 'Slack 수집을 껐습니다.');
}

function pmzipRunInboxNow() {
  var ui = SpreadsheetApp.getUi();
  var props = pmzipProps_();
  if (props.getProperty('INBOX_SHEET') !== 'on') {
    var ok = ui.alert(
      '공유 시트에 메일 기록',
      '메일 내용(인용·서명 제외, 이메일·전화번호 가림)이 이 시트의 pmzip_inbox 탭에 기록됩니다. ' +
        '링크가 있는 사람은 볼 수 있습니다. 켤까요?',
      ui.ButtonSet.YES_NO,
    );
    if (ok !== ui.Button.YES) return;
    props.setProperty('INBOX_SHEET', 'on');
  }
  exportInboxToSheet();
  ui.alert('pmzip_inbox 탭을 갱신했습니다. PM.zip의 통합 수집함 > 요구사항 수집에서 "시트에서 새 메일 확인"을 누르세요.');
}

function pmzipShowSettings() {
  var p = pmzipProps_();
  var q = p.getProperty('INBOX_GMAIL_QUERY');
  SpreadsheetApp.getUi().alert(
    'PM.zip 설정\n\n' +
      '메일 대상: ' + (q ? '검색식 ' + q : '라벨 ' + (p.getProperty('INBOX_GMAIL_LABEL') || 'PMZIP')) + '\n' +
      '기간: 최근 ' + (p.getProperty('INBOX_DAYS') || '30') + '일\n' +
      '캘린더: 최근 ' + (p.getProperty('INBOX_CALENDAR_DAYS') || '14') + '일 (0이면 끔)\n' +
      '공유 시트 기록: ' + (p.getProperty('INBOX_SHEET') === 'on' ? '켜짐' : '꺼짐') + '\n' +
      'Slack 채널: ' + (p.getProperty('SLACK_CHANNELS') || '없음') +
        ' (토큰 ' + (p.getProperty('SLACK_BOT_TOKEN') ? '설정됨' : '없음') + ')\n' +
      'DART 회사: ' + (p.getProperty('DART_CORP_CODE') || '미설정') + '\n' +
      'StatCounter 국가: ' + (p.getProperty('STATCOUNTER_COUNTRIES')
        ? p.getProperty('STATCOUNTER_COUNTRIES').split(',').length + '개'
        : '미설정'),
  );
}
