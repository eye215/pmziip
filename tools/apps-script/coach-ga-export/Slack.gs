/**
 * PM.zip requirement intake from Slack (read-only). Same Apps Script project.
 * - Script Properties: SLACK_BOT_TOKEN (xoxb-…, a read-only bot with
 *   channels:history, channels:read, groups:history, groups:read),
 *   channels in the sheet tab pmzip_settings ("Slack 채널") or SLACK_CHANNELS (names or IDs),
 *   optional SLACK_DAYS (default INBOX_DAYS or 30).
 * - The bot must be invited to each channel. Bot messages (e.g. stats
 *   reports) and join/leave notices are skipped. One item per top-level
 *   message with its thread replies; mentions become plain text.
 * - Items join Gmail/Calendar in buildInboxExport_ (Inbox.gs), so they reach
 *   the private download and, when INBOX_SHEET=on, the pmzip_inbox tab
 *   (masked by inboxClean_).
 */
var SLACK_MAX_THREADS = 60;

function slackApi_(token, method, params) {
  var qs = Object.keys(params || {}).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  var res = UrlFetchApp.fetch('https://slack.com/api/' + method + (qs ? '?' + qs : ''), {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() === 429) throw new Error('Slack 요청 한도 초과입니다. 잠시 후 다시 실행해 주세요.');
  var body = JSON.parse(res.getContentText());
  if (!body.ok) throw new Error('Slack ' + method + ': ' + body.error);
  return body;
}

/** "<@U1>" → "@사용자", "<#C1|name>" → "#name", "<url|text>" → "text (url)". */
function slackText_(text) {
  return String(text || '')
    .replace(/<@[A-Z0-9]+(\|[^>]+)?>/g, '@사용자')
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function slackIsHuman_(m) {
  return !m.bot_id && !m.subtype || m.subtype === 'thread_broadcast';
}

function slackItems_(maxItems) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('SLACK_BOT_TOKEN');
  var picked = pmzipCheckedIn_(PMZIP_LISTS.slack);
  var wanted = (picked || String(pmzipSetting_('SLACK_CHANNELS')).split(','))
    .map(function (c) { return c.trim().replace(/^#/, ''); }).filter(String);
  if (!token || !wanted.length) return { items: [], notes: [] };
  var days = Number(props.getProperty('SLACK_DAYS') || pmzipSetting_('INBOX_DAYS') || 30);
  var oldest = String(Math.floor(Date.now() / 1000 - days * 86400));
  var team = slackApi_(token, 'auth.test', {}).url.replace(/\/$/, '');

  // Resolve names → IDs (IDs pass through).
  var byName = {};
  var cursor = '';
  do {
    var page = slackApi_(token, 'conversations.list', {
      types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200', cursor: cursor,
    });
    page.channels.forEach(function (c) { byName[c.name] = c.id; byName[c.id] = c.id; });
    cursor = (page.response_metadata && page.response_metadata.next_cursor) || '';
  } while (cursor);

  var items = [];
  var notes = [];
  var threads = 0;
  wanted.forEach(function (name) {
    var id = byName[name];
    if (!id) {
      notes.push('Slack 채널을 찾지 못했거나 봇이 초대되지 않았습니다: ' + name);
      return;
    }
    var label = /^[CG][A-Z0-9]+$/.test(name) ? id : name;
    var hist = slackApi_(token, 'conversations.history', { channel: id, oldest: oldest, limit: '200' });
    hist.messages.filter(slackIsHuman_).forEach(function (m) {
      if (items.length >= maxItems) return;
      var text = slackText_(m.text);
      if (m.reply_count && threads < SLACK_MAX_THREADS) {
        threads++;
        var rep = slackApi_(token, 'conversations.replies', { channel: id, ts: m.ts, limit: '100' });
        var replies = rep.messages.slice(1).filter(slackIsHuman_).map(function (r) { return slackText_(r.text); });
        if (replies.length) text += '\n\n' + replies.join('\n');
      }
      if (!text.trim()) return;
      var first = text.split('\n')[0].trim();
      items.push({
        channel: 'slack',
        externalId: 'slack:' + id + ':' + m.ts,
        title: ('[#' + label + '] ' + (first.length > 80 ? first.slice(0, 79) + '…' : first)).slice(0, 300),
        body: text.slice(0, INBOX_MAX_BODY),
        fromDomain: null,
        receivedAt: new Date(Number(m.ts) * 1000).toISOString(),
        link: team + '/archives/' + id + '/p' + String(m.ts).replace('.', ''),
      });
    });
  });
  return { items: items, notes: notes };
}

/** Channels the bot can see: [{name, id, member}], members first, then by name. */
function slackChannelList_(token) {
  var out = [];
  var cursor = '';
  do {
    var page = slackApi_(token, 'conversations.list', {
      types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200', cursor: cursor,
    });
    page.channels.forEach(function (c) { out.push({ name: c.name, id: c.id, member: !!c.is_member }); });
    cursor = (page.response_metadata && page.response_metadata.next_cursor) || '';
  } while (cursor);
  out.sort(function (a, b) {
    return a.member !== b.member ? (a.member ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return out;
}

/**
 * Slack channels as checkboxes in pmzip_settings (columns E–G), with whether
 * the bot is already in each one. Returns the count, or -2 without a token.
 */
function pmzipRefreshSlackList_(checkOnly) {
  var token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) return -2;
  var list = slackChannelList_(token).slice(0, PMZIP_LABEL_MAX);
  return pmzipWriteList_(PMZIP_LISTS.slack, list.map(function (c) {
    return { name: c.name, note: c.member ? '봇 참여' : '초대 필요 (/invite)' };
  }), checkOnly);
}
