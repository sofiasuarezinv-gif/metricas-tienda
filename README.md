# Métricas de Tienda

Dashboard de pedidos Dropi + Meta Ads + (próximamente) Shopify. **Ya no se suben reportes**: los datos se sincronizan directo de Dropi y Meta y se guardan en `data/` de este repo.

- Pestañas: 📊 Métricas (General · Producto · Ciudades · Transportadora · Fin de semana vs entre semana · Día), 🔮 Proyecciones, ⚙️ Configuración.
- `data/orders/{YYYY-MM}.json` pedidos de Dropi · `data/meta_campaigns.json` Meta por día y campaña · `data/sync.json` última sincronización · `data/config.json` fletes estimados, mapeo de productos, supuestos de proyección.
- Sincronizar: traer pedidos (API Dropi) y Meta a JSON y correr `node tools/sync-merge.js dropi_orders.json meta_campaigns.json`, luego commit + push.

## Render (Web Service)
- Build: `npm install` · Start: `node server.js`
- Env: `GH_TOKEN` (Contents R/W) y `GH_REPO=sofiasuarezinv-gif/metricas-tienda`
- Opcional: `META_TOKEN` (+ `META_ACCOUNTS=24279427948421869,1070491651938261`) habilita el botón "Actualizar Meta ahora".
