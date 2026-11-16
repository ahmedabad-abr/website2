// Site-wide settings. SITE_URL can be overridden with a Cloudflare environment variable.
export const SITE = {
  name: 'Ahmedabad Business Review',
  shortName: 'ABR',
  tagline: 'Analysis and ideas on business, entrepreneurship, innovation and leadership.',
  publisher: 'Ahmedabad Centre for Research and Innovation',
  publisherShort: 'ACRI',
  publisherUrl: 'https://acriindia.org',
  url: 'https://theabr.in',
  contactEmail: 'editor@theabr.in',      // TODO: replace with ABR's real editorial inbox
  issn: '',                              // e.g. '1234-5678' once the ISSN (online) is allotted
  locale: 'en_IN',
  language: 'en',
  timeZone: 'Asia/Kolkata',
  twitter: '',                           // e.g. '@theabr' if you have one
  sections: ['Business', 'Entrepreneurship', 'Innovation', 'Leadership', 'Policy & Economy'],
  cacheSeconds: 300                      // how long public pages are cached at Cloudflare's edge
};

export function siteConfig(env) {
  return { ...SITE, url: (env && env.SITE_URL ? env.SITE_URL : SITE.url).replace(/\/$/, '') };
}

export function slugify(s) {
  return String(s || '').toLowerCase().replace(/['’‘]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 80);
}
