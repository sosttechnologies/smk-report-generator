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
 * It also decides WHERE WORK IS KEPT. In the artifact that is localStorage, which is
 * per-browser and invisible to colleagues. On our own backend, signed in, it is the
 * organisation's database — so a report drafted on one machine is there for the next
 * person on theirs.
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

/* ---------------------------------------------------------------- storage --
 * Two implementations of the same two calls:
 *
 *   store.load()          → { reports, projects, template, user }
 *   store.flush(state, c) → persist what changed; c = { dirty, deleted, settings, base }
 *
 * One flush method rather than a save-per-thing, because the two backends disagree
 * about what a write even is: localStorage rewrites the whole blob, while the server
 * wants one request per report so that two people editing different students do not
 * overwrite each other. app.js says what changed and lets the store decide.
 *
 * `remote` tells app.js whether a write costs a network round trip, so it can debounce.
 * It does not tell it which backend is behind it.
 */

const LS_KEY = 'smk-report-generator-v1';

function localStore() {
  return {
    remote: false,
    async load() {
      let d = {};
      try {
        d = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') ?? {};
      } catch { /* corrupt store: start fresh rather than refuse to open */ }
      return {
        reports: Array.isArray(d.reports) ? d.reports : [],
        projects: Array.isArray(d.projects) ? d.projects : [],
        template: d.template ?? null,
        user: d.user ?? null,
        expandedProjects: d.expandedProjects ?? {},
      };
    },
    async flush(state) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({
          reports: state.reports,
          projects: state.projects,
          template: state.template,
          user: state.user,
          expandedProjects: state.expandedProjects,
        }));
      } catch { /* private window or quota: the app works, it just will not persist */ }
      return { saved: [] };
    },
  };
}

function remoteStore(firstPayload) {
  let primed = firstPayload;

  const send = async (url, init) => {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      const err = new Error('Someone else edited this report');
      err.code = 'conflict';
      err.report = body.report;
      throw err;
    }
    if (!res.ok) throw new Error(`Could not save (${res.status})`);
    return res.json().catch(() => ({}));
  };

  return {
    remote: true,

    async load() {
      // makeRuntime already fetched this to decide which store to use; a second round
      // trip for the same answer would only delay first paint.
      let d = primed;
      primed = null;
      if (!d) {
        const res = await fetch(`${API}/state`);
        if (!res.ok) throw new Error(`Could not load your reports (${res.status})`);
        d = await res.json();
      }
      let expandedProjects = {};
      try {
        // Which folders are open is this person's own view, not the organisation's.
        expandedProjects = JSON.parse(localStorage.getItem(`${LS_KEY}:ui`) ?? '{}') ?? {};
      } catch { /* not important enough to fail over */ }
      return {
        reports: d.reports ?? [],
        projects: d.projects ?? [],
        template: d.template ?? null,
        user: d.user?.email ? { name: d.user.email, org: 'SMK Gateway' } : null,
        expandedProjects,
      };
    },

    async flush(state, change) {
      const saved = [];
      const conflicts = [];

      for (const id of change.deleted ?? []) {
        await send(`${API}/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
      }

      for (const report of change.dirty ?? []) {
        try {
          const out = await send(`${API}/reports/${encodeURIComponent(report.id)}`, {
            method: 'PUT',
            body: JSON.stringify({ report, baseUpdatedAt: change.base?.get(report.id) ?? null }),
          });
          if (out.report) saved.push(out.report);
        } catch (e) {
          // One report losing a race must not stop the others being saved.
          if (e.code === 'conflict') conflicts.push({ id: report.id, server: e.report });
          else throw e;
        }
      }

      if (change.settings) {
        await send(`${API}/settings`, {
          method: 'PUT',
          body: JSON.stringify({ projects: state.projects, template: state.template }),
        });
      }

      try {
        localStorage.setItem(`${LS_KEY}:ui`, JSON.stringify(state.expandedProjects ?? {}));
      } catch { /* see above */ }

      return { saved, conflicts };
    },
  };
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
    return { sample, downloads, store: localStore(), hosted: 'claude' };
  }

  // Our own backend. Ask it what it can do before promising anything.
  let info = { available: false, images: false, provider: 'none', model: '' };
  try { info = await (await fetch(`${API}/llm`)).json(); } catch { /* backend absent */ }

  // Signed in to a server that keeps state? Then work is shared. /api/state answers
  // 401 when there is no session, which is also the case in local single-user mode,
  // and fails outright when there is no backend at all — both mean localStorage.
  let store = localStore();
  try {
    const res = await fetch(`${API}/state`);
    if (res.ok) store = remoteStore(await res.json());
  } catch { /* no backend: localStorage it is */ }

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

  return { sample, downloads, store, hosted: 'self', info };
}
