/**
 * ABR mail engine: providers (Zoho Mail via Self Client, ZeptoMail, Google), a sending
 * queue with a daily quota, branded HTML templates, campaigns and newsletter subscribers.
 *
 * Provider credentials live only in Script Properties. They are never sent back to the portal.
 */

var MAIL_ROLES = ['chair', 'coo'];  // who can send campaigns and manage subscribers

var QUEUE_COLS = ['id', 'campaignId', 'kind', 'to', 'name', 'token', 'subject', 'html', 'priority',
                  'status', 'attempts', 'createdAt', 'sentAt', 'error', 'provider'];
var CAMPAIGN_COLS = ['id', 'subject', 'preheader', 'audience', 'createdBy', 'createdAt', 'total',
                     'html_1', 'html_2', 'html_3', 'html_4'];
var SUB_COLS = ['email', 'name', 'status', 'token', 'source', 'createdAt', 'confirmedAt', 'unsubscribedAt', 'ip'];

var PROVIDERS = {
  zoho:   'Zoho Mail',
  zepto:  'ZeptoMail',
  google: 'Google (Apps Script account)'
};
var ZOHO_DCS  = ['in', 'com', 'eu', 'com.au', 'jp', 'ca', 'sa'];
var ZEPTO_DCS = ['in', 'com', 'eu'];

var MAIL_ROUTES = {
  'mail.status':         mailStatus_,
  'mail.settings.get':   mailSettingsGet_,
  'mail.settings.save':  mailSettingsSave_,
  'mail.zoho.connect':   zohoConnect_,
  'mail.zoho.disconnect': zohoDisconnect_,
  'mail.zepto.remove':   zeptoRemove_,
  'mail.testProvider':   testProvider_,
  'mail.startSender':    function (p, req) { requireAdmin_(req); ensureMailTrigger_(); return mailStatus_(p, req); },
  'mail.articles':       mailArticles_,
  'mail.preview':        campaignPreview_,
  'mail.test':           campaignTest_,
  'mail.send':           campaignSend_,
  'mail.campaigns':      campaignList_,
  'mail.retry':          campaignRetry_,
  'subs.list':           subsList_,
  'subs.add':            subsAdd_,
  'subs.remove':         subsRemove_,
  'public.subscribe':    publicSubscribe_,
  'public.confirmSubscribe': publicConfirm_,
  'public.unsubscribe':  publicUnsubscribe_
};

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function mailSettings_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  return {
    fromAddress: p.MAIL_FROM || 'info@theabr.in',
    fromName:    p.MAIL_FROM_NAME || 'Ahmedabad Business Review',
    replyTo:     p.MAIL_REPLY_TO || '',
    dailyLimit:  Number(p.MAIL_DAILY_LIMIT || 200),
    batchSize:   Number(p.MAIL_BATCH_SIZE || 40),
    routeTx:     p.MAIL_ROUTE_TX || 'google',
    routeBulk:   p.MAIL_ROUTE_BULK || 'google',
    postal:      p.MAIL_POSTAL || 'Ahmedabad, Gujarat, India',
    zohoDc:      p.ZOHO_DC || 'in',
    zohoClientId: p.ZOHO_CLIENT_ID || '',
    zohoConnected: !!p.ZOHO_REFRESH_TOKEN,
    zohoAccountEmail: p.ZOHO_ACCOUNT_EMAIL || '',
    zeptoDc:     p.ZEPTO_DC || 'in',
    zeptoConnected: !!p.ZEPTO_TOKEN
  };
}

function requireMailer_(req) {
  var u = requireUser_(req);
  if (MAIL_ROLES.indexOf(u.role) === -1) throw new Error('Only the Chair and COO can send emails.');
  return u;
}

function mailSettingsGet_(p, req) {
  requireAdmin_(req);
  var s = mailSettings_();
  s.providers = PROVIDERS;
  s.zohoDcs = ZOHO_DCS;
  s.zeptoDcs = ZEPTO_DCS;
  s.triggerOn = hasMailTrigger_();
  return s;
}

function mailSettingsSave_(p, req) {
  requireAdmin_(req);
  var props = PropertiesService.getScriptProperties();
  var email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (p.fromAddress !== undefined) {
    if (!email.test(p.fromAddress)) throw new Error('Enter a valid From address.');
    props.setProperty('MAIL_FROM', String(p.fromAddress).trim().toLowerCase());
  }
  if (p.fromName !== undefined) props.setProperty('MAIL_FROM_NAME', String(p.fromName).trim().slice(0, 80));
  if (p.replyTo !== undefined) {
    if (p.replyTo && !email.test(p.replyTo)) throw new Error('Enter a valid Reply-to address.');
    props.setProperty('MAIL_REPLY_TO', String(p.replyTo).trim().toLowerCase());
  }
  if (p.postal !== undefined) props.setProperty('MAIL_POSTAL', String(p.postal).trim().slice(0, 200));
  if (p.dailyLimit !== undefined) {
    var n = Math.floor(Number(p.dailyLimit));
    if (!(n >= 1 && n <= 100000)) throw new Error('Daily limit must be between 1 and 100,000.');
    props.setProperty('MAIL_DAILY_LIMIT', String(n));
  }
  if (p.batchSize !== undefined) {
    var b = Math.floor(Number(p.batchSize));
    if (!(b >= 1 && b <= 200)) throw new Error('Batch size must be between 1 and 200.');
    props.setProperty('MAIL_BATCH_SIZE', String(b));
  }
  ['routeTx', 'routeBulk'].forEach(function (k) {
    if (p[k] === undefined) return;
    if (!PROVIDERS[p[k]]) throw new Error('Unknown provider.');
    props.setProperty(k === 'routeTx' ? 'MAIL_ROUTE_TX' : 'MAIL_ROUTE_BULK', p[k]);
  });
  if (p.zeptoDc !== undefined) {
    if (ZEPTO_DCS.indexOf(p.zeptoDc) === -1) throw new Error('Unknown ZeptoMail region.');
    props.setProperty('ZEPTO_DC', p.zeptoDc);
  }
  if (p.zeptoToken) {
    var t = String(p.zeptoToken).trim();
    if (!/^Zoho-enczapikey /.test(t)) t = 'Zoho-enczapikey ' + t;
    props.setProperty('ZEPTO_TOKEN', t);
  }
  var s = mailSettings_();
  if (s.routeTx === 'zoho' || s.routeBulk === 'zoho') { if (!s.zohoConnected) throw new Error('Saved, but Zoho Mail is not connected yet. Connect it below before routing mail through it.'); }
  if (s.routeTx === 'zepto' || s.routeBulk === 'zepto') { if (!s.zeptoConnected) throw new Error('Saved, but ZeptoMail has no token yet. Add it below before routing mail through it.'); }
  return mailSettingsGet_(p, req);
}

/* ------------------------------------------------------------------ */
/* Zoho Mail (Self Client)                                             */
/* ------------------------------------------------------------------ */

function zohoConnect_(p, req) {
  requireAdmin_(req);
  var dc = String(p.dc || 'in');
  if (ZOHO_DCS.indexOf(dc) === -1) throw new Error('Unknown Zoho data centre.');
  var clientId = String(p.clientId || '').trim();
  var clientSecret = String(p.clientSecret || '').trim();
  var code = String(p.code || '').trim();
  if (!clientId || !clientSecret || !code) throw new Error('Client ID, Client Secret and the generated code are all required.');

  var res = UrlFetchApp.fetch('https://accounts.zoho.' + dc + '/oauth/v2/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { code: code, client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code' }
  });
  var j = safeJson_(res.getContentText());
  if (!j.refresh_token) {
    throw new Error('Zoho did not return a refresh token (' + (j.error || ('HTTP ' + res.getResponseCode())) +
      '). Codes expire within minutes and work once: generate a new one and connect straight away. Check the data centre too.');
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperties({ ZOHO_DC: dc, ZOHO_CLIENT_ID: clientId, ZOHO_CLIENT_SECRET: clientSecret, ZOHO_REFRESH_TOKEN: j.refresh_token });
  if (j.access_token) CacheService.getScriptCache().put('zoho_access', j.access_token, Math.max(60, Number(j.expires_in || 3600) - 300));

  // Find the Zoho Mail account that can send as the configured From address.
  var from = mailSettings_().fromAddress;
  var acc = zohoRequest_('get', '/api/accounts');
  var list = (acc && acc.data) || [];
  if (!list.length) throw new Error('Connected, but no Zoho Mail account was found for this login.');
  var chosen = null;
  list.forEach(function (a) {
    var addrs = [a.primaryEmailAddress, a.mailboxAddress].concat((a.sendMailDetails || []).map(function (d) { return d.fromAddress; }))
      .concat((a.emailAddress || []).map(function (e) { return e.mailId; }))
      .filter(function (x) { return x; }).map(function (x) { return String(x).toLowerCase(); });
    if (!chosen && addrs.indexOf(from) !== -1) chosen = a;
  });
  chosen = chosen || list[0];
  props.setProperties({ ZOHO_ACCOUNT_ID: String(chosen.accountId), ZOHO_ACCOUNT_EMAIL: String(chosen.primaryEmailAddress || chosen.mailboxAddress || '') });
  log_(requireAdmin_(req).email, 'mail.zoho.connect', '', chosen.primaryEmailAddress || '');
  return mailSettingsGet_(p, req);
}

function zohoDisconnect_(p, req) {
  requireAdmin_(req);
  var props = PropertiesService.getScriptProperties();
  ['ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'ZOHO_ACCOUNT_ID', 'ZOHO_ACCOUNT_EMAIL'].forEach(function (k) { props.deleteProperty(k); });
  CacheService.getScriptCache().remove('zoho_access');
  return mailSettingsGet_(p, req);
}

function zeptoRemove_(p, req) {
  requireAdmin_(req);
  PropertiesService.getScriptProperties().deleteProperty('ZEPTO_TOKEN');
  return mailSettingsGet_(p, req);
}

function zohoAccessToken_() {
  var cache = CacheService.getScriptCache();
  var t = cache.get('zoho_access');
  if (t) return t;
  var p = PropertiesService.getScriptProperties().getProperties();
  if (!p.ZOHO_REFRESH_TOKEN) throw new Error('Zoho Mail is not connected.');
  var res = UrlFetchApp.fetch('https://accounts.zoho.' + (p.ZOHO_DC || 'in') + '/oauth/v2/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { refresh_token: p.ZOHO_REFRESH_TOKEN, client_id: p.ZOHO_CLIENT_ID, client_secret: p.ZOHO_CLIENT_SECRET, grant_type: 'refresh_token' }
  });
  var j = safeJson_(res.getContentText());
  if (!j.access_token) throw new Error('Zoho token refresh failed (' + (j.error || res.getResponseCode()) + '). Reconnect Zoho Mail in Settings.');
  cache.put('zoho_access', j.access_token, Math.max(60, Number(j.expires_in || 3600) - 300));
  return j.access_token;
}

function zohoRequest_(method, path, body) {
  var dc = prop_('ZOHO_DC') || 'in';
  var opts = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Zoho-oauthtoken ' + zohoAccessToken_() } };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch('https://mail.zoho.' + dc + path, opts);
  var j = safeJson_(res.getContentText());
  if (res.getResponseCode() >= 300) throw new Error('Zoho Mail error ' + res.getResponseCode() + ': ' + JSON.stringify(j.data || j).slice(0, 200));
  return j;
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

// Build an HTTP request for providers that use one; Google sends inline.
function buildRequest_(provider, msg, s) {
  if (provider === 'zoho') {
    return {
      url: 'https://mail.zoho.' + (prop_('ZOHO_DC') || 'in') + '/api/accounts/' + prop_('ZOHO_ACCOUNT_ID') + '/messages',
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Zoho-oauthtoken ' + zohoAccessToken_() },
      payload: JSON.stringify({ fromAddress: s.fromAddress, toAddress: msg.to, subject: msg.subject,
                                content: msg.html, mailFormat: 'html', askReceipt: 'no' })
    };
  }
  if (provider === 'zepto') {
    var token = prop_('ZEPTO_TOKEN');
    if (!token) throw new Error('ZeptoMail is not connected.');
    var body = {
      from: { address: s.fromAddress, name: s.fromName },
      to: [{ email_address: { address: msg.to, name: msg.name || '' } }],
      subject: msg.subject, htmlbody: msg.html
    };
    if (s.replyTo) body.reply_to = [{ address: s.replyTo }];
    if (msg.attachments) body.attachments = msg.attachments.map(function (a) {
      return { name: a.getName(), mime_type: a.getContentType(), content: Utilities.base64Encode(a.getBytes()) };
    });
    return {
      url: 'https://api.zeptomail.' + (prop_('ZEPTO_DC') || 'in') + '/v1.1/email',
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: token, Accept: 'application/json' },
      payload: JSON.stringify(body)
    };
  }
  return null;
}

function sendGoogle_(msg, s) {
  var o = { to: msg.to, subject: msg.subject, htmlBody: msg.html, name: s.fromName };
  if (s.replyTo) o.replyTo = s.replyTo;
  if (msg.attachments) o.attachments = msg.attachments;
  MailApp.sendEmail(o);
}

// Sends a list of messages through one provider. Returns [{ok, error}] in the same order.
function deliver_(provider, msgs) {
  var s = mailSettings_();
  var out = [];
  if (provider === 'google') {
    msgs.forEach(function (m) {
      try { sendGoogle_(m, s); out.push({ ok: true }); }
      catch (e) { out.push({ ok: false, error: String(e.message || e).slice(0, 300) }); }
    });
    return out;
  }
  for (var i = 0; i < msgs.length; i += 10) {
    var chunk = msgs.slice(i, i + 10);
    var reqs;
    try { reqs = chunk.map(function (m) { return buildRequest_(provider, m, s); }); }
    catch (e) { chunk.forEach(function () { out.push({ ok: false, error: e.message }); }); continue; }
    var responses = UrlFetchApp.fetchAll(reqs);
    responses.forEach(function (r) {
      var code = r.getResponseCode();
      if (code >= 200 && code < 300) out.push({ ok: true });
      else out.push({ ok: false, error: ('HTTP ' + code + ' ' + r.getContentText()).slice(0, 300), retry: code === 429 || code >= 500 });
    });
    if (i + 10 < msgs.length) Utilities.sleep(400);
  }
  return out;
}

function todayKey_() {
  return 'MAIL_SENT_' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd');
}
function sentToday_() { return Number(prop_(todayKey_()) || 0); }
function addSent_(n) {
  if (!n) return;
  PropertiesService.getScriptProperties().setProperty(todayKey_(), String(sentToday_() + n));
}

/**
 * Queue a system (transactional) email and, quota permitting, send it straight away.
 * opts.attachments are only delivered when sent immediately (they cannot be queued).
 */
function sendSystemEmail_(to, subject, html, name, opts) {
  opts = opts || {};
  var s = mailSettings_();
  var row = { id: Utilities.getUuid(), campaignId: '', kind: 'system', to: String(to).toLowerCase(), name: name || '',
              token: '', subject: subject, html: html.length > 45000 ? html.slice(0, 45000) : html, priority: 1,
              status: 'queued', attempts: 0, createdAt: now_() };
  if (sentToday_() < s.dailyLimit) {
    var r = deliver_(s.routeTx, [{ to: row.to, name: row.name, subject: subject, html: html, attachments: opts.attachments }])[0];
    row.attempts = 1;
    row.provider = s.routeTx;
    if (r.ok) { row.status = 'sent'; row.sentAt = now_(); addSent_(1); }
    else { row.status = 'retry'; row.error = r.error; }
  }
  writeRow_('MailQueue', QUEUE_COLS, row);
  return row.status;
}

/** Time-driven trigger: sends queued mail within the daily quota. */
function processMailQueue() {
  try { warmPdfs_(); } catch (e) {}
  try { if (typeof recordsHousekeeping_ === 'function') recordsHousekeeping_(); } catch (e) { log_('system', 'housekeepingFailed', '', e.message); }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  try {
    var s = mailSettings_();
    var remaining = s.dailyLimit - sentToday_();
    if (remaining <= 0) return;
    var rows = readRows_('MailQueue', QUEUE_COLS).filter(function (q) { return q.status === 'queued' || q.status === 'retry'; });
    if (!rows.length) return;
    rows.sort(function (a, b) { return Number(a.priority) - Number(b.priority) || String(a.createdAt).localeCompare(String(b.createdAt)); });
    rows = rows.slice(0, Math.min(remaining, s.batchSize));

    var campaigns = {};
    var byProvider = {};
    rows.forEach(function (q) {
      var msg;
      if (q.kind === 'campaign') {
        if (!campaigns[q.campaignId]) campaigns[q.campaignId] = readCampaign_(q.campaignId);
        var c = campaigns[q.campaignId];
        if (!c) { q.status = 'failed'; q.error = 'Campaign missing'; writeRow_('MailQueue', QUEUE_COLS, q); return; }
        var isTeam = q.token === 'team';
        msg = { to: q.to, name: q.name, subject: c.subject,
                html: personalise_(isTeam ? c.teamHtml : c.html, { name: q.name, token: isTeam ? '' : q.token }) };
      } else {
        msg = { to: q.to, name: q.name, subject: q.subject, html: q.html };
      }
      var provider = q.kind === 'campaign' ? s.routeBulk : s.routeTx;
      (byProvider[provider] = byProvider[provider] || []).push({ row: q, msg: msg });
    });

    Object.keys(byProvider).forEach(function (provider) {
      var items = byProvider[provider];
      var results = deliver_(provider, items.map(function (x) { return x.msg; }));
      var sent = 0;
      items.forEach(function (x, i) {
        var q = x.row, r = results[i];
        q.attempts = Number(q.attempts || 0) + 1;
        q.provider = provider;
        if (r.ok) { q.status = 'sent'; q.sentAt = now_(); q.error = ''; sent++; }
        else { q.status = q.attempts >= 3 ? 'failed' : 'retry'; q.error = r.error; }
        writeRow_('MailQueue', QUEUE_COLS, q);
      });
      addSent_(sent);
    });
  } finally {
    lock.releaseLock();
  }
}

function hasMailTrigger_() {
  try {
    return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'processMailQueue'; });
  } catch (e) { return false; }
}

function ensureMailTrigger_() {
  if (hasMailTrigger_()) return;
  ScriptApp.newTrigger('processMailQueue').timeBased().everyMinutes(5).create();
}

function mailStatus_(p, req) {
  requireMailer_(req);
  var s = mailSettings_();
  var counts = { queued: 0, retry: 0, failed: 0 };
  readRows_('MailQueue', QUEUE_COLS, 10).forEach(function (q) { if (counts[q.status] !== undefined) counts[q.status]++; });
  return { sentToday: sentToday_(), dailyLimit: s.dailyLimit, waiting: counts.queued + counts.retry, failed: counts.failed,
           routeTx: PROVIDERS[s.routeTx], routeBulk: PROVIDERS[s.routeBulk], fromAddress: s.fromAddress, triggerOn: hasMailTrigger_() };
}

function testProvider_(p, req) {
  var u = requireAdmin_(req);
  var provider = p.provider;
  if (!PROVIDERS[provider]) throw new Error('Unknown provider.');
  var to = String(p.to || u.email).trim();
  var html = renderEmail_({
    preheader: 'Test email from the ABR editorial portal',
    heading: 'It works',
    bodyHtml: '<p>This is a test email sent through <b>' + esc_(PROVIDERS[provider]) + '</b> from ' + esc_(mailSettings_().fromAddress) + '.</p>' +
              '<p>If it reached your inbox (not spam), this provider is ready to use.</p>',
    footer: 'team'
  });
  var r = deliver_(provider, [{ to: to, subject: 'ABR test email (' + PROVIDERS[provider] + ')', html: html }])[0];
  if (!r.ok) throw new Error('Sending failed: ' + r.error);
  addSent_(1);
  return { ok: true, to: to };
}

/* ------------------------------------------------------------------ */
/* Branded template                                                    */
/* ------------------------------------------------------------------ */

/**
 * o: { preheader, heading, bodyHtml, button: {label, url}, articles: [...], footer: 'subscriber'|'team'|'system' }
 * Placeholders kept for per-recipient merge: {{first_name}}, {{unsubscribe_url}}
 */
function renderEmail_(o) {
  var site = prop_('SITE_URL') || 'https://theabr.in';
  var s = mailSettings_();
  var font = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
  var body = emailize_(o.bodyHtml || '');

  var button = (o.button && o.button.label && /^https?:\/\//.test(o.button.url || ''))
    ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px"><tr><td style="background:#000000">' +
      '<a href="' + esc_(o.button.url) + '" style="display:inline-block;padding:14px 26px;font:700 15px ' + font + ';color:#ffffff;text-decoration:none">' +
      esc_(o.button.label) + ' &rarr;</a></td></tr></table>' : '';

  var articles = (o.articles || []).map(function (a) {
    var url = site + '/articles/' + a.slug;
    return '<tr><td style="padding:18px 0;border-top:1px solid #e2e0da">' +
      (a.coverUrl ? '<a href="' + url + '"><img src="' + esc_(a.coverUrl) + '" width="536" alt="" style="display:block;width:100%;max-width:536px;height:auto;margin:0 0 12px;border:0"></a>' : '') +
      '<div style="font:700 11px ' + font + ';letter-spacing:1.2px;text-transform:uppercase;color:#000">' + esc_(a.section || '') +
      (a.type ? ' <span style="color:#777">&nbsp;|&nbsp; ' + esc_(a.type) + '</span>' : '') + '</div>' +
      '<a href="' + url + '" style="display:block;margin:6px 0;font:800 20px/1.25 ' + font + ';color:#000;text-decoration:none;letter-spacing:-0.3px">' + esc_(a.title) + '</a>' +
      '<div style="font:15px/1.5 ' + font + ';color:#333">' + esc_(a.standfirst || '') + '</div>' +
      '<div style="font:13px ' + font + ';color:#777;margin-top:6px">' + esc_((a.authors || []).map(function (x) { return x.name || x; }).join(', ')) + '</div>' +
      '</td></tr>';
  }).join('');

  var footerLine = o.footer === 'subscriber'
    ? 'You are receiving this because you subscribed to Ahmedabad Business Review. <a href="{{unsubscribe_url}}" style="color:#555">Unsubscribe</a>.'
    : o.footer === 'team'
      ? 'You are receiving this as a member of the ABR team.'
      : 'This is an automated message from the ABR editorial system.';

  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light only"><title>' + esc_(o.heading || 'Ahmedabad Business Review') + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f2f0eb">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc_(o.preheader || '') + '&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f0eb"><tr><td align="center" style="padding:32px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff">' +
      '<tr><td style="padding:28px 32px 22px;border-bottom:3px solid #000000">' +
        '<a href="' + site + '"><img src="' + site + '/brand/logo/horizontal/ABR-Horizontal-Black.png" width="260" alt="Ahmedabad Business Review" style="display:block;width:260px;height:auto;border:0"></a>' +
      '</td></tr>' +
      '<tr><td style="padding:32px 32px 12px;font:16px/1.65 ' + font + ';color:#1a1a1a">' +
        (o.heading ? '<h1 style="margin:0 0 18px;font:800 28px/1.15 ' + font + ';letter-spacing:-0.6px;color:#000">' + esc_(o.heading) + '</h1>' : '') +
        body + button +
      '</td></tr>' +
      (articles ? '<tr><td style="padding:8px 32px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + articles + '</table></td></tr>' : '') +
      '<tr><td style="padding:22px 32px 28px;background:#000000;font:12px/1.6 ' + font + ';color:#bbbbbb">' +
        '<img src="' + site + '/brand/logo/horizontal/ABR-Horizontal-White.png" width="200" alt="Ahmedabad Business Review" style="display:block;width:200px;height:auto;border:0;margin-bottom:12px">' +
        'Published by Ahmedabad Centre for Research and Innovation, ' + esc_(s.postal) + '.<br>' +
        '<a href="' + site + '" style="color:#ffffff">theabr.in</a> &nbsp;·&nbsp; <a href="mailto:' + esc_(s.fromAddress) + '" style="color:#ffffff">' + esc_(s.fromAddress) + '</a><br><br>' +
        '<span style="color:#999999">' + footerLine.replace('color:#555', 'color:#ffffff') + '</span>' +
      '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

// Adds inline styles so editor HTML renders consistently in Gmail, Outlook and Apple Mail.
function emailize_(html) {
  var f = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
  var styles = {
    p: 'margin:0 0 16px;font:16px/1.65 ' + f + ';color:#1a1a1a',
    h2: 'margin:26px 0 10px;font:800 21px/1.25 ' + f + ';color:#000;letter-spacing:-0.3px',
    h3: 'margin:22px 0 8px;font:700 17px/1.3 ' + f + ';color:#000',
    blockquote: 'margin:20px 0;padding:2px 0 2px 18px;border-left:4px solid #000;font:600 18px/1.5 ' + f + ';color:#000',
    ul: 'margin:0 0 16px;padding-left:22px', ol: 'margin:0 0 16px;padding-left:22px',
    li: 'margin:0 0 6px;font:16px/1.6 ' + f + ';color:#1a1a1a',
    a: 'color:#000;text-decoration:underline',
    img: 'max-width:100%;height:auto;border:0;display:block',
    figure: 'margin:20px 0', figcaption: 'font:13px ' + f + ';color:#777;margin-top:6px',
    hr: 'border:0;border-top:1px solid #e2e0da;margin:24px 0'
  };
  return String(html).replace(/<(p|h2|h3|blockquote|ul|ol|li|a|img|figure|figcaption|hr)(\s[^>]*)?>/gi, function (m, tag, attrs) {
    attrs = (attrs || '').replace(/\sstyle="[^"]*"/i, '');
    return '<' + tag + attrs + ' style="' + styles[tag.toLowerCase()] + '">';
  });
}

function personalise_(html, q) {
  var site = prop_('SITE_URL') || 'https://theabr.in';
  var first = String(q.name || '').trim().split(/\s+/)[0] || 'there';
  return html.replace(/\{\{first_name\}\}/g, esc_(first))
             .replace(/\{\{unsubscribe_url\}\}/g, q.token ? site + '/unsubscribe?t=' + encodeURIComponent(q.token) : site);
}

/* ------------------------------------------------------------------ */
/* Campaigns                                                           */
/* ------------------------------------------------------------------ */

function mailArticles_(p, req) {
  requireMailer_(req);
  return publicList_({ limit: 30 }).articles;
}

function buildCampaignHtml_(p, footer) {
  var picks = [];
  if (p.articles && p.articles.length) {
    var all = publicList_({ limit: 100 }).articles;
    picks = p.articles.map(function (slug) { return all.filter(function (a) { return a.slug === slug; })[0]; }).filter(function (x) { return x; });
  }
  return renderEmail_({
    preheader: p.preheader, heading: p.heading, bodyHtml: p.body,
    button: { label: p.buttonLabel, url: p.buttonUrl }, articles: picks, footer: footer
  });
}

function campaignPreview_(p, req) {
  var u = requireMailer_(req);
  var aud = p.audience || [];
  var html = buildCampaignHtml_(p, aud.indexOf('subscribers') !== -1 ? 'subscriber' : 'team');
  return { html: personalise_(html, { name: u.name, token: '' }) };
}

function campaignTest_(p, req) {
  var u = requireMailer_(req);
  if (!p.subject) throw new Error('Add a subject.');
  var aud = p.audience || [];
  var html = personalise_(buildCampaignHtml_(p, aud.indexOf('subscribers') !== -1 ? 'subscriber' : 'team'), { name: u.name, token: '' });
  var r = deliver_(mailSettings_().routeBulk, [{ to: u.email, name: u.name, subject: '[TEST] ' + p.subject, html: html }])[0];
  if (!r.ok) throw new Error('Test failed: ' + r.error);
  addSent_(1);
  return { to: u.email };
}

function audienceRecipients_(audience, custom) {
  var map = {};
  var add = function (email, name, token, kind) { email = String(email).toLowerCase(); if (!map[email]) map[email] = { email: email, name: name, token: token || '', kind: kind }; };
  var team = readUsers_().filter(function (u) { return truthy_(u.active); });
  audience.forEach(function (a) {
    if (a === 'subscribers') readRows_('Subscribers', SUB_COLS).forEach(function (s) { if (s.status === 'active') add(s.email, s.name, s.token, 'subscriber'); });
    if (a === 'team') team.forEach(function (u) { add(u.email, u.name, '', 'team'); });
    if (a === 'editors') team.forEach(function (u) { if (u.role === 'eic' || u.role === 'editor') add(u.email, u.name, '', 'team'); });
    if (a === 'coo') team.forEach(function (u) { if (u.role === 'coo') add(u.email, u.name, '', 'team'); });
  });
  (custom || []).forEach(function (e) { var u = team.filter(function (x) { return x.email === String(e).toLowerCase(); })[0]; if (u) add(u.email, u.name, '', 'team'); });
  return Object.keys(map).map(function (k) { return map[k]; });
}

function campaignSend_(p, req) {
  var u = requireMailer_(req);
  if (!p.subject) throw new Error('Add a subject.');
  if (!p.body && !(p.articles && p.articles.length)) throw new Error('Write a message or pick at least one article.');
  var aud = (p.audience || []).filter(function (a) { return ['subscribers', 'team', 'editors', 'coo'].indexOf(a) !== -1; });
  var recips = audienceRecipients_(aud, p.custom);
  if (!recips.length) throw new Error('No recipients in the chosen audience.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var hasSubs = recips.some(function (r) { return r.kind === 'subscriber'; });
    var html = buildCampaignHtml_(p, hasSubs ? 'subscriber' : 'team');
    var teamHtml = hasSubs ? buildCampaignHtml_(p, 'team') : html;
    var id = 'C-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmmss');
    var c = { id: id, subject: String(p.subject).slice(0, 200), preheader: p.preheader || '', audience: aud.concat((p.custom || []).length ? ['custom'] : []).join(', '),
              createdBy: u.email, createdAt: now_(), total: recips.length };
    // Store both variants: subscriber copy (with unsubscribe) and team copy.
    var packed = JSON.stringify({ s: html, t: teamHtml });
    for (var i = 0; i < 4; i++) c['html_' + (i + 1)] = packed.slice(i * 45000, (i + 1) * 45000);
    if (packed.length > 180000) throw new Error('This email is too large. Remove some images or text.');
    writeRow_('Campaigns', CAMPAIGN_COLS, c);

    var sh = sheet_('MailQueue');
    var rows = recips.map(function (r) {
      return QUEUE_COLS.map(function (col) {
        return safe_({ id: Utilities.getUuid(), campaignId: id, kind: 'campaign', to: r.email, name: r.name, token: r.kind === 'subscriber' ? r.token : 'team',
                       subject: '', html: '', priority: r.kind === 'subscriber' ? 5 : 3, status: 'queued', attempts: 0, createdAt: now_(),
                       sentAt: '', error: '', provider: '' }[col]);
      });
    });
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, rows.length, QUEUE_COLS.length).setNumberFormat('@').setValues(rows);
    log_(u.email, 'mail.send', id, recips.length + ' recipients');
  } finally {
    lock.releaseLock();
  }
  try { processMailQueue(); } catch (e) {}
  var st = mailStatus_(p, req);
  st.campaignId = id; st.recipients = recips.length;
  return st;
}

function readCampaign_(id) {
  var rows = readRows_('Campaigns', CAMPAIGN_COLS).filter(function (c) { return c.id === id; });
  if (!rows.length) return null;
  var c = rows[0];
  var packed = safeJson_([c.html_1, c.html_2, c.html_3, c.html_4].join(''));
  c.html = packed.s || '';
  c.teamHtml = packed.t || c.html;
  return c;
}

function campaignList_(p, req) {
  requireMailer_(req);
  var stats = {};
  readRows_('MailQueue', QUEUE_COLS, 10).forEach(function (q) {
    if (!q.campaignId) return;
    var s = stats[q.campaignId] = stats[q.campaignId] || { sent: 0, waiting: 0, failed: 0 };
    if (q.status === 'sent') s.sent++; else if (q.status === 'failed') s.failed++; else s.waiting++;
  });
  return readRows_('Campaigns', CAMPAIGN_COLS, 7).reverse().slice(0, 100).map(function (c) {
    var s = stats[c.id] || { sent: 0, waiting: 0, failed: 0 };
    return { id: c.id, subject: c.subject, audience: c.audience, createdBy: c.createdBy, createdAt: c.createdAt,
             total: Number(c.total), sent: s.sent, waiting: s.waiting, failed: s.failed };
  });
}

function campaignRetry_(p, req) {
  requireMailer_(req);
  var n = 0;
  readRows_('MailQueue', QUEUE_COLS).forEach(function (q) {
    if (q.status === 'failed' && (!p.campaignId || q.campaignId === p.campaignId)) {
      q.status = 'queued'; q.attempts = 0; q.error = '';
      writeRow_('MailQueue', QUEUE_COLS, q); n++;
    }
  });
  return { requeued: n };
}

/* ------------------------------------------------------------------ */
/* Subscribers                                                         */
/* ------------------------------------------------------------------ */

function findSub_(email) {
  email = String(email || '').trim().toLowerCase();
  return readRows_('Subscribers', SUB_COLS).filter(function (s) { return s.email === email; })[0] || null;
}

function publicSubscribe_(p, req) {
  if (p.website) return { ok: true };                    // honeypot: bots fill hidden fields
  var email = String(p.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) || email.length > 200) throw new Error('Please enter a valid email address.');
  var ip = (req.meta && req.meta.ip) || 'unknown';
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get('subrl_' + ip) || 0);
  if (n >= 8) throw new Error('Too many attempts. Please try again later.');
  cache.put('subrl_' + ip, String(n + 1), 3600);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var sub;
  try {
    sub = findSub_(email);
    if (sub && sub.status === 'active') return { ok: true };
    sub = sub || { email: email, createdAt: now_() };
    sub.name = String(p.name || sub.name || '').trim().slice(0, 100);
    sub.status = 'pending';
    sub.token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    sub.source = String(p.source || 'site').slice(0, 40);
    sub.ip = ip;
    writeRow_('Subscribers', SUB_COLS, sub);
  } finally { lock.releaseLock(); }

  var site = prop_('SITE_URL') || 'https://theabr.in';
  sendSystemEmail_(email, 'Confirm your subscription to ABR', renderEmail_({
    preheader: 'One click to start receiving Ahmedabad Business Review',
    heading: 'Confirm your subscription',
    bodyHtml: '<p>Hello' + (sub.name ? ' ' + esc_(sub.name.split(' ')[0]) : '') + ',</p>' +
      '<p>Thank you for signing up to Ahmedabad Business Review. Please confirm your email address to start receiving our latest analysis on business, entrepreneurship, innovation and leadership.</p>' +
      '<p style="color:#777">If you didn’t sign up, ignore this email and you won’t hear from us.</p>',
    button: { label: 'Confirm subscription', url: site + '/subscribe/confirm?t=' + sub.token },
    footer: 'system'
  }), sub.name);
  return { ok: true };
}

function publicConfirm_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var sub;
  try {
    sub = readRows_('Subscribers', SUB_COLS).filter(function (s) { return s.token && s.token === String(p.token || ''); })[0];
    if (!sub) return null;
    if (sub.status === 'active') return { name: sub.name, already: true };
    sub.status = 'active';
    sub.confirmedAt = now_();
    writeRow_('Subscribers', SUB_COLS, sub);
  } finally { lock.releaseLock(); }
  var site = prop_('SITE_URL') || 'https://theabr.in';
  sendSystemEmail_(sub.email, 'Welcome to Ahmedabad Business Review', renderEmail_({
    preheader: 'You are subscribed to ABR',
    heading: 'Welcome to ABR',
    bodyHtml: '<p>You’re subscribed. We’ll send you new analysis, interviews and case studies from Ahmedabad Business Review.</p>' +
      '<p>Every ABR article is reviewed before publication, carries its sources, and can be cited. Read our <a href="' + site + '/editorial-standards">editorial standards</a>.</p>',
    button: { label: 'Read the latest', url: site },
    footer: 'subscriber'
  }).replace(/\{\{unsubscribe_url\}\}/g, site + '/unsubscribe?t=' + sub.token), sub.name);
  return { name: sub.name };
}

function publicUnsubscribe_(p) {
  var sub = readRows_('Subscribers', SUB_COLS).filter(function (s) { return s.token && s.token === String(p.token || ''); })[0];
  if (!sub) return null;
  if (sub.status !== 'unsubscribed') {
    sub.status = 'unsubscribed';
    sub.unsubscribedAt = now_();
    writeRow_('Subscribers', SUB_COLS, sub);
    // Cancel anything still waiting for this address.
    readRows_('MailQueue', QUEUE_COLS).forEach(function (q) {
      if (q.to === sub.email && q.kind === 'campaign' && (q.status === 'queued' || q.status === 'retry')) {
        q.status = 'cancelled'; writeRow_('MailQueue', QUEUE_COLS, q);
      }
    });
  }
  return { email: sub.email };
}

function subsList_(p, req) {
  requireMailer_(req);
  var rows = readRows_('Subscribers', SUB_COLS);
  var counts = { active: 0, pending: 0, unsubscribed: 0 };
  rows.forEach(function (s) { if (counts[s.status] !== undefined) counts[s.status]++; });
  return {
    counts: counts,
    subscribers: rows.reverse().map(function (s) {
      return { email: s.email, name: s.name, status: s.status, source: s.source, createdAt: s.createdAt, confirmedAt: s.confirmedAt };
    })
  };
}

function subsAdd_(p, req) {
  var u = requireMailer_(req);
  var email = String(p.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) throw new Error('Enter a valid email address.');
  if (!p.consent) throw new Error('Confirm that this person agreed to receive ABR emails.');
  var sub = findSub_(email) || { email: email, createdAt: now_() };
  sub.name = String(p.name || sub.name || '').trim();
  sub.status = 'active';
  sub.token = sub.token || (Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8));
  sub.source = 'added by ' + u.email;
  sub.confirmedAt = now_();
  writeRow_('Subscribers', SUB_COLS, sub);
  return subsList_(p, req);
}

function subsRemove_(p, req) {
  requireMailer_(req);
  var sub = findSub_(p.email);
  if (sub) { publicUnsubscribe_({ token: sub.token }); }
  return subsList_(p, req);
}

function safeJson_(t) { try { return JSON.parse(t); } catch (e) { return {}; } }
