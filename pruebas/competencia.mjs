// pruebas/competencia.mjs
// Se corre con: npm run test:competencia
//
// Paso 2 del Market Reader (competencia en MeLi), con fetch simulado. Cubre
// el caso real que reporto el usuario ("soporte plegable para celular"): una
// muestra de 2 publicaciones guardada en cache terminaba en "Sin comparable en
// MeLi Argentina. No hay evidencia de que este producto se venda aca" con
// relevancia 1.00, mientras la categoria madre tenia 9.989 publicaciones.
process.env.MELI_ACCESS_TOKEN = 'token-de-prueba-123456';
process.env.SUPABASE_SERVICE_KEY = 'supa-de-prueba';

let fallos = 0, oks = 0;
function chequear(n, c, extra) {
  console.log((c ? '  ok    ' : '  FALLA ') + n + (extra != null ? ' -> ' + extra : ''));
  if (c) oks++; else fallos++;
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

let escenario = {};
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('supabase.co')) {
    if ((init && init.method) && init.method !== 'GET') return new Response('', { status: 201 });
    if (u.includes('busquedas_cache') && escenario.cache) return json([escenario.cache]);
    return json([]);
  }
  if (u.includes('listado.mercadolibre.com.ar') && escenario.items) {
    if (/_Desde_/.test(u)) return new Response('', { status: 404 });
    const html = '<html>' + 'x'.repeat(3000) + escenario.items.map(it =>
      '<a href="https://articulo.mercadolibre.com.ar/' + it.id.replace('MLA', 'MLA-') + '-x-_JM">x</a>').join('') + '</html>';
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (u.includes('/items?ids=') && escenario.items) {
    const ids = decodeURIComponent(u.split('ids=')[1].split('&')[0]).split(',');
    return json(ids.map(id => ({ code: 200, body: escenario.items.find(x => x.id === id) })).filter(x => x.body));
  }
  if (/\/users\/\d+/.test(u) && escenario.usuarios) {
    const id = u.match(/\/users\/(\d+)/)[1];
    return json({ id: Number(id), nickname: 'TIENDA' + id, seller_reputation: { level_id: '4_light_green' } });
  }
  if (u.includes('/products/search') && escenario.catalogo) {
    const off = Number((u.match(/offset=(\d+)/) || [])[1] || 0);
    const res = [];
    for (let k = off; k < Math.min(off + 10, 150); k++) res.push({ id: 'MLA9' + String(k).padStart(6, '0'), name: 'Soporte Celular Plegable Modelo ' + k, domain_id: 'MLA-CELLPHONE_HOLDERS' });
    return json({ paging: { total: 10000 }, results: res });
  }
  if (/\/products\/MLA9\d+\/items/.test(u) && escenario.catalogo) return new Response('{}', { status: 404 });
  if (/\/products\/MLA9\d+$/.test(u.split('?')[0]) && escenario.catalogo) {
    const k = Number(u.match(/MLA9(\d+)/)[1]);
    // Como en produccion: solo 1 de cada 5 productos tiene buybox.
    return json({ id: 'MLA9' + k, name: 'Soporte Celular Plegable Modelo ' + k,
      buy_box_winner: k % 5 === 0 ? { item_id: 'MLA77' + k, price: 8000 + k * 10, seller_id: 500 + k } : null });
  }
  if (u.includes('/domain_discovery/') && escenario.catalogo) return json([
    { domain_id: 'MLA-CAR_CELLPHONE_HOLDERS', category_id: 'MLA70411', category_name: 'Soportes para Autos', domain_name: 'Soportes de celulares para autos' },
    { domain_id: 'MLA-CELLPHONE_HOLDERS', category_id: 'MLA5', category_name: 'Porta Celulares', domain_name: 'Soportes para celulares' }]);
  if (u.includes('/domain_discovery/')) return json([{ category_id: 'MLA1', category_name: 'Soportes' }]);
  return new Response('{}', { status: 403 });
};

const meli = await import('../api/_meli.js');
const handler = (await import('../api/market.js')).default;

async function competencia(product) {
  // Cada caso arranca sin historial de vias falladas.
  const est = meli.viaDeBusquedaUsada('MLA');
  for (const k of Object.keys(est.porSitio || {})) delete est.porSitio[k];
  let salida;
  const res = { setHeader() {}, status(c) { this.c = c; return this; }, json(o) { salida = o; return this; }, end() { return this; } };
  await handler({ method: 'POST', query: {}, headers: {}, body: { step: 'competencia', product } }, res);
  return salida;
}
const item = (i, titulo, precio) => ({ id: 'MLA' + (1500000000 + i), title: titulo, price: precio,
  seller_id: 3139491800 + i, shipping: { free_shipping: i % 2 === 0 }, status: 'active' });

console.log('\n== 1. "para" no cuenta como palabra significativa ==');
const pal = meli.palabrasSignificativas('soporte plegable para celular');
chequear('palabras', JSON.stringify(pal) === JSON.stringify(['soporte', 'plegable', 'celular']), JSON.stringify(pal));

console.log('\n== 2. Cache con 2 publicaciones (la prueba del usuario) ==');
escenario = { cache: { termino: 'soporte plegable para celular', fuente: 'proveedor-apify', categoria: 'Soportes para Autos',
  created_at: new Date().toISOString(), resultados: [
    { id: 'MLA1111111111', title: 'Soporte Plegable Para Celular Escritorio', price: 8999, sold_quantity: 0, seller: { id: 3139491804, nickname: 'Vendedor 3139491804' } },
    { id: 'MLA2222222222', title: 'Soporte Plegable Para Celular Tablet Premium', price: 140748, sold_quantity: 0, seller: { id: 3139491805, nickname: 'Vendedor 3139491805' } }] } };
let r = await competencia('soporte plegable para celular');
chequear('NO concluye sin comparable', r.sinComparable === false, r.sinComparable);
chequear('marca competencia no medida (amarillo)', r.competenciaNoMedida === true && r.muestraInsuficiente === true);
chequear('aviso dice "no pude medir"', /No pude medir la competencia/.test(r.aviso || ''), r.aviso);
chequear('relevancia NO es 1.00 sobre 2', r.ratioRelevancia == null && r.relevanciaConfiable === false, r.ratioRelevancia);
chequear('sin "Vendedor <id>" falso', r.competitors.every(c => !c.vendedor), r.competitors.map(c => c.vendedor).join(','));
chequear('sin "0 vendidos" falso', r.competitors.every(c => c.soldQty == null) && r.hayVendidos === false);
chequear('trae el titulo de la publicacion', r.competitors[0].titulo === 'Soporte Plegable Para Celular Escritorio');

console.log('\n== 3. Listado con 45 publicaciones y dos outliers ==');
const items = [];
for (let i = 0; i < 45; i++) items.push(item(i, 'Soporte Celular Plegable Escritorio ' + i, i === 3 ? 140748 : (i === 7 ? 1200 : 8000 + (i * 97) % 3000)));
escenario = { items, usuarios: true };
r = await competencia('soporte plegable para celular');
chequear('muestra de al menos 20', r.muestra >= 20, r.muestra);
chequear('descarta los 2 outliers de precio', r.outliersDescartados === 2, r.outliersDescartados);
chequear('el maximo ya no es 140.748', r.precioMaxARS < 20000, r.precioMaxARS);
chequear('relevancia confiable', r.relevanciaConfiable === true);
chequear('nickname real desde /users', r.competitors.every(c => /^TIENDA\d+$/.test(c.vendedor || '')), r.competitors[0].vendedor);
chequear('reputacion desde /users', r.hayReputacion === true && r.competitors[0].reputation === '4_light_green');

console.log('\n== 4. Rescate: 5 publicaciones que no son el producto ==');
escenario = { items: [0, 1, 2, 3, 4].map(i => item(i, 'Bujia Ngk Iridium ' + i, 5000)) };
r = await competencia('soporte plegable para celular');
chequear('con menos de 10 devueltas NO concluye sin comparable', r.sinComparable === false && r.competenciaNoMedida === true, JSON.stringify({ s: r.sinComparable, m: r.muestraDevuelta }));

console.log('\n== 5. Rescate: 15 publicaciones que no son el producto ==');
escenario = { items: Array.from({ length: 15 }, (_, i) => item(i, 'Bujia Ngk Iridium ' + i, 5000)) };
r = await competencia('soporte plegable para celular');
chequear('con 15 devueltas y ninguna relevante si marca sin comparable', r.sinComparable === true, r.sinComparable);

console.log('\n== 6. Categoria: no la primera de domain_discovery ==');
const cat = meli.elegirCategoria('soporte plegable para celular', [
  { domain_id: 'MLA-CAR_CELLPHONE_HOLDERS', category_name: 'Soportes para Autos', domain_name: 'Soportes de celulares para autos' },
  { domain_id: 'MLA-CELLPHONE_HOLDERS', category_name: 'Porta Celulares', domain_name: 'Soportes para celulares' }], []);
chequear('elige Porta Celulares, no Soportes para Autos', cat && cat.category_name === 'Porta Celulares', cat && cat.category_name);

// Candidatos REALES de domain_discovery (16/10/2026) y un catalogo donde los
// soportes para auto aparecen al fondo.
const reales = [
  { domain_id: 'MLA-VEHICLE_CELLPHONE_AND_GPS_MOUNTS', domain_name: 'Soportes de celulares y GPS para vehículos', category_name: 'Soportes para Autos' },
  { domain_id: 'MLA-VEHICLE_CELLPHONE_AND_GPS_MOUNTS', domain_name: 'Soportes de celulares y GPS para vehículos', category_name: 'Soportes' },
  { domain_id: 'MLA-CELLPHONE_HOLDERS_AND_STANDS', domain_name: 'Soportes para Celulares', category_name: 'Porta Celulares' },
  { domain_id: 'MLA-HEADPHONE_STANDS', domain_name: 'Soportes para auriculares', category_name: 'Soportes para Auriculares' },
  { domain_id: 'MLA-SLATWALL_PANEL_HOOKS', domain_name: 'Ganchos para paneles ranurados', category_name: 'Ménsulas y Ganchos Blisteros' }];
const catalogoMixto = Array.from({ length: 30 }, (_, k) => ({ name: 'Soporte Celular Plegable ' + k, domain_id: 'MLA-CELLPHONE_HOLDERS_AND_STANDS' }))
  .concat(Array.from({ length: 60 }, (_, k) => ({ name: 'Soporte Celular Auto Rejilla ' + k, domain_id: 'MLA-VEHICLE_CELLPHONE_AND_GPS_MOUNTS' })));
const cat2 = meli.elegirCategoria('soporte plegable para celular', reales, catalogoMixto);
chequear('con los candidatos reales elige Porta Celulares', cat2 && cat2.category_name === 'Porta Celulares', cat2 && cat2.category_name);
const cat3 = meli.elegirCategoria('soporte celular para auto', reales, []);
chequear('si la busqueda dice auto, si elige Soportes para Autos', cat3 && cat3.category_name === 'Soportes para Autos', cat3 && cat3.category_name);

console.log('\n== 7. Catalogo paginado: 1 de cada 5 productos con precio (como en produccion) ==');
escenario = { catalogo: true };
r = await competencia('soporte plegable para celular');
chequear('junta 20 o mas publicaciones', r.muestra >= 20, r.muestra + ' (' + JSON.stringify(r.detalleFuente) + ')');
chequear('categoria Porta Celulares', r.categoryName === 'Porta Celulares', r.categoryName);

console.log('\n== 8. Texto de la IA: cifras que no estan en los datos ==');
const fs = await import('node:fs');
const appSrc = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const fnSrc = appSrc.slice(appSrc.indexOf('function mrNumerosNoRespaldados'), appSrc.indexOf('// Texto de respaldo armado'));
const mrNumerosNoRespaldados = new Function(fnSrc + '; return mrNumerosNoRespaldados;')();
const paq = { escenariosDeQuiebre: { dolar: { valor: 2340, hoy: 1536, aguantePct: 52 }, precio: { valor: 6557, tuyo: 9000 } }, senal: 'Margen de 18% (ARS 1.579 por unidad)' };
chequear('detecta el "10%" inventado', JSON.stringify(mrNumerosNoRespaldados({ parrafos: ['cualquier desvío del dólar del 10% te lo liquida'] }, paq)) === '["10%"]');
chequear('acepta las cifras de los datos', mrNumerosNoRespaldados({ parrafos: ['el dólar aguanta hasta $2.340 (52%), ganás ARS 1.579 por unidad'] }, paq).length === 0);

console.log('\n' + oks + ' ok, ' + fallos + ' fallas');
process.exit(fallos ? 1 : 0);
