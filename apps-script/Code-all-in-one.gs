/* ===== ABR Apps Script — all-in-one (Code + Mail + Agreement + Seed). Paste this whole file into Code.gs. ===== */
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
                 'salt', 'hash', 'createdAt', 'updatedAt'];

var META_COLS = ['id', 'slug', 'status', 'title', 'standfirst', 'section', 'type', 'tags',
                 'coverUrl', 'coverCaption', 'authorEmail', 'coAuthors', 'sources', 'disclosure',
                 'correction', 'reviewNote', 'reviewedBy', 'wordCount', 'createdAt', 'updatedAt',
                 'submittedAt', 'publishedAt', 'modifiedAt', 'withdrawnAt'];
var BODY_COLS = [];
for (var _i = 1; _i <= BODY_CHUNKS; _i++) BODY_COLS.push('body_' + _i);
var ART_COLS = META_COLS.concat(BODY_COLS);

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
  'public.config':     function () { return { sections: SECTIONS, types: TYPES }; },

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
    rows = rows.filter(function (a) { return authorEmails_(a).indexOf(u.email) !== -1; });
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
  return { articles: arts, authors: authors, sections: SECTIONS };
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
    authors: authorEmails_(a).map(function (e) { return users[e] ? authorView_(users[e]) : null; })
                              .filter(function (x) { return x; }),
    publishedAt: a.publishedAt, modifiedAt: a.modifiedAt || '', correction: a.correction,
    wordCount: Number(a.wordCount) || 0
  };
  if (withBody) {
    out.body = a.body || '';
    out.sources = splitLines_(a.sources);
    out.disclosure = a.disclosure;
  }
  return out;
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
           needsAgreement: needsAgreement_(u) };
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
    existing.role = p.role;
    existing.title = String(p.title || ROLES[p.role]).trim();
    if (p.active !== undefined) existing.active = p.active ? 'TRUE' : 'FALSE';
    existing.updatedAt = now_();
    writeRow_('Users', USER_COLS, existing);
    log_(admin.email, 'team.update', '', email);
    return { email: email };
  }
  var temp = createOrResetUser_({ email: email, name: p.name, role: p.role, title: p.title || ROLES[p.role] });
  log_(admin.email, 'team.add', '', email);
  var welcome = 'not sent';
  try { welcome = sendWelcome_(usersByEmail_()[email], temp); } catch (e) { log_(admin.email, 'welcomeFailed', '', e.message); }
  return { email: email, tempPassword: temp, welcome: welcome };
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
    wordCount: Number(a.wordCount) || 0, reviewNote: a.reviewNote,
    updatedAt: a.updatedAt, submittedAt: a.submittedAt, publishedAt: a.publishedAt
  };
}

function editView_(a, users) {
  var v = listView_(a, users);
  ['standfirst', 'tags', 'coverUrl', 'coverCaption', 'coAuthors', 'sources', 'disclosure',
   'correction', 'body', 'modifiedAt', 'withdrawnAt', 'createdAt'].forEach(function (f) { v[f] = a[f] || ''; });
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

function readMeta_() { return readRows_('Articles', META_COLS, META_COLS.length); }

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

/**
 * Team agreement (confidentiality + ownership of work) and onboarding emails.
 *
 * Every team member except the Chair must sign the current agreement version in the portal
 * before they can use it. Signing records a typed electronic signature, time, IP address and a
 * hash of the exact text signed, saves a PDF copy to a private Drive folder, and emails a copy.
 *
 * The default text below is a starting template, not legal advice. Have it reviewed.
 */

var AGREEMENT_EXEMPT_ROLES = ['chair'];
var AGREE_COLS = ['id', 'email', 'name', 'role', 'version', 'signature', 'signedAt', 'ip', 'userAgent', 'textHash', 'fileId'];

var AGREEMENT_ROUTES = {
  'agreement.get':           agreementGet_,
  'agreement.sign':          agreementSign_,
  'agreement.settings.get':  agreementSettingsGet_,
  'agreement.settings.save': agreementSettingsSave_,
  'agreement.list':          agreementList_
};

// Actions a member can use before signing.
var AGREEMENT_OPEN_ACTIONS = ['auth.login', 'auth.logout', 'auth.me', 'auth.changePassword', 'agreement.get', 'agreement.sign'];

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
  readUsers_().filter(function (x) { return AGREEMENT_EXEMPT_ROLES.indexOf(x.role) !== -1 && truthy_(x.active); }).forEach(function (chair) {
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
        body: s.body, wordCount: countWords_(s.body),
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
