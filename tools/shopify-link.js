// Cruza Shopify con los pedidos de Dropi ya guardados en data/orders/.
// Uso: node tools/shopify-link.js <shopify_orders.json> <shopify_drafts.json>
//  - shopify_orders.json: [{num:"1001", created_at:"2026-08-24T13:24:35Z", phone:"3015127361", total:79900, qty:1, cancelled:false}]
//  - shopify_drafts.json (pedidos preliminares = borradores de Releasit): [{name:"D5", created_at, phone, total, qty, tipo:"A"|"B"|"P"}]
//      A = checkout abandonado del formulario COD · B = borrador del botón de checkout · P = link de pago / sin teléfono
// Resultado:
//  - cada pedido de Dropi recibe `origen`: 'shopify' (entró por la tienda) | 'preliminar' (recuperado de un preliminar) | 'manual'
//    y los de la tienda se re-fechan a la fecha de entrada a Shopify (fecha_dropi guarda la original)
//  - data/shopify_data.json = { orders:[{num,fecha,phone,total,qty,cancelled,dropi_id}], drafts:[{name,fecha,phone,total,qty,tipo,valido,completado,dropi_id}] }
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const wr = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };
const ph = v => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const localDate = s => new Date(new Date(s).getTime() - 5 * 3600e3).toISOString().slice(0, 10); // hora Colombia (UTC-5)
const days = (a, b) => (new Date(b) - new Date(a)) / 864e5;

const [, , ordFile, draftFile] = process.argv;
const SO = rd(ordFile, []).map(o => ({ ...o, phone: ph(o.phone), fecha: localDate(o.created_at) }));
const SD = rd(draftFile, []).map(d => ({ ...d, phone: ph(d.phone), fecha: localDate(d.created_at) }));

// pedidos de Dropi
const ordDir = path.join(DATA, 'orders'); const stores = {};
for (const f of fs.readdirSync(ordDir)) if (f.endsWith('.json')) stores[f.replace('.json', '')] = rd(path.join(ordDir, f), {});
const all = []; for (const m in stores) for (const id in stores[m]) all.push(stores[m][id]);
const dropiDate = o => String(o.created_at || o.fecha_dropi || o.fecha || '').slice(0, 10);

// 1) pedido Shopify ↔ pedido Dropi: mismo teléfono (o número de pedido de tienda) y Dropi creado 0–5 días después
const usedDropi = new Set();
for (const s of SO) {
  const cand = all.filter(o => !usedDropi.has(o.id) && ((o.tienda_num && o.tienda_num === s.num) || (s.phone && ph(o.telefono) === s.phone)))
    .filter(o => { const d = days(s.fecha, dropiDate(o)); return d >= -1 && d <= 5; })
    .sort((a, b) => Math.abs(days(s.fecha, dropiDate(a))) - Math.abs(days(s.fecha, dropiDate(b))));
  if (cand[0]) { s.dropi_id = cand[0].id; usedDropi.add(cand[0].id); }
}
// 2) preliminares: sin teléfono no cuentan; si el mismo teléfono hizo pedido en Shopify ±1 día, el borrador se "completó" (no es preliminar);
//    duplicados del mismo teléfono en 3 días cuentan una vez
const seen = {};
for (const d of SD.sort((a, b) => a.created_at < b.created_at ? -1 : 1)) {
  d.completado = !!(d.phone && SO.some(s => s.phone === d.phone && Math.abs(days(d.fecha, s.fecha)) <= 1));
  const dup = d.phone && seen[d.phone] && days(seen[d.phone], d.fecha) <= 3;
  d.valido = !!d.phone && d.tipo !== 'P' && !d.completado && !dup;
  if (d.phone) seen[d.phone] = d.fecha;
}
// 3) preliminar convertido: pedido de Dropi que NO vino de un pedido Shopify, con el teléfono del preliminar, creado 0–7 días después
for (const d of SD.filter(x => x.valido)) {
  const c = all.filter(o => !usedDropi.has(o.id) && ph(o.telefono) === d.phone).filter(o => { const k = days(d.fecha, dropiDate(o)); return k >= -0.5 && k <= 7; })[0];
  if (c) { d.dropi_id = c.id; usedDropi.add(c.id); }
}
// 4) marcar origen en los pedidos de Dropi (+ re-fechar los de la tienda a la fecha de Shopify)
const bySO = {}; SO.forEach(s => { if (s.dropi_id) bySO[s.dropi_id] = s; });
const bySD = {}; SD.forEach(d => { if (d.dropi_id) bySD[d.dropi_id] = d; });
let moved = 0;
for (const m of Object.keys(stores)) for (const id of Object.keys(stores[m])) {
  const o = stores[m][id];
  if (o.fecha < '2026-08-01' && !bySO[id] && !bySD[id]) continue; // histórico viejo sin datos de Shopify
  const s = bySO[id], d = bySD[id];
  o.origen = s ? 'shopify' : d ? 'preliminar' : 'manual';
  o.shopify_num = s ? s.num : undefined; o.preliminar = d ? d.name : undefined;
  if (s && o.fecha !== s.fecha) {
    o.fecha_dropi = o.fecha_dropi || dropiDate(o); o.fecha = s.fecha; const nm = s.fecha.slice(0, 7);
    if (nm !== m) { (stores[nm] = stores[nm] || {})[id] = o; delete stores[m][id]; moved++; }
  }
}
for (const m in stores) wr(path.join(ordDir, m + '.json'), stores[m]);
wr(path.join(DATA, 'shopify_data.json'), {
  orders: SO.map(({ num, fecha, phone, total, qty, cancelled, dropi_id }) => ({ num, fecha, phone, total, qty, cancelled: !!cancelled, dropi_id })),
  drafts: SD.map(({ name, fecha, phone, total, qty, tipo, valido, completado, dropi_id }) => ({ name, fecha, phone, total, qty, tipo, valido, completado, dropi_id })),
});
const sync = rd(path.join(DATA, 'sync.json'), {}); sync.shopify = new Date().toISOString(); wr(path.join(DATA, 'sync.json'), sync);
const cnt = k => all.filter(o => o.origen === k).length;
console.log(JSON.stringify({ shopify_orders: SO.length, con_dropi: SO.filter(s => s.dropi_id).length, preliminares_validos: SD.filter(d => d.valido).length,
  convertidos: SD.filter(d => d.dropi_id).length, origen: { shopify: cnt('shopify'), preliminar: cnt('preliminar'), manual: cnt('manual') }, cambiaron_mes: moved }));
