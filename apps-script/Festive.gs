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
    markets: marketsStripData_(),
    v: [s.version, k || 'none', s.aiNote ? 1 : 0, s.greetingsOn ? 1 : 0, (safeParse_(prop_('MARKETS')) || {}).updatedAt || 'm'].join('.')
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

function marketsStripData_() {
  if (typeof marketsPublic_ !== 'function') return null;
  var m = marketsPublic_();
  if (!m.strip || !m.items.length) return null;
  var d = new Date(m.asOf.length === 10 ? m.asOf + 'T15:30:00+05:30' : m.asOf + ':00+05:30');
  return { date: Utilities.formatDate(d, 'Asia/Kolkata', 'd MMM'), items: m.items.slice(0, 5) };
}
