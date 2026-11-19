/**
 * Rights and permissions: anyone can ask to reuse an ABR article or a whole issue
 * (teaching, course packs, research, reprints, translation, commercial use …).
 * The Chair, EiC or COO approves or declines; on approval a numbered licence grant
 * (ABRP-YYYY-NNNN) is issued automatically on letterhead, emailed to the requester,
 * and can be verified at /verify. Educational, non-commercial, unchanged uses can be
 * approved automatically if the Chair turns that on.
 */

var PERM_COLS = ['id', 'token', 'status', 'refType', 'refId', 'refTitle', 'name', 'email', 'organisation', 'designation',
                 'useType', 'portion', 'adaptation', 'medium', 'audience', 'territory', 'startDate', 'endDate',
                 'purpose', 'commercial', 'fee', 'conditions', 'decidedBy', 'decidedByName', 'decidedAt', 'note',
                 'createdAt', 'ip'];

var PERM_DECIDERS = ['chair', 'eic', 'coo'];

var USE_TYPES = {
  classroom:   { label: 'Classroom teaching',                      commercial: false, edu: true },
  coursepack:  { label: 'Course pack or reading list',             commercial: false, edu: true },
  research:    { label: 'Academic research, thesis or dissertation', commercial: false, edu: true },
  training:    { label: 'Workshop, conference or training',        commercial: false, edu: false },
  ngo:         { label: 'Non-profit or government publication',    commercial: false, edu: false },
  media:       { label: 'Reprint in a newspaper, magazine or website', commercial: true, edu: false },
  translation: { label: 'Translation',                             commercial: false, edu: false },
  commercial:  { label: 'Commercial, corporate or marketing use',  commercial: true,  edu: false },
  other:       { label: 'Other',                                   commercial: false, edu: false }
};
var PORTIONS = { full: 'The full article', excerpt: 'An excerpt (up to 500 words)', figure: 'A figure, table or chart', issue: 'The whole issue' };
var ADAPTATIONS = { none: 'Unchanged', translated: 'Translated', edited: 'Edited, abridged or adapted' };
var MEDIA = { print: 'Print', online: 'Public website', lms: 'Password-protected course site (LMS)', slides: 'Slides or presentation', ebook: 'E-book or PDF', other: 'Other' };

var LICENCES = {
  'cc-by-4.0':       { label: 'CC BY 4.0',       url: 'https://creativecommons.org/licenses/by/4.0/',       nc: false, nd: false },
  'cc-by-sa-4.0':    { label: 'CC BY-SA 4.0',    url: 'https://creativecommons.org/licenses/by-sa/4.0/',    nc: false, nd: false },
  'cc-by-nc-4.0':    { label: 'CC BY-NC 4.0',    url: 'https://creativecommons.org/licenses/by-nc/4.0/',    nc: true,  nd: false },
  'cc-by-nc-sa-4.0': { label: 'CC BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', nc: true,  nd: false },
  'cc-by-nd-4.0':    { label: 'CC BY-ND 4.0',    url: 'https://creativecommons.org/licenses/by-nd/4.0/',    nc: false, nd: true },
  'cc-by-nc-nd-4.0': { label: 'CC BY-NC-ND 4.0', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/', nc: true,  nd: true }
};

var DEFAULT_PERM_CONDITIONS = [
  'Use the credit line exactly as given in this grant, next to the material, every time it is used.',
  'Do not change the meaning of the material. Translations must be faithful and marked as translations.',
  'Photographs, charts and other material credited to third parties are not covered unless ABR owns them.',
  'This licence is non-exclusive and non-transferable. It does not imply that ABR or its authors endorse you, your organisation or any product.',
  'ABR may revoke this licence if its terms are not met. Keep a copy of this grant with your records.'
].join('\n');

var PERM_ROUTES = {
  'public.permission.request': permRequest_,
  'public.permission.get':     permPublicGet_,
  'public.permission.config':  function (p) { return permPublicConfig_(p); },
  'perms.list':                permsList_,
  'perms.decide':              permsDecide_,
  'perms.revoke':              permsRevoke_,
  'perms.settings.get':        permsSettingsGet_,
  'perms.settings.save':       permsSettingsSave_
};

function contentLicence_() {
  var code = String(prop_('ZENODO_LICENSE') || 'cc-by-nc-nd-4.0').toLowerCase();
  var l = LICENCES[code] || LICENCES['cc-by-nc-nd-4.0'];
  return { code: LICENCES[code] ? code : 'cc-by-nc-nd-4.0', label: l.label, url: l.url, nc: l.nc, nd: l.nd };
}

function permSettings_() {
  var s = safeParse_(prop_('PERM_CONFIG')) || {};
  return { autoEducation: !!s.autoEducation, conditions: s.conditions || DEFAULT_PERM_CONDITIONS, maxYears: Number(s.maxYears) || 3 };
}

function permPublicConfig_(p) {
  var work = null, workError = '';
  if (p && p.ref) {
    try { var w = permWork_(p.ref); work = { type: w.type, id: w.id, title: w.title, url: w.url, authors: w.authors || '' }; }
    catch (e) { workError = e.message; }
  }
  var map = function (o) { return Object.keys(o).map(function (k) { return { value: k, label: typeof o[k] === 'string' ? o[k] : o[k].label }; }); };
  return { useTypes: map(USE_TYPES), portions: map(PORTIONS), adaptations: map(ADAPTATIONS), media: map(MEDIA), licence: contentLicence_(),
           work: work, workError: workError, autoEducation: permSettings_().autoEducation };
}

function requirePermDecider_(req) {
  var u = requireUser_(req);
  if (PERM_DECIDERS.indexOf(u.role) === -1) throw new Error('Only the Chair, Editor-in-Chief or COO can decide permission requests.');
  return u;
}

function readPerms_() { return sheetRows_('Permissions', PERM_COLS); }

// The work being licensed: a published article (by ID) or a published issue (by key).
function permWork_(ref) {
  ref = String(ref || '').trim();
  var m = /^v(\d+)n(\d+)$/i.exec(ref);
  if (m) {
    var i = readIssues_().filter(function (x) { return x.key === ref.toLowerCase() && x.status === 'published'; })[0];
    if (!i) throw new Error('We could not find a published issue with that reference.');
    return { type: 'issue', id: i.key, title: issueLabel_(i), url: site_() + '/issues/' + i.key, holder: '', year: issueYear_(i.volume) };
  }
  var a = readMeta_().filter(function (x) { return x.id === ref.toUpperCase() && x.status === 'published'; })[0];
  if (!a) throw new Error('We could not find a published article with that ID. It looks like ABR-2026-0001.');
  var external = a.source === 'external';
  return { type: 'article', id: a.id, title: a.title, url: site_() + '/articles/' + a.slug, doi: a.doi && a.doiState === 'published' ? a.doi : '',
           holder: external ? (safeParse_(a.contributor) || {}).name || '' : '', year: String(a.publishedAt || '').slice(0, 4),
           authors: a.byline === 'abr' ? 'Ahmedabad Business Review' : external ? (safeParse_(a.contributor) || {}).name
             : authorEmails_(a).map(function (e) { var u = usersByEmail_()[e]; return u ? u.name : ''; }).filter(String).join(', ') };
}

function creditLine_(w, grantId) {
  var who = w.type === 'issue' ? 'Ahmedabad Business Review, ' + w.title : (w.authors ? w.authors + ', ' : '') + '“' + w.title + '”, Ahmedabad Business Review (' + w.year + ')';
  var holder = w.holder ? '© ' + w.year + ' ' + w.holder : '© ' + w.year + ' Ahmedabad Centre for Research and Innovation';
  return 'Reproduced with permission from ' + who + '. ' + holder + '. ' + (w.doi ? 'https://doi.org/' + w.doi : w.url) + '. Licence ' + grantId + '.';
}

function isoDay_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : ''; }

function permRequest_(p, req) {
  if (p.website) return { id: 'ABRP-0000-0000' };                           // honeypot
  rateLimit_('perm_' + ((req.meta && req.meta.ip) || 'x'), 8, 3600, 'Too many requests from this connection. Please try again later.');
  var w = permWork_(p.ref);
  var name = String(p.name || '').trim(), email = String(p.email || '').trim().toLowerCase();
  if (name.length < 2) throw new Error('Enter your full name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) throw new Error('Enter a valid email address.');
  if (!USE_TYPES[p.useType]) throw new Error('Choose how you will use the material.');
  if (!PORTIONS[p.portion]) throw new Error('Choose how much of the material you will use.');
  if (w.type === 'issue' && p.portion !== 'issue' && p.portion !== 'excerpt' && p.portion !== 'figure') p.portion = 'issue';
  if (w.type === 'article' && p.portion === 'issue') p.portion = 'full';
  if (!ADAPTATIONS[p.adaptation]) p.adaptation = 'none';
  if (!MEDIA[p.medium]) throw new Error('Choose where the material will appear.');
  var purpose = String(p.purpose || '').trim();
  if (purpose.length < 20) throw new Error('Describe how you will use the material (a sentence or two).');
  var start = isoDay_(p.startDate) || todayIST_();
  var end = isoDay_(p.endDate);
  var maxYears = permSettings_().maxYears;
  var maxEnd = Utilities.formatDate(new Date(new Date(start + 'T12:00:00+05:30').getTime() + maxYears * 365.25 * 86400000), 'Asia/Kolkata', 'yyyy-MM-dd');
  if (!end || end > maxEnd) end = maxEnd;
  if (end < start) throw new Error('The end date must be after the start date.');
  var use = USE_TYPES[p.useType];
  var commercial = use.commercial || p.commercial === true || p.commercial === 'true';
  var x = {
    id: seq_('ABRP'), token: randomKey_(16), status: 'pending', refType: w.type, refId: w.id, refTitle: w.title,
    name: name.slice(0, 120), email: email, organisation: String(p.organisation || '').trim().slice(0, 160),
    designation: String(p.designation || '').trim().slice(0, 120), useType: p.useType, portion: p.portion, adaptation: p.adaptation,
    medium: p.medium, audience: String(p.audience || '').trim().slice(0, 120), territory: String(p.territory || 'India').trim().slice(0, 80) || 'India',
    startDate: start, endDate: end, purpose: purpose.slice(0, 1500), commercial: commercial ? 'TRUE' : 'FALSE',
    fee: '', conditions: '', decidedBy: '', decidedByName: '', decidedAt: '', note: '', createdAt: now_(), ip: String((req.meta && req.meta.ip) || '').slice(0, 64)
  };
  writeRow_('Permissions', PERM_COLS, x);
  logRaw_('external:' + email, 'perm.request', w.type === 'article' ? w.id : '', x.id);

  var s = permSettings_();
  if (s.autoEducation && use.edu && !commercial && x.adaptation === 'none') {
    permApprove_(x, w, { by: 'auto', byName: 'Approved automatically under ABR’s educational-use policy', conditions: s.conditions, fee: '' });
    return { id: x.id, status: 'approved', url: permUrl_(x) };
  }
  systemMail_(email, 'We received your permission request ' + x.id, 'Permission request received',
    '<p>Dear ' + esc_(name) + ',</p><p>Thank you for asking to use <b>' + esc_(w.title) + '</b>. Your request <b>' + x.id + '</b> is with our editors. We usually reply within five working days.</p>' +
    '<p>You can check its status at any time with the private link below. If it is approved, your licence grant will be there to download.</p>',
    { label: 'View your request', url: permUrl_(x) });
  readUsers_().filter(function (u) { return PERM_DECIDERS.indexOf(u.role) !== -1 && truthy_(u.active); }).forEach(function (u) {
    notify_(u.email, 'Permission request ' + x.id + ': ' + w.title,
      '<p><b>' + esc_(name) + '</b>' + (x.organisation ? ' (' + esc_(x.organisation) + ')' : '') + ' asks to use <b>' + esc_(w.title) + '</b> for <b>' + esc_(use.label.toLowerCase()) + '</b>' +
      (commercial ? ' (commercial)' : '') + '.</p><p>' + esc_(purpose) + '</p><p>Decide in the portal under Permissions.</p>' + portalLink_());
  });
  return { id: x.id, status: 'pending', url: permUrl_(x) };
}

function permUrl_(x) { return site_() + '/licences/' + x.id + '?k=' + x.token; }

function permApprove_(x, w, o) {
  var by = o.by === 'auto' ? null : usersByEmail_()[o.by] || {};
  x.status = 'approved';
  x.decidedBy = o.by; x.decidedByName = o.byName || (by && by.name) || o.by;
  x.decidedAt = now_();
  x.conditions = String(o.conditions || DEFAULT_PERM_CONDITIONS).slice(0, 3000);
  x.fee = String(o.fee || '').slice(0, 120);
  if (o.endDate && isoDay_(o.endDate)) x.endDate = o.endDate;
  x.note = String(o.note || '').slice(0, 1000);
  writeRow_('Permissions', PERM_COLS, x);
  logRaw_(o.by === 'auto' ? 'system' : o.by, 'perm.approve', w.type === 'article' ? w.id : '', x.id);
  systemMail_(x.email, 'Permission granted: ' + w.title + ' (' + x.id + ')', 'Your licence is ready',
    '<p>Dear ' + esc_(x.name) + ',</p><p>Ahmedabad Business Review has granted your request to use <b>' + esc_(w.title) + '</b> for ' +
    esc_(USE_TYPES[x.useType].label.toLowerCase()) + ', from ' + esc_(x.startDate) + ' to ' + esc_(x.endDate) + '.</p>' +
    (x.note ? '<p><b>Note from the editors:</b> ' + esc_(x.note) + '</p>' : '') +
    '<p>Your licence grant, with the credit line you must use, is at the link below. You can print it or save it as a PDF. Anyone can confirm it is genuine at ' + esc_(site_()) + '/verify with the reference <b>' + x.id + '</b>.</p>',
    { label: 'Open your licence', url: permUrl_(x) });
  if (o.by !== 'auto' && typeof createApproval_ === 'function') {
    createApproval_('licence.grant', 'Licence ' + x.id + ': ' + w.title + ' for ' + (x.organisation || x.name), x.id, [
      ['Licence', x.id], ['Work', w.title + ' (' + w.id + ')'], ['Licensee', x.name + (x.organisation ? ', ' + x.organisation : '')],
      ['Use', USE_TYPES[x.useType].label + (truthy_(x.commercial) ? ' (commercial)' : '')], ['Portion', PORTIONS[x.portion]],
      ['Form', ADAPTATIONS[x.adaptation] + ' · ' + MEDIA[x.medium]], ['Audience / copies', x.audience], ['Territory', x.territory],
      ['Period', x.startDate + ' to ' + x.endDate], ['Fee', x.fee || 'None'], ['Purpose (as stated)', x.purpose]
    ], o.by, { level: truthy_(x.commercial) ? 'major' : undefined });
  }
}

function permView_(x, full) {
  var v = {};
  PERM_COLS.forEach(function (c) { if (c !== 'token' && c !== 'ip') v[c] = x[c]; });
  v.commercial = truthy_(x.commercial);
  v.useLabel = (USE_TYPES[x.useType] || USE_TYPES.other).label;
  v.portionLabel = PORTIONS[x.portion] || '';
  v.adaptationLabel = ADAPTATIONS[x.adaptation] || '';
  v.mediumLabel = MEDIA[x.medium] || '';
  v.expired = x.status === 'approved' && x.endDate < todayIST_();
  if (full) v.url = permUrl_(x);
  return v;
}

// Requester's private page: status, and the full grant once approved.
function permPublicGet_(p) {
  var x = readPerms_().filter(function (r) { return r.id === String(p.id || '').toUpperCase(); })[0];
  if (!x || !p.key || p.key !== x.token) return null;
  var v = permView_(x, false);
  var w;
  try { w = permWork_(x.refId); } catch (e) { w = { type: x.refType, id: x.refId, title: x.refTitle, url: site_(), year: String(x.createdAt).slice(0, 4) }; }
  v.work = w;
  v.creditLine = creditLine_(w, x.id);
  v.licence = contentLicence_();
  var chair = chairs_()[0];
  v.chair = chair ? { name: chair.name, title: chair.title || ROLES.chair } : { name: '', title: ROLES.chair };
  if (typeof chairSignatureFor_ === 'function' && x.status === 'approved') v.signature = chairSignatureFor_('licences');
  delete v.email;
  return v;
}

function permVerify_(ref) {
  var x = readPerms_().filter(function (r) { return r.id === ref; })[0];
  if (!x || x.status === 'pending' || x.status === 'declined') return { kind: 'none' };
  return { kind: 'licence', record: { id: x.id, status: x.status, expired: x.status === 'approved' && x.endDate < todayIST_(),
    licensee: x.organisation || x.name, work: x.refTitle, workId: x.refId, use: (USE_TYPES[x.useType] || USE_TYPES.other).label,
    startDate: x.startDate, endDate: x.endDate, decidedAt: x.decidedAt, note: x.status === 'revoked' ? x.note : '' } };
}

function permsList_(p, req) {
  requirePermDecider_(req);
  var list = readPerms_().sort(byDateDesc_('createdAt')).map(function (x) { return permView_(x, true); });
  var counts = { pending: 0, approved: 0, declined: 0, revoked: 0 };
  list.forEach(function (x) { if (counts[x.status] !== undefined) counts[x.status]++; });
  return { list: list, counts: counts, settings: permSettings_(), licence: contentLicence_() };
}

function permsDecide_(p, req) {
  var u = requirePermDecider_(req);
  var x = readPerms_().filter(function (r) { return r.id === p.id; })[0];
  if (!x) throw new Error('Request not found.');
  if (x.status !== 'pending') throw new Error('This request has already been decided.');
  if (p.decision === 'approve') {
    var w = permWork_(x.refId);
    permApprove_(x, w, { by: u.email, byName: u.name, conditions: p.conditions, fee: p.fee, endDate: p.endDate, note: p.note });
  } else if (p.decision === 'decline') {
    var why = String(p.note || '').trim();
    if (!why) throw new Error('Tell the requester why (they will see this).');
    x.status = 'declined'; x.decidedBy = u.email; x.decidedByName = u.name; x.decidedAt = now_(); x.note = why.slice(0, 1000);
    writeRow_('Permissions', PERM_COLS, x);
    logRaw_(u.email, 'perm.decline', '', x.id);
    systemMail_(x.email, 'Your permission request ' + x.id, 'About your permission request',
      '<p>Dear ' + esc_(x.name) + ',</p><p>Thank you for asking to use <b>' + esc_(x.refTitle) + '</b>. We are not able to grant this request.</p><p><b>Reason:</b> ' + esc_(why) + '</p>' +
      '<p>You are still free to link to the article, and to quote short passages with full credit for criticism, review or research, as the law allows.</p>');
  } else {
    throw new Error('Unknown decision.');
  }
  return permsList_(p, req);
}

function permsRevoke_(p, req) {
  var u = requirePermDecider_(req);
  var x = readPerms_().filter(function (r) { return r.id === p.id; })[0];
  if (!x || x.status !== 'approved') throw new Error('Only a granted licence can be revoked.');
  var why = String(p.note || '').trim();
  if (!why) throw new Error('Give a reason. It is shown when the licence is verified.');
  x.status = 'revoked'; x.note = why.slice(0, 1000);
  writeRow_('Permissions', PERM_COLS, x);
  logRaw_(u.email, 'perm.revoke', '', x.id);
  systemMail_(x.email, 'Licence ' + x.id + ' has been revoked', 'Your licence has been revoked',
    '<p>Dear ' + esc_(x.name) + ',</p><p>Licence <b>' + x.id + '</b> to use <b>' + esc_(x.refTitle) + '</b> has been revoked.</p><p><b>Reason:</b> ' + esc_(why) + '</p><p>Please stop using the material. Reply to this email if you think this is a mistake.</p>');
  return permsList_(p, req);
}

function permsSettingsGet_(p, req) { requirePermDecider_(req); return permSettings_(); }

function permsSettingsSave_(p, req) {
  var u = requireApprover_(req);
  var s = { autoEducation: !!p.autoEducation, conditions: String(p.conditions || DEFAULT_PERM_CONDITIONS).trim().slice(0, 3000),
            maxYears: Math.min(10, Math.max(1, Number(p.maxYears) || 3)) };
  PropertiesService.getScriptProperties().setProperty('PERM_CONFIG', JSON.stringify(s));
  log_(u.email, 'perm.settings', '', '');
  return permSettings_();
}
