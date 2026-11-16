import { sanitizeHtml, textFromHtml } from '/assets/sanitize.js';

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
  return j.data;
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
    ['#/issues', 'Issues', 'issues'],
    ...(ANALYTICS_ROLES.includes(u.role) ? [['#/analytics', 'Analytics', 'analytics']] : []),
    ...(u.canMail ? [['#/mail', 'Email', 'mail'], ['#/subscribers', 'Subscribers', 'subs']] : []),
    ...(u.canAdmin ? [['#/certificates', 'Certificates', 'certs'], ['#/letters', 'Letters', 'letters'], ['#/team', 'Team', 'team'], ['#/settings', 'Settings', 'settings']] : []),
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
      state.token = r.token; state.user = r.user; state.config = r.config;
      localStorage.setItem('abr_token', r.token);
      go('#/');
    }).catch(() => {});
  };
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
    `<table class="p-table"><thead><tr><th>Name</th><th>Role</th><th>Term ends</th><th>Public title</th><th>Status</th><th>Agreement</th><th></th></tr></thead><tbody>
    ${list.map((m) => `<tr data-email="${esc(m.email)}" data-role="${esc(m.role)}">
      <td><b>${esc(m.name)}</b><div class="muted small">${esc(m.email)}</div></td>
      <td><select class="p-select sm r-role" ${m.email === state.user.email ? 'disabled' : ''}>${Object.entries(state.config.roles).map(([k, v]) => `<option value="${k}" ${k === m.role ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></td>
      <td class="small"><input type="date" class="p-input sm r-term" value="${esc(m.termEnd || '')}" ${TERM_ROLES.includes(m.role) ? '' : 'hidden'}>
        ${m.termEnd ? `<div class="muted">${(() => { const d = Math.round((new Date(m.termEnd) - new Date(today)) / 864e5); return d >= 0 ? d + ' days left' : 'ended'; })()}${m.termStart ? ' · since ' + esc(m.termStart) : ''}</div>` : TERM_ROLES.includes(m.role) ? '<span class="muted">No end date</span>' : ''}</td>
      <td><input class="p-input sm r-title" value="${esc(m.title)}"></td>
      <td>${m.active ? '<span class="p-badge s-published">Active</span>' : '<span class="p-badge s-rejected">Disabled</span>'}</td>
      <td class="small">${(() => { const g = agrBy[m.email]; if (!g) return '—'; if (g.exempt) return '<span class="muted">Not required</span>';
        return g.signed ? `<span class="p-badge s-published">Signed</span> ${fmt(g.signedAt)}${g.fileUrl ? ` · <a href="${esc(g.fileUrl)}" target="_blank" rel="noopener">PDF ↗</a>` : ''}` : '<span class="p-badge s-submitted">Pending</span>'; })()}</td>
      <td><div class="p-row">
        <button class="btn ghost sm r-save">Save</button>
        <button class="p-link r-reset">Reset password</button>
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
    $('#list').innerHTML = rows.length ? `<table class="p-table"><thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Source</th><th>Signed up</th><th></th></tr></thead><tbody>
      ${rows.slice(0, 500).map((s) => `<tr><td>${esc(s.email)}</td><td>${esc(s.name || '')}</td>
        <td><span class="p-badge ${s.status === 'active' ? 's-published' : s.status === 'pending' ? 's-submitted' : 's-rejected'}">${esc(s.status)}</span></td>
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
      <label>Licence<select name="license">${[['cc-by-4.0', 'CC BY 4.0'], ['cc-by-nc-4.0', 'CC BY-NC 4.0'], ['cc-by-nc-nd-4.0', 'CC BY-NC-ND 4.0'], ['cc-by-nd-4.0', 'CC BY-ND 4.0']].map(([v, l]) => `<option value="${v}" ${doi.license === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Zenodo community <span class="muted">(optional identifier)</span><input name="community" value="${esc(doi.community)}" placeholder="e.g. abr"></label>
      <label>Automatic DOIs<select name="enabled"><option value="1" ${doi.enabled ? 'selected' : ''}>On</option><option value="" ${doi.enabled ? '' : 'selected'}>Off</option></select></label>
    </div>
    <div class="p-row"><button class="btn">Save DOI settings</button><button type="button" class="btn ghost" id="doiAll">Register DOIs for all published articles</button><span class="small muted">${doi.queue} in queue</span></div>
  </form>` : ''}`;

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
        ${(i.statements || []).length ? `<details><summary><b>Statements from the team</b></summary>${i.statements.map((s) => `<div class="p-stmt"><b>${esc(s.name)}</b> <span class="muted small">${esc(s.title)} · ${fmt(s.at)}</span><p class="small">${esc(s.text).replace(/\n/g, '<br>')}</p></div>`).join('')}</details>` : ''}
        <div class="p-row">${i.status === 'published' ? '<button class="btn ghost i-reopen">Reopen for changes</button>' : '<button class="btn accent i-publish">Publish issue</button>'}</div>`
      : i.status !== 'published' && d.canStatement ? `
        <label><b>Your statement for this issue</b> <span class="muted small">(optional; printed in the compiled PDF after the Chair’s foreword)</span>
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
  const label = (p) => titles[p] || ({ '/': 'Home page', '/archive': 'Archive', '/issues': 'Issues', '/submit': 'Write for ABR' })[p] || p;
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
    if (route === 'analytics' && ANALYTICS_ROLES.includes(state.user.role)) return await viewAnalytics();
    if (route === 'certificates' && state.user.canAdmin) return await viewCerts();
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
