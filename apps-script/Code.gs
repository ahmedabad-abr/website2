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
