/**
 * Two-factor sign-in (mandatory for every team account, including the Chair).
 *
 * After the password is checked, login returns a short-lived ticket instead of a session:
 *  - first time: the member scans a QR code into an authenticator app (Google Authenticator,
 *    Microsoft Authenticator, Authy, 1Password …), enters a 6-digit code, and receives 10 one-time
 *    backup codes;
 *  - afterwards: the member enters the current 6-digit code, or one backup code.
 * Only then is a portal session created.
 *
 * Lost phone: the Chair can reset another member's two-factor from Team. If the Chair is locked
 * out, the script owner runs reset2fa('email') from the Apps Script editor.
 */

var TWO_FACTOR_ENFORCED = true;
var TFA_ISSUER = 'ABR Editorial Portal';

var SECURITY_ROUTES = {
  'auth.2fa.verify': tfaVerify_,
  'auth.2fa.setup':  tfaSetup_,
  'auth.2fa.backupCodes': tfaNewBackupCodes_,
  'team.reset2fa':   tfaResetMember_
};

var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function b32Encode_(bytes) {
  var bits = 0, value = 0, out = '';
  for (var i = 0; i < bytes.length; i++) {
    value = (value << 8) | (bytes[i] & 255); bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function b32Decode_(s) {
  s = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  var bits = 0, value = 0, out = [];
  for (var i = 0; i < s.length; i++) {
    value = (value << 5) | B32.indexOf(s[i]); bits += 5;
    if (bits >= 8) { var b = (value >>> (bits - 8)) & 255; out.push(b > 127 ? b - 256 : b); bits -= 8; }
  }
  return out;
}
function randomBytes_(n) {
  var out = [];
  while (out.length < n) out = out.concat(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Math.random() + Date.now()));
  return out.slice(0, n);
}

// RFC 6238 TOTP, 30-second steps, 6 digits, HMAC-SHA1 (what every authenticator app uses).
function totpAt_(secret, step) {
  var counter = [];
  for (var i = 7; i >= 0; i--) { var b = Math.floor(step / Math.pow(256, i)) % 256; counter.push(b > 127 ? b - 256 : b); }
  var h = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, counter, b32Decode_(secret));
  var o = h[h.length - 1] & 15;
  var code = ((h[o] & 127) << 24) | ((h[o + 1] & 255) << 16) | ((h[o + 2] & 255) << 8) | (h[o + 3] & 255);
  return ('000000' + (code % 1000000)).slice(-6);
}
// Accepts the previous, current or next code (clock drift), never the same step twice.
function totpCheck_(secret, code, lastStep) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return -1;
  var now = Math.floor(Date.now() / 30000);
  for (var d = -1; d <= 1; d++) {
    if (now + d > Number(lastStep || 0) && totpAt_(secret, now + d) === code) return now + d;
  }
  return -1;
}

function makeBackupCodes_() {
  var codes = [], hashes = [];
  var bytes = randomBytes_(60);
  for (var i = 0; i < 10; i++) {
    var c = b32Encode_(bytes.slice(i * 6, i * 6 + 6)).slice(0, 10).toLowerCase();
    c = c.slice(0, 5) + '-' + c.slice(5);
    codes.push(c);
    hashes.push(hash_(c, 'backup'));
  }
  return { codes: codes, hashes: hashes };
}

function otpauthUrl_(email, secret) {
  return 'otpauth://totp/' + encodeURIComponent(TFA_ISSUER + ':' + email) + '?secret=' + secret +
         '&issuer=' + encodeURIComponent(TFA_ISSUER) + '&algorithm=SHA1&digits=6&period=30';
}

// Called by login_ once the password is right.
function tfaChallenge_(u) {
  var ticket = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var cache = CacheService.getScriptCache();
  if (u.totpSecret) {
    cache.put('tfa_' + ticket, u.email, 600);
    return { twoFactor: 'verify', ticket: ticket };
  }
  var secret = b32Encode_(randomBytes_(20));
  cache.put('tfa_' + ticket, u.email, 900);
  cache.put('tfasec_' + ticket, secret, 900);
  return { twoFactor: 'setup', ticket: ticket, secret: secret, otpauth: otpauthUrl_(u.email, secret), email: u.email };
}

function tfaTicket_(p) {
  var cache = CacheService.getScriptCache();
  var email = p.ticket ? cache.get('tfa_' + p.ticket) : null;
  if (!email) throw new Error('This sign-in has expired. Please enter your email and password again.');
  var fails = Number(cache.get('tfafail_' + email) || 0);
  if (fails >= 6) throw new Error('Too many wrong codes. Wait 15 minutes and sign in again.');
  var u = usersByEmail_()[email];
  if (!u || !truthy_(u.active)) throw new Error('Account disabled.');
  return { u: u, cache: cache, fails: fails };
}
function tfaFail_(t, msg) {
  t.cache.put('tfafail_' + t.u.email, String(t.fails + 1), 900);
  throw new Error(msg);
}
function tfaSession_(u, cache, ticket, extra) {
  cache.remove('tfa_' + ticket); cache.remove('tfasec_' + ticket); cache.remove('tfafail_' + u.email);
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  cache.put('sess_' + token, u.email, SESSION_SECONDS);
  log_(u.email, 'login', '', 'two-factor');
  var r = { token: token, user: selfView_(u), config: portalConfig_() };
  if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
  return r;
}

function tfaVerify_(p) {
  var t = tfaTicket_(p);
  var u = t.u;
  if (!u.totpSecret) throw new Error('Two-factor sign-in is not set up yet. Please sign in again.');
  var code = String(p.code || '').trim().toLowerCase();
  var step = totpCheck_(u.totpSecret, code, u.totpLastStep);
  if (step > 0) {
    u.totpLastStep = step;
    writeRow_('Users', USER_COLS, u);
    return tfaSession_(u, t.cache, p.ticket);
  }
  var hashes = safeParse_(u.backupCodes) || [];
  var h = hash_(code, 'backup');
  var i = hashes.indexOf(h);
  if (i === -1) tfaFail_(t, 'That code is not right. Check the time on your phone and try the newest code.');
  hashes.splice(i, 1);
  u.backupCodes = JSON.stringify(hashes);
  writeRow_('Users', USER_COLS, u);
  log_(u.email, 'tfa.backupUsed', '', hashes.length + ' left');
  return tfaSession_(u, t.cache, p.ticket, { backupCodesLeft: hashes.length });
}

function tfaSetup_(p) {
  var t = tfaTicket_(p);
  var u = t.u;
  var secret = t.cache.get('tfasec_' + p.ticket);
  if (!secret) throw new Error('This set-up has expired. Please sign in again.');
  var step = totpCheck_(secret, p.code, 0);
  if (step < 0) tfaFail_(t, 'That code is not right. Make sure you scanned the newest QR code, then enter the 6-digit code your app shows.');
  var b = makeBackupCodes_();
  u.totpSecret = secret; u.totpEnabledAt = now_(); u.totpLastStep = step; u.backupCodes = JSON.stringify(b.hashes);
  u.updatedAt = now_();
  writeRow_('Users', USER_COLS, u);
  log_(u.email, 'tfa.enabled', '', '');
  notify_(u.email, 'Two-factor sign-in is on for your ABR account',
    '<p>Two-factor sign-in was turned on for your ABR portal account on ' + esc_(Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMMM yyyy, h:mm a')) +
    ' IST. From now on you will need your authenticator app, or a backup code, to sign in.</p><p>If this was not you, tell the Chair immediately.</p>');
  return tfaSession_(u, t.cache, p.ticket, { backupCodes: b.codes });
}

function tfaNewBackupCodes_(p, req) {
  var u = requireUser_(req);
  if (totpCheck_(u.totpSecret, p.code, u.totpLastStep) < 0) throw new Error('Enter the current code from your authenticator app to make new backup codes.');
  var b = makeBackupCodes_();
  u.backupCodes = JSON.stringify(b.hashes); u.totpLastStep = Math.floor(Date.now() / 30000);
  writeRow_('Users', USER_COLS, u);
  log_(u.email, 'tfa.newBackupCodes', '', '');
  return { backupCodes: b.codes };
}

function tfaResetMember_(p, req) {
  var admin = requireAdmin_(req);
  var email = String(p.email || '').trim().toLowerCase();
  if (email === admin.email) throw new Error('You cannot reset your own two-factor here. Use a backup code, or ask the script owner to run reset2fa.');
  var u = usersByEmail_()[email];
  if (!u) throw new Error('Member not found.');
  tfaClear_(u);
  log_(admin.email, 'tfa.reset', '', email);
  notify_(email, 'Your ABR two-factor sign-in was reset',
    '<p>' + esc_(admin.name) + ' reset two-factor sign-in on your ABR portal account. The next time you sign in you will be asked to set it up again with your authenticator app.</p><p>If you did not ask for this, tell the Chair.</p>');
  return { ok: true };
}

function tfaClear_(u) {
  u.totpSecret = ''; u.totpEnabledAt = ''; u.totpLastStep = ''; u.backupCodes = ''; u.updatedAt = now_();
  writeRow_('Users', USER_COLS, u);   // requireUser_ rejects sessions of accounts without two-factor, so they are signed out
}

/** Run from the Apps Script editor if the Chair loses their phone and backup codes. */
function reset2fa(email) {
  var u = usersByEmail_()[String(email || '').trim().toLowerCase()];
  if (!u) throw new Error('No team member with that email.');
  tfaClear_(u);
  log_('script-owner', 'tfa.reset', '', u.email);
  Logger.log('Two-factor sign-in reset for ' + u.email + '. They will set it up again at their next sign-in.');
}
