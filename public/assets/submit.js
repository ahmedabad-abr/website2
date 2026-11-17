// "Write for ABR" submission form and the revision form on /track.
import { sanitizeHtml, textFromHtml } from '/assets/sanitize.js';

const $ = (s, r = document) => r.querySelector(s);
const ed = $('#subBody');
const count = () => {
  const n = (textFromHtml(ed.innerHTML).match(/\S+/g) || []).length;
  $('#subCount').textContent = `${n.toLocaleString('en-IN')} words`;
  return n;
};
if (ed) {
  ed.addEventListener('paste', (e) => {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    e.preventDefault();
    const clean = html ? sanitizeHtml(html).replace(/<img[^>]*>/g, '')
      : text.split(/\n\s*\n/).map((b) => `<p>${b.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>')}</p>`).join('');
    document.execCommand('insertHTML', false, clean);
    count();
  });
  ed.addEventListener('input', count);
}

async function api(action, payload) {
  const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload }) });
  const j = await r.json().catch(() => ({ ok: false, error: 'The server could not be reached. Please try again.' }));
  if (!j.ok) throw new Error(j.error || 'Something went wrong.');
  return j.data;
}
const msg = (t, bad) => { const m = $('#subMsg'); m.textContent = t || ''; m.className = 'sub-msg' + (bad ? ' bad' : ''); };

const form = $('#subForm');
if (form) {
  try { const d = JSON.parse(localStorage.getItem('abr-sub') || 'null'); if (d) { for (const [k, v] of Object.entries(d.f)) { const el = form.elements[k]; if (el && el.type !== 'checkbox') el.value = v; } ed.innerHTML = sanitizeHtml(d.body || ''); count(); } } catch {}
  const save = () => { try { const f = {}; for (const el of form.elements) if (el.name && el.type !== 'checkbox' && el.name !== 'website') f[el.name] = el.value; localStorage.setItem('abr-sub', JSON.stringify({ f, body: ed.innerHTML })); } catch {} };
  form.addEventListener('input', save); ed.addEventListener('input', save);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const words = count();
    if (words < 400) return msg(`Articles should be at least 400 words (yours has ${words}).`, true);
    const payload = {
      name: f.name.value, email: f.email.value, affiliation: f.affiliation.value, bio: f.bio.value, website: f.website.value,
      title: f.title.value, standfirst: f.standfirst.value, section: f.section.value, type: f.type.value,
      body: sanitizeHtml(ed.innerHTML), sources: f.sources.value, disclosure: f.disclosure.value,
      declarations: { original: f.original.checked, exclusive: f.exclusive.checked, edit: f.edit.checked, guidelines: f.guidelines.checked }
    };
    const btn = $('#subBtn'); btn.disabled = true; msg('Sending…');
    try {
      const r = await api('public.submit', payload);
      try { localStorage.removeItem('abr-sub'); } catch {}
      form.hidden = true; $('#subDone').hidden = false; $('#subId').textContent = r.id;
      if (r.trackUrl) $('#subTrack').href = r.trackUrl.replace(/^https?:\/\/[^/]+/, '');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { msg(err.message, true); btn.disabled = false; }
  });
}

const rev = $('#revForm');
if (rev) {
  rev.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#subBtn'); btn.disabled = true; msg('Sending…');
    try {
      await api('public.revise', { id: rev.dataset.id, key: rev.dataset.key, body: sanitizeHtml(ed.innerHTML),
        sources: rev.elements.sources.value, message: rev.elements.message.value });
      location.reload();
    } catch (err) { msg(err.message, true); btn.disabled = false; }
  });
}
