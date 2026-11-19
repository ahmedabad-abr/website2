// Cloudflare Workers entry point. Static files in /public are served directly by
// Workers Static Assets; every other request (pages, feeds, /api) comes here.
import { onRequest } from './handler.js';

export default {
  async fetch(request, env, ctx) {
    return onRequest({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
  }
};
