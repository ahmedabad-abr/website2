import { sanitizeHtml, textFromHtml } from '/assets/sanitize.js';
import { qrSvg } from '/assets/qr.js';

/* =========================================================
   State & API
   ========================================================= */
const state = {
  token: localStorage.getItem('abr_token') || '',
  user: null,
  config: { sections: [], types: [], roles: {}, siteUrl: '' },
  directory: null,
  dirty: false
};

const ANALYTICS_ROLES = ['chair', 'eic', 'coo'];
const TERM_ROLES = ['eic', 'coo'];
const STATUS = {
  draft: 'Draft',
  submitted: 'Awaiting approval',
  changes_requested: 'Changes requested',
  published: 'Published',
  rejected: 'Not accepted',
  withdrawn: 'Withdrawn'
};

async function api(action, payload = {}) {
  let res;
  try {
    res = await fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload, token: state.token })
    });
  } catch {
    throw new Error('Network error. Check your connection.');
  }
  const j = await res.json().catch(() => ({ ok: false, error: 'Unexpected server response.' }));
  if (!j.ok) {
    if (/session has expired|please log in|account disabled/i.test(j.error || '')) {
      clearSession();
      go('#/login');
    }
    throw new Error(j.error || 'Something went wrong.');
  }
  if (APPROVAL_TRIGGERS.includes(action) && state.user && state.user.canAdmin) setTimeout(checkNewApprovals, 300);
  return j.data;
}

// Actions that can create a printable approval record.
const APPROVAL_TRIGGERS = ['review.decide', 'review.unpublish', 'issues.publish', 'team.save', 'partners.save', 'certs.revoke', 'approvals.create'];

async function checkNewApprovals() {
  const since = state.approvalSince || new Date(Date.now() - 60e3).toISOString();
  let list = [];
  try { list = await api('approvals.recent', { since }); } catch { return; }
  if (!list.length) return;
  state.approvalSince = list[0].createdAt;
  printPrompt(list);
}

// "Print now / Print later / Download PDF" prompt shown right after an approval.
function printPrompt(list) {
  const m = document.createElement('div');
  m.className = 'p-modal';
  m.innerHTML = `<div class="p-modal-box p-print-box"><button class="p-modal-x" aria-label="Close">×</button>
    <h2>Print for signature and filing</h2>
    <p class="small muted">${list.length > 1 ? 'These approvals have' : 'This approval has'} produced ${list.length > 1 ? 'records' : 'a record'} on ABR letterhead (black and white). Print, sign and file ${list.length > 1 ? 'them' : 'it'}.</p>
    ${list.map((r) => `<div class="p-print-row" data-id="${esc(r.id)}">
      <div><code>${esc(r.id)}</code> <span class="p-badge ${r.level === 'major' ? 's-submitted' : 's-draft'}">${r.level === 'major' ? '2 pages · countersignature + Chair' : '1 page · Chair'}</span>
        <div><b>${esc(r.subject)}</b></div>
        ${r.level === 'major' ? `<div class="small muted">Page 1 to be countersigned by: ${esc(r.countersignRole)}${r.countersignName ? ' (' + esc(r.countersignName) + ')' : ''}</div>` : ''}</div>
      <div class="p-row"><button class="btn sm pp-now">Print now</button><a class="btn ghost sm" href="${esc(r.pdfUrl)}" target="_blank" rel="noopener">Download PDF</a><button class="btn ghost sm pp-later">Print later</button></div>
    </div>`).join('')}
    <p class="small muted">Records you print later stay in <a href="#/approvals">Approvals</a> under “To print”.</p></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  $('.p-modal-x', m).onclick = close;
  m.onclick = (e) => { if (e.target === m) close(); };
  list.forEach((r) => {
    const row = $(`[data-id="${r.id}"]`, m);
    $('.pp-now', row).onclick = () => { window.open(r.printUrl + '&print=1', '_blank'); api('approvals.mark', { id: r.id, status: 'printed' }).catch(() => {}); row.classList.add('done'); };
    $('.pp-later', row).onclick = () => { row.classList.add('done'); if (!$$('.p-print-row:not(.done)', m).length) close(); toast('Saved under Approvals → To print', 'ok'); };
  });
}

function clearSession() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('abr_token');
}

/* =========================================================
   Helpers
   ========================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = () => $('#app');
const formObj = (f) => Object.fromEntries(new FormData(f));

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ''), 3500);
}

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function badge(status) {
  return `<span class="p-badge s-${esc(status)}">${esc(STATUS[status] || status)}</span>`;
}

async function busy(btn, fn) {
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
  try { return await fn(); }
  catch (e) { toast(e.message, 'err'); throw e; }
  finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}

function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

function words(html) {
  const t = textFromHtml(html);
  return t ? t.split(/\s+/).length : 0;
}

async function downscale(file, maxW = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const scale = Math.min(1, maxW / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

async function uploadImage(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Choose an image file.');
  const dataUrl = file.type === 'image/gif' ? await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(file); })
                                            : await downscale(file);
  const res = await api('upload.image', { dataUrl, filename: file.name.replace(/\.\w+$/, '') + '.jpg' });
  return res.url;
}

function pickFile(accept = 'image/*') {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => resolve(i.files[0] || null);
    i.click();
  });
}

/* =========================================================
   Shell
   ========================================================= */
function shell(active, inner) {
  const u = state.user;
  const nav = [
    ['#/', 'My articles', 'mine'],
    ['#/new', 'New article', 'new'],
    ...(u.canAi ? [['#/ai', 'AI draft', 'ai']] : []),
    ...(u.canApprove ? [['#/review', 'Approval queue', 'review'], ['#/all', 'All articles', 'all'], ['#/import', 'Import', 'import'], ['#/partners', 'Partners', 'partners']] : []),
    ['#/planner', 'Planner', 'planner'],
    ...(['chair', 'eic', 'coo', 'editor'].includes(u.role) ? [['#/markets', 'Markets desk', 'markets']] : []),
    ['#/issues', 'Issues', 'issues'],
    ...(ANALYTICS_ROLES.includes(u.role) ? [['#/analytics', 'Analytics', 'analytics']] : []),
    ...(PERM_ROLES.includes(u.role) ? [['#/permissions', 'Permissions', 'perms']] : []),
    ...(u.canMail ? [['#/mail', 'Email', 'mail'], ['#/subscribers', 'Subscribers', 'subs']] : []),
    ...(u.canAdmin ? [['#/approvals', 'Approvals', 'approvals'], ['#/certificates', 'Certificates', 'certs'], ['#/letters', 'Letters', 'letters'], ['#/team', 'Team', 'team'], ['#/settings', 'Settings', 'settings']] : []),
    ['#/profile', 'My profile', 'profile']
  ];
  app().innerHTML = `
  <div class="p-shell">
    <aside class="p-side">
      <a class="p-brand" href="#/"><img src="/brand/logo/emblem/ABR-Emblem-White.svg" alt="ABR" width="30" height="36"><span>Editorial Portal</span></a>
      <nav>${nav.map(([h, l, k]) => `<a href="${h}" class="${active === k ? 'on' : ''}">${l}${k === 'review' ? '<span class="p-count" id="queueCount"></span>' : ''}</a>`).join('')}</nav>
      <div class="p-me">
        <div><b>${esc(u.name)}</b><br><span class="muted">${esc(u.title)}</span></div>
        <a href="/" target="_blank" rel="noopener">View site ↗</a>
        <button class="p-link" id="logout">Log out</button>
      </div>
    </aside>
    <section class="p-main">${inner}</section>
  </div>`;
  $('#logout').onclick = async () => {
    try { await api('auth.logout'); } catch {}
    clearSession();
    go('#/login');
  };
  if (u.canApprove) {
    api('review.queue').then((q) => { const c = $('#queueCount'); if (c && q.length) c.textContent = q.length; }).catch(() => {});
  }
}

/* =========================================================
   Views
   ========================================================= */
function viewLogin() {
  app().innerHTML = `
  <div class="p-login">
    <form id="loginForm" class="p-card">
      <div class="p-login-brand"><img src="/brand/logo/primary/ABR-Primary-Stacked-Black.svg" alt="Ahmedabad Business Review" width="240"><span class="p-login-sub">Editorial Portal</span></div>
      <label>Email<input type="email" name="email" required autocomplete="username"></label>
      <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
      <button class="btn p-wide" type="submit">Log in</button>
      <p class="small"><a href="#/forgot">Forgot your password?</a></p>
      <p class="muted small">Accounts are created by the Chair.</p>
    </form>
  </div>`;
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    await busy($('button', f), async () => {
      const r = await api('auth.login', { email: f.email.value, password: f.password.value });
      if (r.twoFactor) return twoFactorStep(r);
      finishLogin(r);
    }).catch(() => {});
  };
}

function finishLogin(r) {
  state.token = r.token; state.user = r.user; state.config = r.config;
  localStorage.setItem('abr_token', r.token);
  if (r.backupCodes) return showBackupCodes(r.backupCodes, true);
  if (r.backupCodesLeft !== undefined && r.backupCodesLeft <= 3) toast(`You have ${r.backupCodesLeft} backup codes left. Make new ones under My profile.`, 'err');
  go('#/');
}

// Second step of sign-in: set up an authenticator app (first time) or enter its code.
function twoFactorStep(r) {
  const setup = r.twoFactor === 'setup';
  const key = setup ? r.secret.replace(/(.{4})/g, '$1 ').trim() : '';
  app().innerHTML = `
  <div class="p-login">
    <form id="tfaForm" class="p-card p-tfa">
      <div class="p-login-brand"><img src="/brand/logo/primary/ABR-Primary-Stacked-Black.svg" alt="Ahmedabad Business Review" width="200"><span class="p-login-sub">Two-factor sign-in</span></div>
      ${setup ? `<h2>Protect your account</h2>
        <p class="small">Two-factor sign-in is required for every ABR team account. You need an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or Authy.</p>
        <ol class="small p-tfa-steps"><li>In the app, add an account and scan this code.</li></ol>
        <div class="p-qr">${qrSvg(r.otpauth, { scale: 4 })}</div>
        <p class="small muted">Can’t scan? Enter this key instead: <code class="p-key">${esc(key)}</code></p>
        <ol class="small p-tfa-steps" start="2"><li>Type the 6-digit code the app shows.</li></ol>`
      : `<h2>Enter your code</h2><p class="small">Open your authenticator app and type the 6-digit code for ABR. Lost your phone? Use one of your backup codes.</p>`}
      <label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="${setup ? 6 : 11}" required autofocus class="p-code"></label>
      <button class="btn p-wide" type="submit">${setup ? 'Turn on and sign in' : 'Sign in'}</button>
      <p class="small"><a href="#/" id="tfaBack">Start again</a></p>
    </form>
  </div>`;
  $('#tfaBack').onclick = (e) => { e.preventDefault(); viewLogin(); };
  $('#tfaForm').onsubmit = async (e) => {
    e.preventDefault();
    await busy($('button', e.target), async () => {
      finishLogin(await api(setup ? 'auth.2fa.setup' : 'auth.2fa.verify', { ticket: r.ticket, code: e.target.code.value.trim() }));
    }).catch(() => {});
  };
}

function showBackupCodes(codes, first) {
  const m = document.createElement('div');
  m.className = 'p-modal';
  m.innerHTML = `<div class="p-modal-box p-card p-modal-sm">
    <h2>${first ? 'Two-factor sign-in is on' : 'New backup codes'}</h2>
    <p class="small">Save these backup codes somewhere safe, such as a password manager or a printed sheet. Each works once, if you don’t have your phone. <b>You won’t see them again.</b>${first ? '' : ' Your old codes no longer work.'}</p>
    <div class="p-codes">${codes.map((c) => `<code>${esc(c)}</code>`).join('')}</div>
    <div class="p-row"><button class="btn ghost" id="bcCopy">Copy</button><button class="btn ghost" id="bcPrint">Print</button><button class="btn" id="bcDone">I have saved them</button></div></div>`;
  document.body.appendChild(m);
  $('#bcCopy', m).onclick = () => navigator.clipboard && navigator.clipboard.writeText(codes.join('\n')).then(() => toast('Copied', 'ok'));
  $('#bcPrint', m).onclick = () => { const w = window.open('', '_blank'); w.document.write(`<pre style="font:16px monospace">ABR Editorial Portal backup codes\n${esc(state.user ? state.user.email : '')}\n\n${codes.join('\n')}</pre>`); w.print(); };
  $('#bcDone', m).onclick = () => { m.remove(); if (first) go('#/'); };
}

function articleTable(list, opts = {}) {
  if (!list.length) return `<div class="p-empty">${opts.empty || 'Nothing here yet.'}</div>`;
  return `<table class="p-table">
    <thead><tr><th>Title</th>${opts.showAuthors ? '<th>Authors</th>' : ''}<th>Section</th><th>Status</th><th>${opts.dateLabel || 'Last edited'}</th><th>Words</th></tr></thead>
    <tbody>${list.map((a) => `<tr>
      <td><a href="#/edit/${esc(a.id)}" class="p-title-link">${esc(a.title || 'Untitled')}</a><div class="muted small">${esc(a.id)}${a.type ? ' · ' + esc(a.type) : ''}${a.issueKey ? ' · ' + esc(a.issueKey.replace(/^v(\d+)n(\d+)$/, 'Vol. $1 No. $2')) : ''}${a.doiState === 'published' ? ' · DOI' : ''}</div>
        ${a.status === 'changes_requested' || a.status === 'rejected' ? `<div class="p-note-inline">Note: ${esc(a.reviewNote)}</div>` : ''}</td>
      ${opts.showAuthors ? `<td>${a.byline === 'abr' ? '<i>Curated by ABR</i><div class="muted small">' + esc((a.authors || []).join(', ') || a.contributorName || '') + '</div>'
        : a.source === 'external' ? `${esc(a.contributorName)} <span class="p-badge s-draft">Outside</span>` : esc((a.authors || []).join(', '))}</td>` : ''}
      <td>${esc(a.section || '—')}</td>
      <td>${badge(a.status)}${a.status === 'published' ? ` <a href="/articles/${esc(a.slug)}" target="_blank" rel="noopener" class="small">view ↗</a>` : ''}</td>
      <td class="small">${fmt(opts.dateField ? a[opts.dateField] : a.updatedAt)}</td>
      <td class="small">${a.wordCount || 0}</td>
    </tr>`).join('')}</tbody></table>`;
}

async function viewMine() {
  shell('mine', `<header class="p-head"><h1>My articles</h1><a class="btn" href="#/new">New article</a></header><div id="list" class="p-loading">Loading…</div>`);
  const list = await api('articles.mine');
  $('#list').className = '';
  $('#list').innerHTML = articleTable(list, { empty: 'You haven’t written anything yet. <a href="#/new">Start a new article</a>.' });
}

async function viewReview() {
  shell('review', `<header class="p-head"><h1>Approval queue</h1></header><p class="muted">Articles submitted for publication, oldest first.</p><div id="list" class="p-loading">Loading…</div>`);
  const list = await api('review.queue');
  $('#list').className = '';
  $('#list').innerHTML = articleTable(list, { showAuthors: true, dateLabel: 'Submitted', dateField: 'submittedAt', empty: 'No articles are waiting for approval.' });
}

async function viewAll() {
  shell('all', `<header class="p-head"><h1>All articles</h1><select id="filter" class="p-select"><option value="">All statuses</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></header><div id="list" class="p-loading">Loading…</div>`);
  const list = await api('review.all');
  const draw = () => {
    const f = $('#filter').value;
    $('#list').className = '';
    $('#list').innerHTML = articleTable(f ? list.filter((a) => a.status === f) : list, { showAuthors: true });
  };
  $('#filter').onchange = draw;
  draw();
}

/* ---------------- Editor ---------------- */
async function viewEditor(id) {
  shell(id ? 'mine' : 'new', `<div id="ed" class="p-loading">Loading…</div>`);
  const [a, dir, partners] = await Promise.all([
    id ? api('articles.get', { id }) : Promise.resolve({ status: 'draft', authorEmail: state.user.email, body: '' }),
    state.directory ? Promise.resolve(state.directory) : api('team.directory'),
    state.user.canApprove ? api('partners.options').catch(() => []) : Promise.resolve([])
  ]);
  state.directory = dir;
  const u = state.user;
  const isLead = a.authorEmail === u.email;
  const editable = u.canApprove || ['draft', 'changes_requested', 'rejected'].includes(a.status);
  const co = (a.coAuthors || '').split(',').map((s) => s.trim()).filter(Boolean);
  const cfg = state.config;
  const dis = editable ? '' : 'disabled';

  $('#ed').className = 'p-editor';
  $('#ed').innerHTML = `
  <div class="p-ed-main">
    <div class="p-ed-status">${badge(a.status)} <span class="muted small">${esc(a.id || 'New article')}</span>
      ${a.status === 'published' ? `<a class="small" href="/articles/${esc(a.slug)}" target="_blank" rel="noopener">View live ↗</a>` : ''}</div>
    ${a.reviewNote && ['changes_requested', 'rejected'].includes(a.status) ? `<div class="p-alert"><b>${a.status === 'rejected' ? 'Not accepted' : 'Changes requested'}:</b> ${esc(a.reviewNote)}</div>` : ''}
    ${a.aiGenerated ? `<div class="p-alert info"><b>AI-assisted draft.</b> Check every figure, name and quotation against its reference before approving. The AI disclosure is already filled in.
      ${a.aiReport ? `<details><summary>Reference check report</summary><pre class="p-pre">${esc(a.aiReport)}</pre></details>` : ''}</div>` : ''}
    ${!editable ? `<div class="p-alert info">${a.status === 'submitted' ? 'This article is with the Chair for approval. Withdraw the submission to edit it again.' : 'Published articles can only be edited by the Chair. Contact the Chair for corrections.'}</div>` : ''}
    <textarea id="f_title" class="p-ed-title" placeholder="Headline" rows="1" ${dis}>${esc(a.title || '')}</textarea>
    <textarea id="f_standfirst" class="p-ed-dek" placeholder="Standfirst: one or two sentences that tell the reader what this piece argues or reveals." rows="2" ${dis}>${esc(a.standfirst || '')}</textarea>
    <div class="p-toolbar" ${editable ? '' : 'hidden'}>
      <button data-cmd="formatBlock" data-val="p" title="Paragraph">¶</button>
      <button data-cmd="formatBlock" data-val="h2" title="Heading">H2</button>
      <button data-cmd="formatBlock" data-val="h3" title="Subheading">H3</button>
      <span class="sep"></span>
      <button data-cmd="bold" title="Bold"><b>B</b></button>
      <button data-cmd="italic" title="Italic"><i>I</i></button>
      <button data-cmd="link" title="Link">Link</button>
      <button data-cmd="unlink" title="Remove link">Unlink</button>
      <span class="sep"></span>
      <button data-cmd="insertUnorderedList" title="Bulleted list">• List</button>
      <button data-cmd="insertOrderedList" title="Numbered list">1. List</button>
      <button data-cmd="formatBlock" data-val="blockquote" title="Quote">“ Quote</button>
      <button data-cmd="insertHorizontalRule" title="Divider">—</button>
      <button data-cmd="image" title="Insert image">Image</button>
      <span class="sep"></span>
      <button data-cmd="removeFormat" title="Clear formatting">Clear</button>
    </div>
    <div id="f_body" class="article-body p-ed-body" ${editable ? 'contenteditable="true"' : ''} data-placeholder="Write your article…">${sanitizeHtml(a.body || '')}</div>
    <div class="p-ed-foot muted small"><span id="wc">0 words</span> · <span id="saveState">${a.updatedAt ? 'Last saved ' + fmt(a.updatedAt) : 'Not saved yet'}</span></div>
  </div>

  <aside class="p-ed-side">
    <div class="p-actions">
      ${editable ? `<button class="btn" id="saveBtn">${a.status === 'published' ? 'Save changes' : 'Save draft'}</button>` : ''}
      <button class="btn ghost" id="previewBtn">Preview</button>
      ${isLead && ['draft', 'changes_requested', 'rejected'].includes(a.status) ? '<button class="btn accent" id="submitBtn">Submit for approval</button>' : ''}
      ${isLead && a.status === 'submitted' ? '<button class="btn ghost" id="withdrawBtn">Withdraw submission</button>' : ''}
      ${a.id && !['published', 'withdrawn'].includes(a.status) && (u.canApprove || (isLead && a.status !== 'submitted')) ? '<button class="p-link danger" id="deleteBtn">Delete</button>' : ''}
    </div>

    ${u.canApprove && a.id ? reviewPanel(a) : ''}

    <div class="p-field"><label>Byline</label>
      <select id="f_byline" ${dis}>
        <option value="authors" ${a.byline !== 'abr' ? 'selected' : ''}>Named authors (you and co-authors)</option>
        <option value="abr" ${a.byline === 'abr' ? 'selected' : ''}>Curated by Ahmedabad Business Review</option>
      </select>
      <span class="muted small">“Curated” shows ABR as the author instead of a person. It still goes through the same review.</span></div>
    <div class="p-field"><label>Section</label>
      <select id="f_section" ${dis}><option value="">Choose…</option>${cfg.sections.map((s) => `<option ${s === a.section ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
    <div class="p-field"><label>Article type</label>
      <select id="f_type" ${dis}><option value="">Choose…</option>${cfg.types.map((s) => `<option ${s === a.type ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
    <div class="p-field"><label>Tags <span class="muted">(comma-separated)</span></label>
      <input id="f_tags" value="${esc(a.tags || '')}" placeholder="startups, Gujarat, fintech" ${dis}></div>

    <div class="p-field"><label>Cover image</label>
      <div class="p-cover" id="coverPrev">${a.coverUrl ? `<img src="${esc(a.coverUrl)}" alt="">` : '<span class="muted small">No image</span>'}</div>
      <div class="p-row">${editable ? '<button class="btn ghost sm" id="coverUpload">Upload</button><button class="p-link" id="coverClear">Remove</button>' : ''}</div>
      <input id="f_coverUrl" value="${esc(a.coverUrl || '')}" placeholder="or paste an https:// image URL" ${dis}>
      <input id="f_coverCaption" value="${esc(a.coverCaption || '')}" placeholder="Caption and credit, e.g. Photo: Name / Source" ${dis}></div>

    <div class="p-field"><label>Co-authors</label>
      <div class="p-checks">${dir.filter((d) => d.email !== a.authorEmail).map((d) => `<label class="p-check"><input type="checkbox" value="${esc(d.email)}" ${co.includes(d.email) ? 'checked' : ''} ${dis}> ${esc(d.name)} <span class="muted small">${esc(d.title)}</span></label>`).join('') || '<span class="muted small">No other team members yet.</span>'}</div></div>

    <div class="p-field"><label>References <span class="muted">(one per line; 2+ required for Analysis, Case Study, Research Brief and Explainer)</span></label>
      <textarea id="f_sources" rows="6" placeholder="Author/Organisation (Year, Month Day). Title. Publisher. https://…&#10;Reserve Bank of India (2026). Annual Report 2025-26. https://rbi.org.in/…" ${dis}>${esc(a.sources || '')}</textarea></div>
    <div class="p-field"><label>Disclosure <span class="muted">(conflicts of interest, if any)</span></label>
      <textarea id="f_disclosure" rows="2" placeholder="e.g. The author interned at the company discussed." ${dis}>${esc(a.disclosure || '')}</textarea></div>

    ${a.contributor ? `<div class="p-field"><label>Outside contributor</label>
      <div class="p-contrib"><b>${esc(a.contributor.name)}</b><br><a href="mailto:${esc(a.contributor.email)}">${esc(a.contributor.email)}</a>
      ${a.contributor.affiliation ? `<br>${esc(a.contributor.affiliation)}` : ''}${a.contributor.bio ? `<p class="small">${esc(a.contributor.bio)}</p>` : ''}</div>
      <span class="muted small">Submitted through “Write for ABR”. Decisions and notes are emailed to them automatically.</span></div>` : ''}
    ${a.status === 'published' && u.canApprove ? `<div class="p-field p-chair"><label>DOI <span class="muted">(Zenodo)</span></label>
      ${a.doi ? `<div><code>${esc(a.doi)}</code> ${a.doiState === 'published' ? '<span class="p-badge s-published">Registered</span>' : '<span class="p-badge s-submitted">Reserved</span>'}</div>` : '<div class="muted small">No DOI yet.</div>'}
      ${a.doiError ? `<div class="p-note-inline">Last error: ${esc(a.doiError)}</div>` : ''}
      ${a.doiState !== 'published' ? '<button class="btn ghost sm" id="doiBtn">Register DOI</button>' : ''}</div>` : ''}
    ${a.issueKey ? `<div class="p-field"><label>Issue</label><div>${esc(a.issueKey.replace(/^v(\d+)n(\d+)$/, 'Vol. $1, No. $2'))} · <a href="#/issues">Issues</a></div></div>` : ''}
    ${(a.timeline || []).length ? `<div class="p-field"><label>History</label><ol class="p-timeline">${a.timeline.map((t) => `<li><span class="small muted">${fmt(t.at)}</span><b>${esc(t.label)}</b>${t.by ? ` <span class="small muted">· ${esc(t.by)}</span>` : ''}${t.note ? `<div class="small">${esc(t.note)}</div>` : ''}</li>`).join('')}</ol></div>` : ''}
    ${u.canApprove ? `
    <div class="p-field p-chair"><label>Partnership <span class="muted">(Chair)</span></label>
      <select id="f_partnerType">
        <option value="" ${!a.partnerType ? 'selected' : ''}>None: independent ABR article</option>
        <option value="partner" ${a.partnerType === 'partner' ? 'selected' : ''}>In partnership with…</option>
        <option value="promoted" ${a.partnerType === 'promoted' ? 'selected' : ''}>Promoted · Supported by…</option>
      </select>
      <select id="f_partnerSlug"><option value="">Choose partner…</option>${partners.map((x) => `<option value="${esc(x.slug)}" ${x.slug === a.partnerSlug ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <span class="muted small">${partners.length ? 'Promoted articles are labelled, their links marked sponsored, and they are left out of Google Scholar.' : 'Add partners on the Partners page first.'}</span></div>
    ${a.status !== 'published' && a.status !== 'withdrawn' ? `<div class="p-field p-chair"><label>Original publication date <span class="muted">(only for back-issue articles; leave blank to use the approval date)</span></label>
      <input id="f_publishedDate" type="date" value="${esc((a.publishedAt || '').slice(0, 10))}"></div>` : ''}
    <div class="p-field p-chair"><label>URL slug <span class="muted">(Chair; locked once published)</span></label>
      <input id="f_slug" value="${esc(a.slug || '')}" placeholder="auto from headline" ${a.status === 'published' || a.status === 'withdrawn' ? 'disabled' : ''}></div>
    ${a.status === 'published' ? `
    <div class="p-field p-chair"><label>Correction notice <span class="muted">(shown publicly)</span></label>
      <textarea id="f_correction" rows="3" placeholder="An earlier version of this article misstated…">${esc(a.correction || '')}</textarea>
      <label class="p-check"><input type="checkbox" id="f_markUpdated"> Show an “Updated” date on this save</label></div>` : ''}` : ''}
  </aside>`;

  setupEditor(a, editable);
  const doiBtn = $('#doiBtn');
  if (doiBtn) doiBtn.onclick = (e) => busy(e.target, async () => { await api('doi.queue', { id: a.id }); toast('Queued: the DOI is registered within about 15 minutes', 'ok'); }).catch(() => {});
}

function reviewPanel(a) {
  if (a.status === 'submitted') {
    return `<div class="p-review">
      <h3>Chair review</h3>
      <textarea id="reviewNote" rows="3" placeholder="Note to the author (required for changes or rejection)"></textarea>
      <div class="p-row wrap">
        <button class="btn accent" data-decide="approve">Approve &amp; publish</button>
        <button class="btn ghost" data-decide="changes">Request changes</button>
        <button class="p-link danger" data-decide="reject">Reject</button>
      </div>
    </div>`;
  }
  if (a.status === 'published') {
    return `<div class="p-review"><h3>Published</h3><p class="small muted">${fmt(a.publishedAt)}${a.modifiedAt ? ' · updated ' + fmt(a.modifiedAt) : ''}</p>
      <button class="p-link danger" id="unpublishBtn">Withdraw article…</button></div>`;
  }
  if (['draft', 'changes_requested', 'withdrawn', 'rejected'].includes(a.status)) {
    return `<div class="p-review"><h3>Chair</h3><p class="small muted">${a.status === 'withdrawn' ? 'Republish this withdrawn article.' : 'You can publish this directly without the approval step.'}</p>
      <button class="btn ghost" data-decide="approve">${a.status === 'withdrawn' ? 'Republish' : 'Publish now'}</button></div>`;
  }
  return '';
}

function setupEditor(a, editable) {
  const body = $('#f_body');
  const title = $('#f_title');
  const autosize = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
  [title, $('#f_standfirst')].forEach((el) => { autosize(el); el.addEventListener('input', () => autosize(el)); });

  const updateWc = () => { $('#wc').textContent = `${words(body.innerHTML)} words · ~${Math.max(1, Math.round(words(body.innerHTML) / 220))} min read`; };
  updateWc();

  const markDirty = () => { state.dirty = true; $('#saveState').textContent = 'Unsaved changes'; };
  $$('#ed input, #ed textarea, #ed select').forEach((el) => {
    if (el.id === 'reviewNote') return;
    el.addEventListener('input', markDirty);
    el.addEventListener('change', markDirty);
  });

  if (editable) {
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
    body.addEventListener('input', () => { markDirty(); updateWc(); });
    body.addEventListener('paste', (e) => {
      e.preventDefault();
      const cd = e.clipboardData;
      const html = cd.getData('text/html');
      if (html) {
        document.execCommand('insertHTML', false, sanitizeHtml(html));
      } else {
        const text = cd.getData('text/plain');
        const paras = text.split(/\r?\n\s*\r?\n/).map((p) => `<p>${esc(p).replace(/\r?\n/g, '<br>')}</p>`).join('');
        document.execCommand('insertHTML', false, paras);
      }
    });
    if (!body.innerHTML.trim()) body.innerHTML = '<p><br></p>';

    $$('.p-toolbar button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    $$('.p-toolbar button').forEach((b) => b.addEventListener('click', async () => {
      body.focus();
      const cmd = b.dataset.cmd;
      if (cmd === 'link') {
        const url = prompt('Link address (https://…)');
        if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) document.execCommand('createLink', false, url.trim());
        else if (url) toast('Links must start with https:// or mailto:', 'err');
      } else if (cmd === 'image') {
        const sel = window.getSelection();
        const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        const file = await pickFile();
        if (!file) return;
        toast('Uploading image…');
        try {
          const url = await uploadImage(file);
          const cap = prompt('Caption and credit (optional)') || '';
          body.focus();
          if (range) { sel.removeAllRanges(); sel.addRange(range); }
          document.execCommand('insertHTML', false, `<figure><img src="${esc(url)}" alt="${esc(cap)}">${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}</figure><p><br></p>`);
          toast('Image added', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      } else if (cmd === 'formatBlock') {
        document.execCommand('formatBlock', false, b.dataset.val);
      } else {
        document.execCommand(cmd, false, null);
      }
      markDirty(); updateWc();
    }));

    const coverUp = $('#coverUpload');
    if (coverUp) coverUp.onclick = async () => {
      const file = await pickFile();
      if (!file) return;
      await busy(coverUp, async () => {
        const url = await uploadImage(file);
        $('#f_coverUrl').value = url;
        $('#coverPrev').innerHTML = `<img src="${esc(url)}" alt="">`;
        markDirty();
      }).catch(() => {});
    };
    const coverClear = $('#coverClear');
    if (coverClear) coverClear.onclick = () => { $('#f_coverUrl').value = ''; $('#coverPrev').innerHTML = '<span class="muted small">No image</span>'; markDirty(); };
    $('#f_coverUrl').addEventListener('change', () => {
      const v = $('#f_coverUrl').value.trim();
      $('#coverPrev').innerHTML = /^https:\/\//.test(v) ? `<img src="${esc(v)}" alt="">` : '<span class="muted small">No image</span>';
    });
  }

  const collect = () => {
    const p = {
      title: title.value, standfirst: $('#f_standfirst').value,
      section: $('#f_section').value, type: $('#f_type').value, tags: $('#f_tags').value, byline: $('#f_byline').value,
      coverUrl: $('#f_coverUrl').value, coverCaption: $('#f_coverCaption').value,
      sources: $('#f_sources').value, disclosure: $('#f_disclosure').value,
      coAuthors: $$('.p-checks input:checked').map((c) => c.value).join(', '),
      body: sanitizeHtml(body.innerHTML)
    };
    if (a.id) p.id = a.id;
    if ($('#f_slug') && !$('#f_slug').disabled) p.slug = $('#f_slug').value;
    if ($('#f_correction')) p.correction = $('#f_correction').value;
    if ($('#f_publishedDate')) p.publishedDate = $('#f_publishedDate').value;
    if ($('#f_markUpdated')) p.markUpdated = $('#f_markUpdated').checked;
    if ($('#f_partnerType')) { p.partnerType = $('#f_partnerType').value; p.partnerSlug = $('#f_partnerSlug').value; }
    return p;
  };

  const save = async () => {
    const saved = await api('articles.save', collect());
    state.dirty = false;
    $('#saveState').textContent = 'Saved ' + fmt(saved.updatedAt);
    if (!a.id) { a.id = saved.id; history.replaceState(null, '', '#/edit/' + saved.id); lastHash = location.hash; }
    return saved;
  };

  const saveBtn = $('#saveBtn');
  if (saveBtn) saveBtn.onclick = () => busy(saveBtn, async () => {
    const wasNew = !a.id;
    const s = await save();
    toast('Saved', 'ok');
    if (wasNew) viewEditor(s.id);
  }).catch(() => {});

  // Autosave drafts every 60 seconds.
  clearInterval(state.autosave);
  if (editable && a.status !== 'published') {
    state.autosave = setInterval(() => {
      if (state.dirty && title.value.trim() && document.body.contains(body)) {
        save().then(() => ($('#saveState').textContent = 'Autosaved ' + fmt(new Date().toISOString()))).catch(() => {});
      }
    }, 60000);
  }

  $('#previewBtn').onclick = () => preview(collect(), a);

  const submitBtn = $('#submitBtn');
  if (submitBtn) submitBtn.onclick = () => busy(submitBtn, async () => {
    if (!title.value.trim()) throw new Error('Add a headline first.');
    if (!confirm('Submit this article to the Chair for approval? You won’t be able to edit it while it is under review.')) return;
    const s = await save();
    await api('articles.submit', { id: s.id });
    toast('Submitted for approval', 'ok');
    viewEditor(s.id);
  }).catch(() => {});

  const withdrawBtn = $('#withdrawBtn');
  if (withdrawBtn) withdrawBtn.onclick = () => busy(withdrawBtn, async () => {
    await api('articles.withdraw', { id: a.id });
    toast('Submission withdrawn. It is a draft again.', 'ok');
    viewEditor(a.id);
  }).catch(() => {});

  const deleteBtn = $('#deleteBtn');
  if (deleteBtn) deleteBtn.onclick = () => {
    if (!confirm('Delete this article permanently?')) return;
    busy(deleteBtn, async () => {
      await api('articles.delete', { id: a.id });
      state.dirty = false;
      toast('Deleted', 'ok');
      go('#/');
    }).catch(() => {});
  };

  $$('[data-decide]').forEach((btn) => btn.onclick = () => busy(btn, async () => {
    const decision = btn.dataset.decide;
    const note = $('#reviewNote') ? $('#reviewNote').value.trim() : '';
    if (decision !== 'approve' && !note) throw new Error('Add a note for the author.');
    if (decision === 'approve' && !confirm('Publish this article on the public site now?')) return;
    if (state.dirty) await save();
    await api('review.decide', { id: a.id, decision, note });
    toast(decision === 'approve' ? 'Published' : decision === 'changes' ? 'Sent back for changes' : 'Rejected', 'ok');
    viewEditor(a.id);
  }).catch(() => {}));

  const unpub = $('#unpublishBtn');
  if (unpub) unpub.onclick = () => {
    const reason = prompt('Withdraw this article from the site.\n\nThe URL will show a public withdrawal notice with this reason:');
    if (!reason || !reason.trim()) return;
    busy(unpub, async () => {
      await api('review.unpublish', { id: a.id, reason: reason.trim() });
      toast('Article withdrawn', 'ok');
      viewEditor(a.id);
    }).catch(() => {});
  };
}

function preview(p, a) {
  const names = [state.directory.find((d) => d.email === a.authorEmail)?.name || state.user.name,
    ...p.coAuthors.split(',').map((e) => e.trim()).filter(Boolean).map((e) => state.directory.find((d) => d.email === e)?.name || e)];
  const sources = p.sources.split('\n').map((s) => s.trim()).filter(Boolean);
  const m = document.createElement('div');
  m.className = 'p-modal';
  m.innerHTML = `<div class="p-modal-box">
    <button class="p-modal-x" aria-label="Close preview">×</button>
    <div class="article">
      <header class="article-head narrow">
        <div class="kicker">${esc(p.section || 'Section')}<span class="type">${esc(p.type || 'Type')}</span></div>
        <h1 class="article-title">${esc(p.title || 'Headline')}</h1>
        <p class="standfirst">${esc(p.standfirst)}</p>
        <div class="byline"><div>${p.byline === 'abr' ? 'Curated by <a>Ahmedabad Business Review</a>' : `By <a>${names.map(esc).join(' and ')}</a>`}</div><div class="dates">Preview · ${words(p.body)} words</div></div>
        ${p.type === 'Opinion' ? '<p class="notice">Opinion: the views expressed are the author’s own.</p>' : ''}
      </header>
      ${p.coverUrl ? `<figure class="cover"><img src="${esc(p.coverUrl)}" alt="">${p.coverCaption ? `<figcaption>${esc(p.coverCaption)}</figcaption>` : ''}</figure>` : ''}
      <div class="article-body narrow">${sanitizeHtml(p.body)}</div>
      <footer class="article-foot narrow">
        ${p.correction ? `<aside class="box correction"><h2>Correction</h2><p>${esc(p.correction)}</p></aside>` : ''}
        ${p.disclosure ? `<aside class="box"><h2>Disclosure</h2><p>${esc(p.disclosure)}</p></aside>` : ''}
        ${sources.length ? `<section class="sources"><h2>References</h2><ol>${sources.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>` : ''}
      </footer>
    </div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  $('.p-modal-x', m).onclick = close;
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
}

/* ---------------- Team ---------------- */
async function viewTeam() {
  shell('team', `<header class="p-head"><h1>Team</h1></header>
  <form id="addForm" class="p-card p-inline-form">
    <h3>Add a team member</h3>
    <div class="p-grid4">
      <input name="name" placeholder="Full name" required>
      <input name="email" type="email" placeholder="Email" required>
      <select name="role">${Object.entries(state.config.roles).map(([k, v]) => `<option value="${k}" ${k === 'editor' ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <input name="title" placeholder="Public title (optional), e.g. Section Editor, Business">
    </div>
    <label class="small" id="addTermWrap" hidden>Term ends on <input type="date" name="termEnd"> <span class="muted">Required for Editor-in-Chief and COO. When the term ends they receive a certificate of service and become an Editor unless re-appointed.</span></label>
    <button class="btn" type="submit">Add member</button>
  </form>
  <div id="tempBox"></div>
  <div id="list" class="p-loading">Loading…</div>`);

  const showTemp = (email, pw) => {
    $('#tempBox').innerHTML = `<div class="p-alert ok">Temporary password for <b>${esc(email)}</b>: <code>${esc(pw)}</code><br><span class="small">A branded welcome email with these details has been sent or queued. If it doesn’t arrive, share the password privately. They must change it and sign the team agreement on first login.</span></div>`;
  };

  const draw = async () => {
    const [list, agr] = await Promise.all([api('team.list'), api('agreement.list').catch(() => [])]);
    const agrBy = Object.fromEntries(agr.map((x) => [x.email, x]));
    state.directory = null;
    $('#list').className = '';
    const today = new Date().toISOString().slice(0, 10);
    const vacant = TERM_ROLES.filter((r) => !list.some((m) => m.active && m.role === r));
    $('#list').innerHTML = (vacant.length ? `<div class="p-alert">${vacant.map((r) => esc(state.config.roles[r])).join(' and ')} ${vacant.length > 1 ? 'are' : 'is'} vacant. Appoint someone by changing their role below and setting a term end date.</div>` : '') +
    `<table class="p-table"><thead><tr><th>Name</th><th>Role</th><th>Term ends</th><th>Public title</th><th>Status</th><th>Agreement</th><th>Two-factor</th><th></th></tr></thead><tbody>
    ${list.map((m) => `<tr data-email="${esc(m.email)}" data-role="${esc(m.role)}">
      <td><b>${esc(m.name)}</b><div class="muted small">${esc(m.email)}</div></td>
      <td><select class="p-select sm r-role" ${m.email === state.user.email ? 'disabled' : ''}>${Object.entries(state.config.roles).map(([k, v]) => `<option value="${k}" ${k === m.role ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></td>
      <td class="small"><input type="date" class="p-input sm r-term" value="${esc(m.termEnd || '')}" ${TERM_ROLES.includes(m.role) ? '' : 'hidden'}>
        ${m.termEnd ? `<div class="muted">${(() => { const d = Math.round((new Date(m.termEnd) - new Date(today)) / 864e5); return d >= 0 ? d + ' days left' : 'ended'; })()}${m.termStart ? ' · since ' + esc(m.termStart) : ''}</div>` : TERM_ROLES.includes(m.role) ? '<span class="muted">No end date</span>' : ''}</td>
      <td><input class="p-input sm r-title" value="${esc(m.title)}"></td>
      <td>${m.active ? '<span class="p-badge s-published">Active</span>' : '<span class="p-badge s-rejected">Disabled</span>'}</td>
      <td class="small">${(() => { const g = agrBy[m.email]; if (!g) return '—'; if (g.exempt) return '<span class="muted">Not required</span>';
        return g.signed ? `<span class="p-badge s-published">Signed</span> ${fmt(g.signedAt)}${g.fileUrl ? ` · <a href="${esc(g.fileUrl)}" target="_blank" rel="noopener">PDF ↗</a>` : ''}` : '<span class="p-badge s-submitted">Pending</span>'; })()}</td>
      <td class="small">${m.tfaEnabled ? `<span class="p-badge s-published">On</span> <span class="muted">${m.backupCodesLeft} backup codes</span>` : '<span class="p-badge s-submitted">Not set up</span><div class="muted">Asked at next sign-in</div>'}</td>
      <td><div class="p-row">
        <button class="btn ghost sm r-save">Save</button>
        <button class="p-link r-reset">Reset password</button>
        ${m.tfaEnabled && m.email !== state.user.email ? '<button class="p-link r-tfa">Reset two-factor</button>' : ''}
        ${m.email !== state.user.email ? `<button class="p-link ${m.active ? 'danger' : ''} r-toggle" data-active="${m.active ? 1 : 0}">${m.active ? 'Disable' : 'Enable'}</button>` : ''}
      </div></td></tr>`).join('')}</tbody></table>`;

    $$('#list tr[data-email]').forEach((tr) => {
      const email = tr.dataset.email;
      const name = $('b', tr).textContent;
      $('.r-role', tr).onchange = () => { $('.r-term', tr).hidden = !TERM_ROLES.includes($('.r-role', tr).value); };
      $('.r-save', tr).onclick = (e) => busy(e.target, async () => {
        const role = $('.r-role', tr).value;
        await api('team.save', { email, name, role, title: role !== tr.dataset.role ? '' : $('.r-title', tr).value,
          termEnd: TERM_ROLES.includes(role) ? $('.r-term', tr).value : '' });
        toast('Saved', 'ok');
        draw();
      }).catch(() => {});
      $('.r-reset', tr).onclick = (e) => {
        if (!confirm(`Reset the password for ${email}?`)) return;
        busy(e.target, async () => { const r = await api('team.resetPassword', { email }); showTemp(email, r.tempPassword); }).catch(() => {});
      };
      const tf = $('.r-tfa', tr);
      if (tf) tf.onclick = (e) => { if (confirm(`Reset two-factor sign-in for ${name}? Do this only if they have lost their phone and backup codes. They will set it up again at their next sign-in.`)) busy(e.target, async () => { await api('team.reset2fa', { email }); toast('Two-factor reset', 'ok'); draw(); }).catch(() => {}); };
      const t = $('.r-toggle', tr);
      if (t) t.onclick = (e) => busy(e.target, async () => {
        await api('team.save', { email, name, role: $('.r-role', tr).value, title: $('.r-title', tr).value, active: t.dataset.active !== '1' });
        draw();
      }).catch(() => {});
    });
  };

  $('#addForm').role.onchange = (e) => { $('#addTermWrap').hidden = !TERM_ROLES.includes(e.target.value); };
  $('#addForm').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    busy($('button', f), async () => {
      const r = await api('team.save', { name: f.name.value, email: f.email.value, role: f.role.value, title: f.title.value, termEnd: f.termEnd.value });
      if (r.tempPassword) showTemp(r.email, r.tempPassword);
      f.reset();
      draw();
    }).catch(() => {});
  };
  draw();
}

/* ---------------- Profile ---------------- */
function viewProfile() {
  const u = state.user;
  shell('profile', `<header class="p-head"><h1>My profile</h1><a href="/authors/${esc(u.slug)}" target="_blank" rel="noopener">Public author page ↗</a></header>
  <div class="p-two">
    <form id="profForm" class="p-card">
      <h3>Author details</h3>
      <p class="muted small">Shown on your author page and at the end of every article you write. A clear bio with your background builds reader trust.</p>
      <div class="p-photo"><span id="photoPrev">${u.photoUrl ? `<img src="${esc(u.photoUrl)}" class="avatar lg" alt="">` : `<span class="avatar lg ph">${esc(u.name[0])}</span>`}</span>
        <button type="button" class="btn ghost sm" id="photoUp">Upload photo</button></div>
      <input type="hidden" name="photoUrl" value="${esc(u.photoUrl || '')}">
      <label>Full name (as it should appear in citations)<input name="name" value="${esc(u.name)}" required></label>
      <label>Bio <span class="muted">(2 to 3 sentences, third person)</span><textarea name="bio" rows="5" maxlength="1200">${esc(u.bio || '')}</textarea></label>
      <p class="muted small">Role: ${esc(u.title)} · ${esc(u.email)}</p>
      <button class="btn" type="submit">Save profile</button>
    </form>
    <form id="tfaCodes" class="p-card">
      <h3>Two-factor sign-in</h3>
      <p class="small">${u.tfaEnabled ? `On since ${fmt(u.tfaSince)}. You have <b>${u.backupCodesLeft}</b> unused backup codes.` : 'Not set up.'}</p>
      <p class="muted small">Make new backup codes if you have used most of yours or think they were seen. Your old codes stop working.</p>
      <label>Current code from your authenticator app<input name="code" inputmode="numeric" maxlength="6" required></label>
      <button class="btn ghost" type="submit">Make new backup codes</button>
    </form>
    <form id="pwForm" class="p-card">
      <h3>Change password</h3>
      <label>Current password<input type="password" name="current" required autocomplete="current-password"></label>
      <label>New password (8+ characters)<input type="password" name="next" required minlength="8" autocomplete="new-password"></label>
      <button class="btn" type="submit">Change password</button>
    </form>
  </div>`);

  $('#photoUp').onclick = async (e) => {
    const file = await pickFile();
    if (!file) return;
    busy(e.target, async () => {
      const url = await uploadImage(file);
      $('#profForm').photoUrl.value = url;
      $('#photoPrev').innerHTML = `<img src="${esc(url)}" class="avatar lg" alt="">`;
    }).catch(() => {});
  };
  $('#profForm').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    busy($('button[type=submit]', f), async () => {
      state.user = { ...state.user, ...(await api('profile.update', { name: f.name.value, bio: f.bio.value, photoUrl: f.photoUrl.value })) };
      toast('Profile saved', 'ok');
    }).catch(() => {});
  };
  $('#tfaCodes').onsubmit = (e) => {
    e.preventDefault();
    busy($('button', e.target), async () => { const r = await api('auth.2fa.backupCodes', { code: e.target.code.value }); state.user.backupCodesLeft = r.backupCodes.length; e.target.reset(); showBackupCodes(r.backupCodes, false); }).catch(() => {});
  };
  $('#pwForm').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    busy($('button', f), async () => {
      await api('auth.changePassword', { current: f.current.value, next: f.next.value });
      f.reset();
      toast('Password changed', 'ok');
    }).catch(() => {});
  };
}

/* =========================================================
   Team agreement (shown on first login until signed)
   ========================================================= */
async function viewAgreement() {
  app().innerHTML = `<div class="p-agree"><div class="p-card p-agree-card">
    <div class="p-login-brand"><img src="/brand/logo/horizontal/ABR-Horizontal-Black.svg" alt="Ahmedabad Business Review" style="width:280px"><span class="p-login-sub">Team agreement</span></div>
    <div id="agr" class="p-loading">Loading…</div></div></div>`;
  let a;
  try { a = await api('agreement.get'); } catch (e) { $('#agr').textContent = e.message; return; }
  if (a.signed || a.exempt) { state.user.needsAgreement = false; return render(); }
  $('#agr').className = '';
  $('#agr').innerHTML = `
    <p>Welcome, <b>${esc(state.user.name)}</b>. Before you start, please read and sign the ABR team agreement (version ${esc(a.version)}). It covers confidentiality and the ownership of work you create for ABR.</p>
    <div class="p-agree-text">${a.html}</div>
    <form id="signForm">
      <label class="p-check"><input type="checkbox" name="agree"> I have read this agreement and agree to its terms.</label>
      <label>Type your full name to sign <span class="muted">(${esc(state.user.name)})</span><input name="signature" autocomplete="off" class="p-sig" spellcheck="false"></label>
      <button class="btn p-wide" type="submit">Sign agreement</button>
      <p class="muted small">Your typed name, the time and your IP address are recorded as your electronic signature. You’ll get a signed PDF copy by email.</p>
      <button type="button" class="p-link" id="agrLogout">Log out</button>
    </form>`;
  $('#agrLogout').onclick = async () => { try { await api('auth.logout'); } catch {} clearSession(); go('#/login'); };
  $('#signForm').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    busy($('button[type=submit]', f), async () => {
      if (!f.agree.checked) throw new Error('Tick the box to confirm you agree.');
      await api('agreement.sign', { agree: true, signature: f.signature.value });
      state.user.needsAgreement = false;
      toast('Agreement signed. Welcome to ABR!', 'ok');
      go('#/');
    }).catch(() => {});
  };
}

/* =========================================================
   Mini rich-text editor (used for emails)
   ========================================================= */
function miniEditor(host, html = '') {
  host.innerHTML = `<div class="p-toolbar">
      <button data-cmd="formatBlock" data-val="p">¶</button><button data-cmd="formatBlock" data-val="h2">H2</button>
      <button data-cmd="formatBlock" data-val="h3">H3</button><span class="sep"></span>
      <button data-cmd="bold"><b>B</b></button><button data-cmd="italic"><i>I</i></button>
      <button data-cmd="link">Link</button><span class="sep"></span>
      <button data-cmd="insertUnorderedList">• List</button><button data-cmd="insertOrderedList">1. List</button>
      <button data-cmd="formatBlock" data-val="blockquote">“ Quote</button><button data-cmd="image">Image</button>
    </div>
    <div class="p-mini-body" contenteditable="true">${sanitizeHtml(html) || '<p><br></p>'}</div>`;
  const body = $('.p-mini-body', host);
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
  body.addEventListener('paste', (e) => {
    e.preventDefault();
    const h = e.clipboardData.getData('text/html');
    const t = e.clipboardData.getData('text/plain');
    document.execCommand('insertHTML', false, h ? sanitizeHtml(h) : t.split(/\r?\n\s*\r?\n/).map((p) => `<p>${esc(p)}</p>`).join(''));
  });
  $$('.p-toolbar button', host).forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', async () => {
      body.focus();
      const cmd = b.dataset.cmd;
      if (cmd === 'link') {
        const url = prompt('Link address (https://…)');
        if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) document.execCommand('createLink', false, url.trim());
      } else if (cmd === 'image') {
        const file = await pickFile();
        if (!file) return;
        toast('Uploading image…');
        try { const url = await uploadImage(file); body.focus(); document.execCommand('insertHTML', false, `<img src="${esc(url)}" alt=""><p><br></p>`); }
        catch (e) { toast(e.message, 'err'); }
      } else if (cmd === 'formatBlock') document.execCommand('formatBlock', false, b.dataset.val);
      else document.execCommand(cmd, false, null);
    });
  });
  return { get: () => sanitizeHtml(body.innerHTML) };
}

function statusBar(st) {
  const pct = Math.min(100, Math.round((st.sentToday / Math.max(1, st.dailyLimit)) * 100));
  return `<div class="p-mailbar">
    <div><span class="muted small">Sent today</span><b>${st.sentToday} / ${st.dailyLimit}</b><div class="p-meter"><span style="width:${pct}%"></span></div></div>
    <div><span class="muted small">Waiting in queue</span><b>${st.waiting}</b></div>
    <div><span class="muted small">Failed</span><b>${st.failed}</b></div>
    <div><span class="muted small">Newsletters via</span><b>${esc(st.routeBulk)}</b></div>
    <div><span class="muted small">System emails via</span><b>${esc(st.routeTx)}</b></div>
    <div><span class="muted small">From</span><b>${esc(st.fromAddress)}</b></div>
  </div>${st.triggerOn ? '' : '<div class="p-alert">The background sender is off, so queued emails won’t go out. The Chair can start it under Settings → Email sending.</div>'}`;
}

/* =========================================================
   Email: compose + history
   ========================================================= */
async function viewMail() {
  shell('mail', `<header class="p-head"><h1>Email</h1></header><div id="mailbar"></div>
  <div class="p-tabs"><button class="on" data-tab="compose">Compose</button><button data-tab="history">Sent campaigns</button></div>
  <div id="tab" class="p-loading">Loading…</div>`);
  const [st, subs, dir, arts] = await Promise.all([api('mail.status'), api('subs.list'), api('team.directory'), api('mail.articles')]);
  $('#mailbar').innerHTML = statusBar(st);

  const compose = () => {
    $('#tab').className = 'p-compose';
    $('#tab').innerHTML = `
    <div class="p-card">
      <h3>1. Who is it for?</h3>
      <div class="p-aud">
        <label class="p-check"><input type="checkbox" name="aud" value="subscribers"> Newsletter subscribers <span class="muted small">(${subs.counts.active} active)</span></label>
        <label class="p-check"><input type="checkbox" name="aud" value="team"> Whole ABR team <span class="muted small">(${dir.length})</span></label>
        <label class="p-check"><input type="checkbox" name="aud" value="editors"> Editors <span class="muted small">(Editor-in-Chief and editors)</span></label>
        <label class="p-check"><input type="checkbox" name="aud" value="coo"> COO</label>
      </div>
      <details class="p-details"><summary>Or choose specific team members</summary>
        <div class="p-checks">${dir.map((d) => `<label class="p-check"><input type="checkbox" name="custom" value="${esc(d.email)}"> ${esc(d.name)} <span class="muted small">${esc(d.title)}</span></label>`).join('')}</div>
      </details>
    </div>
    <div class="p-card">
      <h3>2. Message</h3>
      <label>Subject<input id="m_subject" maxlength="200" placeholder="e.g. This week at ABR: Gujarat’s start-up capital"></label>
      <label>Preview text <span class="muted">(shown after the subject in most inboxes)</span><input id="m_pre" maxlength="150"></label>
      <label>Heading inside the email<input id="m_heading" maxlength="150"></label>
      <label>Message <span class="muted">(you can use {{first_name}})</span></label>
      <div id="m_body" class="p-mini"></div>
      <div class="p-grid2">
        <label>Button text <span class="muted">(optional)</span><input id="m_btn" maxlength="40" placeholder="Read the article"></label>
        <label>Button link<input id="m_url" placeholder="https://theabr.in/articles/…"></label>
      </div>
    </div>
    <div class="p-card">
      <h3>3. Feature articles <span class="muted small">(optional)</span></h3>
      <div class="p-checks tall">${arts.map((a) => `<label class="p-check"><input type="checkbox" name="art" value="${esc(a.slug)}"> <span><b>${esc(a.title)}</b><br><span class="muted small">${esc(a.section)} · ${esc((a.authors || []).map((x) => x.name).join(', '))}</span></span></label>`).join('') || '<span class="muted small">No published articles yet.</span>'}</div>
    </div>
    <div class="p-row p-sendrow">
      <button class="btn ghost" id="m_preview">Preview</button>
      <button class="btn ghost" id="m_test">Send test to me</button>
      <button class="btn" id="m_send">Send</button>
    </div>`;
    const ed = miniEditor($('#m_body'));
    const collect = () => ({
      audience: $$('input[name=aud]:checked').map((c) => c.value),
      custom: $$('input[name=custom]:checked').map((c) => c.value),
      subject: $('#m_subject').value.trim(), preheader: $('#m_pre').value.trim(), heading: $('#m_heading').value.trim(),
      body: ed.get(), buttonLabel: $('#m_btn').value.trim(), buttonUrl: $('#m_url').value.trim(),
      articles: $$('input[name=art]:checked').map((c) => c.value)
    });
    $('#m_preview').onclick = (e) => busy(e.target, async () => {
      const r = await api('mail.preview', collect());
      const m = document.createElement('div');
      m.className = 'p-modal';
      m.innerHTML = `<div class="p-modal-box email"><button class="p-modal-x" aria-label="Close">×</button><iframe title="Email preview"></iframe></div>`;
      document.body.appendChild(m);
      $('iframe', m).srcdoc = r.html;
      $('.p-modal-x', m).onclick = () => m.remove();
      m.addEventListener('click', (ev) => { if (ev.target === m) m.remove(); });
    }).catch(() => {});
    $('#m_test').onclick = (e) => busy(e.target, async () => {
      const r = await api('mail.test', collect());
      toast('Test sent to ' + r.to, 'ok');
    }).catch(() => {});
    $('#m_send').onclick = (e) => {
      const p = collect();
      if (!p.audience.length && !p.custom.length) return toast('Choose who the email is for.', 'err');
      const who = [...p.audience.map((a) => ({ subscribers: 'all active subscribers', team: 'the whole team', editors: 'editors', coo: 'the COO' }[a])),
        ...(p.custom.length ? [`${p.custom.length} chosen member(s)`] : [])].join(', ');
      if (!confirm(`Send “${p.subject || '(no subject)'}” to ${who}?\n\nEmails go out within your daily limit; the rest are sent automatically over the following days.`)) return;
      busy(e.target, async () => {
        const r = await api('mail.send', p);
        $('#mailbar').innerHTML = statusBar(r);
        toast(`Queued for ${r.recipients} recipient(s)`, 'ok');
        switchTab('history');
      }).catch(() => {});
    };
  };

  const history = async () => {
    $('#tab').className = 'p-loading';
    $('#tab').textContent = 'Loading…';
    const list = await api('mail.campaigns');
    $('#tab').className = '';
    $('#tab').innerHTML = list.length ? `<table class="p-table"><thead><tr><th>Subject</th><th>Audience</th><th>Created</th><th>Recipients</th><th>Sent</th><th>Waiting</th><th>Failed</th><th></th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><b>${esc(c.subject)}</b><div class="muted small">${esc(c.id)} · ${esc(c.createdBy)}</div></td><td class="small">${esc(c.audience)}</td><td class="small">${fmt(c.createdAt)}</td>
        <td>${c.total}</td><td>${c.sent}</td><td>${c.waiting}</td><td>${c.failed ? `<b class="danger-t">${c.failed}</b>` : 0}</td>
        <td>${c.failed ? `<button class="p-link" data-retry="${esc(c.id)}">Retry failed</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="p-empty">No campaigns sent yet.</div>';
    $$('[data-retry]').forEach((b) => b.onclick = () => busy(b, async () => {
      const r = await api('mail.retry', { campaignId: b.dataset.retry });
      toast(`${r.requeued} email(s) queued again`, 'ok');
      history();
    }).catch(() => {}));
  };

  const switchTab = (t) => {
    $$('.p-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    if (t === 'compose') compose(); else history();
  };
  $$('.p-tabs button').forEach((b) => b.onclick = () => switchTab(b.dataset.tab));
  compose();
}

/* =========================================================
   Subscribers
   ========================================================= */
async function viewSubscribers() {
  shell('subs', `<header class="p-head"><h1>Subscribers</h1><button class="btn ghost" id="csv">Export CSV</button></header>
  <div id="subcounts"></div>
  <form id="subAdd" class="p-card p-inline-form">
    <h3>Add a subscriber</h3>
    <div class="p-grid3"><input name="email" type="email" placeholder="Email" required><input name="name" placeholder="Name (optional)"><button class="btn" type="submit">Add</button></div>
    <label class="p-check"><input type="checkbox" name="consent"> This person has agreed to receive ABR emails.</label>
    <p class="muted small">People who sign up on the website confirm by email first. Only add people here who have clearly asked to subscribe.</p>
  </form>
  <input id="subSearch" class="p-input" placeholder="Search email or name">
  <div id="list" class="p-loading">Loading…</div>`);
  let data;
  const draw = () => {
    const c = data.counts;
    $('#subcounts').innerHTML = `<div class="p-mailbar"><div><span class="muted small">Active</span><b>${c.active}</b></div><div><span class="muted small">Awaiting confirmation</span><b>${c.pending}</b></div><div><span class="muted small">Unsubscribed</span><b>${c.unsubscribed}</b></div></div>`;
    const q = $('#subSearch').value.trim().toLowerCase();
    const rows = data.subscribers.filter((s) => !q || s.email.includes(q) || (s.name || '').toLowerCase().includes(q));
    $('#list').className = '';
    $('#list').innerHTML = rows.length ? `<table class="p-table"><thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Receives</th><th>Source</th><th>Signed up</th><th></th></tr></thead><tbody>
      ${rows.slice(0, 500).map((s) => `<tr><td>${esc(s.email)}</td><td>${esc(s.name || '')}</td>
        <td><span class="p-badge ${s.status === 'active' ? 's-published' : s.status === 'pending' ? 's-submitted' : 's-rejected'}">${esc(s.status)}</span></td>
        <td class="small">${({ instant: 'Every article', weekly: 'Weekly digest', monthly: 'Monthly digest', off: 'No article emails' })[s.freq] || ''}${s.sections && s.sections.length ? '<div class="muted">' + esc(s.sections.join(', ')) + '</div>' : ''}<div class="muted">${[s.issues ? 'issues' : '', s.news ? 'newsletters' : ''].filter(Boolean).join(' · ')}</div></td>
        <td class="small">${esc(s.source || '')}</td><td class="small">${fmt(s.createdAt)}</td>
        <td>${s.status !== 'unsubscribed' ? `<button class="p-link danger" data-rm="${esc(s.email)}">Unsubscribe</button>` : ''}</td></tr>`).join('')}</tbody></table>
      ${rows.length > 500 ? '<p class="muted small">Showing the first 500. Use search or export to see all.</p>' : ''}`
      : '<div class="p-empty">No subscribers yet. The sign-up form is in the footer of every page and at the end of every article.</div>';
    $$('[data-rm]').forEach((b) => b.onclick = () => {
      if (!confirm(`Unsubscribe ${b.dataset.rm}?`)) return;
      busy(b, async () => { data = await api('subs.remove', { email: b.dataset.rm }); draw(); }).catch(() => {});
    });
  };
  data = await api('subs.list');
  draw();
  $('#subSearch').oninput = draw;
  $('#subAdd').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    busy($('button', f), async () => {
      data = await api('subs.add', { email: f.email.value, name: f.name.value, consent: f.consent.checked });
      f.reset(); draw(); toast('Subscriber added', 'ok');
    }).catch(() => {});
  };
  $('#csv').onclick = () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['email,name,status,source,created,confirmed', ...data.subscribers.map((s) => [s.email, s.name, s.status, s.source, s.createdAt, s.confirmedAt].map(q).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `abr-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
}

/* =========================================================
   Settings (Chair)
   ========================================================= */
// Settings → site appearance: AI note, Chair's signature, seasonal designs and greetings.
async function siteAppearance(box) {
  let s = await api('site.settings.get');
  const greet = await api('greetings.list').catch(() => null);
  const fmtRange = (r) => r ? r.map((x) => new Date('2026-' + x + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })).join(' – ') : '';
  const draw = () => {
    box.innerHTML = `
    <form class="p-card" id="f_look">
      <h3>Articles</h3>
      <label class="p-check"><input type="checkbox" name="aiNote" ${s.aiNote ? 'checked' : ''}> Show “Drafted with AI assistance” note on articles made from AI drafts</label>
      <p class="muted small">Off by default, because each AI-drafted article already says so in its disclosure.</p>

      <h3 style="margin-top:22px">Chair’s signature</h3>
      <div class="p-sig">${s.signaturePreview ? `<img src="${s.signaturePreview}" alt="Current signature">` : '<span class="muted small">No signature uploaded yet.</span>'}</div>
      <p class="muted small">Sign on plain white paper with a dark pen, photograph or scan it, and upload it. The white background is removed automatically. It is kept private and printed only on the documents ticked below.${s.signatureAt ? ' Uploaded ' + fmt(s.signatureAt) + '.' : ''}</p>
      <div class="p-row"><button type="button" class="btn ghost" id="sigUp">${s.signaturePreview ? 'Replace signature' : 'Upload signature'}</button>${s.signaturePreview ? '<button type="button" class="p-link danger" id="sigDel">Remove</button>' : ''}</div>
      <div class="p-row p-checks">Print it on:
        ${[['letters', 'Letters signed by the Chair'], ['certificates', 'Certificates'], ['licences', 'Licence grants'], ['greetings', 'Festival greetings']]
          .map(([k, l]) => `<label class="p-check"><input type="checkbox" name="sig_${k}" ${s.signatureOn[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <p class="muted small">Printed approval records are always signed by hand.</p>

      <h3 style="margin-top:22px">Seasonal design ${s.active ? `<span class="p-badge s-published">Showing now: ${esc((s.themes.find((t) => t.key === s.active) || {}).name)}</span>` : '<span class="p-badge s-draft">None showing</span>'}</h3>
      <label>Design<select name="themeMode">
        <option value="auto" ${s.themeMode === 'auto' ? 'selected' : ''}>Automatic: switch on and off by the dates below</option>
        <option value="off" ${s.themeMode === 'off' ? 'selected' : ''}>Off: always the normal design</option>
        ${s.themes.map((t) => `<option value="${t.key}" ${s.themeMode === t.key ? 'selected' : ''}>Show now: ${esc(t.name)}</option>`).join('')}
      </select></label>
      <div id="mourningBox" ${s.themeMode === 'mourning' ? '' : 'hidden'} class="p-grid2">
        <label>In memory of<input name="m_name" value="${esc(s.mourning.name)}" placeholder="Full name"></label>
        <label>Short note <span class="muted">(optional)</span><input name="m_note" value="${esc(s.mourning.note)}" placeholder="Our thoughts are with the family."></label>
      </div>
      <table class="p-table p-sched"><thead><tr><th>Design</th><th>Automatic</th><th>Dates</th><th>Greeting message</th></tr></thead><tbody>
        ${s.themes.filter((t) => !t.manual).map((t) => { const x = s.schedule[t.key]; return `<tr data-k="${t.key}">
          <td><b>${esc(t.name)}</b></td>
          <td><input type="checkbox" class="sc-auto" ${x.auto ? 'checked' : ''}></td>
          <td class="small">${t.fixed ? `Every year, ${fmtRange(x.range)}<div class="muted">Or set dates:</div>` : '<span class="muted">Dates change every year:</span>'}
            <div class="p-row"><input type="date" class="p-input sm sc-from" value="${esc(x.from)}"> to <input type="date" class="p-input sm sc-to" value="${esc(x.to)}"></div></td>
          <td><details><summary class="p-link">Edit message</summary><textarea class="p-input sc-msg" rows="5">${esc(x.message)}</textarea></details></td></tr>`; }).join('')}
      </tbody></table>
      <p class="muted small">Holi, Navratri and Diwali follow the Hindu calendar, so check their dates each year. The dates filled in for 2027 come from published festival calendars. The mourning design is never automatic; choose it above when needed. It turns the site monochrome, shows a quiet black ribbon and closes greetings.</p>

      <h3 style="margin-top:22px">Festival greetings</h3>
      <label class="p-check"><input type="checkbox" name="greetingsOn" ${s.greetingsOn ? 'checked' : ''}> While a festive design is showing, let visitors ask for a greeting from the Chair</label>
      <label>Greetings per day, at most<input type="number" name="greetingsDailyLimit" min="10" max="2000" value="${s.greetingsDailyLimit}" style="max-width:140px"></label>
      <p class="muted small">Each greeting is emailed at once as a PDF on ABR letterhead, with your signature if it is uploaded and ticked above. One per email address per festival.${greet ? ` <b>${greet.total}</b> sent so far${Object.keys(greet.byTheme).length ? ' (' + Object.entries(greet.byTheme).map(([k, n]) => `${esc((s.themes.find((t) => t.key === k) || {}).name || k)}: ${n}`).join(', ') + ')' : ''}.` : ''}</p>
      <div class="p-row"><button class="btn">Save appearance</button><a class="p-link" href="/greetings" target="_blank" rel="noopener">Open the greetings page ↗</a></div>
    </form>`;
    const f = $('#f_look', box);
    f.themeMode.onchange = () => { $('#mourningBox', box).hidden = f.themeMode.value !== 'mourning'; };
    $('#sigUp', box).onclick = async (e) => {
      const file = await pickFile();
      if (!file) return;
      busy(e.target, async () => { s = await api('site.signature.upload', { dataUrl: await cleanSignature(file) }); draw(); toast('Signature saved', 'ok'); }).catch(() => {});
    };
    const del = $('#sigDel', box);
    if (del) del.onclick = () => { if (confirm('Remove the uploaded signature?')) busy(del, async () => { s = await api('site.signature.remove'); draw(); }).catch(() => {}); };
    f.onsubmit = (e) => {
      e.preventDefault();
      const schedule = {};
      $$('.p-sched tr[data-k]', box).forEach((tr) => { schedule[tr.dataset.k] = { auto: $('.sc-auto', tr).checked, from: $('.sc-from', tr).value, to: $('.sc-to', tr).value, message: $('.sc-msg', tr).value }; });
      schedule.mourning = { auto: false };
      busy($('button.btn', f), async () => {
        s = await api('site.settings.save', { aiNote: f.aiNote.checked, themeMode: f.themeMode.value, schedule,
          mourning: { name: f.m_name.value, note: f.m_note.value }, greetingsOn: f.greetingsOn.checked, greetingsDailyLimit: f.greetingsDailyLimit.value,
          signatureOn: { letters: f.sig_letters.checked, certificates: f.sig_certificates.checked, licences: f.sig_licences.checked, greetings: f.sig_greetings.checked } });
        draw(); toast('Saved. The website updates within two minutes.', 'ok');
      }).catch(() => {});
    };
  };
  draw();
}

// Turn a photo or scan of a signature into a transparent PNG: drop the paper, keep the ink, trim the edges.
async function cleanSignature(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Could not read that image.')); i.src = url; });
    const scale = Math.min(1, 1200 / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height), px = d.data;
    let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const a = px[i + 3] * Math.max(0, Math.min(1, (200 - lum) / 80));   // paper (light) becomes transparent
      px[i] = px[i + 1] = px[i + 2] = Math.min(lum, 40);                  // ink becomes near-black
      px[i + 3] = a;
      if (a > 30) { const p = i / 4, X = p % c.width, Y = (p / c.width) | 0; if (X < minX) minX = X; if (X > maxX) maxX = X; if (Y < minY) minY = Y; if (Y > maxY) maxY = Y; }
    }
    if (maxX <= minX || maxY <= minY) throw new Error('No signature found in that image. Use dark ink on white paper.');
    x.putImageData(d, 0, 0);
    const pad = 10, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
    const out = document.createElement('canvas');
    const k = Math.min(1, 800 / w);
    out.width = Math.round(w * k); out.height = Math.round(h * k);
    out.getContext('2d').drawImage(c, minX - pad, minY - pad, w, h, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

async function viewSettings() {
  shell('settings', `<header class="p-head"><h1>Settings</h1></header><div id="set" class="p-loading">Loading…</div>`);
  const [m, ag, ai, doi] = await Promise.all([api('mail.settings.get'), api('agreement.settings.get'), api('ai.settings.get').catch(() => null), api('doi.settings.get').catch(() => null)]);
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const dcs = (list, cur) => list.map((d) => `<option ${d === cur ? 'selected' : ''}>${d}</option>`).join('');
  const dot = (on) => `<span class="p-dot ${on ? 'on' : ''}"></span>${on ? 'Connected' : 'Not connected'}`;
  $('#set').className = 'p-settings';
  $('#set').innerHTML = `
  <form class="p-card" id="f_sender">
    <h3>Sender</h3>
    <div class="p-grid2">
      <label>From address<input name="fromAddress" value="${esc(m.fromAddress)}"></label>
      <label>From name<input name="fromName" value="${esc(m.fromName)}"></label>
      <label>Reply-to <span class="muted">(optional)</span><input name="replyTo" value="${esc(m.replyTo)}" placeholder="editor@theabr.in"></label>
      <label>Postal line in email footer<input name="postal" value="${esc(m.postal)}"></label>
    </div>
    <button class="btn">Save sender</button>
  </form>

  <form class="p-card" id="f_route">
    <h3>Email sending</h3>
    <div class="p-grid2">
      <label>System emails <span class="muted">(welcome, agreement, confirmations, approvals)</span><select name="routeTx">${opt(m.providers, m.routeTx)}</select></label>
      <label>Newsletters and team emails<select name="routeBulk">${opt(m.providers, m.routeBulk)}</select></label>
      <label>Daily sending limit <span class="muted">(all emails, resets at midnight IST)</span><input name="dailyLimit" type="number" min="1" value="${m.dailyLimit}"></label>
      <label>Emails per run <span class="muted">(sender runs every 5 minutes)</span><input name="batchSize" type="number" min="1" max="200" value="${m.batchSize}"></label>
    </div>
    <p class="muted small">ZeptoMail is only for one-to-one system emails; its terms don’t allow newsletters. Use Zoho Mail for newsletters, and set the daily limit at or below your Zoho plan’s sending limit.</p>
    <div class="p-row"><button class="btn">Save sending settings</button>
      <span class="small">Background sender: ${m.triggerOn ? '<b>running</b>' : '<b class="danger-t">off</b> <button type="button" class="p-link" id="startSender">Start it</button>'}</span></div>
  </form>

  <form class="p-card" id="f_zoho">
    <h3>Zoho Mail <span class="p-conn">${dot(m.zohoConnected)}${m.zohoAccountEmail ? ` · ${esc(m.zohoAccountEmail)}` : ''}</span></h3>
    <ol class="p-steps small">
      <li>Go to <a href="https://api-console.zoho.${esc(m.zohoDc)}" target="_blank" rel="noopener">api-console.zoho.${esc(m.zohoDc)}</a> (use the region where the info@theabr.in mailbox lives) → <b>Add Client → Self Client</b>.</li>
      <li>Copy the <b>Client ID</b> and <b>Client Secret</b> into the boxes below.</li>
      <li>In the Self Client, open <b>Generate Code</b>. For scope, paste <code>ZohoMail.messages.CREATE,ZohoMail.accounts.READ</code>, choose 10 minutes, and click <b>Create</b>.</li>
      <li>Paste the code below and click <b>Connect</b> straight away. The code works once and expires quickly.</li>
    </ol>
    <div class="p-grid2">
      <label>Data centre<select name="dc">${dcs(m.zohoDcs, m.zohoDc)}</select></label>
      <label>Client ID<input name="clientId" value="${esc(m.zohoClientId)}" autocomplete="off"></label>
      <label>Client Secret<input name="clientSecret" type="password" autocomplete="off" placeholder="${m.zohoConnected ? '•••••••• (saved)' : ''}"></label>
      <label>Generated code<input name="code" autocomplete="off"></label>
    </div>
    <div class="p-row"><button class="btn">Connect Zoho Mail</button>
      ${m.zohoConnected ? '<button type="button" class="btn ghost" data-test="zoho">Send test</button><button type="button" class="p-link danger" id="zohoOff">Disconnect</button>' : ''}</div>
  </form>

  <form class="p-card" id="f_zepto">
    <h3>ZeptoMail <span class="p-conn">${dot(m.zeptoConnected)}</span></h3>
    <p class="small muted">In ZeptoMail: add and verify the theabr.in domain → <b>Mail Agents</b> → your agent → <b>SMTP/API</b> → copy the <b>Send Mail token</b>.</p>
    <div class="p-grid2">
      <label>Region<select name="zeptoDc">${dcs(m.zeptoDcs, m.zeptoDc)}</select></label>
      <label>Send Mail token<input name="zeptoToken" type="password" autocomplete="off" placeholder="${m.zeptoConnected ? '•••••••• (saved, paste to replace)' : 'Zoho-enczapikey …'}"></label>
    </div>
    <div class="p-row"><button class="btn">Save ZeptoMail</button>
      ${m.zeptoConnected ? '<button type="button" class="btn ghost" data-test="zepto">Send test</button><button type="button" class="p-link danger" id="zeptoOff">Remove token</button>' : ''}</div>
  </form>

  <div class="p-card"><h3>Google (fallback)</h3>
    <p class="small muted">Sends from the Google account that owns the Apps Script. It can only show info@theabr.in as the sender if that address is added as a “Send mail as” alias in that Gmail account. Use it as a backup.</p>
    <button type="button" class="btn ghost" data-test="google">Send test</button></div>

  <form class="p-card" id="f_agree">
    <h3>Team agreement</h3>
    <p class="small muted">Every team member except the Chair must sign the current version before using the portal. <b>Raising the version number asks everyone to sign again.</b> Placeholders: {{entity}}, {{name}}, {{email}}, {{role}}, {{date}}. Start lines with # or ## for headings.</p>
    <div class="p-grid2">
      <label>Legal entity<input name="entity" value="${esc(ag.entity)}"></label>
      <label>Version<input name="version" value="${esc(ag.version)}"></label>
    </div>
    <label>Agreement text${ag.isDefault ? ' <span class="muted">(default template)</span>' : ''}<textarea name="text" rows="16">${esc(ag.text)}</textarea></label>
    <div class="p-row"><button class="btn">Save agreement</button>${ag.isDefault ? '' : '<button type="button" class="p-link" id="agrReset">Restore default text</button>'}</div>
  </form>
  ${ai ? `<form class="p-card" id="f_ai">
    <h3>AI drafts (Groq)</h3>
    <p class="small muted">The Groq API key is stored as the Cloudflare secret <code>GROQ_API_KEY</code>, never here. Drafts go to the Approval queue with an AI disclosure.</p>
    <div class="p-grid2">
      <label>AI drafts<select name="enabled"><option value="1" ${ai.enabled ? 'selected' : ''}>On</option><option value="" ${ai.enabled ? '' : 'selected'}>Off</option></select></label>
      <label>Drafts per day <span class="muted">(used today: ${ai.usedToday})</span><input name="dailyLimit" type="number" min="0" max="200" value="${ai.dailyLimit}"></label>
    </div>
    <button class="btn">Save AI settings</button>
  </form>` : ''}
  ${doi ? `<form class="p-card" id="f_doi">
    <h3>DOIs (Zenodo)</h3>
    <p class="small muted">When an article is published, ABR reserves a DOI on Zenodo, prints it on the article and PDF, uploads the PDF and publishes the record. Promoted articles are skipped. Create a personal access token at zenodo.org → Account → Applications with the <b>deposit:write</b> and <b>deposit:actions</b> scopes. Test first with the sandbox (sandbox.zenodo.org, separate account).</p>
    <div class="p-grid2">
      <label>Zenodo token ${doi.tokenSet ? '<span class="p-badge s-published">Saved</span>' : ''}<input name="token" type="password" placeholder="${doi.tokenSet ? 'Leave blank to keep the saved token' : 'Paste token'}" autocomplete="off"></label>
      <label>Environment<select name="sandbox"><option value="" ${doi.sandbox ? '' : 'selected'}>Zenodo (live DOIs)</option><option value="1" ${doi.sandbox ? 'selected' : ''}>Sandbox (test DOIs)</option></select></label>
      <label>Licence for published articles <small class="muted">(shown on every article and used for DOIs and permissions)</small><select name="license">${[['cc-by-4.0', 'CC BY 4.0'], ['cc-by-nc-4.0', 'CC BY-NC 4.0'], ['cc-by-nc-nd-4.0', 'CC BY-NC-ND 4.0'], ['cc-by-nd-4.0', 'CC BY-ND 4.0']].map(([v, l]) => `<option value="${v}" ${doi.license === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Zenodo community <span class="muted">(optional identifier)</span><input name="community" value="${esc(doi.community)}" placeholder="e.g. abr"></label>
      <label>Automatic DOIs<select name="enabled"><option value="1" ${doi.enabled ? 'selected' : ''}>On</option><option value="" ${doi.enabled ? '' : 'selected'}>Off</option></select></label>
    </div>
    <div class="p-row"><button class="btn">Save DOI settings</button><button type="button" class="btn ghost" id="doiAll">Register DOIs for all published articles</button><span class="small muted">${doi.queue} in queue</span></div>
  </form>` : ''}
  <div id="appearance"></div>`;
  if (state.user.canApprove) siteAppearance($('#appearance')).catch((e) => { $('#appearance').innerHTML = `<p class="p-alert">${esc(e.message)}</p>`; });

  const formObj = (f) => Object.fromEntries(new FormData(f));
  const reload = () => viewSettings();
  $('#f_sender').onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => { await api('mail.settings.save', formObj(e.target)); toast('Saved', 'ok'); }).catch(() => {}); };
  $('#f_route').onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => { await api('mail.settings.save', formObj(e.target)); toast('Saved', 'ok'); }).catch(() => {}); };
  $('#f_zoho').onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => { await api('mail.zoho.connect', formObj(e.target)); toast('Zoho Mail connected', 'ok'); reload(); }).catch(() => {}); };
  $('#f_zepto').onsubmit = (e) => { e.preventDefault(); const o = formObj(e.target); if (!o.zeptoToken) delete o.zeptoToken;
    busy($('button', e.target), async () => { await api('mail.settings.save', o); toast('ZeptoMail saved', 'ok'); reload(); }).catch(() => {}); };
  $('#f_agree').onsubmit = (e) => { e.preventDefault(); const o = formObj(e.target);
    if (o.version !== ag.version && !confirm(`Change the version from ${ag.version} to ${o.version}? Everyone (except the Chair) will have to sign again.`)) return;
    busy($('button', e.target), async () => { await api('agreement.settings.save', o); toast('Agreement saved', 'ok'); reload(); }).catch(() => {}); };
  if ($('#f_doi')) {
    $('#f_doi').onsubmit = (e) => { e.preventDefault(); const o = formObj(e.target);
      busy($('button', e.target), async () => { await api('doi.settings.save', { token: o.token || undefined, sandbox: !!o.sandbox, license: o.license, community: o.community, enabled: !!o.enabled }); toast('Saved', 'ok'); viewSettings(); }).catch(() => {}); };
    $('#doiAll').onclick = (e) => confirm('Register DOIs for every published article that does not have one? They are processed two at a time in the background.') &&
      busy(e.target, async () => { const r = await api('doi.queue', { all: true }); toast(`${r.queued} queued`, 'ok'); }).catch(() => {});
  }
  if ($('#f_ai')) $('#f_ai').onsubmit = (e) => { e.preventDefault(); const o = formObj(e.target);
    busy($('button', e.target), async () => { await api('ai.settings.save', { enabled: !!o.enabled, dailyLimit: Number(o.dailyLimit) }); toast('Saved', 'ok'); }).catch(() => {}); };
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('#zohoOff', () => confirm('Disconnect Zoho Mail?') && busy(null, async () => { await api('mail.zoho.disconnect'); reload(); }).catch(() => {}));
  on('#zeptoOff', () => confirm('Remove the ZeptoMail token?') && busy(null, async () => { await api('mail.zepto.remove'); reload(); }).catch(() => {}));
  on('#agrReset', () => confirm('Restore the default agreement text?') && busy(null, async () => { await api('agreement.settings.save', { resetText: true }); reload(); }).catch(() => {}));
  on('#startSender', (e) => busy(e.target, async () => { await api('mail.startSender'); toast('Background sender started', 'ok'); reload(); }).catch(() => {}));
  $$('[data-test]').forEach((b) => b.onclick = () => {
    const to = prompt('Send a test email to:', state.user.email);
    if (!to) return;
    busy(b, async () => { const r = await api('mail.testProvider', { provider: b.dataset.test, to }); toast('Test sent to ' + r.to, 'ok'); }).catch(() => {});
  });
}

/* =========================================================
   Import
   ========================================================= */
async function viewImport() {
  shell('import', `<header class="p-head"><h1>Import articles</h1></header>
  <div class="p-card">
    <p>Import one or more articles from an <b>ABR import file</b> (.json). Imported articles arrive in the <a href="#/review">Approval queue</a> as “Awaiting approval”, with you as the submitting editor, so nothing is published until you approve it.</p>
    <div class="p-row wrap"><button class="btn" id="impPick">Choose import file…</button>
      <label class="p-check"><input type="checkbox" id="impDraft"> Import as drafts instead</label></div>
    <p class="muted small">Or paste the file’s contents:</p>
    <textarea id="impText" rows="8" placeholder='{"abrImport": 1, "articles": [ { "title": "…", "body": "<p>…</p>", … } ]}'></textarea>
    <div class="p-row"><button class="btn accent" id="impGo">Check and import</button></div>
    <div id="impOut"></div>
    <details class="small"><summary>File format</summary><pre class="p-pre">{
  "abrImport": 1,
  "articles": [{
    "title": "Headline", "standfirst": "One or two sentences",
    "section": "${esc(state.config.sections.join(' | '))}",
    "type": "${esc(state.config.types.join(' | '))}",
    "tags": ["tag one", "tag two"], "byline": "abr or authors",
    "coverUrl": "https://… (optional)", "coverCaption": "",
    "body": "&lt;p&gt;Article HTML…&lt;/p&gt;",
    "references": ["APA reference with URL", "…"],
    "disclosure": "", "publishedDate": "YYYY-MM-DD (optional, back issues only)"
  }]
}</pre></details>
  </div>`);
  $('#impPick').onclick = async () => {
    const f = await pickFile('.json,application/json');
    if (f) $('#impText').value = await f.text();
  };
  $('#impGo').onclick = (e) => busy(e.target, async () => {
    let data;
    try { data = JSON.parse($('#impText').value); } catch { throw new Error('That is not a valid import file (JSON could not be read).'); }
    const articles = Array.isArray(data) ? data : (data.articles || (data.title ? [data] : []));
    if (!articles.length) throw new Error('No articles found in the file.');
    if (!confirm(`Import ${articles.length} article${articles.length > 1 ? 's' : ''}?`)) return;
    const r = await api('articles.import', { articles, status: $('#impDraft').checked ? 'draft' : 'submitted' });
    $('#impOut').innerHTML = `<h3>${r.imported} of ${r.results.length} imported</h3><ul>${r.results.map((x) => x.ok
      ? `<li>✓ <a href="#/edit/${encodeURIComponent(x.id)}">${esc(x.title)}</a> <span class="muted small">${esc(x.id)}</span></li>`
      : `<li class="danger-t">✗ ${esc(x.title)}: ${esc(x.error)}</li>`).join('')}</ul>`;
    toast(`${r.imported} imported`, r.imported ? 'ok' : '');
  }).catch(() => {});
}

/* =========================================================
   Partners
   ========================================================= */
async function viewPartners() {
  shell('partners', `<header class="p-head"><h1>Partners</h1></header><div id="pt" class="p-loading">Loading…</div>`);
  const list = await api('partners.list');
  const paint = (list) => {
    $('#pt').className = '';
    $('#pt').innerHTML = `
    <form class="p-card" id="ptNew"><h3>Add a partner</h3>
      <div class="p-grid2"><label>Organisation name<input name="name" required></label><label>Website<input name="website" placeholder="https://…"></label></div>
      <label>Internal note <span class="muted">(not shown publicly)</span><input name="note" placeholder="e.g. Partnership agreed for 2026–27"></label>
      <button class="btn">Add partner</button></form>
    <div class="p-card"><h3>Partners</h3>
      <p class="small muted">Each partner gets a private code. Send them their <b>co-brand link</b>: they upload their logo and download a co-branded ABR kit built to the brand guidelines. Their trimmed logo appears here and on their articles.</p>
      ${list.length ? `<table class="p-table"><thead><tr><th>Logo</th><th>Partner</th><th>Co-brand link</th><th>Status</th><th></th></tr></thead><tbody>${list.map((x) => `<tr>
        <td>${x.logoUrl ? `<img src="${esc(x.logoUrl)}" alt="" style="max-height:36px;max-width:110px" referrerpolicy="no-referrer">` : '<span class="muted small">None yet</span>'}</td>
        <td><b>${esc(x.name)}</b><div class="muted small">${esc(x.website || '')}${x.note ? ' · ' + esc(x.note) : ''}</div></td>
        <td><code>${esc(x.code)}</code><div><button class="p-link" data-copy="${esc(x.kitUrl)}">Copy link</button> · <button class="p-link" data-newcode="${esc(x.slug)}">New code</button></div></td>
        <td>${x.status === 'inactive' ? '<span class="muted">Inactive</span>' : 'Active'}</td>
        <td><button class="p-link" data-logo="${esc(x.slug)}">Upload logo</button> · <button class="p-link" data-toggle="${esc(x.slug)}" data-name="${esc(x.name)}" data-web="${esc(x.website || '')}" data-st="${x.status}">${x.status === 'inactive' ? 'Activate' : 'Deactivate'}</button></td>
      </tr>`).join('')}</tbody></table>` : '<p class="muted">No partners yet.</p>'}
    </div>`;
    $('#ptNew').onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => { paint(await api('partners.save', Object.fromEntries(new FormData(e.target)))); toast('Partner added', 'ok'); }).catch(() => {}); };
    $$('[data-copy]').forEach((b) => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Link copied', 'ok')); });
    $$('[data-newcode]').forEach((b) => b.onclick = () => confirm('Create a new code? The old link will stop working.') &&
      busy(b, async () => paint(await api('partners.newCode', { slug: b.dataset.newcode }))).catch(() => {}));
    $$('[data-toggle]').forEach((b) => b.onclick = () => busy(b, async () => paint(await api('partners.save',
      { slug: b.dataset.toggle, name: b.dataset.name, website: b.dataset.web, status: b.dataset.st === 'inactive' ? 'active' : 'inactive' }))).catch(() => {}));
    $$('[data-logo]').forEach((b) => b.onclick = async () => {
      const f = await pickFile('image/png,image/jpeg,image/webp,image/svg+xml');
      if (!f) return;
      busy(b, async () => {
        const dataUrl = await toPngDataUrl(f, 1200);
        paint(await api('partners.setLogo', { slug: b.dataset.logo, dataUrl }));
        toast('Logo saved', 'ok');
      }).catch(() => {});
    });
  };
  paint(list);
}

async function toPngDataUrl(file, max) {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image.')); i.src = url; });
    const k = Math.min(1, max / Math.max(im.naturalWidth || max, im.naturalHeight || max));
    const c = document.createElement('canvas');
    c.width = Math.round((im.naturalWidth || max) * k); c.height = Math.round((im.naturalHeight || max / 2) * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

/* =========================================================
   AI drafts
   ========================================================= */
async function viewAi() {
  const cfg = state.config;
  shell('ai', `<header class="p-head"><h1>AI draft</h1></header>
  <form class="p-card" id="aiForm">
    <p>Describe the article. Groq researches it on the web, writes a full draft with numbered references, and the draft goes to the <b>Approval queue</b> with an AI disclosure already written in. Every reference link is checked automatically; anything that could not be verified is listed for the editor.</p>
    <label>Topic and angle<textarea name="topic" rows="4" required placeholder="e.g. How Gujarat’s dairy cooperatives are adapting to climate change: what the data says about milk yields, heat stress and the cooperative response since 2020."></textarea></label>
    <div class="p-grid2">
      <label>Section<select name="section"><option value="">Let AI choose</option>${cfg.sections.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>
      <label>Article type<select name="type"><option value="">Let AI choose</option>${cfg.types.filter((t) => t !== 'Interview' && t !== 'Opinion').map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>
      <label>Length<select name="length"><option value="short">Short (about 900 words)</option><option value="standard" selected>Standard (about 1,500 words)</option><option value="long">Long (about 2,400 words)</option></select></label>
      <label>Byline<select name="byline"><option value="abr" selected>Curated by Ahmedabad Business Review</option><option value="authors">Under my name</option></select></label>
    </div>
    <label>Notes for the writer <span class="muted">(optional: sources to use, points to cover, things to avoid)</span><textarea name="notes" rows="3"></textarea></label>
    <div class="p-row"><button class="btn accent">Research and write draft</button><span class="muted small" id="aiState"></span></div>
  </form>
  <div id="aiOut"></div>`);
  $('#aiForm').onsubmit = (e) => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(e.target));
    $('#aiState').textContent = 'Researching and writing. This usually takes 1 to 3 minutes; keep this tab open.';
    busy($('button', e.target), async () => {
      const a = await api('ai.generate', o);
      $('#aiState').textContent = '';
      $('#aiOut').innerHTML = `<div class="p-card"><h3>Draft ready: ${esc(a.title)}</h3>
        <p class="muted small">${esc(a.id)} · ${a.wordCount} words · now in the Approval queue</p>
        <pre class="p-pre">${esc(a.aiReport || '')}</pre>
        <a class="btn" href="#/edit/${encodeURIComponent(a.id)}">Open draft</a></div>`;
      toast('AI draft created', 'ok');
    }).catch(() => { $('#aiState').textContent = ''; });
  };
}


/* =========================================================
   Forgot / reset password (no login needed)
   ========================================================= */
function authCard(inner) {
  app().innerHTML = `<div class="p-login"><div class="p-card"><div class="p-login-brand"><img src="/brand/logo/primary/ABR-Primary-Stacked-Black.svg" alt="Ahmedabad Business Review" width="240"><span class="p-login-sub">Editorial Portal</span></div>${inner}</div></div>`;
}
function viewForgot() {
  authCard(`<form id="fgForm"><h3>Reset your password</h3><p class="small muted">Enter the email address of your ABR portal account. We’ll email you a link to choose a new password.</p>
    <label>Email<input type="email" name="email" required autocomplete="username"></label>
    <button class="btn p-wide">Email me a reset link</button><p class="small"><a href="#/login">Back to log in</a></p></form><div id="fgDone"></div>`);
  $('#fgForm').onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => {
    await api('auth.forgot', { email: e.target.email.value });
    $('#fgForm').hidden = true;
    $('#fgDone').innerHTML = '<div class="p-alert ok">If that email belongs to an active account, a reset link is on its way. It expires in 1 hour. Check your spam folder too.</div><p class="small"><a href="#/login">Back to log in</a></p>';
  }).catch(() => {}); };
}
function viewReset(token) {
  authCard(`<form id="rsForm"><h3>Choose a new password</h3>
    <label>New password (8+ characters)<input type="password" name="pw" required minlength="8" autocomplete="new-password"></label>
    <label>Repeat it<input type="password" name="pw2" required minlength="8" autocomplete="new-password"></label>
    <button class="btn p-wide">Set password</button></form><div id="rsDone"></div>`);
  $('#rsForm').onsubmit = (e) => { e.preventDefault(); const f = e.target; busy($('button', f), async () => {
    if (f.pw.value !== f.pw2.value) throw new Error('The two passwords do not match.');
    const r = await api('auth.resetWithToken', { token, password: f.pw.value });
    clearSession();
    f.hidden = true;
    $('#rsDone').innerHTML = `<div class="p-alert ok">Password changed for <b>${esc(r.email)}</b>.</div><a class="btn p-wide" href="#/login">Log in</a>`;
    history.replaceState(null, '', '#/reset/done');
  }).catch(() => {}); };
}

/* =========================================================
   Issues
   ========================================================= */
async function viewIssues() {
  shell('issues', `<header class="p-head"><h1>Issues</h1></header><div id="iss" class="p-loading">Loading…</div>`);
  const paint = (d) => {
    const box = $('#iss'); box.className = '';
    const me = state.user;
    const issueCard = (i) => {
      const mine = (i.statements || []).find((s) => s.email === me.email);
      return `<div class="p-card p-issue" data-key="${esc(i.key)}">
      <div class="p-row wrap"><h3 style="margin:0">${esc(i.label)}</h3>${i.status === 'published' ? '<span class="p-badge s-published">Published</span>' : '<span class="p-badge s-draft">Draft</span>'}
        ${i.status === 'published' ? `<a class="small" href="/issues/${esc(i.key)}" target="_blank" rel="noopener">View ↗</a> <a class="small" href="/issues/${esc(i.key)}.pdf" target="_blank" rel="noopener">PDF ↗</a>` : `<a class="small" href="/issues/${esc(i.key)}/print" target="_blank" rel="noopener" title="Preview works once published">Print view</a>`}</div>
      ${i.theme ? `<p class="small muted">${esc(i.theme)}</p>` : ''}
      <p class="small">${i.articles.length} article${i.articles.length === 1 ? '' : 's'} · Chair’s foreword: ${i.chairStatement ? '✓ written' : '<b>needed</b>'} · Other statements: ${(i.statements || []).length}</p>
      ${d.canManage ? `
        <details ${i.status !== 'published' ? 'open' : ''}><summary><b>Details and cover</b></summary>
          <form class="i-meta p-grid2">
            <label>Title<input name="title" value="${esc(i.title || '')}" placeholder="e.g. The Institutions Issue"></label>
            <label>Cover colour<select name="coverStyle">${d.coverStyles.map((c) => `<option ${c === i.coverStyle ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
            <label style="grid-column:1/-1">Theme line <span class="muted">(on the cover)</span><input name="theme" value="${esc(i.theme || '')}"></label>
            <button class="btn ghost sm">Save details</button>
          </form></details>
        <details><summary><b>Articles in this issue</b> <span class="muted small">(tick and order)</span></summary>
          <div class="i-arts">${d.published.map((a) => {
            const pos = (i.articleIds || []).indexOf(a.id);
            return `<label class="p-check"><input type="checkbox" value="${esc(a.id)}" ${pos !== -1 ? 'checked' : ''}> <input type="number" class="p-input sm i-ord" min="1" value="${pos !== -1 ? pos + 1 : ''}" style="width:56px"> ${esc(a.title)} <span class="muted small">${esc(a.id)} · ${fmt(a.publishedAt)}${a.issueKey && a.issueKey !== i.key ? ' · in ' + esc(a.issueKey) : ''}</span></label>`;
          }).join('') || '<span class="muted small">No published articles yet.</span>'}</div>
          <button class="btn ghost sm i-assign">Save articles</button></details>
        <details ${!i.chairStatement && i.status !== 'published' ? 'open' : ''}><summary><b>Chair’s foreword</b> <span class="muted small">(required)</span></summary>
          <textarea class="i-chair" rows="8" placeholder="A blank line starts a new paragraph." ${i.status === 'published' ? 'disabled' : ''}>${esc(i.chairStatement || '')}</textarea>
          ${i.status !== 'published' ? '<button class="btn ghost sm i-chair-save">Save foreword</button>' : ''}</details>
        <details ${(i.statements || []).length ? 'open' : ''}><summary><b>Statements from the team</b> <span class="muted small">(${(i.statements || []).length}; the EiC, COO and editors were invited by email)</span></summary>
          ${(i.statements || []).map((s) => `<div class="p-stmt"><label class="p-check" style="float:right"><input type="checkbox" class="i-use" data-email="${esc(s.email)}" ${s.use !== false ? 'checked' : ''}> Use in issue</label>
            <b>${esc(s.name)}</b> <span class="muted small">${esc(s.title)} · ${fmt(s.at)}</span><p class="small">${esc(s.text).replace(/\n/g, '<br>')}</p></div>`).join('') || '<p class="small muted">No statements yet.</p>'}</details>
        <div class="p-row">${i.status === 'published' ? '<button class="btn ghost i-reopen">Reopen for changes</button>' : '<button class="btn accent i-publish">Publish issue</button>'}</div>`
      : i.status !== 'published' && d.canStatement ? `
        ${mine ? `<p class="small">${mine.use !== false ? '✓ The Chair has selected your statement for the issue.' : 'The Chair has not selected your statement for this issue yet.'}</p>` : ''}
        <label><b>Your statement for this issue</b> <span class="muted small">(optional; if the Chair selects it, it is printed after the Chair’s foreword and shown on the issue page)</span>
        <textarea class="i-mine" rows="6">${esc(mine ? mine.text : '')}</textarea></label><button class="btn ghost sm i-mine-save">Save my statement</button>` : ''}
    </div>`;
    };
    box.innerHTML = `
    ${d.canManage ? `<form class="p-card p-inline-form" id="newIssue"><h3>New issue</h3><div class="p-grid4">
      <input name="volume" type="number" min="1" placeholder="Volume" required><input name="number" type="number" min="1" max="12" placeholder="Number" required>
      <input name="title" placeholder="Title (optional)"><select name="coverStyle">${d.coverStyles.map((c) => `<option>${c}</option>`).join('')}</select></div>
      <input name="theme" placeholder="Theme line for the cover (optional)" class="p-input"><button class="btn">Create issue</button>
      <p class="small muted">Volume 1 = 2026, six issues a year (No. 1 = Jan–Feb … No. 6 = Nov–Dec). Articles keep their own online dates; adding one to an issue sets its volume and number in citations.</p></form>` : `<p class="muted">Issues gather published articles into a compiled edition with a cover and PDF. You can add a short statement to any issue that isn’t published yet.</p>`}
    ${d.issues.map(issueCard).join('') || '<div class="p-empty">No issues yet.</div>'}`;

    const nf = $('#newIssue');
    if (nf) nf.onsubmit = (e) => { e.preventDefault(); busy($('button', nf), async () => paint(await api('issues.save', formObj(nf)))).catch(() => {}); };
    $$('.p-issue').forEach((c) => {
      const key = c.dataset.key;
      const on = (sel, fn) => { const el = $(sel, c); if (el) el.onclick = (e) => { e.preventDefault(); busy(e.target, fn).catch(() => {}); }; };
      const m = $('.i-meta', c);
      if (m) m.onsubmit = (e) => { e.preventDefault(); const i = d.issues.find((x) => x.key === key);
        busy($('button', m), async () => { paint(await api('issues.save', { key, volume: i.volume, number: i.number, ...formObj(m) })); toast('Saved', 'ok'); }).catch(() => {}); };
      on('.i-assign', async () => {
        const picked = $$('.i-arts input[type=checkbox]', c).filter((x) => x.checked).map((x) => ({ id: x.value, ord: Number($('.i-ord', x.parentNode).value) || 999 }));
        picked.sort((a, b) => a.ord - b.ord);
        paint(await api('issues.assign', { key, articleIds: picked.map((x) => x.id) })); toast('Articles saved', 'ok');
      });
      on('.i-chair-save', async () => { paint(await api('issues.statement', { key, text: $('.i-chair', c).value })); toast('Foreword saved', 'ok'); });
      on('.i-mine-save', async () => { paint(await api('issues.statement', { key, text: $('.i-mine', c).value })); toast('Statement saved', 'ok'); });
      on('.i-publish', async () => {
        if (!confirm('Publish this issue? Its page and PDF go live, and every contributor receives a certificate.')) return;
        const r = await api('issues.publish', { key }); paint(r.list); toast(`Issue published · ${r.certificates} certificate(s) issued`, 'ok');
      });
      $$('.i-use', c).forEach((cb) => cb.onchange = () => api('issues.useStatement', { key, email: cb.dataset.email, use: cb.checked })
        .then((d2) => { toast(cb.checked ? 'Statement will be used' : 'Statement left out', 'ok'); paint(d2); }).catch((e) => { toast(e.message); cb.checked = !cb.checked; }));
      on('.i-reopen', async () => { if (confirm('Reopen this issue? It stays online; you can then edit statements and republish.')) paint(await api('issues.reopen', { key })); });
    });
  };
  paint(await api('issues.list'));
}

/* =========================================================
   Certificates (Chair)
   ========================================================= */
async function viewCerts() {
  shell('certs', `<header class="p-head"><h1>Certificates</h1></header>
  <p class="muted small">Issued automatically: <b>publication</b> (each named author when an article is published), <b>contribution</b> (each author when an issue is published), <b>service</b> (when an EiC/COO term ends) and <b>editorial service</b> (each January, for the year before). Everyone can check a certificate at <a href="/verify" target="_blank">/verify</a>.</p>
  <div class="p-two">
    <form id="cMan" class="p-card"><h3>Issue a certificate</h3>
      <label>Type<select name="type"><option value="custom">Recognition (custom text)</option><option value="contributor">Publication (for an article)</option><option value="service">Editorial service</option><option value="term">Service in an office</option></select></label>
      <div class="p-grid2"><label>Recipient name<input name="name" required></label><label>Email <span class="muted">(optional; emails them)</span><input name="email" type="email"></label></div>
      <label>Role line <span class="muted">(optional, under the name)</span><input name="role" placeholder="e.g. Speaker, ABR Roundtable 2026"></label>
      <div data-for="custom"><label>Heading<input name="heading" value="Certificate of Recognition"></label><label>This certificate is awarded…<textarea name="text" rows="3" placeholder="for an outstanding contribution to ABR’s roundtable on…"></textarea></label></div>
      <div data-for="contributor" hidden><label>Article ID<input name="articleId" placeholder="ABR-2026-0007"></label></div>
      <div data-for="service term" hidden><div class="p-grid2"><label>Office<input name="office" placeholder="Editor"></label><label>Year (service)<input name="year" type="number"></label>
        <label>From<input name="from" type="date"></label><label>To<input name="to" type="date"></label></div></div>
      <button class="btn">Issue certificate</button></form>
    <form id="cSvc" class="p-card"><h3>Editorial service certificates</h3><p class="small muted">Runs automatically each January for the year before. Run it now for a particular year (people who already have one for that year are skipped).</p>
      <label>Year<input name="year" type="number" value="${new Date().getFullYear()}"></label><button class="btn ghost">Issue for all active team members</button></form>
  </div>
  <div id="cList" class="p-loading">Loading…</div>`);
  const f = $('#cMan');
  const sync = () => $$('[data-for]', f).forEach((d) => { d.hidden = !d.dataset.for.split(' ').includes(f.type.value); });
  f.type.onchange = sync;
  f.onsubmit = (e) => { e.preventDefault(); const o = formObj(f);
    if (o.type === 'service' || o.type === 'term') { o.start = o.from; o.end = o.to; }
    busy($('button', f), async () => { const c = await api('certs.issue', o); toast(`Issued ${c.id}`, 'ok'); f.reset(); sync(); draw(); }).catch(() => {}); };
  $('#cSvc').onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => { const r = await api('certs.serviceRun', { year: Number(e.target.year.value) }); toast(`${r.issued} certificate(s) issued`, 'ok'); draw(); }).catch(() => {}); };
  const draw = async () => {
    const list = await api('certs.list');
    $('#cList').className = '';
    $('#cList').innerHTML = list.length ? `<table class="p-table"><thead><tr><th>Reference</th><th>Recipient</th><th>Certificate</th><th>Issued</th><th></th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><a href="/certificates/${esc(c.id)}" target="_blank" rel="noopener"><code>${esc(c.id)}</code></a></td>
        <td><b>${esc(c.name)}</b><div class="muted small">${esc(c.email || '')}${c.role ? ' · ' + esc(c.role) : ''}</div></td>
        <td>${esc(c.typeLabel)}<div class="muted small">${esc(c.detail.title || c.detail.office || c.detail.issueLabel || c.detail.heading || '')}</div></td>
        <td class="small">${fmt(c.issuedAt)}</td>
        <td>${c.status === 'revoked' ? `<span class="p-badge s-rejected">Revoked</span>` : `<button class="p-link danger" data-rev="${esc(c.id)}">Revoke</button>`}</td></tr>`).join('')}</tbody></table>` : '<div class="p-empty">No certificates yet.</div>';
    $$('[data-rev]').forEach((b) => b.onclick = () => { const reason = prompt('Reason for revoking (shown on the verification page):'); if (reason) busy(b, async () => { await api('certs.revoke', { id: b.dataset.rev, reason }); draw(); }).catch(() => {}); });
  };
  draw();
}

/* =========================================================
   Letters on letterhead (Chair)
   ========================================================= */
function letterBody(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])_(.+?)_(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  return String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) return '';
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

async function viewLetters() {
  const u = state.user;
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  shell('letters', `<header class="p-head"><h1>Letters</h1></header>
  <div class="p-two">
    <form id="lForm" class="p-card"><h3>New letter on ABR letterhead</h3>
      <div class="p-grid2"><label>Date<input name="date" type="date" value="${today}"></label><label>Closing<input name="closing" value="Yours sincerely,"></label></div>
      <label>To <span class="muted">(name, role, organisation, address: one per line)</span><textarea name="toBlock" rows="4" placeholder="Ms. Jane Doe&#10;Editor-in-Chief&#10;Ahmedabad Business Review"></textarea></label>
      <label>Subject<input name="subject" required placeholder="Appointment as Editor-in-Chief"></label>
      <label>Letter <span class="muted">(blank line = new paragraph · Enter = new line · “- ” = bullet · “1. ” = numbered · **bold** · _italic_)</span><textarea name="body" rows="12" required placeholder="Dear Jane,&#10;&#10;I am pleased to…"></textarea></label>
      <div class="p-grid2"><label>Signed by<input name="signName" value="${esc(u.name)}"></label><label>Title<input name="signTitle" value="${esc(u.title)}"></label></div>
      <label>Copy to <span class="muted">(optional, one per line)</span><textarea name="cc" rows="2"></textarea></label>
      <button class="btn">Issue letter</button>
      <p class="small muted">Each letter gets a reference number (ABRL-…), a private link and a PDF. Anyone holding it can confirm it is genuine at /verify; the contents stay private.</p>
    </form>
    <div class="p-card"><h3>Preview</h3><div id="lPrev" class="p-letter"></div></div>
  </div>
  <div id="lList" class="p-loading">Loading…</div>`);
  const f = $('#lForm');
  const prev = () => { const o = formObj(f);
    $('#lPrev').innerHTML = `<div class="pl-head"><img src="/brand/logo/horizontal/ABR-Horizontal-Black.svg" alt=""></div><div class="pl-ref"><span>Ref. ABRL-…</span><span>${esc(o.date)}</span></div>
      <div class="pl-to">${esc(o.toBlock).replace(/\n/g, '<br>')}</div><p><b>Subject: ${esc(o.subject)}</b></p>${letterBody(o.body)}
      <p>${esc(o.closing)}</p><p style="margin-top:34px"><b>${esc(o.signName)}</b><br>${esc(o.signTitle)}<br>Ahmedabad Business Review</p>${o.cc ? `<p class="small"><b>Copy to:</b><br>${esc(o.cc).replace(/\n/g, '<br>')}</p>` : ''}`; };
  f.addEventListener('input', prev); prev();
  f.onsubmit = (e) => { e.preventDefault(); busy($('button', f), async () => {
    const l = await api('letters.issue', formObj(f));
    toast(`Issued ${l.id}`, 'ok'); window.open(l.url.replace(/^https?:\/\/[^/]+/, ''), '_blank');
    f.subject.value = ''; f.body.value = ''; f.toBlock.value = ''; f.cc.value = ''; prev(); draw();
  }).catch(() => {}); };
  const draw = async () => {
    const list = await api('letters.list');
    $('#lList').className = '';
    $('#lList').innerHTML = list.length ? `<table class="p-table"><thead><tr><th>Reference</th><th>Subject</th><th>To</th><th>Date</th><th></th></tr></thead><tbody>
      ${list.map((l) => `<tr><td><code>${esc(l.id)}</code></td><td><a href="${esc(l.url.replace(/^https?:\/\/[^/]+/, ''))}" target="_blank" rel="noopener">${esc(l.subject)}</a></td>
        <td class="small">${esc(String(l.toBlock || '').split('\n')[0])}</td><td class="small">${esc(l.date)}</td>
        <td>${l.status === 'revoked' ? '<span class="p-badge s-rejected">Revoked</span>' : `<button class="p-link" data-copy="${esc(l.url)}">Copy link</button> · <button class="p-link danger" data-rev="${esc(l.id)}">Revoke</button>`}</td></tr>`).join('')}</tbody></table>`
      : '<div class="p-empty">No letters yet.</div>';
    $$('[data-copy]').forEach((b) => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Link copied', 'ok')));
    $$('[data-rev]').forEach((b) => b.onclick = () => confirm('Revoke this letter? It will show as revoked when verified.') && busy(b, async () => { await api('letters.revoke', { id: b.dataset.rev }); draw(); }).catch(() => {}));
  };
  draw();
}

/* =========================================================
   Analytics
   ========================================================= */
async function viewAnalytics() {
  shell('analytics', `<header class="p-head"><h1>Analytics</h1><select id="anDays" class="p-select"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option></select></header><div id="an" class="p-loading">Loading…</div>`);
  const titles = {};
  try { (await api(state.user.canApprove ? 'review.all' : 'articles.mine')).forEach((a) => { if (a.slug) titles['/articles/' + a.slug] = a.title; }); } catch {}
  const label = (p) => titles[p] || ({ '/': 'Home page', '/archive': 'Archive', '/issues': 'Issues', '/write': 'Write for ABR' })[p] || p;
  const draw = async () => {
    const d = await api('analytics.summary', { days: Number($('#anDays').value) });
    const box = $('#an'); box.className = '';
    if (!d.enabled) { box.innerHTML = '<div class="p-alert info">Analytics are not switched on yet. Create a D1 database in Cloudflare and bind it to the Worker as <code>DB</code> (see the README). Page views are counted from then on: no cookies, no personal data.</div>'; return; }
    const seen = Object.fromEntries(d.byDay.map((r) => [r.day, r.views]));
    const series = [];
    for (let t = new Date(d.since + 'T00:00:00Z'); series.length < d.days; t = new Date(t.getTime() + 864e5)) {
      const day = t.toISOString().slice(0, 10); series.push({ day, views: seen[day] || 0 });
    }
    d.byDay = series;
    const max = Math.max(1, ...d.byDay.map((r) => r.views));
    const articleViews = d.pages.filter((p) => p.path.startsWith('/articles/')).reduce((s, p) => s + p.views, 0);
    const bars = (rows, key) => { const m = Math.max(1, ...rows.map((r) => r.views)); return rows.map((r) => `<div class="an-row"><span>${esc(key(r))}</span><span class="an-bar"><i style="width:${(r.views / m) * 100}%"></i></span><b>${r.views.toLocaleString('en-IN')}</b></div>`).join('') || '<span class="muted small">No data yet.</span>'; };
    box.innerHTML = `
    <div class="an-kpis"><div><b>${d.views.toLocaleString('en-IN')}</b><span>page views</span></div><div><b>${articleViews.toLocaleString('en-IN')}</b><span>article views</span></div>
      <div><b>${d.pages.length}</b><span>pages viewed</span></div><div><b>${Number(d.allTime).toLocaleString('en-IN')}</b><span>all-time views</span></div></div>
    <div class="p-card"><h3>Views per day</h3><div class="an-chart">${d.byDay.map((r) => `<span title="${esc(r.day)}: ${r.views}" style="height:${(r.views / max) * 100}%"></span>`).join('')}</div>
      <div class="small muted">${esc(d.since)} to today (India time). Bots and search crawlers are not counted.</div></div>
    <div class="p-two"><div class="p-card"><h3>Top pages</h3>${bars(d.pages.slice(0, 25), (r) => label(r.path))}</div>
      <div><div class="p-card"><h3>Where readers come from</h3>${bars(d.refs, (r) => r.ref)}</div><div class="p-card"><h3>Countries</h3>${bars(d.countries, (r) => r.country || 'Unknown')}</div></div></div>`;
  };
  $('#anDays').onchange = () => draw().catch((e) => toast(e.message));
  await draw();
}


/* =========================================================
   Approval records (Chair)
   ========================================================= */
async function viewApprovals() {
  shell('approvals', `<header class="p-head"><h1>Approvals</h1><button class="btn ghost" id="apSet">Settings</button></header>
  <p class="small muted">Every significant approval creates a numbered record on ABR letterhead, in black and white, to print, sign and file. <b>Standard</b> approvals are one page signed by the Chairperson. <b>Major</b> approvals are two pages: page 1 for the countersignature (for example the President of ACRI), page 2 for the Chairperson.</p>
  <div class="p-tabs" id="apTabs"></div>
  <div id="apList" class="p-loading">Loading…</div>
  <form id="apNew" class="p-card"><h3>New approval record</h3>
    <p class="small muted">For approvals made outside the portal: budgets, events, appointments, agreements, purchases.</p>
    <label>Subject<input name="subject" required placeholder="Approval of budget for ABR Roundtable, December 2026"></label>
    <label>Matter <span class="muted">(what is being approved)</span><textarea name="description" rows="4"></textarea></label>
    <div class="p-grid2">
      <label>Amount <span class="muted">(optional)</span><input name="amount" placeholder="₹45,000"></label>
      <label>Reference <span class="muted">(optional)</span><input name="reference" placeholder="Quotation no., email date…"></label>
      <label>Date of decision<input type="date" name="date" value="${new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10)}"></label>
      <label>Level<select name="level"><option value="standard">Standard: 1 page, Chairperson signs</option><option value="major">Major: 2 pages, countersignature first</option></select></label>
      <label>Countersigned by <span class="muted">(major only)</span><input name="countersignRole" list="csOpts" value="President, Ahmedabad Centre for Research and Innovation"></label>
      <label>Countersignatory’s name <span class="muted">(optional)</span><input name="countersignName"></label>
    </div>
    <datalist id="csOpts"></datalist>
    <label>Note <span class="muted">(optional, printed on the record)</span><input name="note"></label>
    <button class="btn">Create record</button>
  </form>`);
  let tab = 'to_print', data = null;
  const draw = () => {
    const c = data.counts;
    $('#apTabs').innerHTML = [['to_print', 'To print', c.to_print], ['printed', 'Printed · awaiting filing', c.printed], ['filed', 'Filed', c.filed], ['all', 'All', data.list.length]]
      .map(([k, l, n]) => `<button class="p-tab ${tab === k ? 'on' : ''}" data-t="${k}">${l} <span class="p-count">${n}</span></button>`).join('');
    $$('#apTabs .p-tab').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
    const rows = data.list.filter((r) => tab === 'all' || r.status === tab);
    $('#apList').className = '';
    $('#apList').innerHTML = rows.length ? `<table class="p-table"><thead><tr><th>Reference</th><th>Approval</th><th>Signatures</th><th>Decided</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr data-id="${esc(r.id)}"><td><code>${esc(r.id)}</code></td>
        <td><b>${esc(r.subject)}</b><div class="muted small">${esc(r.kindLabel)}${r.decidedByName ? ' · ' + esc(r.decidedByName) : ''}</div></td>
        <td class="small">${r.level === 'major' ? `2 pages<br><span class="muted">${esc(r.countersignRole)}</span><br>then Chairperson` : '1 page<br>Chairperson'}</td>
        <td class="small">${fmt(r.decidedAt)}</td>
        <td class="small">${r.status === 'filed' ? `Filed<br><span class="muted">${esc(r.fileRef)}</span>` : r.status === 'printed' ? 'Printed' : r.status === 'void' ? 'Cancelled' : '<b>To print</b>'}</td>
        <td class="p-actions">${r.status === 'void' ? '' : `
          <button class="p-link a-print">Print now</button> · <a class="p-link" href="${esc(r.pdfUrl)}" target="_blank" rel="noopener">PDF</a>
          ${r.status !== 'filed' ? ' · <button class="p-link a-file">Mark filed</button>' : ' · <button class="p-link a-unfile">Reopen</button>'}
          · <button class="p-link danger a-void">Cancel</button>`}</td></tr>`).join('')}</tbody></table>`
      : `<div class="p-empty">${tab === 'to_print' ? 'Nothing waiting to be printed.' : 'No records here.'}</div>`;
    $$('#apList tr[data-id]').forEach((tr) => {
      const r = data.list.find((x) => x.id === tr.dataset.id);
      const on = (sel, fn) => { const el = $(sel, tr); if (el) el.onclick = fn; };
      on('.a-print', () => { window.open(r.printUrl + '&print=1', '_blank'); if (r.status === 'to_print') api('approvals.mark', { id: r.id, status: 'printed' }).then((d) => { data = d; draw(); }).catch(() => {}); });
      on('.a-file', (e) => { const ref = prompt('File number or location of the signed copy (e.g. ABR/ADMIN/2026/04):'); if (ref) busy(e.target, async () => { data = await api('approvals.mark', { id: r.id, status: 'filed', fileRef: ref }); draw(); toast('Marked as filed', 'ok'); }).catch(() => {}); });
      on('.a-unfile', (e) => busy(e.target, async () => { data = await api('approvals.mark', { id: r.id, status: 'to_print' }); draw(); }).catch(() => {}));
      on('.a-void', (e) => { const why = prompt('Reason for cancelling this record:'); if (why) busy(e.target, async () => { data = await api('approvals.mark', { id: r.id, status: 'void', note: why }); draw(); }).catch(() => {}); });
    });
  };
  data = await api('approvals.list');
  draw();
  const f = $('#apNew');
  f.onsubmit = (e) => { e.preventDefault(); busy($('button', f), async () => { await api('approvals.create', formObj(f)); f.subject.value = ''; f.description.value = ''; f.amount.value = ''; f.reference.value = ''; f.note.value = ''; data = await api('approvals.list'); tab = 'to_print'; draw(); }).catch(() => {}); };
  $('#apSet').onclick = () => approvalSettings();
  api('approvals.settings.get').then((st) => { $('#csOpts').innerHTML = st.options.map((o) => `<option value="${esc(o)}">`).join(''); }).catch(() => {});
}

async function approvalSettings() {
  const st = await api('approvals.settings.get');
  const m = document.createElement('div');
  m.className = 'p-modal';
  m.innerHTML = `<div class="p-modal-box p-print-box"><button class="p-modal-x" aria-label="Close">×</button>
    <h2>Approval record settings</h2>
    <p class="small muted">Choose which approvals produce a record, whether each is standard (1 page) or major (2 pages with a countersignature first), and who countersigns.</p>
    <datalist id="csOpts2">${st.options.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
    <table class="p-table"><thead><tr><th>On</th><th>Approval</th><th>Level</th><th>Countersigned by (major)</th><th>Name (optional)</th></tr></thead><tbody>
    ${Object.entries(st.kinds).map(([k, v]) => `<tr data-k="${k}"><td><input type="checkbox" class="k-on" ${v.enabled ? 'checked' : ''}></td><td>${esc(v.label)}</td>
      <td><select class="k-level p-input sm"><option value="standard" ${v.level === 'standard' ? 'selected' : ''}>Standard</option><option value="major" ${v.level === 'major' ? 'selected' : ''}>Major</option></select></td>
      <td><input class="k-role p-input sm" list="csOpts2" value="${esc(v.countersignRole)}"></td><td><input class="k-name p-input sm" value="${esc(v.countersignName)}"></td></tr>`).join('')}
    </tbody></table><div class="p-row"><button class="btn" id="kSave">Save</button></div></div>`;
  document.body.appendChild(m);
  $('.p-modal-x', m).onclick = () => m.remove();
  $('#kSave', m).onclick = (e) => busy(e.target, async () => {
    const kinds = {};
    $$('tr[data-k]', m).forEach((tr) => { kinds[tr.dataset.k] = { enabled: $('.k-on', tr).checked, level: $('.k-level', tr).value, countersignRole: $('.k-role', tr).value, countersignName: $('.k-name', tr).value }; });
    await api('approvals.settings.save', { kinds }); toast('Saved', 'ok'); m.remove();
  }).catch(() => {});
}

/* =========================================================
   Markets desk: closing levels shown on /markets
   ========================================================= */
async function viewMarkets() {
  shell('markets', `<header class="p-head"><h1>Markets desk</h1><a class="btn ghost" href="/markets" target="_blank" rel="noopener">View /markets ↗</a></header>
    <p class="small muted">Enter the day’s closing levels after the market closes (3:30 pm IST), from the exchanges’ public websites or another public source, and name it. The site shows them as end-of-day figures, never as live prices. Currency rates update automatically. When ABR has a licensed data feed, this page will fill itself.</p>
    <div id="mkBody" class="p-loading">Loading…</div>`);
  let m = await api('markets.get');
  const nowIst = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10) + 'T15:30';
  const row = (x, i) => `<tr data-i="${i}"><td><input class="p-input mk-name" value="${esc(x.name)}"></td>
    <td><input class="p-input mk-v" inputmode="decimal" value="${x.value === '' ? '' : esc(x.value)}" placeholder="25,322.00"></td>
    <td><input class="p-input mk-c" inputmode="decimal" value="${x.change === '' ? '' : esc(x.change)}" placeholder="+94.05 or -12.4"></td>
    <td><input class="p-input mk-u" value="${esc(x.unit || '')}" placeholder="unit (optional)"></td>
    <td><button type="button" class="p-link danger mk-del">Remove</button></td></tr>`;
  const draw = () => {
    $('#mkBody').className = '';
    $('#mkBody').innerHTML = `<form class="p-card" id="mkForm">
      <div class="p-grid2"><label>Levels as of (IST)<input type="datetime-local" name="asOf" value="${esc(m.asOf ? (m.asOf.length === 10 ? m.asOf + 'T15:30' : m.asOf) : nowIst)}" required></label>
        <label>Source<input name="source" value="${esc(m.source || 'NSE, BSE and MCX websites')}" required></label></div>
      <table class="p-table mk-table"><thead><tr><th>Index or price</th><th>Close</th><th>Change from previous close</th><th>Unit</th><th></th></tr></thead>
        <tbody>${m.items.map(row).join('')}</tbody></table>
      <p><button type="button" class="p-link" id="mkAdd">+ Add a row</button></p>
      <label>Note for readers <span class="muted">(optional, one or two sentences on the day)</span><input name="note" value="${esc(m.note || '')}" placeholder="Markets rose for a third day as oil prices eased."></label>
      <label class="p-check"><input type="checkbox" name="strip" ${m.strip ? 'checked' : ''}> Show these levels in a thin strip above the masthead on every page</label>
      <label class="p-check"><input type="checkbox" name="live" ${m.live !== false ? 'checked' : ''}> Show live prices, stock search and charts on /markets (provided by TradingView)</label>
      <label>Exchange for stock pages<select name="exchange"><option value="BSE" ${m.exchange !== 'NSE' ? 'selected' : ''}>BSE</option><option value="NSE" ${m.exchange === 'NSE' ? 'selected' : ''}>NSE</option></select></label>
      <p class="small muted">If NSE prices do not appear in the widgets, choose BSE. Readers can switch exchange on any stock page.</p>
      <div class="p-row"><button class="btn">Publish levels</button>${m.updatedAt ? `<span class="small muted">Last updated ${fmt(m.updatedAt)} by ${esc(m.updatedBy)}</span>` : ''}</div>
    </form>
    ${m.history && m.history.length ? `<div class="p-card"><h3>Recent closes</h3><table class="p-table"><thead><tr><th>Date</th>${m.items.slice(0, 5).map((x) => `<th>${esc(x.name)}</th>`).join('')}</tr></thead><tbody>
      ${m.history.slice(0, 10).map((h) => `<tr><td>${esc(h.asOf.slice(0, 10))}</td>${m.items.slice(0, 5).map((x) => { const v = (h.items.find((y) => y.key === x.key) || {}).value; return `<td>${v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-IN')}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : ''}`;
    const f = $('#mkForm');
    const collect = () => $$('.mk-table tbody tr', f).map((tr) => ({ key: (m.items[tr.dataset.i] || {}).key, name: $('.mk-name', tr).value, value: $('.mk-v', tr).value, change: $('.mk-c', tr).value, unit: $('.mk-u', tr).value }));
    $('#mkAdd', f).onclick = () => { m.items = collect().concat([{ name: '', value: '', change: '', unit: '' }]); draw(); };
    $$('.mk-del', f).forEach((b) => b.onclick = () => { const l = collect(); l.splice(Number(b.closest('tr').dataset.i), 1); m.items = l; draw(); });
    f.onsubmit = (e) => { e.preventDefault(); busy($('button.btn', f), async () => {
      m = await api('markets.save', { asOf: f.asOf.value, source: f.source.value, note: f.note.value, strip: f.strip.checked, live: f.live.checked, exchange: f.exchange.value, items: collect() });
      draw(); toast('Published. The site updates within a few minutes.', 'ok'); }).catch(() => {}); };
  };
  draw();
}

/* =========================================================
   Planner: task board and editorial calendar
   ========================================================= */
const COLS = [['todo', 'To do'], ['doing', 'In progress'], ['review', 'In review'], ['done', 'Done']];
const plannerState = { who: 'all', issue: '', month: null };
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const dayLabel = (d) => d ? new Date(d + 'T12:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

async function viewPlanner(tab) {
  shell('planner', `<header class="p-head"><h1>Planner</h1>
    <div class="p-row"><a class="btn ${tab === 'board' ? '' : 'ghost'}" href="#/planner">Task board</a><a class="btn ${tab === 'calendar' ? '' : 'ghost'}" href="#/planner/calendar">Calendar</a></div></header>
    <div id="plBody" class="p-loading">Loading…</div>`);
  const d = await api('planner.board');
  if (tab === 'calendar') return plannerCalendar(d);
  plannerBoard(d);
}

function plannerBoard(d) {
  const body = $('#plBody'); body.className = '';
  const s = plannerState;
  const issueName = (k) => String((d.issues.find((i) => i.key === k) || {}).label || k).split(' · ')[0].replace(/ \(.*\)$/, '');
  const draw = () => {
    const tasks = d.tasks.filter((t) => (s.who === 'all' || t.assignee === (s.who === 'me' ? d.me : s.who)) && (!s.issue || t.issueKey === s.issue));
    body.innerHTML = `
    <section class="pl-team" aria-label="Who is working on what">
      ${d.team.map((m) => `<button class="pl-person ${s.who === m.email ? 'on' : ''}" data-who="${esc(m.email)}">
        <span class="pl-av">${esc(initials(m.name))}</span>
        <span class="pl-pmain"><b>${esc(m.name)}</b><small>${esc(m.title || '')}</small>
          <span class="pl-now">${m.current.length ? 'Working on: ' + m.current.map(esc).join(' · ') : m.open ? `${m.open} open task${m.open === 1 ? '' : 's'}, none started` : 'No open tasks'}</span></span>
        <span class="pl-nums"><b>${m.open}</b> open${m.overdue ? `<em>${m.overdue} overdue</em>` : ''}</span></button>`).join('')}
    </section>
    <div class="pl-bar">
      <div class="p-row">
        <select id="plWho" class="p-select sm"><option value="all">Everyone</option><option value="me" ${s.who === 'me' ? 'selected' : ''}>My tasks</option>
          ${d.team.map((m) => `<option value="${esc(m.email)}" ${s.who === m.email ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
        <select id="plIssue" class="p-select sm"><option value="">All issues</option>${d.issues.map((i) => `<option value="${esc(i.key)}" ${s.issue === i.key ? 'selected' : ''}>${esc(i.label)}</option>`).join('')}</select>
      </div>
      <button class="btn" id="plNew">New task</button>
    </div>
    <div class="pl-board">${COLS.map(([k, l]) => {
      const list = tasks.filter((t) => t.status === k);
      return `<section class="pl-col" data-col="${k}"><header><h3>${l}</h3><span>${list.length}</span></header>
        <div class="pl-drop">${list.map((t) => `<article class="pl-card ${t.overdue ? 'late' : ''} ${t.priority === 'high' ? 'hi' : ''}" draggable="true" data-id="${esc(t.id)}">
          <div class="pl-kind">${esc(t.kindLabel)}${t.priority === 'high' ? ' · <b>High</b>' : ''}</div>
          <h4>${esc(t.title)}</h4>
          ${t.issueKey || t.articleId ? `<div class="pl-tags">${t.issueKey ? `<span>${esc(issueName(t.issueKey))}</span>` : ''}${t.articleId ? `<span>${esc(t.articleId)}</span>` : ''}</div>` : ''}
          <footer><span class="pl-av sm" title="${esc(t.assigneeName)}">${esc(initials(t.assigneeName))}</span><span class="pl-who">${esc(t.assigneeName)}</span>
            ${t.due ? `<span class="pl-due ${t.overdue ? 'late' : t.dueSoon ? 'soon' : ''}">${t.overdue ? 'Overdue · ' : ''}${dayLabel(t.due)}</span>` : ''}</footer>
          <div class="pl-move">${COLS.filter(([c]) => c !== k).map(([c, cl]) => `<button data-to="${c}" title="Move to ${cl}">→ ${cl}</button>`).join('')}</div>
        </article>`).join('') || '<p class="pl-none">Nothing here</p>'}</div></section>`;
    }).join('')}</div>`;
    $$('.pl-person', body).forEach((b) => b.onclick = () => { s.who = s.who === b.dataset.who ? 'all' : b.dataset.who; draw(); });
    $('#plWho').onchange = (e) => { s.who = e.target.value; draw(); };
    $('#plIssue').onchange = (e) => { s.issue = e.target.value; draw(); };
    $('#plNew').onclick = () => taskModal(d, null, draw);
    $$('.pl-card', body).forEach((c) => {
      const t = d.tasks.find((x) => x.id === c.dataset.id);
      c.onclick = (e) => { if (!e.target.closest('.pl-move')) taskModal(d, t, draw); };
      c.ondragstart = (e) => { e.dataTransfer.setData('text/plain', t.id); c.classList.add('drag'); };
      c.ondragend = () => c.classList.remove('drag');
      $$('.pl-move button', c).forEach((b) => b.onclick = () => moveTask(d, t, b.dataset.to, draw));
    });
    $$('.pl-col', body).forEach((col) => {
      col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
      col.ondragleave = () => col.classList.remove('over');
      col.ondrop = (e) => { e.preventDefault(); col.classList.remove('over'); const t = d.tasks.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (t && t.status !== col.dataset.col) moveTask(d, t, col.dataset.col, draw); };
    });
  };
  draw();
}

async function moveTask(d, t, to, draw) {
  const prev = t.status; t.status = to; draw();
  try { Object.assign(t, await api('planner.task.move', { id: t.id, status: to })); refreshTeam(d); draw(); }
  catch { t.status = prev; draw(); }
}
function refreshTeam(d) {
  d.team.forEach((m) => {
    const mine = d.tasks.filter((t) => t.assignee === m.email && t.status !== 'done');
    m.open = mine.length; m.overdue = mine.filter((t) => t.overdue).length;
    m.current = mine.filter((t) => t.status === 'doing').map((t) => t.title).slice(0, 3);
  });
}

function taskModal(d, t, draw) {
  const m = document.createElement('div');
  m.className = 'p-modal';
  const mine = !t || t.assignee === d.me || t.createdBy === d.me || d.canAssign;
  const opt = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  m.innerHTML = `<form class="p-modal-box p-card p-modal-sm"><button type="button" class="p-modal-x" aria-label="Close">×</button>
    <h2>${t ? 'Task' : 'New task'}</h2>
    <label>Task<input name="title" value="${esc(t ? t.title : '')}" required placeholder="Edit the Morbi ceramics article"></label>
    <div class="p-grid2">
      <label>Assigned to<select name="assignee" ${d.canAssign ? '' : 'disabled'}>${opt(d.team.map((x) => [x.email, x.name + (x.title ? ' · ' + x.title : '')]), t ? t.assignee : d.me)}</select></label>
      <label>Type of work<select name="kind">${opt(Object.entries(d.kinds), t ? t.kind : 'edit')}</select></label>
      <label>Due<input type="date" name="due" value="${esc(t ? t.due : '')}"></label>
      <label>Status<select name="status">${opt(COLS, t ? t.status : 'todo')}</select></label>
      <label>Issue <span class="muted">(optional)</span><select name="issueKey"><option value="">None</option>${opt(d.issues.map((i) => [i.key, i.label]), t ? t.issueKey : plannerState.issue)}</select></label>
      <label>Article <span class="muted">(optional)</span><select name="articleId"><option value="">None</option>${opt(d.articles.map((a) => [a.id, a.id + ': ' + a.title.slice(0, 50)]), t ? t.articleId : '')}</select></label>
    </div>
    <label class="p-check"><input type="checkbox" name="high" ${t && t.priority === 'high' ? 'checked' : ''}> High priority</label>
    <label>Notes<textarea name="notes" rows="4">${esc(t ? t.notes : '')}</textarea></label>
    ${!d.canAssign ? '<p class="small muted">You can create tasks for yourself. The Chair, EiC or COO assign work to others.</p>' : ''}
    <div class="p-row">${mine ? '<button class="btn">Save</button>' : '<span class="muted small">Only the assignee, its creator or a lead can edit this task.</span>'}
      ${t && (d.canAssign || t.createdBy === d.me) ? '<button type="button" class="p-link danger" id="tDel">Delete task</button>' : ''}</div></form>`;
  document.body.appendChild(m);
  const f = $('form', m);
  $('.p-modal-x', m).onclick = () => m.remove();
  f.onsubmit = (e) => { e.preventDefault(); busy($('button.btn', m), async () => {
    const o = formObj(f); o.priority = f.high.checked ? 'high' : 'normal'; delete o.high;
    if (!d.canAssign) o.assignee = t ? t.assignee : d.me;
    if (t) o.id = t.id;
    const saved = await api('planner.task.save', o);
    if (t) Object.assign(t, saved); else d.tasks.push(saved);
    refreshTeam(d); m.remove(); draw(); toast('Saved', 'ok'); }).catch(() => {}); };
  const del = $('#tDel', m);
  if (del) del.onclick = () => { if (confirm('Delete this task?')) busy(del, async () => { await api('planner.task.delete', { id: t.id }); d.tasks = d.tasks.filter((x) => x.id !== t.id); refreshTeam(d); m.remove(); draw(); }).catch(() => {}); };
}

async function plannerCalendar(d) {
  const body = $('#plBody'); body.className = '';
  const s = plannerState;
  const today = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  if (!s.month) s.month = today.slice(0, 7);
  const ymd = (dt) => dt.toISOString().slice(0, 10);
  const load = async () => {
    const [y, mo] = s.month.split('-').map(Number);
    const first = new Date(Date.UTC(y, mo - 1, 1));
    const start = new Date(first); start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));   // Monday-start grid
    const end = new Date(start); end.setUTCDate(start.getUTCDate() + 41);
    body.innerHTML = '<p class="p-loading">Loading…</p>';
    const cal = await api('planner.calendar', { from: ymd(start), to: ymd(end) });
    const byDay = {};
    cal.items.forEach((x) => (byDay[x.date] = byDay[x.date] || []).push(x));
    const chip = (x) => `<button class="pl-chip t-${x.type} k-${esc(x.kind || '')} ${x.overdue ? 'late' : ''} ${x.status === 'done' ? 'done' : ''}" data-type="${x.type}" data-id="${esc(x.id)}" title="${esc(x.title)}${x.who ? ' · ' + esc(x.who) : ''}">
      ${x.type === 'task' ? `<span class="pl-av xs">${esc(initials(x.who))}</span>` : ''}${esc(x.title)}</button>`;
    const days = [];
    for (let i = 0; i < 42; i++) { const dt = new Date(start); dt.setUTCDate(start.getUTCDate() + i); days.push(ymd(dt)); }
    const upcoming = cal.items.filter((x) => x.date >= today && (x.type === 'event' || x.type === 'term')).slice(0, 8);
    body.innerHTML = `<div class="pl-bar">
        <div class="p-row"><button class="btn ghost sm" id="cPrev">←</button><h2 class="pl-month">${first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2><button class="btn ghost sm" id="cNext">→</button><button class="p-link" id="cToday">Today</button></div>
        ${d.canAssign ? '<div class="p-row"><button class="btn ghost" id="cCycle">Plan an issue cycle</button><button class="btn" id="cAdd">Add date</button></div>' : ''}</div>
      <div class="pl-legend"><span class="t-event k-deadline">Deadline</span><span class="t-event k-meeting">Meeting</span><span class="t-event k-publication">Publication</span><span class="t-task">Task due</span><span class="t-published">Article published</span><span class="t-term">Term ends</span></div>
      <div class="pl-cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => `<div class="pl-wd">${w}</div>`).join('')}
        ${days.map((dd) => `<div class="pl-day ${dd.slice(0, 7) !== s.month ? 'out' : ''} ${dd === today ? 'today' : ''}" data-day="${dd}"><span class="pl-dn">${Number(dd.slice(8))}</span>${(() => { const l = (byDay[dd] || []).slice().sort((p1, p2) => (p1.type === 'published') - (p2.type === 'published')); return l.slice(0, 4).map(chip).join('') + (l.length > 4 ? `<span class="pl-more" title="${esc(l.slice(4).map((x) => x.title).join('\n'))}">+${l.length - 4} more</span>` : ''); })()}</div>`).join('')}</div>
      ${upcoming.length ? `<section class="p-card pl-up"><h3>Coming up</h3><ul>${upcoming.map((x) => `<li><b>${dayLabel(x.date)}</b> ${esc(x.title)}</li>`).join('')}</ul></section>` : ''}`;
    const shift = (n) => { const [yy, mm] = s.month.split('-').map(Number); const dt = new Date(Date.UTC(yy, mm - 1 + n, 1)); s.month = dt.toISOString().slice(0, 7); load(); };
    $('#cPrev').onclick = () => shift(-1); $('#cNext').onclick = () => shift(1); $('#cToday').onclick = () => { s.month = today.slice(0, 7); load(); };
    if ($('#cAdd')) $('#cAdd').onclick = () => eventModal(d, null, today, load);
    if ($('#cCycle')) $('#cCycle').onclick = () => cycleModal(d, load);
    $$('.pl-chip', body).forEach((c) => c.onclick = (e) => {
      e.stopPropagation();
      const x = cal.items.find((i) => i.id === c.dataset.id && i.type === c.dataset.type);
      if (x.type === 'event' && d.canAssign) return eventModal(d, x, x.date, load);
      if (x.type === 'task') { const t = d.tasks.find((tt) => tt.id === x.id); if (t) return taskModal(d, t, load); }
      if (x.type === 'published') return go('#/all');
      toast(x.title);
    });
    if (d.canAssign) $$('.pl-day', body).forEach((c) => c.ondblclick = () => eventModal(d, null, c.dataset.day, load));
  };
  await load();
}

function eventModal(d, x, day, done) {
  const m = document.createElement('div');
  m.className = 'p-modal';
  m.innerHTML = `<form class="p-modal-box p-card p-modal-sm"><button type="button" class="p-modal-x" aria-label="Close">×</button>
    <h2>${x ? 'Calendar date' : 'Add a date'}</h2>
    <label>Title<input name="title" value="${esc(x ? x.title : '')}" required placeholder="Editorial meeting"></label>
    <div class="p-grid2"><label>Date<input type="date" name="date" value="${esc(x ? x.date : day)}" required></label>
      <label>Type<select name="kind">${Object.entries(d.eventKinds).map(([k, l]) => `<option value="${k}" ${x && x.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label>Issue <span class="muted">(optional)</span><select name="issueKey"><option value="">None</option>${d.issues.map((i) => `<option value="${esc(i.key)}" ${x && x.issueKey === i.key ? 'selected' : ''}>${esc(i.label)}</option>`).join('')}</select></label>
    <label>Notes<textarea name="notes" rows="3">${esc(x ? x.notes || '' : '')}</textarea></label>
    <div class="p-row"><button class="btn">Save</button>${x ? '<button type="button" class="p-link danger" id="eDel">Remove</button>' : ''}</div></form>`;
  document.body.appendChild(m);
  $('.p-modal-x', m).onclick = () => m.remove();
  $('form', m).onsubmit = (e) => { e.preventDefault(); busy($('button.btn', m), async () => { await api('planner.event.save', { ...formObj(e.target), id: x ? x.id : undefined }); m.remove(); done(); }).catch(() => {}); };
  const del = $('#eDel', m);
  if (del) del.onclick = () => busy(del, async () => { await api('planner.event.delete', { id: x.id }); m.remove(); done(); }).catch(() => {});
}

function cycleModal(d, done) {
  const m = document.createElement('div');
  m.className = 'p-modal';
  m.innerHTML = `<form class="p-modal-box p-card p-modal-sm"><button type="button" class="p-modal-x" aria-label="Close">×</button>
    <h2>Plan an issue cycle</h2>
    <p class="small muted">Adds the standard milestones to the calendar, counted back from the publication date: pitches agreed (6 weeks before), first drafts (4 weeks), edits and fact-checks (18 days), statements (12 days), Chair’s foreword (10 days), cover and PDF check (1 week), final approval (3 days) and publication. You can move or remove any of them afterwards.</p>
    <div class="p-grid2"><label>Issue<select name="issueKey" required>${d.issues.map((i) => `<option value="${esc(i.key)}">${esc(i.label)}</option>`).join('')}</select></label>
      <label>Publication date<input type="date" name="publishDate" required></label></div>
    <label class="p-check"><input type="checkbox" name="replace"> Replace existing cycle dates for this issue</label>
    <div class="p-row"><button class="btn">Add to calendar</button></div></form>`;
  document.body.appendChild(m);
  $('.p-modal-x', m).onclick = () => m.remove();
  $('form', m).onsubmit = (e) => { e.preventDefault(); const f = e.target; busy($('button.btn', m), async () => {
    const r = await api('planner.cycle', { issueKey: f.issueKey.value, publishDate: f.publishDate.value, replace: f.replace.checked });
    m.remove(); plannerState.month = f.publishDate.value.slice(0, 7); toast(`${r.created} dates added`, 'ok'); done(); }).catch(() => {}); };
  if (!d.issues.length) { $('form', m).innerHTML = '<button type="button" class="p-modal-x">×</button><h2>Plan an issue cycle</h2><p>Create the issue first, under Issues.</p>'; $('.p-modal-x', m).onclick = () => m.remove(); }
}

/* =========================================================
   Permissions (requests to reuse ABR material)
   ========================================================= */
const PERM_ROLES = ['chair', 'eic', 'coo'];

async function viewPermissions() {
  shell('perms', `<header class="p-head"><h1>Permissions</h1>${state.user.role === 'chair' ? '<button class="btn ghost" id="pmSet">Settings</button>' : ''}</header>
  <p class="small muted">Requests from people who want to reuse ABR articles or issues. When you approve, a numbered licence grant (ABRP-…) is issued on letterhead and emailed to the requester automatically. Anyone can verify it at /verify.</p>
  <div class="p-tabs" id="pmTabs"></div><div id="pmList" class="p-loading">Loading…</div>`);
  let tab = 'pending', data = await api('perms.list');
  const status = (x) => x.status === 'approved' ? (x.expired ? 'Expired' : '<b>Granted</b>') : x.status === 'pending' ? '<b>Awaiting decision</b>' : x.status === 'declined' ? 'Declined' : 'Revoked';
  const draw = () => {
    const c = data.counts;
    $('#pmTabs').innerHTML = [['pending', 'Awaiting decision', c.pending], ['approved', 'Granted', c.approved], ['declined', 'Declined', c.declined], ['revoked', 'Revoked', c.revoked], ['all', 'All', data.list.length]]
      .map(([k, l, n]) => `<button class="p-tab ${tab === k ? 'on' : ''}" data-t="${k}">${l} <span class="p-count">${n}</span></button>`).join('');
    $$('#pmTabs .p-tab').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
    const rows = data.list.filter((x) => tab === 'all' || x.status === tab);
    $('#pmList').className = '';
    $('#pmList').innerHTML = rows.length ? `<table class="p-table"><thead><tr><th>Reference</th><th>Material</th><th>Requested by</th><th>Use</th><th>Period</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((x) => `<tr data-id="${esc(x.id)}"><td><code>${esc(x.id)}</code><div class="muted small">${fmt(x.createdAt)}</div></td>
        <td><b>${esc(x.refTitle)}</b><div class="muted small">${esc(x.refId)}</div></td>
        <td>${esc(x.name)}<div class="muted small">${esc([x.designation, x.organisation].filter(Boolean).join(', '))}<br>${esc(x.email)}</div></td>
        <td class="small">${esc(x.useLabel)}${x.commercial ? ' <b>(commercial)</b>' : ''}<br><span class="muted">${esc(x.portionLabel)} · ${esc(x.adaptationLabel)} · ${esc(x.mediumLabel)}${x.audience ? ' · ' + esc(x.audience) : ''} · ${esc(x.territory)}</span>
          <details><summary class="p-link">Purpose</summary><p class="small">${esc(x.purpose)}</p></details></td>
        <td class="small">${esc(x.startDate)}<br>to ${esc(x.endDate)}</td>
        <td class="small">${status(x)}${x.decidedByName ? `<div class="muted">${esc(x.decidedByName)}</div>` : ''}${x.note ? `<div class="muted">${esc(x.note)}</div>` : ''}</td>
        <td class="p-actions">${x.status === 'pending' ? '<button class="btn sm a-ok">Approve…</button> <button class="p-link danger a-no">Decline</button>'
          : x.status === 'approved' ? `<a class="p-link" href="${esc(x.url)}" target="_blank" rel="noopener">View licence</a> · <button class="p-link danger a-rev">Revoke</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<div class="p-empty">${tab === 'pending' ? 'No requests waiting. Requests arrive from the “Request permission” button on every article and issue.' : 'Nothing here.'}</div>`;
    $$('#pmList tr[data-id]').forEach((tr) => {
      const x = data.list.find((r) => r.id === tr.dataset.id);
      const on = (sel, fn) => { const el = $(sel, tr); if (el) el.onclick = fn; };
      on('.a-ok', () => approveModal(x));
      on('.a-no', (e) => { const why = prompt('Why can’t we grant this? The requester will see your reason.'); if (why) busy(e.target, async () => { data = await api('perms.decide', { id: x.id, decision: 'decline', note: why }); draw(); toast('Declined and emailed', 'ok'); }).catch(() => {}); });
      on('.a-rev', (e) => { const why = prompt('Reason for revoking (shown when the licence is verified):'); if (why) busy(e.target, async () => { data = await api('perms.revoke', { id: x.id, note: why }); draw(); toast('Licence revoked', 'ok'); }).catch(() => {}); });
    });
  };
  const approveModal = (x) => {
    const m = document.createElement('div');
    m.className = 'p-modal';
    m.innerHTML = `<form class="p-modal-box p-card p-modal-sm"><button type="button" class="p-modal-x" aria-label="Close">×</button>
      <h2>Grant licence ${esc(x.id)}</h2>
      <p class="small"><b>${esc(x.name)}</b>${x.organisation ? ', ' + esc(x.organisation) : ''} · ${esc(x.useLabel)}${x.commercial ? ' (commercial)' : ''}<br><span class="muted">${esc(x.refTitle)}</span></p>
      <div class="p-grid2"><label>Valid until<input type="date" name="endDate" value="${esc(x.endDate)}"></label>
        <label>Fee <span class="muted">(optional)</span><input name="fee" placeholder="${x.commercial ? '₹5,000, paid on 20 Nov 2026' : 'None'}"></label></div>
      <label>Conditions <span class="muted">(one per line; printed on the grant)</span><textarea name="conditions" rows="7">${esc(data.settings.conditions)}</textarea></label>
      <label>Note to the requester <span class="muted">(optional)</span><input name="note"></label>
      <p class="small muted">On approval the requester is emailed the licence grant at once.${x.commercial ? ' Commercial grants also create a two-page approval record.' : ''}</p>
      <div class="p-row"><button class="btn">Approve and issue licence</button></div></form>`;
    document.body.appendChild(m);
    $('.p-modal-x', m).onclick = () => m.remove();
    $('form', m).onsubmit = (e) => { e.preventDefault(); busy($('button.btn', m), async () => {
      data = await api('perms.decide', { id: x.id, decision: 'approve', ...formObj(e.target) }); m.remove(); tab = 'approved'; draw(); toast('Licence issued and emailed', 'ok'); }).catch(() => {}); };
  };
  draw();
  const set = $('#pmSet');
  if (set) set.onclick = () => {
    const st = data.settings;
    const m = document.createElement('div');
    m.className = 'p-modal';
    m.innerHTML = `<form class="p-modal-box p-card p-modal-sm"><button type="button" class="p-modal-x" aria-label="Close">×</button><h2>Permission settings</h2>
      <p class="small muted">Licence for published articles: <b>${esc(data.licence.label)}</b>. Change it under Settings → DOIs.</p>
      <label class="p-check"><input type="checkbox" name="autoEducation" ${st.autoEducation ? 'checked' : ''}> Approve automatically: classroom teaching, course packs and academic research, non-commercial, material used unchanged</label>
      <label>Longest licence period (years)<input type="number" name="maxYears" min="1" max="10" value="${st.maxYears}"></label>
      <label>Standard conditions <span class="muted">(one per line)</span><textarea name="conditions" rows="8">${esc(st.conditions)}</textarea></label>
      <div class="p-row"><button class="btn">Save</button></div></form>`;
    document.body.appendChild(m);
    $('.p-modal-x', m).onclick = () => m.remove();
    $('form', m).onsubmit = (e) => { e.preventDefault(); const f = e.target; busy($('button.btn', m), async () => {
      data.settings = await api('perms.settings.save', { autoEducation: f.autoEducation.checked, maxYears: f.maxYears.value, conditions: f.conditions.value }); m.remove(); toast('Saved', 'ok'); }).catch(() => {}); };
  };
}

/* =========================================================
   Router
   ========================================================= */
async function render() {
  const hash = location.hash || '#/';
  clearInterval(state.autosave);
  if (hash === '#/reset/done') return go('#/login');
  if (hash.startsWith('#/reset/')) return viewReset(decodeURIComponent(hash.slice(8)));
  if (hash === '#/forgot') return viewForgot();
  if (!state.token) return viewLogin();
  if (!state.user) {
    try {
      const r = await api('auth.me');
      state.user = r.user; state.config = r.config;
    } catch { return viewLogin(); }
  }
  if (hash === '#/login') return go('#/');
  if (state.user.needsAgreement) return viewAgreement();
  const [, route, id] = hash.split('/');
  try {
    if (!route) return await viewMine();
    if (route === 'new') return await viewEditor(null);
    if (route === 'edit' && id) return await viewEditor(decodeURIComponent(id));
    if (route === 'review' && state.user.canApprove) return await viewReview();
    if (route === 'all' && state.user.canApprove) return await viewAll();
    if (route === 'import' && state.user.canApprove) return await viewImport();
    if (route === 'partners' && state.user.canApprove) return await viewPartners();
    if (route === 'ai' && state.user.canAi) return await viewAi();
    if (route === 'issues') return await viewIssues();
    if (route === 'planner') return await viewPlanner(id === 'calendar' ? 'calendar' : 'board');
    if (route === 'markets') return await viewMarkets();
    if (route === 'analytics' && ANALYTICS_ROLES.includes(state.user.role)) return await viewAnalytics();
    if (route === 'permissions' && PERM_ROLES.includes(state.user.role)) return await viewPermissions();
    if (route === 'certificates' && state.user.canAdmin) return await viewCerts();
    if (route === 'approvals' && state.user.canAdmin) return await viewApprovals();
    if (route === 'letters' && state.user.canAdmin) return await viewLetters();
    if (route === 'team' && state.user.canAdmin) return await viewTeam();
    if (route === 'settings' && state.user.canAdmin) return await viewSettings();
    if (route === 'mail' && state.user.canMail) return await viewMail();
    if (route === 'subscribers' && state.user.canMail) return await viewSubscribers();
    if (route === 'profile') return viewProfile();
    go('#/');
  } catch (e) {
    if (state.user) shell('', `<div class="p-alert">${esc(e.message)}</div>`);
  }
}

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  if (state.dirty && !confirm('You have unsaved changes. Leave this page?')) {
    history.replaceState(null, '', lastHash);
    return;
  }
  state.dirty = false;
  lastHash = location.hash;
  render();
});
window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
render();
