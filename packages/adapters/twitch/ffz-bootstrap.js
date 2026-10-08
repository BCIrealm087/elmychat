import { createHash } from 'node:crypto';
export const ffzBootstrapUrl = 'https://cdn.frankerfacez.com/script/script.min.js';

// Hash the actual bootstrap. SRI binds the frame's script to this report, but
// upstream chunks/add-ons remain mutable and are not pinned by this hash.
export async function fetchBootstrap(fetcher = fetch, callerSignal) {
  const timeout = AbortSignal.timeout(30000);
  const signal = callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout;
  const origin = new URL(ffzBootstrapUrl).origin;
  let url = ffzBootstrapUrl;
  const redirects = [];
  try {
    let response;
    while (true) {
      response = await fetcher(url, { signal, redirect: 'manual' });
      if (![301,302,303,307,308].includes(response.status)) break;
      await response.body?.cancel();
      if (redirects.length >= 3) throw new Error('FFZ bootstrap exceeded three redirects.');
      const location = response.headers.get('location');
      if (!location) throw new Error('FFZ bootstrap redirect has no Location header.');
      const next = new URL(location,url);
      if (next.origin !== origin || next.username || next.password) throw new Error('FFZ bootstrap redirect left the approved HTTPS CDN.');
      next.hash = '';
      redirects.push({status:response.status,from:url,to:next.href});
      url = next.href;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`FFZ bootstrap returned HTTP ${response.status}.`);
    }
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 5 * 1024 * 1024) throw new Error('FFZ bootstrap exceeds the proof size limit.');
        chunks.push(Buffer.from(value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    if (!size) throw new Error('FFZ bootstrap is empty.');
    const digest = createHash('sha256').update(Buffer.concat(chunks)).digest('base64');
    return { url: ffzBootstrapUrl, resolvedUrl:url, redirects, bytes: size, integrity: `sha256-${digest}` };
  } catch (cause) {
    const details = downloadErrorDetails(cause);
    const codes = [...new Set(details.map(item=>item.code).filter(Boolean))];
    const error = new Error(`FFZ bootstrap download failed: ${details[0]?.message || 'Unknown error'}${codes.length ? ` (${codes.join(', ')})` : ''}`, {cause});
    error.bootstrapFailure = {url:ffzBootstrapUrl,resolvedUrl:url,redirects,causes:details};
    throw error;
  }
}

function downloadErrorDetails(error) {
  const result = []; const seen = new Set(); const pending = [error];
  while (pending.length && result.length < 8) {
    const item = pending.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    const code = typeof item.code==='string' && /^[A-Z0-9_]{1,80}$/.test(item.code) ? item.code : undefined;
    // No stacks, proxy URLs/credentials or request headers in proof reports.
    const message = String(item.message ?? '').replace(/https?:\/\/\S+/gi,'[URL]').slice(0,240);
    result.push({name:String(item.name ?? 'Error').slice(0,80),message,...(code?{code}:{})});
    if(item.cause) pending.push(item.cause);
    if(Array.isArray(item.errors)) pending.push(...item.errors.slice(0,8));
  }
  return result;
}

