// Dashboard métricas de tienda — pedidos Dropi + inversión manual.
// Guarda en TU repo de GitHub: data/orders/{YYYY-MM}.json (pedidos deduplicados por ID) y data/investment.json.
// Producción: GH_TOKEN + GH_REPO ("owner/repo"). Sin token usa archivos locales (pruebas).
const http = require('http');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const PORT = process.env.PORT || 4000;
const GH = {
  token: process.env.GH_TOKEN,
  repo: process.env.GH_REPO,
  branch: process.env.GH_BRANCH || 'main',
  base: (process.env.GH_DIR || 'data').replace(/\/+$/, ''),
};
const useGH = !!(GH.token && GH.repo);
const OMIT = ['sofia prueba', 'sofia calder', 'prueba', 'jhon fredy marin bedoya'];

// ─────────── GitHub ───────────
const ghHeaders = () => ({ 'Authorization': 'Bearer ' + GH.token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'metricas-tienda', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' });
async function ghGet(repoPath) {
  const r = await fetch(`https://api.github.com/repos/${GH.repo}/contents/${repoPath}?ref=${GH.branch}`, { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${repoPath} ${r.status} ${await r.text()}`);
  const j = await r.json();
  if (Array.isArray(j)) return { dir: j };
  return { obj: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha };
}
async function ghPut(repoPath, obj, sha, msg) {
  const body = { message: msg || ('update ' + repoPath), content: Buffer.from(JSON.stringify(obj)).toString('base64'), branch: GH.branch };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${GH.repo}/contents/${repoPath}`, { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`GitHub PUT ${repoPath} ${r.status} ${await r.text()}`);
  return (await r.json()).content.sha;
}
const localPath = (p) => path.join(__dirname, p.replace(/\//g, '__'));

// ─────────── Almacenamiento (orders por mes, investment) ───────────
async function readJson(repoPath) {
  if (useGH) { const g = await ghGet(repoPath); return g ? { obj: g.obj, sha: g.sha } : { obj: null, sha: null }; }
  try { return { obj: JSON.parse(fs.readFileSync(localPath(repoPath), 'utf8')), sha: null }; } catch { return { obj: null, sha: null }; }
}
async function writeJson(repoPath, obj, sha, msg) {
  if (useGH) return ghPut(repoPath, obj, sha, msg);
  fs.writeFileSync(localPath(repoPath), JSON.stringify(obj)); return null;
}
async function listOrderMonths() {
  if (useGH) { const g = await ghGet(`${GH.base}/orders`); return g && g.dir ? g.dir.filter(x => x.name.endsWith('.json')).map(x => x.name.replace('.json', '')) : []; }
  return fs.readdirSync(__dirname).filter(f => f.startsWith('data__orders__') && f.endsWith('.json')).map(f => f.replace('data__orders__', '').replace('.json', ''));
}
async function getAllOrders() {
  const months = await listOrderMonths(); const all = [];
  for (const m of months) { const { obj } = await readJson(`${GH.base}/orders/${m}.json`); if (obj) all.push(...Object.values(obj)); }
  return all;
}
async function getInvestment() { const { obj } = await readJson(`${GH.base}/investment.json`); return obj || {}; }
async function getConfig() { const { obj } = await readJson(`${GH.base}/config.json`); return obj || {}; }
async function getDaily() { const { obj } = await readJson(`${GH.base}/daily.json`); return obj || {}; }
async function getMeta() { const { obj } = await readJson(`${GH.base}/meta.json`); return obj || {}; }
async function getShopify() { const { obj } = await readJson(`${GH.base}/shopify.json`); return obj || {}; }

// ─────────── Parseo del Excel de Dropi ───────────
const norm = (s) => (s == null ? '' : String(s)).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const parseDate = (s) => { if (!s) return ''; const m = String(s).match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; const d = new Date(s); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };
const numv = (v) => { if (v == null || v === '') return 0; const n = parseFloat(String(v).replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0; };

function parseDropi(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const hdr = rows[0].map(norm);
  const col = (name) => hdr.indexOf(norm(name));
  const c = {
    id: col('ID'), fecha: col('FECHA'), nombre: col('NOMBRE CLIENTE'), estado: col('ESTATUS'),
    transp: col('TRANSPORTADORA'), venta: col('VALOR DE COMPRA EN PRODUCTOS'), ganancia: col('GANANCIA'),
    flete: col('PRECIO FLETE'), devflete: col('COSTO DEVOLUCION FLETE'), proveedor: col('TOTAL EN PRECIOS DE PROVEEDOR'),
    ultmov: col('FECHA DE ULTIMO MOVIMIENTO'), depto: col('DEPARTAMENTO DESTINO'), ciudad: col('CIUDAD DESTINO'),
    tipoenvio: col('TIPO DE ENVIO'),
  };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; const id = r[c.id];
    if (id == null || id === '') continue;
    const nombre = String(r[c.nombre] || '');
    if (OMIT.some(o => nombre.toLowerCase().includes(o))) continue;   // omitir pruebas
    out.push({
      id: String(id), fecha: parseDate(r[c.fecha]), estado: String(r[c.estado] || '').trim().toUpperCase(),
      transportadora: String(r[c.transp] || '').trim().toUpperCase() || '—', nombre,
      venta: numv(r[c.venta]), ganancia: numv(r[c.ganancia]), flete: numv(r[c.flete]),
      dev_flete: numv(r[c.devflete]), proveedor: numv(r[c.proveedor]), ult_mov: parseDate(r[c.ultmov]),
      depto: String(r[c.depto] || ''), ciudad: String(r[c.ciudad] || ''),
      tipo_envio: String(r[c.tipoenvio] || '').trim().toUpperCase(),
    });
  }
  return out;
}

// ─────────── Parseo del reporte de Meta (Ads Manager, por día) ───────────
// Convierte una celda (string, Date o serial de Excel) a YYYY-MM-DD
function cellToDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  if (typeof v === 'number') { const dc = XLSX.SSF.parse_date_code(Math.round(v)); return (dc && dc.y) ? `${dc.y}-${String(dc.m).padStart(2, '0')}-${String(dc.d).padStart(2, '0')}` : ''; } // round: el .xx es corrimiento de zona horaria
  return parseDate(v);
}
function parseMeta(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false, codepage: 65001 }); // 65001 = UTF-8 (evita que "Día" se corrompa en CSV)
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return [];
  const hdr = rows[0].map(norm);
  const find = (...keys) => { for (const k of keys) { const i = hdr.findIndex(h => h.includes(norm(k))); if (i >= 0) return i; } return -1; };
  // findEq: coincidencia por palabra completa (evita que "Compras" agarre "Valor de conversión de las compras…")
  const findEq = (...keys) => { for (const k of keys) { const nk = norm(k); const i = hdr.findIndex(h => h === nk || h.indexOf(nk + ' ') === 0 || h.indexOf(nk + '(') === 0); if (i >= 0) return i; } return -1; };
  const spendCol = find('IMPORTE GASTADO', 'AMOUNT SPENT', 'GASTADO', 'SPEND');
  const ventasCol = findEq('RESULTADOS', 'COMPRAS', 'WEBSITE PURCHASES', 'PURCHASES', 'RESULTS'); // "Resultados"/"Compras" exacto
  const facCol = find('VALOR DE CONVERSION', 'PURCHASES CONVERSION VALUE', 'CONVERSION VALUE');
  const dayCol = find('DIA', 'DAY'); // columna de DÍA de entrega (solo en reportes con desglose por día)
  const rd = (r) => ({ inversion: spendCol >= 0 ? numv(r[spendCol]) : 0, ventas_meta: ventasCol >= 0 ? numv(r[ventasCol]) : 0, facturacion: facCol >= 0 ? numv(r[facCol]) : 0 });
  // ── Modo por DÍA ──
  if (dayCol >= 0) {
    const out = [];
    for (let i = 1; i < rows.length; i++) { const fecha = cellToDate(rows[i][dayCol]); if (fecha) out.push(Object.assign({ fecha }, rd(rows[i]))); }
    if (out.length) return out;
  }
  // ── Modo RESUMEN por periodo (reporte por campaña, sin desglose diario): sumar todo y atribuir al FIN del informe ──
  let inv = 0, ven = 0, fac = 0;
  for (let i = 1; i < rows.length; i++) { const v = rd(rows[i]); inv += v.inversion; ven += v.ventas_meta; fac += v.facturacion; }
  const endCol = find('FIN DEL INFORME', 'REPORT END', 'FIN INFORME', 'FECHA FIN', 'HASTA');
  const startCol = find('INICIO DEL INFORME', 'REPORT START', 'INICIO INFORME', 'FECHA INICIO', 'DESDE');
  let fecha = '';
  for (let i = 1; i < rows.length && !fecha; i++) if (endCol >= 0) fecha = cellToDate(rows[i][endCol]);
  for (let i = 1; i < rows.length && !fecha; i++) if (startCol >= 0) fecha = cellToDate(rows[i][startCol]);
  if (!fecha) return [];
  return [{ fecha, inversion: inv, ventas_meta: ven, facturacion: fac }];
}
async function importMeta(buffer) {
  const parsed = parseMeta(buffer);
  const byDay = {}; // { fecha: {inversion, ventas, facturacion} }
  parsed.forEach(p => { const b = byDay[p.fecha] = byDay[p.fecha] || { inversion: 0, ventas: 0, facturacion: 0 }; b.inversion += p.inversion; b.ventas += p.ventas_meta; b.facturacion += p.facturacion; });
  Object.values(byDay).forEach(v => { v.inversion = Math.round(v.inversion); v.facturacion = Math.round(v.facturacion); });
  // REEMPLAZA el archivo entero (re-subir no acumula; se puede borrar limpio)
  const cur = await readJson(`${GH.base}/meta.json`);
  await writeJson(`${GH.base}/meta.json`, byDay, cur.sha, 'meta: reporte');
  await cleanLegacyMeta();
  return { dias: Object.keys(byDay).length, total: parsed.length };
}
// Limpia datos viejos de Meta que quedaron en daily.json/investment.json (subidas anteriores rotas)
async function cleanLegacyMeta() {
  const dR = await readJson(`${GH.base}/daily.json`); const daily = dR.obj;
  if (daily) { let ch = false; Object.keys(daily).forEach(d => { if (daily[d].ventas_meta !== undefined || daily[d].facturacion_meta !== undefined) { delete daily[d].ventas_meta; delete daily[d].facturacion_meta; ch = true; if (Object.keys(daily[d]).length === 0) delete daily[d]; } }); if (ch) await writeJson(`${GH.base}/daily.json`, daily, dR.sha, 'limpiar meta legado'); }
  // NO tocar investment.json: ahí vive la inversión diaria manual del usuario (la de Meta va en meta.json)
}

// ─────────── Parseo del reporte de Shopify (pedidos por día) ───────────
function parseShopify(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false, codepage: 65001 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return {};
  const hdr = rows[0].map(norm);
  const find = (...keys) => { for (const k of keys) { const i = hdr.findIndex(h => h.includes(norm(k))); if (i >= 0) return i; } return -1; };
  let fechaCol = find('CREATED AT', 'FECHA DE CREACION', 'PAID AT', 'FECHA', 'DIA', 'DAY', 'DATE');
  const nameCol = find('NAME', 'NUMERO DE PEDIDO', 'ORDER NAME', 'PEDIDO', 'ORDER', 'NUMBER');
  const countCol = find('PEDIDOS', 'ORDERS', 'ORDER COUNT', 'TOTAL ORDERS', 'CANTIDAD DE PEDIDOS');
  const totalCol = find('TOTAL', 'TOTAL PRICE', 'PRECIO TOTAL', 'MONTO TOTAL', 'IMPORTE TOTAL', 'VENTAS TOTALES', 'TOTAL SALES');
  if (fechaCol < 0) { let best = -1, bestN = 0; for (let c = 0; c < hdr.length; c++) { let n = 0; for (let i = 1; i < rows.length; i++) if (cellToDate(rows[i][c])) n++; if (n > bestN) { bestN = n; best = c; } } fechaCol = best; }
  const byDay = {}, seen = {}; // byDay[fecha] = { count, total }
  const b = (d) => (byDay[d] = byDay[d] || { count: 0, total: 0 });
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; const fecha = cellToDate(fechaCol >= 0 ? r[fechaCol] : ''); if (!fecha) continue;
    if (totalCol >= 0) b(fecha).total += numv(r[totalCol]); // en Shopify solo la 1ª línea del pedido trae el total
    if (countCol >= 0) { b(fecha).count += numv(r[countCol]); }
    else if (nameCol >= 0) { const nm = String(r[nameCol] || '').trim(); if (nm) { const k = fecha + '|' + nm; if (!seen[k]) { seen[k] = 1; b(fecha).count += 1; } } }
    else { b(fecha).count += 1; }
  }
  return byDay;
}
async function importShopify(buffer) {
  const parsed = parseShopify(buffer);
  const byDay = {}; // { fecha: {ventas, facturacion} }
  Object.entries(parsed).forEach(([d, v]) => { byDay[d] = { ventas: v.count, facturacion: Math.round(v.total) }; });
  const cur = await readJson(`${GH.base}/shopify.json`);
  await writeJson(`${GH.base}/shopify.json`, byDay, cur.sha, 'shopify: reporte');
  await cleanLegacyShopify();
  return { dias: Object.keys(byDay).length };
}
async function cleanLegacyShopify() {
  const dR = await readJson(`${GH.base}/daily.json`); const daily = dR.obj;
  if (!daily) return; let ch = false;
  Object.keys(daily).forEach(d => { if (daily[d].ventas_shopify !== undefined || daily[d].facturacion_shopify !== undefined) { delete daily[d].ventas_shopify; delete daily[d].facturacion_shopify; ch = true; if (Object.keys(daily[d]).length === 0) delete daily[d]; } });
  if (ch) await writeJson(`${GH.base}/daily.json`, daily, dR.sha, 'limpiar shopify legado');
}

async function importOrders(buffer) {
  const parsed = parseDropi(buffer);
  const byMonth = {};
  for (const o of parsed) { const m = (o.fecha || '0000-00').slice(0, 7); (byMonth[m] = byMonth[m] || []).push(o); }
  let added = 0, updated = 0;
  for (const [m, list] of Object.entries(byMonth)) {
    const p = `${GH.base}/orders/${m}.json`;
    const { obj, sha } = await readJson(p);
    const store = obj || {};
    for (const o of list) { if (store[o.id]) updated++; else added++; store[o.id] = o; }
    await writeJson(p, store, sha, `orders ${m}: +${list.length}`);
  }
  return { total: parsed.length, added, updated, meses: Object.keys(byMonth) };
}

// ─────────── HTTP ───────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };
const sendJson = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
function readBody(req) { return new Promise((resolve, reject) => { let b = '', s = 0; req.on('data', c => { s += c.length; if (s > 30 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } b += c; }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } }); req.on('error', reject); }); }

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/api/orders' && req.method === 'GET') return sendJson(res, 200, await getAllOrders());
    if (url === '/api/upload' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.file) return sendJson(res, 400, { error: 'falta el archivo' });
      const buffer = Buffer.from(body.file, 'base64');
      const result = await importOrders(buffer);
      return sendJson(res, 200, result);
    }
    if (url === '/api/investment' && req.method === 'GET') return sendJson(res, 200, await getInvestment());
    if (url === '/api/investment' && req.method === 'POST') {
      const body = await readBody(req); // { fecha, monto }
      const { obj, sha } = await readJson(`${GH.base}/investment.json`);
      const inv = obj || {};
      if (body.fecha) { if (numv(body.monto) === 0) delete inv[body.fecha]; else inv[body.fecha] = numv(body.monto); }
      await writeJson(`${GH.base}/investment.json`, inv, sha, `investment ${body.fecha}`);
      return sendJson(res, 200, inv);
    }
    if (url === '/api/upload-meta' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.file) return sendJson(res, 400, { error: 'falta el archivo' });
      const result = await importMeta(Buffer.from(body.file, 'base64'));
      return sendJson(res, 200, result);
    }
    if (url === '/api/upload-shopify' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.file) return sendJson(res, 400, { error: 'falta el archivo' });
      const result = await importShopify(Buffer.from(body.file, 'base64'));
      return sendJson(res, 200, result);
    }
    if (url === '/api/meta' && req.method === 'GET') return sendJson(res, 200, await getMeta());
    if (url === '/api/shopify' && req.method === 'GET') return sendJson(res, 200, await getShopify());
    if (url === '/api/clear' && req.method === 'POST') {
      const body = await readBody(req); const tipo = body.tipo;
      if (tipo === 'meta') { const c = await readJson(`${GH.base}/meta.json`); await writeJson(`${GH.base}/meta.json`, {}, c.sha, 'clear meta'); await cleanLegacyMeta(); return sendJson(res, 200, { ok: true }); }
      if (tipo === 'shopify') { const c = await readJson(`${GH.base}/shopify.json`); await writeJson(`${GH.base}/shopify.json`, {}, c.sha, 'clear shopify'); await cleanLegacyShopify(); return sendJson(res, 200, { ok: true }); }
      if (tipo === 'dropi') { const months = await listOrderMonths(); for (const mo of months) { const p = `${GH.base}/orders/${mo}.json`; const { sha } = await readJson(p); await writeJson(p, {}, sha, 'clear orders ' + mo); } return sendJson(res, 200, { ok: true }); }
      return sendJson(res, 400, { error: 'tipo inválido' });
    }
    if (url === '/api/daily' && req.method === 'GET') return sendJson(res, 200, await getDaily());
    if (url === '/api/daily' && req.method === 'POST') {
      const body = await readBody(req); // { fecha, field, value }  (value '' borra el override)
      const { obj, sha } = await readJson(`${GH.base}/daily.json`);
      const daily = obj || {};
      if (body.fecha && body.field !== undefined) {
        const cur = daily[body.fecha] || {};
        if (body.value === '' || body.value == null) delete cur[body.field];
        else cur[body.field] = numv(body.value);
        if (Object.keys(cur).length) daily[body.fecha] = cur; else delete daily[body.fecha];
      }
      await writeJson(`${GH.base}/daily.json`, daily, sha, `daily ${body.fecha}`);
      return sendJson(res, 200, daily);
    }
    if (url === '/api/config' && req.method === 'GET') return sendJson(res, 200, await getConfig());
    if (url === '/api/config' && req.method === 'POST') {
      const body = await readBody(req); // objeto con claves a fusionar, p.ej. { efectividad: 75 }
      const { obj, sha } = await readJson(`${GH.base}/config.json`);
      const cfg = Object.assign(obj || {}, body || {});
      await writeJson(`${GH.base}/config.json`, cfg, sha, 'config');
      return sendJson(res, 200, cfg);
    }
    let file = url === '/' ? '/index.html' : url;
    const fp = path.join(__dirname, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' }); return fs.createReadStream(fp).pipe(res); }
    res.writeHead(404); res.end('Not found');
  } catch (e) { console.error(e); sendJson(res, 500, { error: 'error del servidor', detail: String(e.message || e) }); }
});
server.listen(PORT, () => console.log(`Métricas tienda en http://localhost:${PORT} — ${useGH ? 'GitHub ' + GH.repo : 'archivos locales'}`));
