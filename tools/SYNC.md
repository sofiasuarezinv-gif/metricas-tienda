# Sincronización automática del dashboard (Dropi + Meta + Shopify)

Carpeta de trabajo: `C:\Users\Usuario\Downloads\metricas-tienda-sync` (clon del repo `sofiasuarezinv-gif/metricas-tienda`).
Archivos temporales en `_sync\` (está en .gitignore). Todo es SOLO LECTURA en Dropi, Meta y Shopify: nunca crear, editar ni cancelar nada.
El dashboard (https://metricas-tienda.onrender.com) lee `data/` directo de GitHub: con hacer push basta, no hay que tocar Render.

## 0. Preparar
`cd C:\Users\Usuario\Downloads\metricas-tienda-sync && git pull -q --rebase origin main`
Fecha de hoy en Colombia (UTC−5) = HOY. Desde = 2026-08-01.

## 1. Meta (conector Meta Ads, tool `ads_get_ad_entities`)
Cuentas con gasto: `24279427948421869` (CP - Dropp - 2.0) y `1070491651938261` (CM DROPP 2.0). Revisar también `857673567427845` (CM DROPP 3.0) por si empieza a gastar.
Para cada cuenta: level=campaign, time_range = {since: HOY−3 días, until: HOY}, time_increment="1", fields=["id","name","amount_spent","omni_purchase","omni_purchase_values"],
filtering=[{field:"campaign.amount_spent",operator:"GREATER_THAN",value:["0"]}], limit 500, include_additional_context=false.
Escribir `_sync\meta.json` = arreglo de `{fecha:"YYYY-MM-DD", cuenta:"<id cuenta>", campaign_id, campaign:"<nombre>", producto:"<nombre campaña sin 'ABO |'/'CBO |' y cortado antes del primer ' | ' o ' - '>", inversion:<amount_spent>, ventas:<omni_purchase o 0>, facturacion:<omni_purchase_values o 0>}` (una fila por campaña y día).

## 2. Shopify (conector Shopify, tool `graphql_query`, first=50, paginar con after=endCursor)
Pedidos: `query($first:Int,$after:String){ orders(first:$first, after:$after, query:"created_at:>=2026-08-01", sortKey:CREATED_AT){ pageInfo{hasNextPage endCursor} nodes{ name createdAt cancelledAt phone shippingAddress{phone} totalPriceSet{shopMoney{amount}} lineItems(first:3){nodes{quantity}} } } }`
→ `_sync\shopify_orders.json` = TODOS los pedidos desde 2026-08-01: `{num:"<name sin #>", created_at:"<createdAt>", phone:"<10 últimos dígitos>", total:<amount>, qty:<suma quantity>, cancelled:<cancelledAt!=null>}`.
Preliminares: `query($first:Int,$after:String){ draftOrders(first:$first, after:$after, query:"created_at:>=2026-08-01", sortKey:ID){ pageInfo{hasNextPage endCursor} nodes{ name createdAt tags phone shippingAddress{phone} totalPriceSet{shopMoney{amount}} lineItems(first:3){nodes{quantity}} } } }`
→ `_sync\shopify_drafts.json` = TODOS: `{name:"<name sin #>", created_at, phone:"<10 últimos dígitos o ''>", total, qty, tipo}` con tipo = "A" si tags incluye `abandoned_checkout_releasit_cod_form`, "B" si incluye `draft_order_for_checkout_button`, si no "P".

## 3. Dropi (conector Dropi: `list_orders`, `get_order`, `search_cities`, `quote_shipping`)
- `list_orders(from="2026-08-01", until=HOY, result_number=100, start=0)` y luego start=100, 200… hasta que una página traiga <100 (from y until son obligatorios; máximo 90 días por consulta → si el rango pasa de 90 días, partir en dos consultas).
- IDs ya guardados: `node -e "const fs=require('fs');let a=[];for(const f of fs.readdirSync('data/orders'))a.push(...Object.keys(require('./data/orders/'+f)));console.log(a.join('\n'))"`.
- Para cada pedido NUEVO (id no guardado): `get_order(id)` (items: product_id, product_name, qty, unit_price; dirección). Luego flete real: `search_cities(name=ciudad)` (coincidencia exacta; "X (ANT)" = pista de departamento) y `quote_shipping(cash_on_delivery = rate_type=="CON RECAUDO", destination_city={id, dane_code: cod_dane, zip_code: zip_code o null}, products=[{id: product_id, type:"SIMPLE", quantity: qty, price: total/qty}])` → shipping_cost (+ insurance si no es null) de la transportadora del pedido.
- La API limita (~70 llamadas seguidas → HTTP 429 por varios minutos): máximo ~8 llamadas por mensaje; si sale 429, esperar (`timeout 180 tail -f /dev/null`) y reintentar.
- `_sync\dropi.json` = TODOS los pedidos listados: `{id, created_at, estado, nombre, telefono, ciudad, total, transportadora, rate_type, tracking}`; solo los NUEVOS llevan además `direccion` e `items:[{product_id,product_name,qty,unit_price}]`.
- `_sync\fletes.json` = `{"<id>":{"flete":<shipping_cost+insurance>}}` de los nuevos.

## 4. Unir y publicar
```
node tools/sync-merge.js _sync/dropi.json _sync/meta.json _sync/fletes.json
node tools/shopify-link.js _sync/shopify_orders.json _sync/shopify_drafts.json
git add data && git commit -qm "sync automático <fecha hora>" && git pull -q --rebase origin main && git push -q origin main
```
(Si alguna fuente falla, igual correr el resto: pasar "" en lugar del archivo que falte en sync-merge; si Shopify falla, saltar shopify-link.)
Si no hay cambios en data/, no hacer commit.

## 5. Resultado
Responder en 2-4 líneas en español: pedidos nuevos de Dropi, cambios de estado relevantes (entregados/devueltos nuevos), inversión y ventas Meta de hoy, pedidos Shopify de hoy, y si algo falló.
