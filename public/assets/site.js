// Small enhancements for the public site: citation tabs + copy button.
(function () {
  var accessed = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  document.querySelectorAll('[data-accessed]').forEach(function (el) { el.textContent = accessed; });

  // Newsletter forms: submit without leaving the page.
  document.querySelectorAll('[data-subscribe]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.fetch) return;
      e.preventDefault();
      var msg = form.querySelector('.sub-msg');
      var btn = form.querySelector('button');
      btn.disabled = true;
      fetch('/subscribe', { method: 'POST', headers: { Accept: 'application/json' }, body: new FormData(form) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.ok) { form.classList.add('done'); msg.textContent = 'Almost done. Check your inbox for a confirmation link.'; }
          else { msg.textContent = j.error || 'Something went wrong. Please try again.'; }
        })
        .catch(function () { msg.textContent = 'Network error. Please try again.'; })
        .then(function () { btn.disabled = false; });
    });
  });

  var tabs = document.querySelectorAll('.cite-tab');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var id = tab.getAttribute('data-cite');
      tabs.forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('on', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.querySelectorAll('[data-cite-body]').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-cite-body') === id);
      });
    });
  });

  var btn = document.querySelector('[data-copy-cite]');
  if (btn) {
    btn.addEventListener('click', function () {
      var active = document.querySelector('.cite-text.on');
      if (!active) return;
      var text = active.innerText.trim();
      var html = active.querySelector('pre') ? null : active.innerHTML;
      var done = function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy citation'; }, 1800);
      };
      if (navigator.clipboard && window.ClipboardItem && html) {
        navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        })]).then(done, function () { navigator.clipboard.writeText(text).then(done); });
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(done);
      }
    });
  }
})();
