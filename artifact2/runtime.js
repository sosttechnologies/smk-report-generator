/*
 * Runtime shim.
 *
 * Inside claude.ai the page gets `window.claude.use('sample')` and
 * `window.claude.use('downloads')` from the host. Served from our own backend it
 * gets neither, so this file provides the same four calls over fetch:
 *
 *   sample(prompt, opts)       → POST /api/llm       → { text }
 *   sample.json(prompt, opts)  → POST /api/llm json  → parsed value
 *   sample.limits()            → GET  /api/llm       → { images }
 *   downloads.save({filename, data}) → a real browser download
 *
 * app.js does not know which it is running on. That is the point.
 */

const API = (window.SMK_API_BASE ?? '') + '/api';

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the image'));
    r.readAsDataURL(file);
  });
}

async function callLlm(prompt, opts = {}, json = false) {
  const images = [];
  for (const f of opts.images ?? []) images.push(await fileToDataUrl(f));
  const res = await fetch(`${API}/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, system: opts.system, json, images }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Model request failed (${res.status})`);
    err.code = res.status === 503 ? 'not_granted' : 'error';
    throw err;
  }
  return data.text ?? '';
}

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  const c = body.indexOf('['), d = body.lastIndexOf(']');
  const objFirst = a !== -1 && (c === -1 || a < c);
  const slice = objFirst ? body.slice(a, b + 1) : body.slice(c, d + 1);
  if (!slice) { const e = new Error('No JSON in the reply'); e.code = 'invalid_json'; e.text = text; throw e; }
  try { return JSON.parse(slice); }
  catch { const e = new Error('The reply was not valid JSON'); e.code = 'invalid_json'; e.text = text; throw e; }
}

export async function makeRuntime() {
  // Real host present: use it, unchanged.
  if (window.claude?.use) {
    const [sample, hostDownloads] = await Promise.all([
      window.claude.use('sample').catch(() => null),
      window.claude.use('downloads').catch(() => null),
    ]);
    // The sandbox cannot make a PDF. A .pdf request becomes an HTML page that
    // opens its own print dialog, so Save as PDF is one click away.
    const downloads = hostDownloads && {
      async save({ filename, data }) {
        if (filename.endsWith('.pdf')) {
          const html = String(data).replace('</body>',
            '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},400)})<\/script></body>');
          const out = await hostDownloads.save({ filename: filename.replace(/\.pdf$/, '.html'), data: html });
          return { ...out, degraded: true };
        }
        return hostDownloads.save({ filename, data });
      },
    };
    return { sample, downloads, hosted: 'claude' };
  }

  // Our own backend. Ask it what it can do before promising anything.
  let info = { available: false, images: false, provider: 'none', model: '' };
  try { info = await (await fetch(`${API}/llm`)).json(); } catch { /* backend absent */ }

  const sample = info.available
    ? Object.assign(
        async (prompt, opts) => ({ text: await callLlm(prompt, opts, false), truncated: false }),
        {
          json: async (prompt, opts) => extractJson(await callLlm(prompt, opts, true)),
          limits: async () => ({ images: info.images ? { max: 4 } : undefined, inputBytes: 400_000 }),
        },
      )
    : null;

  const downloads = {
    async save({ filename, data }) {
      let blob;
      if (filename.endsWith('.pdf')) {
        // The browser cannot make a PDF; the server's Chromium can.
        const res = await fetch(`${API}/pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: data, filename }),
        });
        if (!res.ok) throw new Error('PDF rendering failed on the server');
        blob = await res.blob();
      } else {
        const type = filename.endsWith('.doc') ? 'application/msword' : 'text/html';
        blob = new Blob([data], { type: `${type};charset=utf-8` });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { status: 'saved' };
    },
  };

  return { sample, downloads, hosted: 'self', info };
}
