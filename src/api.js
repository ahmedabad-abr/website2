// Talks to the Apps Script web app. The API secret is added here, on the server,
// so it never reaches the browser.

export class BackendError extends Error {}

export async function backend(env, action, payload = {}, token, meta) {
  if (!env.APPS_SCRIPT_URL || !env.API_SECRET) {
    throw new BackendError('Site is not configured: set APPS_SCRIPT_URL and API_SECRET in Cloudflare.');
  }
  const res = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload, token, meta, secret: env.API_SECRET }),
    redirect: 'follow'
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackendError(`Backend returned an unexpected response (HTTP ${res.status}).`);
  }
  if (!data.ok) throw new BackendError(data.error || 'Backend error');
  return data.data;
}
