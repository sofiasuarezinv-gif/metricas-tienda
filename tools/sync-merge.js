// Sincroniza datos traídos de la API de Dropi y de Meta hacia data/ del repo.
// Uso: node tools/sync-merge.js <dropi_orders.json> [meta_campaigns.json]
//  - dropi_orders.json: [{id, created_at, updated_at, estado, nombre, telefono, ciudad, direccion, total, transportadora, rate_type, items:[{product_name, qty, unit_price}], extra}]
//  - meta_campaigns.json: [{fecha, cuenta, campaign_id, campaign, producto, inversion, ventas, facturacion}]
// Los pedidos se guardan en data/orders/{YYYY-MM}.json por ID (upsert). Se conservan los campos que venían del
// Excel de Dropi (flete real, costo devolución, depto, fecha re-fechada por Shopify).
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const OMIT = ['sofia prueba', 'sofia calder', 'prueba', 'jhon fredy marin bedoya'];
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const wr = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };

const [, , dropiFile, metaFile, fletesFile] = process.argv; // fletesFile opcional: {id:{flete}} cotizado en Dropi (quote_shipping)
const out = {};

if (dropiFile) {
  const src = [].concat(...dropiFile.split(',').map(f => rd(f, [])));
  const ordDir = path.join(DATA, 'orders');
  const stores = {}; // mes -> {id: pedido}
  for (const f of (fs.existsSync(ordDir) ? fs.readdirSync(ordDir) : [])) if (f.endsWith('.json')) stores[f.replace('.json', '')] = rd(path.join(ordDir, f), {});
  const where = {}; for (const m in stores) for (const id in stores[m]) where[id] = m;
  let added = 0, updated = 0, skipped = 0;
  for (const s of src) {
    const id = String(s.id || s.order_id || '');
    if (!id) continue;
    if (OMIT.some(o => String(s.nombre || '').toLowerCase().includes(o))) { skipped++; continue; }
    const prev = where[id] ? stores[where[id]][id] : null;
    const items = s.items || [];
    const fechaApi = String(s.created_at || '').slice(0, 10);
    const estado = String(s.estado || s.status || '').trim().toUpperCase();
    const dirTxt = [s.direccion, (s.extra || {}).notes, (s.extra || {}).shipping_notes].filter(Boolean).join(' ');
    const o = Object.assign({}, prev || {}, {
      id,
      // si el pedido se re-fechó por Shopify (fecha_dropi existe), se respeta esa fecha
      fecha: prev && prev.fecha_dropi ? prev.fecha : fechaApi,
      created_at: s.created_at, estado,
      transportadora: String(s.transportadora || s.shipping_company || '').trim().toUpperCase() || '—',
      nombre: s.nombre || (prev && prev.nombre) || '', telefono: s.telefono || (prev && prev.telefono) || '',
      ciudad: s.ciudad || (prev && prev.ciudad) || '', direccion: s.direccion || (prev && prev.direccion) || '',
      venta: +s.total || (prev && prev.venta) || 0,
      tipo_envio: String(s.rate_type || (prev && prev.tipo_envio) || '').toUpperCase(),
      anticipado: /SIN RECAUDO/i.test(s.rate_type || ''),
      // a oficina: estado "RECLAME EN OFICINA" o dirección con "oficina"; una vez marcado se conserva (luego pasa a ENTREGADO)
      oficina: !!(prev && prev.oficina) || /OFICINA/i.test(estado) || /OFICINA/i.test(dirTxt),
      // sin detalle (solo listado de estados) → se conserva lo que ya se tenía del pedido
      items: items.length ? items.map(i => ({ producto: i.product_name, qty: +i.qty || 1, unit_price: +i.unit_price || 0 })) : ((prev && prev.items) || []),
      producto: items[0] ? String(items[0].product_name).trim() : ((prev && prev.producto) || ''),
      unidades: items.length ? items.reduce((a, i) => a + (+i.qty || 1), 0) : ((prev && prev.unidades) || 1),
      tracking: s.tracking || (prev && prev.tracking) || '',
      fuente: 'dropi-api',
    });
    // costo proveedor: el del Excel si existe; si no, precio proveedor × cantidad de la API
    const provApi = items.reduce((a, i) => a + (+i.unit_price || 0) * (+i.qty || 1), 0);
    o.proveedor = prev && prev.proveedor > 0 ? prev.proveedor : provApi;
    // fecha de entrega: la API no la da (updated_at = hora de la consulta). Se registra el primer día que la sincronización lo ve ENTREGADO.
    if (estado === 'ENTREGADO' && !o.fecha_entrega) o.fecha_entrega = (prev && prev.ult_mov && prev.estado === 'ENTREGADO') ? prev.ult_mov : (prev && prev.estado !== 'ENTREGADO' ? new Date().toISOString().slice(0, 10) : '');
    delete o.updated_at;
    if (s.extra && Object.keys(s.extra).length) o.extra = s.extra;
    const m = (o.fecha || '0000-00').slice(0, 7);
    if (where[id] && where[id] !== m) delete stores[where[id]][id];
    (stores[m] = stores[m] || {})[id] = o; where[id] = m;
    prev ? updated++ : added++;
  }
  if (fletesFile) { const FL = rd(fletesFile, {}); let n = 0; for (const mm in stores) for (const id in stores[mm]) { const f = FL[id]; if (f && f.flete > 0) { stores[mm][id].flete_cot = Math.round(f.flete); n++; } } out.fletes = n; }
  for (const m in stores) wr(path.join(ordDir, m + '.json'), stores[m]);
  out.dropi = { recibidos: src.length, added, updated, skipped };
}

if (metaFile) {
  const rows = rd(metaFile, []);
  const cur = rd(path.join(DATA, 'meta_campaigns.json'), []);
  const fechas = rows.map(r => r.fecha).sort(); const cuentas = new Set(rows.map(r => r.cuenta));
  const from = fechas[0], to = fechas[fechas.length - 1];
  const keep = cur.filter(x => !(cuentas.has(x.cuenta) && x.fecha >= from && x.fecha <= to)); // reemplaza el rango sincronizado
  wr(path.join(DATA, 'meta_campaigns.json'), keep.concat(rows).sort((a, b) => a.fecha < b.fecha ? -1 : 1));
  out.meta = { filas: rows.length, desde: from, hasta: to };
}

const sync = rd(path.join(DATA, 'sync.json'), {});
if (out.dropi) sync.dropi = new Date().toISOString();
if (out.meta) sync.meta = new Date().toISOString();
wr(path.join(DATA, 'sync.json'), sync);
console.log(JSON.stringify(out));
