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
