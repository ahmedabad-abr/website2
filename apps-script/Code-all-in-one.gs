/**
 * Ahmedabad Business Review — Editorial backend (Google Apps Script)
 *
 * Bind this script to a Google Sheet (Extensions → Apps Script), then:
 *   1. Run  setup()            once (creates sheets, API secret, image folder)
 *   2. Use  ABR Admin → Create Chair account   (menu in the Sheet)
 *   3. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone
 *
 * Only the Cloudflare site talks to this script. Every request must carry the
 * API secret (stored in Script Properties → API_SECRET), which Cloudflare adds
 * on the server side, so browsers never see it.
 */

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

var ROLES = {
  chair:  'Chairperson',
  eic:    'Editor-in-Chief',
  coo:    'Chief Operating Officer',
  editor: 'Editor'
};
var APPROVER_ROLES = ['chair'];          // who can approve / publish
var ADMIN_ROLES    = ['chair'];          // who can manage the team

var SECTIONS = ['Business', 'Entrepreneurship', 'Innovation', 'Leadership', 'Policy & Economy'];
// Article types that must list at least MIN_REFERENCES references before submission.
var REFERENCED_TYPES = ['Analysis', 'Case Study', 'Research Brief', 'Explainer'];
var MIN_REFERENCES = 2;
var TYPES    = ['Analysis', 'Opinion', 'Interview', 'Case Study', 'Research Brief', 'Explainer'];

var SESSION_SECONDS = 21600;             // 6 hours (CacheService maximum)
var BODY_CHUNKS = 6;                     // 6 × 45,000 chars ≈ 270k chars per article
var CHUNK_SIZE  = 45000;

var USER_COLS = ['email', 'name', 'slug', 'role', 'title', 'bio', 'photoUrl', 'active',
                 'salt', 'hash', 'createdAt', 'updatedAt', 'termStart', 'termEnd', 'termReminded',
                 'totpSecret', 'totpEnabledAt', 'totpLastStep', 'backupCodes'];
// Offices that are held for a fixed term set by the Chair. When a term ends the holder
// receives a term-completion certificate and becomes an Editor until re-appointed.
var TERM_ROLES = ['eic', 'coo'];

var META_COLS = ['id', 'slug', 'status', 'title', 'standfirst', 'section', 'type', 'tags',
                 'coverUrl', 'coverCaption', 'authorEmail', 'coAuthors', 'sources', 'disclosure',
                 'correction', 'reviewNote', 'reviewedBy', 'wordCount', 'createdAt', 'updatedAt',
                 'submittedAt', 'publishedAt', 'modifiedAt', 'withdrawnAt'];
var BODY_COLS = [];
for (var _i = 1; _i <= BODY_CHUNKS; _i++) BODY_COLS.push('body_' + _i);
// Columns added after launch go at the END of the sheet so existing rows keep their layout.
var EXTRA_COLS = ['byline', 'partnerSlug', 'partnerType', 'aiGenerated', 'aiReport',
                  'issueKey', 'doi', 'doiState', 'contributor', 'trackKey', 'source'];
var ART_COLS = META_COLS.concat(BODY_COLS).concat(EXTRA_COLS);

// Byline options: named team authors, or an institutional "Curated by ABR" byline.
var BYLINES = ['authors', 'abr'];
var ABR_BYLINE = {
  name: 'Ahmedabad Business Review', slug: '', title: 'Editorial Desk', corporate: true, photoUrl: '',
  bio: 'This article was researched, written and edited by the Ahmedabad Business Review editorial desk and reviewed under ABR’s editorial standards.'
};

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

function doGet() {
  return ContentService.createTextOutput('ABR editorial API is running.');
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  var secret = prop_('API_SECRET');
  if (!secret || req.secret !== secret) return json_({ ok: false, error: 'Forbidden' });

  var handler = ROUTES[req.action] ||
    (typeof MAIL_ROUTES !== 'undefined' && MAIL_ROUTES[req.action]) ||
    (typeof FEATURE_ROUTES !== 'undefined' && FEATURE_ROUTES[req.action]) ||
    (typeof RECORD_ROUTES !== 'undefined' && RECORD_ROUTES[req.action]) ||
    (typeof APPROVAL_ROUTES !== 'undefined' && APPROVAL_ROUTES[req.action]) ||
    (typeof CONTRIB_ROUTES !== 'undefined' && CONTRIB_ROUTES[req.action]) ||
    (typeof PERM_ROUTES !== 'undefined' && PERM_ROUTES[req.action]) ||
    (typeof PLANNER_ROUTES !== 'undefined' && PLANNER_ROUTES[req.action]) ||
    (typeof SECURITY_ROUTES !== 'undefined' && SECURITY_ROUTES[req.action]) ||
    (typeof FESTIVE_ROUTES !== 'undefined' && FESTIVE_ROUTES[req.action]) ||
    (typeof AGREEMENT_ROUTES !== 'undefined' && AGREEMENT_ROUTES[req.action]);
  if (!handler) return json_({ ok: false, error: 'Unknown action' });

  try {
    if (typeof agreementGate_ === 'function') agreementGate_(req);
    var data = handler(req.payload || {}, req);
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

var ROUTES = {
  // Public (no login)
  'public.list':       publicList_,
  'public.article':    publicArticle_,
  'public.author':     publicAuthor_,
  'public.sitemap':    publicSitemap_,
  'public.team':       publicTeam_,
  'public.archive':    publicArchive_,
  'public.config':     function () { return { sections: SECTIONS, types: TYPES, minRefs: MIN_REFERENCES }; },

  // Session
  'auth.login':          login_,
  'auth.logout':         logout_,
  'auth.me':             function (p, req) { return { user: selfView_(requireUser_(req)), config: portalConfig_() }; },
  'auth.changePassword': changePassword_,
  'profile.update':      updateProfile_,

  // Writing
  'articles.mine':     myArticles_,
  'articles.get':      getArticle_,
  'articles.save':     saveArticle_,
  'articles.submit':   submitArticle_,
  'articles.withdraw': withdrawSubmission_,
  'articles.delete':   deleteArticle_,

  // Review (Chair)
  'review.queue':      reviewQueue_,
  'review.all':        allArticles_,
  'review.decide':     decide_,
  'review.unpublish':  unpublish_,

  // Team (Chair)
  'team.list':          teamList_,
  'team.save':          teamSave_,
  'team.resetPassword': teamResetPassword_,
  'team.directory':     teamDirectory_,

  // Media
  'upload.image':      uploadImage_
};

/* ------------------------------------------------------------------ */
/* Setup & admin menu                                                  */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ABR Admin')
    .addItem('Run setup', 'setup')
    .addItem('Create Chair account', 'menuCreateChair_')
    .addItem('Show API secret', 'menuShowSecret_')
    .addItem('Import starter articles', 'menuImportSeed_')
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, 'Users', USER_COLS);
  ensureSheet_(ss, 'Articles', ART_COLS);
  ensureSheet_(ss, 'AuditLog', ['time', 'email', 'action', 'articleId', 'note']);
  ensureSheet_(ss, 'Subscribers', SUB_COLS);
  ensureSheet_(ss, 'MailQueue', QUEUE_COLS);
  ensureSheet_(ss, 'Campaigns', CAMPAIGN_COLS);
  ensureSheet_(ss, 'Agreements', AGREE_COLS);
  if (typeof PARTNER_COLS !== 'undefined') ensureSheet_(ss, 'Partners', PARTNER_COLS);
  if (typeof CERT_COLS !== 'undefined') {
    ensureSheet_(ss, 'Certificates', CERT_COLS);
    ensureSheet_(ss, 'Letters', LETTER_COLS);
    ensureSheet_(ss, 'Issues', ISSUE_COLS);
  }
  if (typeof APPROVAL_COLS !== 'undefined') ensureSheet_(ss, 'Approvals', APPROVAL_COLS);
  if (typeof CONTRIB_COLS !== 'undefined') ensureSheet_(ss, 'Contributors', CONTRIB_COLS);
  if (typeof PERM_COLS !== 'undefined') ensureSheet_(ss, 'Permissions', PERM_COLS);
  if (typeof TASK_COLS !== 'undefined') { ensureSheet_(ss, 'Tasks', TASK_COLS); ensureSheet_(ss, 'Calendar', EVENT_COLS); }
  if (typeof GREET_COLS !== 'undefined') ensureSheet_(ss, 'Greetings', GREET_COLS);

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_SECRET')) {
    props.setProperty('API_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  }
  if (!props.getProperty('IMAGE_FOLDER_ID')) {
    var folder = DriveApp.createFolder('ABR — Article Images');
    props.setProperty('IMAGE_FOLDER_ID', folder.getId());
  }
  if (!props.getProperty('NOTIFY')) props.setProperty('NOTIFY', 'true');
  if (!props.getProperty('SITE_URL')) props.setProperty('SITE_URL', 'https://theabr.in');
  if (!props.getProperty('MAIL_FROM')) props.setProperty('MAIL_FROM', 'info@theabr.in');
  ensureMailTrigger_();
  Logger.log('Setup complete. API_SECRET = ' + props.getProperty('API_SECRET'));
}

function ensureSheet_(ss, name, cols) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sh.setFrozenRows(1);
  // Plain-text format so dates and IDs are never auto-converted.
  sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
}

function menuCreateChair_() {
  var ui = SpreadsheetApp.getUi();
  var email = ui.prompt('Chair email address').getResponseText().trim().toLowerCase();
  if (!email) return;
  var name = ui.prompt('Chair full name').getResponseText().trim();
  var temp = createOrResetUser_({ email: email, name: name, role: 'chair', title: ROLES.chair });
  ui.alert('Chair account ready.\n\nEmail: ' + email + '\nTemporary password: ' + temp +
           '\n\nLog in at /portal and change it straight away.');
}

function menuImportSeed_() {
  if (typeof importSeedArticles !== 'function') {
    SpreadsheetApp.getUi().alert('Add the Seed script file first (Extensions → Apps Script → + → Script → "Seed"), then try again.');
    return;
  }
  importSeedArticles();
}

function menuShowSecret_() {
  SpreadsheetApp.getUi().alert('API_SECRET (paste into Cloudflare → Settings → Environment variables):\n\n' +
    prop_('API_SECRET'));
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

function publicList_(p) {
  var users = usersByEmail_();
  var rows = readMeta_().filter(function (a) { return a.status === 'published'; });
  if (p.section) rows = rows.filter(function (a) { return slugify_(a.section) === p.section; });
  if (p.authorSlug) {
    var u = findUserBySlug_(p.authorSlug);
    if (!u) return { articles: [], total: 0 };
    // Curated (institutional-byline) articles do not appear on personal author pages.
    rows = rows.filter(function (a) { return a.byline !== 'abr' && authorEmails_(a).indexOf(u.email) !== -1; });
  }
  rows.sort(byDateDesc_('publishedAt'));
  var total = rows.length;
  var offset = Number(p.offset) || 0, limit = Math.min(Number(p.limit) || 20, 100);
  return {
    total: total,
    articles: rows.slice(offset, offset + limit).map(function (a) { return publicView_(a, users, false); })
  };
}

function publicArticle_(p) {
  var meta = readMeta_().filter(function (a) { return a.slug === p.slug; })[0];
  if (!meta) return null;
  if (meta.status === 'withdrawn') {
    return { withdrawn: true, title: meta.title, slug: meta.slug, id: meta.id,
             withdrawnAt: meta.withdrawnAt, reason: meta.reviewNote, publishedAt: meta.publishedAt };
  }
  if (meta.status !== 'published') return null;
  var full = readFull_(meta._row);
  return publicView_(full, usersByEmail_(), true);
}

function publicAuthor_(p) {
  var u = findUserBySlug_(p.slug);
  if (!u || !truthy_(u.active)) return null;
  var list = publicList_({ authorSlug: p.slug, limit: 100 });
  return { author: authorView_(u), articles: list.articles };
}

function publicSitemap_() {
  var users = readUsers_();
  var arts = readMeta_().filter(function (a) { return a.status === 'published'; })
    .map(function (a) { return { slug: a.slug, publishedAt: a.publishedAt, modifiedAt: a.modifiedAt || a.publishedAt,
                                 title: a.title, section: a.section }; });
  var authors = users.filter(function (u) { return truthy_(u.active); }).map(function (u) { return { slug: u.slug }; });
  var issues = typeof publicIssues_ === 'function' ? publicIssues_().map(function (i) { return { key: i.key, compiledAt: i.compiledAt }; }) : [];
  return { articles: arts, authors: authors, sections: SECTIONS, issues: issues };
}

function publicArchive_() {
  var users = usersByEmail_();
  return {
    articles: readMeta_().filter(function (a) { return a.status === 'published'; })
      .sort(byDateDesc_('publishedAt'))
      .map(function (a) { return publicView_(a, users, false); })
  };
}

function publicTeam_() {
  var order = Object.keys(ROLES);
  return readUsers_().filter(function (u) { return truthy_(u.active); })
    .sort(function (a, b) { return order.indexOf(a.role) - order.indexOf(b.role) || String(a.name).localeCompare(String(b.name)); })
    .map(authorView_);
}

function publicView_(a, users, withBody) {
  var out = {
    id: a.id, slug: a.slug, title: a.title, standfirst: a.standfirst,
    section: a.section, sectionSlug: slugify_(a.section), type: a.type,
    tags: splitList_(a.tags), coverUrl: a.coverUrl, coverCaption: a.coverCaption,
    authors: a.byline === 'abr' ? [ABR_BYLINE] :
      a.source === 'external' ? [contributorView_(a)] :
      authorEmails_(a).map(function (e) { return users[e] ? authorView_(users[e]) : null; })
                      .filter(function (x) { return x; }),
    issue: issueRef_(a.issueKey),
    doi: a.doi && a.doiState === 'published' ? a.doi : '',
    doiReserved: a.doi || '',
    curated: a.byline === 'abr',
    partner: partnerForArticle_(a),
    publishedAt: a.publishedAt, modifiedAt: a.modifiedAt || '', correction: a.correction,
    wordCount: Number(a.wordCount) || 0,
    licence: typeof contentLicence_ === 'function' ? contentLicence_() : null,
    rightsHolder: a.source === 'external' ? (safeParse_(a.contributor) || {}).name || '' : '',
    aiAssisted: truthy_(a.aiGenerated)
  };
  if (withBody) {
    out.body = a.body || '';
    out.sources = splitLines_(a.sources);
    out.disclosure = a.disclosure;
  }
  return out;
}

function contributorView_(a) {
  var c = safeParse_(a.contributor) || {};
  return { name: c.name || 'Contributor', slug: '', title: 'Contributor', affiliation: c.affiliation || '',
           bio: c.bio || '', photoUrl: '', external: true };
}

// "v1n6" → { key, volume: 1, number: 6 }
function issueRef_(key) {
  var m = /^v(\d+)n(\d+)$/.exec(String(key || ''));
  return m ? { key: key, volume: Number(m[1]), number: Number(m[2]) } : null;
}

function authorView_(u) {
  return { name: u.name, slug: u.slug, title: u.title || ROLES[u.role] || '', bio: u.bio, photoUrl: u.photoUrl };
}

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

function login_(p) {
  var email = String(p.email || '').trim().toLowerCase();
  var cache = CacheService.getScriptCache();
  var failKey = 'fail_' + email;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) throw new Error('Too many attempts. Try again in 15 minutes.');

  var u = usersByEmail_()[email];
  if (!u || !truthy_(u.active) || hash_(String(p.password || ''), u.salt) !== u.hash) {
    cache.put(failKey, String(fails + 1), 900);
    throw new Error('Incorrect email or password.');
  }
  cache.remove(failKey);
  if (typeof TWO_FACTOR_ENFORCED !== 'undefined' && TWO_FACTOR_ENFORCED) return tfaChallenge_(u);
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  cache.put('sess_' + token, email, SESSION_SECONDS);
  log_(email, 'login', '', '');
  return { token: token, user: selfView_(u), config: portalConfig_() };
}

function logout_(p, req) {
  if (req.token) CacheService.getScriptCache().remove('sess_' + req.token);
  return true;
}

function requireUser_(req) {
  if (!req.token) throw new Error('Please log in.');
  var cache = CacheService.getScriptCache();
  var email = cache.get('sess_' + req.token);
  if (!email) throw new Error('Your session has expired. Please log in again.');
  var u = usersByEmail_()[email];
  if (!u || !truthy_(u.active)) throw new Error('Account disabled.');
  if (typeof TWO_FACTOR_ENFORCED !== 'undefined' && TWO_FACTOR_ENFORCED && !u.totpSecret) {
    cache.remove('sess_' + req.token);
    throw new Error('Your session has expired. Two-factor sign-in is now required: please log in again to set it up.');
  }
  cache.put('sess_' + req.token, email, SESSION_SECONDS); // sliding expiry
  return u;
}

function requireApprover_(req) {
  var u = requireUser_(req);
  if (APPROVER_ROLES.indexOf(u.role) === -1) throw new Error('Only the Chair can do this.');
  return u;
}

function requireAdmin_(req) {
  var u = requireUser_(req);
  if (ADMIN_ROLES.indexOf(u.role) === -1) throw new Error('Only the Chair can manage the team.');
  return u;
}

function changePassword_(p, req) {
  var u = requireUser_(req);
  if (hash_(String(p.current || ''), u.salt) !== u.hash) throw new Error('Current password is incorrect.');
  if (String(p.next || '').length < 8) throw new Error('New password must be at least 8 characters.');
  u.salt = Utilities.getUuid();
  u.hash = hash_(String(p.next), u.salt);
  u.updatedAt = now_();
  writeRow_('Users', USER_COLS, u);
  log_(u.email, 'changePassword', '', '');
  return true;
}

function updateProfile_(p, req) {
  var u = requireUser_(req);
  if (p.name) u.name = String(p.name).trim();
  if (p.bio !== undefined) u.bio = String(p.bio).trim().slice(0, 1200);
  if (p.photoUrl !== undefined) u.photoUrl = cleanUrl_(p.photoUrl);
  u.updatedAt = now_();
  writeRow_('Users', USER_COLS, u);
  return selfView_(u);
}

function selfView_(u) {
  return { email: u.email, name: u.name, slug: u.slug, role: u.role, title: u.title || ROLES[u.role],
           bio: u.bio, photoUrl: u.photoUrl,
           canApprove: APPROVER_ROLES.indexOf(u.role) !== -1,
           canAdmin: ADMIN_ROLES.indexOf(u.role) !== -1,
           canMail: MAIL_ROLES.indexOf(u.role) !== -1,
           canAi: typeof AI_ROLES !== 'undefined' && AI_ROLES.indexOf(u.role) !== -1,
           termStart: u.termStart || '', termEnd: u.termEnd || '',
           needsAgreement: needsAgreement_(u),
           tfaEnabled: !!u.totpSecret, tfaSince: u.totpEnabledAt || '',
           backupCodesLeft: (safeParse_(u.backupCodes) || []).length };
}

function portalConfig_() {
  return { sections: SECTIONS, types: TYPES, roles: ROLES, siteUrl: prop_('SITE_URL') };
}

function hash_(password, salt) {
  var h = salt + '|' + password;
  for (var i = 0; i < 300; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return h;
}

function tempPassword_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var out = '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid());
  for (var i = 0; i < 12; i++) out += chars.charAt((bytes[i] + 128) % chars.length);
  return out;
}

/* ------------------------------------------------------------------ */
/* Articles — writing                                                  */
/* ------------------------------------------------------------------ */

function myArticles_(p, req) {
  var u = requireUser_(req);
  var users = usersByEmail_();
  return readMeta_()
    .filter(function (a) { return authorEmails_(a).indexOf(u.email) !== -1; })
    .sort(byDateDesc_('updatedAt'))
    .map(function (a) { return listView_(a, users); });
}

function getArticle_(p, req) {
  var u = requireUser_(req);
  var a = findArticle_(p.id, true);
  if (!canRead_(u, a)) throw new Error('You do not have access to this article.');
  return editView_(a, usersByEmail_());
}

function saveArticle_(p, req) {
  var u = requireUser_(req);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var a, isNew = !p.id;
    if (isNew) {
      a = { id: nextId_(), status: 'draft', authorEmail: u.email, createdAt: now_() };
    } else {
      a = findArticle_(p.id, true);
      if (!canEdit_(u, a)) throw new Error('This article is locked while it is under review or published.');
    }

    var fields = ['title', 'standfirst', 'section', 'type', 'coverCaption', 'sources', 'disclosure'];
    fields.forEach(function (f) { if (p[f] !== undefined) a[f] = String(p[f]).trim(); });
    if (p.tags !== undefined) a.tags = splitList_(p.tags).join(', ');
    if (p.coverUrl !== undefined) a.coverUrl = cleanUrl_(p.coverUrl);
    if (p.byline !== undefined) {
      if (BYLINES.indexOf(p.byline) === -1) throw new Error('Unknown byline option.');
      a.byline = p.byline === 'abr' ? 'abr' : '';
    }
    if (p.coAuthors !== undefined) {
      var users = usersByEmail_();
      a.coAuthors = splitList_(p.coAuthors)
        .map(function (e) { return e.toLowerCase(); })
        .filter(function (e) { return users[e] && e !== a.authorEmail; })
        .join(', ');
    }
    if (p.body !== undefined) {
      a.body = String(p.body);
      if (a.body.length > BODY_CHUNKS * CHUNK_SIZE) throw new Error('Article is too long to store.');
      a.wordCount = countWords_(a.body);
    }
    if (!a.title) throw new Error('Please add a title.');
    if (a.section && SECTIONS.indexOf(a.section) === -1) throw new Error('Unknown section.');
    if (a.type && TYPES.indexOf(a.type) === -1) throw new Error('Unknown article type.');

    var approver = APPROVER_ROLES.indexOf(u.role) !== -1;
    if (approver) {
      if (p.slug !== undefined && a.status !== 'published' && a.status !== 'withdrawn') {
        a.slug = p.slug ? uniqueSlug_(slugify_(p.slug), a.id) : '';
      }
      if (p.correction !== undefined) a.correction = String(p.correction).trim();
      if (p.partnerType !== undefined || p.partnerSlug !== undefined) {
        var pType = String(p.partnerType || '');
        if (['', 'partner', 'promoted'].indexOf(pType) === -1) throw new Error('Unknown partnership type.');
        var pSlug = pType ? String(p.partnerSlug || '') : '';
        if (pType && !findPartner_(pSlug)) throw new Error('Choose a partner for a partnership or promoted article.');
        a.partnerType = pType;
        a.partnerSlug = pSlug;
      }
      // Back-dating for articles migrated from earlier print issues.
      if (p.publishedDate !== undefined && a.status !== 'published' && a.status !== 'withdrawn') {
        var d = String(p.publishedDate).trim();
        if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Publication date must be YYYY-MM-DD.');
        a.publishedAt = d ? new Date(d + 'T09:00:00+05:30').toISOString() : '';
      }
      if (a.status === 'published' && p.markUpdated) { a.modifiedAt = now_(); queuePdfWarm_(a.slug); }
    }

    a.updatedAt = now_();
    writeArticle_(a);
    log_(u.email, isNew ? 'create' : 'save', a.id, '');
    return editView_(a, usersByEmail_());
  } finally {
    lock.releaseLock();
  }
}

function submitArticle_(p, req) {
  var u = requireUser_(req);
  var a = findArticle_(p.id, true);
  if (a.authorEmail !== u.email && APPROVER_ROLES.indexOf(u.role) === -1) throw new Error('Only the lead author can submit.');
  if (['draft', 'changes_requested', 'rejected'].indexOf(a.status) === -1) throw new Error('This article cannot be submitted now.');
  var missing = [];
  if (!a.title) missing.push('title');
  if (!a.standfirst) missing.push('standfirst');
  if (!a.section) missing.push('section');
  if (!a.type) missing.push('type');
  if (!a.body || countWords_(a.body) < 150) missing.push('body (150+ words)');
  if (REFERENCED_TYPES.indexOf(a.type) !== -1 && splitLines_(a.sources).length < MIN_REFERENCES) {
    missing.push('at least ' + MIN_REFERENCES + ' references (required for ' + a.type + ')');
  }
  if (missing.length) throw new Error('Before submitting, add: ' + missing.join(', ') + '.');

  a.status = 'submitted';
  a.submittedAt = now_();
  a.updatedAt = now_();
  writeArticle_(a);
  log_(u.email, 'submit', a.id, '');

  var approvers = readUsers_().filter(function (x) { return APPROVER_ROLES.indexOf(x.role) !== -1 && truthy_(x.active); });
  approvers.forEach(function (x) {
    notify_(x.email, 'For approval: ' + a.title,
      '<p><b>' + esc_(u.name) + '</b> submitted <b>' + esc_(a.title) + '</b> (' + a.id + ') for approval.</p>' +
      '<p>' + esc_(a.standfirst || '') + '</p>' + portalLink_());
  });
  return editView_(a, usersByEmail_());
}

function withdrawSubmission_(p, req) {
  var u = requireUser_(req);
  var a = findArticle_(p.id, true);
  if (a.authorEmail !== u.email) throw new Error('Only the lead author can withdraw a submission.');
  if (a.status !== 'submitted') throw new Error('Only submitted articles can be withdrawn.');
  a.status = 'draft';
  a.updatedAt = now_();
  writeArticle_(a);
  log_(u.email, 'withdrawSubmission', a.id, '');
  return editView_(a, usersByEmail_());
}

function deleteArticle_(p, req) {
  var u = requireUser_(req);
  var a = findArticle_(p.id, false);
  var approver = APPROVER_ROLES.indexOf(u.role) !== -1;
  if (a.status === 'published' || a.status === 'withdrawn') throw new Error('Published articles cannot be deleted. Withdraw it instead.');
  if (!(approver || (a.authorEmail === u.email && ['draft', 'changes_requested', 'rejected'].indexOf(a.status) !== -1))) {
    throw new Error('You cannot delete this article.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    sheet_('Articles').deleteRow(a._row);
  } finally { lock.releaseLock(); }
  log_(u.email, 'delete', a.id, a.title);
  return true;
}

function canRead_(u, a) {
  return APPROVER_ROLES.indexOf(u.role) !== -1 || authorEmails_(a).indexOf(u.email) !== -1;
}

function canEdit_(u, a) {
  if (APPROVER_ROLES.indexOf(u.role) !== -1) return true;
  return authorEmails_(a).indexOf(u.email) !== -1 &&
         ['draft', 'changes_requested', 'rejected'].indexOf(a.status) !== -1;
}

/* ------------------------------------------------------------------ */
/* Review (Chair)                                                      */
/* ------------------------------------------------------------------ */

function reviewQueue_(p, req) {
  requireApprover_(req);
  var users = usersByEmail_();
  return readMeta_().filter(function (a) { return a.status === 'submitted'; })
    .sort(function (x, y) { return String(x.submittedAt).localeCompare(String(y.submittedAt)); })
    .map(function (a) { return listView_(a, users); });
}

function allArticles_(p, req) {
  requireApprover_(req);
  var users = usersByEmail_();
  return readMeta_().sort(byDateDesc_('updatedAt')).map(function (a) { return listView_(a, users); });
}

function decide_(p, req) {
  var u = requireApprover_(req);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var a = findArticle_(p.id, true);
    var note = String(p.note || '').trim();
    var author = usersByEmail_()[a.authorEmail];

    if (p.decision === 'approve') {
      if (['submitted', 'draft', 'changes_requested', 'withdrawn', 'rejected'].indexOf(a.status) === -1) {
        throw new Error('This article cannot be published from its current state.');
      }
      if (!a.title || !a.section || !a.type || !a.body) throw new Error('Title, section, type and body are required to publish.');
      if (!a.slug) a.slug = uniqueSlug_(slugify_(a.title), a.id);
      var republish = a.status === 'withdrawn';
      a.status = 'published';
      if (!a.publishedAt) a.publishedAt = now_();
      if (republish) { a.modifiedAt = now_(); a.withdrawnAt = ''; }
      a.reviewNote = note;
      a.reviewedBy = u.email;
      a.updatedAt = now_();
      writeArticle_(a);
      log_(u.email, 'publish', a.id, note);
      queuePdfWarm_(a.slug);
      if (typeof onPublished_ === 'function') {
        try { onPublished_(a, u); } catch (e) { log_('system', 'onPublishedFailed', a.id, e.message); }
      }
      if (author) notify_(author.email, 'Published: ' + a.title,
        '<p>Your article <b>' + esc_(a.title) + '</b> has been approved and published.</p>' +
        '<p><a href="' + prop_('SITE_URL') + '/articles/' + a.slug + '">' + prop_('SITE_URL') + '/articles/' + a.slug + '</a></p>' +
        (note ? '<p>Note from the Chair: ' + esc_(note) + '</p>' : ''));
    } else if (p.decision === 'changes' || p.decision === 'reject') {
      if (a.status !== 'submitted') throw new Error('Only submitted articles can be sent back.');
      if (!note) throw new Error('Please add a note for the author.');
      a.status = p.decision === 'changes' ? 'changes_requested' : 'rejected';
      a.reviewNote = note;
      a.reviewedBy = u.email;
      a.updatedAt = now_();
      writeArticle_(a);
      log_(u.email, a.status, a.id, note);
      if (typeof onSentBack_ === 'function') {
        try { onSentBack_(a, note); } catch (e) { log_('system', 'onSentBackFailed', a.id, e.message); }
      }
      if (author) notify_(author.email, (p.decision === 'changes' ? 'Changes requested: ' : 'Not accepted: ') + a.title,
        '<p>' + (p.decision === 'changes' ? 'The Chair has asked for changes to ' : 'The Chair has not accepted ') +
        '<b>' + esc_(a.title) + '</b>.</p><p><b>Note:</b> ' + esc_(note) + '</p>' + portalLink_());
    } else {
      throw new Error('Unknown decision.');
    }
    return editView_(a, usersByEmail_());
  } finally {
    lock.releaseLock();
  }
}

function unpublish_(p, req) {
  var u = requireApprover_(req);
  var a = findArticle_(p.id, true);
  if (a.status !== 'published') throw new Error('Only published articles can be withdrawn.');
  var reason = String(p.reason || '').trim();
  if (!reason) throw new Error('Please give a public reason. It is shown on the withdrawal notice.');
  a.status = 'withdrawn';
  a.withdrawnAt = now_();
  a.reviewNote = reason;
  a.updatedAt = now_();
  writeArticle_(a);
  log_(u.email, 'withdraw', a.id, reason);
  return editView_(a, usersByEmail_());
}

/* ------------------------------------------------------------------ */
/* Team (Chair)                                                        */
/* ------------------------------------------------------------------ */

function teamList_(p, req) {
  requireAdmin_(req);
  return readUsers_().map(function (u) {
    var v = selfView_(u); v.active = truthy_(u.active); return v;
  });
}

function teamDirectory_(p, req) {
  requireUser_(req);
  return readUsers_().filter(function (u) { return truthy_(u.active); })
    .map(function (u) { return { email: u.email, name: u.name, title: u.title || ROLES[u.role] }; });
}

function teamSave_(p, req) {
  var admin = requireAdmin_(req);
  var email = String(p.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (!ROLES[p.role]) throw new Error('Unknown role.');
  var existing = usersByEmail_()[email];
  if (existing) {
    if (email === admin.email && (p.role !== existing.role || p.active === false)) {
      throw new Error('You cannot change your own role or disable yourself.');
    }
    existing.name = String(p.name || existing.name).trim();
    if (TERM_ROLES.indexOf(p.role) !== -1 && (existing.role !== p.role || p.termEnd)) {
      var newEnd = termEndFrom_(p.termEnd);
      if (existing.role !== p.role || newEnd !== existing.termEnd) {
        if (existing.role !== p.role) existing.termStart = now_().slice(0, 10);
        existing.termEnd = newEnd;
        existing.termReminded = '';
        log_(admin.email, 'term.appoint', '', email + ' as ' + p.role + ' until ' + newEnd);
      }
    } else if (TERM_ROLES.indexOf(existing.role) !== -1 && existing.role !== p.role) {
      existing.termStart = ''; existing.termEnd = ''; existing.termReminded = '';
    }
    existing.role = p.role;
    existing.title = String(p.title || ROLES[p.role]).trim();
    if (p.active !== undefined) existing.active = p.active ? 'TRUE' : 'FALSE';
    existing.updatedAt = now_();
    writeRow_('Users', USER_COLS, existing);
    log_(admin.email, 'team.update', '', email);
    return { email: email };
  }
  var term = TERM_ROLES.indexOf(p.role) !== -1 ? termEndFrom_(p.termEnd) : '';
  var temp = createOrResetUser_({ email: email, name: p.name, role: p.role, title: p.title || ROLES[p.role] });
  if (term) {
    var nu = usersByEmail_()[email];
    nu.termStart = now_().slice(0, 10); nu.termEnd = term; nu.termReminded = '';
    writeRow_('Users', USER_COLS, nu);
    log_(admin.email, 'term.appoint', '', email + ' as ' + p.role + ' until ' + term);
  }
  log_(admin.email, 'team.add', '', email);
  var welcome = 'not sent';
  try { welcome = sendWelcome_(usersByEmail_()[email], temp); } catch (e) { log_(admin.email, 'welcomeFailed', '', e.message); }
  return { email: email, tempPassword: temp, welcome: welcome };
}

// Term end dates are required for EiC and COO and must be in the future (YYYY-MM-DD).
function termEndFrom_(v) {
  v = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Set the term end date (YYYY-MM-DD) for this office.');
  if (v <= Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')) throw new Error('The term end date must be in the future.');
  return v;
}

function teamResetPassword_(p, req) {
  var admin = requireAdmin_(req);
  var u = usersByEmail_()[String(p.email || '').toLowerCase()];
  if (!u) throw new Error('No such user.');
  var temp = createOrResetUser_(u);
  log_(admin.email, 'team.resetPassword', '', u.email);
  try { sendPasswordReset_(u, temp); } catch (e) {}
  return { email: u.email, tempPassword: temp };
}

function createOrResetUser_(info) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var email = String(info.email).trim().toLowerCase();
    var u = usersByEmail_()[email];
    var temp = tempPassword_();
    if (!u) {
      u = { email: email, name: String(info.name || email).trim(), role: info.role,
            title: info.title || ROLES[info.role], bio: '', photoUrl: '', active: 'TRUE',
            createdAt: now_() };
      u.slug = uniqueUserSlug_(slugify_(u.name));
    }
    u.salt = Utilities.getUuid();
    u.hash = hash_(temp, u.salt);
    u.updatedAt = now_();
    writeRow_('Users', USER_COLS, u);
    return temp;
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

function uploadImage_(p, req) {
  var u = requireUser_(req);
  var m = /^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/.exec(String(p.dataUrl || ''));
  if (!m) throw new Error('Upload a PNG, JPEG, WebP or GIF image.');
  var bytes = Utilities.base64Decode(m[3]);
  if (bytes.length > 5 * 1024 * 1024) throw new Error('Image must be under 5 MB.');
  var name = (String(p.filename || 'image').replace(/[^\w.\-]+/g, '_')).slice(0, 80);
  var folder = DriveApp.getFolderById(prop_('IMAGE_FOLDER_ID'));
  var file = folder.createFile(Utilities.newBlob(bytes, m[1], name));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  log_(u.email, 'upload', '', file.getId());
  return { url: 'https://lh3.googleusercontent.com/d/' + file.getId() };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function listView_(a, users) {
  return {
    id: a.id, slug: a.slug, status: a.status, title: a.title, section: a.section, type: a.type,
    authorEmail: a.authorEmail,
    authors: authorEmails_(a).map(function (e) { return users[e] ? users[e].name : e; }),
    byline: a.byline === 'abr' ? 'abr' : 'authors',
    partnerSlug: a.partnerSlug || '', partnerType: a.partnerType || '',
    aiGenerated: truthy_(a.aiGenerated),
    source: a.source || '', issueKey: a.issueKey || '', doi: a.doi || '', doiState: a.doiState ? String(a.doiState).split('|')[0] : '',
    doiError: /\|error: /.test(a.doiState || '') || /^error\|/.test(a.doiState || '') ? String(a.doiState).split(/\|(?:error: )?/).pop() : '',
    contributorName: a.source === 'external' ? (safeParse_(a.contributor) || {}).name || '' : '',
    wordCount: Number(a.wordCount) || 0, reviewNote: a.reviewNote,
    updatedAt: a.updatedAt, submittedAt: a.submittedAt, publishedAt: a.publishedAt
  };
}

function editView_(a, users) {
  var v = listView_(a, users);
  ['standfirst', 'tags', 'coverUrl', 'coverCaption', 'coAuthors', 'sources', 'disclosure',
   'correction', 'body', 'modifiedAt', 'withdrawnAt', 'createdAt', 'aiReport'].forEach(function (f) { v[f] = a[f] || ''; });
  if (a.source === 'external') v.contributor = safeParse_(a.contributor) || {};
  if (typeof articleTimeline_ === 'function') v.timeline = articleTimeline_(a.id);
  return v;
}

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                       */
/* ------------------------------------------------------------------ */

function sheet_(name) { return SpreadsheetApp.getActive().getSheetByName(name); }

function readRows_(name, cols, width) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, width || cols.length).getValues();
  return vals.map(function (r, i) {
    var o = { _row: i + 2 };
    for (var j = 0; j < (width || cols.length); j++) o[cols[j]] = cell_(r[j]);
    return o;
  }).filter(function (o) { return o[cols[0]]; });
}

function readUsers_() { return readRows_('Users', USER_COLS); }

function usersByEmail_() {
  var map = {};
  readUsers_().forEach(function (u) { map[u.email] = u; });
  return map;
}

function findUserBySlug_(slug) {
  return readUsers_().filter(function (u) { return u.slug === slug; })[0] || null;
}

function readMeta_() {
  var rows = readRows_('Articles', META_COLS, META_COLS.length);
  if (!rows.length) return rows;
  // Columns kept after the body chunks (see EXTRA_COLS) are read separately to avoid loading bodies.
  var sh = sheet_('Articles');
  var start = META_COLS.length + BODY_COLS.length + 1;
  var extra = sh.getRange(2, start, sh.getLastRow() - 1, EXTRA_COLS.length).getValues();
  rows.forEach(function (o) {
    var r = extra[o._row - 2] || [];
    EXTRA_COLS.forEach(function (c, j) { o[c] = cell_(r[j]); });
  });
  return rows;
}

function readFull_(row) {
  var vals = sheet_('Articles').getRange(row, 1, 1, ART_COLS.length).getValues()[0];
  var o = { _row: row };
  ART_COLS.forEach(function (c, j) { o[c] = cell_(vals[j]); });
  o.body = BODY_COLS.map(function (c) { return o[c] || ''; }).join('');
  return o;
}

function findArticle_(id, withBody) {
  var meta = readMeta_().filter(function (a) { return a.id === id; })[0];
  if (!meta) throw new Error('Article not found.');
  return withBody ? readFull_(meta._row) : meta;
}

function writeArticle_(a) {
  var body = a.body || '';
  for (var i = 0; i < BODY_CHUNKS; i++) a[BODY_COLS[i]] = body.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
  writeRow_('Articles', ART_COLS, a);
}

function writeRow_(name, cols, obj) {
  var row = cols.map(function (c) { return safe_(obj[c]); });
  var sh = sheet_(name);
  if (obj._row) {
    sh.getRange(obj._row, 1, 1, cols.length).setValues([row]);
  } else {
    var r = sh.getLastRow() + 1;
    sh.getRange(r, 1, 1, cols.length).setNumberFormat('@').setValues([row]);
    obj._row = r;
  }
}

function cell_(v) {
  if (v instanceof Date) return v.toISOString();
  if (v === null || v === undefined) return '';
  v = String(v);
  return /^'[=+\-@]/.test(v) ? v.slice(1) : v;
}

function safe_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v; // never let text become a formula
  return v;
}

function log_(email, action, id, note) {
  try { sheet_('AuditLog').appendRow([now_(), email, action, id, safe_(String(note || '').slice(0, 500))]); } catch (e) {}
  // Significant approvals also become printable approval records (Approvals.gs).
  if (typeof approvalFromLog_ === 'function') approvalFromLog_(email, action, id, note);
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function now_() { return new Date().toISOString(); }

function truthy_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

// PDFs are generated by the website on first request; warming them here means readers
// and Google Scholar never wait. Runs from the 5-minute background trigger.
function queuePdfWarm_(slug) {
  if (!slug) return;
  var props = PropertiesService.getScriptProperties();
  var list = safeParse_(props.getProperty('PDF_WARM')) || [];
  if (list.indexOf(slug) === -1) list.push(slug);
  props.setProperty('PDF_WARM', JSON.stringify(list.slice(-50)));
}

function warmPdfs_() {
  var props = PropertiesService.getScriptProperties();
  var list = safeParse_(props.getProperty('PDF_WARM')) || [];
  if (!list.length) return;
  var site = prop_('SITE_URL') || 'https://theabr.in';
  var batch = list.slice(0, 4), rest = list.slice(4);
  batch.forEach(function (slug) {
    try {
      var r = UrlFetchApp.fetch(site + '/articles/' + slug + '.pdf', { muteHttpExceptions: true, followRedirects: false });
      if (r.getResponseCode() >= 500) rest.push(slug);
    } catch (e) { rest.push(slug); }
  });
  props.setProperty('PDF_WARM', JSON.stringify(rest));
}

function safeParse_(t) { try { return JSON.parse(t); } catch (e) { return null; } }

function nextId_() {
  var year = new Date().getFullYear();
  var props = PropertiesService.getScriptProperties();
  var key = 'SEQ_' + year;
  var n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  return 'ABR-' + year + '-' + ('0000' + n).slice(-4);
}

function slugify_(s) {
  return String(s || '').toLowerCase()
    .replace(/['’‘]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(.{1,80})(-.*)?$/, function (m, head, rest) { return rest && head.length === 80 ? head.replace(/-[^-]*$/, '') : head; })
    .replace(/^(.{80}).+$/, '$1') || 'article';
}

function uniqueSlug_(base, id) {
  var taken = {};
  readMeta_().forEach(function (a) { if (a.id !== id && a.slug) taken[a.slug] = true; });
  var s = base, n = 2;
  while (taken[s]) s = base + '-' + (n++);
  return s;
}

function uniqueUserSlug_(base) {
  var taken = {};
  readUsers_().forEach(function (u) { taken[u.slug] = true; });
  var s = base, n = 2;
  while (taken[s]) s = base + '-' + (n++);
  return s;
}

function authorEmails_(a) {
  return [a.authorEmail].concat(splitList_(a.coAuthors)).filter(function (e) { return e; });
}

function splitList_(v) {
  if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(function (x) { return x; });
  return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
}

function splitLines_(v) {
  return String(v || '').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
}

function cleanUrl_(u) {
  u = String(u || '').trim();
  return /^https:\/\//i.test(u) ? u : '';
}

function countWords_(html) {
  var text = String(html || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
  var m = text.match(/\S+/g);
  return m ? m.length : 0;
}

function byDateDesc_(field) {
  return function (x, y) { return String(y[field] || '').localeCompare(String(x[field] || '')); };
}

function esc_(s) {
  return String(s || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function portalLink_() {
  var url = prop_('SITE_URL') + '/portal/';
  return '<p><a href="' + url + '">Open the ABR editorial portal</a></p>';
}

function notify_(to, subject, html) {
  if (prop_('NOTIFY') !== 'true') return;
  try {
    sendSystemEmail_(to, '[ABR] ' + subject, renderEmail_({ heading: subject, bodyHtml: html, footer: 'system' }));
  } catch (e) {
    log_('system', 'notifyFailed', '', to + ': ' + e.message);
  }
}
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
var SUB_COLS = ['email', 'name', 'status', 'token', 'source', 'createdAt', 'confirmedAt', 'unsubscribedAt', 'ip',
                'prefs', 'prefsUpdatedAt'];
// What a subscriber receives. freq: 'instant' (every new article), 'weekly', 'monthly' or 'off'.
var SUB_FREQS = ['instant', 'weekly', 'monthly', 'off'];
var SUB_DEFAULT_PREFS = { freq: 'weekly', sections: [], issues: true, news: true };

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
  'public.unsubscribe':  publicUnsubscribe_,
  'public.subPrefs.get':  publicSubPrefsGet_,
  'public.subPrefs.save': publicSubPrefsSave_
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
      var provider = q.kind === 'campaign' || q.kind === 'digest' ? s.routeBulk : s.routeTx;
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
    ? 'You are receiving this because you subscribed to Ahmedabad Business Review. <a href="{{prefs_url}}" style="color:#555">Choose what you receive</a> &middot; <a href="{{unsubscribe_url}}" style="color:#555">Unsubscribe</a>.'
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
             .replace(/\{\{unsubscribe_url\}\}/g, q.token ? site + '/unsubscribe?t=' + encodeURIComponent(q.token) : site)
             .replace(/\{\{prefs_url\}\}/g, q.token ? site + '/subscribe/preferences?t=' + encodeURIComponent(q.token) : site + '/subscribe');
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
    if (a === 'subscribers') readRows_('Subscribers', SUB_COLS).forEach(function (s) { if (s.status === 'active' && subPrefs_(s).news) add(s.email, s.name, s.token, 'subscriber'); });
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
      '<p>By default you get a <b>weekly digest</b> of new articles, every new issue and our occasional newsletters. You can switch to an email for every new article, a monthly digest, or only the sections you care about: <a href="' + site + '/subscribe/preferences?t=' + sub.token + '">choose what you receive</a>.</p>' +
      '<p>Every ABR article is reviewed before publication, carries its sources, and can be cited. Read our <a href="' + site + '/editorial-standards">editorial standards</a>.</p>',
    button: { label: 'Read the latest', url: site },
    footer: 'subscriber'
  }).replace(/\{\{unsubscribe_url\}\}/g, site + '/unsubscribe?t=' + sub.token).replace(/\{\{prefs_url\}\}/g, site + '/subscribe/preferences?t=' + sub.token), sub.name);
  return { name: sub.name, token: sub.token };
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
  var counts = { active: 0, pending: 0, unsubscribed: 0, instant: 0, weekly: 0, monthly: 0, off: 0 };
  rows.forEach(function (s) { if (counts[s.status] !== undefined) counts[s.status]++; if (s.status === 'active') counts[subPrefs_(s).freq]++; });
  return {
    counts: counts,
    subscribers: rows.reverse().map(function (s) {
      var pr = subPrefs_(s);
      return { email: s.email, name: s.name, status: s.status, source: s.source, createdAt: s.createdAt, confirmedAt: s.confirmedAt,
               freq: pr.freq, sections: pr.sections, issues: pr.issues, news: pr.news };
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


/* ------------------------------------------------------------------ */
/* Subscriber preferences and automatic updates                        */
/* ------------------------------------------------------------------ */

function subPrefs_(sub) {
  var p = safeParse_(sub && sub.prefs) || {};
  return {
    freq: SUB_FREQS.indexOf(p.freq) !== -1 ? p.freq : SUB_DEFAULT_PREFS.freq,
    sections: Array.isArray(p.sections) ? p.sections.filter(function (x) { return SECTIONS.indexOf(x) !== -1; }) : [],
    issues: p.issues === undefined ? true : !!p.issues,
    news: p.news === undefined ? true : !!p.news
  };
}

function subByToken_(token) {
  token = String(token || '');
  if (!token) return null;
  return readRows_('Subscribers', SUB_COLS).filter(function (s) { return s.token && s.token === token; })[0] || null;
}

function maskEmail_(e) {
  var m = /^(.)(.*)(@.*)$/.exec(e || '');
  return m ? m[1] + m[2].replace(/./g, '•').slice(0, 6) + m[3] : '';
}

function publicSubPrefsGet_(p) {
  var sub = subByToken_(p.token);
  if (!sub) return null;
  return { email: maskEmail_(sub.email), name: sub.name, status: sub.status, prefs: subPrefs_(sub), sections: SECTIONS };
}

function publicSubPrefsSave_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sub = subByToken_(p.token);
    if (!sub) throw new Error('This link is not valid. Use the link in your latest ABR email.');
    if (SUB_FREQS.indexOf(p.freq) === -1) throw new Error('Choose how often you want to hear from us.');
    var prefs = {
      freq: p.freq,
      sections: (Array.isArray(p.sections) ? p.sections : []).filter(function (x) { return SECTIONS.indexOf(x) !== -1; }),
      issues: !!p.issues, news: !!p.news
    };
    if (prefs.sections.length === SECTIONS.length) prefs.sections = [];       // all sections = no filter
    sub.prefs = JSON.stringify(prefs);
    sub.prefsUpdatedAt = now_();
    if (p.name !== undefined) sub.name = String(p.name).trim().slice(0, 100);
    if (sub.status === 'unsubscribed' && (prefs.freq !== 'off' || prefs.issues || prefs.news)) { sub.status = 'active'; sub.unsubscribedAt = ''; }
    if (sub.status === 'pending') { sub.status = 'active'; sub.confirmedAt = now_(); }   // opening the link from the email confirms the address
    writeRow_('Subscribers', SUB_COLS, sub);
  } finally { lock.releaseLock(); }
  return publicSubPrefsGet_(p);
}

function wantsSection_(prefs, section) {
  return !prefs.sections.length || prefs.sections.indexOf(section) !== -1;
}

function queueSubscriberMail_(sub, subject, emailObj) {
  var html = personalise_(renderEmail_(emailObj), { name: sub.name, token: sub.token });
  writeRow_('MailQueue', QUEUE_COLS, {
    id: Utilities.getUuid(), campaignId: '', kind: 'digest', to: sub.email, name: sub.name || '', token: sub.token,
    subject: subject, html: html.length > 45000 ? html.slice(0, 45000) : html, priority: 3,
    status: 'queued', attempts: 0, createdAt: now_()
  });
}

function emailArticle_(a, users) {
  var v = publicView_(a, users || usersByEmail_(), false);
  return { slug: v.slug, title: v.title, standfirst: v.standfirst, section: v.section, type: v.type, coverUrl: v.coverUrl,
           authors: v.curated ? [{ name: 'Curated by Ahmedabad Business Review' }] : v.authors };
}

// Every new article, for subscribers who chose "instant". Promoted articles are not sent automatically.
function subscriberArticleAlert_(a) {
  if (a.partnerType === 'promoted') return 0;
  var subs = readRows_('Subscribers', SUB_COLS).filter(function (s) {
    if (s.status !== 'active') return false;
    var pr = subPrefs_(s);
    return pr.freq === 'instant' && wantsSection_(pr, a.section);
  });
  if (!subs.length) return 0;
  var art = emailArticle_(a);
  var site = prop_('SITE_URL') || 'https://theabr.in';
  subs.forEach(function (sub) {
    queueSubscriberMail_(sub, 'New on ABR: ' + a.title, {
      preheader: a.standfirst || 'A new article from Ahmedabad Business Review', heading: 'New on ABR',
      bodyHtml: '<p>Hello {{first_name}}, a new article has just been published' + (a.section ? ' in <b>' + esc_(a.section) + '</b>' : '') + '.</p>',
      articles: [art], button: { label: 'Read the article', url: site + '/articles/' + a.slug }, footer: 'subscriber'
    });
  });
  logRaw_('system', 'subs.alert', a.id, subs.length + ' queued');
  return subs.length;
}

// New issue, for subscribers who want issues.
function subscriberIssueAlert_(i) {
  var subs = readRows_('Subscribers', SUB_COLS).filter(function (s) { return s.status === 'active' && subPrefs_(s).issues; });
  if (!subs.length) return 0;
  var site = prop_('SITE_URL') || 'https://theabr.in';
  var v = issueView_(i, usersByEmail_(), readMeta_(), false);
  var arts = v.articles.slice(0, 6).map(function (x) {
    return { slug: x.slug, title: x.title, standfirst: x.standfirst, section: x.section, type: x.type, coverUrl: '',
             authors: x.curated ? [{ name: 'Curated by Ahmedabad Business Review' }] : x.authors };
  });
  subs.forEach(function (sub) {
    queueSubscriberMail_(sub, 'Out now: ' + v.label + (v.title ? ', ' + v.title : ''), {
      preheader: v.theme || 'The new issue of Ahmedabad Business Review', heading: v.title || ('The ' + v.months + ' issue'),
      bodyHtml: '<p>Hello {{first_name}},</p><p>The new issue of Ahmedabad Business Review, <b>' + esc_(v.label) + '</b>, is out' +
        (v.theme ? ': ' + esc_(v.theme) : '') + '. It brings together ' + v.articles.length + ' article' + (v.articles.length === 1 ? '' : 's') +
        ' with a foreword from the Chair, and you can read it online or download the full PDF.</p>',
      articles: arts, button: { label: 'Read the issue', url: site + '/issues/' + i.key }, footer: 'subscriber'
    });
  });
  logRaw_('system', 'subs.issue', '', i.key + ': ' + subs.length + ' queued');
  return subs.length;
}

// Weekly (Monday) and monthly (1st) digests, run from the hourly housekeeping after 9 am IST.
function subscriberDigests_() {
  var now = new Date();
  var hour = Number(Utilities.formatDate(now, 'Asia/Kolkata', 'H'));
  if (hour < 9) return;
  var props = PropertiesService.getScriptProperties();
  var dow = Utilities.formatDate(now, 'Asia/Kolkata', 'u');            // 1 = Monday
  var dom = Utilities.formatDate(now, 'Asia/Kolkata', 'd');
  if (dow === '1') {
    var wk = 'DIGEST_W_' + Utilities.formatDate(now, 'Asia/Kolkata', 'yyyyMMdd');
    if (!props.getProperty(wk)) { props.setProperty(wk, now_()); sendDigest_('weekly', new Date(now.getTime() - 7 * 86400000), now); }
  }
  if (dom === '1') {
    var mk = 'DIGEST_M_' + Utilities.formatDate(now, 'Asia/Kolkata', 'yyyyMM');
    if (!props.getProperty(mk)) {
      props.setProperty(mk, now_());
      var y = Number(Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy')), m = Number(Utilities.formatDate(now, 'Asia/Kolkata', 'M'));
      var start = new Date(Date.UTC(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2, 1) - 5.5 * 3600000);
      var end = new Date(Date.UTC(y, m - 1, 1) - 5.5 * 3600000);
      sendDigest_('monthly', start, end);
    }
  }
}

function sendDigest_(freq, from, to) {
  var users = usersByEmail_();
  var arts = readMeta_().filter(function (a) {
    if (a.status !== 'published' || a.partnerType === 'promoted' || !a.publishedAt) return false;
    var t = new Date(a.publishedAt);
    return t >= from && t < to;
  }).sort(byDateDesc_('publishedAt'));
  if (!arts.length) return 0;
  var site = prop_('SITE_URL') || 'https://theabr.in';
  var label = freq === 'weekly' ? 'This week on ABR' : Utilities.formatDate(from.getTime ? new Date(from.getTime() + 6 * 3600000) : from, 'Asia/Kolkata', 'MMMM yyyy') + ' on ABR';
  var n = 0;
  readRows_('Subscribers', SUB_COLS).forEach(function (sub) {
    if (sub.status !== 'active') return;
    var pr = subPrefs_(sub);
    if (pr.freq !== freq) return;
    var mine = arts.filter(function (a) { return wantsSection_(pr, a.section); });
    if (!mine.length) return;
    queueSubscriberMail_(sub, label + ': ' + mine[0].title + (mine.length > 1 ? ' and ' + (mine.length - 1) + ' more' : ''), {
      preheader: mine.length + ' new article' + (mine.length === 1 ? '' : 's') + ' from Ahmedabad Business Review', heading: label,
      bodyHtml: '<p>Hello {{first_name}}, here ' + (mine.length === 1 ? 'is the article' : 'are the ' + mine.length + ' articles') + ' published ' +
        (freq === 'weekly' ? 'this past week' : 'last month') + (pr.sections.length ? ' in your sections (' + esc_(pr.sections.join(', ')) + ')' : '') + '.</p>',
      articles: mine.slice(0, 12).map(function (a) { return emailArticle_(a, users); }),
      button: { label: 'See everything on ABR', url: site + '/archive' }, footer: 'subscriber'
    });
    n++;
  });
  logRaw_('system', 'subs.digest', '', freq + ': ' + n + ' queued');
  return n;
}
/**
 * Team agreement (confidentiality + ownership of work) and onboarding emails.
 *
 * Every team member, including the Chair, must sign the current agreement version in the portal
 * before they can use it. Signing records a typed electronic signature, time, IP address and a
 * hash of the exact text signed, saves a PDF copy to a private Drive folder, and emails a copy.
 *
 * The default text below is a starting template, not legal advice. Have it reviewed.
 */

var AGREEMENT_EXEMPT_ROLES = [];   // everyone signs, including the Chair, EiC and COO
var AGREE_COLS = ['id', 'email', 'name', 'role', 'version', 'signature', 'signedAt', 'ip', 'userAgent', 'textHash', 'fileId'];

var AGREEMENT_ROUTES = {
  'agreement.get':           agreementGet_,
  'agreement.sign':          agreementSign_,
  'agreement.settings.get':  agreementSettingsGet_,
  'agreement.settings.save': agreementSettingsSave_,
  'agreement.list':          agreementList_
};

// Actions a member can use before signing.
var AGREEMENT_OPEN_ACTIONS = ['auth.login', 'auth.logout', 'auth.me', 'auth.changePassword', 'agreement.get', 'agreement.sign', 'auth.2fa.verify', 'auth.2fa.setup', 'auth.2fa.backupCodes'];

var DEFAULT_AGREEMENT = [
  '# ABR Team Member Confidentiality and Ownership Agreement',
  'This Agreement is made between {{entity}} (“the Organisation”), which publishes Ahmedabad Business Review (“ABR”), and {{name}} ({{email}}), who joins ABR as {{role}} (“the Member”).',
  '## 1. Role',
  'The Member contributes to ABR in the role named above, under the direction of the Chair of ABR. This Agreement does not by itself create employment or any right to payment; any such terms must be agreed separately in writing.',
  '## 2. Confidential information',
  '“Confidential Information” means any non-public information the Member receives through ABR, including unpublished articles and drafts, editorial discussions and decisions, the identity of sources, subscriber and contact lists, login credentials, financial, sponsorship and partnership information, and internal documents and data.',
  'The Member will: (a) use Confidential Information only for ABR work; (b) not disclose it to anyone outside ABR without the Chair’s written permission; (c) protect the identity of confidential sources; and (d) keep passwords private and never share their account.',
  'These obligations continue after the Member leaves ABR. They do not apply to information that becomes public through no fault of the Member, or that the Member is required by law to disclose.',
  '## 3. Ownership of work',
  'All work the Member creates for ABR, including articles, edits, research, designs, graphics, photographs, video, social media content, code, data and documents (“Work”), belongs to the Organisation.',
  'To the extent the Member owns copyright or other rights in any Work, the Member assigns to the Organisation all such rights, worldwide and for the full term of those rights, including the rights to publish, reproduce, adapt, translate, license and distribute the Work in any medium.',
  '## 4. Credit',
  'The Organisation will credit the Member as the author or contributor of published Work in line with ABR’s editorial standards. The Member may list and link to their published ABR Work in a personal portfolio or CV.',
  '## 5. ABR assets',
  'Domains, websites, social media and email accounts, mailing lists, brand assets, files and data created or used for ABR belong to the Organisation. When the Member leaves ABR, or whenever asked, the Member will hand over all ABR materials and access and delete personal copies of Confidential Information.',
  '## 6. Name, brand and representation',
  'The Member will use the ABR name and logo only in line with ABR’s brand guidelines and will not speak or make commitments on behalf of ABR without the Chair’s permission.',
  '## 7. Standards',
  'The Member will follow ABR’s editorial standards, including disclosing any conflict of interest to the editor.',
  '## 8. Term and law',
  'This Agreement takes effect when signed. Sections 2, 3, 4 and 5 continue after the Member leaves ABR. This Agreement is governed by the laws of India, and the courts at Ahmedabad, Gujarat have jurisdiction.',
  '## 9. Electronic signature',
  'The Member agrees that typing their full name and selecting “Sign agreement” is their electronic signature, and that it has the same effect as a handwritten signature.'
].join('\n\n');

function agreementConfig_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  return {
    version: p.AGREEMENT_VERSION || '1.0',
    entity: p.AGREEMENT_ENTITY || 'Ahmedabad Centre for Research and Innovation (ACRI)',
    text: p.AGREEMENT_TEXT || DEFAULT_AGREEMENT
  };
}

function agreementExempt_(u) { return AGREEMENT_EXEMPT_ROLES.indexOf(u.role) !== -1; }

function agreementRecord_(email, version) {
  return readRows_('Agreements', AGREE_COLS).filter(function (r) { return r.email === email && r.version === version; })[0] || null;
}

function needsAgreement_(u) {
  if (agreementExempt_(u)) return false;
  return !agreementRecord_(u.email, agreementConfig_().version);
}

// Called from doPost for every logged-in action.
function agreementGate_(req) {
  if (!req.token || AGREEMENT_OPEN_ACTIONS.indexOf(req.action) !== -1 || /^public\./.test(req.action)) return;
  var u = requireUser_(req);
  if (needsAgreement_(u)) throw new Error('Please sign the ABR team agreement to continue.');
}

function renderAgreementText_(text, vars) {
  var fill = function (s) {
    return esc_(s).replace(/\{\{(\w+)\}\}/g, function (m, k) { return vars[k] !== undefined ? '<b>' + esc_(vars[k]) + '</b>' : m; });
  };
  return String(text).split(/\n\s*\n/).map(function (block) {
    block = block.trim();
    if (!block) return '';
    if (/^# /.test(block)) return '<h1>' + fill(block.slice(2)) + '</h1>';
    if (/^## /.test(block)) return '<h2>' + fill(block.slice(3)) + '</h2>';
    return '<p>' + fill(block).replace(/\n/g, '<br>') + '</p>';
  }).join('\n');
}

function agreementVars_(u, cfg, date) {
  return { entity: cfg.entity, name: u.name, email: u.email, role: u.title || ROLES[u.role] || u.role,
           date: Utilities.formatDate(date || new Date(), 'Asia/Kolkata', 'd MMMM yyyy') };
}

function agreementGet_(p, req) {
  var u = requireUser_(req);
  var cfg = agreementConfig_();
  var rec = agreementRecord_(u.email, cfg.version);
  return {
    version: cfg.version, entity: cfg.entity, exempt: agreementExempt_(u),
    html: renderAgreementText_(cfg.text, agreementVars_(u, cfg)),
    signed: !!rec, signedAt: rec ? rec.signedAt : '', signature: rec ? rec.signature : ''
  };
}

function normName_(s) { return String(s || '').toLowerCase().replace(/[^a-zऀ-ॿ઀-૿]+/g, ' ').trim(); }

function agreementSign_(p, req) {
  var u = requireUser_(req);
  var cfg = agreementConfig_();
  if (agreementRecord_(u.email, cfg.version)) return agreementGet_(p, req);
  if (!p.agree) throw new Error('Tick the box to confirm you have read and agree to the agreement.');
  var signature = String(p.signature || '').trim();
  if (!signature || normName_(signature) !== normName_(u.name)) {
    throw new Error('Type your full name exactly as it appears on your profile: ' + u.name);
  }

  var signedAt = new Date();
  var vars = agreementVars_(u, cfg, signedAt);
  var bodyHtml = renderAgreementText_(cfg.text, vars);
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bodyHtml, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  var meta = req.meta || {};
  var rec = {
    id: 'AGR-' + Utilities.formatDate(signedAt, 'Asia/Kolkata', 'yyyyMMddHHmmss') + '-' + u.slug.slice(0, 12),
    email: u.email, name: u.name, role: vars.role, version: cfg.version, signature: signature,
    signedAt: signedAt.toISOString(), ip: String(meta.ip || '').slice(0, 64), userAgent: String(meta.ua || '').slice(0, 300), textHash: hash
  };

  var signedDoc = agreementDocument_(bodyHtml, rec, cfg);
  var pdf = null;
  try {
    pdf = HtmlService.createHtmlOutput(signedDoc).getBlob().getAs(MimeType.PDF)
      .setName('ABR Agreement - ' + u.name + ' - v' + cfg.version + '.pdf');
    var folderId = prop_('AGREEMENT_FOLDER_ID');
    if (!folderId) {
      folderId = DriveApp.createFolder('ABR — Signed Agreements').getId();
      PropertiesService.getScriptProperties().setProperty('AGREEMENT_FOLDER_ID', folderId);
    }
    rec.fileId = DriveApp.getFolderById(folderId).createFile(pdf).getId();  // private to the script owner
  } catch (e) {
    log_(u.email, 'agreement.pdfFailed', rec.id, e.message);
  }
  writeRow_('Agreements', AGREE_COLS, rec);
  log_(u.email, 'agreement.sign', rec.id, 'v' + cfg.version);

  var emailBody = '<p>Hello ' + esc_(u.name.split(' ')[0]) + ',</p>' +
    '<p>Thank you for signing the ABR Team Member Confidentiality and Ownership Agreement (version ' + esc_(cfg.version) + ') on ' +
    esc_(Utilities.formatDate(signedAt, 'Asia/Kolkata', 'd MMMM yyyy, h:mm a')) + ' IST. Your copy is attached' +
    ' and reproduced below. Keep it for your records.</p>' +
    '<p style="color:#777">Reference: ' + esc_(rec.id) + '</p><hr>' + bodyHtml + signatureBlock_(rec);
  try {
    sendSystemEmail_(u.email, 'Your signed ABR agreement', renderEmail_({
      preheader: 'Your copy of the ABR team agreement', heading: 'Agreement signed', bodyHtml: emailBody, footer: 'system'
    }), u.name, { attachments: pdf ? [pdf] : null });
  } catch (e) {}
  readUsers_().filter(function (x) { return x.role === 'chair' && x.email !== u.email && truthy_(x.active); }).forEach(function (chair) {
    try {
      sendSystemEmail_(chair.email, u.name + ' signed the ABR agreement', renderEmail_({
        heading: 'Agreement signed', footer: 'system',
        bodyHtml: '<p><b>' + esc_(u.name) + '</b> (' + esc_(vars.role) + ') signed version ' + esc_(cfg.version) + ' of the team agreement.</p>' +
          '<p>Reference ' + esc_(rec.id) + '. The PDF is in the “ABR — Signed Agreements” Drive folder, and the record is in the Agreements sheet.</p>'
      }), chair.name);
    } catch (e) {}
  });
  return agreementGet_(p, req);
}

function signatureBlock_(rec) {
  return '<div style="margin-top:28px;padding:16px;border:1px solid #000">' +
    '<p style="margin:0 0 4px"><b>Signed electronically by the Member</b></p>' +
    '<p style="margin:0;font-size:22px;font-style:italic">' + esc_(rec.signature) + '</p>' +
    '<p style="margin:8px 0 0;font-size:12px;color:#555">' + esc_(rec.name) + ' · ' + esc_(rec.email) + ' · ' + esc_(rec.role) + '<br>' +
    'Signed ' + esc_(Utilities.formatDate(new Date(rec.signedAt), 'Asia/Kolkata', 'd MMMM yyyy, h:mm:ss a')) + ' IST' +
    (rec.ip ? ' · IP ' + esc_(rec.ip) : '') + '<br>Agreement version ' + esc_(rec.version) + ' · Reference ' + esc_(rec.id) +
    '<br>Document fingerprint (SHA-256): ' + esc_(rec.textHash) + '</p></div>';
}

function agreementDocument_(bodyHtml, rec, cfg) {
  var site = prop_('SITE_URL') || 'https://theabr.in';
  return '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#111;margin:36px}' +
    'h1{font-size:18pt;margin:18px 0 12px}h2{font-size:12pt;margin:18px 0 6px}p{margin:0 0 9px}' +
    '</style></head><body>' +
    '<img src="' + site + '/brand/logo/horizontal/ABR-Horizontal-Black.png" style="width:240px">' +
    bodyHtml + signatureBlock_(rec) +
    '<p style="margin-top:18px;font-size:9pt;color:#666">Issued by ' + esc_(cfg.entity) + ' for Ahmedabad Business Review.</p>' +
    '</body></html>';
}

function agreementSettingsGet_(p, req) {
  requireAdmin_(req);
  var cfg = agreementConfig_();
  cfg.isDefault = !prop_('AGREEMENT_TEXT');
  return cfg;
}

function agreementSettingsSave_(p, req) {
  var u = requireAdmin_(req);
  var props = PropertiesService.getScriptProperties();
  if (p.entity !== undefined) props.setProperty('AGREEMENT_ENTITY', String(p.entity).trim().slice(0, 200));
  if (p.text !== undefined) {
    var t = String(p.text).trim();
    if (t.length < 200) throw new Error('The agreement text looks too short.');
    if (t.length > 8500) throw new Error('The agreement text is too long (max ~8,500 characters).');
    props.setProperty('AGREEMENT_TEXT', t);
  }
  if (p.resetText) props.deleteProperty('AGREEMENT_TEXT');
  if (p.version !== undefined) {
    var v = String(p.version).trim();
    if (!/^[\w.\-]{1,12}$/.test(v)) throw new Error('Version should look like 1.0 or 2.1.');
    props.setProperty('AGREEMENT_VERSION', v);
  }
  log_(u.email, 'agreement.settings', '', 'v' + agreementConfig_().version);
  return agreementSettingsGet_(p, req);
}

function agreementList_(p, req) {
  requireAdmin_(req);
  var cfg = agreementConfig_();
  var recs = readRows_('Agreements', AGREE_COLS);
  return readUsers_().map(function (u) {
    var r = recs.filter(function (x) { return x.email === u.email && x.version === cfg.version; })[0];
    return { email: u.email, exempt: agreementExempt_(u), signed: !!r, signedAt: r ? r.signedAt : '',
             fileUrl: r && r.fileId ? 'https://drive.google.com/file/d/' + r.fileId + '/view' : '' };
  });
}

/* ------------------------------------------------------------------ */
/* Onboarding emails                                                   */
/* ------------------------------------------------------------------ */

var ROLE_WELCOME = {
  eic: 'As Editor-in-Chief you lead ABR’s editorial desk: commissioning, editing and preparing articles for the Chair’s approval.',
  coo: 'As Chief Operating Officer you keep ABR running: operations, the team, partnerships, subscribers and the email programme.',
  editor: 'As an editor you will write, edit and fact-check articles, and submit them for the Chair’s approval.',
  chair: 'As Chair you approve what ABR publishes and manage the team.'
};

function sendWelcome_(u, tempPassword) {
  var site = prop_('SITE_URL') || 'https://theabr.in';
  var needs = AGREEMENT_EXEMPT_ROLES.indexOf(u.role) === -1;
  var html = renderEmail_({
    preheader: 'Your ABR editorial portal account is ready',
    heading: 'Welcome to ABR, ' + String(u.name || '').split(' ')[0],
    bodyHtml:
      '<p>You have joined <b>Ahmedabad Business Review</b> as <b>' + esc_(u.title || ROLES[u.role]) + '</b>.</p>' +
      '<p>' + esc_(ROLE_WELCOME[u.role] || '') + '</p>' +
      '<h3>Your login</h3>' +
      '<p>Email: <b>' + esc_(u.email) + '</b><br>Temporary password: <b style="font-family:monospace;font-size:17px;background:#f2f0eb;padding:2px 6px">' + esc_(tempPassword) + '</b></p>' +
      '<h3>Your first steps</h3><ol>' +
      '<li>Log in to the editorial portal and change your password.</li>' +
      (needs ? '<li>Read and sign the ABR team agreement (confidentiality and ownership of work). The portal opens once it is signed.</li>' : '') +
      '<li>Complete your author profile with a short bio and photo. It appears with every article you write.</li>' +
      '<li>Read our <a href="' + site + '/editorial-standards">editorial standards</a> and <a href="' + site + '/brand">brand guidelines</a>.</li></ol>',
    button: { label: 'Open the editorial portal', url: site + '/portal/' },
    footer: 'team'
  });
  return sendSystemEmail_(u.email, 'Welcome to Ahmedabad Business Review', html, u.name);
}

function sendPasswordReset_(u, tempPassword) {
  var site = prop_('SITE_URL') || 'https://theabr.in';
  return sendSystemEmail_(u.email, 'Your ABR portal password was reset', renderEmail_({
    preheader: 'A new temporary password for the ABR editorial portal',
    heading: 'Password reset',
    bodyHtml: '<p>The Chair has reset your password for the ABR editorial portal.</p>' +
      '<p>Temporary password: <b style="font-family:monospace;font-size:17px;background:#f2f0eb;padding:2px 6px">' + esc_(tempPassword) + '</b></p>' +
      '<p>Log in and change it straight away under <b>My profile</b>. If you didn’t expect this, tell the Chair.</p>',
    button: { label: 'Log in', url: site + '/portal/' },
    footer: 'team'
  }), u.name);
}
/**
 * ABR — starter articles (six researched pieces on Gujarat business).
 *
 * Add this as a new script file named "Seed" next to Code.gs, save, then run
 * importSeedArticles() once (or use ABR Admin → Import starter articles).
 *
 * Each article is created as "Awaiting approval", with the Chair as lead author, so it
 * appears in the portal's Approval queue. Read each one, check the figures against the
 * listed sources, edit, add co-authors, and only then click Approve & publish.
 * Running it again skips articles whose titles already exist.
 */

var SEED_DISCLOSURE = 'This article was researched and drafted with AI assistance and was fact-checked and edited by ABR’s editors before publication. All figures are taken from the sources listed below.';

function importSeedArticles() {
  var chair = readUsers_().filter(function (u) { return u.role === 'chair' && truthy_(u.active); })[0];
  if (!chair) throw new Error('Create the Chair account first (ABR Admin → Create Chair account).');
  var existing = {};
  readMeta_().forEach(function (a) { existing[String(a.title).trim().toLowerCase()] = true; });
  var created = 0, skipped = 0;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    SEED_ARTICLES.forEach(function (s) {
      if (existing[s.title.trim().toLowerCase()]) { skipped++; return; }
      var a = {
        id: nextId_(), status: 'submitted', authorEmail: chair.email, coAuthors: '',
        title: s.title, standfirst: s.standfirst, section: s.section, type: s.type, tags: s.tags,
        coverUrl: '', coverCaption: '', sources: s.sources, disclosure: SEED_DISCLOSURE, correction: '',
        body: s.body, wordCount: countWords_(s.body), byline: s.byline === 'abr' ? 'abr' : '',
        createdAt: now_(), updatedAt: now_(), submittedAt: now_()
      };
      writeArticle_(a);
      log_(chair.email, 'seed.import', a.id, s.title);
      created++;
    });
  } finally {
    lock.releaseLock();
  }
  var msg = created + ' starter article(s) added to the Approval queue' + (skipped ? ', ' + skipped + ' skipped (already exist)' : '') + '.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

var SEED_ARTICLES = [
 {
  "title": "GIFT City at Five: What India’s Offshore Financial Centre Has Built, and What It Still Has to Prove",
  "standfirst": "With more than 1,100 registrations, over USD 100 billion in banking assets and a newly doubled tax holiday, GIFT IFSC has moved past its start-up phase. Its next test is depth: real trading, real talent and business that would not exist without the tax break.",
  "section": "Policy & Economy",
  "type": "Analysis",
  "tags": "GIFT City, IFSC, IFSCA, financial services, Gujarat, tax policy",
  "body": "<p>For most of its first decade, Gujarat International Finance Tec-City (GIFT City) was easier to describe as an ambition than as a market. Its International Financial Services Centre (IFSC) was meant to let Indian and global firms do offshore financial business, the kind that had long gone to Singapore, Dubai and London, from Indian soil and in foreign currency. Five years after a single regulator took charge, the numbers suggest the ambition has become a functioning financial centre. Whether it becomes a <em>deep</em> one is a different question.</p>\n<h2>What changed in 2020</h2>\n<p>The turning point was institutional rather than physical. Before 2020, an entity in the IFSC could answer to several Indian regulators at once. The International Financial Services Centres Authority (IFSCA), created under the IFSCA Act of 2019, replaced that patchwork with a single, unified regulator for banking, capital markets, insurance and fund management inside the centre. Legally, the IFSC sits inside a Special Economic Zone and is treated for certain purposes as outside India’s customs territory, which is what allows business to be done in foreign currency.</p>\n<p>Over five years, IFSCA has issued more than 30 sets of regulations and 15-plus frameworks, from aircraft and ship leasing to fund management and fintech. For a young jurisdiction, regulatory output is a meaningful signal: global firms decide where to locate partly on whether the rules for their business exist at all.</p>\n<h2>The numbers, as of 2026</h2>\n<p>The government reported in November 2025 that GIFT IFSC had more than 1,034 registered entities, including 38 banks with assets of about USD 100.14 billion. By March 2026, IFSCA’s own dashboard showed:</p>\n<ul>\n<li><strong>1,147</strong> final registrations and authorisations;</li>\n<li>a total banking asset base of more than <strong>USD 111 billion</strong>;</li>\n<li>average monthly turnover on IFSC exchanges of more than <strong>USD 112 billion</strong> in the January–March 2026 quarter;</li>\n<li>cumulative commitments raised by funds of over <strong>USD 39 billion</strong>; and</li>\n<li><strong>410</strong> aircraft and ship assets leased.</li>\n</ul>\n<p>Banking is the anchor. International banking units in GIFT City are largely used for foreign-currency lending, trade finance and treasury work that Indian banks and corporates would otherwise book abroad. Fund management is the fastest-growing layer: IFSCA’s bulletin for the second quarter of 2025–26 counted 194 fund management entities running 310 funds.</p>\n<h2>The tax holiday just doubled</h2>\n<p>Tax has always been central to the pitch. Until this year, IFSC units could claim a 100% deduction on eligible income for any 10 consecutive years within their first 15. The Union Budget for 2026–27 proposed doubling that to 20 consecutive years within 25, with business income taxed at a concessional 15% once the holiday ends. The Finance Act, 2026 brought the change into law.</p>\n<p>The timing matters. The first wave of large institutions that moved to GIFT City was approaching the end of its 10-year window. The extension removes a looming cliff, and the defined 15% rate afterwards gives long-horizon businesses such as banks, insurers and treasury centres a predictable tax lifecycle.</p>\n<h2>Three things GIFT City still has to prove</h2>\n<h3>1. That activity is more than tax-driven booking</h3>\n<p>A generous tax holiday attracts entities. It does not by itself create a financial centre. The strongest hubs are defined by what happens there: price discovery, risk-taking and specialised services that clients cannot easily replicate elsewhere. A useful test for GIFT City over the next five years is whether turnover, fund assets and headcount keep growing as tax advantages become standard rather than exceptional.</p>\n<h3>2. That the talent will come and stay</h3>\n<p>Global in-house centres run by technology firms such as Wipro, Infosys, Cognizant and Hexaware employed about 2,500 professionals in GIFT IFSC by late 2025, according to the government. That is a start. Singapore and Dubai, however, compete on schools, housing, connectivity and the ease of relocating families, not only on tax. GIFT City’s urban life is still being built out.</p>\n<h3>3. That it can be an international centre, not just an Indian one</h3>\n<p>Much of today’s business is India-linked: Indian banks’ overseas lending, Indian corporates’ foreign-currency borrowing and India-focused funds. That is a natural and valuable base. A genuinely international centre would also host business with no Indian counterparty at all. Recent moves, including efforts to build commodity trading, intellectual-property ownership and insurance-linked securities, point in that direction. They are early.</p>\n<h2>What it means for Gujarat’s businesses</h2>\n<p>For companies in Ahmedabad and across Gujarat, GIFT City is no longer a distant policy project. It offers a nearby route to foreign-currency borrowing, aircraft and equipment leasing, and listing debt on international exchanges without leaving the country. Professional-services firms, including lawyers, accountants, compliance specialists and fund administrators, are already following the institutions. The HSBC and EY India compendium released in December 2025 described the ecosystem as moving from core banking into advisory, compliance, asset servicing and legal services.</p>\n<p>The verdict at five is cautiously positive. GIFT City has the regulator, the rules, the incentives and a growing base of institutions. Its next five years will show whether it also has the gravity of a real financial centre: business that comes because the market is there, not only because the tax is low.</p>",
  "sources": "Press Information Bureau (2025, 28 November). Smart Finance, Smart Future: GIFT City. https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251128709401.pdf\nInternational Financial Services Centres Authority. GIFT IFSC – Key highlights (as on March 2026). https://ifsca.gov.in/Home\nThe Policy Edge. GIFT IFSC turns five: banking assets cross USD 100 billion (summary of IFSCA Bulletin Q2 2025-26). https://www.policyedge.in/p/gift-ifsc-turns-five-banking-assets\nConfederation of Indian Industry blog. GIFT IFSC: regulatory framework and five-year growth. https://ciiblog.in/?p=18784\nBusiness Standard (2026, 1 February). Union Budget 2026-27: Centre doubles GIFT City tax holiday to 20 years. https://www.business-standard.com/budget/news/centre-doubles-gift-city-tax-holiday-20-years-126020100926_1.html\nKPMG India (2026). Financial services point of view: Union Budget 2026-27. https://assets.kpmg.com/content/dam/kpmgsites/in/pdf/2026/02/financial-services-pov-union-budget-2026-27.pdf\nBhatt & Joshi Associates. Twenty years, not ten: GIFT City tax holiday under section 147 after the Finance Act, 2026. https://bhattandjoshiassociates.com/twenty-years-not-ten-gift-city-tax-holiday-under-section-147-after-the-finance-act-2026/\nEY and IFSCA (2025). Tax benefits in GIFT IFSC. https://ifsca.gov.in/Document/10_EY-GIFT_tax_benefits_050225.pdf\nThe Week / PTI (2025, 5 December). GIFT City banking assets exceed USD 100 bn: HSBC-EY India compendium. https://www.theweek.in/wire-updates/business/2025/12/05/dcm74-biz-gift-city.html"
 },
 {
  "title": "From Packaging to Wafers: Gujarat’s Semiconductor Bet, Explained",
  "standfirst": "Sanand now packages and tests memory chips for global customers, and Dholera is building India’s first commercial wafer fab. Here is what each plant actually does, what the public money is buying, and why the hardest part of the journey is still ahead.",
  "section": "Innovation",
  "type": "Explainer",
  "tags": "semiconductors, India Semiconductor Mission, Micron, Tata Electronics, Sanand, Dholera, Gujarat",
  "body": "<p>In February 2026, Micron Technology’s assembly and test plant at Sanand, outside Ahmedabad, was formally inaugurated. Headlines called it the start of India’s chip industry. That is half right. It is the start of one important stage of it. Understanding which stage, and how it differs from the far larger project rising at Dholera, is the key to judging what Gujarat has actually won.</p>\n<h2>A chip is made in two very different places</h2>\n<p>Semiconductor manufacturing splits into two broad stages.</p>\n<ul>\n<li><strong>Front end (the “fab”).</strong> Circuits are built layer by layer on silicon wafers in ultra-clean rooms, using lithography, deposition and etching tools that are among the most complex machines ever made. This is the capital-intensive, technology-intensive core of the industry.</li>\n<li><strong>Back end (ATMP or OSAT).</strong> Finished wafers are cut into individual dies, which are then assembled into packages, tested, marked and shipped. These are assembly, test, marking and packaging (ATMP) units, also called outsourced semiconductor assembly and test (OSAT) units.</li>\n</ul>\n<p>Both matter, and advanced packaging is increasingly where performance gains come from. But they are not equally hard. One industry estimate cited by <em>Business Today</em> puts the infrastructure and equipment complexity of an ATMP or OSAT facility at roughly 20–30% of a fab of similar scale.</p>\n<h2>Sanand: the back end, now running</h2>\n<p>Micron’s Sanand facility was the first project approved under the India Semiconductor Mission. Construction began in 2023, and the plant was inaugurated on 28 February 2026. The total project is valued at about USD 2.75 billion (approved at ₹22,516 crore). Micron’s own share was reported at about USD 825 million, with the rest coming from central and state government support.</p>\n<p>Sanand is becoming a cluster rather than a single plant. Kaynes Semicon’s OSAT unit was inaugurated there in March 2026, and CG Semi, a joint venture involving CG Power and Japan’s Renesas, has said its Sanand OSAT will begin commercial operations in 2026.</p>\n<p>The early human-capital signal is encouraging. Of the nearly 1,300 people employed at Micron’s Sanand plant, about 700 were new graduates from Gujarat and neighbouring states, according to <em>Business Today</em>. Packaging and test plants train engineers, technicians and quality specialists who will be needed in larger numbers if Dholera succeeds.</p>\n<h2>Dholera: the front end, still being built</h2>\n<p>The more ambitious project is Tata Electronics’ fab at Dholera, built with Taiwan’s Powerchip Semiconductor Manufacturing Corporation (PSMC) as technology partner. The Union Cabinet approved it in February 2024 with an investment of ₹91,000 crore and a planned capacity of 50,000 wafer starts per month. The chips it makes are meant for computing, electric vehicles, telecom, defence, consumer electronics, automobiles and power electronics, and its initial technology nodes include 28 nm.</p>\n<p>This is the project to watch, and the one to describe carefully. Reports in 2026 put civil infrastructure at about half complete by March, with completion targeted for around 2028. Until commercial wafer output is confirmed, Dholera should be called what it is: India’s first commercial fab under construction.</p>\n<h2>What the public money is buying</h2>\n<p>The India Semiconductor Mission was notified in December 2021 with an outlay of ₹76,000 crore. Under the scheme, the Centre covers up to half of an eligible project’s capital cost, and states such as Gujarat add their own incentives. Supporters argue the subsidy is the price of entry into an industry where every major producer, from the United States to Taiwan, offers similar support. Sceptics ask whether India can sustain the follow-on investment that fabs need every few years to stay current.</p>\n<p>Both points can be true. The fairer test is not whether the first plants open, since they are opening, but whether they reach high utilisation, keep customers, and pull suppliers of gases, chemicals, equipment servicing and design talent into the region.</p>\n<h2>Why the hard part is still ahead</h2>\n<ol>\n<li><strong>Yield, not ribbon-cutting.</strong> A fab makes money only when a high share of each wafer’s chips work. Reaching competitive yields usually takes a long ramp-up.</li>\n<li><strong>Ecosystem depth.</strong> Fabs depend on reliable power and ultra-pure water, specialised chemicals and an army of equipment engineers. Clusters such as Sanand–Dholera succeed when that supply base settles nearby.</li>\n<li><strong>Talent at scale.</strong> Process engineers with fab experience are scarce worldwide. Training pipelines through universities and industry will decide how fast Indian plants can staff up.</li>\n<li><strong>Customers.</strong> Capacity only pays off if global and Indian buyers sign long-term volumes. Mature-node chips for autos and power electronics are a sensible first market, but pricing in mature nodes is competitive.</li>\n</ol>\n<h2>The bottom line</h2>\n<p>Gujarat has done the difficult first thing: it has turned announcements into operating plants. Sanand shows India can run world-class back-end manufacturing. Dholera will show whether it can do the front end. For students, suppliers and investors in the state, the opportunity lies in the ecosystem between the two: testing services, materials, maintenance, design and training. That ecosystem, more than any single factory, will decide whether this is a bet that pays.</p>",
  "sources": "Press Information Bureau (2024, 29 February). Giant leap for India Semiconductor Mission: Cabinet approves three more semiconductor units. https://pib.gov.in/PressReleasePage.aspx?PRID=2010132\nPrime Minister’s Office (2026, 28 February). PM inaugurates Micron Technology’s semiconductor ATMP facility in Sanand, Gujarat. https://www.pmindia.gov.in/en/news_updates/pm-inaugurates-micron-technologys-semiconductor-assembly-test-and-packaging-atmp-facility-in-sanandgujarat/\nBusiness Today (2026, 5 March). Micron’s Sanand plant puts India on the chip map, but the hard part begins now. https://www.businesstoday.in/amp/technology/story/microns-sanand-plant-puts-india-on-the-chip-map-but-the-hard-part-begins-now-519149-2026-03-05\nOutlook Business. Micron’s Sanand plant Phase 1 nears validation for cleanroom production. https://www.outlookbusiness.com/news/microns-sanand-plant-phase-1-nears-validation-for-cleanroom-production\nInc42 (2024). Cabinet okays India’s first semiconductor fab by Tata Group, Taiwan’s PSMC. https://inc42.com/?p=445693\nTele.net (2026). Manufacturing momentum: India seeks to strengthen its semiconductor value chain with fresh investments. https://tele.net.in/manufacturing-momentum-india-seeks-to-strengthen-its-semiconductor-value-chain-with-fresh-investments/\nTele.net (2026). Micron’s USD 2.75 billion Sanand ATMP facility inaugurated. https://tele.net.in/?p=203943\nNarendramodi.in (2024). Programme for Development of Semiconductors and Display Manufacturing Ecosystem in India: ₹76,000 crore outlay. https://www.narendramodi.in/giant-leap-for-india-semiconductor-mission-cabinet-approves-three-more-semiconductor-units\nAnantam IAS (2026). India semiconductor plants: locations and companies in 2026 (status of Sanand and Dholera projects). https://anantamias.com/india-semiconductor-plants-locations/\nLet’s Data Science (2026, 1 March). India accelerates domestic semiconductor manufacturing expansion (CG Semi Sanand OSAT timeline). https://letsdatascience.com/news/india-accelerates-domestic-semiconductor-manufacturing-expan-cc6782d6"
 },
 {
  "title": "Amul at ₹1 Lakh Crore: How a Farmer-Owned Cooperative Keeps Outgrowing Its Rivals",
  "standfirst": "The Amul brand crossed ₹1 lakh crore in turnover in 2025–26, while its marketing federation grew 11.4%. The case shows how a structure that keeps very little profit can still out-execute India’s biggest consumer companies, and where that model is being tested.",
  "section": "Business",
  "type": "Case Study",
  "tags": "Amul, GCMMF, cooperatives, dairy, Anand Pattern, FMCG, Gujarat",
  "body": "<p>In April 2026, the Gujarat Cooperative Milk Marketing Federation (GCMMF), which markets dairy products under the Amul brand, reported that total brand turnover had crossed ₹1 lakh crore for 2025–26. GCMMF’s own sales rose 11.4% to ₹73,450 crore, from ₹65,911 crore a year earlier. Two years before that, the figure was about ₹59,545 crore.</p>\n<p>The numbers are striking for any consumer company. They are more striking for an organisation owned by about 36 lakh (3.6 million) dairy farmers, many with only a few animals each. This case examines how the structure works, why it scales, and the pressures it now faces.</p>\n<h2>Two turnover figures, one system</h2>\n<p>It helps to be precise about what is being counted. GCMMF is the apex marketing body. Its 18 member district milk unions also sell Amul products directly in their own districts. The ₹1 lakh crore figure is the <em>unduplicated</em> brand turnover of the whole system, federation and unions combined. The ₹73,450 crore figure is GCMMF’s own sales. Both are legitimate; they answer different questions.</p>\n<p>The system now collects about 31 million litres of milk a day and sells more than 24 billion packs of products a year, in over 50 countries.</p>\n<h2>The structure: the Anand Pattern</h2>\n<p>Amul’s origins go back to 1946, when the Kaira District Cooperative Milk Producers’ Union was set up in Anand so that farmers could supply milk to Bombay without depending on private middlemen. Under Dr Verghese Kurien, the union developed a model that became known as the Anand Pattern, later replicated across India by the National Dairy Development Board.</p>\n<p>It has three tiers, each owned and governed by the tier below:</p>\n<ol>\n<li><strong>Village dairy cooperative societies</strong> collect milk twice a day, test it for fat and solids, and pay farmers by quality.</li>\n<li><strong>District unions</strong>, owned by the village societies, process the milk in their own plants.</li>\n<li><strong>The state federation (GCMMF)</strong>, owned by the district unions, runs marketing, distribution and the Amul brand.</li>\n</ol>\n<p>Elected farmer representatives sit on the boards at every level, while professional managers run operations.</p>\n<h2>Why it scales: four mechanisms</h2>\n<h3>1. Profit is paid out as price</h3>\n<p>Amul states that about 80% of the consumer’s rupee flows back to farmers. That figure is self-reported and not independently audited, but it is consistent with the cooperative’s design. Surplus is returned to members through milk prices rather than retained as shareholder profit. This gives farmers a reason to stay loyal and to invest in better animals and feed, which in turn secures supply.</p>\n<h3>2. Assured procurement creates a supply moat</h3>\n<p>Private dairies must compete for milk every season. Amul’s village societies give members a guaranteed buyer every day, morning and evening. Over decades, that reliability has built a collection network that is very hard for a new entrant to reproduce.</p>\n<h3>3. One brand across a long product ladder</h3>\n<p>The federation markets a single master brand across liquid milk, butter, cheese, ghee, ice cream and newer protein-focused products. Every category reinforces the same name and the same distribution network, so marketing spend is shared rather than fragmented.</p>\n<h3>4. Pricing as a public good</h3>\n<p>Because the owners are suppliers rather than investors, Amul can choose volume and reach over margin. It positions itself as an affordable, trusted staple. That is a strategic choice that listed competitors, answerable to shareholders, find harder to match.</p>\n<h2>Where the model is being tested</h2>\n<p><strong>Going national and international.</strong> Amul is expanding fresh-milk operations beyond Gujarat and has launched fresh milk in the United States and Europe through partnerships with local producers. Exporting a brand is easier than exporting a cooperative structure. Abroad, Amul relies on partners rather than its own member base.</p>\n<p><strong>Scaling the cooperative idea itself.</strong> In July 2025, the Union government launched the Sardar Patel Cooperative Dairy Federation to extend the cooperative model further. Replicating Anand’s results elsewhere has historically depended on strong local unions and professional management, not on the template alone.</p>\n<p><strong>Governance at scale.</strong> Farmer-elected boards are the model’s strength and its risk. CARE Ratings, for example, lists adverse changes in the Anand Pattern among the factors that could trigger a downgrade, because the system’s credit quality depends on member loyalty and disciplined management staying intact.</p>\n<p><strong>Productivity and technology.</strong> Higher milk yields per animal are the most durable way to raise farmer incomes. Investments in animal genetics, including new sexed-semen laboratories, and in farmer-facing digital tools are aimed squarely at this.</p>\n<h2>Lessons for business leaders</h2>\n<ul>\n<li><strong>Ownership shapes strategy.</strong> Who owns the firm determines what it optimises. Amul optimises farmer income and volume, and that choice explains both its pricing and its reach.</li>\n<li><strong>Supply-side loyalty can be a moat.</strong> Most companies compete for customers. Amul has also spent eight decades earning the loyalty of its suppliers.</li>\n<li><strong>Federation plus professional management works.</strong> Local ownership with central branding and professional execution lets a very large system act coherently.</li>\n</ul>\n<p>Amul’s ₹1 lakh crore milestone is often told as a brand story. It is better understood as an organisational design story, one that Gujarat built first and that the rest of the world still studies.</p>",
  "sources": "The Week / PTI (2026, 5 April). Amul brand turnover rises 11 pc to over Rs 1 lakh cr in FY26 on better demand. https://www.theweek.in/wire-updates/business/2026/04/05/amul-brand-turnover-rises-11-pc-to-over-rs-1-lakh-cr-in-fy26-on-better-demand.html\nDairy Industries International (2026, 7 April). Amul brand turnover hits one trillion rupees and 11% growth. https://www.dairyindustries.com/news/50376/amul-brand-turnover-hits-one-trillion-rupees-and-11-growth/\nIndian Cooperative (2026). Amul’s un-duplicated brand turnover surpasses Rs 1 lakh crore. https://www.indiancooperative.com/?p=95635\nDairy News 7x7 (2025, 2 April). Amul turnover touches USD 11 billion in FY25. https://dairynews7x7.com/news/amul-turnover-touches-11-billion-in-fy-25\nAmul (2021, 20 July). 47th Annual General Body Meeting of GCMMF. https://amul.com/m/47th-annual-general-body-meeting-held-on-20-july-2021\neDairy News. Kaira District Co-operative Milk Producers’ Union and the origins of Gujarat’s milk cooperatives. https://in.edairynews.com/?p=111555\nYourStory (2026, July). Amul barely keeps any profit. That is why it keeps winning. https://yourstory.com/2026/07/amul-cooperative-business-model-farmer-owned-dairy\nDairy Business Middle East & Africa (2026). Amul reports turnover of USD 12 billion in FY 2025/2026. https://dairybusinessmea.com/?p=2124480"
 },
 {
  "title": "Surat’s Diamond Reset: Tariffs, Lab-Grown Stones and the Search for New Markets",
  "standfirst": "India’s cut and polished diamond exports have fallen for three straight years, the US has slipped from first to a distant destination, and lab-grown stones now outnumber natural ones by volume. The data point to a structural reset in Surat, not a passing slump.",
  "section": "Business",
  "type": "Analysis",
  "tags": "diamonds, Surat, GJEPC, exports, lab-grown diamonds, tariffs, Gujarat",
  "body": "<p>Surat is where most of the world’s diamonds are cut and polished. For decades that fact made the city one of Gujarat’s most reliable engines of employment and exports. The last three years have tested that reliability as severely as anything in recent memory. The question for the industry, and for the families that depend on it, is whether the downturn is a cycle that will turn or a reset that requires a different business.</p>\n<h2>Three years of decline in the core product</h2>\n<p>Cut and polished diamonds (CPD) are the largest single item in India’s gem and jewellery exports. According to the Gem &amp; Jewellery Export Promotion Council (GJEPC):</p>\n<ul>\n<li>In 2023–24, CPD exports fell to about <strong>USD 15.97 billion</strong>.</li>\n<li>In 2024–25, they fell a further 16.8% to <strong>USD 13.29 billion</strong>, the lowest level in nearly two decades.</li>\n<li>In 2025–26, they declined another 8.52% to <strong>USD 12.16 billion</strong>, still 43.9% of all gem and jewellery exports.</li>\n</ul>\n<p>The early months of 2026–27 show no clear turn. CPD exports in April–July 2026 were down 8% year on year, at USD 3.60 billion.</p>\n<h2>Three forces behind the slump</h2>\n<h3>1. Weak demand in the two biggest markets</h3>\n<p>The decline began before tariffs. Through 2023 and 2024, demand for natural diamonds softened in both the United States and China. Polished prices fell sharply in international markets, and miners cut output. A manufacturing hub that depends on two consumer markets feels their slowdowns immediately.</p>\n<h3>2. US tariffs redrew the export map</h3>\n<p>In 2025, the United States imposed tariffs on Indian goods, including diamonds, that at points reached 50%. The effect shows up clearly in destinations. According to an analysis by <em>Scroll</em>, the US took about 40% of India’s polished diamond exports in 2024–25 and only about 15% in 2025–26. Over the same year, the United Arab Emirates became India’s top gem and jewellery market, with exports of USD 8.70 billion, as traders rerouted through Dubai and diversified to the UK, Europe and Asia.</p>\n<h3>3. Lab-grown diamonds changed the product itself</h3>\n<p>The most structural force is technological. In 2025–26, India exported about 18.8 million carats of polished lab-grown diamonds (LGD), compared with about 16 million carats of natural cut and polished diamonds. That was the first year lab-grown stones overtook natural ones by volume. Ten years earlier, LGD exports were barely 100,000 carats.</p>\n<p>Value tells a different story. Polished LGD exports were worth only USD 1.13 billion in 2025–26, down 10.55% even though volumes rose, because lab-grown prices keep falling as production scales. Lab-grown stones are winning volume but not, so far, value.</p>\n<h2>Where value is moving: from stones to jewellery</h2>\n<p>The brightest line in the 2025–26 data is not loose stones at all. Gold jewellery studded with lab-grown diamonds grew 31.3% to USD 1.43 billion. In early 2026–27, studded gold jewellery exports grew again, by 21% to USD 2.24 billion in April–July. GJEPC has reported that around a tenth of Surat’s processing units have moved into jewellery manufacturing, especially studded jewellery.</p>\n<p>The logic is straightforward. When the value of a polished stone is falling, margin moves downstream to design, setting, branding and the finished piece. That is a different business. It needs designers, metal-working skills, hallmarking, and relationships with retailers rather than diamond dealers.</p>\n<h2>The human cost and the policy questions</h2>\n<p>Diamond polishing is labour-intensive, and Surat’s slowdown has meant pay cuts, shorter weeks and job losses for workers, with knock-on effects on the city’s real estate and retail. Three policy questions follow:</p>\n<ol>\n<li><strong>Market access.</strong> Trade agreements with the UK and EU could open alternatives to the US, as GJEPC has noted. Their benefits will be uneven across product lines.</li>\n<li><strong>Re-skilling.</strong> Moving workers from polishing to jewellery manufacturing, or into other manufacturing, needs structured training, not just market forces.</li>\n<li><strong>Trust and disclosure.</strong> As lab-grown and natural stones look identical to buyers, credible grading, labelling and traceability protect the value of both.</li>\n</ol>\n<h2>Cycle or reset?</h2>\n<p>Some of the pressure is cyclical: tariffs can change and consumer demand can recover. But the volume crossover to lab-grown diamonds and the shift of value into finished jewellery are structural. Surat built its advantage on skilled hands and scale in polishing. Its next advantage will have to come from design, brands, technology and market diversity. That is a harder transition, but it plays to a city that has reinvented its trade before.</p>",
  "sources": "Gem & Jewellery Export Promotion Council, Solitaire (2026). India’s gem and jewellery exports in FY 2025-26. https://gjepc.org/solitaire/?p=35913\nGem & Jewellery Export Promotion Council, Solitaire (2026). Exports rise 2.44% to USD 9.17 billion in April–July 2026. https://gjepc.org/solitaire/?p=37698\nMining.com / Reuters (2025). India’s polished diamond exports hit two-decade low, industry group says. https://www.mining.com/web/indias-polished-diamond-exports-hit-two-decade-low-industry-group-says\nIndia Sea Trade News (2024). Diamond companies in Surat pause operations amid industry slump (FY24 GJEPC data). https://indiaseatradenews.com/diamond-companies-in-surat-pause-operations-amid-industry-slump/\nOutlook Business (2026). India’s gem & jewellery exports slip 3.3% in FY26; UAE overtakes US as top market. https://www.outlookbusiness.com/economy-and-policy/indias-gem-jewellery-exports-slip-33-in-fy26-uae-overtakes-us-as-top-market\nScroll (2026). How the Iran war has plunged India’s diamond industry into a deeper crisis. https://scroll.in/article/1092358/how-the-iran-war-has-plunged-indias-diamond-industry-into-a-deeper-crisis\nArt of Jewellery (2026, 22 May). Lab-grown diamonds pass natural stones in carats exported. https://artofjewellery.com/NewsMore?id=1138\nModern Jeweler. Surat’s diamond industry diversifies amid changing global demand. https://modernjeweler.com/surats-diamond-industry-diversifies-amid-changing-global-demand\nThe Week (2025, 16 August). Why diamond craftsmen in Surat are losing their sparkle amid US tariff hike. https://www.theweek.in/theweek/business/2025/08/16/surat-diamond-industry-struggles-us-tariff-hike-impact-on-diamonds.html\nFree Press Journal. Surat diamond industry faces challenges amid US jewellery market contraction. https://www.freepressjournal.in/amp/india/surat-diamond-industry-faces-challenges-amid-us-jewellery-market-contraction"
 },
 {
  "title": "Khavda and the Grid: Gujarat’s Desert Power Plant Is Only as Big as Its Wires",
  "standfirst": "The 30 GW renewable energy project in Kutch is adding capacity faster than almost anywhere on earth. Its real constraint is no longer land or panels but transmission and storage, and that shift holds a lesson for India’s whole energy transition.",
  "section": "Innovation",
  "type": "Analysis",
  "tags": "renewable energy, Khavda, Kutch, solar, wind, transmission, battery storage, Gujarat",
  "body": "<p>On the salt-flat edge of Kutch, close to the border with Pakistan, a renewable energy park is being built on a scale that is hard to picture. Adani Green Energy Limited (AGEL) is developing a 30 GW solar and wind project across 538 square kilometres of barren land at Khavda, which the company describes as the world’s largest renewable energy plant. Other developers, including public-sector companies, are building their own capacity in the same zone.</p>\n<p>The headline story is speed. The more useful story for policymakers and businesses is what that speed has revealed: in a modern power system, generation is no longer the hardest thing to build.</p>\n<h2>How fast Khavda is growing</h2>\n<p>AGEL’s reported milestones trace an unusually steep curve:</p>\n<ul>\n<li>In 2025–26 the company added 5,051 MW of renewable capacity, most of it at Khavda.</li>\n<li>Operational capacity at the Khavda site stood at about 9.4 GW on 31 March 2026, which the company described as about 35% of the project complete within 36 months of groundbreaking.</li>\n<li>By May 2026, installed capacity at the site had reached about 9.7 GW, against a target of 30 GW by 2029.</li>\n<li>In July 2026, AGEL’s total operational portfolio across India passed 20 GW.</li>\n</ul>\n<p>Alongside AGEL, NTPC’s renewable arm is building a 4,750 MW park in Khavda, and Coal India has commissioned solar capacity there. Khavda has become a renewable-energy zone, not a single project.</p>\n<h2>The real constraint: getting power out</h2>\n<p>Khavda is remote by design. Its land is cheap and its sun and wind are strong because few people live there. That also means power has to travel hundreds of kilometres to demand centres. Every gigawatt built in the desert needs matching high-voltage transmission to be useful.</p>\n<p>India’s answer has been a series of inter-state transmission schemes, planned in phases and tied to Khavda’s growth:</p>\n<ul>\n<li><strong>Phase II (4.5 GW).</strong> The final part of the scheme to evacuate 4.5 GW from the Khavda pooling station was commissioned by POWERGRID in February 2026.</li>\n<li><strong>Phase III (7 GW).</strong> Two parts, one built by Adani and one by POWERGRID, carry new 765 kV lines through switching stations at Halvad and Vataman. Their scheduled completion dates slipped into late 2026, according to the Central Transmission Utility’s status reports.</li>\n<li><strong>Phase IV (7 GW).</strong> POWERGRID commissioned one part (E4) in July 2026. Other parts are scheduled through 2026 and 2027.</li>\n<li><strong>Phase V (8 GW).</strong> The electricity regulator approved transmission charges for part of this phase in May 2026.</li>\n</ul>\n<p>The pattern is clear. Generation can be commissioned in months. A 765 kV line needs land, forest and other clearances, towers across hundreds of kilometres, and new substations. That can take years. When the two fall out of step, completed solar farms wait for wires, or produce power that the grid cannot absorb.</p>\n<h2>Storage: making desert power dependable</h2>\n<p>The second constraint is time of day. Solar output peaks at noon; demand peaks in the evening. Battery storage shifts energy across those hours and also helps stabilise the grid. Here too Khavda is moving fast. AGEL brought its first 1,376 MWh of battery storage online within eight months of starting work at the site, expanded to 3.55 GWh by June 2026, and to 6.63 GWh by October 2026. The company says that is more than half of India’s operational battery capacity.</p>\n<p>Storage at this scale changes the economics of a remote park. Firmer, dispatchable output is worth more to utilities, and it reduces the strain on transmission because power can be released when lines have spare capacity.</p>\n<h2>Three lessons beyond Khavda</h2>\n<ol>\n<li><strong>Plan the wires first.</strong> Renewable-energy zones work best when transmission is planned and bid alongside generation, not after it. Khavda’s phased schemes are a model; their delays are a warning.</li>\n<li><strong>Treat storage as infrastructure.</strong> Batteries are becoming as essential to renewable parks as inverters. Policy that rewards firm, dispatchable power will pull in more of them.</li>\n<li><strong>Concentration brings scale and risk.</strong> Putting tens of gigawatts in one zone cuts costs per megawatt, but it also concentrates exposure to transmission outages, extreme weather and cross-border security considerations.</li>\n</ol>\n<h2>What it means for Gujarat</h2>\n<p>For the state, Khavda is industrial policy as much as energy policy. It anchors demand for local construction, operations and maintenance, and it positions Gujarat as a supplier of clean electricity to the rest of India. Gujarat-based manufacturers that sell to global buyers increasingly face questions about the carbon content of their products, and abundant renewable power nearby is a competitive asset.</p>\n<p>Khavda shows that India can now build clean generation at world-leading speed. The next phase of the energy transition will be won or lost in the less glamorous work of transmission lines, substations and storage, the wires that turn a desert power plant into power people can actually use.</p>",
  "sources": "Adani Green Energy (2026). Accelerating infrastructure: the 30 GW Khavda RE project (Integrated Annual Report 2025-26). https://www.adanigreenenergy.com/digital-reports/green-energy/2026/khavda-re-project.html\nAdani Group (2026, 1 April). Adani Green Energy delivers on 5 GW commitment in FY26. https://www.adani.com/newsroom/media-releases/adani-green-energy-delivers-on-5-gw-commitment-in-fy26\nAdani Group (2026, 1 July). Adani Green Energy surpasses 20 GW operational capacity. https://www.adani.com/newsroom/media-releases/adani-green-energy-surpasses-20-gw-operational-capacity\nEnergetica India (2026, 11 May). Adani Green Energy operationalises 150 MW solar power project at Khavda, Gujarat. https://www.energetica-india.net/news/adani-green-energy-operationalises-150-mw-solar-power-project-at-khavda-gujarat\nESS News (2026, 2 October). Adani Green Energy expands operational battery storage capacity to 6.63 GWh. https://www.ess-news.com/2026/10/02/adani-green-energy-expands-operational-battery-storage-capacity-to-6-63-gwh/\nPSU Connect (2026, 2 February). POWERGRID subsidiary commissions Khavda II-C transmission project. https://www.psuconnect.in/psu-news/powergrid-subsidiary-commissions-khavda-ii-c-transmission-project\nEnergetica India (2026, 16 July). POWERGRID commissions Khavda Phase IV transmission project for 7 GW RE evacuation. https://www.energetica-india.net/news/powergrid-commissions-khavda-phase-iv-transmission-project-for-7-gw-re-evacuation\nCentral Transmission Utility of India (2026, July). Status of ISTS TBCB projects, Western Region. https://www.ctuil.in/uploads/assets/178642514021Status-of%20ISTS-TBCB_WR_%20projects-Jul26.pdf\nConstruction World (2026). CERC approves transmission charges for Khavda evacuation project (Phase V). https://www.constructionworld.in/amp/energy-infrastructure/power-and-renewable-energy/cerc-approves-transmission-charges-for-khavda-evacuation-project/92013"
 },
 {
  "title": "First in Policy, Fifth in Numbers: Reading Gujarat’s Startup Rankings Carefully",
  "standfirst": "Gujarat has topped India’s state startup rankings five years running and now has more than 19,000 recognised startups. Official data show what that ranking measures, what it does not, and where the state’s ecosystem still trails its peers.",
  "section": "Entrepreneurship",
  "type": "Research Brief",
  "tags": "startups, Gujarat, DPIIT, Startup India, SSIP, i-Hub, entrepreneurship, women entrepreneurs",
  "body": "<p>Gujarat has been named a “Best Performer” in the Department for Promotion of Industry and Internal Trade’s (DPIIT) States’ Startup Ranking for a fifth consecutive edition. In June 2026, the state government reported more than 19,000 DPIIT-recognised startups in Gujarat. Both facts are true, and both are often read as saying more than they do. This brief sets out what the official numbers show.</p>\n<h2>Key findings</h2>\n<ul>\n<li>As of 31 December 2025, Gujarat had <strong>17,691</strong> DPIIT-recognised startups, the <strong>fifth-highest</strong> of any state or union territory and about <strong>8.5%</strong> of India’s 2,07,135.</li>\n<li>Maharashtra (35,992), Karnataka (21,163), Uttar Pradesh (20,163) and Delhi (19,913) were ahead. Gujarat’s count was about half of Maharashtra’s.</li>\n<li>About <strong>43%</strong> of Gujarat’s recognised startups had at least one woman director or partner, below the national share of about <strong>48%</strong>.</li>\n<li>The state ranking measures <strong>policy and implementation</strong>, not outcomes such as funding raised, revenue or survival.</li>\n</ul>\n<h2>1. The scale picture</h2>\n<p>India recognised a record of more than 55,200 startups in 2025–26, taking the national total past 2.23 lakh by 31 March 2026. Gujarat has grown with that wave, from 17,691 at the end of December 2025 to more than 19,000 by mid-2026, according to the state.</p>\n<p>In absolute numbers, though, Gujarat is fifth, not first. Roughly one in twelve recognised startups is in Gujarat. That is a strong position for a state of Gujarat’s size, but it is not a lead.</p>\n<h2>2. What the ranking measures</h2>\n<p>The States’ Startup Ranking Framework assesses states and union territories on their startup-friendly <em>policies and how well they implement them</em>: institutional support, incubation, access to markets, funding schemes, mentoring and awareness. The latest edition, the fifth, was released in January 2026.</p>\n<p>A “Best Performer” rating therefore says that Gujarat’s policy machinery is among the strongest in the country. It does not, by itself, say that Gujarat’s startups raise more money, grow faster or survive longer than those elsewhere. Those are outcome questions the ranking is not designed to answer.</p>\n<h2>3. Where Gujarat’s policy is genuinely distinctive</h2>\n<p>The state’s clearest differentiator is its focus on students. The Student Startup and Innovation Policy (SSIP) built an early pipeline through schools and universities, and the Gujarat Student Startup and Innovation Hub (i-Hub) sits at its centre. The state reports that i-Hub has supported more than 750 startups, which have created over 4,000 jobs. Under the Gujarat Industrial Policy, 471 startups have received seed support, and 269 women-led startups have been helped through the WEstart programme.</p>\n<p>These are meaningful early-stage interventions. Their test, over the next five years, will be how many of the supported firms reach sustainable revenue or raise follow-on capital.</p>\n<h2>4. The gaps the data reveal</h2>\n<h3>Women’s participation</h3>\n<p>Nationally, about 48% of recognised startups have at least one woman director or partner. In Gujarat the share is about 43%, the lowest among the seven states with the most recognised startups. Programmes such as WEstart target this gap directly. The data suggest they have room to grow.</p>\n<h3>Recognition is not the same as funding</h3>\n<p>DPIIT recognition is a registration that unlocks certain benefits. Many recognised entities are very small, and some close. Central schemes show how thin early-stage capital remains across India. Funds approved by incubators under the Startup India Seed Fund Scheme were ₹109.40 crore nationally in calendar 2025, down from ₹176.08 crore in 2023. Any state’s startup story is constrained by the depth of risk capital available to its founders.</p>\n<h2>5. What would make the picture clearer</h2>\n<p>Three kinds of data would let Gujarat, and every other state, judge its ecosystem on outcomes rather than inputs:</p>\n<ol>\n<li><strong>Survival rates</strong> of recognised startups after three and five years, by state.</li>\n<li><strong>Follow-on funding</strong> raised by startups that received state seed support.</li>\n<li><strong>Revenue and employment</strong> of state-supported startups, reported annually.</li>\n</ol>\n<h2>Conclusion</h2>\n<p>Gujarat’s ranking reflects a policy system that works hard and early, especially for students. The state is fifth by volume, below the national average on women’s participation, and, like the rest of India, short of early-stage capital. Reading the ranking for what it measures, a well-run policy framework, is more useful than reading it as a scoreboard. The next milestone worth celebrating will be one that measures what Gujarat’s startups go on to achieve.</p>",
  "sources": "Lok Sabha (2026, 3 February). Unstarred Question No. 588: DPIIT-recognised startups, State/UT-wise as on 31 December 2025 (Ministry of Commerce and Industry). https://eparlib.sansad.in/bitstream/123456789/3020061/1/AU588_lOfCvN.pdf\nPress Information Bureau (2026). Startups recognised by DPIIT as on 31 January 2026. https://pib.gov.in/PressReleasePage.aspx?PRID=2241313\nInc42 (2026). Centre recognises record 55,200 startups in FY26. https://inc42.com/?p=555314\nOnmanorama (2026, 18 April). Govt recognises over 55,200 entities as startups in 2025-26 (States’ Startup Ranking Framework). https://www.onmanorama.com/upsc/current-affairs/2026/04/18/govt-recognises-55200-entities-as-startups-in-2025-26.html\nKNN India (2026, 12 June). Gujarat emerges as leading startup hub with over 19,000 DPIIT-recognised startups. https://knnindia.co.in/news/newsdetails/state/gujarat/gujarat-emerges-as-leading-startup-hub-with-over-19000-dpiit-recognised-startups\nAscendants (2026, 12 June). Gujarat crosses 19,000 DPIIT-recognised startups (WEstart and seed support figures). https://ascendants.in/industry_events/gujarat-19000-dpiit-recognised-startups-startup-india-rankings/attachment/gujarat-startups/\nNew Kerala / ANI (2026, 12 June). Gujarat’s startup success: i-Hub has supported 750+ startups. https://www.newkerala.com/news/a/over-19000-dpiit-recognised-ventures-gujarat-powering-indias-start-up-472.htm\nStartup Feed (2026). Top 10 state startup policies in India, ranked for 2026 (SRF 5.0). https://startupfeed.in/?p=7254"
 }
];
/**
 * ABR features: partners (partner / promoted articles and the co-brand kit),
 * article import, and AI-assisted drafts (generated by the website with Groq).
 */

var PARTNER_COLS = ['slug', 'name', 'website', 'logoUrl', 'code', 'status', 'note', 'createdAt', 'updatedAt'];
var AI_ROLES = ['chair', 'eic', 'coo'];   // who can request AI drafts

var FEATURE_ROUTES = {
  // Partners
  'partners.list':           partnersList_,
  'partners.save':           partnersSave_,
  'partners.newCode':        partnersNewCode_,
  'partners.setLogo':        partnersSetLogo_,
  'partners.options':        function (p, req) { requireUser_(req); return activePartners_().map(partnerPublic_); },
  'public.partners':         function () { return activePartners_().map(partnerPublic_); },
  'public.partnerByCode':    publicPartnerByCode_,
  'public.partnerLogo':      publicPartnerLogo_,

  // Import
  'articles.import':         importArticles_,

  // AI drafts
  'ai.prepare':              aiPrepare_,
  'ai.save':                 aiSave_,
  'ai.settings.get':         aiSettingsGet_,
  'ai.settings.save':        aiSettingsSave_
};

/* ------------------------------------------------------------------ */
/* Partners                                                            */
/* ------------------------------------------------------------------ */

var _partnerMemo = null;
function readPartners_() {
  if (_partnerMemo) return _partnerMemo;
  var sh = sheet_('Partners');
  _partnerMemo = sh ? readRows_('Partners', PARTNER_COLS) : [];
  return _partnerMemo;
}
function findPartner_(slug) {
  return readPartners_().filter(function (x) { return x.slug === slug; })[0] || null;
}
function activePartners_() {
  return readPartners_().filter(function (x) { return x.status !== 'inactive'; });
}
function partnerPublic_(x) {
  return { slug: x.slug, name: x.name, website: x.website, logoUrl: x.logoUrl };
}
function partnerForArticle_(a) {
  if (!a.partnerType || !a.partnerSlug) return null;
  var x = findPartner_(a.partnerSlug);
  if (!x) return null;
  var v = partnerPublic_(x);
  v.type = a.partnerType;
  return v;
}

function partnerCode_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid());
  var out = '';
  for (var i = 0; i < 10; i++) out += chars.charAt((bytes[i] + 128) % chars.length);
  return out.slice(0, 5) + '-' + out.slice(5);
}

function partnersList_(p, req) {
  requireAdmin_(req);
  var site = prop_('SITE_URL') || 'https://theabr.in';
  return readPartners_().map(function (x) {
    var v = partnerPublic_(x);
    v.status = x.status || 'active';
    v.note = x.note;
    v.code = x.code;
    v.kitUrl = site + '/cobrand?code=' + encodeURIComponent(x.code);
    return v;
  });
}

function partnersSave_(p, req) {
  var u = requireAdmin_(req);
  var name = String(p.name || '').trim();
  if (!name) throw new Error('Enter the partner’s name.');
  var website = String(p.website || '').trim();
  if (website && !/^https?:\/\//i.test(website)) website = 'https://' + website;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _partnerMemo = null;
    var x = p.slug ? findPartner_(p.slug) : null;
    if (p.slug && !x) throw new Error('Partner not found.');
    if (!x) {
      var base = slugify_(name), slug = base, n = 2;
      while (findPartner_(slug)) slug = base + '-' + (n++);
      x = { slug: slug, code: partnerCode_(), status: 'active', createdAt: now_() };
    }
    x.name = name;
    x.website = website;
    if (p.status) x.status = p.status === 'inactive' ? 'inactive' : 'active';
    if (p.note !== undefined) x.note = String(p.note).slice(0, 300);
    var isNew = !x.updatedAt;
    x.updatedAt = now_();
    writeRow_('Partners', PARTNER_COLS, x);
    _partnerMemo = null;
    log_(u.email, isNew ? 'partners.add' : 'partners.save', '', x.slug);
  } finally { lock.releaseLock(); }
  return partnersList_(p, req);
}

function partnersNewCode_(p, req) {
  var u = requireAdmin_(req);
  var x = findPartner_(p.slug);
  if (!x) throw new Error('Partner not found.');
  x.code = partnerCode_();
  x.updatedAt = now_();
  writeRow_('Partners', PARTNER_COLS, x);
  _partnerMemo = null;
  log_(u.email, 'partners.newCode', '', x.slug);
  return partnersList_(p, req);
}

function storePartnerLogo_(x, dataUrl) {
  var m = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('The logo must be sent as a PNG.');
  var bytes = Utilities.base64Decode(m[1]);
  if (bytes.length > 3 * 1024 * 1024) throw new Error('Logo file is too large (max 3 MB).');
  var folder = DriveApp.getFolderById(prop_('IMAGE_FOLDER_ID'));
  var file = folder.createFile(Utilities.newBlob(bytes, 'image/png', 'partner-' + x.slug + '.png'));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  x.logoUrl = 'https://lh3.googleusercontent.com/d/' + file.getId();
  x.updatedAt = now_();
  writeRow_('Partners', PARTNER_COLS, x);
  _partnerMemo = null;
  return x.logoUrl;
}

function partnersSetLogo_(p, req) {
  var u = requireAdmin_(req);
  var x = findPartner_(p.slug);
  if (!x) throw new Error('Partner not found.');
  storePartnerLogo_(x, p.dataUrl);
  log_(u.email, 'partners.setLogo', '', x.slug);
  return partnersList_(p, req);
}

function partnerByCodeOrThrow_(code, req) {
  var ip = (req.meta && req.meta.ip) || 'unknown';
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get('pcode_' + ip) || 0);
  if (n >= 20) throw new Error('Too many attempts. Please try again in an hour.');
  cache.put('pcode_' + ip, String(n + 1), 3600);
  code = String(code || '').trim().toUpperCase();
  var x = readPartners_().filter(function (y) { return y.code && y.code === code && y.status !== 'inactive'; })[0];
  if (!x) throw new Error('That partner code is not valid. Ask ABR for your co-branding link.');
  return x;
}

function publicPartnerByCode_(p, req) {
  return partnerPublic_(partnerByCodeOrThrow_(p.code, req));
}

function publicPartnerLogo_(p, req) {
  var x = partnerByCodeOrThrow_(p.code, req);
  var url = storePartnerLogo_(x, p.dataUrl);
  log_('partner:' + x.slug, 'partner.logoUpload', '', '');
  return { logoUrl: url };
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

function importArticles_(p, req) {
  var u = requireApprover_(req);
  var list = p.articles;
  if (!Array.isArray(list) || !list.length) throw new Error('No articles found in the import file.');
  if (list.length > 25) throw new Error('Import at most 25 articles at a time.');
  var asDraft = p.status === 'draft';
  var existing = {};
  readMeta_().forEach(function (a) { existing[String(a.title).trim().toLowerCase()] = true; });
  var results = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    list.forEach(function (s, i) {
      var label = (s && s.title) ? String(s.title).slice(0, 80) : 'Item ' + (i + 1);
      try {
        if (!s || typeof s !== 'object') throw new Error('Not an article object.');
        var title = String(s.title || '').trim();
        if (!title) throw new Error('Missing title.');
        if (existing[title.toLowerCase()]) throw new Error('An article with this title already exists.');
        var section = String(s.section || '').trim();
        if (section && SECTIONS.indexOf(section) === -1) throw new Error('Unknown section “' + section + '”.');
        var type = String(s.type || '').trim();
        if (type && TYPES.indexOf(type) === -1) throw new Error('Unknown type “' + type + '”.');
        var body = String(s.body || s.body_html || '');
        if (!body) throw new Error('Missing body.');
        if (body.length > BODY_CHUNKS * CHUNK_SIZE) throw new Error('Body is too long.');
        var sources = Array.isArray(s.sources || s.references) ? (s.sources || s.references).join('\n') : String(s.sources || s.references || '');
        var a = {
          id: nextId_(), status: asDraft ? 'draft' : 'submitted', authorEmail: u.email, coAuthors: '',
          title: title, standfirst: String(s.standfirst || '').trim(), section: section, type: type,
          tags: splitList_(s.tags).join(', '), coverUrl: cleanUrl_(s.coverUrl), coverCaption: String(s.coverCaption || ''),
          sources: sources.trim(), disclosure: String(s.disclosure || '').trim(), correction: '',
          body: body, wordCount: countWords_(body), byline: s.byline === 'abr' ? 'abr' : '',
          createdAt: now_(), updatedAt: now_(), submittedAt: asDraft ? '' : now_()
        };
        if (s.publishedDate && /^\d{4}-\d{2}-\d{2}$/.test(String(s.publishedDate))) {
          a.publishedAt = new Date(s.publishedDate + 'T09:00:00+05:30').toISOString();
        }
        if (s.partnerSlug && ['partner', 'promoted'].indexOf(s.partnerType) !== -1 && findPartner_(s.partnerSlug)) {
          a.partnerSlug = s.partnerSlug; a.partnerType = s.partnerType;
        }
        writeArticle_(a);
        existing[title.toLowerCase()] = true;
        log_(u.email, 'import', a.id, title);
        results.push({ ok: true, id: a.id, title: title });
      } catch (e) {
        results.push({ ok: false, title: label, error: e.message });
      }
    });
  } finally { lock.releaseLock(); }
  return { results: results, imported: results.filter(function (r) { return r.ok; }).length };
}

/* ------------------------------------------------------------------ */
/* AI drafts                                                           */
/* The website (Cloudflare Worker) calls Groq, because Apps Script     */
/* requests time out after about a minute. Apps Script checks          */
/* permissions and limits first (ai.prepare) and stores the result     */
/* (ai.save) as an article awaiting approval.                          */
/* ------------------------------------------------------------------ */

function aiDayKey_() { return 'AI_COUNT_' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd'); }
function aiLimit_() { return Number(prop_('AI_DAILY_LIMIT') || 10); }

function requireAi_(req) {
  var u = requireUser_(req);
  if (AI_ROLES.indexOf(u.role) === -1) throw new Error('AI drafts are available to the Chair, Editor-in-Chief and COO.');
  if (prop_('AI_ENABLED') === 'false') throw new Error('AI drafts are switched off in Settings.');
  return u;
}

function aiPrepare_(p, req) {
  var u = requireAi_(req);
  var topic = String(p.topic || '').trim();
  if (topic.length < 10) throw new Error('Describe the topic in a sentence or two.');
  if (p.section && SECTIONS.indexOf(p.section) === -1) throw new Error('Unknown section.');
  if (p.type && TYPES.indexOf(p.type) === -1) throw new Error('Unknown type.');
  var used = Number(prop_(aiDayKey_()) || 0);
  if (used >= aiLimit_()) throw new Error('Today’s AI draft limit (' + aiLimit_() + ') has been reached. The Chair can change it in Settings.');
  var prepId = Utilities.getUuid();
  CacheService.getScriptCache().put('aiprep_' + prepId, JSON.stringify({
    email: u.email, topic: topic.slice(0, 1500), section: p.section || '', type: p.type || '',
    byline: p.byline === 'authors' ? '' : 'abr'
  }), 900);
  return { prepId: prepId, sections: SECTIONS, types: TYPES, remaining: aiLimit_() - used };
}

function aiSave_(p, req) {
  var u = requireAi_(req);
  var cache = CacheService.getScriptCache();
  var prep = safeParse_(cache.get('aiprep_' + p.prepId));
  if (!prep || prep.email !== u.email) throw new Error('This AI request has expired. Please try again.');
  cache.remove('aiprep_' + p.prepId);
  var g = p.article || {};
  var title = String(g.title || '').trim();
  var body = String(g.body || '');
  if (!title || countWords_(body) < 150) throw new Error('The AI response was incomplete. Please try again.');
  var refs = Array.isArray(g.references) ? g.references.map(String) : [];
  var model = String(p.model || 'Groq').slice(0, 60);
  var report = String(p.report || '').slice(0, 4000);

  var a = {
    id: nextId_(), status: 'submitted', authorEmail: u.email, coAuthors: '',
    title: title.slice(0, 250), standfirst: String(g.standfirst || '').trim().slice(0, 600),
    section: SECTIONS.indexOf(g.section) !== -1 ? g.section : (prep.section || ''),
    type: TYPES.indexOf(g.type) !== -1 ? g.type : (prep.type || ''),
    tags: splitList_(g.tags).slice(0, 10).join(', '), coverUrl: '', coverCaption: '',
    sources: refs.join('\n'),
    disclosure: 'This article was researched and drafted with AI assistance (' + model + ', with web search) and was fact-checked, edited and approved by ABR’s editors before publication. All figures are taken from the references listed.',
    correction: '', body: body, wordCount: countWords_(body), byline: prep.byline,
    aiGenerated: 'TRUE', aiReport: report,
    createdAt: now_(), updatedAt: now_(), submittedAt: now_()
  };
  if (prep.section && !a.section) a.section = prep.section;
  writeArticle_(a);
  PropertiesService.getScriptProperties().setProperty(aiDayKey_(), String(Number(prop_(aiDayKey_()) || 0) + 1));
  log_(u.email, 'ai.draft', a.id, prep.topic.slice(0, 200));
  readUsers_().filter(function (x) { return APPROVER_ROLES.indexOf(x.role) !== -1 && truthy_(x.active) && x.email !== u.email; })
    .forEach(function (x) {
      notify_(x.email, 'AI draft for approval: ' + a.title,
        '<p>' + esc_(u.name) + ' generated an AI draft, <b>' + esc_(a.title) + '</b> (' + a.id + '). It is in the Approval queue.</p>' +
        '<p>Please check every fact against its reference before publishing.</p>' + portalLink_());
    });
  return editView_(a, usersByEmail_());
}

function aiSettingsGet_(p, req) {
  requireAdmin_(req);
  return { enabled: prop_('AI_ENABLED') !== 'false', dailyLimit: aiLimit_(), usedToday: Number(prop_(aiDayKey_()) || 0) };
}

function aiSettingsSave_(p, req) {
  requireAdmin_(req);
  var props = PropertiesService.getScriptProperties();
  if (p.enabled !== undefined) props.setProperty('AI_ENABLED', p.enabled ? 'true' : 'false');
  if (p.dailyLimit !== undefined) {
    var n = Math.floor(Number(p.dailyLimit));
    if (!(n >= 0 && n <= 200)) throw new Error('Daily AI limit must be between 0 and 200.');
    props.setProperty('AI_DAILY_LIMIT', String(n));
  }
  return aiSettingsGet_(p, req);
}
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
  'licence.grant':    { label: 'Grant of a licence to reuse ABR material',  level: 'standard' },
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
/**
 * Editorial planner: a task board (who is doing what) and a calendar of publication cycles.
 *  - Tasks: assigned to a team member, optionally linked to an issue and/or article, with a due date.
 *    Columns: To do → In progress → In review → Done.
 *  - Calendar: milestones (deadlines, meetings, publication days) plus, automatically, task due dates,
 *    published articles, issue publications and EiC/COO term ends.
 *  - "Plan a cycle" creates the standard milestones for an issue from its target publication date.
 * The Chair, EiC and COO can assign work to anyone; editors manage their own tasks.
 */

var TASK_COLS = ['id', 'title', 'notes', 'kind', 'status', 'assignee', 'createdBy', 'issueKey', 'articleId', 'due',
                 'priority', 'createdAt', 'updatedAt', 'doneAt'];
var EVENT_COLS = ['id', 'title', 'date', 'kind', 'issueKey', 'notes', 'createdBy', 'createdAt'];

var PLANNER_LEADS = ['chair', 'eic', 'coo'];
var TASK_STATUSES = ['todo', 'doing', 'review', 'done'];
var TASK_KINDS = {
  write: 'Writing', edit: 'Editing', factcheck: 'Fact-check', review: 'Review', design: 'Design and cover',
  statement: 'Issue statement', social: 'Social and newsletter', admin: 'Admin', other: 'Other'
};
var EVENT_KINDS = { deadline: 'Deadline', meeting: 'Meeting', publication: 'Publication', event: 'Event' };

// Standard publication cycle, counted back from the issue's publication day.
var CYCLE_STEPS = [
  [-42, 'Pitches and article list agreed', 'meeting'],
  [-28, 'First drafts due', 'deadline'],
  [-18, 'Edits and fact-checks complete', 'deadline'],
  [-12, 'Statements from the EiC, COO and editors due', 'deadline'],
  [-10, 'Chair’s foreword due', 'deadline'],
  [-7,  'Cover, contents and compiled PDF checked', 'deadline'],
  [-3,  'Final approval by the Chair', 'deadline'],
  [0,   'Issue published', 'publication']
];

var CYCLE_NOTE = 'Part of the standard publication cycle';

var PLANNER_ROUTES = {
  'planner.board':        plannerBoard_,
  'planner.task.save':    plannerTaskSave_,
  'planner.task.move':    plannerTaskMove_,
  'planner.task.delete':  plannerTaskDelete_,
  'planner.calendar':     plannerCalendar_,
  'planner.event.save':   plannerEventSave_,
  'planner.event.delete': plannerEventDelete_,
  'planner.cycle':        plannerCycle_
};

function readTasks_() { return sheetRows_('Tasks', TASK_COLS); }
function readEvents_() { return sheetRows_('Calendar', EVENT_COLS); }
function isLead_(u) { return PLANNER_LEADS.indexOf(u.role) !== -1; }
function plannerId_(prefix) { return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); }

function taskView_(t, users) {
  var a = users[t.assignee] || {};
  var today = todayIST_();
  return {
    id: t.id, title: t.title, notes: t.notes, kind: t.kind, kindLabel: TASK_KINDS[t.kind] || 'Other', status: t.status,
    assignee: t.assignee, assigneeName: a.name || t.assignee || 'Unassigned', createdBy: t.createdBy,
    issueKey: t.issueKey, articleId: t.articleId, due: t.due, priority: t.priority || 'normal',
    overdue: !!(t.due && t.status !== 'done' && t.due < today), dueSoon: !!(t.due && t.status !== 'done' && t.due >= today && daysBetween_(today, t.due) <= 2),
    createdAt: t.createdAt, updatedAt: t.updatedAt, doneAt: t.doneAt
  };
}

function plannerBoard_(p, req) {
  var u = requireUser_(req);
  var users = usersByEmail_();
  var tasks = readTasks_();
  var cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  var list = tasks.filter(function (t) { return t.status !== 'done' || String(t.doneAt) > cutoff; })   // done tasks drop off after 30 days
    .map(function (t) { return taskView_(t, users); })
    .sort(function (a, b) { return (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0; });
  var team = readUsers_().filter(function (x) { return truthy_(x.active); }).map(function (x) {
    var mine = list.filter(function (t) { return t.assignee === x.email && t.status !== 'done'; });
    return { email: x.email, name: x.name, role: x.role, title: x.title || ROLES[x.role],
             open: mine.length, doing: mine.filter(function (t) { return t.status === 'doing'; }).length,
             overdue: mine.filter(function (t) { return t.overdue; }).length,
             current: mine.filter(function (t) { return t.status === 'doing'; }).map(function (t) { return t.title; }).slice(0, 3) };
  });
  var issues = readIssues_().map(function (i) { return { key: i.key, label: issueLabel_(i), status: i.status }; });
  var articles = readMeta_().filter(function (a) { return a.status !== 'published' && a.status !== 'withdrawn'; })
    .map(function (a) { return { id: a.id, title: a.title, status: a.status }; });
  return { tasks: list, team: team, issues: issues, articles: articles, kinds: TASK_KINDS, eventKinds: EVENT_KINDS,
           canAssign: isLead_(u), me: u.email };
}

function plannerTaskSave_(p, req) {
  var u = requireUser_(req);
  var users = usersByEmail_();
  var t = p.id ? readTasks_().filter(function (x) { return x.id === p.id; })[0] : null;
  if (p.id && !t) throw new Error('Task not found.');
  if (t && !isLead_(u) && t.assignee !== u.email && t.createdBy !== u.email) throw new Error('You can only edit your own tasks.');
  var title = String(p.title || '').trim();
  if (title.length < 3) throw new Error('Give the task a title.');
  var assignee = String(p.assignee || u.email).trim().toLowerCase();
  if (!users[assignee]) throw new Error('Choose a team member.');
  if (!isLead_(u) && assignee !== u.email) throw new Error('Only the Chair, EiC or COO can assign tasks to others.');
  var prevAssignee = t ? t.assignee : '';
  t = t || { id: plannerId_('T'), createdBy: u.email, createdAt: now_(), status: 'todo', doneAt: '' };
  t.title = title.slice(0, 200);
  t.notes = String(p.notes || '').slice(0, 2000);
  t.kind = TASK_KINDS[p.kind] ? p.kind : 'other';
  if (p.status && TASK_STATUSES.indexOf(p.status) !== -1) { if (p.status === 'done' && t.status !== 'done') t.doneAt = now_(); if (p.status !== 'done') t.doneAt = ''; t.status = p.status; }
  t.assignee = assignee;
  t.issueKey = String(p.issueKey || '').slice(0, 20);
  t.articleId = /^ABR-\d{4}-\d{4}$/.test(p.articleId || '') ? p.articleId : '';
  t.due = isoDay_(p.due);
  t.priority = p.priority === 'high' ? 'high' : 'normal';
  t.updatedAt = now_();
  writeRow_('Tasks', TASK_COLS, t);
  logRaw_(u.email, 'task.save', t.articleId, t.id + ' ' + t.title);
  if (assignee !== prevAssignee && assignee !== u.email) {
    notify_(assignee, 'New task: ' + t.title,
      '<p>' + esc_(u.name) + ' assigned you a task in the ABR planner.</p><p><b>' + esc_(t.title) + '</b><br>' + esc_(TASK_KINDS[t.kind]) +
      (t.due ? ' · due ' + esc_(t.due) : '') + (t.priority === 'high' ? ' · <b>high priority</b>' : '') + '</p>' +
      (t.notes ? '<p>' + esc_(t.notes) + '</p>' : '') + portalLink_());
  }
  return taskView_(t, users);
}

function plannerTaskMove_(p, req) {
  var u = requireUser_(req);
  var t = readTasks_().filter(function (x) { return x.id === p.id; })[0];
  if (!t) throw new Error('Task not found.');
  if (!isLead_(u) && t.assignee !== u.email) throw new Error('You can only move your own tasks.');
  if (TASK_STATUSES.indexOf(p.status) === -1) throw new Error('Unknown column.');
  t.status = p.status; t.updatedAt = now_(); t.doneAt = p.status === 'done' ? now_() : '';
  writeRow_('Tasks', TASK_COLS, t);
  logRaw_(u.email, 'task.' + p.status, t.articleId, t.id);
  if (p.status === 'review' && t.createdBy && t.createdBy !== u.email) {
    notify_(t.createdBy, 'Ready for review: ' + t.title, '<p>' + esc_(u.name) + ' moved <b>' + esc_(t.title) + '</b> to In review.</p>' + portalLink_());
  }
  return taskView_(t, usersByEmail_());
}

function plannerTaskDelete_(p, req) {
  var u = requireUser_(req);
  var t = readTasks_().filter(function (x) { return x.id === p.id; })[0];
  if (!t) throw new Error('Task not found.');
  if (!isLead_(u) && t.createdBy !== u.email) throw new Error('Only the person who created this task, or the Chair, EiC or COO, can delete it.');
  sheet_('Tasks').deleteRow(t._row);
  logRaw_(u.email, 'task.delete', '', t.id + ' ' + t.title);
  return { ok: true };
}

// Everything for a date range: milestones, task due dates, publications and term ends.
function plannerCalendar_(p, req) {
  requireUser_(req);
  var from = isoDay_(p.from) || todayIST_().slice(0, 8) + '01';
  var to = isoDay_(p.to) || Utilities.formatDate(new Date(new Date(from + 'T12:00:00Z').getTime() + 42 * 86400000), 'UTC', 'yyyy-MM-dd');
  var inRange = function (d) { return d && d >= from && d <= to; };
  var users = usersByEmail_();
  var items = [];
  readEvents_().forEach(function (e) {
    if (inRange(e.date)) items.push({ id: e.id, date: e.date, type: 'event', kind: e.kind, title: e.title, notes: e.notes, issueKey: e.issueKey, editable: true });
  });
  readTasks_().forEach(function (t) {
    if (inRange(t.due)) {
      var v = taskView_(t, users);
      items.push({ id: t.id, date: t.due, type: 'task', kind: t.kind, title: t.title, who: v.assigneeName, status: t.status, overdue: v.overdue, issueKey: t.issueKey });
    }
  });
  readMeta_().forEach(function (a) {
    var d = String(a.publishedAt || '').slice(0, 10);
    if (a.status === 'published' && inRange(d)) items.push({ id: a.id, date: d, type: 'published', title: a.title });
  });
  readIssues_().forEach(function (i) {
    var d = String(i.publishedAt || '').slice(0, 10);
    if (i.status === 'published' && inRange(d)) items.push({ id: i.key, date: d, type: 'issue', title: issueLabel_(i) + ' published' });
  });
  readUsers_().forEach(function (x) {
    if (truthy_(x.active) && TERM_ROLES.indexOf(x.role) !== -1 && inRange(x.termEnd)) {
      items.push({ id: 'term-' + x.email, date: x.termEnd, type: 'term', title: 'Term ends: ' + x.name + ' (' + ROLES[x.role] + ')' });
    }
  });
  items.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return { from: from, to: to, items: items, today: todayIST_() };
}

function plannerEventSave_(p, req) {
  var u = requireUser_(req);
  if (!isLead_(u)) throw new Error('Only the Chair, EiC or COO can add calendar dates.');
  var e = p.id ? readEvents_().filter(function (x) { return x.id === p.id; })[0] : null;
  if (p.id && !e) throw new Error('Calendar entry not found.');
  var title = String(p.title || '').trim();
  if (!title) throw new Error('Give the entry a title.');
  if (!isoDay_(p.date)) throw new Error('Choose a date.');
  e = e || { id: plannerId_('E'), createdBy: u.email, createdAt: now_() };
  e.title = title.slice(0, 200); e.date = p.date; e.kind = EVENT_KINDS[p.kind] ? p.kind : 'deadline';
  e.issueKey = String(p.issueKey || '').slice(0, 20); e.notes = String(p.notes || '').slice(0, 1000);
  writeRow_('Calendar', EVENT_COLS, e);
  logRaw_(u.email, 'calendar.save', '', e.id + ' ' + e.date + ' ' + e.title);
  return e;
}

function plannerEventDelete_(p, req) {
  var u = requireUser_(req);
  if (!isLead_(u)) throw new Error('Only the Chair, EiC or COO can remove calendar dates.');
  var e = readEvents_().filter(function (x) { return x.id === p.id; })[0];
  if (!e) throw new Error('Calendar entry not found.');
  sheet_('Calendar').deleteRow(e._row);
  logRaw_(u.email, 'calendar.delete', '', e.id + ' ' + e.title);
  return { ok: true };
}

// Create the standard milestones for an issue, counted back from its publication day.
function plannerCycle_(p, req) {
  var u = requireUser_(req);
  if (!isLead_(u)) throw new Error('Only the Chair, EiC or COO can plan a cycle.');
  var i = findIssue_(p.issueKey);
  var pub = isoDay_(p.publishDate);
  if (!pub) throw new Error('Choose the publication date.');
  var label = 'Vol. ' + i.volume + ' No. ' + i.number;
  var existing = readEvents_().filter(function (e) { return e.issueKey === i.key && e.notes === CYCLE_NOTE; });
  if (existing.length && !p.replace) throw new Error('This issue already has cycle dates. Tick “Replace existing dates” to create them again.');
  existing.sort(function (a, b) { return b._row - a._row; }).forEach(function (e) { sheet_('Calendar').deleteRow(e._row); });
  var base = new Date(pub + 'T12:00:00+05:30').getTime();
  var made = CYCLE_STEPS.map(function (s) {
    var e = { id: plannerId_('E'), title: label + ': ' + s[1], date: Utilities.formatDate(new Date(base + s[0] * 86400000), 'Asia/Kolkata', 'yyyy-MM-dd'),
              kind: s[2], issueKey: i.key, notes: CYCLE_NOTE, createdBy: u.email, createdAt: now_() };
    writeRow_('Calendar', EVENT_COLS, e);
    return e;
  });
  log_(u.email, 'planner.cycle', '', i.key + ' ' + pub);
  return { created: made.length, events: made };
}

// Daily at 9 am IST: email each person their tasks that are overdue or due within two days.
function plannerReminders_() {
  var props = PropertiesService.getScriptProperties();
  var day = todayIST_();
  if (props.getProperty('PLANNER_REMIND') === day || Number(Utilities.formatDate(new Date(), 'Asia/Kolkata', 'H')) < 9) return;
  props.setProperty('PLANNER_REMIND', day);
  var users = usersByEmail_();
  var by = {};
  readTasks_().forEach(function (t) {
    var v = taskView_(t, users);
    if ((v.overdue || v.dueSoon) && users[t.assignee] && truthy_(users[t.assignee].active)) (by[t.assignee] = by[t.assignee] || []).push(v);
  });
  Object.keys(by).forEach(function (email) {
    var list = by[email];
    notify_(email, list.length + ' ABR task' + (list.length === 1 ? '' : 's') + ' need' + (list.length === 1 ? 's' : '') + ' attention',
      '<p>Here are your tasks that are overdue or due in the next two days:</p><ul>' +
      list.map(function (t) { return '<li><b>' + esc_(t.title) + '</b>, ' + (t.overdue ? '<b>overdue</b> (was due ' : 'due ') + esc_(t.due) + (t.overdue ? ')' : '') + '</li>'; }).join('') +
      '</ul>' + portalLink_());
  });
}
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
/**
 * Site appearance and the Chair's signature:
 *  - optional "drafted with AI assistance" note on articles (off by default; the disclosure already says it);
 *  - the Chair's uploaded signature, used on letters, certificates, licences and greetings;
 *  - seasonal designs (Christmas, New Year, Uttarayan, Holi, Navratri, Diwali, Independence Day,
 *    Republic Day, and a sober mourning design), switched on by hand or by date;
 *  - festival greetings: while a festive design is on, any visitor can ask for a greeting from the
 *    Chair, which is emailed to them at once as a PDF on letterhead.
 */

var GREET_COLS = ['id', 'token', 'theme', 'name', 'email', 'organisation', 'city', 'status', 'createdAt', 'sentAt', 'ip'];

var THEMES = {
  christmas:    { name: 'Christmas',        greeting: 'Season’s greetings', range: ['12-20', '12-26'] },
  newyear:      { name: 'New Year',         greeting: 'Happy New Year',     range: ['12-31', '01-03'] },
  uttarayan:    { name: 'Uttarayan',        greeting: 'Happy Uttarayan',    range: ['01-13', '01-15'] },
  republic:     { name: 'Republic Day',     greeting: 'Happy Republic Day', range: ['01-25', '01-26'] },
  holi:         { name: 'Holi',             greeting: 'Happy Holi',         dates: ['2027-03-20', '2027-03-23'] },
  independence: { name: 'Independence Day', greeting: 'Happy Independence Day', range: ['08-14', '08-15'] },
  navratri:     { name: 'Navratri',         greeting: 'Happy Navratri',     dates: ['2027-09-30', '2027-10-09'] },
  diwali:       { name: 'Diwali',           greeting: 'Happy Diwali and Saal Mubarak', dates: ['2027-10-26', '2027-11-01'] },
  mourning:     { name: 'Mourning',         greeting: '',                   manual: true }
};

var THEME_MESSAGES = {
  christmas: 'As the year draws to a close, all of us at Ahmedabad Business Review send you our warmest wishes for Christmas and the festive season. Thank you for reading, questioning and sharing ideas with us this year. May the season bring you rest, good company and the quiet joy of time well spent.',
  newyear: 'A new year is a fresh page, and we are glad to begin it with you. On behalf of everyone at Ahmedabad Business Review, I wish you a year of good health, clear thinking and work that matters. Thank you for being part of a community that values ideas that last.',
  uttarayan: 'Happy Uttarayan from Ahmedabad! As the sky over our city fills with kites, we send you our good wishes for the season of the sun’s return. May your ambitions rise as high as the brightest kite, and may the string that holds them, your values and your people, stay strong.',
  republic: 'On Republic Day, we celebrate the Constitution that gives India its institutions and its citizens their voice. All of us at Ahmedabad Business Review wish you a proud and thoughtful Republic Day, and renew our commitment to informed public discussion.',
  holi: 'Wishing you a joyful and colourful Holi from all of us at Ahmedabad Business Review. May the festival of colours bring new energy, renewed friendships and the spirit of spring to your home and your work.',
  independence: 'On Independence Day, we remember those who won India’s freedom and the responsibility it places on each generation to build. All of us at Ahmedabad Business Review wish you a happy Independence Day.',
  navratri: 'Wishing you and your family a joyful Navratri. As Gujarat comes alive with garba and devotion, all of us at Ahmedabad Business Review send our good wishes for nine nights of celebration and a Dussehra of new beginnings.',
  diwali: 'Wishing you a very happy Diwali and a prosperous New Year. May the festival of lights bring light, health and prosperity to you and your family, and may the year ahead bring good work and good fortune. Saal Mubarak from all of us at Ahmedabad Business Review.'
};

var FESTIVE_ROUTES = {
  'site.settings.get':      siteSettingsGet_,
  'site.settings.save':     siteSettingsSave_,
  'site.signature.upload':  signatureUpload_,
  'site.signature.remove':  signatureRemove_,
  'public.site':            function () { return publicSite_(); },
  'public.greeting.create': greetingCreate_,
  'public.greeting.send':   greetingSend_,
  'public.greeting.get':    greetingGet_,
  'greetings.list':         greetingsList_
};

function siteSettings_() {
  var s = safeParse_(prop_('SITE_SETTINGS')) || {};
  var schedule = {};
  Object.keys(THEMES).forEach(function (k) {
    var t = THEMES[k], cur = (s.schedule || {})[k] || {};
    schedule[k] = { auto: cur.auto !== undefined ? !!cur.auto : !t.manual,
                    from: cur.from || (t.dates ? t.dates[0] : ''), to: cur.to || (t.dates ? t.dates[1] : ''),
                    range: t.range || null, message: cur.message || THEME_MESSAGES[k] || '' };
  });
  return {
    aiNote: !!s.aiNote,
    themeMode: s.themeMode || 'auto',               // 'off' | 'auto' | a theme key
    schedule: schedule,
    mourning: s.mourning || { name: '', note: '' },
    greetingsOn: s.greetingsOn !== false,
    greetingsDailyLimit: Number(s.greetingsDailyLimit) || 300,
    signatureOn: s.signatureOn || { letters: true, certificates: true, licences: true, greetings: true },
    signatureFile: prop_('SIGNATURE_FILE_ID') ? true : false,
    signatureAt: prop_('SIGNATURE_AT') || '',
    version: s.version || '1'
  };
}

function mmdd_(d) { return d.slice(5); }
function inRange_(today, from, to) {   // MM-DD ranges may wrap over the year end
  var t = mmdd_(today);
  return from <= to ? (t >= from && t <= to) : (t >= from || t <= to);
}

// Which design is showing today.
function activeTheme_(s) {
  s = s || siteSettings_();
  if (s.themeMode === 'off') return null;
  if (THEMES[s.themeMode]) return s.themeMode;
  var today = todayIST_();
  var keys = Object.keys(THEMES);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], sc = s.schedule[k];
    if (THEMES[k].manual || !sc.auto) continue;
    if (sc.from && sc.to && today >= sc.from && today <= sc.to) return k;
    if (!THEMES[k].dates && sc.range && inRange_(today, sc.range[0], sc.range[1])) return k;
  }
  return null;
}

// Read by the Worker (cached for a few minutes) to decorate every page.
function publicSite_() {
  var s = siteSettings_();
  var k = activeTheme_(s);
  var t = k ? THEMES[k] : null;
  return {
    aiNote: s.aiNote,
    theme: k ? { key: k, name: t.name, greeting: t.greeting, mourning: k === 'mourning',
                 mourningName: k === 'mourning' ? s.mourning.name : '', mourningNote: k === 'mourning' ? s.mourning.note : '' } : null,
    greetingsOpen: !!(k && k !== 'mourning' && s.greetingsOn),
    v: [s.version, k || 'none', s.aiNote ? 1 : 0, s.greetingsOn ? 1 : 0].join('.')
  };
}

function siteSettingsGet_(p, req) {
  requireApprover_(req);
  var s = siteSettings_();
  s.themes = Object.keys(THEMES).map(function (k) { return { key: k, name: THEMES[k].name, fixed: !!THEMES[k].range, manual: !!THEMES[k].manual }; });
  s.active = activeTheme_(s);
  s.signaturePreview = signatureDataUrl_();
  return s;
}

function siteSettingsSave_(p, req) {
  var u = requireApprover_(req);
  var cur = safeParse_(prop_('SITE_SETTINGS')) || {};
  var s = {
    aiNote: !!p.aiNote,
    themeMode: p.themeMode === 'off' || p.themeMode === 'auto' || THEMES[p.themeMode] ? p.themeMode : 'auto',
    schedule: {},
    mourning: { name: String((p.mourning || {}).name || '').slice(0, 120), note: String((p.mourning || {}).note || '').slice(0, 300) },
    greetingsOn: p.greetingsOn !== false,
    greetingsDailyLimit: Math.max(10, Math.min(2000, Number(p.greetingsDailyLimit) || 300)),
    signatureOn: { letters: !!(p.signatureOn || {}).letters, certificates: !!(p.signatureOn || {}).certificates,
                   licences: !!(p.signatureOn || {}).licences, greetings: !!(p.signatureOn || {}).greetings },
    version: String((Number(cur.version) || 1) + 1)
  };
  if (s.themeMode === 'mourning' && !s.mourning.name && !s.mourning.note) throw new Error('For the mourning design, enter whom ABR is mourning, or a short note.');
  Object.keys(THEMES).forEach(function (k) {
    var x = (p.schedule || {})[k] || {};
    var from = isoDay_(x.from), to = isoDay_(x.to);
    if (from && to && to < from) throw new Error(THEMES[k].name + ': the end date is before the start date.');
    s.schedule[k] = { auto: !!x.auto, from: from, to: to, message: String(x.message || '').trim().slice(0, 1200) };
  });
  PropertiesService.getScriptProperties().setProperty('SITE_SETTINGS', JSON.stringify(s));
  log_(u.email, 'site.settings', '', s.themeMode + ' / ai note ' + (s.aiNote ? 'on' : 'off'));
  return siteSettingsGet_(p, req);
}

/* -------------------------- Chair's signature -------------------------- */

function signatureUpload_(p, req) {
  var u = requireApprover_(req);
  var m = /^data:image\/png;base64,(.+)$/.exec(String(p.dataUrl || ''));
  if (!m) throw new Error('Upload the signature as a PNG image.');
  var bytes = Utilities.base64Decode(m[1]);
  if (bytes.length > 400 * 1024) throw new Error('The signature image is too large. Use an image under 400 KB.');
  var props = PropertiesService.getScriptProperties();
  var old = props.getProperty('SIGNATURE_FILE_ID');
  var folderId = prop_('IMAGE_FOLDER_ID');
  var file = (folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder()).createFile(Utilities.newBlob(bytes, 'image/png', 'ABR-chair-signature.png'));
  // Private to the script owner: the image is only ever embedded into documents by the server.
  props.setProperty('SIGNATURE_FILE_ID', file.getId());
  props.setProperty('SIGNATURE_AT', now_());
  CacheService.getScriptCache().remove('sigdata');
  if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) {} }
  log_(u.email, 'signature.upload', '', file.getId());
  return siteSettingsGet_(p, req);
}

function signatureRemove_(p, req) {
  var u = requireApprover_(req);
  var props = PropertiesService.getScriptProperties();
  var old = props.getProperty('SIGNATURE_FILE_ID');
  if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) {} }
  props.deleteProperty('SIGNATURE_FILE_ID'); props.deleteProperty('SIGNATURE_AT');
  CacheService.getScriptCache().remove('sigdata');
  log_(u.email, 'signature.remove', '', '');
  return siteSettingsGet_(p, req);
}

function signatureDataUrl_() {
  var id = prop_('SIGNATURE_FILE_ID');
  if (!id) return '';
  var cache = CacheService.getScriptCache();
  var hit = cache.get('sigdata');
  if (hit) return hit;
  try {
    var url = 'data:image/png;base64,' + Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes());
    if (url.length < 95000) cache.put('sigdata', url, 21600);
    return url;
  } catch (e) { return ''; }
}

// Signature to print on a document of this kind, if the Chair has turned it on.
function chairSignatureFor_(kind) {
  var s = siteSettings_();
  return s.signatureOn[kind] ? signatureDataUrl_() : '';
}

/* -------------------------- Greetings -------------------------- */

function readGreetings_() { return sheetRows_('Greetings', GREET_COLS); }

function greetingDoc_(g) {
  var s = siteSettings_();
  var t = THEMES[g.theme] || THEMES.diwali;
  var chair = chairs_()[0] || { name: '', title: ROLES.chair };
  return { id: g.id, theme: g.theme, themeName: t.name, greeting: t.greeting, name: g.name, organisation: g.organisation, city: g.city,
           message: (s.schedule[g.theme] || {}).message || THEME_MESSAGES[g.theme] || '', date: g.createdAt,
           chair: { name: chair.name, title: chair.title || ROLES.chair }, signature: chairSignatureFor_('greetings') };
}

function greetingCreate_(p, req) {
  if (p.website) throw new Error('Something went wrong. Please try again.');   // honeypot
  var site = publicSite_();
  if (!site.greetingsOpen) throw new Error('Greetings are not open at the moment.');
  var ip = String((req.meta && req.meta.ip) || 'x');
  rateLimit_('greet_' + ip, 3, 3600, 'You have asked for several greetings already. Please try again later.');
  var name = String(p.name || '').trim().replace(/\s+/g, ' ');
  var email = String(p.email || '').trim().toLowerCase();
  if (name.length < 2 || name.length > 80 || /https?:|www\.|[<>{}]/i.test(name)) throw new Error('Enter your name as you would like it on the greeting.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) throw new Error('Enter a valid email address.');
  var theme = site.theme.key;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var g;
  try {
    var all = readGreetings_();
    var today = todayIST_();
    if (all.filter(function (x) { return String(x.createdAt).slice(0, 10) === today; }).length >= siteSettings_().greetingsDailyLimit) {
      throw new Error('We have sent all of today’s greetings. Please try again tomorrow.');
    }
    var dup = all.filter(function (x) { return x.email === email && x.theme === theme && String(x.createdAt).slice(0, 4) === today.slice(0, 4); })[0];
    if (dup) throw new Error('A ' + THEMES[theme].name + ' greeting has already been sent to this email address. Check your inbox (and spam).');
    g = { id: seq_('ABRG'), token: randomKey_(16), theme: theme, name: name, email: email,
          organisation: String(p.organisation || '').trim().slice(0, 120).replace(/[<>]/g, ''), city: String(p.city || '').trim().slice(0, 60).replace(/[<>]/g, ''),
          status: 'created', createdAt: now_(), sentAt: '', ip: ip.slice(0, 64) };
    writeRow_('Greetings', GREET_COLS, g);
  } finally { lock.releaseLock(); }
  var d = greetingDoc_(g);
  d.key = g.token;
  return d;
}

// The Worker renders the PDF and hands it back; we email it with the PDF attached.
function greetingSend_(p, req) {
  var g = readGreetings_().filter(function (x) { return x.id === p.id; })[0];
  if (!g || p.key !== g.token) throw new Error('Greeting not found.');
  if (g.status === 'sent') return { sent: true };
  var t = THEMES[g.theme];
  var link = site_() + '/greetings/' + g.id + '?k=' + g.token;
  var att = null;
  if (p.pdf && String(p.pdf).length < 7000000) {
    att = Utilities.newBlob(Utilities.base64Decode(String(p.pdf)), 'application/pdf', 'ABR-' + t.name.replace(/\s+/g, '-') + '-greeting.pdf');
  }
  var chair = chairs_()[0] || { name: '' };
  var html = renderEmail_({
    preheader: t.greeting + ' from Ahmedabad Business Review', heading: t.greeting + ', ' + g.name.split(' ')[0],
    bodyHtml: '<p>Dear ' + esc_(g.name) + ',</p><p>' + esc_(greetingDoc_(g).message) + '</p><p>Warm regards,<br><b>' + esc_(chair.name) + '</b><br>' +
      esc_(chair.title || ROLES.chair) + ', Ahmedabad Business Review</p>' +
      '<p style="color:#666;font-size:13px">' + (att ? 'Your greeting on ABR letterhead is attached as a PDF. ' : '') + 'You can also view or print it online.</p>',
    button: { label: 'View your greeting', url: link }, footer: 'system'
  });
  sendSystemEmail_(g.email, t.greeting + ' from the Chair of Ahmedabad Business Review', html, g.name, att ? { attachments: [att] } : undefined);
  g.status = 'sent'; g.sentAt = now_();
  writeRow_('Greetings', GREET_COLS, g);
  return { sent: true };
}

function greetingGet_(p) {
  var g = readGreetings_().filter(function (x) { return x.id === String(p.id || '').toUpperCase(); })[0];
  if (!g || !p.key || p.key !== g.token) return null;
  return greetingDoc_(g);
}

function greetingsList_(p, req) {
  requireApprover_(req);
  var list = readGreetings_().sort(byDateDesc_('createdAt'));
  var by = {};
  list.forEach(function (g) { by[g.theme] = (by[g.theme] || 0) + 1; });
  return { total: list.length, byTheme: by, recent: list.slice(0, 50).map(function (g) {
    return { id: g.id, theme: g.theme, name: g.name, email: g.email, organisation: g.organisation, city: g.city, status: g.status, createdAt: g.createdAt };
  }) };
}
