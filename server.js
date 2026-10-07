// Dashboard métricas de tienda — pedidos Dropi + Meta Ads (conexión directa, sin subir reportes).
// Los datos viven en TU repo de GitHub:
//   data/orders/{YYYY-MM}.json   pedidos de Dropi (por ID, sincronizados desde la API de Dropi)
//   data/meta_campaigns.json     inversión/compras/facturación de Meta por día y campaña
//   data/sync.json               última sincronización de cada fuente
//   data/config.json             configuración editable (fletes estimados, mapeo de productos, proyecciones)
// Producción: GH_TOKEN + GH_REPO ("owner/repo"). Sin token usa archivos locales (pruebas).
// Opcional: META_TOKEN + META_ACCOUNTS ("id1,id2") → el botón "Actualizar Meta" jala Meta en vivo desde el servidor.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4000;
const GH = {
  token: process.env.GH_TOKEN,
  repo: process.env.GH_REPO,
  branch: process.env.GH_BRANCH || 'main',
  base: (process.env.GH_DIR || 'data').replace(/\/+$/, ''),
};
const useGH = !!(GH.token && GH.repo);
const META = { token: process.env.META_TOKEN, accounts: (process.env.META_ACCOUNTS || '24279427948421869,1070491651938261').split(',').map(s => s.trim()).filter(Boolean) };

// ─────────── GitHub ───────────
const ghHeaders = () => ({ 'Authorization': 'Bearer ' + GH.token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'metricas-tienda', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' });
async function ghBlob(sha) {
  const r = await fetch(`https://api.github.com/repos/${GH.repo}/git/blobs/${sha}`, { headers: ghHeaders() });
  if (!r.ok) throw new Error(`GitHub blob ${sha} ${r.status}`);
  return Buffer.from((await r.json()).content, 'base64').toString('utf8');
}
async function ghGet(repoPath) {
  const r = await fetch(`https://api.github.com/repos/${GH.repo}/contents/${repoPath}?ref=${GH.branch}`, { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${repoPath} ${r.status} ${await r.text()}`);
  const j = await r.json();
  if (Array.isArray(j)) return { dir: j };
  const txt = j.content ? Buffer.from(j.content, 'base64').toString('utf8') : await ghBlob(j.sha); // >1MB: la Contents API viene vacía
  return { obj: JSON.parse(txt), sha: j.sha };
}
async function ghPut(repoPath, obj, sha, msg) {
  const body = { message: msg || ('update ' + repoPath), content: Buffer.from(JSON.stringify(obj)).toString('base64'), branch: GH.branch };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${GH.repo}/contents/${repoPath}`, { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`GitHub PUT ${repoPath} ${r.status} ${await r.text()}`);
  return (await r.json()).content.sha;
}
const localPath = (p) => path.join(__dirname, p);

// ─────────── Almacenamiento (con caché corta para no gastar la API de GitHub) ───────────
const CACHE = new Map(); const TTL = 60 * 1000;
async function readJson(repoPath) {
  const c = CACHE.get(repoPath); if (c && Date.now() - c.t < TTL) return c.v;
  let v;
  if (useGH) { const g = await ghGet(repoPath); v = g ? { obj: g.obj, sha: g.sha } : { obj: null, sha: null }; }
  else { try { v = { obj: JSON.parse(fs.readFileSync(localPath(repoPath), 'utf8')), sha: null }; } catch { v = { obj: null, sha: null }; } }
  CACHE.set(repoPath, { t: Date.now(), v }); return v;
}
async function writeJson(repoPath, obj, sha, msg) {
  CACHE.delete(repoPath);
  if (useGH) return ghPut(repoPath, obj, sha, msg);
  fs.mkdirSync(path.dirname(localPath(repoPath)), { recursive: true });
  fs.writeFileSync(localPath(repoPath), JSON.stringify(obj)); return null;
}
async function listOrderMonths() {
  const key = '__months'; const c = CACHE.get(key); if (c && Date.now() - c.t < TTL) return c.v;
  let v;
  if (useGH) { const g = await ghGet(`${GH.base}/orders`); v = g && g.dir ? g.dir.filter(x => x.name.endsWith('.json')).map(x => x.name.replace('.json', '')) : []; }
  else { try { v = fs.readdirSync(localPath(`${GH.base}/orders`)).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')); } catch { v = []; } }
  CACHE.set(key, { t: Date.now(), v }); return v;
}
async function getAllOrders() {
  const months = await listOrderMonths();
  const parts = await Promise.all(months.map(m => readJson(`${GH.base}/orders/${m}.json`)));
  const all = []; parts.forEach(p => { if (p.obj) all.push(...Object.values(p.obj)); });
  return all;
}
const getObj = async (name, dflt) => (await readJson(`${GH.base}/${name}`)).obj || dflt;

// ─────────── Meta en vivo (opcional, si hay META_TOKEN en Render) ───────────
const prodFromCampaign = (n) => String(n || '').replace(/^\s*(ABO|CBO)\s*\|\s*/i, '').split(/\s\|\s|\s-\s/)[0].trim().replace(/\s+/g, ' ');
async function refreshMeta(since, until) {
  if (!META.token) throw new Error('Falta META_TOKEN en Render (Environment) para actualizar Meta desde aquí.');
  const rows = [];
  for (const acc of META.accounts) {
    let url = `https://graph.facebook.com/v21.0/act_${acc}/insights?level=campaign&time_increment=1&limit=500` +
      `&fields=campaign_id,campaign_name,spend,actions,action_values&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&access_token=${META.token}`;
    while (url) {
      const r = await fetch(url); const j = await r.json();
      if (j.error) throw new Error('Meta: ' + j.error.message);
      for (const d of j.data || []) {
        const act = (arr, t) => { const a = (arr || []).find(x => x.action_type === t); return a ? +a.value : 0; };
        rows.push({ fecha: d.date_start, cuenta: acc, campaign_id: d.campaign_id, campaign: d.campaign_name, producto: prodFromCampaign(d.campaign_name),
          inversion: Math.round(+d.spend || 0), ventas: act(d.actions, 'omni_purchase') || act(d.actions, 'purchase'), facturacion: Math.round(act(d.action_values, 'omni_purchase') || act(d.action_values, 'purchase')) });
      }
      url = j.paging && j.paging.next;
    }
  }
  const cur = await readJson(`${GH.base}/meta_campaigns.json`);
  const keep = (cur.obj || []).filter(x => x.fecha < since || x.fecha > until || !META.accounts.includes(x.cuenta)); // reemplaza solo el rango pedido
  await writeJson(`${GH.base}/meta_campaigns.json`, keep.concat(rows), cur.sha, `meta ${since}..${until}`);
  const s = await readJson(`${GH.base}/sync.json`); const sync = s.obj || {}; sync.meta = new Date().toISOString();
  await writeJson(`${GH.base}/sync.json`, sync, s.sha, 'sync meta');
  return { filas: rows.length };
}

// ─────────── HTTP ───────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };
const sendJson = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
function readBody(req) { return new Promise((resolve, reject) => { let b = '', s = 0; req.on('data', c => { s += c.length; if (s > 2 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } b += c; }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } }); req.on('error', reject); }); }

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/api/all' && req.method === 'GET') {
      const [orders, meta, config, sync] = await Promise.all([getAllOrders(), getObj('meta_campaigns.json', []), getObj('config.json', {}), getObj('sync.json', {})]);
      return sendJson(res, 200, { orders, meta, config, sync, metaLive: !!META.token });
    }
    if (url === '/api/orders' && req.method === 'GET') return sendJson(res, 200, await getAllOrders());
    if (url === '/api/meta' && req.method === 'GET') return sendJson(res, 200, await getObj('meta_campaigns.json', []));
    if (url === '/api/refresh-meta' && req.method === 'POST') {
      const body = await readBody(req);
      const until = body.until || new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10); // hora Colombia
      const since = body.since || new Date(Date.now() - 5 * 3600e3 - 30 * 86400e3).toISOString().slice(0, 10);
      return sendJson(res, 200, await refreshMeta(since, until));
    }
    if (url === '/api/config' && req.method === 'GET') return sendJson(res, 200, await getObj('config.json', {}));
    if (url === '/api/config' && req.method === 'POST') {
      const body = await readBody(req); // objeto con claves a fusionar
      const { obj, sha } = await readJson(`${GH.base}/config.json`);
      const cfg = Object.assign(obj || {}, body || {});
      await writeJson(`${GH.base}/config.json`, cfg, sha, 'config');
      return sendJson(res, 200, cfg);
    }
    let file = url === '/' ? '/index.html' : url;
    if (file.startsWith('/data/') || file.startsWith('/tools/')) { res.writeHead(404); return res.end('Not found'); }
    const fp = path.join(__dirname, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' }); return fs.createReadStream(fp).pipe(res); }
    res.writeHead(404); res.end('Not found');
  } catch (e) { console.error(e); sendJson(res, 500, { error: 'error del servidor', detail: String(e.message || e) }); }
});
server.listen(PORT, () => console.log(`Métricas tienda en http://localhost:${PORT} — ${useGH ? 'GitHub ' + GH.repo : 'archivos locales'}`));
