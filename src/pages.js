// Standing pages. Edit the wording here; they are rendered with the site layout.
import { esc } from './util.js';

export const PAGES = {
  about: {
    slug: 'about',
    title: 'About ABR',
    description: 'Ahmedabad Business Review publishes rigorous, readable analysis on business, entrepreneurship, innovation and leadership.',
    html: (s) => `
<p class="lede">${esc(s.name)} (${esc(s.shortName)}) publishes rigorous, readable analysis on business, entrepreneurship, innovation, leadership, and policy and the economy, written from Ahmedabad for readers everywhere.</p>
<p>ABR began as a magazine and is now an online publication. Every article is published at a permanent address, carries a unique article ID, and is written so that students, researchers, founders and practitioners can rely on it and cite it.</p>
<h2>Who publishes ABR</h2>
<p>${esc(s.name)} is published by the <a href="${esc(s.publisherUrl)}">${esc(s.publisher)}</a> (${esc(s.publisherShort)}), Ahmedabad, India. ${esc(s.publisherShort)} provides institutional support; editorial decisions rest with ABR’s editorial leadership under the standards set out in our <a href="/editorial-standards">editorial standards</a>.</p>
<h2>What we publish</h2>
<ul>
  <li><b>Analysis</b> explains what is happening and why, grounded in evidence.</li>
  <li><b>Opinion</b> argues a position. It is always labelled, and the views are the author’s own.</li>
  <li><b>Interview</b> presents conversations with founders, leaders and experts, edited for length and clarity.</li>
  <li><b>Case Study</b> gives a structured account of a company, decision or market.</li>
  <li><b>Research Brief</b> summarises a study or dataset for a general reader.</li>
  <li><b>Explainer</b> provides background on a concept, policy or trend.</li>
</ul>`
  },

  'editorial-standards': {
    slug: 'editorial-standards',
    title: 'Editorial standards',
    description: 'How Ahmedabad Business Review commissions, reviews, fact-checks and publishes its articles.',
    html: (s) => `
<p class="lede">Credibility is the reason ${esc(s.shortName)} exists. These standards apply to everything we publish.</p>
<h2>Review before publication</h2>
<p>Every article is edited and then reviewed by the Chair of ${esc(s.shortName)} before publication. No article is published by its author alone. Reviewers check accuracy, sourcing, fairness, clarity and whether the piece is correctly labelled.</p>
<h2>Accuracy and sourcing</h2>
<ul>
  <li>Factual claims, figures and quotations must be traceable to a source. Articles list their sources and references.</li>
  <li>We prefer primary sources: official data, filings, research papers and on-the-record interviews.</li>
  <li>Quotations are reproduced accurately. Interviews may be edited for length and clarity without changing meaning.</li>
  <li>We do not publish anonymous claims unless the editor knows the source and the information cannot be obtained otherwise.</li>
</ul>
<h2>Labelling</h2>
<p>Every article carries a type label (Analysis, Opinion, Interview, Case Study, Research Brief or Explainer) so readers know what they are reading. Opinion pieces carry a notice that the views are the author’s own.</p>
<h2>Independence and conflicts of interest</h2>
<p>Authors must disclose any financial, professional or personal relationship with a company, person or organisation they write about. Relevant disclosures are printed at the end of the article. ${esc(s.shortName)} does not accept payment in exchange for coverage.</p>
<h2>Authorship</h2>
<p>Most articles carry the real names of their authors, linked to a profile with their role and background. Authors are responsible for every word published under their name.</p>
<p>Some articles, such as explainers and research briefs prepared by the editorial desk, are published as <b>“Curated by ${esc(s.name)}”</b>. They go through exactly the same editing, fact-checking and approval, and ${esc(s.shortName)} as an institution takes responsibility for them.</p>
<h2>Use of AI</h2>
<p>${esc(s.shortName)} may use AI tools to help research and draft articles. Any article where AI played a material role says so in its disclosure. Every such article is fact-checked, edited and approved by a human editor before publication, and every reference is checked against its source.</p>
<h2>Partner and promoted content</h2>
<p>Articles produced with a partner organisation are labelled <b>“In partnership with”</b> that organisation. Articles that are paid for or sponsored are labelled <b>“Promoted”</b> and name the supporter. In both cases the article is still reviewed under these standards, and the partner does not approve or change ${esc(s.shortName)}’s conclusions. Promoted articles are not presented as research and are excluded from scholarly indexing.</p>
<h2>Permanence</h2>
<p>Articles keep a permanent URL and article ID so they can be cited reliably. We do not silently change published articles. See our <a href="/corrections">corrections policy</a>.</p>`
  },

  corrections: {
    slug: 'corrections',
    title: 'Corrections policy',
    description: 'How Ahmedabad Business Review corrects errors, updates and withdraws articles.',
    html: (s) => `
<p class="lede">When we get something wrong, we say so clearly and fix it.</p>
<h2>Corrections</h2>
<p>Significant factual errors are corrected promptly. The article carries a correction notice that states what was wrong and what has been changed, and shows the date it was updated.</p>
<h2>Clarifications and updates</h2>
<p>Where an article is accurate but could mislead, or where events have moved on, we may add a clarification or update. The “Updated” date on the article reflects this.</p>
<h2>Minor edits</h2>
<p>Spelling, grammar and formatting fixes that do not change meaning may be made without a notice.</p>
<h2>Withdrawals</h2>
<p>In rare cases, such as serious inaccuracy that cannot be corrected or a legal requirement, an article may be withdrawn. Its URL then shows a public withdrawal notice with the date and reason, so existing citations still resolve.</p>
<h2>Reporting an error</h2>
<p>Write to <a href="mailto:${esc(s.contactEmail)}">${esc(s.contactEmail)}</a> with the article link and the error you have found.</p>`
  },

  'how-to-cite': {
    slug: 'how-to-cite',
    title: 'How to cite ABR',
    description: 'Citation formats for Ahmedabad Business Review articles.',
    html: (s) => `
<p class="lede">Every ${esc(s.shortName)} article has a “Cite this article” box with ready-made APA, MLA, Chicago, Harvard and BibTeX citations.</p>
<p>Reference managers such as MyBib, Zotero, Mendeley and EndNote can also read the details automatically. Paste the article’s link and the title, authors, publication date and publisher will be filled in.</p>
<h2>Example (APA 7)</h2>
<p class="box">Surname, A. B. (Year). Article title. <i>${esc(s.name)}</i>, <i>Volume</i>(Issue), Article ABR-YYYY-NNNN. ${esc(s.url)}/articles/article-slug</p>
<p>${esc(s.shortName)} publishes continuously: each calendar year is one volume (Volume 1 = ${s.volumeStartYear}), divided into ${s.issuesPerYear} two-month issues. Every article can also be downloaded as a formatted PDF, and the <a href="/archive">archive</a> lists all articles by volume and issue.</p>
<p>Please cite the permanent link shown at the end of each article. Each article also has a unique ID (for example ABR-2026-0001) that you can quote in correspondence.</p>`
  },

  brand: {
    slug: 'brand',
    title: 'Brand guidelines',
    wide: true,
    description: 'The Ahmedabad Business Review logo, colours and typeface, and how to use them. Download the brand kit.',
    html: () => {
      const L = '/brand/logo';
      const versions = [
        ['primary', 'ABR-Primary-Stacked', 'Primary · stacked', 'The default logo for any use with enough room: covers, documents, stage and print.'],
        ['horizontal', 'ABR-Horizontal', 'Horizontal', 'For website headers, letterheads and narrow bands.'],
        ['emblem', 'ABR-Emblem', 'Emblem', 'The stepwell on its own, for places where the name already appears nearby.'],
        ['short-form', 'ABR-Short-Form-ABR', 'Short form', 'Emblem with “ABR”, for social media, merchandise and small spaces.']
      ];
      const dl = (dir, base, colour) => ['svg', 'png', 'pdf']
        .map((ext) => `<a href="${L}/${dir}/${base}-${colour}.${ext}" download>${ext.toUpperCase()}</a>`).join('');
      return `
<p class="lede">One emblem, one name, black and white. This page explains how to use the ${'Ahmedabad Business Review'} identity. Partners, sponsors, the press and contributors may use the logo to refer to ABR, as long as they follow these guidelines.</p>
<div class="brand-actions">
  <a class="btn" href="/brand/ABR-Brand-Kit.zip" download>Download the brand kit (ZIP)</a>
  <a class="btn ghost" href="/brand/ABR-Brand-Guidelines.pdf" target="_blank" rel="noopener">Brand guidelines (PDF)</a>
</div>

<section class="brand-sec">
  <h2><span>01</span> The logo</h2>
  <div class="brand-two">
    <div class="brand-tile light big"><img src="${L}/primary/ABR-Primary-Stacked-Black.svg" alt="Ahmedabad Business Review primary logo"></div>
    <div>
      <h3>The emblem</h3>
      <p>The emblem is a cross-section of an Ahmedabad stepwell (<i>vav</i>): a pillared gallery above steps that descend, level by level, toward water.</p>
      <p>It stands for what ABR does: reaching insight by going deeper, one step at a time, rooted in the city it is named for.</p>
      <p>The primary logo pairs the stepwell emblem with the full name, set in three heavy lines. Use it wherever there is room.</p>
    </div>
  </div>
</section>

<section class="brand-sec">
  <h2><span>02</span> Logo versions</h2>
  <p>Each version comes in Black and White (for dark backgrounds). Use SVG on the web, PDF for print and PNG for quick use. All files have transparent backgrounds.</p>
  <div class="brand-versions">
  ${versions.map(([dir, base, name, use]) => `
    <div class="brand-version">
      <div class="brand-pair">
        <div class="brand-tile light"><img src="${L}/${dir}/${base}-Black.svg" alt="${name}, black"></div>
        <div class="brand-tile dark"><img src="${L}/${dir}/${base}-White.svg" alt="${name}, white"></div>
      </div>
      <h3>${name}</h3>
      <p class="muted">${use}</p>
      <div class="brand-dl"><span>Black</span>${dl(dir, base, 'Black')}</div>
      <div class="brand-dl"><span>White</span>${dl(dir, base, 'White')}</div>
    </div>`).join('')}
  </div>
</section>

<section class="brand-sec">
  <h2><span>03</span> Clear space and minimum size</h2>
  <div class="brand-two">
    <figure class="brand-figure"><img src="/brand/clear-space.png" alt="Clear space around the logo equals X on every side, where X is one quarter of the emblem’s width."></figure>
    <div>
      <p>Keep clear space of <b>X</b> on every side of the logo, where X is one quarter of the emblem’s width. No text, images or edges may sit inside it.</p>
      <table class="brand-table">
        <thead><tr><th>Version</th><th>Minimum size</th></tr></thead>
        <tbody>
          <tr><td>Primary · stacked</td><td>30 mm / 140 px wide</td></tr>
          <tr><td>Horizontal</td><td>45 mm / 200 px wide</td></tr>
          <tr><td>Emblem</td><td>8 mm / 28 px tall</td></tr>
          <tr><td>Below 28 px</td><td>Use the favicon mark</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</section>

<section class="brand-sec">
  <h2><span>04</span> Colour</h2>
  <p>ABR is a black-and-white brand. The logo appears only in Black or White. Paper is a background tone for print, never a logo colour.</p>
  <div class="brand-swatches">
    <div class="swatch"><div class="chip" style="background:#000"></div><b>Black</b><span>#000000</span><span>RGB 0 0 0 · CMYK 0 0 0 100</span></div>
    <div class="swatch"><div class="chip" style="background:#fff"></div><b>White</b><span>#FFFFFF</span><span>RGB 255 255 255</span></div>
    <div class="swatch"><div class="chip" style="background:#F2F0EB"></div><b>Paper</b><span>#F2F0EB</span><span>RGB 242 240 235 · print stock</span></div>
  </div>
</section>

<section class="brand-sec">
  <h2><span>05</span> Typography</h2>
  <div class="brand-two">
    <div class="brand-type">
      <div class="t-display">Inter Display</div>
      <p class="muted">ExtraBold: the logo wordmark</p>
      <div class="t-sample">Aa Bb Cc 0123</div>
      <p><b>Inter</b> Regular, Semibold and Bold, for headings, body text and the website.</p>
    </div>
    <div>
      <p>Inter is free under the SIL Open Font License and can be downloaded from <a href="https://rsms.me/inter/" rel="noopener" target="_blank">rsms.me/inter</a>.</p>
      <p>The wordmark in the logo files has already been converted to shapes. <b>Never retype the name</b> to recreate the logo.</p>
    </div>
  </div>
</section>

<section class="brand-sec">
  <h2><span>06</span> Do not</h2>
  <figure class="brand-figure"><img src="/brand/do-not.png" alt="Do not stretch or squash the logo, rotate it, recolour it, use it on busy images, rearrange its parts or retype the name."></figure>
</section>

<section class="brand-sec">
  <h2><span>07</span> Social and web</h2>
  <div class="brand-social">
    <div><img src="/brand/social/ABR-Social-Avatar-Black.png" alt="ABR social avatar, white emblem on black" class="round"><p><b>Social avatar</b> · 1080 × 1080<br><a href="/brand/social/ABR-Social-Avatar-Black.png" download>PNG</a> · <a href="/brand/social/ABR-Social-Avatar-Black.svg" download>SVG</a></p></div>
    <div><img src="/brand/social/ABR-Social-Avatar-White.png" alt="ABR social avatar, black emblem on white" class="round bordered"><p><b>Social avatar, light</b> · 1080 × 1080<br><a href="/brand/social/ABR-Social-Avatar-White.png" download>PNG</a> · <a href="/brand/social/ABR-Social-Avatar-White.svg" download>SVG</a></p></div>
    <div><div class="favs"><img src="/favicon-512.png" alt="" width="64" height="64"><img src="/favicon-512.png" alt="" width="32" height="32"><img src="/favicon-512.png" alt="" width="16" height="16"></div><p><b>Favicons</b> · 64 · 32 · 16 px<br>Included in the brand kit</p></div>
  </div>
</section>

<section class="brand-sec">
  <h2><span>08</span> Questions</h2>
  <p>Partners co-brand with ABR using the <a href="/cobrand">co-brand kit tool</a>: upload your logo and download a co-branded kit built to these rules. You need the partner code ABR sends you. For anything else, write to the editorial office (see <a href="/contact">Contact</a>).</p>
  <p class="muted small">Brand guidelines version 1.0, November 2026.</p>
</section>`;
    }
  },

  'partner-content': {
    slug: 'partner-content',
    title: 'Partner and promoted content',
    description: 'How Ahmedabad Business Review labels articles produced with partners or supported by sponsors.',
    html: (s) => `
<p class="lede">${esc(s.shortName)} sometimes works with organisations whose work is good for business and society in Gujarat. When we do, we say so clearly.</p>
<h2>“In partnership with”</h2>
<p>An article labelled <b>Partner</b> was produced in collaboration with the organisation named, for example through access to data, people or events. No money changed hands for the article itself. ${esc(s.shortName)} editors write or edit it and decide what it says.</p>
<h2>“Promoted”</h2>
<p>An article labelled <b>Promoted</b> was supported or paid for by the organisation named. We only promote work we believe has public value. Promoted articles:</p>
<ul>
<li>carry a visible “Promoted · Supported by …” label at the top;</li>
<li>are still reviewed under our <a href="/editorial-standards">editorial standards</a>, and must be accurate and sourced;</li>
<li>mark their links as sponsored for search engines; and</li>
<li>are not presented as research and are not submitted for scholarly indexing.</li>
</ul>
<h2>What partners cannot do</h2>
<p>Partners do not approve, edit or veto ${esc(s.shortName)}’s articles or conclusions. Partners may use the ${esc(s.shortName)} name and logo only through the <a href="/cobrand">co-brand kit</a> and in line with our <a href="/brand">brand guidelines</a>.</p>
<p>See all <a href="/partners">our partners</a>. Questions: <a href="mailto:${esc(s.contactEmail)}">${esc(s.contactEmail)}</a>.</p>`
  },

  privacy: {
    slug: 'privacy',
    title: 'Privacy policy',
    description: 'What personal data Ahmedabad Business Review collects, why, who processes it, how long it is kept and your rights.',
    html: (s) => `
<p class="lede">${esc(s.name)} collects as little personal data as it can, uses it only to run the publication, and never sells it.</p>
<p class="muted small">Effective ${esc(s.policyDate)}. ${esc(s.name)} is published by the ${esc(s.publisher)} (“${esc(s.publisherShort)}”, “we”), Ahmedabad, Gujarat, India, which is responsible for the personal data described here.</p>

<h2>If you only read ABR</h2>
<p>You can read every article without an account. We do not use advertising or tracking cookies, and we do not build profiles of readers. To count readers, we record the page viewed, the day, the country (worked out by our host from your connection) and the website that sent you, if any. We do not store your IP address in these counts, and they cannot identify you. Our host, Cloudflare, processes connection data such as IP addresses to deliver pages and protect the site from abuse.</p>

<h2>What we collect, and why</h2>
<table class="policy-table">
<thead><tr><th>When you…</th><th>We collect</th><th>We use it to</th></tr></thead>
<tbody>
<tr><td>Subscribe to the newsletter</td><td>Email, name (optional), your choices about what to receive, the date and the connection address used to sign up</td><td>Send the emails you chose, and keep a record that you asked for them</td></tr>
<tr><td>Create a contributor account or submit an article</td><td>Name, email, affiliation, short bio, password (stored only as a salted hash), your submissions and our editorial notes</td><td>Review, edit and publish your work, credit you and issue certificates</td></tr>
<tr><td>Ask permission to reuse ABR material</td><td>Name, email, organisation, designation, details of the use and the connection address used</td><td>Decide the request, issue and verify your licence</td></tr>
<tr><td>Join the ABR team</td><td>Name, email, role, public profile, and a record of your electronic signature on the team agreement (date, connection address and browser)</td><td>Run the editorial portal and keep a reliable record of the agreement</td></tr>
<tr><td>Write to us</td><td>Whatever you send</td><td>Reply to you</td></tr>
</tbody>
</table>
<p>Our sign-in pages keep a session token and any unsent draft in your own browser’s storage, so that you stay signed in and do not lose work. You can clear them by signing out or clearing your browser data.</p>
<p>We process personal data on the basis of your consent (for example, subscribing) or for the purpose you gave it to us (for example, submitting an article), as the Digital Personal Data Protection Act, 2023 allows.</p>

<h2>What becomes public</h2>
<p>If we publish your article, your name, affiliation and bio are published with it, and become part of the scholarly record. If an article receives a DOI, its title, authors, affiliations, abstract and PDF are deposited with Zenodo and registered with DataCite, which make that information public permanently. Certificate, letter and licence references can be checked by anyone at <a href="/verify">/verify</a>, which shows only the details needed to confirm a document is genuine.</p>

<h2>Who processes data for us</h2>
<ul>
<li><b>Cloudflare</b>: hosts the website, generates PDFs and stores our anonymous visit counts.</li>
<li><b>Google</b> (Workspace and Apps Script): stores our editorial database, files and email queue, and may send email.</li>
<li><b>Zoho</b> (Zoho Mail or ZeptoMail): sends our emails.</li>
<li><b>Zenodo</b> (operated by CERN) and <b>DataCite</b>: register DOIs for published articles.</li>
<li><b>Groq</b>: runs AI models our editors may use to prepare draft articles. Only text the editors provide is sent; reader and subscriber data is not.</li>
</ul>
<p>Some of these providers process data outside India. We use them under their standard terms, and send them only what they need for their task.</p>

<h2>How long we keep it</h2>
<ul>
<li>Newsletter: until you unsubscribe. We then keep only your email and the date, so that we do not write to you again.</li>
<li>Contributor accounts: until you ask us to delete the account. Published articles and their credits stay in the archive, as the scholarly record requires; unpublished submissions are deleted on request.</li>
<li>Permission requests and licences: for the period of the licence and up to seven years after, for our records.</li>
<li>Records used to prevent abuse (such as counts of attempts from a connection): a few hours.</li>
</ul>

<h2>Your rights</h2>
<p>Under the Digital Personal Data Protection Act, 2023 you may ask us for a summary of the personal data we hold about you, ask us to correct, complete, update or erase it, withdraw consent you have given, and nominate someone to exercise these rights for you. You can change your newsletter choices or unsubscribe from the link in every email, and edit your contributor profile when signed in. For anything else, write to us at the address below. We aim to respond within 30 days. If you are not satisfied with our response, you may complain to the Data Protection Board of India.</p>

<h2>Children</h2>
<p>ABR is written for a general adult and student audience. If you are under 18, a parent or guardian must agree before you create a contributor account or submit an article, and we may ask them to confirm. We do not track children or show them targeted advertising.</p>

<h2>Security</h2>
<p>Passwords are stored only as salted hashes. Access to the editorial database is limited to the people who need it, and every action in the portal is logged. No system is perfectly secure; if a breach affecting your data occurs, we will tell you and the authorities as the law requires.</p>

<h2>Contact and grievances</h2>
<p>Write to the Chairperson of ${esc(s.name)}, who handles privacy questions and grievances: <a href="mailto:${esc(s.privacyEmail || s.contactEmail)}">${esc(s.privacyEmail || s.contactEmail)}</a>, ${esc(s.publisher)}, Ahmedabad, Gujarat, India.</p>
<p>We will post any change to this policy on this page with a new effective date, and tell subscribers and contributors about significant changes by email.</p>`
  },

  terms: {
    slug: 'terms',
    title: 'Terms of use',
    description: 'The terms that apply when you read, share, cite, submit to or reuse material from Ahmedabad Business Review.',
    html: (s) => `
<p class="lede">These terms apply when you use ${esc(s.url.replace(/^https?:\/\//, ''))}. By using the site you agree to them.</p>
<p class="muted small">Effective ${esc(s.policyDate)}. The site is operated by the ${esc(s.publisher)} (“${esc(s.publisherShort)}”), Ahmedabad, Gujarat, India.</p>
<h2>Reading, sharing and citing</h2>
<p>You may read, link to and cite any ABR article freely. Each article states the licence it is published under at its end, together with the credit line to use. What that licence allows without asking, and how to ask for anything more, is explained in <a href="/permissions">Rights and permissions</a>.</p>
<h2>Not professional advice</h2>
<p>ABR publishes analysis and opinion for general information. Nothing on the site is investment, legal, tax or other professional advice, and you should not act on it without taking advice suited to your situation. Opinion pieces are the views of their authors.</p>
<h2>Accounts</h2>
<p>Keep your password private and tell us if you think someone else has used your account. We may suspend accounts that are misused.</p>
<h2>What you send us</h2>
<p>When you submit an article you confirm it is your own work, has not been published elsewhere and credits every source. You keep your copyright. You grant ${esc(s.publisherShort)} a worldwide, non-exclusive, royalty-free licence to edit, publish, archive and distribute your article in any medium, to register a DOI for it, to include it in ABR issues, and to license others to reuse it under our <a href="/permissions">permissions policy</a>. Members of the ABR team are covered by the team agreement instead.</p>
<h2>Acceptable use</h2>
<p>Do not attempt to break into the site, overload it, collect personal data from it, submit material you have no right to, impersonate anyone, or present a forged ABR certificate, letter or licence. Every genuine ABR document can be checked at <a href="/verify">/verify</a>.</p>
<h2>Our name and logo</h2>
<p>The ${esc(s.name)} name, emblem and logos may be used only as our <a href="/brand">brand guidelines</a> allow.</p>
<h2>Links and availability</h2>
<p>We link to other sites for reference and are not responsible for their content. We try to keep ABR available and accurate, and correct errors under our <a href="/corrections">corrections policy</a>, but the site is provided as it is, without warranties. To the extent the law allows, ${esc(s.publisherShort)} is not liable for indirect or consequential loss arising from its use.</p>
<h2>Changes and law</h2>
<p>We may update these terms and will post changes here. These terms are governed by the laws of India, and the courts at Ahmedabad have jurisdiction. Questions: <a href="mailto:${esc(s.contactEmail)}">${esc(s.contactEmail)}</a>.</p>`
  },

  preservation: {
    slug: 'preservation',
    title: 'DOIs, archiving and versions',
    description: 'How Ahmedabad Business Review identifies, preserves, versions and withdraws its articles, including DOI registration through Zenodo.',
    html: (s) => `
<p class="lede">Everything ${esc(s.shortName)} publishes is meant to be findable and citable for good.</p>
<h2>Permanent identifiers</h2>
<ul>
<li>Every article has an <b>article ID</b> (for example ABR-2026-0001) and a permanent address that does not change.</li>
<li>Research articles receive a <b>DOI</b> (Digital Object Identifier) registered through <a href="https://zenodo.org">Zenodo</a>, the open repository run by CERN, with DataCite. The DOI resolves to a Zenodo record holding the article’s PDF and metadata. It is printed on the article, its PDF and in every citation format. Promoted content does not receive a DOI.</li>
<li>Issues have a volume and number, and each compiled issue carries its reference in a barcode on the back cover.</li>
</ul>
<h2>Preservation</h2>
<p>Each article with a DOI has an independent copy held by Zenodo, which preserves records for the long term. The site also publishes a complete archive, a sitemap and an RSS feed.</p>
<h2>Licences</h2>
<p>Each article and DOI record states the licence it is published under. See <a href="/permissions">Rights and permissions</a>.</p>
<h2>Corrections and updates</h2>
<p>We correct errors openly. A corrected article shows a dated correction note and its “Updated” date; the article ID, address and DOI stay the same. See our <a href="/corrections">corrections policy</a>.</p>
<h2>Withdrawals</h2>
<p>In rare cases, such as serious error, plagiarism or a legal requirement, an article may be withdrawn. Its address then shows a notice giving the title, the dates and the reason, so citations still lead somewhere. A DOI cannot be deleted, so it continues to resolve, and the article’s address explains the withdrawal.</p>`
  },

  'ai-policy': {
    slug: 'ai-policy',
    title: 'How ABR uses AI',
    description: 'Ahmedabad Business Review’s policy on generative AI for its editors and contributors.',
    html: (s) => `
<p class="lede">AI can help us work faster. It does not decide what ${esc(s.shortName)} publishes, and it is never an author.</p>
<h2>Our editors</h2>
<ul>
<li>Editors may use AI tools to research, outline or prepare a first draft. Every such article is checked line by line by a named editor, its facts and figures are checked against the sources listed, and it goes through the same review and approval as any other article.</li>
<li>Articles drafted with AI assistance are labelled as such on the article page.</li>
<li>AI does not make publication decisions, and we do not use AI-generated images that could be mistaken for real photographs.</li>
</ul>
<h2>Contributors</h2>
<ul>
<li>Tell us in the disclosure box how you used AI, if at all. Using AI to check grammar or spelling needs no disclosure; using it to generate text, analysis or data does.</li>
<li>You are responsible for everything in your article, including anything an AI tool produced. AI tools cannot be listed as authors or cited as sources of facts.</li>
<li>Undisclosed AI-generated text is a reason to reject a submission or withdraw an article.</li>
</ul>
<h2>Our archive</h2>
<p>Reuse of ABR articles to train AI systems needs permission, like any other reuse beyond the article’s licence. See <a href="/permissions">Rights and permissions</a>.</p>`
  },

  contact: {
    slug: 'contact',
    title: 'Contact',
    description: 'Contact the editors of Ahmedabad Business Review.',
    html: (s) => `
<p class="lede">We welcome pitches, corrections and feedback.</p>
<h2>Editorial</h2>
<p>Write to <a href="mailto:${esc(s.contactEmail)}">${esc(s.contactEmail)}</a>.</p>
<h2>Pitching an article</h2>
<p>Send a short pitch (150 to 250 words) explaining the argument, why it matters now, the evidence you will use and your relevant background. We aim to reply within two weeks.</p>
<h2>Corrections</h2>
<p>Please include the article link and the specific error. See our <a href="/corrections">corrections policy</a>.</p>
<h2>Publisher</h2>
<p>${esc(s.publisher)}, Ahmedabad, Gujarat, India.</p>`
  }
};
