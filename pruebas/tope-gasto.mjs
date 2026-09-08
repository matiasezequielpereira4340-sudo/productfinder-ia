// pruebas/tope-gasto.mjs
// Se corre con: npm run test:gasto
//
// No toca Supabase ni Apify de verdad: levanta los dos en localhost y hace
// correr el codigo REAL de _gasto.js y de la via proveedor de _meli.js. Sirve
// para no volver a poner en produccion codigo que gasta sin freno.
// Levanta un Supabase falso y un Apify falso en localhost, y hace correr el
// codigo REAL de _gasto.js y de la via proveedor de _meli.js.
import http from 'node:http';

const PUERTO = 4199;
let filas = [];       // tabla apify_gasto simulada
let seq = 1;
let apifyArranques = 0;
let apifyAbortos = 0;
let cacheEscribible = true;
let pendientes = [];    // filas que devuelve busquedas_cache con run_id
let guardados = [];     // lo que se escribio de vuelta

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  for await (const c of req) body += c;

  // ---- Apify falso ----
  if (u.pathname.startsWith('/apify/acts/')) {
    apifyArranques++;
    if (process.env.FALLA_APIFY === '1') { res.writeHead(500); return res.end('boom'); }
    res.writeHead(201, {'content-type':'application/json'});
    return res.end(JSON.stringify({ data: { id: 'run_' + apifyArranques, defaultDatasetId: 'ds_' + apifyArranques, status: 'RUNNING' } }));
  }
  if (u.pathname.includes('/abort')) { apifyAbortos++; res.writeHead(200); return res.end('{}'); }
  if (/\/apify\/(v2\/)?actor-runs\/[^/]+$/.test(u.pathname)) {
    res.writeHead(200, {'content-type':'application/json'});
    return res.end(JSON.stringify({ data: { id:'x', status:'SUCCEEDED', defaultDatasetId:'ds1',
      startedAt:'2026-09-05T19:08:00Z', finishedAt:'2026-09-05T19:09:00Z',
      usageTotalUsd: 0.232, stats:{ computeUnits: 0.02, outputItemCount: 2, durationMillis: 60000 } } }));
  }
  if (/\/apify\/(v2\/)?datasets\/[^/]+\/items/.test(u.pathname)) {
    res.writeHead(200, {'content-type':'application/json'});
    // Forma cruda de TikTok Shop, que es la que tiene que normalizar _fuentes.
    return res.end(JSON.stringify([
      { title:'Mini Projector 1080p', product_link:'https://shop.tiktok.com/us/1', sold_count:120, price:'$49.9' },
      { title:'Portable Projector HD', product_link:'https://shop.tiktok.com/us/2', sold_count:80, price:'$39.9' }
    ]));
  }

  // ---- Supabase falso ----
  if (u.pathname === '/rest/v1/busquedas_cache') {
    if (req.method === 'HEAD') { res.writeHead(cacheEscribible ? 200 : 401); return res.end(); }
    if (req.method === 'POST') {
      if (!cacheEscribible) { res.writeHead(401); return res.end('denied'); }
      try { guardados.push(JSON.parse(body)); } catch (_) {}
      res.writeHead(201); return res.end('');
    }
    res.writeHead(200, {'content-type':'application/json'});
    return res.end(JSON.stringify(pendientes));
  }
  if (u.pathname === '/rest/v1/apify_gasto') {
    if (req.method === 'HEAD') {
      if (process.env.SUPA_CAIDO === '1') { res.writeHead(500); return res.end(); }
      const activas = filas.filter(f => f.estado !== 'anulada');
      let n;
      if (u.searchParams.has('dia')) {
        // Conteo del DIA (cinturon).
        const dia = (u.searchParams.get('dia') || '').replace('eq.', '');
        n = activas.filter(f => f.dia === dia).length;
      } else {
        // Conteo del CICLO: ts >= inicio. Es el tope que manda.
        const desde = (u.searchParams.get('ts') || '').replace('gte.', '');
        n = activas.filter(f => !desde || String(f.ts) >= desde).length;
      }
      res.writeHead(200, { 'content-range': '0-0/' + n }); return res.end();
    }
    if (req.method === 'POST') {
      const f = JSON.parse(body); f.id = seq++; filas.push(f);
      res.writeHead(201, {'content-type':'application/json'}); return res.end(JSON.stringify([f]));
    }
    if (req.method === 'PATCH') {
      const id = Number((u.searchParams.get('id') || '').replace('eq.', ''));
      const f = filas.find(x => x.id === id);
      if (f) Object.assign(f, JSON.parse(body));
      res.writeHead(204); return res.end();
    }
    if (req.method === 'GET') {
      res.writeHead(200, {'content-type':'application/json'});
      return res.end(JSON.stringify(filas.slice().reverse()));
    }
  }
  res.writeHead(404); res.end('{}');
});
await new Promise(r => srv.listen(PUERTO, r));

process.env.SUPABASE_URL = 'http://127.0.0.1:' + PUERTO;
process.env.SUPABASE_SERVICE_KEY = 'fake';
process.env.APIFY_TOKEN = 'fake';
process.env.APIFY_MAX_RUNS_DIA = '3';

// Desvia api.apify.com al servidor falso, sin tocar el codigo de produccion.
const fetchReal = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const s = String(url);
  if (s.startsWith('https://api.apify.com/v2/acts/')) {
    return fetchReal('http://127.0.0.1:' + PUERTO + '/apify/acts/x', init);
  }
  if (s.startsWith('https://api.apify.com/')) {
    return fetchReal('http://127.0.0.1:' + PUERTO + '/apify' + new URL(s).pathname, init);
  }
  if (s.startsWith('https://api.mercadolibre.com/')) {
    return Promise.resolve(new Response('{}', { status: 403 }));
  }
  if (/mercadolibre\.com\.ar|mercadolivre|listado\./.test(s)) {
    return Promise.resolve(new Response('<html>bloqueado</html>', { status: 200 }));
  }
  return fetchReal(url, init);
};

const gasto = await import('../api/_gasto.js');
const meli  = await import('../api/_meli.js');

let fallos = 0;
function chequear(nombre, cond, extra) {
  console.log((cond ? '  OK   ' : '  FALLA') + ' | ' + nombre + (extra ? ' -> ' + extra : ''));
  if (!cond) fallos++;
}

console.log('\n== 1. Dia calendario argentino, no UTC ==');
// 2026-09-08T02:00:00Z son las 23:00 del 7/9 en Buenos Aires.
const d = new Date('2026-09-08T02:00:00Z');
chequear('23:00 hora AR sigue siendo el dia anterior', gasto.diaAr(d) === '2026-09-07', gasto.diaAr(d));
chequear('con UTC daria el dia siguiente (el bug que se evita)', d.toISOString().slice(0,10) === '2026-09-08');
const rein = gasto.proximoReinicio(d);
chequear('reinicio = medianoche AR = 03:00 UTC del 8', rein === '2026-09-08T03:00:00.000Z', rein);

console.log('\n== 2. Gate de sesion: sin sesion no se arranca nada ==');
apifyArranques = 0;
let r = await meli.buscarPublicaciones('producto de prueba sin sesion', 'tok', { puedeGastar: false, sinCache: true });
chequear('devuelve requiereSesion', !!(r && r.requiereSesion), r && r.fuente);
chequear('el aviso es claro, no un error generico', /iniciar sesion/i.test((r && r.aviso) || ''), r && r.aviso);
chequear('NO se arranco ninguna corrida', apifyArranques === 0, 'arranques=' + apifyArranques);
chequear('NO se reservo cupo', filas.length === 0, 'filas=' + filas.length);

console.log('\n== 3. Con sesion: arranca, reserva y anota el run_id ==');
r = await meli.buscarPublicaciones('termino con sesion', 'tok', { puedeGastar: true, sinCache: true });
chequear('devuelve preparando', !!(r && r.pendiente), r && r.fuente);
chequear('se arranco 1 corrida', apifyArranques === 1, 'arranques=' + apifyArranques);
chequear('quedo 1 fila de gasto', filas.length === 1);
chequear('la fila quedo arrancada con run_id', filas[0] && filas[0].estado === 'arrancada' && !!filas[0].run_id, JSON.stringify(filas[0] && {e:filas[0].estado, r:filas[0].run_id}));
chequear('guarda termino, items y costo estimado', filas[0].termino === 'termino con sesion' && filas[0].items === 48 && filas[0].costo_estimado > 0, 'items=' + filas[0].items + ' usd=' + filas[0].costo_estimado);
chequear('la respuesta informa el cupo', !!(r.gasto && r.gasto.tope === 3), JSON.stringify(r.gasto));

console.log('\n== 4. Tope diario: la 4a corrida no arranca ==');
await meli.buscarPublicaciones('termino 2', 'tok', { puedeGastar: true, sinCache: true });
await meli.buscarPublicaciones('termino 3', 'tok', { puedeGastar: true, sinCache: true });
const antes = apifyArranques;
r = await meli.buscarPublicaciones('termino 4', 'tok', { puedeGastar: true, sinCache: true });
chequear('devuelve topeAlcanzado', !!(r && r.topeAlcanzado), r && r.fuente);
chequear('NO arranco corrida nueva', apifyArranques === antes, 'arranques=' + apifyArranques);
chequear('el aviso dice el tope diario y lo que queda en el mes', /tope de 3 busquedas nuevas por dia/.test((r && r.aviso) || ''), r && r.aviso);
chequear('el aviso dice cuando se reinicia', /medianoche/i.test((r && r.aviso) || ''));
chequear('no es un error generico', !/error/i.test((r && r.aviso) || ''));

console.log('\n== 5. Si Apify falla, se libera el cupo ==');
filas = []; seq = 1; apifyArranques = 0;
process.env.FALLA_APIFY = '1';
r = await meli.buscarPublicaciones('termino que revienta', 'tok', { puedeGastar: true, sinCache: true });
const activas = filas.filter(f => f.estado !== 'anulada').length;
chequear('la reserva quedo anulada', activas === 0, 'activas=' + activas + ' total=' + filas.length);
chequear('la fila anulada guarda el motivo', /no arranco/.test((filas[0] && filas[0].motivo) || ''), filas[0] && filas[0].motivo);
delete process.env.FALLA_APIFY;

console.log('\n== 6. Si no se puede contar, NO se gasta (freno cerrado) ==');
filas = []; seq = 1; apifyArranques = 0;
process.env.SUPA_CAIDO = '1';
r = await meli.buscarPublicaciones('termino sin contador', 'tok', { puedeGastar: true, sinCache: true });
chequear('devuelve topeAlcanzado con motivo sin-cuenta', !!(r && r.topeAlcanzado && r.gasto && r.gasto.motivo === 'sin-cuenta'), JSON.stringify(r && r.gasto));
chequear('NO arranco corrida', apifyArranques === 0, 'arranques=' + apifyArranques);
delete process.env.SUPA_CAIDO;

console.log('\n== 7. Si no se puede registrar en busquedas_cache, se aborta y se libera ==');
filas = []; seq = 1; apifyArranques = 0; apifyAbortos = 0;
cacheEscribible = true;
// HEAD pasa, POST falla: es el caso "puedo leer pero no escribir".
const srvPost = srv.listeners('request')[0];
cacheEscribible = 'solo-lectura';
srv.removeAllListeners('request');
srv.on('request', async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/rest/v1/busquedas_cache' && req.method === 'POST') { res.writeHead(401); return res.end('denied'); }
  return srvPost(req, res);
});
r = await meli.buscarPublicaciones('termino sin registro', 'tok', { puedeGastar: true, sinCache: true });
const activas7 = filas.filter(f => f.estado !== 'anulada').length;
chequear('se arranco la corrida', apifyArranques === 1, 'arranques=' + apifyArranques);
chequear('se aborto en Apify', apifyAbortos === 1, 'abortos=' + apifyAbortos);
chequear('el cupo se libero', activas7 === 0, 'activas=' + activas7);

console.log('\n== 8. Brasil/Mexico no pasan por la via paga ==');
filas = []; seq = 1; apifyArranques = 0;
srv.removeAllListeners('request'); srv.on('request', srvPost);
r = await meli.buscarPublicaciones('produto brasileiro', 'tok', { site: 'MLB', puedeGastar: true, sinCache: true });
chequear('no arranca corrida para MLB', apifyArranques === 0, 'arranques=' + apifyArranques);
chequear('no reserva cupo para MLB', filas.length === 0);

console.log('\n== 9. Estimacion de costo, calibrada contra 5 corridas reales ==');
// Medido en la factura de Apify: 0.22405, 0.22805, 0.23205, 0.23605, 0.24005
// por 48 items enriquecidos. Promedio 0.23205. 48 x 0.004 = 0.192, o sea que
// hay 0.040 de costo de arranque que la ficha del actor no menciona.
const REALES = [0.22405, 0.22805, 0.23205, 0.23605, 0.24005];
const promedioReal = REALES.reduce((a,b)=>a+b,0) / REALES.length;
const est48 = gasto.costoEstimado(48, true);
chequear('48 enriquecidos cae dentro del rango medido', est48 >= REALES[0] && est48 <= REALES[4], String(est48));
chequear('y clava el promedio real (0.232)', Math.abs(est48 - promedioReal) < 0.0005,
         'estimado ' + est48 + ' vs real ' + promedioReal.toFixed(5));
chequear('48 pelados = 0.088 USD', gasto.costoEstimado(48, false) === 0.088, String(gasto.costoEstimado(48, false)));
chequear('una corrida de 0 items igual cuesta el arranque', gasto.costoEstimado(0, true) === 0.04,
         String(gasto.costoEstimado(0, true)));
// La vieja formula sin arranque subestimaba: hay que ver que ya no pase.
chequear('la estimacion NO subestima como antes (0.192)', est48 > 0.192, String(est48));

console.log('\n== 10. Resumen de auditoria por termino ==');
filas = []; seq = 1;
await meli.buscarPublicaciones('parlante jbl', 'tok', { puedeGastar: true, sinCache: true });
await meli.buscarPublicaciones('parlante jbl', 'tok', { puedeGastar: true, sinCache: true });
const res10 = await gasto.resumenGasto(50);
chequear('agrupa por termino', !!(res10.porTermino && res10.porTermino['parlante jbl']), JSON.stringify(res10.porTermino));
chequear('cuenta 2 corridas del termino', res10.porTermino['parlante jbl'].corridas === 2);
chequear('informa tope y restantes', res10.tope === 3 && res10.restantes === 1, 'tope=' + res10.tope + ' rest=' + res10.restantes);
chequear('informa cuando se reinicia', typeof res10.reinicio === 'string' && res10.reinicio.endsWith('Z'), res10.reinicio);

console.log('\n== 11. REGRESION: sin sesion las vias GRATUITAS siguen andando ==');
// El demo publico de la portada no puede romperse. Se simula un listado
// publico que SI responde y una hidratacion de /items que trae precios.
filas = []; seq = 1; apifyArranques = 0;
globalThis.fetch = (url, init) => {
  const s = String(url);
  if (s.includes('/items?ids=')) {
    const cuerpo = ['MLA111111111','MLA222222222','MLA333333333'].map((id, i) => ({
      code: 200, body: { id, title: 'Parlante bluetooth portatil modelo ' + i, price: 25000 + i * 1000,
        currency_id: 'ARS', sold_quantity: 10 + i, permalink: 'https://x/' + id,
        seller: { id: 900 + i, nickname: 'VEND' + i }, shipping: { free_shipping: i % 2 === 0 } }
    }));
    return Promise.resolve(new Response(JSON.stringify(cuerpo), { status: 200, headers: {'content-type':'application/json'} }));
  }
  if (/listado\.mercadolibre\.com\.ar/.test(s)) {
    const html = '<html>' + ['MLA111111111','MLA222222222','MLA333333333']
      .map(id => '<a href="https://articulo.mercadolibre.com.ar/' + id.replace('MLA','MLA-') + '-parlante-bluetooth-_JM">x</a>').join('') + '</html>';
    return Promise.resolve(new Response(html, { status: 200, headers: {'content-type':'text/html'} }));
  }
  if (s.startsWith('https://api.apify.com/')) { apifyArranques++; return Promise.resolve(new Response('{}', {status:500})); }
  if (s.startsWith('https://api.mercadolibre.com/')) return Promise.resolve(new Response('{}', { status: 403 }));
  if (s.startsWith('http://127.0.0.1')) return fetchReal(url, init);
  return Promise.resolve(new Response('{}', { status: 404 }));
};
// Los tests anteriores dejaron la via "listado" marcada como fallada; sin
// esto se saltearia y el chequeo mediria otra cosa.
const est = meli.viaDeBusquedaUsada('MLA');
for (const k of Object.keys(est.porSitio)) delete est.porSitio[k];
const libre = await meli.buscarPublicaciones('parlante bluetooth portatil', 'tok', { puedeGastar: false, sinCache: true });
chequear('la via gratuita devuelve publicaciones sin sesion', !!(libre && libre.results && libre.results.length >= 1), libre && (libre.fuente + ' n=' + (libre.results||[]).length));
chequear('trae precios reales', !!(libre && (libre.results||[]).some(x => x.price > 0)));
chequear('NO se toco Apify', apifyArranques === 0, 'llamadas=' + apifyArranques);
chequear('NO se reservo cupo', filas.length === 0, 'filas=' + filas.length);

console.log('\n== 12. sinPago: un barrido masivo no puede pagar ni con sesion ==');
// Todo bloqueado: la unica via que podria contestar es la paga.
filas = []; seq = 1; apifyArranques = 0;
globalThis.fetch = (url, init) => {
  const s = String(url);
  // El contador lo lleva el servidor falso; aca solo se desvia.
  if (s.startsWith('https://api.apify.com/')) return fetchReal('http://127.0.0.1:' + PUERTO + '/apify/acts/x', init);
  if (s.startsWith('https://api.mercadolibre.com/')) return Promise.resolve(new Response('{}', { status: 403 }));
  if (/mercadolibre\.com\.ar|mercadolivre|listado\./.test(s)) return Promise.resolve(new Response('<html>bloqueado</html>', { status: 200 }));
  if (s.startsWith('http://127.0.0.1')) return fetchReal(url, init);
  return Promise.resolve(new Response('{}', { status: 404 }));
};
const est12 = meli.viaDeBusquedaUsada('MLA');
for (const k of Object.keys(est12.porSitio)) delete est12.porSitio[k];

// puedeGastar TRUE (hay sesion) y aun asi sinPago tiene que ganar.
let bar = await meli.buscarPublicaciones('barrido masivo producto 1', 'tok', {
  puedeGastar: true, sinPago: true, sinCache: true });
chequear('devuelve sinPago', !!(bar && bar.sinPago), bar && bar.fuente);
chequear('NO arranco corrida aunque haya sesion', apifyArranques === 0, 'arranques=' + apifyArranques);
chequear('NO reservo cupo', filas.length === 0, 'filas=' + filas.length);
chequear('el aviso explica que no se puede gratis', /no permite consultarla gratis/i.test((bar && bar.aviso) || ''), bar && bar.aviso);

// Control: el MISMO caso sin sinPago si arranca. Prueba que lo que freno fue
// el flag y no que la cadena estuviera rota.
for (const k of Object.keys(est12.porSitio)) delete est12.porSitio[k];
bar = await meli.buscarPublicaciones('barrido masivo producto 2', 'tok', {
  puedeGastar: true, sinCache: true });
chequear('control: sin el flag SI arranca', apifyArranques === 1 && !!(bar && bar.pendiente), 'arranques=' + apifyArranques + ' fuente=' + (bar && bar.fuente));

console.log('\n== 12.b El tope que manda es el MENSUAL, no el diario ==');
// Con el plan free de Apify el presupuesto son ~18 busquedas POR MES. Un tope
// diario de 30 eran USD 207 al mes: cuarenta veces el techo real de la cuenta.
process.env.APIFY_MAX_RUNS_MES = '4';
process.env.APIFY_MAX_RUNS_DIA = '99';   // el diario NO tiene que frenar aca
filas = []; seq = 1; apifyArranques = 0;
const est13 = meli.viaDeBusquedaUsada('MLA');
for (const k of Object.keys(est13.porSitio)) delete est13.porSitio[k];
globalThis.fetch = (url, init) => {
  const s = String(url);
  if (s.startsWith('https://api.apify.com/v2/acts/')) return fetchReal('http://127.0.0.1:' + PUERTO + '/apify/acts/x', init);
  if (s.startsWith('https://api.apify.com/')) return Promise.resolve(new Response('{}', { status: 403 }));
  if (s.startsWith('https://api.mercadolibre.com/')) return Promise.resolve(new Response('{}', { status: 403 }));
  if (/mercadolibre\.com\.ar|mercadolivre|listado\./.test(s)) return Promise.resolve(new Response('<html>bloqueado</html>', { status: 200 }));
  if (s.startsWith('http://127.0.0.1')) return fetchReal(url, init);
  return Promise.resolve(new Response('{}', { status: 404 }));
};
for (let i = 1; i <= 4; i++) {
  for (const k of Object.keys(est13.porSitio)) delete est13.porSitio[k];
  await meli.buscarPublicaciones('producto del mes ' + i, 'tok', { puedeGastar: true, sinCache: true });
}
chequear('las 4 del mes arrancaron', apifyArranques === 4, 'arranques=' + apifyArranques);
for (const k of Object.keys(est13.porSitio)) delete est13.porSitio[k];
const quinta = await meli.buscarPublicaciones('producto del mes 5', 'tok', { puedeGastar: true, sinCache: true });
chequear('la 5a NO arranca aunque el tope diario sea 99', apifyArranques === 4, 'arranques=' + apifyArranques);
chequear('el motivo es el tope del MES', !!(quinta && quinta.gasto && quinta.gasto.motivo === 'tope-mes'),
         JSON.stringify(quinta && quinta.gasto));
chequear('el aviso habla de credito del mes, no del dia', /credito del mes/i.test((quinta && quinta.aviso) || ''),
         quinta && quinta.aviso);
chequear('el aviso dice que se puede ver lo guardado', /ya esta guardado/i.test((quinta && quinta.aviso) || ''));
chequear('el aviso dice cuando se reinicia', /Se reinicia/i.test((quinta && quinta.aviso) || ''));
process.env.APIFY_MAX_RUNS_MES = '999';
process.env.APIFY_MAX_RUNS_DIA = '3';

console.log('\n== 13. El barrido de cosecha levanta TikTok/Trends, no solo MercadoLibre ==');
// Antes cosecharPendientes se salteaba todo lo que no fuera proveedor-apify y
// las dejaba pagas y sin levantar: medido en produccion, 5 de 13.
filas = []; seq = 1; guardados = []; cacheEscribible = true; apifyArranques = 0;
// El test 12 dejo un stub que manda TODO api.apify.com al arranque del actor.
// Aca hace falta enrutar por path: estado de corrida y dataset son endpoints
// distintos, y confundirlos hacia leer "RUNNING" donde el mock decia SUCCEEDED.
globalThis.fetch = (url, init) => {
  const s = String(url);
  if (s.startsWith('https://api.apify.com/')) {
    return fetchReal('http://127.0.0.1:' + PUERTO + '/apify' + new URL(s).pathname, init);
  }
  if (s.startsWith('http://127.0.0.1')) return fetchReal(url, init);
  return Promise.resolve(new Response('{}', { status: 403 }));
};
pendientes = [
  { termino:'tiktok::mini projetor', fuente:'tiktok-shop', run_id:'r1', dataset_id:'ds1',
    run_estado:'READY', run_desde:'2026-09-01T15:13:53Z', resultados:[] },
  { termino:'ya guardada', fuente:'proveedor-apify', run_id:'r2', dataset_id:'ds2',
    run_estado:'SUCCEEDED', run_desde:'2026-09-01T15:00:00Z', resultados:[{id:'MLA1'}] }
];
const barrido = await meli.cosecharPendientes('tok', { limite: 10 });
chequear('el barrido corrio', !!(barrido && barrido.ok), JSON.stringify(barrido && barrido.detalle));
const tk = (barrido.detalle||[]).find(d => d.fuente === 'tiktok-shop');
chequear('la fila de TikTok ya no se saltea como "otra-fuente"', !!tk && tk.estado !== 'otra-fuente',
         tk && tk.estado);
chequear('se cosecho y guardo con publicaciones', !!tk && tk.estado === 'cosechada' && tk.publicaciones > 0,
         JSON.stringify(tk));
chequear('la fila que ya tenia resultados no se vuelve a tocar',
         (barrido.detalle||[]).some(d => d.estado === 'ya-cosechada'));
const escrito = guardados.find(g => g.termino === 'tiktok::mini projetor');
chequear('se escribio de vuelta en busquedas_cache con run_id en null',
         !!escrito && escrito.run_id === null && Array.isArray(escrito.resultados) && escrito.resultados.length === 2,
         escrito ? ('n=' + escrito.resultados.length + ' run_id=' + escrito.run_id) : 'no se escribio');
chequear('NO arranco ninguna corrida nueva', apifyArranques === 0, 'arranques=' + apifyArranques);

console.log('\n== 14. La ventana de vigencia ya no es de 15 minutos ==');
// Los datasets de Apify viven un mes; con 15 minutos, una corrida que terminaba
// cuando el usuario ya se habia ido quedaba pagada y fuera de alcance.
const horas = Number(process.env.CORRIDA_VIGENTE_HORAS || 168);
chequear('el default son 168 horas (7 dias), no 15 minutos', horas === 168, horas + 'h');

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' chequeos' : 'TODOS LOS CHEQUEOS PASARON'));
srv.close();
process.exit(fallos ? 1 : 0);
