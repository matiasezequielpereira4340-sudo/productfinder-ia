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

  // ---- Supabase falso ----
  if (u.pathname === '/rest/v1/busquedas_cache') {
    if (req.method === 'HEAD') { res.writeHead(cacheEscribible ? 200 : 401); return res.end(); }
    if (req.method === 'POST') { res.writeHead(cacheEscribible ? 201 : 401); return res.end(cacheEscribible ? '' : 'denied'); }
    res.writeHead(200, {'content-type':'application/json'}); return res.end('[]');
  }
  if (u.pathname === '/rest/v1/apify_gasto') {
    if (req.method === 'HEAD') {
      if (process.env.SUPA_CAIDO === '1') { res.writeHead(500); return res.end(); }
      const dia = (u.searchParams.get('dia') || '').replace('eq.', '');
      const n = filas.filter(f => f.dia === dia && f.estado !== 'anulada').length;
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
chequear('el aviso dice cuantas se usaron', /3 de 3/.test((r && r.aviso) || ''), r && r.aviso);
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

console.log('\n== 9. Estimacion de costo ==');
chequear('48 items enriquecidos = 0.192 USD', gasto.costoEstimado(48, true) === 0.192, String(gasto.costoEstimado(48, true)));
chequear('48 items pelados = 0.048 USD', gasto.costoEstimado(48, false) === 0.048, String(gasto.costoEstimado(48, false)));
chequear('los dos juntos = 0.24 USD (lo aprobado)', Number((gasto.costoEstimado(48,true)+gasto.costoEstimado(48,false)).toFixed(3)) === 0.24);

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

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' chequeos' : 'TODOS LOS CHEQUEOS PASARON'));
srv.close();
process.exit(fallos ? 1 : 0);
