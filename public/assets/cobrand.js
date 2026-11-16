/* ABR partner co-brand kit: trims and scales a partner's logo to ABR's lockup rules
   and packages light/dark, horizontal/stacked lockups as PNG and SVG in a zip.
   Everything runs in the browser; only the trimmed logo is sent to ABR. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var code = '', partner = null, built = null;

  var ABR = {
    horizontal: { black: '/brand/logo/horizontal/ABR-Horizontal-Black.png', white: '/brand/logo/horizontal/ABR-Horizontal-White.png' },
    stacked:    { black: '/brand/logo/primary/ABR-Primary-Stacked-Black.png', white: '/brand/logo/primary/ABR-Primary-Stacked-White.png' }
  };

  function api(action, payload) {
    return fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, payload: payload }) })
      .then(function (r) { return r.json(); })
      .then(function (r) { if (!r.ok) throw new Error(r.error || 'Something went wrong.'); return r.data; });
  }
  function msg(id, text, bad) { var el = $(id); el.textContent = text || ''; el.className = 'cb-msg' + (bad ? ' bad' : ''); }
  function loadImg(src) {
    return new Promise(function (res, rej) {
      var im = new Image(); im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('Could not read that image file.')); }; im.src = src;
    });
  }
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function slug(s) { return String(s || 'partner').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'partner'; }

  /* ---------- Step 1: partner code ---------- */
  var params = new URLSearchParams(location.search);
  if (params.get('code')) $('cbCode').value = params.get('code');
  $('cbCodeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    msg('cbCodeMsg', 'Checking…');
    api('public.partnerByCode', { code: $('cbCode').value }).then(function (p) {
      code = $('cbCode').value.trim(); partner = p;
      $('cbName').textContent = p.name;
      msg('cbCodeMsg', '');
      $('cbLogoStep').hidden = false;
      if (p.logoUrl) msg('cbLogoMsg', 'ABR already has a logo on file for you. Upload it again to build your kit.');
    }).catch(function (err) { msg('cbCodeMsg', err.message, true); });
  });

  /* ---------- Step 2: logo → trimmed canvas ---------- */
  $('cbFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) { msg('cbLogoMsg', 'That file is larger than 15 MB.', true); return; }
    msg('cbLogoMsg', 'Preparing your logo…');
    var url = URL.createObjectURL(f);
    loadImg(url).then(function (im) {
      var logo = trim(im);
      if (!logo) throw new Error('The image looks empty. Try a different file.');
      return Promise.all([loadImg(ABR.horizontal.black), loadImg(ABR.horizontal.white),
                          loadImg(ABR.stacked.black), loadImg(ABR.stacked.white)]).then(function (abr) {
        built = build(logo, { hb: abr[0], hw: abr[1], sb: abr[2], sw: abr[3] });
        preview(built);
        msg('cbLogoMsg', logo.transparent
          ? 'Done. Your logo was trimmed and scaled automatically.'
          : 'Done. Your logo has a solid background, so the dark versions place it on a white tile. A transparent PNG gives a cleaner result.');
        $('cbPreviewStep').hidden = false;
        shareLogo(logo);
      });
    }).catch(function (err) { msg('cbLogoMsg', err.message, true); })
      .then(function () { URL.revokeObjectURL(url); });
  });

  // Draw at a working size, detect transparency, and crop away empty or background margins.
  function trim(im) {
    var w = im.naturalWidth || im.width || 1000, h = im.naturalHeight || im.height || 400;
    var k = Math.min(1, 2000 / Math.max(w, h));
    if (Math.max(w, h) < 600) k = 600 / Math.max(w, h); // small logos (and SVGs) drawn larger
    w = Math.round(w * k); h = Math.round(h * k);
    var c = canvas(w, h), x = c.getContext('2d');
    x.drawImage(im, 0, 0, w, h);
    var d = x.getImageData(0, 0, w, h).data, transparent = false;
    for (var i = 3; i < d.length; i += 16) { if (d[i] < 250) { transparent = true; break; } }
    var bg = [d[0], d[1], d[2]];
    var empty = function (p) {
      if (transparent) return d[p + 3] < 12;
      return Math.abs(d[p] - bg[0]) + Math.abs(d[p + 1] - bg[1]) + Math.abs(d[p + 2] - bg[2]) < 36;
    };
    var top = h, left = w, right = -1, bottom = -1;
    for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
      if (!empty((yy * w + xx) * 4)) {
        if (xx < left) left = xx; if (xx > right) right = xx;
        if (yy < top) top = yy; if (yy > bottom) bottom = yy;
      }
    }
    if (right < 0) return null;
    var cw = right - left + 1, ch = bottom - top + 1;
    var out = canvas(cw, ch);
    out.getContext('2d').drawImage(c, left, top, cw, ch, 0, 0, cw, ch);
    return { canvas: out, w: cw, h: ch, transparent: transparent };
  }

  // White knockout of a transparent logo for dark backgrounds.
  function knockout(logo) {
    var c = canvas(logo.w, logo.h), x = c.getContext('2d');
    x.drawImage(logo.canvas, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, logo.w, logo.h);
    return c;
  }

  /* ---------- Lockups ---------- */
  // ABR rules: partner logo is optically matched to the ABR wordmark (equal visual area,
  // capped in height and width), separated by a hairline rule, with clear space of
  // half the ABR logo height on every side.
  function fitPartner(logo, H, maxH, maxW, areaMul) {
    var s = Math.sqrt((H * H * areaMul) / (logo.w * logo.h));
    s = Math.min(s, maxH / logo.h, maxW / logo.w);
    return { w: logo.w * s, h: logo.h * s };
  }

  function lockup(kind, dark, logo, abrImg) {
    var H, pad, gap, abrW, abrH, pf, W, Ht, positions;
    var tile = dark && !logo.transparent;
    if (kind === 'horizontal') {
      H = 160; abrH = H; abrW = abrImg.naturalWidth * (H / abrImg.naturalHeight);
      pf = fitPartner(logo, H, H * 1.6, H * 5, 3.2);
      pad = H * 0.5; gap = H * 0.55;
      var tileP = tile ? H * 0.18 : 0;
      var rowH = Math.max(abrH, pf.h + tileP * 2, H * 1.3);
      W = pad + abrW + gap + 2 + gap + pf.w + tileP * 2 + pad;
      Ht = pad + rowH + pad;
      var cy = pad + rowH / 2;
      positions = {
        abr: { x: pad, y: cy - abrH / 2, w: abrW, h: abrH },
        rule: { x: pad + abrW + gap, y: cy - rowH * 0.45, w: 2, h: rowH * 0.9 },
        tile: tile ? { x: pad + abrW + gap * 2 + 2, y: cy - pf.h / 2 - tileP, w: pf.w + tileP * 2, h: pf.h + tileP * 2 } : null,
        logo: { x: pad + abrW + gap * 2 + 2 + tileP, y: cy - pf.h / 2, w: pf.w, h: pf.h }
      };
    } else {
      H = 320; abrH = H; abrW = abrImg.naturalWidth * (H / abrImg.naturalHeight);
      pf = fitPartner(logo, H * 0.55, H * 0.75, abrW * 0.95, 4);
      pad = H * 0.3; gap = H * 0.22;
      var tp = tile ? H * 0.08 : 0;
      W = pad + Math.max(abrW, pf.w + tp * 2) + pad;
      var ruleW = Math.min(abrW * 0.5, W - pad * 2);
      Ht = pad + abrH + gap + 2 + gap + pf.h + tp * 2 + pad;
      positions = {
        abr: { x: (W - abrW) / 2, y: pad, w: abrW, h: abrH },
        rule: { x: (W - ruleW) / 2, y: pad + abrH + gap, w: ruleW, h: 2 },
        tile: tile ? { x: (W - pf.w) / 2 - tp, y: pad + abrH + gap * 2 + 2, w: pf.w + tp * 2, h: pf.h + tp * 2 } : null,
        logo: { x: (W - pf.w) / 2, y: pad + abrH + gap * 2 + 2 + tp, w: pf.w, h: pf.h }
      };
    }
    return { kind: kind, dark: dark, W: Math.round(W), H: Math.round(Ht), pos: positions, abrImg: abrImg,
             logoSrc: dark && logo.transparent ? knockout(logo) : logo.canvas, ink: dark ? '#ffffff' : '#000000' };
  }

  function rasterise(L, scale) {
    var c = canvas(L.W * scale, L.H * scale), x = c.getContext('2d');
    x.scale(scale, scale);
    x.imageSmoothingQuality = 'high';
    var p = L.pos;
    x.drawImage(L.abrImg, p.abr.x, p.abr.y, p.abr.w, p.abr.h);
    x.fillStyle = L.ink; x.globalAlpha = 0.85; x.fillRect(p.rule.x, p.rule.y, p.rule.w, p.rule.h); x.globalAlpha = 1;
    if (p.tile) { x.fillStyle = '#ffffff'; roundRect(x, p.tile.x, p.tile.y, p.tile.w, p.tile.h, Math.min(p.tile.h, p.tile.w) * 0.12); x.fill(); }
    x.drawImage(L.logoSrc, p.logo.x, p.logo.y, p.logo.w, p.logo.h);
    return c;
  }
  function roundRect(x, a, b, w, h, r) {
    x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r);
    x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath();
  }

  function svgOf(L) {
    var p = L.pos, f = function (n) { return Math.round(n * 100) / 100; };
    var img = function (src, r) {
      return '<image x="' + f(r.x) + '" y="' + f(r.y) + '" width="' + f(r.w) + '" height="' + f(r.h) + '" preserveAspectRatio="xMidYMid meet" href="' + src + '"/>';
    };
    var abrData = toDataUrl(L.abrImg, Math.round(p.abr.w * 3), Math.round(p.abr.h * 3));
    var logoData = toDataUrl(L.logoSrc, Math.round(p.logo.w * 3), Math.round(p.logo.h * 3));
    return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="' + L.W + '" height="' + L.H + '" viewBox="0 0 ' + L.W + ' ' + L.H + '">' +
      '<title>Ahmedabad Business Review × ' + escXml(partner.name) + '</title>' +
      img(abrData, p.abr) +
      '<rect x="' + f(p.rule.x) + '" y="' + f(p.rule.y) + '" width="' + f(p.rule.w) + '" height="' + f(p.rule.h) + '" fill="' + L.ink + '" fill-opacity="0.85"/>' +
      (p.tile ? '<rect x="' + f(p.tile.x) + '" y="' + f(p.tile.y) + '" width="' + f(p.tile.w) + '" height="' + f(p.tile.h) + '" rx="' + f(Math.min(p.tile.h, p.tile.w) * 0.12) + '" fill="#ffffff"/>' : '') +
      img(logoData, p.logo) + '</svg>';
  }
  function toDataUrl(src, w, h) { var c = canvas(w, h); c.getContext('2d').drawImage(src, 0, 0, w, h); return c.toDataURL('image/png'); }
  function escXml(s) { return String(s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }

  function build(logo, abr) {
    return {
      logo: logo,
      lockups: [
        lockup('horizontal', false, logo, abr.hb), lockup('horizontal', true, logo, abr.hw),
        lockup('stacked', false, logo, abr.sb), lockup('stacked', true, logo, abr.sw)
      ]
    };
  }

  function preview(b) {
    var box = $('cbPreviews'); box.innerHTML = '';
    b.lockups.forEach(function (L) {
      var fig = document.createElement('figure');
      fig.className = 'cb-prev ' + (L.dark ? 'dark' : 'light');
      var c = rasterise(L, 1); c.style.maxWidth = '100%'; c.style.height = 'auto';
      fig.appendChild(c);
      var cap = document.createElement('figcaption');
      cap.textContent = (L.kind === 'horizontal' ? 'Horizontal' : 'Stacked') + ' · for ' + (L.dark ? 'dark' : 'light') + ' backgrounds';
      fig.appendChild(cap); box.appendChild(fig);
    });
    $('cbDownload').disabled = !$('cbAgree').checked;
  }
  $('cbAgree').addEventListener('change', function () { $('cbDownload').disabled = !(this.checked && built); });

  // Send the trimmed logo to ABR so editors can use it on partner articles.
  function shareLogo(logo) {
    var k = Math.min(1, 1200 / Math.max(logo.w, logo.h));
    var c = canvas(logo.w * k, logo.h * k); c.getContext('2d').drawImage(logo.canvas, 0, 0, c.width, c.height);
    var dataUrl = c.toDataURL('image/png');
    if (dataUrl.length > 3.8 * 1024 * 1024) return;
    api('public.partnerLogo', { code: code, dataUrl: dataUrl }).catch(function () {});
  }

  /* ---------- Download (store-only zip) ---------- */
  $('cbDownload').addEventListener('click', function () {
    if (!built) return;
    msg('cbDlMsg', 'Building your kit…');
    var base = 'ABR-x-' + slug(partner.name);
    var files = [];
    var jobs = built.lockups.map(function (L) {
      var name = base + '-' + (L.kind === 'horizontal' ? 'Horizontal' : 'Stacked') + '-' + (L.dark ? 'ForDark' : 'ForLight');
      files.push({ name: base + '/SVG/' + name + '.svg', data: new TextEncoder().encode(svgOf(L)) });
      return blobBytes(rasterise(L, 3)).then(function (bytes) { files.push({ name: base + '/PNG/' + name + '.png', data: bytes }); });
    });
    jobs.push(blobBytes(built.logo.canvas).then(function (bytes) {
      files.push({ name: base + '/Source/' + slug(partner.name) + '-logo-trimmed.png', data: bytes });
    }));
    Promise.all(jobs).then(function () {
      files.push({ name: base + '/README.txt', data: new TextEncoder().encode(readme()) });
      var blob = new Blob([zip(files)], { type: 'application/zip' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = base + '-CoBrand-Kit.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      msg('cbDlMsg', 'Downloaded. Share your final layouts with ABR before printing or publishing.');
    }).catch(function (err) { msg('cbDlMsg', err.message, true); });
  });

  function blobBytes(c) {
    return new Promise(function (res, rej) {
      c.toBlob(function (b) { if (!b) return rej(new Error('Could not create an image.')); b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }); }, 'image/png');
    });
  }

  function readme() {
    return [
      'AHMEDABAD BUSINESS REVIEW × ' + partner.name.toUpperCase(),
      'Co-brand kit, generated ' + new Date().toISOString().slice(0, 10) + ' at theabr.in/cobrand',
      '',
      'WHAT IS INSIDE',
      '  PNG/     High-resolution lockups with transparent backgrounds (3x).',
      '  SVG/     The same lockups for print and design tools.',
      '  Source/  Your logo as trimmed by the tool.',
      '  "ForLight" files are for white or light backgrounds; "ForDark" files are for black or dark backgrounds.',
      '',
      'RULES (from the ABR brand guidelines, theabr.in/brand)',
      '  1. Use the lockups exactly as supplied. Do not redraw, recolour, stretch, rotate or add effects.',
      '  2. Keep clear space around the lockup at least half the height of the ABR logo.',
      '  3. Do not place the lockup on busy photos or low-contrast colours.',
      '  4. Minimum size: horizontal lockup 40 mm / 240 px wide; stacked lockup 25 mm / 150 px wide.',
      '  5. Use the lockup only for the partnership agreed with ABR, and only while it is active.',
      '  6. The lockup does not mean ABR endorses your products or services.',
      '  7. Send final layouts to ABR for approval before printing or publishing.',
      '',
      'Questions: see theabr.in/contact. Partner content policy: theabr.in/partner-content',
      ''
    ].join('\r\n');
  }

  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { var c = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    var d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
        dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
      h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
      c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + size;
    });
    var cdSize = central.reduce(function (n, p) { return n + p.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]));
  }
})();
