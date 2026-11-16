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
    ...(u.canApprove ? [['#/review', 'Approval queue', 'review'], ['#/all', 'All articles', 'all']] : []),
    ...(u.canMail ? [['#/mail', 'Email', 'mail'], ['#/subscribers', 'Subscribers', 'subs']] : []),
    ...(u.canAdmin ? [['#/team', 'Team', 'team'], ['#/settings', 'Settings', 'settings']] : []),
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
      <p class="muted small">Accounts are created by the Chair. Forgot your password? Ask the Chair to reset it.</p>
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
      <td><a href="#/edit/${esc(a.id)}" class="p-title-link">${esc(a.title || 'Untitled')}</a><div class="muted small">${esc(a.id)}${a.type ? ' · ' + esc(a.type) : ''}</div>
        ${a.status === 'changes_requested' || a.status === 'rejected' ? `<div class="p-note-inline">Note: ${esc(a.reviewNote)}</div>` : ''}</td>
      ${opts.showAuthors ? `<td>${esc((a.authors || []).join(', '))}</td>` : ''}
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
  const [a, dir] = await Promise.all([
    id ? api('articles.get', { id }) : Promise.resolve({ status: 'draft', authorEmail: state.user.email, body: '' }),
    state.directory ? Promise.resolve(state.directory) : api('team.directory')
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

    ${u.canApprove ? `
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
      section: $('#f_section').value, type: $('#f_type').value, tags: $('#f_tags').value,
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
        <div class="byline"><div>By <a>${names.map(esc).join(' and ')}</a></div><div class="dates">Preview · ${words(p.body)} words</div></div>
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
    $('#list').innerHTML = `<table class="p-table"><thead><tr><th>Name</th><th>Role</th><th>Public title</th><th>Status</th><th>Agreement</th><th></th></tr></thead><tbody>
    ${list.map((m) => `<tr data-email="${esc(m.email)}">
      <td><b>${esc(m.name)}</b><div class="muted small">${esc(m.email)}</div></td>
      <td><select class="p-select sm r-role" ${m.email === state.user.email ? 'disabled' : ''}>${Object.entries(state.config.roles).map(([k, v]) => `<option value="${k}" ${k === m.role ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></td>
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
      $('.r-save', tr).onclick = (e) => busy(e.target, async () => {
        await api('team.save', { email, name, role: $('.r-role', tr).value, title: $('.r-title', tr).value });
        toast('Saved', 'ok');
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

  $('#addForm').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    busy($('button', f), async () => {
      const r = await api('team.save', { name: f.name.value, email: f.email.value, role: f.role.value, title: f.title.value });
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
  const [m, ag] = await Promise.all([api('mail.settings.get'), api('agreement.settings.get')]);
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
  </form>`;

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
   Router
   ========================================================= */
async function render() {
  const hash = location.hash || '#/';
  clearInterval(state.autosave);
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
