/**
 * ABR records: password reset, terms of office, certificates, letters on letterhead,
 * open submissions and tracking, issues (volume/number) and Zenodo DOIs.
 */

var CERT_COLS   = ['id', 'type', 'name', 'email', 'role', 'detail', 'refId', 'issuedAt', 'issuedBy', 'status', 'note'];
var LETTER_COLS = ['id', 'token', 'date', 'toBlock', 'subject', 'body', 'closing', 'signName', 'signTitle', 'cc',
                   'issuedBy', 'issuedAt', 'status'];
var ISSUE_COLS  = ['key', 'volume', 'number', 'title', 'theme', 'status', 'articleIds', 'chairStatement',
                   'statements', 'coverStyle', 'publishedAt', 'updatedAt', 'compiledAt'];

var CERT_TYPES = {
  contributor: 'Certificate of Publication',
  term:        'Certificate of Service',
  issue:       'Certificate of Contribution',
  service:     'Certificate of Editorial Service',
  custom:      'Certificate'
};
var STATEMENT_ROLES = ['eic', 'coo', 'editor'];      // may add a statement to a draft issue (Chair writes the foreword)
var ANALYTICS_ROLES = ['chair', 'eic', 'coo'];
var COVER_STYLES = ['ink', 'saffron', 'indigo', 'forest', 'terracotta', 'slate'];

var RECORD_ROUTES = {
  // Accounts
  'auth.forgot':          authForgot_,
  'auth.resetWithToken':  authResetWithToken_,
  'analytics.authorize':  function (p, req) {
    var u = requireUser_(req);
    if (ANALYTICS_ROLES.indexOf(u.role) === -1) throw new Error('Analytics are available to the Chair, Editor-in-Chief and COO.');
    return { role: u.role };
  },

  // Open submissions and tracking
  'public.submit':        publicSubmit_,
  'public.track':         publicTrack_,
  'public.revise':        publicRevise_,

  // Certificates and letters
  'public.certificate':   publicCertificate_,
  'public.letter':        publicLetter_,
  'public.verify':        publicVerify_,
  'certs.list':           certsList_,
  'certs.issue':          certsIssueManual_,
  'certs.revoke':         certsRevoke_,
  'certs.serviceRun':     certsServiceRun_,
  'letters.list':         lettersList_,
  'letters.issue':        lettersIssue_,
  'letters.revoke':       lettersRevoke_,

  // Issues
  'public.issues':        publicIssues_,
  'public.issue':         publicIssue_,
  'issues.list':          issuesList_,
  'issues.save':          issuesSave_,
  'issues.assign':        issuesAssign_,
  'issues.statement':     issuesStatement_,
  'issues.publish':       issuesPublish_,
  'issues.reopen':        issuesReopen_,
  'issues.useStatement':  issuesUseStatement_,
  'issues.options':       function (p, req) { requireUser_(req); return readIssues_().map(function (i) { return { key: i.key, label: issueLabel_(i), status: i.status }; }); },

  // DOIs
  'doi.settings.get':     doiSettingsGet_,
  'doi.settings.save':    doiSettingsSave_,
  'doi.queue':            doiQueueManual_
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function site_() { return prop_('SITE_URL') || 'https://theabr.in'; }
function todayIST_() { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'); }
function fmtDateIST_(iso) {
  if (!iso) return '';
  var d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T12:00:00+05:30') : new Date(iso);
  return Utilities.formatDate(d, 'Asia/Kolkata', 'd MMMM yyyy');
}
function seq_(prefix) {
  var year = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy');
  var props = PropertiesService.getScriptProperties();
  var key = 'SEQ_' + prefix + '_' + year;
  var n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  return prefix + '-' + year + '-' + ('0000' + n).slice(-4);
}
function randomKey_(n) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Math.random());
  for (var i = 0; i < n; i++) out += chars.charAt((bytes[i % bytes.length] + 128 + i * 7) % chars.length);
  return out;
}
function rateLimit_(key, max, seconds, msg) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get('rl_' + key) || 0);
  if (n >= max) throw new Error(msg || 'Too many attempts. Please try again later.');
  cache.put('rl_' + key, String(n + 1), seconds);
}
function chairs_() {
  return readUsers_().filter(function (x) { return x.role === 'chair' && truthy_(x.active); });
}
function sheetRows_(name, cols) { return sheet_(name) ? readRows_(name, cols) : []; }
function systemMail_(to, subject, heading, bodyHtml, button) {
  try {
    sendSystemEmail_(to, subject, renderEmail_({ heading: heading, bodyHtml: bodyHtml, button: button, footer: 'system' }));
  } catch (e) { log_('system', 'mailFailed', '', to + ': ' + e.message); }
}

/* ------------------------------------------------------------------ */
/* Forgot password                                                     */
/* ------------------------------------------------------------------ */

function authForgot_(p, req) {
  var email = String(p.email || '').trim().toLowerCase();
  rateLimit_('forgot_' + ((req.meta && req.meta.ip) || 'x'), 10, 3600);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter your email address.');
  rateLimit_('forgot_' + email, 3, 3600, 'A reset link was already sent. Check your inbox (and spam), or try again in an hour.');
  var u = usersByEmail_()[email];
  if (u && truthy_(u.active)) {
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    CacheService.getScriptCache().put('reset_' + token, email, 3600);
    var url = site_() + '/portal/#/reset/' + token;
    systemMail_(email, 'Reset your ABR portal password', 'Reset your password',
      '<p>Someone (hopefully you) asked to reset the password for your ABR editorial portal account, <b>' + esc_(email) + '</b>.</p>' +
      '<p>The link works once and expires in 1 hour. If you did not ask for this, ignore this email; your password will not change.</p>',
      { label: 'Choose a new password', url: url });
    log_(email, 'password.forgot', '', '');
  }
  // Same answer whether or not the account exists, so the form cannot be used to discover accounts.
  return { sent: true };
}

function authResetWithToken_(p) {
  var token = String(p.token || '');
  var cache = CacheService.getScriptCache();
  var email = token ? cache.get('reset_' + token) : null;
  if (!email) throw new Error('This reset link has expired or was already used. Ask for a new one.');
  if (String(p.password || '').length < 8) throw new Error('New password must be at least 8 characters.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var u = usersByEmail_()[email];
    if (!u || !truthy_(u.active)) throw new Error('Account disabled.');
    u.salt = Utilities.getUuid();
    u.hash = hash_(String(p.password), u.salt);
    u.updatedAt = now_();
    writeRow_('Users', USER_COLS, u);
  } finally { lock.releaseLock(); }
  cache.remove('reset_' + token);
  log_(email, 'password.reset', '', 'self-service');
  return { email: email };
}

/* ------------------------------------------------------------------ */
/* Background jobs (called every 5 minutes from processMailQueue)      */
/* ------------------------------------------------------------------ */

function recordsHousekeeping_() {
  try { doiWorker_(); } catch (e) { log_('system', 'doiWorkerFailed', '', e.message); }
  var props = PropertiesService.getScriptProperties();
  var hour = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMddHH');
  if (props.getProperty('LAST_HOUSEKEEPING') === hour) return;
  props.setProperty('LAST_HOUSEKEEPING', hour);
  termsCheck_();
  if (typeof plannerReminders_ === 'function') {
    try { plannerReminders_(); } catch (e) { log_('system', 'plannerRemindFailed', '', e.message); }
  }
  if (typeof subscriberDigests_ === 'function') {
    try { subscriberDigests_(); } catch (e) { log_('system', 'digestFailed', '', e.message); }
  }
  // Annual editorial-service certificates for the year just ended (issued in January).
  var now = new Date();
  var y = Number(Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy'));
  if (Utilities.formatDate(now, 'Asia/Kolkata', 'MM') === '01' && !props.getProperty('SERVICE_DONE_' + (y - 1))) {
    serviceCerts_(y - 1, null, 'system');
    props.setProperty('SERVICE_DONE_' + (y - 1), now_());
  }
}

/* ------------------------------------------------------------------ */
/* Terms of office                                                     */
/* ------------------------------------------------------------------ */

function daysBetween_(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

function termsCheck_() {
  var today = todayIST_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    readUsers_().forEach(function (u) {
      if (TERM_ROLES.indexOf(u.role) === -1 || !u.termEnd || !truthy_(u.active)) return;
      var left = daysBetween_(today, u.termEnd);
      var office = ROLES[u.role];
      if (left < 0) {
        endTerm_(u, 'system');
        return;
      }
      var due = left <= 7 ? '7' : left <= 30 ? '30' : '';
      if (due && u.termReminded !== due && !(due === '30' && u.termReminded === '7')) {
        u.termReminded = due;
        writeRow_('Users', USER_COLS, u);
        var when = fmtDateIST_(u.termEnd);
        systemMail_(u.email, 'Your term as ' + office + ' ends on ' + when, 'Your term ends on ' + when,
          '<p>Your term as <b>' + esc_(office) + '</b> of Ahmedabad Business Review ends on <b>' + when + '</b> (' + left + ' day' + (left === 1 ? '' : 's') + ' from now).</p>' +
          '<p>When it ends you will receive a certificate of service and your portal role will change to Editor, unless the Chair re-appoints you.</p>');
        chairs_().forEach(function (c) {
          systemMail_(c.email, 'Term ending: ' + u.name + ' (' + office + ')', 'A term is ending soon',
            '<p><b>' + esc_(u.name) + '</b>’s term as <b>' + esc_(office) + '</b> ends on <b>' + when + '</b>.</p>' +
            '<p>To re-appoint them, open Team in the portal and set a new term end date. To appoint someone else, change roles there before the term ends.</p>' + portalLink_());
        });
      }
    });
  } finally { lock.releaseLock(); }
}

function endTerm_(u, by) {
  var office = ROLES[u.role];
  var start = u.termStart || String(u.createdAt || '').slice(0, 10);
  var end = u.termEnd;
  var cert = issueCert_({ type: 'term', name: u.name, email: u.email, role: office, refId: 'term:' + u.role + ':' + end,
    detail: { office: office, start: start, end: end } }, by);
  u.role = 'editor';
  u.title = ROLES.editor;
  u.termStart = ''; u.termEnd = ''; u.termReminded = '';
  u.updatedAt = now_();
  writeRow_('Users', USER_COLS, u);
  log_(by, 'term.end', '', u.email + ' (' + office + ')');
  systemMail_(u.email, 'Thank you for serving as ' + office, 'Thank you, ' + String(u.name).split(' ')[0],
    '<p>Your term as <b>' + esc_(office) + '</b> of Ahmedabad Business Review ended on <b>' + fmtDateIST_(end) + '</b>. Thank you for your service.</p>' +
    '<p>Your certificate of service is ready. You remain on the team as an Editor and can keep writing in the portal.</p>',
    cert ? { label: 'View your certificate', url: site_() + '/certificates/' + cert.id } : null);
  chairs_().forEach(function (c) {
    systemMail_(c.email, 'Office vacant: ' + office, office + ' is now vacant',
      '<p><b>' + esc_(u.name) + '</b>’s term as <b>' + esc_(office) + '</b> has ended. They are now an Editor and have received a certificate of service.</p>' +
      '<p>Please appoint a new ' + esc_(office) + ', or re-appoint ' + esc_(u.name) + ', from Team in the portal.</p>' + portalLink_());
  });
  return cert;
}

/* ------------------------------------------------------------------ */
/* Certificates                                                        */
/* ------------------------------------------------------------------ */

function readCerts_() { return sheetRows_('Certificates', CERT_COLS); }

// Issues a certificate unless an identical one (same type, person and reference) exists.
function issueCert_(c, by) {
  if (!sheet_('Certificates')) return null;
  var email = String(c.email || '').toLowerCase();
  var dupe = readCerts_().filter(function (x) {
    return x.type === c.type && x.refId === String(c.refId || '') && x.status !== 'revoked' &&
           (email ? x.email === email : x.name === c.name);
  })[0];
  if (dupe) return dupe;
  var row = { id: seq_('ABRC'), type: c.type, name: String(c.name || '').trim(), email: email, role: c.role || '',
              detail: JSON.stringify(c.detail || {}), refId: String(c.refId || ''), issuedAt: now_(),
              issuedBy: by || 'system', status: 'valid', note: '' };
  writeRow_('Certificates', CERT_COLS, row);
  log_(by || 'system', 'cert.issue', c.refId && /^ABR-/.test(c.refId) ? c.refId : '', row.id + ' ' + row.type + ' → ' + row.name);
  if (email && c.notify !== false) {
    systemMail_(email, 'Your certificate from Ahmedabad Business Review', 'Your ' + CERT_TYPES[row.type],
      '<p>Dear ' + esc_(row.name) + ',</p><p>Ahmedabad Business Review has issued you a <b>' + esc_(CERT_TYPES[row.type]) + '</b> (' + row.id + ').</p>' +
      '<p>You can view, download and share it at the link below. Anyone can confirm it is genuine at ' + esc_(site_()) + '/verify.</p>',
      { label: 'View certificate', url: site_() + '/certificates/' + row.id });
  }
  return row;
}

function certPublic_(x) {
  return { id: x.id, type: x.type, typeLabel: CERT_TYPES[x.type] || 'Certificate', name: x.name, role: x.role,
           detail: safeParse_(x.detail) || {}, issuedAt: x.issuedAt, status: x.status, note: x.status === 'revoked' ? x.note : '' };
}

function publicCertificate_(p) {
  var x = readCerts_().filter(function (c) { return c.id === String(p.id || '').toUpperCase(); })[0];
  if (!x) return null;
  var v = certPublic_(x);
  var chair = chairs_()[0];
  v.signatory = chair ? { name: chair.name, title: chair.title || ROLES.chair } : { name: '', title: ROLES.chair };
  if (typeof chairSignatureFor_ === 'function' && x.status === 'valid') v.signature = chairSignatureFor_('certificates');
  return v;
}

function certsList_(p, req) {
  requireAdmin_(req);
  return readCerts_().sort(byDateDesc_('issuedAt')).map(function (x) {
    var v = certPublic_(x); v.email = x.email; v.issuedBy = x.issuedBy; return v;
  });
}

function certsIssueManual_(p, req) {
  var u = requireAdmin_(req);
  if (!CERT_TYPES[p.type]) throw new Error('Unknown certificate type.');
  var name = String(p.name || '').trim();
  if (!name) throw new Error('Enter the recipient’s name.');
  var detail = {};
  if (p.type === 'custom') {
    detail.heading = String(p.heading || 'Certificate of Recognition').slice(0, 80);
    detail.text = String(p.text || '').trim().slice(0, 600);
    if (!detail.text) throw new Error('Write what the certificate is for.');
  } else if (p.type === 'term') {
    detail = { office: String(p.office || '').trim(), start: String(p.start || ''), end: String(p.end || '') };
    if (!detail.office || !detail.start || !detail.end) throw new Error('Office, start and end dates are required.');
  } else if (p.type === 'service') {
    detail = { office: String(p.office || 'Editor'), from: String(p.from || ''), to: String(p.to || ''), year: String(p.year || '') };
  } else {
    var a = findArticle_(String(p.articleId || ''), false);
    if (a.status !== 'published') throw new Error('That article is not published.');
    detail = { title: a.title, articleId: a.id, slug: a.slug, publishedAt: a.publishedAt };
  }
  var cert = issueCert_({ type: p.type, name: name, email: p.email, role: p.role || '', detail: detail,
                          refId: 'manual:' + Utilities.getUuid().slice(0, 8), notify: !!p.email }, u.email);
  return certPublic_(cert);
}

function certsRevoke_(p, req) {
  var u = requireAdmin_(req);
  var x = readCerts_().filter(function (c) { return c.id === p.id; })[0];
  if (!x) throw new Error('Certificate not found.');
  var reason = String(p.reason || '').trim();
  if (!reason) throw new Error('Give a reason. It is shown on the verification page.');
  x.status = 'revoked'; x.note = reason;
  writeRow_('Certificates', CERT_COLS, x);
  log_(u.email, 'cert.revoke', '', x.id + ': ' + reason);
  return certsList_(p, req);
}

function serviceCerts_(year, emails, by, manual) {
  var out = [];
  readUsers_().forEach(function (u) {
    if (!truthy_(u.active) || u.role === 'chair') return;
    if (emails && emails.indexOf(u.email) === -1) return;
    var joined = String(u.createdAt || '').slice(0, 10);
    if (!manual && joined > year + '-09-30') return;          // automatic run: at least three months in the year
    if (joined && joined > year + '-12-31') return;
    var from = joined && joined > year + '-01-01' ? joined : year + '-01-01';
    var c = issueCert_({ type: 'service', name: u.name, email: u.email, role: u.title || ROLES[u.role],
      refId: 'service:' + year, detail: { office: u.title || ROLES[u.role], from: from, to: year + '-12-31', year: String(year) } }, by);
    if (c) out.push(c.id);
  });
  return out;
}

function certsServiceRun_(p, req) {
  var u = requireAdmin_(req);
  var year = Number(p.year);
  if (!(year >= 2020 && year <= 2100)) throw new Error('Choose a year.');
  var ids = serviceCerts_(year, Array.isArray(p.emails) && p.emails.length ? p.emails : null, u.email, true);
  return { issued: ids.length };
}

/* ------------------------------------------------------------------ */
/* Letters on letterhead                                               */
/* ------------------------------------------------------------------ */

function readLetters_() { return sheetRows_('Letters', LETTER_COLS); }

function lettersList_(p, req) {
  requireAdmin_(req);
  return readLetters_().sort(byDateDesc_('issuedAt')).map(function (x) {
    var v = {}; LETTER_COLS.forEach(function (c) { v[c] = x[c]; });
    v.url = site_() + '/letters/' + x.id + '?k=' + x.token;
    return v;
  });
}

function lettersIssue_(p, req) {
  var u = requireAdmin_(req);
  var subject = String(p.subject || '').trim(), body = String(p.body || '').trim();
  if (!subject || !body) throw new Error('A letter needs a subject and a body.');
  if (body.length > 20000) throw new Error('The letter is too long.');
  var date = String(p.date || '').trim() || todayIST_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must be YYYY-MM-DD.');
  var row = {
    id: seq_('ABRL'), token: randomKey_(16), date: date,
    toBlock: String(p.toBlock || '').trim().slice(0, 600), subject: subject.slice(0, 250), body: body,
    closing: String(p.closing || 'Yours sincerely,').trim().slice(0, 80),
    signName: String(p.signName || u.name).trim(), signTitle: String(p.signTitle || u.title || ROLES.chair).trim(),
    cc: String(p.cc || '').trim().slice(0, 400), issuedBy: u.email, issuedAt: now_(), status: 'issued'
  };
  writeRow_('Letters', LETTER_COLS, row);
  log_(u.email, 'letter.issue', '', row.id + ': ' + row.subject);
  return lettersList_(p, req)[0];
}

function lettersRevoke_(p, req) {
  var u = requireAdmin_(req);
  var x = readLetters_().filter(function (l) { return l.id === p.id; })[0];
  if (!x) throw new Error('Letter not found.');
  x.status = 'revoked';
  writeRow_('Letters', LETTER_COLS, x);
  log_(u.email, 'letter.revoke', '', x.id);
  return lettersList_(p, req);
}

// The full letter needs its private key (k); the verify page only confirms it exists.
function publicLetter_(p) {
  var x = readLetters_().filter(function (l) { return l.id === String(p.id || '').toUpperCase(); })[0];
  if (!x || !p.key || p.key !== x.token) return null;
  var v = {}; LETTER_COLS.forEach(function (c) { if (c !== 'token' && c !== 'issuedBy') v[c] = x[c]; });
  var chair = chairs_()[0];
  if (typeof chairSignatureFor_ === 'function' && x.status === 'issued' && chair && chair.name === x.signName) v.signature = chairSignatureFor_('letters');
  return v;
}

function publicVerify_(p, req) {
  rateLimit_('verify_' + ((req.meta && req.meta.ip) || 'x'), 60, 3600);
  var ref = String(p.ref || '').trim().toUpperCase();
  if (/^ABRC-/.test(ref)) {
    var c = readCerts_().filter(function (x) { return x.id === ref; })[0];
    return c ? { kind: 'certificate', record: certPublic_(c) } : { kind: 'none' };
  }
  if (/^ABRL-/.test(ref)) {
    var l = readLetters_().filter(function (x) { return x.id === ref; })[0];
    return l ? { kind: 'letter', record: { id: l.id, date: l.date, subject: l.subject, to: String(l.toBlock).split('\n')[0],
                                            signName: l.signName, signTitle: l.signTitle, status: l.status } } : { kind: 'none' };
  }
  if (/^ABRA-/.test(ref) && typeof approvalVerify_ === 'function') return approvalVerify_(ref);
  if (/^ABRP-/.test(ref) && typeof permVerify_ === 'function') return permVerify_(ref);
  if (/^ABR-\d{4}-\d{4}$/.test(ref)) {
    var a = readMeta_().filter(function (x) { return x.id === ref && x.status === 'published'; })[0];
    return a ? { kind: 'article', record: { id: a.id, title: a.title, slug: a.slug, publishedAt: a.publishedAt } } : { kind: 'none' };
  }
  return { kind: 'none' };
}

/* ------------------------------------------------------------------ */
/* Article events: publication certificates, contributor emails, DOIs  */
/* ------------------------------------------------------------------ */

function onPublished_(a, by) {
  var url = site_() + '/articles/' + a.slug;
  if (a.byline !== 'abr') {
    if (a.source === 'external') {
      var c = safeParse_(a.contributor) || {};
      if (c.email) {
        systemMail_(c.email, 'Published: ' + a.title, 'Your article is published',
          '<p>Dear ' + esc_(c.name) + ',</p><p>Your article <b>' + esc_(a.title) + '</b> (' + a.id + ') has been accepted and published in Ahmedabad Business Review. Thank you for writing for us.</p>' +
          '<p>Your certificate of publication will arrive in a separate email.</p>', { label: 'Read your article', url: url });
        issueCert_({ type: 'contributor', name: c.name, email: c.email, role: 'Contributor', refId: a.id,
          detail: { title: a.title, articleId: a.id, slug: a.slug, publishedAt: a.publishedAt } }, by.email);
      }
    } else {
      var users = usersByEmail_();
      authorEmails_(a).forEach(function (e) {
        var x = users[e];
        if (!x) return;
        issueCert_({ type: 'contributor', name: x.name, email: x.email, role: x.title || ROLES[x.role], refId: a.id,
          detail: { title: a.title, articleId: a.id, slug: a.slug, publishedAt: a.publishedAt } }, by.email);
      });
    }
  }
  if (doiEnabled_() && a.partnerType !== 'promoted' && !a.doi) doiEnqueue_(a.id);
  if (typeof subscriberArticleAlert_ === 'function') {
    try { subscriberArticleAlert_(a); } catch (e) { log_('system', 'subsAlertFailed', a.id, e.message); }
  }
}

function onSentBack_(a, note) {
  if (a.source !== 'external') return;
  var c = safeParse_(a.contributor) || {};
  if (!c.email) return;
  var changes = a.status === 'changes_requested';
  systemMail_(c.email, (changes ? 'Changes requested: ' : 'Decision on your submission: ') + a.title,
    changes ? 'The editors would like some changes' : 'Thank you for your submission',
    '<p>Dear ' + esc_(c.name) + ',</p>' +
    (changes ? '<p>The editors have read <b>' + esc_(a.title) + '</b> (' + a.id + ') and would like some changes before it can be published.</p>'
             : '<p>Thank you for submitting <b>' + esc_(a.title) + '</b> (' + a.id + '). After careful reading, the editors are not able to publish it.</p>') +
    '<p><b>Note from the editors:</b><br>' + esc_(note).replace(/\n/g, '<br>') + '</p>' +
    (changes ? '<p>You can send your revised version from the tracking page.</p>' : ''),
    { label: changes ? 'Revise your submission' : 'View submission', url: trackUrl_(a) });
}

/* ------------------------------------------------------------------ */
/* Open submissions and tracking                                       */
/* ------------------------------------------------------------------ */

function trackUrl_(a) { return site_() + '/track?id=' + encodeURIComponent(a.id) + '&key=' + encodeURIComponent(a.trackKey); }

function textToHtml_(t) {
  t = String(t || '').trim();
  if (/<(p|h2|h3|ul|ol|blockquote)\b/i.test(t)) return t;
  return t.split(/\n\s*\n/).map(function (b) { return '<p>' + esc_(b.trim()).replace(/\n/g, '<br>') + '</p>'; }).join('\n');
}

function publicSubmit_(p, req) {
  if (p.website) return { id: 'ABR-0000-0000', ok: true };                 // honeypot: bots fill hidden fields
  rateLimit_('submit_' + ((req.meta && req.meta.ip) || 'x'), 4, 21600, 'Too many submissions from this connection. Please try again later.');
  var name = String(p.name || '').trim(), email = String(p.email || '').trim().toLowerCase();
  if (name.length < 2) throw new Error('Enter your full name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
  var d = p.declarations || {};
  if (!(d.original && d.exclusive && d.edit && d.guidelines)) throw new Error('Please confirm all the declarations.');
  if (p.requireLicence && !d.licence) throw new Error('Please confirm the publishing licence declaration.');
  var title = String(p.title || '').trim();
  if (title.length < 8) throw new Error('Add a title.');
  if (p.section && SECTIONS.indexOf(p.section) === -1) throw new Error('Unknown section.');
  if (p.type && (TYPES.indexOf(p.type) === -1 || p.type === 'Interview')) throw new Error('Unknown article type.');
  var body = textToHtml_(p.body);
  var words = countWords_(body);
  if (words < 400) throw new Error('Articles should be at least 400 words (yours has ' + words + ').');
  if (words > 5000) throw new Error('Articles should be under 5,000 words (yours has ' + words + ').');
  if (body.length > BODY_CHUNKS * CHUNK_SIZE) throw new Error('The article is too long.');
  var sources = splitLines_(p.sources);
  if (REFERENCED_TYPES.indexOf(p.type) !== -1 && sources.length < MIN_REFERENCES) {
    throw new Error('Add at least ' + MIN_REFERENCES + ' references (one per line).');
  }
  var pending = readMeta_().filter(function (a) {
    return a.source === 'external' && a.status === 'submitted' && (safeParse_(a.contributor) || {}).email === email;
  }).length;
  if (pending >= 2) throw new Error('You already have two submissions under review. Please wait for a decision first.');

  var a;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    a = {
      id: nextId_(), status: 'submitted', authorEmail: '', coAuthors: '', source: 'external', trackKey: randomKey_(8),
      contributor: JSON.stringify({ name: name.slice(0, 120), email: email, affiliation: String(p.affiliation || '').trim().slice(0, 160),
                                    bio: String(p.bio || '').trim().slice(0, 500), phone: String(p.phone || '').trim().slice(0, 30),
                                    licenceAccepted: d.licence ? now_() : '' }),
      title: title.slice(0, 250), standfirst: String(p.standfirst || '').trim().slice(0, 600),
      section: p.section || '', type: p.type || '', tags: '', coverUrl: '', coverCaption: '',
      sources: sources.join('\n'), disclosure: String(p.disclosure || '').trim().slice(0, 1000), correction: '',
      body: body, wordCount: words, byline: '', createdAt: now_(), updatedAt: now_(), submittedAt: now_()
    };
    writeArticle_(a);
  } finally { lock.releaseLock(); }
  log_('external:' + email, 'submit-external', a.id, name);
  systemMail_(email, 'We received your submission: ' + a.title, 'Submission received',
    '<p>Dear ' + esc_(name) + ',</p><p>Thank you for submitting <b>' + esc_(a.title) + '</b> to Ahmedabad Business Review.</p>' +
    '<p>Your tracking ID is <b style="font-family:monospace">' + a.id + '</b>. You can follow its progress any time by signing in at ' + esc_(site_()) + '/write, or with the private link below.</p>' +
    '<p>Our editors read every submission. You will hear from us by email when there is a decision.</p>', { label: 'Track your submission', url: trackUrl_(a) });
  chairs_().forEach(function (c) {
    notify_(c.email, 'New outside submission: ' + a.title,
      '<p><b>' + esc_(name) + '</b> (' + esc_(email) + ') submitted <b>' + esc_(a.title) + '</b> (' + a.id + ', ' + words + ' words). It is in the Approval queue.</p>' + portalLink_());
  });
  return { id: a.id, trackUrl: trackUrl_(a) };
}

function findExternal_(p) {
  var a = readMeta_().filter(function (x) { return x.id === String(p.id || '').trim().toUpperCase(); })[0];
  if (!a || a.source !== 'external' || !p.key || String(p.key).toUpperCase() !== a.trackKey) {
    throw new Error('We could not find a submission with that tracking ID and key. Check the link in your confirmation email.');
  }
  return a;
}

var TRACK_LABELS = {
  'submit-external':   'Submission received',
  'revise-external':   'Revised version received',
  'changes_requested': 'Changes requested by the editors',
  'rejected':          'Not accepted for publication',
  'publish':           'Accepted and published',
  'withdraw':          'Withdrawn after publication',
  'issue.assign':      'Included in an issue'
};

function publicTrack_(p, req) {
  rateLimit_('track_' + ((req.meta && req.meta.ip) || 'x'), 60, 3600);
  return trackView_(findExternal_(p));
}

function trackView_(a) {
  var steps = articleEvents_(a.id).filter(function (e) { return TRACK_LABELS[e.action]; }).map(function (e) {
    return { at: e.time, label: TRACK_LABELS[e.action],
             note: (e.action === 'changes_requested' || e.action === 'rejected' || e.action === 'withdraw') ? e.note : '' };
  });
  var cert = a.status === 'published' ? readCerts_().filter(function (c) { return c.type === 'contributor' && c.refId === a.id && c.status === 'valid'; })[0] : null;
  var c = safeParse_(a.contributor) || {};
  return {
    id: a.id, title: a.title, status: a.status, name: c.name, submittedAt: a.submittedAt,
    url: a.status === 'published' ? site_() + '/articles/' + a.slug : '',
    certificate: cert ? cert.id : '', steps: steps,
    canRevise: a.status === 'changes_requested', note: a.status === 'changes_requested' || a.status === 'rejected' ? a.reviewNote : ''
  };
}

function publicRevise_(p, req) {
  rateLimit_('revise_' + ((req.meta && req.meta.ip) || 'x'), 6, 21600);
  var meta = findExternal_(p);
  if (meta.status !== 'changes_requested') throw new Error('This submission is not waiting for a revision.');
  var a = readFull_(meta._row);
  var body = textToHtml_(p.body);
  var words = countWords_(body);
  if (words < 400) throw new Error('The revised article should be at least 400 words.');
  if (body.length > BODY_CHUNKS * CHUNK_SIZE) throw new Error('The article is too long.');
  if (p.title) a.title = String(p.title).trim().slice(0, 250);
  if (p.standfirst !== undefined) a.standfirst = String(p.standfirst).trim().slice(0, 600);
  if (p.sources !== undefined && String(p.sources).trim()) a.sources = splitLines_(p.sources).join('\n');
  a.body = body; a.wordCount = words;
  a.status = 'submitted'; a.submittedAt = now_(); a.updatedAt = now_();
  writeArticle_(a);
  log_('external:' + (safeParse_(a.contributor) || {}).email, 'revise-external', a.id, String(p.message || '').slice(0, 500));
  chairs_().forEach(function (c) {
    notify_(c.email, 'Revision received: ' + a.title,
      '<p>The contributor sent a revised version of <b>' + esc_(a.title) + '</b> (' + a.id + '). It is back in the Approval queue.</p>' +
      (p.message ? '<p><b>Their note:</b> ' + esc_(p.message) + '</p>' : '') + portalLink_());
  });
  return publicTrack_(p, req);
}

/* Article timeline, built from the audit log. */
function articleEvents_(id) {
  var sh = sheet_('AuditLog');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues()
    .filter(function (r) { return String(r[3]) === id; })
    .map(function (r) { return { time: cell_(r[0]), email: cell_(r[1]), action: cell_(r[2]), note: cell_(r[4]) }; });
}

var TIMELINE_LABELS = {
  create: 'Draft created', save: null, submit: 'Submitted for approval', withdrawSubmission: 'Submission withdrawn by author',
  'submit-external': 'Received from outside contributor', 'revise-external': 'Revision received from contributor',
  import: 'Imported', 'ai.draft': 'AI draft generated', changes_requested: 'Changes requested', rejected: 'Not accepted',
  publish: 'Approved and published', withdraw: 'Withdrawn (retraction notice)', 'issue.assign': 'Assigned to issue',
  'cert.issue': 'Certificate issued', 'doi.reserved': 'DOI reserved', 'doi.published': 'DOI registered', 'doi.error': 'DOI error'
};

function articleTimeline_(id) {
  var users = usersByEmail_();
  var saves = 0, lastSave = '';
  var out = [];
  articleEvents_(id).forEach(function (e) {
    if (e.action === 'save') { saves++; lastSave = e.time; return; }
    var label = TIMELINE_LABELS[e.action];
    if (!label) return;
    var who = /^external:/.test(e.email) ? 'Contributor' : e.email === 'system' ? 'System' : (users[e.email] ? users[e.email].name : e.email);
    out.push({ at: e.time, label: label, by: who, note: e.note || '' });
  });
  if (saves) out.push({ at: lastSave, label: 'Edited (' + saves + ' save' + (saves > 1 ? 's' : '') + ')', by: '', note: '' });
  return out.sort(function (x, y) { return String(x.at).localeCompare(String(y.at)); });
}

/* ------------------------------------------------------------------ */
/* Issues                                                              */
/* ------------------------------------------------------------------ */

function readIssues_() {
  return sheetRows_('Issues', ISSUE_COLS).sort(function (a, b) {
    return Number(b.volume) - Number(a.volume) || Number(b.number) - Number(a.number);
  });
}
function findIssue_(key) {
  var i = readIssues_().filter(function (x) { return x.key === key; })[0];
  if (!i) throw new Error('Issue not found.');
  return i;
}
var MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function issueYear_(vol) { return Number(prop_('VOLUME_START_YEAR') || 2026) + Number(vol) - 1; }
function issueMonths_(num) {
  var per = Number(prop_('ISSUES_PER_YEAR') || 6), span = 12 / per, first = (Number(num) - 1) * span;
  return span === 1 ? MONTHS_[first] : MONTHS_[first] + '–' + MONTHS_[first + span - 1];
}
function issueLabel_(i) {
  return 'Vol. ' + i.volume + ', No. ' + i.number + ' (' + issueMonths_(i.number) + ' ' + issueYear_(i.volume) + ')' + (i.title ? ' · ' + i.title : '');
}

function issueView_(i, users, metas, withBodies) {
  var ids = safeParse_(i.articleIds) || [];
  var byId = {};
  metas.forEach(function (a) { byId[a.id] = a; });
  var articles = ids.map(function (id) { return byId[id]; }).filter(function (a) { return a && a.status === 'published'; })
    .map(function (a) { return publicView_(withBodies ? readFull_(a._row) : a, users, withBodies); });
  return {
    key: i.key, volume: Number(i.volume), number: Number(i.number), year: issueYear_(i.volume), months: issueMonths_(i.number),
    label: issueLabel_(i), title: i.title, theme: i.theme, status: i.status, coverStyle: i.coverStyle || 'ink',
    chairStatement: i.chairStatement, statements: safeParse_(i.statements) || [],
    publishedAt: i.publishedAt, compiledAt: i.compiledAt || i.publishedAt, articles: articles
  };
}

function publicIssues_() {
  var users = usersByEmail_(), metas = readMeta_();
  return readIssues_().filter(function (i) { return i.status === 'published'; }).map(function (i) {
    var v = issueView_(i, users, metas, false);
    v.chairStatement = ''; v.statements = [];
    return v;
  });
}

function publicIssue_(p) {
  var i = readIssues_().filter(function (x) { return x.key === p.key && x.status === 'published'; })[0];
  if (!i) return null;
  var v = issueView_(i, usersByEmail_(), readMeta_(), !!p.full);
  v.statements = v.statements.filter(function (s) { return s.use !== false; })
    .map(function (s) { return { name: s.name, title: s.title, role: s.role, text: s.text }; });
  v.team = publicTeam_();
  v.licence = typeof contentLicence_ === 'function' ? contentLicence_() : null;
  var chair = chairs_()[0];
  v.chair = chair ? { name: chair.name, title: chair.title || ROLES.chair } : null;
  return v;
}

function issuesList_(p, req) {
  var u = requireUser_(req);
  var users = usersByEmail_(), metas = readMeta_();
  var list = readIssues_().map(function (i) {
    var v = issueView_(i, users, metas, false);
    v.articleIds = safeParse_(i.articleIds) || [];
    return v;
  });
  var out = { issues: list, coverStyles: COVER_STYLES, canManage: APPROVER_ROLES.indexOf(u.role) !== -1,
              canStatement: STATEMENT_ROLES.indexOf(u.role) !== -1 || APPROVER_ROLES.indexOf(u.role) !== -1 };
  if (out.canManage) {
    out.published = metas.filter(function (a) { return a.status === 'published'; }).sort(byDateDesc_('publishedAt'))
      .map(function (a) { return { id: a.id, title: a.title, section: a.section, publishedAt: a.publishedAt, issueKey: a.issueKey || '' }; });
  }
  return out;
}

function issuesSave_(p, req) {
  var u = requireApprover_(req);
  var vol = Math.floor(Number(p.volume)), num = Math.floor(Number(p.number));
  var per = Number(prop_('ISSUES_PER_YEAR') || 6);
  if (!(vol >= 1 && vol <= 99)) throw new Error('Volume must be a number from 1.');
  if (!(num >= 1 && num <= per)) throw new Error('Issue number must be from 1 to ' + per + '.');
  var key = 'v' + vol + 'n' + num;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var i = readIssues_().filter(function (x) { return x.key === (p.key || key); })[0];
    if (p.key && !i) throw new Error('Issue not found.');
    if (!p.key && i) throw new Error('Vol. ' + vol + ', No. ' + num + ' already exists.');
    var created = !i;
    if (!i) i = { key: key, volume: vol, number: num, status: 'draft', articleIds: '[]', statements: '[]', chairStatement: '' };
    if (i.status === 'published' && p.key) { /* title/theme/cover can still be corrected */ }
    i.title = String(p.title || '').trim().slice(0, 120);
    i.theme = String(p.theme || '').trim().slice(0, 400);
    i.coverStyle = COVER_STYLES.indexOf(p.coverStyle) !== -1 ? p.coverStyle : (i.coverStyle || 'ink');
    i.updatedAt = now_();
    if (i.status === 'published') i.compiledAt = now_();
    writeRow_('Issues', ISSUE_COLS, i);
    log_(u.email, 'issue.save', '', i.key);
  } finally { lock.releaseLock(); }
  if (created && p.invite !== false) inviteStatements_(i, u);
  return issuesList_(p, req);
}

// Invite the EiC, COO and editors to write an optional statement for a new issue.
function inviteStatements_(i, by) {
  readUsers_().filter(function (x) { return truthy_(x.active) && STATEMENT_ROLES.indexOf(x.role) !== -1; }).forEach(function (x) {
    notify_(x.email, 'Invitation: your statement for ' + issueLabel_(i),
      '<p>The Chair has opened <b>' + esc_(issueLabel_(i)) + '</b>' + (i.theme ? ', on the theme “' + esc_(i.theme) + '”' : '') + '.</p>' +
      '<p>As ' + esc_(x.title || ROLES[x.role]) + ', you are invited to write a short statement for the issue: what it covers, why it matters, or a note to readers (up to about 1,000 words). ' +
      'Statements the Chair selects are printed after the Chair’s foreword in the compiled issue and shown on the issue’s web page.</p>' +
      '<p>Open <b>Issues</b> in the portal to write yours. This is optional.</p>' + portalLink_());
  });
}

function issuesAssign_(p, req) {
  var u = requireApprover_(req);
  var i = findIssue_(p.key);
  var ids = (Array.isArray(p.articleIds) ? p.articleIds : []).map(String);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var metas = readMeta_();
    var byId = {};
    metas.forEach(function (a) { byId[a.id] = a; });
    ids.forEach(function (id) {
      if (!byId[id] || byId[id].status !== 'published') throw new Error(id + ' is not a published article.');
    });
    var old = safeParse_(i.articleIds) || [];
    // Remove articles from any other issue they were in, and clear the issue on articles taken out.
    readIssues_().forEach(function (other) {
      if (other.key === i.key) return;
      var list = safeParse_(other.articleIds) || [];
      var kept = list.filter(function (id) { return ids.indexOf(id) === -1; });
      if (kept.length !== list.length) { other.articleIds = JSON.stringify(kept); other.updatedAt = now_(); writeRow_('Issues', ISSUE_COLS, other); }
    });
    var changed = [];
    old.forEach(function (id) { if (ids.indexOf(id) === -1 && byId[id]) changed.push([id, '']); });
    ids.forEach(function (id) { if (byId[id].issueKey !== i.key) changed.push([id, i.key]); });
    changed.forEach(function (c) {
      var a = readFull_(byId[c[0]]._row);
      a.issueKey = c[1];
      writeArticle_(a);
      if (c[1]) { log_(u.email, 'issue.assign', a.id, issueLabel_(i)); queuePdfWarm_(a.slug); }
    });
    i.articleIds = JSON.stringify(ids);
    i.updatedAt = now_();
    if (i.status === 'published') i.compiledAt = now_();
    writeRow_('Issues', ISSUE_COLS, i);
  } finally { lock.releaseLock(); }
  return issuesList_(p, req);
}

function issuesStatement_(p, req) {
  var u = requireUser_(req);
  var isChair = APPROVER_ROLES.indexOf(u.role) !== -1;
  if (!isChair && STATEMENT_ROLES.indexOf(u.role) === -1) throw new Error('You cannot add a statement to this issue.');
  var i = findIssue_(p.key);
  if (i.status === 'published') throw new Error('This issue is already published. The Chair can reopen it to change statements.');
  var text = String(p.text || '').trim();
  if (text.length > 6000) throw new Error('Statements are limited to about 1,000 words.');
  if (isChair && p.as !== 'self') {
    i.chairStatement = text;
  } else {
    var list = (safeParse_(i.statements) || []).filter(function (s) { return s.email !== u.email; });
    var prev = (safeParse_(i.statements) || []).filter(function (s) { return s.email === u.email; })[0];
    if (text) list.push({ email: u.email, name: u.name, title: u.title || ROLES[u.role], role: u.role, text: text, at: now_(),
                          use: prev ? prev.use !== false : true });
    var order = ['eic', 'coo', 'editor'];
    list.sort(function (a, b) { return order.indexOf(a.role) - order.indexOf(b.role) || String(a.at).localeCompare(String(b.at)); });
    i.statements = JSON.stringify(list);
  }
  i.updatedAt = now_();
  writeRow_('Issues', ISSUE_COLS, i);
  log_(u.email, 'issue.statement', '', i.key);
  if (!isChair || p.as === 'self') {
    chairs_().forEach(function (c) {
      notify_(c.email, 'Statement ' + (text ? 'submitted' : 'withdrawn') + ' for ' + issueLabel_(i) + ': ' + u.name,
        '<p><b>' + esc_(u.name) + '</b> (' + esc_(u.title || ROLES[u.role]) + ') has ' + (text ? 'submitted a statement' : 'withdrawn their statement') +
        ' for <b>' + esc_(issueLabel_(i)) + '</b>.</p>' + (text ? '<p>It will be included unless you untick “Use in issue” on the Issues page.</p>' : '') + portalLink_());
    });
  }
  return issuesList_(p, req);
}

// Chair chooses which team statements are printed in the issue.
function issuesUseStatement_(p, req) {
  var u = requireApprover_(req);
  var i = findIssue_(p.key);
  var list = safeParse_(i.statements) || [];
  var s = list.filter(function (x) { return x.email === p.email; })[0];
  if (!s) throw new Error('Statement not found.');
  s.use = !!p.use;
  i.statements = JSON.stringify(list);
  i.updatedAt = now_();
  if (i.status === 'published') i.compiledAt = now_();
  writeRow_('Issues', ISSUE_COLS, i);
  log_(u.email, 'issue.statementUse', '', i.key + ' ' + p.email + ' ' + (s.use ? 'used' : 'not used'));
  return issuesList_(p, req);
}

function issuesPublish_(p, req) {
  var u = requireApprover_(req);
  var i = findIssue_(p.key);
  if (!String(i.chairStatement || '').trim()) throw new Error('Write the Chair’s foreword before publishing the issue.');
  var ids = safeParse_(i.articleIds) || [];
  if (!ids.length) throw new Error('Add at least one article to the issue.');
  var first = !i.publishedAt;
  var announce = first && typeof subscriberIssueAlert_ === 'function';
  i.status = 'published';
  if (!i.publishedAt) i.publishedAt = now_();
  i.compiledAt = now_();
  i.updatedAt = now_();
  writeRow_('Issues', ISSUE_COLS, i);
  log_(u.email, 'issue.publish', '', i.key);

  // Issue contributor certificates: one per person, listing their articles in the issue.
  var users = usersByEmail_();
  var metas = readMeta_(), byId = {};
  metas.forEach(function (a) { byId[a.id] = a; });
  var people = {};
  ids.forEach(function (id) {
    var a = byId[id];
    if (!a || a.byline === 'abr') return;
    var list = a.source === 'external' ? [safeParse_(a.contributor) || {}]
      : authorEmails_(a).map(function (e) { return users[e]; }).filter(function (x) { return x; });
    list.forEach(function (x) {
      if (!x.email) return;
      var k = String(x.email).toLowerCase();
      people[k] = people[k] || { name: x.name, email: k, role: x.title || (x.role ? ROLES[x.role] : 'Contributor'), titles: [] };
      people[k].titles.push(a.title);
    });
  });
  var issued = 0;
  Object.keys(people).forEach(function (k) {
    var x = people[k];
    if (issueCert_({ type: 'issue', name: x.name, email: x.email, role: x.role, refId: 'issue:' + i.key,
      detail: { issueKey: i.key, issueLabel: issueLabel_(i), articles: x.titles } }, u.email)) issued++;
  });
  var notified = 0;
  if (announce) { try { notified = subscriberIssueAlert_(i); } catch (e) { log_('system', 'subsIssueFailed', '', e.message); } }
  return { list: issuesList_(p, req), certificates: issued, first: first, subscribersNotified: notified };
}

function issuesReopen_(p, req) {
  var u = requireApprover_(req);
  var i = findIssue_(p.key);
  i.status = 'draft';
  i.updatedAt = now_();
  writeRow_('Issues', ISSUE_COLS, i);
  log_(u.email, 'issue.reopen', '', i.key);
  return issuesList_(p, req);
}

/* ------------------------------------------------------------------ */
/* DOIs through Zenodo                                                 */
/* Settings: ZENODO_TOKEN (personal access token with deposit:write    */
/* and deposit:actions), ZENODO_SANDBOX ('true' to test on             */
/* sandbox.zenodo.org), ZENODO_LICENSE, ZENODO_COMMUNITY (optional).   */
/* ------------------------------------------------------------------ */

function zenodoBase_() { return prop_('ZENODO_SANDBOX') === 'true' ? 'https://sandbox.zenodo.org' : 'https://zenodo.org'; }
function doiEnabled_() { return !!prop_('ZENODO_TOKEN') && prop_('ZENODO_ENABLED') !== 'false'; }

function doiSettingsGet_(p, req) {
  requireAdmin_(req);
  return { enabled: doiEnabled_(), tokenSet: !!prop_('ZENODO_TOKEN'), sandbox: prop_('ZENODO_SANDBOX') === 'true',
           license: prop_('ZENODO_LICENSE') || 'cc-by-nc-nd-4.0', community: prop_('ZENODO_COMMUNITY') || '',
           queue: (safeParse_(prop_('DOI_QUEUE')) || []).length };
}

function doiSettingsSave_(p, req) {
  var u = requireAdmin_(req);
  var props = PropertiesService.getScriptProperties();
  if (p.token) props.setProperty('ZENODO_TOKEN', String(p.token).trim());
  if (p.clearToken) props.deleteProperty('ZENODO_TOKEN');
  if (p.sandbox !== undefined) props.setProperty('ZENODO_SANDBOX', p.sandbox ? 'true' : 'false');
  if (p.enabled !== undefined) props.setProperty('ZENODO_ENABLED', p.enabled ? 'true' : 'false');
  if (p.license) props.setProperty('ZENODO_LICENSE', String(p.license).trim().toLowerCase());
  if (p.community !== undefined) props.setProperty('ZENODO_COMMUNITY', String(p.community).trim());
  log_(u.email, 'doi.settings', '', '');
  return doiSettingsGet_(p, req);
}

function doiQueueManual_(p, req) {
  requireAdmin_(req);
  if (!doiEnabled_()) throw new Error('Connect Zenodo in Settings first.');
  var n = 0;
  var targets = p.all ? readMeta_().filter(function (a) { return a.status === 'published' && !a.doi && a.partnerType !== 'promoted'; })
                      : [findArticle_(p.id, false)];
  targets.forEach(function (a) {
    if (a.status !== 'published' || a.doiState === 'published') return;
    var st = String(a.doiState || '').split('|');
    if (st[0] === 'error' || st[4]) {
      var f = readFull_(a._row);
      f.doiState = st[0] === 'reserved' ? [st[0], st[1], st[2], ''].join('|') : '';
      writeArticle_(f);
    }
    doiEnqueue_(a.id); n++;
  });
  return { queued: n };
}

function doiEnqueue_(id) {
  var props = PropertiesService.getScriptProperties();
  var q = safeParse_(props.getProperty('DOI_QUEUE')) || [];
  if (q.indexOf(id) === -1) q.push(id);
  props.setProperty('DOI_QUEUE', JSON.stringify(q.slice(-200)));
}

function zenodo_(method, path, body, raw) {
  var opts = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + prop_('ZENODO_TOKEN') } };
  if (raw) { opts.payload = raw; opts.contentType = 'application/octet-stream'; }
  else if (body) { opts.payload = JSON.stringify(body); opts.contentType = 'application/json'; }
  var url = /^https:/.test(path) ? path : zenodoBase_() + path;
  var r = UrlFetchApp.fetch(url, opts);
  var code = r.getResponseCode(), text = r.getContentText();
  if (code >= 300) {
    var msg = text.slice(0, 300);
    try { var j = JSON.parse(text); msg = j.message + (j.errors ? ': ' + JSON.stringify(j.errors).slice(0, 200) : ''); } catch (e) {}
    throw new Error('Zenodo ' + code + ': ' + msg);
  }
  return text ? safeParse_(text) || {} : {};
}

function zenodoCreators_(a) {
  var person = function (name, aff) {
    var parts = String(name).trim().split(/\s+/);
    var nm = parts.length > 1 ? parts.slice(-1)[0] + ', ' + parts.slice(0, -1).join(' ') : parts[0];
    return aff ? { name: nm, affiliation: aff } : { name: nm };
  };
  if (a.byline === 'abr') return [{ name: 'Ahmedabad Business Review' }];
  if (a.source === 'external') { var c = safeParse_(a.contributor) || {}; return [person(c.name, c.affiliation || '')]; }
  var users = usersByEmail_();
  var list = authorEmails_(a).map(function (e) { return users[e]; }).filter(function (x) { return x; })
    .map(function (x) { return person(x.name, 'Ahmedabad Business Review'); });
  return list.length ? list : [{ name: 'Ahmedabad Business Review' }];
}

function doiWorker_() {
  if (!doiEnabled_()) return;
  var props = PropertiesService.getScriptProperties();
  var q = safeParse_(props.getProperty('DOI_QUEUE')) || [];
  if (!q.length) return;
  var keep = [], done = 0;
  q.forEach(function (id) {
    if (done >= 2) { keep.push(id); return; }
    var meta;
    try { meta = findArticle_(id, false); } catch (e) { return; }
    if (meta.status !== 'published' || meta.doiState === 'published') return;
    var a = readFull_(meta._row);
    var state = String(a.doiState || '').split('|');
    try {
      if (!state[0] || state[0] === 'error') {
        done++;
        var url = site_() + '/articles/' + a.slug;
        var ref = issueRef_(a.issueKey);
        var md = {
          title: a.title, upload_type: 'publication', publication_type: 'article',
          description: '<p>' + esc_(a.standfirst || '') + '</p><p>Published in <i>Ahmedabad Business Review</i>, article ' + a.id + ': <a href="' + url + '">' + url + '</a></p>',
          creators: zenodoCreators_(a),
          publication_date: Utilities.formatDate(new Date(a.publishedAt || new Date()), 'Asia/Kolkata', 'yyyy-MM-dd'),
          access_right: 'open', license: prop_('ZENODO_LICENSE') || 'cc-by-nc-nd-4.0',
          journal_title: 'Ahmedabad Business Review',
          keywords: splitList_(a.tags).slice(0, 10),
          related_identifiers: [{ identifier: url, relation: 'isIdenticalTo', resource_type: 'publication-article' }],
          prereserve_doi: true
        };
        if (ref) { md.journal_volume = String(ref.volume); md.journal_issue = String(ref.number); }
        if (!md.keywords.length) delete md.keywords;
        if (prop_('ZENODO_COMMUNITY')) md.communities = [{ identifier: prop_('ZENODO_COMMUNITY') }];
        var dep = zenodo_('post', '/api/deposit/depositions', { metadata: md });
        var doi = dep.metadata && dep.metadata.prereserve_doi && dep.metadata.prereserve_doi.doi;
        if (!doi) throw new Error('Zenodo did not reserve a DOI.');
        a.doi = doi;
        a.doiState = ['reserved', dep.id, (dep.links && dep.links.bucket) || '', now_()].join('|');
        writeArticle_(a);
        log_('system', 'doi.reserved', a.id, doi);
        queuePdfWarm_(a.slug);           // the PDF is regenerated with the DOI printed on it
        keep.push(id);
      } else if (state[0] === 'reserved') {
        // Give the website a few minutes to regenerate the PDF with the DOI on it.
        if (state[3] && (new Date() - new Date(state[3])) < 8 * 60000) { keep.push(id); return; }
        done++;
        var file = fetchArticleFile_(a);
        var bucket = state[2];
        if (!bucket) {
          var d = zenodo_('get', '/api/deposit/depositions/' + state[1]);
          bucket = d.links && d.links.bucket;
        }
        zenodo_('put', bucket + '/' + encodeURIComponent(file.name), null, file.bytes);
        zenodo_('post', '/api/deposit/depositions/' + state[1] + '/actions/publish');
        a.doiState = 'published';
        writeArticle_(a);
        log_('system', 'doi.published', a.id, a.doi);
        queuePdfWarm_(a.slug);
      }
    } catch (err) {
      var cache = CacheService.getScriptCache();
      var tries = Number(cache.get('doitry_' + id) || 0) + 1;
      cache.put('doitry_' + id, String(tries), 21600);
      if (tries < 4) { keep.push(id); return; }
      cache.remove('doitry_' + id);
      var msg = String(err.message).slice(0, 180).replace(/\|/g, '/');
      // A reserved DOI is kept, so a retry continues where it stopped.
      a.doiState = state[0] === 'reserved' ? state.slice(0, 4).join('|') + '|error: ' + msg : 'error|' + msg;
      writeArticle_(a);
      log_('system', 'doi.error', a.id, msg);
    }
  });
  props.setProperty('DOI_QUEUE', JSON.stringify(keep));
}

function fetchArticleFile_(a) {
  var base = site_() + '/articles/' + a.slug;
  var r = UrlFetchApp.fetch(base + '.pdf', { muteHttpExceptions: true, followRedirects: false });
  if (r.getResponseCode() === 200 && /pdf/i.test(String(r.getHeaders()['Content-Type'] || r.getHeaders()['content-type'] || ''))) {
    return { name: a.id + '.pdf', bytes: r.getBlob().getBytes() };
  }
  var h = UrlFetchApp.fetch(base + '/paper', { muteHttpExceptions: true });
  if (h.getResponseCode() !== 200) throw new Error('Could not fetch the article file from the website (' + h.getResponseCode() + ').');
  return { name: a.id + '.html', bytes: h.getBlob().getBytes() };
}
