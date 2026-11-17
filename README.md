# Ahmedabad Business Review — website and editorial portal

ABR is an online publication with a public site and a private editorial portal:

- **Public site** (`theabr.in`): articles, sections, author pages, editorial standards, public **brand guidelines with the downloadable brand kit** (`/brand`), an RSS feed and a sitemap. Every article page is rendered on the server with full citation metadata, so **pasting an article link into MyBib, Zotero, Mendeley or EndNote fills in the title, authors, date and publisher automatically.**
- **Editorial portal** (`theabr.in/portal/`): the Chair, editors and COO log in, write articles, and submit them. The **Chair approves** an article before it goes live.
- **Backend**: a Google Sheet plus Apps Script. Cloudflare talks to it server-side with a secret key, so the Apps Script URL and drafts are never exposed to the public.

```
Browser ──► Cloudflare Worker (GitHub deploy)
              ├─ /assets, /portal       static files
              └─ everything else        Worker (src/worker.js → src/handler.js)
                    ├─ renders public pages + citation metadata (cached 5 min)
                    └─ /api  ──secret──►  Apps Script web app ──► Google Sheet / Drive
```

---

## 1. Set up the backend (Google Sheet + Apps Script)

1. Create a new Google Sheet named **ABR Editorial Database**. Use the Google account that should own ABR's data, ideally an organisational account rather than a personal one.
2. Open **Extensions → Apps Script**. Delete the sample code and paste in the contents of `apps-script/Code.gs`. Then add two more script files (**+ → Script**) named `Mail` and `Agreement`, and paste in `apps-script/Mail.gs` and `apps-script/Agreement.gs`.
3. Open **Project Settings**, tick **Show "appsscript.json" manifest file**, and replace that file's contents with `apps-script/appsscript.json`.
4. Select the `setup` function and click **Run**. Approve the permissions it asks for (Sheets, Drive, sending email, connecting to external services, and triggers). This creates the `Users`, `Articles`, `Subscribers`, `MailQueue`, `Campaigns`, `Agreements` and `AuditLog` tabs, a Drive folder for images, the API secret, and the background email sender (runs every 5 minutes).
5. Reload the Sheet. A new **ABR Admin** menu appears. Choose **ABR Admin → Create Chair account**, enter your email and name, and note the temporary password it shows.
6. In Apps Script, click **Deploy → New deployment → Web app** and set:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
7. Back in the Sheet, choose **ABR Admin → Show API secret** and copy the secret.

> When you change `Code.gs` later, use **Deploy → Manage deployments → ✏️ Edit → Version: New version**. This keeps the same URL. Creating a *new* deployment would give you a different URL.

Optional settings live in **Apps Script → Project Settings → Script properties**:

| Property   | Meaning                                                              |
|------------|----------------------------------------------------------------------|
| `SITE_URL` | `https://theabr.in` (used in email links)                            |
| `NOTIFY`   | `true` emails the Chair on each submission and authors on decisions |

## 2. Put the code on GitHub

```bash
cd abr-site
git init && git add . && git commit -m "ABR website and editorial portal"
git branch -M main
git remote add origin https://github.com/<your-account>/abr-site.git
git push -u origin main
```

The repository can be private. It contains no secrets.

## 3. Deploy on Cloudflare (Workers)

The site runs as a **Cloudflare Worker with static assets**. The `wrangler.toml` in this repo is already set up for it.

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → pick `abr-site`.
2. Build settings:
   - Build command: *(leave empty)*
   - Deploy command: `npx wrangler deploy` (the default)
   - Root directory: `/`
3. After the first deploy, open the Worker → **Settings → Variables and Secrets** and add:

| Name              | Type       | Value                                  |
|-------------------|------------|----------------------------------------|
| `APPS_SCRIPT_URL` | **Secret** | the `/exec` URL from step 1.6          |
| `API_SECRET`      | **Secret** | the secret from step 1.7               |

   `SITE_URL` is already set in `wrangler.toml`.
4. **Deployments → Retry/redeploy** (or push any commit). Every push to `main` redeploys automatically.
5. **Settings → Domains & Routes → Add → Custom domain**: `theabr.in` (and `www.theabr.in` if used). Use the custom domain rather than `*.workers.dev`, because Cloudflare's page cache only works on custom domains.

> Prefer a classic Pages project? That works too: `functions/[[path]].js` is the Pages entry point. Set the build output directory to `public` and leave the build and deploy commands empty.

## 3b. Research-paper PDFs (Cloudflare Browser Rendering)

Every article gets a downloadable, research-paper-style PDF at `/articles/<slug>.pdf`. It has:
- a title page with the ABR logo, volume and issue, article ID, authors and their roles, a boxed abstract, keywords and a "How to cite" line;
- Times New Roman 12 pt, double-spaced and justified body text, with a hairline frame on every page;
- References with hanging indents, author notes, and a footer reading "Page X of Y".

The PDF is generated once per article version and then stored. Google Scholar finds it through the `citation_pdf_url` tag.

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token → Custom token**. Give it the permission **Account · Browser Rendering · Edit** and create it.
2. In the Worker → **Settings → Variables and Secrets**, add two **Secrets**:
   - `CF_ACCOUNT_ID`: your account ID, shown on the Workers & Pages overview page
   - `CF_API_TOKEN`: the token from step 1
3. *(Recommended)* **Storage & Databases → KV → Create** a namespace called `abr-pdfs`. Paste its ID into the commented `[[kv_namespaces]]` block in `wrangler.toml`, uncomment the block, and push. Without it, PDFs are cached at the edge and occasionally regenerated.

Until these are set, the "Download PDF" button opens a printable paper view (`/articles/<slug>/paper`) that readers can save as a PDF from the browser.

The Workers free plan includes about 10 minutes of browser rendering a day, which is plenty for an article published now and then, because each PDF is rendered only once. When an article is published or corrected, the Apps Script background job requests its PDF within about 5 minutes, so it is ready before readers or Google Scholar ask for it.

## 3c. Getting indexed

**Google**
1. Go to Google Search Console → **Add property → Domain** `theabr.in` → verify it with the TXT record in Cloudflare DNS.
2. Under **Sitemaps**, submit `https://theabr.in/sitemap.xml`. New articles are added to the sitemap automatically.
3. Optionally, use **URL Inspection → Request indexing** on new articles to speed things up.

**Google Scholar** has no submission form. It crawls sites that meet its guidelines. What ABR now provides for it:
- `citation_*` tags on every article: title, each author with institution, date, journal title and abbreviation, volume, issue, publisher, PDF URL, keywords and every reference;
- a PDF with the title and authors on the first page and a **References** section at the end;
- the abstract (standfirst) visible on the article page;
- an **Archive** page (`/archive`) linking every article by volume and issue;
- crawlable, permanent URLs with no login.

Indexing usually takes weeks to a few months after the site is live and Google has crawled it. Scholar includes sites whose content is mainly scholarly, so research-style pieces (Analysis, Research Briefs, Case Studies) with full references give ABR the best chance. Opinion pieces and interviews are less likely to be included. To help, the portal now requires at least 2 references before an Analysis, Case Study, Research Brief or Explainer can be submitted.

**Volume and issue numbering:** one volume per calendar year (Volume 1 = 2026), six two-month issues (No. 6 = Nov–Dec). Change this with `volumeStartYear` and `issuesPerYear` in `src/config.js`. Articles back-dated before Volume 1 show the month and year only.

## 4. First run

1. Open `https://theabr.in/portal/`, log in with the temporary password, and change it under **My profile**. Add your bio and photo there too.
2. Under **Team**, add Darshini (Editor-in-Chief), Kaneesha (COO) and the editors. Each person gets a temporary password, shown to you and emailed to them.
3. Write a test article, submit it, approve it from **Approval queue**, and open it on the site.
4. Paste the article link into mybib.com. The title, authors, date and publisher should all fill in.
5. In Google Search Console, add `theabr.in` and submit `https://theabr.in/sitemap.xml` (see 3c).
6. **Starter articles:** in the Sheet, choose **ABR Admin → Import starter articles**. Six researched articles on Gujarat business arrive in the portal's Approval queue under the Chair's name. Read each one, check the figures against its references, edit, and approve. Each article carries a disclosure line saying it was drafted with AI assistance and checked by ABR's editors. Keep that line, as ABR's editorial standards require it.

---

## Email (Settings → in the portal, Chair only)

Every email (welcome, agreement copy, approval notices, subscription confirmations, newsletters) uses the branded ABR template and is sent from **info@theabr.in** (changeable under Settings → Sender).

**Three providers**, chosen separately for *system emails* and *newsletters/team emails*:

| Provider | Best for | How to connect |
|---|---|---|
| **Zoho Mail** (Self Client) | Newsletters, team emails | api-console.zoho.in → Add Client → Self Client → copy Client ID + Secret → Generate Code with scope `ZohoMail.messages.CREATE,ZohoMail.accounts.READ` → paste in Settings → **Connect** (within a few minutes) |
| **ZeptoMail** | System emails only (its terms forbid newsletters) | Verify theabr.in in ZeptoMail → Mail Agent → SMTP/API → copy the **Send Mail token** → paste in Settings |
| **Google** | Fallback | Nothing to connect. Sends from the Apps Script owner's Gmail |

- **Daily limit:** set it at or below your Zoho plan's sending limit. Anything over the limit stays in the queue and goes out automatically the next day (midnight IST reset). Team emails go before subscriber emails, and system emails go first.
- **Sending:** Portal → **Email**. Choose any mix of subscribers, the whole team, editors, the COO, or specific members. Write a message (`{{first_name}}` works), optionally feature articles, preview it, send yourself a test, then send. **Sent campaigns** shows the sent, waiting and failed counts, with a retry option.
- **Subscribers:** the sign-up form is in the site footer, at the end of every article and at `/subscribe`. People confirm by email (double opt-in), and every newsletter has an unsubscribe link. Portal → **Subscribers** lets you add (with consent), remove and export to CSV.
- Secrets (the Client Secret, refresh token and ZeptoMail token) are stored only in Apps Script's Script Properties and are never sent to the browser.
- Before relying on it, add SPF and DKIM DNS records for theabr.in (both Zoho Mail and ZeptoMail show them in their domain settings) so emails don't land in spam.

## Team agreement and onboarding

- Adding a member under **Team** sends them a branded **welcome email** with their temporary password and first steps. The text depends on their role (COO, Editor-in-Chief, editor).
- On first login, every member except the Chair must read and sign the **Team Member Confidentiality and Ownership Agreement**. They tick a box and type their full name. The portal stays locked until they do.
- Each signature records the name, time, IP address, browser and a SHA-256 fingerprint of the exact text. A PDF is saved to the private Drive folder "ABR — Signed Agreements", the member receives a copy by email, and the Chair is notified. Status and PDF links appear under **Team**.
- To edit the text, legal entity or version, go to **Settings → Team agreement**. **Raising the version makes everyone sign again.**
- ⚠️ The default text is a starting template, not legal advice. Have a lawyer review it, and confirm the exact legal name of the entity. Under Indian law, an agreement signed by someone under 18 is generally not enforceable, so for minors get a parent or guardian to sign as well.

## Curated byline, partners, import and AI drafts

After updating the Apps Script code, run **ABR → Setup** once more: it adds the new article columns and the **Partners** sheet. Your data is not touched.

**Curated byline.** In the editor, choose *Byline → Curated by Ahmedabad Business Review*. The article shows ABR as the author (in citations too, e.g. “Ahmedabad Business Review. (2026).”) and does not appear on anyone’s personal author page.

**Partners and promoted articles (Chair).** Add partners on the portal’s **Partners** page. Each partner gets a private code and a co-brand link (`/cobrand?code=…`). In the editor’s *Partnership* box, mark an article as *In partnership with* or *Promoted · Supported by* a partner. Promoted articles are clearly labelled, their links are marked `rel="sponsored"`, and they carry no Google Scholar tags. Public pages: `/partners` and `/partner-content`.

**Co-brand kit.** Partners open their link, upload their logo, and download a zip with horizontal and stacked lockups for light and dark backgrounds (PNG and SVG) plus a README of usage rules. The logo is trimmed and scaled automatically in their browser; the trimmed logo is also saved to ABR and shown on their articles.

**Import (Chair).** Portal → **Import** takes an ABR import file (`.json`). Imported articles land in the Approval queue (or as drafts). Duplicate titles are skipped.

**AI drafts (Groq).** In Cloudflare → your Worker → Settings → Variables and Secrets, add a **Secret** `GROQ_API_KEY` (from console.groq.com → API Keys). Optional plain variable `GROQ_MODEL` (default `openai/gpt-oss-120b`, which uses Groq’s built-in web search). Then the Chair, Editor-in-Chief and COO see **AI draft** in the portal. Each draft is researched with live web search, every reference link is checked, and the draft lands in the Approval queue with the AI disclosure already written in, plus a reference-check report for the editor. Turn the feature off or set a daily limit in **Settings → AI drafts**. Nothing is ever published without the Chair’s approval.

## Terms, certificates, letters, submissions, issues, DOIs and analytics

After pasting the new Apps Script code, run **ABR Admin → Run setup** again. It adds the Certificates, Letters and Issues sheets and the new columns. Existing data is not touched.

**Forgot password.** Every team member can reset their own password from the portal login ("Forgot your password?"). The link is emailed, works once and expires in 1 hour.

**Terms of office (EiC and COO).** When you appoint an Editor-in-Chief or COO in Team, set a term end date. Reminders go to them and to you 30 and 7 days before. When a term ends, they automatically get a Certificate of Service, their role changes to Editor, and you are emailed to appoint someone or re-appoint them (set a new end date in Team).

**Certificates.** Issued automatically, each with a reference (ABRC-YYYY-NNNN), a page at `/certificates/<ref>`, a PDF, an "Add to LinkedIn" button and public verification at `/verify`:
- publication: each named author when an article is published (including outside contributors);
- contribution: each author when an issue is published;
- service: when an EiC or COO term ends;
- editorial service: every January, for the year before, to active team members.
The Chair can also issue custom certificates and revoke any certificate (Portal → Certificates).

**Letters on letterhead (Chair).** Portal → Letters. Type the letter in plain text: a blank line starts a new paragraph, Enter is a new line, "- " makes bullets, "1. " numbers, `**bold**`, `_italic_`. Each letter gets a reference (ABRL-…), a private link and a PDF. `/verify` confirms a letter is genuine without showing its contents.

**Write for ABR.** Anyone can submit at `/submit`. Submissions land in the Approval queue marked "Outside", and the contributor gets a private tracking link (`/track`). If you request changes, they revise from that page. Publishing sends them the link and a certificate. Every article in the portal now shows its full history.

**Issues.** Portal → Issues. Create an issue (Volume, Number, title, cover colour, theme line), tick the published articles in it, write the Chair's foreword (required; the EiC, COO and editors may add optional statements), then Publish. That publishes `/issues/<key>` with an automatically designed cover, and a compiled PDF: cover, masthead, statements, contents and every article in research-paper style. Articles in an issue cite that issue's volume and number.

**Share cards.** With Browser Rendering set up (CF_ACCOUNT_ID and CF_API_TOKEN), every article gets a branded 1200×630 image for WhatsApp, LinkedIn and X at `/og/<slug>.png`, and issues get cover images. The same token also renders certificate, letter and issue PDFs. Use the KV namespace `PDFS` so each file is made only once.

**DOIs (Zenodo).** Portal → Settings → DOIs. Paste a Zenodo personal access token (zenodo.org → Account → Applications → New token, scopes `deposit:write` and `deposit:actions`). Try "Sandbox" first, with a separate sandbox.zenodo.org account. On publish the site reserves a DOI, prints it on the article and PDF, uploads the PDF and publishes the record, usually within 15 minutes. The DOI then appears on the page, in every citation format and in the `citation_doi` tag. Promoted articles are skipped. "Register DOIs for all published articles" handles the back catalogue. Pick the licence you want before registering: a DOI record can't be deleted.

**Analytics.** Create a D1 database in Cloudflare (Storage & Databases → D1 → Create, name it `abr-analytics`). Paste its ID into the `[[d1_databases]]` block in `wrangler.toml` and uncomment the block. Page views per day, page, country and referring site appear in Portal → Analytics for the Chair, EiC and COO. Analytics uses no cookies and stores no personal data, and bots are not counted.

## Policies, rights and permissions, and the planner (17 November 2026 update)

**Run `setup` once more** after pasting the new `Code.gs`. It adds the `Permissions`, `Tasks` and `Calendar` tabs. Then deploy a **New version**.

**Policy pages.** New pages, linked from a new *Policies* column in the footer:
- `/privacy` (written around India's Digital Personal Data Protection Act, 2023);
- `/terms`;
- `/permissions`;
- `/preservation` (DOIs, archiving, versions and withdrawals);
- `/ai-policy`.

Set `privacyEmail` and `policyDate` in `src/config.js`, and replace `contactEmail` with ABR's real inbox. The wording is a careful starting point, not legal advice: have a lawyer read the privacy policy and terms before relying on them.

**Licence on every article and issue.** The licence chosen in Portal → Settings → DOIs (default CC BY-NC-ND 4.0) is now the licence for every published article. It appears in a *Rights and reuse* box with a ready-made credit line and a *Request permission* button, and on the article and issue PDFs.

**Permissions and licence grants.**
- Anyone can request a licence at `/permissions` for teaching, course packs, research, reprints, translation, commercial use and so on.
- The Chair, EiC or COO decides in Portal → **Permissions**.
- On approval, a numbered licence grant (`ABRP-2026-0001`) is issued automatically and emailed to the requester. It is on black-and-white letterhead, one page, printable and downloadable as a PDF, with the exact credit line, period and conditions.
- Anyone can check the licence at `/verify`.
- Declined and revoked requests are emailed with the reason.
- Commercial grants also create a two-page approval record; other manual grants create a one-page record.
- In Permissions → Settings the Chair can approve automatically classroom, course-pack and research requests that are non-commercial and use the material unchanged. You can also set the longest licence period and the standard conditions.

**Contributor licence.** New submissions from `/write` must tick a fifth declaration: the author keeps copyright and licenses ACRI to publish, archive, register a DOI and grant reuse permissions.

**AI label.** Articles created from an AI draft now show a short *Drafted with AI assistance* note linking to `/ai-policy`.

**Planner (Portal → Planner).** Available to everyone on the team.
- **Task board:** To do, In progress, In review and Done. Each task has an assignee, type of work, due date, priority, and optionally an issue and an article.
- **Team strip:** shows each person's open and overdue tasks and what they are working on now. Click a person to see only their tasks.
- **Who can do what:** the Chair, EiC and COO assign tasks to anyone, and assignees get an email. Editors create and move their own tasks. Drag cards between columns, or use the move buttons.
- **Calendar:** shows deadlines, meetings and publication days, plus task due dates, published articles, issue publications and EiC/COO term ends.
- **Plan an issue cycle:** adds the standard milestones from a publication date (pitches 6 weeks before, first drafts 4 weeks, edits 18 days, statements 12 days, Chair's foreword 10 days, cover and PDF check 1 week, final approval 3 days).
- **Reminders:** every morning, people get an email listing tasks that are overdue or due within two days.

## Printed approval records, subscriber choices, contributor accounts (November 2026 update)

**After updating the code, run `setup` once more** (Apps Script → select `setup` → Run). It adds the `Approvals` and `Contributors` tabs and the new subscriber columns. Nothing existing is changed. Then **Deploy → Manage deployments → Edit → New version**.

**Approval records (Chair).** Whenever an approval is recorded (an article published or withdrawn, a partner article, an issue published, an EiC/COO appointed or a term ended, a team member or partner added, a certificate revoked), the portal makes a black-and-white letterhead record and asks: *Print now*, *Download PDF* or *Print later*.
- **Standard** records are one page, signed by the Chairperson.
- **Major** records are two pages. Page 1 is countersigned by the President, Director of Students, Vice President or Provost of ACRI (you choose who, per type, in Approvals → Settings). Page 2 is the Chairperson's approval.
- Portal → **Approvals** lists records by *To print*, *Printed* and *Filed*. When the signed copy is in the file, click *Mark filed* and enter the file number. You can also create a record by hand for any other decision.
- Each record has a reference (`ABRA-2026-0001`) that anyone can check at `/verify`. Only the category, date and filing status are shown publicly, never the subject.

**Subscriber preferences.** Every email to subscribers has a *Choose what you receive* link. Subscribers pick: every new article as it is published, a weekly digest (Mondays), a monthly digest (1st of the month), or nothing; which sections; whether to hear about new issues; and whether to get newsletters. The default for new subscribers is the weekly digest. Portal → Subscribers shows what each person receives.

**Issue statements.** When the Chair creates an issue, the EiC, COO and editors are invited by email to submit a statement. On the Issues page the Chair ticks **Use in issue** for each statement to include. The Chair's foreword is always included.

**Back cover and barcode.** Every compiled issue PDF now ends with a back cover: about ABR, how to cite and write for ABR, the publisher block and a printed barcode of the issue reference (`ABR-V1-N06-2026`). If you later get an ISSN, add it in Settings (`site.issn`) and the barcode becomes the standard EAN-13 magazine barcode with the issue number as a 2-digit add-on.

**Contributor accounts (`/write`).** Outside writers now create an account: sign up → confirm by email → sign in. From their account they submit articles, see every submission's status and timeline, read the editors' notes, revise and resend when changes are requested, edit their profile and open their certificates. They can reset a forgotten password themselves. Anyone who submitted before accounts existed only needs to sign up with the same email: their earlier submissions appear automatically. `/submit` now redirects to `/write`. Old `/track` links keep working. Contributor accounts are separate from team accounts, and a team member's email can't be used to sign up as a contributor.

**Verify page (`/verify`).** Redesigned. It checks certificates (`ABRC-`), letters (`ABRL-`), approval records (`ABRA-`) and article IDs (`ABR-`).

## How the editorial workflow works

| Status            | Who can edit             | What happens next                                                   |
|-------------------|--------------------------|---------------------------------------------------------------------|
| Draft             | Lead author, co-authors  | The lead author clicks **Submit for approval**                      |
| Awaiting approval | Chair only               | Chair chooses **Approve & publish**, **Request changes** or **Reject** |
| Changes requested | Authors                  | Authors revise and resubmit; the Chair's note is shown              |
| Published         | Chair only               | Chair can add a public **correction** or **withdraw** the article   |
| Withdrawn         | —                        | The URL shows a public withdrawal notice; the Chair can republish   |

- To submit, an article needs a title, standfirst, section, type and at least 150 words.
- Article IDs are permanent and sequential: `ABR-2026-0001`, `ABR-2026-0002`, …
- The URL slug is fixed at publication, so citations never break.
- **Back issues:** when entering articles from the old magazine issues, the Chair can set an **Original publication date**. Citations then use that date instead of the upload date.
- Drafts autosave every minute. The `AuditLog` tab records every login, save, submission and decision.

## What makes the articles citable

Each article page carries:

- **Highwire Press tags** (`citation_title`, `citation_author`, `citation_publication_date`, `citation_publisher`, …). MyBib, Zotero and Google Scholar read these first.
- **Dublin Core** (`DC.title`, `DC.creator`, `DC.date`, …).
- **OpenGraph and article tags**, for link previews on WhatsApp, LinkedIn and X.
- **schema.org JSON-LD** (`NewsArticle`, `AnalysisNewsArticle`, `OpinionNewsArticle`, and so on), with author, publisher (ABR, part of ACRI), dates and corrections.
- A visible **"Cite this article"** box with APA 7, MLA 9, Chicago, Harvard and BibTeX, plus a copy button.

Plus the trust signals reviewers and search engines look for: named authors with bios, type labels, an opinion disclaimer, sources and references, conflict-of-interest disclosures, public corrections, withdrawal notices, and standing pages (About, Editorial standards, Corrections policy, How to cite, Contact).

## Customising

| What                                          | Where                                                              |
|-----------------------------------------------|--------------------------------------------------------------------|
| Contact email, ISSN, publisher, tagline       | `src/config.js`                                                    |
| About, editorial standards, corrections, contact text | `src/pages.js`                                             |
| Sections and article types                    | `SECTIONS` / `TYPES` in `Code.gs` **and** `sections` in `src/config.js` (keep them identical) |
| Roles, and who can approve                    | `ROLES`, `APPROVER_ROLES` in `Code.gs` (e.g. add `'eic'` to let the Editor-in-Chief approve) |
| Look and feel                                 | `public/assets/style.css`, `public/portal/portal.css`              |
| Logo, brand kit, guidelines PDF               | `public/brand/` (replace files with the same names to update)      |
| Brand guidelines page text                    | `brand` in `src/pages.js`                                          |
| Favicons                                      | `public/favicon.ico`, `favicon.svg`, `apple-touch-icon.png`        |
| Edge cache time                               | `cacheSeconds` in `src/config.js` (default 300 s)                  |

## Good to know

- **New and edited articles take up to 5 minutes to appear**, because public pages are cached at Cloudflare's edge so the site stays fast and Apps Script isn't hit on every visit.
- Portal logins last 6 hours of inactivity. After 5 wrong passwords, an account is locked for 15 minutes.
- Images are uploaded to the "ABR — Article Images" Drive folder (shared view-only by link), resized to at most 1600 px wide, and limited to 5 MB.
- The Google fallback is subject to Apps Script's daily email quota. Zoho Mail and ZeptoMail have their own plan limits.
- The site follows the ABR brand guidelines: horizontal black logo in the header, white stacked logo in the footer, Inter throughout, black and white, with Paper (#F2F0EB) as the background tone.
- **Next credibility steps:** apply for an ISSN (online) from the ISSN National Centre for India once a few months of articles are live, then put it in `src/config.js`. It appears in the footer and the metadata automatically. Also register ABR in Google News Publisher Center.

## Local preview (optional)

```bash
npx wrangler dev --var APPS_SCRIPT_URL:<url> --var API_SECRET:<secret>
```

## Files

```
apps-script/Code.gs          backend: auth, articles, review workflow, team, uploads, public API
apps-script/Mail.gs          email: Zoho Mail / ZeptoMail / Google, queue + daily limit, templates, campaigns, subscribers
apps-script/Agreement.gs     team agreement signing, PDF copies, welcome and password-reset emails
apps-script/Seed.gs          six starter articles (ABR Admin → Import starter articles)
apps-script/Features.gs      byline, partners, import, AI drafts
apps-script/Records.gs       terms, certificates, letters, submissions, issues, DOIs, password reset
apps-script/Approvals.gs     printed approval records
apps-script/Contributors.gs  contributor accounts for /write
apps-script/Permissions.gs   rights and permissions requests, licence grants
apps-script/Planner.gs       task board, editorial calendar, publication cycles
apps-script/Code-all-in-one.gs  every .gs file above combined, for one-step copy and paste
apps-script/appsscript.json  Apps Script manifest
src/handler.js               router: server-rendered pages, feeds, archive, PDFs, subscribe/unsubscribe, /api proxy
src/paper.js                 research-paper layout used for the PDFs
src/pdf.js                   PDF generation (Browser Rendering) and storage (KV)
src/worker.js                Cloudflare Workers entry point
functions/[[path]].js        Cloudflare Pages entry point (alternative)
src/                         rendering, citation metadata, standing pages, config
public/assets/               CSS, shared HTML sanitiser, citation-box script
public/brand/                logos (SVG/PNG/PDF), social avatars, brand kit ZIP, guidelines PDF
public/portal/               the editorial portal (login, editor, approval queue, team, profile)
public/_headers              security and caching headers
wrangler.toml                Cloudflare Worker settings (entry src/worker.js, static assets in public/)
```
