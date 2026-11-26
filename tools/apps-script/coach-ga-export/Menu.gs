/**
 * "PM.zip" menu in the spreadsheet: set which Gmail labels (or a search) to
 * collect without editing Script Properties, and run the exports now.
 * Settings live in the sheet tab pmzip_settings (typed directly or via these
 * prompts); INBOX_SHEET and the Slack token stay in Script Properties. Run the mail items while signed in as the mail account.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('PM.zip')
    .addItem('가져올 Gmail 라벨 고르기 (여러 개 선택)', 'pmzipPickLabels')
    .addItem('설정 탭 열기 (기간·채널 입력)', 'pmzipOpenSettings')
    .addItem('가져올 Gmail 라벨 직접 입력', 'pmzipSetInboxLabels')
    .addItem('Gmail 검색식으로 설정 (고급)', 'pmzipSetInboxQuery')
    .addItem('메일 가져올 기간(일) 설정', 'pmzipSetInboxDays')
    .addItem('Slack 채널 설정', 'pmzipSetSlackChannels')
    .addSeparator()
    .addItem('요구사항 메일 지금 가져오기', 'pmzipRunInboxNow')
    .addItem('요구사항 메일 매일 자동 수집 켜기', 'pmzipInstallInboxTrigger')
    .addItem('GA·공시·점유율 지금 갱신', 'dailyExport')
    .addSeparator()
    .addItem('현재 설정 보기', 'pmzipShowSettings')
    .addToUi();
}

function pmzipProps_() {
  return PropertiesService.getScriptProperties();
}

/** Labels of the signed-in Gmail, sorted (first `max`, default 30). */
function pmzipLabelNames_(max) {
  try {
    return GmailApp.getUserLabels().map(function (l) { return l.getName(); }).sort().slice(0, max || 30);
  } catch (e) {
    return [];
  }
}

function pmzipSetInboxLabels() {
  var ui = SpreadsheetApp.getUi();
  var props = pmzipProps_();
  var picked = pmzipCheckedLabels_();
  var current = (picked && picked.join(', ')) || pmzipSetting_('INBOX_GMAIL_LABEL') || 'PMZIP';
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
  pmzipSaveSetting_('INBOX_GMAIL_LABEL', labels.join(', '));
  pmzipSaveSetting_('INBOX_GMAIL_QUERY', ''); // labels take over from an old search
  if (pmzipLabelSectionAt_(pmzipSettingsRows_()) >= 0) pmzipRefreshLabelList_(labels); // keep checks in sync
  var missing = names.length ? labels.filter(function (l) { return names.indexOf(l) < 0; }) : [];
  ui.alert(
    '저장했습니다: ' + labels.join(', ') +
      (missing.length ? '\n\n주의: 이 계정에 없는 라벨이 있습니다 — ' + missing.join(', ') : ''),
  );
}

function pmzipSetInboxQuery() {
  var ui = SpreadsheetApp.getUi();
  var props = pmzipProps_();
  var current = pmzipSetting_('INBOX_GMAIL_QUERY') || '(없음 — 라벨 사용)';
  var res = ui.prompt(
    'Gmail 검색식 (고급)',
    'Gmail 검색창에 쓰는 형식 그대로 입력하세요. 비우면 라벨 설정으로 돌아갑니다.\n' +
      '예: from:@고객사.com (요청 OR 오류 OR 개선) -from:noreply\n현재: ' + current,
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var q = res.getResponseText().trim();
  pmzipSaveSetting_('INBOX_GMAIL_QUERY', q);
  ui.alert(q ? '검색식을 저장했습니다. 라벨 대신 이 검색식을 씁니다.' : '검색식을 지웠습니다. 라벨 설정을 씁니다.');
}

function pmzipSetInboxDays() {
  var ui = SpreadsheetApp.getUi();
  var props = pmzipProps_();
  var res = ui.prompt(
    '메일 가져올 기간',
    '최근 며칠 동안의 메일을 가져올까요? (1~365)\n현재: ' + (pmzipSetting_('INBOX_DAYS') || '30') + '일',
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var n = Number(res.getResponseText().trim());
  if (!(n >= 1 && n <= 365)) {
    ui.alert('1에서 365 사이의 숫자를 입력해 주세요.');
    return;
  }
  pmzipSaveSetting_('INBOX_DAYS', String(Math.round(n)));
  ui.alert('저장했습니다: 최근 ' + Math.round(n) + '일');
}

function pmzipSetSlackChannels() {
  var ui = SpreadsheetApp.getUi();
  var props = pmzipProps_();
  var res = ui.prompt(
    'Slack 채널',
    '수집할 채널 이름을 쉼표로 입력하세요. 예: next-ai-technology-team, pj-넥삼플-운영dev\n' +
      '봇을 각 채널에 /invite 해야 합니다. 토큰(SLACK_BOT_TOKEN)은 스크립트 속성에 넣으세요.\n현재: ' +
      (pmzipSetting_('SLACK_CHANNELS') || '없음') +
      ' · 토큰 ' + (props.getProperty('SLACK_BOT_TOKEN') ? '설정됨' : '없음'),
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var channels = res.getResponseText().split(',').map(function (s) { return s.trim().replace(/^#/, ''); }).filter(String);
  pmzipSaveSetting_('SLACK_CHANNELS', channels.join(', '));
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
  var status = exportInboxToSheet();
  ui.alert(
    'pmzip_inbox 탭을 갱신했습니다.\n\n' + status +
      '\n\nPM.zip의 통합 수집함 > 요구사항 수집에서 "시트에서 새 메일 확인"을 누르세요.' +
      (/^Gmail 0건/.test(status) ? '\n\nGmail이 0건이면: 이 계정에 해당 라벨이 붙은 최근 메일이 있는지, 메뉴 "가져올 Gmail 라벨 설정"을 확인하세요.' : ''),
  );
}

/** Installs the daily trigger as the account clicking the menu (the mail account). */
function pmzipInstallInboxTrigger() {
  var ui = SpreadsheetApp.getUi();
  if (pmzipProps_().getProperty('INBOX_SHEET') !== 'on') {
    ui.alert('먼저 "요구사항 메일 지금 가져오기"를 한 번 실행해 공유 시트 기록을 켜 주세요.');
    return;
  }
  installInboxTrigger();
  ui.alert('매일 07시대에 지금 이 계정의 메일을 가져오도록 설정했습니다. 메일을 읽을 계정으로 로그인한 상태에서 눌러야 합니다.');
}

/**
 * Multi-select label picker: a dialog listing this account's Gmail labels
 * with checkboxes (sheet dropdowns allow only one value). Saving writes the
 * chosen labels to pmzip_settings and syncs the checkbox list there.
 */
function pmzipPickLabels() {
  var ui = SpreadsheetApp.getUi();
  var names = pmzipLabelNames_(PMZIP_LABEL_MAX);
  if (!names.length) {
    ui.alert('Gmail 라벨을 읽지 못했거나 사용자 라벨이 없습니다. 메일 계정으로 로그인했는지, Gmail에 라벨이 있는지 확인해 주세요.');
    return;
  }
  var current = pmzipCheckedLabels_() ||
    String(pmzipSetting_('INBOX_GMAIL_LABEL') || 'PMZIP').split(',').map(function (x) { return x.trim(); });
  var html = HtmlService.createHtmlOutput(pmzipLabelPickerHtml_(names, current, pmzipProps_().getProperty('INBOX_SHEET') === 'on'))
    .setWidth(440).setHeight(560);
  ui.showModalDialog(html, '가져올 Gmail 라벨 (여러 개 선택)');
}

/** Called from the dialog (google.script.run). Returns a message to show. */
function pmzipSaveLabelPick(labels, runNow) {
  var known = pmzipLabelNames_(PMZIP_LABEL_MAX);
  var picked = (Array.isArray(labels) ? labels : []).map(function (x) { return String(x).trim(); })
    .filter(function (x, k, a) { return x && known.indexOf(x) >= 0 && a.indexOf(x) === k; }).slice(0, 50);
  if (!picked.length) throw new Error('라벨을 하나 이상 선택해 주세요.');
  pmzipSaveSetting_('INBOX_GMAIL_LABEL', picked.join(', '));
  pmzipSaveSetting_('INBOX_GMAIL_QUERY', ''); // labels take over from an old search
  pmzipRefreshLabelList_(picked);
  var msg = '저장했습니다: ' + picked.join(', ');
  if (runNow && pmzipProps_().getProperty('INBOX_SHEET') === 'on') msg += '\n\n' + exportInboxToSheet();
  return msg;
}

function pmzipLabelPickerHtml_(names, current, canRun) {
  // JSON embedded with "<" escaped so label names cannot close the script tag.
  var data = JSON.stringify({ names: names, current: current, canRun: !!canRun }).replace(/</g, '\\u003c');
  return [
    '<!doctype html><html><head><base target="_top"><meta charset="utf-8"><style>',
    'body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:12px;color:#1f2937}',
    'input[type=search]{width:100%;box-sizing:border-box;padding:8px;font:inherit;margin-bottom:8px}',
    '#list{max-height:360px;overflow:auto;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px}',
    'label.row{display:flex;gap:8px;align-items:center;min-height:36px;cursor:pointer}',
    '.bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}',
    'button{min-height:40px;padding:0 14px;font:inherit;border-radius:6px;border:1px solid #9ca3af;background:#fff;cursor:pointer}',
    'button.primary{background:#2563eb;color:#fff;border-color:#2563eb}',
    'button:focus-visible,input:focus-visible{outline:2px solid #2563eb;outline-offset:2px}',
    '#msg{white-space:pre-wrap;margin-top:10px}</style></head><body>',
    '<label for="q">라벨 검색</label><input id="q" type="search" autocomplete="off">',
    '<div id="count" aria-live="polite"></div>',
    '<div id="list" role="group" aria-label="Gmail 라벨"></div>',
    '<div class="bar"><button type="button" id="all">보이는 것 모두 선택</button>',
    '<button type="button" id="none">모두 해제</button></div>',
    '<div class="bar"><button type="button" class="primary" id="save">저장</button>',
    '<button type="button" id="saveRun">저장하고 지금 가져오기</button>',
    '<button type="button" id="close">닫기</button></div>',
    '<div id="msg" role="status"></div>',
    '<script>var D=' + data + ';',
    'var chosen={};D.current.forEach(function(n){chosen[n]=true;});',
    'var list=document.getElementById("list"),q=document.getElementById("q"),msg=document.getElementById("msg");',
    'function draw(){var f=q.value.trim().toLowerCase();list.textContent="";',
    'D.names.forEach(function(n,i){if(f&&n.toLowerCase().indexOf(f)<0)return;',
    'var l=document.createElement("label");l.className="row";var c=document.createElement("input");',
    'c.type="checkbox";c.checked=!!chosen[n];c.onchange=function(){chosen[n]=c.checked;count();};',
    'l.appendChild(c);l.appendChild(document.createTextNode(n));list.appendChild(l);});count();}',
    'function picked(){return D.names.filter(function(n){return chosen[n];});}',
    'function count(){document.getElementById("count").textContent="선택 "+picked().length+"개 / 전체 "+D.names.length+"개";}',
    'q.oninput=draw;',
    'document.getElementById("all").onclick=function(){var f=q.value.trim().toLowerCase();',
    'D.names.forEach(function(n){if(!f||n.toLowerCase().indexOf(f)>=0)chosen[n]=true;});draw();};',
    'document.getElementById("none").onclick=function(){chosen={};draw();};',
    'document.getElementById("close").onclick=function(){google.script.host.close();};',
    'var run=document.getElementById("saveRun");if(!D.canRun)run.hidden=true;',
    'function save(now){var p=picked();if(!p.length){msg.textContent="라벨을 하나 이상 선택해 주세요.";return;}',
    'msg.textContent=now?"저장하고 가져오는 중…":"저장 중…";',
    'google.script.run.withSuccessHandler(function(m){msg.textContent=m;})',
    '.withFailureHandler(function(e){msg.textContent="오류: "+(e&&e.message||e);}).pmzipSaveLabelPick(p,now);}',
    'document.getElementById("save").onclick=function(){save(false);};run.onclick=function(){save(true);};',
    'draw();q.focus();</script></body></html>',
  ].join('\n');
}

/** Shows (creating if needed) the pmzip_settings tab where values are typed directly. */
function pmzipOpenSettings() {
  var sh = pmzipEnsureSettingsSheet_();
  sh.activate();
  sh.getRange(2, 2).activate();
}

function pmzipShowSettings() {
  var p = pmzipProps_();
  var q = pmzipSetting_('INBOX_GMAIL_QUERY');
  SpreadsheetApp.getUi().alert(
    'PM.zip 설정\n\n' +
      '메일 대상: ' + (q ? '검색식 ' + q : '라벨 ' + (((pmzipCheckedLabels_() || []).join(', ')) || pmzipSetting_('INBOX_GMAIL_LABEL') || 'PMZIP')) + '\n' +
      '기간: 최근 ' + (pmzipSetting_('INBOX_DAYS') || '30') + '일\n' +
      '캘린더: 최근 ' + (pmzipSetting_('INBOX_CALENDAR_DAYS') || '14') + '일 (0이면 끔)\n' +
      '공유 시트 기록: ' + (p.getProperty('INBOX_SHEET') === 'on' ? '켜짐' : '꺼짐') + '\n' +
      'Slack 채널: ' + (pmzipSetting_('SLACK_CHANNELS') || '없음') +
        ' (토큰 ' + (p.getProperty('SLACK_BOT_TOKEN') ? '설정됨' : '없음') + ')\n' +
      'DART 회사: ' + (p.getProperty('DART_CORP_CODE') || '미설정') + '\n' +
      'StatCounter 국가: ' + (p.getProperty('STATCOUNTER_COUNTRIES')
        ? p.getProperty('STATCOUNTER_COUNTRIES').split(',').length + '개'
        : '미설정'),
  );
}
