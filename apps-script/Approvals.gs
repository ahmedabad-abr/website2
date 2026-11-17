/**
 * ABR approval records: every significant approval produces a numbered record
 * (ABRA-YYYY-NNNN) printed on black-and-white letterhead, signed and filed.
 *  - standard: one page, signed by the Chairperson
 *  - major:    two pages; page 1 countersigned (e.g. President, ACRI), page 2 signed by the Chairperson
 * Records are created automatically from the audit trail (see approvalFromLog_) or by hand.
 */

var APPROVAL_COLS = ['id', 'token', 'kind', 'level', 'subject', 'refId', 'details', 'decidedBy', 'decidedByName',
                     'decidedAt', 'countersignRole', 'countersignName', 'status', 'printedAt', 'filedAt', 'fileRef',
                     'note', 'createdAt'];

var APPROVAL_KINDS = {
  'article.publish':  { label: 'Publication of an article',                 level: 'standard' },
  'partner.article':  { label: 'Publication of a partner or promoted article', level: 'major' },
  'article.withdraw': { label: 'Withdrawal (retraction) of an article',     level: 'major' },
  'issue.publish':    { label: 'Publication of an issue',                   level: 'major' },
  'term.appoint':     { label: 'Appointment to an office',                  level: 'major' },
  'term.end':         { label: 'Completion of a term of office',            level: 'standard' },
  'team.add':         { label: 'Addition of a team member',                 level: 'standard' },
  'partner.add':      { label: 'Admission of a partner organisation',       level: 'major' },
  'cert.revoke':      { label: 'Revocation of a certificate',               level: 'standard' },
  'manual':           { label: 'Other approval',                            level: 'standard' }
};

var COUNTERSIGN_DEFAULT = 'President, Ahmedabad Centre for Research and Innovation';
var COUNTERSIGN_OPTIONS = [
  'President, Ahmedabad Centre for Research and Innovation',
  'Director of Students, Ahmedabad Centre for Research and Innovation',
  'Vice President, Ahmedabad Centre for Research and Innovation',
  'Provost, Ahmedabad Centre for Research and Innovation'
];

var APPROVAL_ROUTES = {
  'approvals.list':          approvalsList_,
  'approvals.recent':        approvalsRecent_,
  'approvals.create':        approvalsCreateManual_,
  'approvals.mark':          approvalsMark_,
  'approvals.settings.get':  approvalSettingsGet_,
  'approvals.settings.save': approvalSettingsSave_,
  'public.approval':         publicApproval_
};

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function approvalConfig_() {
  var saved = safeParse_(prop_('APPROVAL_CONFIG')) || {};
  var out = {};
  Object.keys(APPROVAL_KINDS).forEach(function (k) {
    var s = saved[k] || {};
    out[k] = {
      label: APPROVAL_KINDS[k].label,
      enabled: s.enabled === undefined ? true : !!s.enabled,
      level: s.level === 'major' || s.level === 'standard' ? s.level : APPROVAL_KINDS[k].level,
      countersignRole: s.countersignRole || COUNTERSIGN_DEFAULT,
      countersignName: s.countersignName || ''
    };
  });
  return out;
}

function approvalSettingsGet_(p, req) {
  requireAdmin_(req);
  return { kinds: approvalConfig_(), options: COUNTERSIGN_OPTIONS };
}

function approvalSettingsSave_(p, req) {
  var u = requireAdmin_(req);
  var cur = approvalConfig_();
  var inp = p.kinds || {};
  var out = {};
  Object.keys(cur).forEach(function (k) {
    var s = inp[k] || cur[k];
    out[k] = {
      enabled: s.enabled === undefined ? cur[k].enabled : !!s.enabled,
      level: s.level === 'major' ? 'major' : 'standard',
      countersignRole: String(s.countersignRole || COUNTERSIGN_DEFAULT).trim().slice(0, 120),
      countersignName: String(s.countersignName || '').trim().slice(0, 80)
    };
  });
  PropertiesService.getScriptProperties().setProperty('APPROVAL_CONFIG', JSON.stringify(out));
  log_(u.email, 'approval.settings', '', '');
  return approvalSettingsGet_(p, req);
}

/* ------------------------------------------------------------------ */
/* Creating records                                                    */
/* ------------------------------------------------------------------ */

function readApprovals_() { return sheet_('Approvals') ? readRows_('Approvals', APPROVAL_COLS) : []; }

// details: array of [label, value] pairs shown in the record's table.
function createApproval_(kind, subject, refId, details, byEmail, opts) {
  if (!sheet_('Approvals')) return null;
  opts = opts || {};
  var cfg = approvalConfig_()[kind] || approvalConfig_().manual;
  if (!opts.force && !cfg.enabled) return null;
  var level = opts.level || cfg.level;
  var by = usersByEmail_()[byEmail] || {};
  var refKey = kind + ':' + (refId || '');
  if (refId && readApprovals_().some(function (x) { return x.kind + ':' + x.refId === refKey && x.status !== 'void'; })) return null;
  var rec = {
    id: seq_('ABRA'), token: randomKey_(16), kind: kind, level: level,
    subject: String(subject || '').slice(0, 250), refId: String(refId || ''),
    details: JSON.stringify((details || []).filter(function (d) { return d && d[1] !== undefined && d[1] !== ''; })
      .map(function (d) { return [String(d[0]), String(d[1]).slice(0, 1500)]; })),
    decidedBy: byEmail || '', decidedByName: by.name || (byEmail === 'system' ? 'ABR editorial system' : byEmail || ''),
    decidedAt: opts.decidedAt || now_(),
    countersignRole: level === 'major' ? (opts.countersignRole || cfg.countersignRole) : '',
    countersignName: level === 'major' ? (opts.countersignName !== undefined ? opts.countersignName : cfg.countersignName) : '',
    status: 'to_print', printedAt: '', filedAt: '', fileRef: '', note: String(opts.note || '').slice(0, 500), createdAt: now_()
  };
  writeRow_('Approvals', APPROVAL_COLS, rec);
  logRaw_(byEmail || 'system', 'approval.create', /^ABR-/.test(refId || '') ? refId : '', rec.id + ' ' + kind);
  return rec;
}

// log_ without triggering approval hooks (avoids recursion).
function logRaw_(email, action, id, note) {
  try { sheet_('AuditLog').appendRow([now_(), email, action, id, safe_(String(note || '').slice(0, 500))]); } catch (e) {}
}

function articleDetails_(a) {
  var users = usersByEmail_();
  var authors = a.byline === 'abr' ? 'Curated by Ahmedabad Business Review'
    : a.source === 'external' ? ((safeParse_(a.contributor) || {}).name || '') + ' (outside contributor)'
    : authorEmails_(a).map(function (e) { return users[e] ? users[e].name : e; }).join(', ');
  var p = typeof partnerForArticle_ === 'function' ? partnerForArticle_(a) : null;
  return [
    ['Article ID', a.id],
    ['Title', a.title],
    ['Section / type', [a.section, a.type].filter(String).join(' · ')],
    ['Author(s)', authors],
    ['Words', a.wordCount],
    ['Partnership', p ? (p.type === 'promoted' ? 'Promoted · supported by ' : 'In partnership with ') + p.name : ''],
    ['AI assistance', truthy_(a.aiGenerated) ? 'AI-assisted draft (disclosed)' : ''],
    ['Public link', a.slug ? (prop_('SITE_URL') || 'https://theabr.in') + '/articles/' + a.slug : '']
  ];
}

// Called from log_ for every audit entry; turns significant ones into approval records.
function approvalFromLog_(email, action, id, note) {
  if (!sheet_('Approvals')) return;
  try {
    if (action === 'publish') {
      var a = findArticle_(id, false);
      var partnered = a.partnerType === 'partner' || a.partnerType === 'promoted';
      createApproval_(partnered ? 'partner.article' : 'article.publish',
        (partnered ? 'Publication of partner article: ' : 'Publication of article: ') + a.title, a.id,
        articleDetails_(a).concat([['Note on approval', note || '']]), email);
    } else if (action === 'withdraw') {
      var w = findArticle_(id, false);
      createApproval_('article.withdraw', 'Withdrawal of article: ' + w.title, w.id,
        articleDetails_(w).concat([['Reason for withdrawal (public)', note]]), email);
    } else if (action === 'issue.publish') {
      var i = typeof findIssue_ === 'function' ? findIssue_(note) : null;
      if (!i) return;
      var metas = readMeta_(), byId = {};
      metas.forEach(function (m) { byId[m.id] = m; });
      var list = (safeParse_(i.articleIds) || []).map(function (aid, n) { return (n + 1) + '. ' + (byId[aid] ? byId[aid].title + ' (' + aid + ')' : aid); });
      createApproval_('issue.publish', 'Publication of ' + issueLabel_(i), i.key + ':' + String(i.publishedAt || '').slice(0, 10), [
        ['Issue', issueLabel_(i)], ['Theme', i.theme || ''], ['Number of articles', list.length],
        ['Contents', list.join('\n')], ['Chair’s foreword', 'Included'],
        ['Other statements', (safeParse_(i.statements) || []).map(function (s) { return s.name + ' (' + s.title + ')'; }).join(', ') || 'None'],
        ['Public link', (prop_('SITE_URL') || 'https://theabr.in') + '/issues/' + i.key]
      ], email);
    } else if (action === 'term.appoint') {
      var m = /^(\S+) as (\S+) until (\S+)$/.exec(note || '');
      if (!m) return;
      var person = usersByEmail_()[m[1]] || {};
      createApproval_('term.appoint', 'Appointment of ' + (person.name || m[1]) + ' as ' + (ROLES[m[2]] || m[2]),
        m[1] + ':' + m[2] + ':' + m[3], [
          ['Name', person.name || ''], ['Email', m[1]], ['Office', ROLES[m[2]] || m[2]],
          ['Term begins', person.termStart || todayIST_()], ['Term ends', m[3]],
          ['On completion', 'Certificate of Service issued automatically; role reverts to Editor unless re-appointed']
        ], email);
    } else if (action === 'term.end') {
      var t = /^(\S+) \((.+)\)$/.exec(note || '');
      if (!t) return;
      var tu = usersByEmail_()[t[1]] || {};
      var cert = readCerts_().filter(function (c) { return c.type === 'term' && c.email === t[1]; }).slice(-1)[0];
      var cd = cert ? safeParse_(cert.detail) || {} : {};
      createApproval_('term.end', 'Completion of term: ' + (tu.name || t[1]) + ', ' + t[2], t[1] + ':' + (cd.end || todayIST_()), [
        ['Name', tu.name || ''], ['Office', t[2]], ['Term', (cd.start || '') + ' to ' + (cd.end || '')],
        ['Certificate of Service', cert ? cert.id : ''], ['Current role', 'Editor'],
        ['Action required', 'Appoint a successor or re-appoint']
      ], email || 'system');
    } else if (action === 'team.add') {
      var nu = usersByEmail_()[note] || {};
      createApproval_('team.add', 'Addition of ' + (nu.name || note) + ' to the ABR team', note, [
        ['Name', nu.name || ''], ['Email', note], ['Role', ROLES[nu.role] || nu.role || ''], ['Public title', nu.title || ''],
        ['Agreement', 'Confidentiality and ownership agreement to be signed electronically on first login']
      ], email);
    } else if (action === 'partners.add') {
      var pr = typeof findPartner_ === 'function' ? findPartner_(note) : null;
      if (!pr) return;
      createApproval_('partner.add', 'Admission of partner: ' + pr.name, pr.slug, [
        ['Organisation', pr.name], ['Website', pr.website || ''], ['Internal note', pr.note || ''],
        ['Rights granted', 'Use of ABR co-brand lockups under the brand guidelines; listing on /partners'],
        ['Policy', 'Partner and promoted content policy (theabr.in/partner-content)']
      ], email);
    } else if (action === 'cert.revoke') {
      var r = /^(\S+): (.*)$/.exec(note || '');
      if (!r) return;
      var c = readCerts_().filter(function (x) { return x.id === r[1]; })[0] || {};
      createApproval_('cert.revoke', 'Revocation of certificate ' + r[1], r[1], [
        ['Certificate', r[1]], ['Issued to', c.name || ''], ['Type', CERT_TYPES[c.type] || c.type || ''],
        ['Originally issued', String(c.issuedAt || '').slice(0, 10)], ['Reason (public)', r[2]]
      ], email);
    }
  } catch (e) {
    logRaw_('system', 'approvalFailed', /^ABR-/.test(id || '') ? id : '', action + ': ' + e.message);
  }
}

function approvalsCreateManual_(p, req) {
  var u = requireAdmin_(req);
  var subject = String(p.subject || '').trim();
  if (!subject) throw new Error('Give the approval a subject.');
  var details = [];
  if (p.description) details.push(['Matter', String(p.description)]);
  (Array.isArray(p.details) ? p.details : []).forEach(function (d) { if (d && d[0] && d[1]) details.push([d[0], d[1]]); });
  if (p.amount) details.push(['Amount', String(p.amount)]);
  if (p.reference) details.push(['Reference', String(p.reference)]);
  var level = p.level === 'major' ? 'major' : 'standard';
  var rec = createApproval_('manual', subject, '', details, u.email, {
    force: true, level: level, decidedAt: /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? new Date(p.date + 'T12:00:00+05:30').toISOString() : now_(),
    countersignRole: p.countersignRole, countersignName: p.countersignName, note: p.note
  });
  return approvalView_(rec);
}

/* ------------------------------------------------------------------ */
/* Register                                                            */
/* ------------------------------------------------------------------ */

function approvalView_(x) {
  var v = {};
  APPROVAL_COLS.forEach(function (c) { v[c] = x[c]; });
  v.details = safeParse_(x.details) || [];
  v.kindLabel = (APPROVAL_KINDS[x.kind] || APPROVAL_KINDS.manual).label;
  var site = prop_('SITE_URL') || 'https://theabr.in';
  v.printUrl = site + '/approvals/' + x.id + '?k=' + x.token;
  v.pdfUrl = site + '/approvals/' + x.id + '.pdf?k=' + x.token;
  return v;
}

function approvalsList_(p, req) {
  requireAdmin_(req);
  var list = readApprovals_().sort(byDateDesc_('createdAt')).map(approvalView_);
  var counts = { to_print: 0, printed: 0, filed: 0, void: 0 };
  list.forEach(function (x) { if (counts[x.status] !== undefined) counts[x.status]++; });
  return { list: list, counts: counts };
}

// Records created since a time (used by the portal to offer "Print now / later" right after an approval).
function approvalsRecent_(p, req) {
  var u = requireUser_(req);
  if (ADMIN_ROLES.indexOf(u.role) === -1) return [];
  var since = String(p.since || '');
  return readApprovals_().filter(function (x) { return x.status === 'to_print' && String(x.createdAt) > since; })
    .sort(byDateDesc_('createdAt')).slice(0, 10).map(approvalView_);
}

function approvalsMark_(p, req) {
  var u = requireAdmin_(req);
  var x = readApprovals_().filter(function (r) { return r.id === p.id; })[0];
  if (!x) throw new Error('Approval record not found.');
  if (p.status === 'printed') {
    if (x.status === 'to_print') { x.status = 'printed'; x.printedAt = now_(); }
  } else if (p.status === 'filed') {
    var ref = String(p.fileRef || '').trim();
    if (!ref) throw new Error('Enter the file number or location where the signed copy is kept.');
    x.status = 'filed'; x.filedAt = now_(); x.fileRef = ref.slice(0, 120);
    if (!x.printedAt) x.printedAt = now_();
  } else if (p.status === 'to_print') {
    x.status = 'to_print'; x.filedAt = ''; x.fileRef = '';
  } else if (p.status === 'void') {
    var why = String(p.note || '').trim();
    if (!why) throw new Error('Give a reason for cancelling this record.');
    x.status = 'void'; x.note = why.slice(0, 500);
  } else {
    throw new Error('Unknown status.');
  }
  writeRow_('Approvals', APPROVAL_COLS, x);
  logRaw_(u.email, 'approval.' + p.status, '', x.id);
  return approvalsList_(p, req);
}

// Full record for the printable page; needs the private key from the portal link.
function publicApproval_(p) {
  var x = readApprovals_().filter(function (r) { return r.id === String(p.id || '').toUpperCase(); })[0];
  if (!x || !p.key || p.key !== x.token) return null;
  var v = approvalView_(x);
  delete v.token; delete v.printUrl; delete v.pdfUrl;
  var chair = chairs_()[0];
  v.chair = chair ? { name: chair.name, title: chair.title || ROLES.chair } : { name: '', title: ROLES.chair };
  return v;
}

function approvalVerify_(ref) {
  var x = readApprovals_().filter(function (r) { return r.id === ref; })[0];
  if (!x) return { kind: 'none' };
  // The subject is kept private: verification confirms the record exists, its category, date and status.
  return { kind: 'approval', record: { id: x.id, category: (APPROVAL_KINDS[x.kind] || APPROVAL_KINDS.manual).label,
    decidedAt: x.decidedAt, level: x.level, status: x.status, filedAt: x.filedAt } };
}
