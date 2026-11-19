/**
 * Contributor accounts for "Write for ABR": outside writers sign up, verify their email,
 * sign in, submit articles, follow every submission, send revisions and see their certificates.
 * Contributor sessions are separate from team (portal) sessions.
 */

var CONTRIB_COLS = ['email', 'name', 'affiliation', 'bio', 'salt', 'hash', 'status', 'verifyToken',
                    'createdAt', 'verifiedAt', 'lastLoginAt', 'updatedAt'];

var CONTRIB_ROUTES = {
  'contrib.signup':      contribSignup_,
  'contrib.verify':      contribVerify_,
  'contrib.login':       contribLogin_,
  'contrib.logout':      contribLogout_,
  'contrib.me':          function (p) { return contribView_(requireContrib_(p)); },
  'contrib.forgot':      contribForgot_,
  'contrib.reset':       contribReset_,
  'contrib.profile':     contribProfile_,
  'contrib.submissions': contribSubmissions_,
  'contrib.submit':      contribSubmit_,
  'contrib.revise':      contribRevise_,
  'contrib.get':         contribGet_,
  'contrib.config':      function () { return { sections: SECTIONS, types: TYPES.filter(function (t) { return t !== 'Interview'; }), minRefs: MIN_REFERENCES, referenced: REFERENCED_TYPES }; }
};

function readContribs_() { return sheet_('Contributors') ? readRows_('Contributors', CONTRIB_COLS) : []; }
function findContrib_(email) {
  email = String(email || '').trim().toLowerCase();
  return readContribs_().filter(function (c) { return c.email === email; })[0] || null;
}
function contribView_(c) {
  return { email: c.email, name: c.name, affiliation: c.affiliation, bio: c.bio, since: c.verifiedAt || c.createdAt };
}
function contribSession_(c) {
  var token = 'c_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  CacheService.getScriptCache().put('csess_' + token, c.email, 21600);
  return { token: token, contributor: contribView_(c) };
}
function requireContrib_(p) {
  var t = String((p && p.ctoken) || '');
  var email = t ? CacheService.getScriptCache().get('csess_' + t) : null;
  if (!email) throw new Error('Your session has expired. Please sign in again.');
  var c = findContrib_(email);
  if (!c || c.status !== 'active') throw new Error('Your session has expired. Please sign in again.');
  CacheService.getScriptCache().put('csess_' + t, email, 21600);           // sliding expiry
  return c;
}
function validEmail_(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e) && e.length <= 200; }

function contribSignup_(p, req) {
  if (p.website) return { sent: true };                                  // honeypot
  rateLimit_('csignup_' + ((req.meta && req.meta.ip) || 'x'), 6, 3600, 'Too many sign-ups from this connection. Please try again later.');
  var email = String(p.email || '').trim().toLowerCase();
  var name = String(p.name || '').trim();
  if (name.length < 2) throw new Error('Enter your full name.');
  if (!validEmail_(email)) throw new Error('Enter a valid email address.');
  if (String(p.password || '').length < 8) throw new Error('Choose a password of at least 8 characters.');
  if (usersByEmail_()[email]) throw new Error('This email belongs to an ABR team account. Team members sign in at the editorial portal.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var c;
  try {
    c = findContrib_(email);
    if (c && c.status === 'active') throw new Error('An account with this email already exists. Sign in, or reset your password.');
    c = c || { email: email, createdAt: now_() };
    c.name = name.slice(0, 120);
    c.affiliation = String(p.affiliation || '').trim().slice(0, 160);
    c.bio = String(p.bio || '').trim().slice(0, 500);
    c.salt = Utilities.getUuid();
    c.hash = hash_(String(p.password), c.salt);
    c.status = 'pending';
    c.verifyToken = Utilities.getUuid().replace(/-/g, '') + randomKey_(8);
    c.updatedAt = now_();
    writeRow_('Contributors', CONTRIB_COLS, c);
  } finally { lock.releaseLock(); }
  systemMail_(email, 'Confirm your ABR contributor account', 'Confirm your email',
    '<p>Hello ' + esc_(name.split(' ')[0]) + ',</p><p>Thank you for creating a contributor account with Ahmedabad Business Review. Please confirm your email address to start submitting.</p>' +
    '<p>If you did not sign up, you can ignore this email.</p>', { label: 'Confirm my email', url: site_() + '/write?verify=' + c.verifyToken });
  logRaw_('contrib:' + email, 'contrib.signup', '', name);
  return { sent: true };
}

function contribVerify_(p) {
  var t = String(p.token || '');
  var c = t ? readContribs_().filter(function (x) { return x.verifyToken && x.verifyToken === t; })[0] : null;
  if (!c) throw new Error('This confirmation link has expired or was already used. Try signing in.');
  c.status = 'active'; c.verifyToken = ''; c.verifiedAt = now_(); c.lastLoginAt = now_(); c.updatedAt = now_();
  writeRow_('Contributors', CONTRIB_COLS, c);
  logRaw_('contrib:' + c.email, 'contrib.verify', '', '');
  return contribSession_(c);
}

function contribLogin_(p, req) {
  var email = String(p.email || '').trim().toLowerCase();
  rateLimit_('clogin_' + email, 10, 900, 'Too many attempts. Please wait 15 minutes or reset your password.');
  var c = findContrib_(email);
  if (!c || !c.hash || hash_(String(p.password || ''), c.salt) !== c.hash) throw new Error('Email or password is incorrect.');
  if (c.status === 'pending') throw new Error('Please confirm your email first. We sent you a link when you signed up (check spam), or sign up again to get a new link.');
  if (c.status !== 'active') throw new Error('This account is disabled. Contact ABR.');
  c.lastLoginAt = now_();
  writeRow_('Contributors', CONTRIB_COLS, c);
  return contribSession_(c);
}

function contribLogout_(p) {
  if (p.ctoken) CacheService.getScriptCache().remove('csess_' + p.ctoken);
  return { ok: true };
}

function contribForgot_(p, req) {
  var email = String(p.email || '').trim().toLowerCase();
  rateLimit_('cforgot_' + ((req.meta && req.meta.ip) || 'x'), 10, 3600);
  if (!validEmail_(email)) throw new Error('Enter your email address.');
  rateLimit_('cforgot_' + email, 3, 3600, 'A reset link was already sent. Check your inbox (and spam).');
  var c = findContrib_(email);
  if (c && c.status === 'active') {
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    CacheService.getScriptCache().put('creset_' + token, email, 3600);
    systemMail_(email, 'Reset your ABR contributor password', 'Reset your password',
      '<p>Use the link below to choose a new password for your ABR contributor account. It works once and expires in 1 hour.</p><p>If you did not ask for this, ignore this email.</p>',
      { label: 'Choose a new password', url: site_() + '/write?reset=' + token });
  }
  return { sent: true };
}

function contribReset_(p) {
  var cache = CacheService.getScriptCache();
  var email = p.token ? cache.get('creset_' + p.token) : null;
  if (!email) throw new Error('This reset link has expired or was already used. Ask for a new one.');
  if (String(p.password || '').length < 8) throw new Error('Choose a password of at least 8 characters.');
  var c = findContrib_(email);
  if (!c) throw new Error('Account not found.');
  c.salt = Utilities.getUuid(); c.hash = hash_(String(p.password), c.salt); c.updatedAt = now_();
  if (c.status === 'pending') { c.status = 'active'; c.verifiedAt = now_(); c.verifyToken = ''; }
  writeRow_('Contributors', CONTRIB_COLS, c);
  cache.remove('creset_' + p.token);
  return contribSession_(c);
}

function contribProfile_(p) {
  var c = requireContrib_(p);
  var name = String(p.name || '').trim();
  if (name.length < 2) throw new Error('Enter your full name.');
  c.name = name.slice(0, 120);
  c.affiliation = String(p.affiliation || '').trim().slice(0, 160);
  c.bio = String(p.bio || '').trim().slice(0, 500);
  if (p.newPassword) {
    if (hash_(String(p.currentPassword || ''), c.salt) !== c.hash) throw new Error('Your current password is incorrect.');
    if (String(p.newPassword).length < 8) throw new Error('New password must be at least 8 characters.');
    c.salt = Utilities.getUuid(); c.hash = hash_(String(p.newPassword), c.salt);
  }
  c.updatedAt = now_();
  writeRow_('Contributors', CONTRIB_COLS, c);
  return contribView_(c);
}

function contribSubmissions_(p) {
  var c = requireContrib_(p);
  var certs = readCerts_().filter(function (x) { return x.email === c.email && x.status === 'valid'; });
  var subs = readMeta_().filter(function (a) { return a.source === 'external' && (safeParse_(a.contributor) || {}).email === c.email; })
    .sort(byDateDesc_('createdAt'))
    .map(function (a) {
      var t = trackView_(a);
      t.standfirst = a.standfirst; t.section = a.section; t.type = a.type; t.wordCount = a.wordCount;
      return t;
    });
  return {
    submissions: subs,
    certificates: certs.map(function (x) { var v = certPublic_(x); v.url = site_() + '/certificates/' + x.id; return v; })
  };
}

function contribSubmit_(p, req) {
  var c = requireContrib_(p);
  var q = {};
  Object.keys(p).forEach(function (k) { q[k] = p[k]; });
  q.requireLicence = true;
  q.name = c.name; q.email = c.email; q.affiliation = c.affiliation; q.bio = c.bio; q.website = '';
  var r = publicSubmit_(q, req);
  return { id: r.id };
}

function contribRevise_(p, req) {
  var c = requireContrib_(p);
  var a = readMeta_().filter(function (x) { return x.id === String(p.id || '') && x.source === 'external'; })[0];
  if (!a || (safeParse_(a.contributor) || {}).email !== c.email) throw new Error('Submission not found.');
  var q = {};
  Object.keys(p).forEach(function (k) { q[k] = p[k]; });
  q.key = a.trackKey;
  publicRevise_(q, req);
  return contribSubmissions_(p);
}

function contribGet_(p) {
  var c = requireContrib_(p);
  var meta = readMeta_().filter(function (x) { return x.id === String(p.id || '') && x.source === 'external'; })[0];
  if (!meta || (safeParse_(meta.contributor) || {}).email !== c.email) throw new Error('Submission not found.');
  var a = readFull_(meta._row);
  return { id: a.id, title: a.title, standfirst: a.standfirst, section: a.section, type: a.type, sources: a.sources,
           body: a.body, status: a.status, note: a.status === 'changes_requested' ? a.reviewNote : '' };
}
