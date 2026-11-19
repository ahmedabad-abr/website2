// Write for ABR: contributor accounts (sign up, sign in, reset), dashboard, submit and revise.
import { sanitizeHtml, textFromHtml } from '/assets/sanitize.js?v=20261119-5';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#wApp');
const mount = $('#wMount');
const cfg = (() => { try { return JSON.parse(app.dataset.cfg || '{}'); } catch { return {}; } })();
const KEY = 'abr-contrib';
let session = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } })();
const saveSession = (s) => { session = s; try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch {} };
const fmt = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';

async function api(action, payload = {}) {
  if (session) payload.ctoken = session.token;
  const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload }) });
  const j = await r.json().catch(() => ({ ok: false, error: 'The server could not be reached. Please try again.' }));
  if (!j.ok) {
    if (/session has expired/i.test(j.error || '')) { saveSession(null); setMode(false); authView('login', j.error); }
    throw new Error(j.error || 'Something went wrong.');
  }
  return j.data;
}

// Marketing sections show only when signed out.
function setMode(signedIn) {
  document.querySelectorAll('.w-marketing').forEach((el) => { el.hidden = signedIn; });
  app.classList.toggle('w-in', signedIn);
}
const top = () => mount.scrollIntoView({ behavior: 'smooth', block: 'start' });
function busy(form, on, text) {
  const b = form.querySelector('button[type=submit]');
  if (b) { b.disabled = on; if (text) { b.dataset.t = b.dataset.t || b.textContent; b.textContent = on ? text : b.dataset.t; } }
}
function flash(el, text, bad) { el.textContent = text || ''; el.className = 'w-msg' + (bad ? ' bad' : text ? ' ok' : ''); }

/* ---------------- Signed out ---------------- */

function authView(tab = 'signup', notice = '') {
  setMode(false);
  const tabs = `<div class="w-tabs" role="tablist">
    <button role="tab" data-tab="signup" aria-selected="${tab === 'signup'}">Create account</button>
    <button role="tab" data-tab="login" aria-selected="${tab === 'login'}">Sign in</button></div>`;
  const forms = {
    signup: `<form class="w-form" id="fSignup" novalidate>
      <div class="w-grid2">
        <label class="w-field"><span>Full name</span><input name="name" autocomplete="name" required></label>
        <label class="w-field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
      </div>
      <label class="w-field"><span>Affiliation <em>optional</em></span><input name="affiliation" placeholder="University, company or role"></label>
      <label class="w-field"><span>Password <em>at least 8 characters</em></span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <input name="website" class="w-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="w-btn" type="submit">Create account</button>
      <p class="w-msg" role="status"></p>
      <p class="w-fine">We will email you a link to confirm your address. Your details are used only for your submissions.</p>
    </form>`,
    login: `<form class="w-form" id="fLogin" novalidate>
      <label class="w-field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
      <label class="w-field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="w-btn" type="submit">Sign in</button>
      <p class="w-msg" role="status"></p>
      <p class="w-fine"><a href="#" data-go="forgot">Forgot your password?</a></p>
    </form>`,
    forgot: `<form class="w-form" id="fForgot" novalidate>
      <p class="w-intro">Enter the email you signed up with and we will send you a link to choose a new password.</p>
      <label class="w-field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
      <button class="w-btn" type="submit">Send reset link</button>
      <p class="w-msg" role="status"></p>
      <p class="w-fine"><a href="#" data-go="login">Back to sign in</a></p>
    </form>`
  };
  mount.innerHTML = `<div class="w-auth">
    <div class="w-auth-side"><div class="w-kicker">Contributors</div>
      <h2>${tab === 'login' ? 'Welcome back.' : tab === 'forgot' ? 'Reset your password.' : 'Start writing for ABR.'}</h2>
      <p>One account for all your submissions. Follow every article from submission to publication, send revisions when the editors ask, and download your certificates.</p>
      <p class="w-fine">Already submitted without an account? Sign up with the same email and your earlier submissions appear automatically.</p></div>
    <div class="w-auth-main">${tab === 'forgot' ? '' : tabs}${notice ? `<p class="w-msg ${/expired|incorrect/i.test(notice) ? 'bad' : 'ok'}">${esc(notice)}</p>` : ''}${forms[tab]}</div>
  </div>`;
  mount.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => authView(b.dataset.tab));
  const f = mount.querySelector('form');
  const m = f.querySelector('.w-msg');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    try {
      if (tab === 'signup') {
        busy(f, true, 'Creating…');
        await api('contrib.signup', v);
        mount.querySelector('.w-auth-main').innerHTML = `<div class="w-sent"><div class="w-kicker">Check your inbox</div>
          <h3>Confirm your email</h3><p>We sent a link to <b>${esc(v.email)}</b>. Open it to activate your account. If it is not there in a few minutes, check spam.</p>
          <p class="w-fine"><a href="#" data-go="login">Back to sign in</a></p></div>`;
      } else if (tab === 'login') {
        busy(f, true, 'Signing in…');
        saveSession(await api('contrib.login', v));
        dashboard();
      } else {
        busy(f, true, 'Sending…');
        await api('contrib.forgot', v);
        flash(m, 'If an account exists for that email, a reset link is on its way. It expires in 1 hour.');
        busy(f, false);
      }
    } catch (err) { flash(m, err.message, true); busy(f, false); }
  };
}

function resetView(token) {
  setMode(false);
  mount.innerHTML = `<div class="w-auth"><div class="w-auth-side"><div class="w-kicker">Contributors</div><h2>Choose a new password.</h2><p>The link works once and expires in 1 hour.</p></div>
    <div class="w-auth-main"><form class="w-form" id="fReset">
      <label class="w-field"><span>New password <em>at least 8 characters</em></span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <button class="w-btn" type="submit">Save and sign in</button><p class="w-msg" role="status"></p></form></div></div>`;
  const f = $('#fReset');
  f.onsubmit = async (e) => {
    e.preventDefault(); busy(f, true, 'Saving…');
    try { saveSession(await api('contrib.reset', { token, password: f.password.value })); history.replaceState(null, '', '/write'); dashboard('Your password has been changed.'); }
    catch (err) { flash(f.querySelector('.w-msg'), err.message, true); busy(f, false); }
  };
}

/* ---------------- Signed in ---------------- */

const STATUS = {
  submitted: ['Under review', 'is-review'], changes_requested: ['Changes requested', 'is-action'], rejected: ['Not accepted', 'is-closed'],
  published: ['Published', 'is-done'], withdrawn: ['Withdrawn', 'is-closed'], draft: ['Draft', 'is-review']
};

function shell(active, inner) {
  const c = session.contributor || {};
  setMode(true);
  mount.innerHTML = `<div class="w-dash">
    <header class="w-dash-h">
      <div><div class="w-kicker">Contributor</div><h2>${esc(c.name || 'Your account')}</h2>${c.affiliation ? `<p class="w-sub">${esc(c.affiliation)}</p>` : ''}</div>
      <nav class="w-dash-nav">
        <button data-nav="home" aria-current="${active === 'home'}">Submissions</button>
        <button data-nav="new" aria-current="${active === 'new'}">New article</button>
        <button data-nav="profile" aria-current="${active === 'profile'}">Profile</button>
        <button data-nav="out" class="w-out">Sign out</button>
      </nav>
    </header>
    <div class="w-dash-body">${inner}</div></div>`;
  mount.querySelectorAll('[data-nav]').forEach((b) => b.onclick = () => {
    const n = b.dataset.nav;
    if (n === 'home') dashboard(); else if (n === 'new') editor(); else if (n === 'profile') profile();
    else { api('contrib.logout').catch(() => {}); saveSession(null); authView('login', 'You have signed out.'); }
  });
}

async function dashboard(notice = '') {
  shell('home', `<p class="w-loading">Loading your submissions…</p>`);
  top();
  let d;
  try { d = await api('contrib.submissions'); } catch (err) { $('.w-dash-body').innerHTML = `<p class="w-msg bad">${esc(err.message)}</p>`; return; }
  const subs = d.submissions || [], certs = d.certificates || [];
  const counts = { review: subs.filter((s) => s.status === 'submitted').length, action: subs.filter((s) => s.status === 'changes_requested').length, pub: subs.filter((s) => s.status === 'published').length };
  const item = (s) => {
    const [label, cls] = STATUS[s.status] || [s.status, ''];
    return `<article class="w-sub-item">
      <div class="w-sub-top"><span class="w-pill ${cls}">${label}</span><code>${esc(s.id)}</code></div>
      <h3>${esc(s.title)}</h3>
      <p class="w-meta">${[s.section, s.type, s.wordCount ? Number(s.wordCount).toLocaleString('en-IN') + ' words' : '', s.submittedAt ? 'Sent ' + fmt(s.submittedAt) : ''].filter(Boolean).map(esc).join(' · ')}</p>
      ${s.note ? `<div class="w-note"><b>${s.status === 'rejected' ? 'Editors’ note' : 'What the editors asked for'}</b><p>${esc(s.note)}</p></div>` : ''}
      <ol class="w-timeline">${(s.steps || []).map((t) => `<li><time>${fmt(t.at)}</time><span>${esc(t.label)}</span>${t.note && t.note !== s.note ? `<em>${esc(t.note)}</em>` : ''}</li>`).join('')}</ol>
      <div class="w-sub-actions">
        ${s.canRevise ? `<button class="w-btn" data-revise="${esc(s.id)}">Revise and resend</button>` : ''}
        ${s.url ? `<a class="w-link" href="${esc(s.url.replace(/^https?:\/\/[^/]+/, ''))}">Read it on ABR →</a>` : ''}
        ${s.certificate ? `<a class="w-link" href="/certificates/${esc(s.certificate)}">Your certificate →</a>` : ''}
      </div></article>`;
  };
  $('.w-dash-body').innerHTML = `${notice ? `<p class="w-msg ok">${esc(notice)}</p>` : ''}
    <div class="w-stats"><div><b>${subs.length}</b><span>Submitted</span></div><div><b>${counts.review}</b><span>Under review</span></div>
      <div><b>${counts.action}</b><span>Need your action</span></div><div><b>${counts.pub}</b><span>Published</span></div></div>
    ${subs.length ? `<div class="w-list-h"><h3>Your submissions</h3><button class="w-btn w-btn-ghost" data-new>New article</button></div>${subs.map(item).join('')}`
      : `<div class="w-empty"><h3>You have not submitted anything yet.</h3><p>When you are ready, paste your article from Word or Google Docs. You can follow it here from review to publication.</p><button class="w-btn" data-new>Submit your first article</button></div>`}
    ${certs.length ? `<div class="w-list-h"><h3>Certificates</h3></div><ul class="w-certs">${certs.map((c) => `<li><a href="/certificates/${esc(c.id)}"><b>${esc(c.typeLabel || 'Certificate')}</b><span>${esc((c.detail && (c.detail.title || c.detail.issue)) || c.role || '')}</span><code>${esc(c.id)}</code></a></li>`).join('')}</ul>` : ''}`;
  mount.querySelectorAll('[data-new]').forEach((b) => b.onclick = () => editor());
  mount.querySelectorAll('[data-revise]').forEach((b) => b.onclick = () => editor(b.dataset.revise));
}

async function editor(reviseId) {
  shell(reviseId ? 'home' : 'new', `<p class="w-loading">${reviseId ? 'Loading your article…' : ''}</p>`);
  top();
  let a = null;
  if (reviseId) {
    try { a = await api('contrib.get', { id: reviseId }); } catch (err) { $('.w-dash-body').innerHTML = `<p class="w-msg bad">${esc(err.message)}</p>`; return; }
  }
  const draftKey = 'abr-contrib-draft';
  let draft = null;
  if (!a) { try { draft = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch {} }
  const v = a || draft || {};
  const opt = (list, cur) => `<option value="">Choose…</option>` + (list || []).map((x) => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('');
  $('.w-dash-body').innerHTML = `<form class="w-form w-editor" id="fArticle" novalidate>
    <div class="w-ed-h"><h3>${a ? 'Revise: ' + esc(a.title) : 'New article'}</h3>${draft && !a ? '<span class="w-fine">Draft restored from this browser</span>' : ''}</div>
    ${a && a.note ? `<div class="w-note"><b>What the editors asked for</b><p>${esc(a.note)}</p></div>` : ''}
    <label class="w-field w-big"><span>Title</span><input name="title" value="${esc(v.title)}" maxlength="250" required></label>
    <label class="w-field"><span>Standfirst <em>one or two sentences that tell the reader what the article argues</em></span><textarea name="standfirst" rows="2" maxlength="600" required>${esc(v.standfirst)}</textarea></label>
    ${a ? '' : `<div class="w-grid2">
      <label class="w-field"><span>Section</span><select name="section">${opt(cfg.sections, v.section)}</select></label>
      <label class="w-field"><span>Type</span><select name="type">${opt(cfg.types, v.type)}</select></label></div>`}
    <div class="w-field"><span>Article <em>paste from Word or Google Docs; formatting is kept, images are removed</em></span>
      <div class="w-body" id="wBody" contenteditable="true" role="textbox" aria-multiline="true">${sanitizeHtml(v.body || '')}</div>
      <div class="w-count" id="wCount"></div></div>
    <label class="w-field"><span>References <em>one per line; ${cfg.minRefs || 2} or more for analysis, case studies, explainers and research briefs</em></span><textarea name="sources" rows="5">${esc(v.sources)}</textarea></label>
    ${a ? `<label class="w-field"><span>Note to the editors <em>optional: what you changed</em></span><textarea name="message" rows="3"></textarea></label>`
      : `<label class="w-field"><span>Disclosures <em>AI use, funding, conflicts of interest; write “None” if none</em></span><textarea name="disclosure" rows="2">${esc(v.disclosure)}</textarea></label>
      <fieldset class="w-decl"><legend>Declarations</legend>
        <label><input type="checkbox" name="original"> This is my original work and every source is credited.</label>
        <label><input type="checkbox" name="exclusive"> It has not been published elsewhere, and I will not submit it elsewhere while ABR is reviewing it.</label>
        <label><input type="checkbox" name="edit"> ABR may edit it for length, clarity and style.</label>
        <label><input type="checkbox" name="guidelines"> I have read the <a href="/editorial-standards" target="_blank">editorial standards</a>.</label>
        <label><input type="checkbox" name="licence"> I keep my copyright and grant ACRI a non-exclusive licence to publish, archive and register a DOI for my article, and to license its reuse under ABR’s <a href="/permissions" target="_blank">permissions policy</a> (see the <a href="/terms" target="_blank">terms</a>).</label>
      </fieldset>`}
    <div class="w-ed-foot"><button class="w-btn" type="submit">${a ? 'Send revision' : 'Submit for review'}</button>
      <button class="w-btn w-btn-ghost" type="button" data-cancel>Cancel</button><p class="w-msg" role="status"></p></div>
  </form>`;
  const f = $('#fArticle'), ed = $('#wBody'), m = f.querySelector('.w-msg');
  const count = () => { const n = (textFromHtml(ed.innerHTML).match(/\S+/g) || []).length; $('#wCount').textContent = `${n.toLocaleString('en-IN')} words · 800–2,500 is ideal`; return n; };
  count();
  ed.addEventListener('paste', (e) => {
    const html = e.clipboardData.getData('text/html'), text = e.clipboardData.getData('text/plain');
    e.preventDefault();
    const clean = html ? sanitizeHtml(html).replace(/<img[^>]*>/g, '')
      : text.split(/\n\s*\n/).map((b) => `<p>${esc(b).replace(/\n/g, '<br>')}</p>`).join('');
    document.execCommand('insertHTML', false, clean); count();
  });
  const save = () => { if (a) return; try { const o = Object.fromEntries(new FormData(f)); o.body = ed.innerHTML; localStorage.setItem(draftKey, JSON.stringify(o)); } catch {} };
  ed.addEventListener('input', () => { count(); save(); });
  f.addEventListener('input', save);
  f.querySelector('[data-cancel]').onclick = () => dashboard();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const words = count();
    if (words < 400) return flash(m, `Articles should be at least 400 words (yours has ${words}).`, true);
    const x = f.elements;
    const payload = { title: x.title.value, standfirst: x.standfirst.value, sources: x.sources.value, body: sanitizeHtml(ed.innerHTML) };
    try {
      busy(f, true, 'Sending…');
      if (a) {
        await api('contrib.revise', { ...payload, id: a.id, message: x.message.value });
        dashboard('Your revision has been sent to the editors.');
      } else {
        Object.assign(payload, { section: x.section.value, type: x.type.value, disclosure: x.disclosure.value,
          declarations: { original: x.original.checked, exclusive: x.exclusive.checked, edit: x.edit.checked, guidelines: x.guidelines.checked, licence: x.licence.checked } });
        const r = await api('contrib.submit', payload);
        try { localStorage.removeItem(draftKey); } catch {}
        dashboard(`Thank you. ${r.id} has been sent to the editors. We have emailed you a confirmation.`);
      }
    } catch (err) { flash(m, err.message, true); busy(f, false); }
  };
}

function profile(notice = '') {
  const c = session.contributor || {};
  shell('profile', `<form class="w-form w-narrow" id="fProfile" novalidate>
    ${notice ? `<p class="w-msg ok">${esc(notice)}</p>` : ''}
    <h3>Your profile</h3><p class="w-fine">This is how you are credited when an article is published.</p>
    <label class="w-field"><span>Full name</span><input name="name" value="${esc(c.name)}" required></label>
    <label class="w-field"><span>Email</span><input value="${esc(c.email)}" disabled></label>
    <label class="w-field"><span>Affiliation</span><input name="affiliation" value="${esc(c.affiliation)}"></label>
    <label class="w-field"><span>Short bio <em>up to 500 characters</em></span><textarea name="bio" rows="4" maxlength="500">${esc(c.bio)}</textarea></label>
    <h3 class="w-gap">Change password <em class="w-fine">optional</em></h3>
    <div class="w-grid2"><label class="w-field"><span>Current password</span><input name="currentPassword" type="password" autocomplete="current-password"></label>
      <label class="w-field"><span>New password</span><input name="newPassword" type="password" autocomplete="new-password" minlength="8"></label></div>
    <button class="w-btn" type="submit">Save profile</button><p class="w-msg" role="status"></p></form>`);
  const f = $('#fProfile');
  f.onsubmit = async (e) => {
    e.preventDefault(); busy(f, true, 'Saving…');
    try { const me = await api('contrib.profile', Object.fromEntries(new FormData(f))); saveSession({ ...session, contributor: me }); profile('Profile saved.'); }
    catch (err) { flash(f.querySelector('.w-msg:last-of-type'), err.message, true); busy(f, false); }
  };
}

/* ---------------- Start ---------------- */

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (!g) return;
  e.preventDefault();
  if (session) return dashboard();
  authView(g.dataset.go); top();
});

(async function start() {
  const q = new URLSearchParams(location.search);
  if (q.get('verify')) {
    mount.innerHTML = '<p class="w-loading">Confirming your email…</p>';
    try { saveSession(await api('contrib.verify', { token: q.get('verify') })); history.replaceState(null, '', '/write'); return dashboard('Your email is confirmed. Welcome to ABR.'); }
    catch (err) { history.replaceState(null, '', '/write'); return authView('login', err.message); }
  }
  if (q.get('reset')) return resetView(q.get('reset'));
  if (session) {
    try { const me = await api('contrib.me'); saveSession({ ...session, contributor: me }); return dashboard(); }
    catch { saveSession(null); }
  }
  authView(q.get('tab') === 'login' ? 'login' : 'signup');
})();
