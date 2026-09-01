// api/_radar.js
// Radar de Oportunidad: encontrar productos que estan creciendo afuera y
// todavia no llegaron a Argentina.
//
// El descubrimiento no cuesta nada. MercadoLibre publica en /trends, por pais y
// por categoria, 50 keywords ordenados: los primeros 10 son las busquedas con
// MAYOR CRECIMIENTO de la semana, despues las mas buscadas y las mas populares.
// Con 32 categorias por pais son 320 señales de crecimiento por pais, gratis y
// semanales. Verificado contra la cuenta: /trends/MLB responde con el token
// argentino, asi que Brasil se consulta igual que Argentina.
//
// La idea: un termino que crece en Brasil y NO aparece en las listas argentinas
// es un producto que ya se movio en un mercado parecido y aca todavia no
// desperto. Ese es el candidato.
//
// Lo que cuesta plata (la saturacion en MLA via el actor de Apify) se gasta
// solo en los finalistas, nunca en el barrido.

import { MELI_API, fetchJson, buscarPublicaciones, anthropicHeaders, supa } from './_meli.js';

// ------------------------------------------------------------
// Tendencias
// ------------------------------------------------------------

// El orden de los 50 elementos lo define MercadoLibre y es fijo.
function partirTendencias(arr) {
  const lista = Array.isArray(arr) ? arr.map(x => x && x.keyword).filter(Boolean) : [];
  return {
    crecimiento: lista.slice(0, 10),
    masBuscadas: lista.slice(10, 30),
    populares: lista.slice(30, 50),
    todas: lista
  };
}

export async function tendencias(site, categoryId, token) {
  const ruta = '/trends/' + site + (categoryId ? '/' + categoryId : '');
  const r = await fetchJson(MELI_API + ruta, token, 6000);
  if (!r.ok) return { ...partirTendencias([]), error: 'HTTP ' + r.status };
  return partirTendencias(r.json);
}

export async function categorias(site, token) {
  const r = await fetchJson(MELI_API + '/sites/' + site + '/categories', token, 6000);
  return (r.ok && Array.isArray(r.json)) ? r.json.map(c => ({ id: c.id, name: c.name })) : [];
}

// ------------------------------------------------------------
// Emparejar categorias entre paises
// Los ids son distintos por sitio (MLA5725 / MLB5672) pero la taxonomia es la
// misma y los nombres se parecen mucho entre español y portugues:
// "Accesorios para Vehiculos" / "Acessorios para Veiculos". Se emparejan por
// distancia de edicion en vez de hardcodear 32 pares que se desactualizan.
// ------------------------------------------------------------
function normalizar(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function distancia(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let previa = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const actual = [i];
    for (let j = 1; j <= n; j++) {
      actual[j] = Math.min(
        previa[j] + 1,
        actual[j - 1] + 1,
        previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previa = actual;
  }
  return previa[n];
}

function ratio(x, y) {
  if (!x || !y) return 0;
  return 1 - distancia(x, y) / Math.max(x.length, y.length);
}

// Comparar la frase entera no alcanza cuando los nombres tienen largo distinto:
// "Animales y Mascotas" contra "Animais" da 0.32 y son el mismo rubro. Por eso
// tambien se compara la palabra fuerte de cada lado ("animales"/"animais"), con
// una penalizacion para que no gane sobre una coincidencia de frase completa.
function parecido(a, b) {
  const x = normalizar(a), y = normalizar(b);
  if (!x || !y) return 0;
  const frase = ratio(x, y);
  const fuertesA = x.split(' ').filter(w => w.length >= 5);
  const fuertesB = y.split(' ').filter(w => w.length >= 5);
  let mejorPalabra = 0;
  for (const pa of fuertesA) {
    for (const pb of fuertesB) {
      const r = ratio(pa, pb);
      if (r > mejorPalabra) mejorPalabra = r;
    }
  }
  return Math.max(frase, mejorPalabra * 0.9);
}

// Rubros donde el español y el portugues usan palabras distintas y ninguna
// metrica de texto los va a juntar: "Hogar, Muebles y Jardin" contra "Casa,
// Moveis e Decoracao". Son pocos y se listan a mano.
const PARES_CONOCIDOS = [
  ['hogar', 'casa'],
  ['juguetes', 'brinquedos'],
  ['ropa', 'roupas'],
  ['indumentaria', 'roupas'],
  ['belleza', 'beleza'],
  ['bebes', 'bebes'],
  ['herramientas', 'ferramentas'],
  ['libros', 'livros'],
  ['joyas', 'joias'],
  ['relojes', 'relogios'],
  ['inmuebles', 'imoveis'],
  ['servicios', 'servicos']
];

function parPorDiccionario(nombreAR, catsB) {
  const a = normalizar(nombreAR);
  for (const [es, pt] of PARES_CONOCIDOS) {
    if (!a.includes(es)) continue;
    const b = catsB.find(c => normalizar(c.name).includes(pt));
    if (b) return b;
  }
  return null;
}

export function emparejarCategorias(catsA, catsB) {
  return catsA.map(a => {
    let mejor = null, puntaje = 0;
    for (const b of catsB) {
      const p = parecido(a.name, b.name);
      if (p > puntaje) { puntaje = p; mejor = b; }
    }
    // Por debajo de 0.6 no es el mismo rubro: mejor sin pareja que emparejado
    // con cualquier cosa. Antes de rendirse, se prueba el diccionario.
    if (puntaje < 0.6) {
      const porDicc = parPorDiccionario(a.name, catsB);
      if (porDicc) return { ar: a, br: porDicc, parecido: 1, via: 'diccionario' };
    }
    // Un rubro sin pareja no se descarta: se analiza solo con Argentina.
    return { ar: a, br: puntaje >= 0.6 ? mejor : null, parecido: Math.round(puntaje * 100) / 100 };
  });
}

// ------------------------------------------------------------
// Traduccion PT -> ES
// Sin esto el cruce no sirve: "farol de milha" y "faro auxiliar" son el mismo
// producto y comparados como texto no coinciden nunca. Se traduce todo el lote
// en una sola llamada.
// ------------------------------------------------------------
// Una sola llamada resuelve dos cosas. La traduccion, porque sin ella "farol de
// milha" y "faro auxiliar" nunca coinciden y el cruce no detecta nada. Y si el
// termino sirve para importar de China, porque la mitad de lo que crece en
// MercadoLibre son commodities y marcas: "leche", "carne", "royal canin",
// "nutrique". Un importador no puede hacer nada con eso.
//
// Va en lotes: la primera version mandaba 40 terminos con max_tokens 2000, la
// respuesta se truncaba, el JSON no parseaba y el catch devolvia {} sin decir
// nada. Por eso el primer barrido en produccion salio con traducidos: 0.
const LOTE = 25;

async function clasificarLote(terminos) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada');
  const prompt =
    'Sos analista de importaciones China->Argentina. Te paso terminos de busqueda ' +
    'de MercadoLibre (algunos en portugues de Brasil, otros en español).\n' +
    'Para cada uno devolve:\n' +
    '- "es": el termino en español rioplatense, con el nombre con el que se lo busca ' +
    'en Argentina (no la traduccion literal). Si ya esta en español, repetilo igual.\n' +
    '- "imp": true si es un producto fisico que un importador chico podria traer de ' +
    'China y revender; false si es un alimento fresco o commodity (leche, carne, cafe), ' +
    'una marca registrada (royal canin, nutrique), un servicio, un vehiculo completo, ' +
    'un inmueble, o algo demasiado pesado o voluminoso para importar en poco volumen.\n' +
    'Responde SOLO un JSON {"termino original": {"es": "...", "imp": true}} sin markdown.\n' +
    JSON.stringify(terminos);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: anthropicHeaders(),
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        // 25 terminos con dos campos cada uno entran holgados. La version
        // anterior se quedaba corta y la respuesta llegaba cortada al medio.
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    // El cuerpo de la respuesta es donde Anthropic explica el 400. Tirarlo
    // dejaba un "HTTP 400" pelado que no dice nada y obliga a adivinar.
    if (!r.ok) {
      const detalle = await r.text().catch(() => '');
      let msg = '';
      try { const e = JSON.parse(detalle); msg = (e.error && e.error.message) || ''; } catch (_) { msg = detalle; }
      throw new Error('Anthropic HTTP ' + r.status + ': ' + String(msg).slice(0, 200));
    }
    const j = await r.json();
    let texto = ((j.content && j.content[0] && j.content[0].text) || '').trim();
    if (j.stop_reason === 'max_tokens') throw new Error('respuesta truncada');
    texto = texto.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    const m = texto.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no devolvio JSON');
    return JSON.parse(m[0]);
  } finally {
    clearTimeout(t);
  }
}

// Traducir y clasificar es lo unico caro y lento del barrido, y se repetia
// entero cada vez: "farol de milha" se traduce igual hoy que la semana que
// viene. Guardadas, un segundo barrido de los mismos rubros no le pregunta
// nada a Claude, y eso es lo que permite mirar muchas mas categorias.
async function clasificacionesGuardadas(keywords) {
  try {
    const { url, key, ok } = supa();
    if (!ok || !keywords.length) return {};
    const enLista = keywords.slice(0, 400)
      .map(k => '"' + String(k).replace(/"/g, '') + '"').join(',');
    const r = await fetch(url + '/rest/v1/keywords_clasificadas?keyword=in.(' +
      encodeURIComponent(enLista) + ')&select=keyword,es,importable,motivo',
      { headers: { apikey: key, Authorization: 'Bearer ' + key } });
    if (!r.ok) return {};
    const filas = await r.json();
    const mapa = {};
    for (const f of (Array.isArray(filas) ? filas : [])) {
      mapa[f.keyword] = { es: f.es, imp: f.importable, motivo: f.motivo };
    }
    return mapa;
  } catch (_) { return {}; }
}

async function guardarClasificaciones(mapa) {
  try {
    const { url, key, ok } = supa();
    const filas = Object.keys(mapa || {}).map(k => ({
      keyword: k, es: mapa[k] && mapa[k].es ? String(mapa[k].es).slice(0, 120) : null,
      importable: !!(mapa[k] && mapa[k].imp),
      motivo: mapa[k] && mapa[k].motivo ? String(mapa[k].motivo).slice(0, 200) : null
    }));
    if (!ok || !filas.length) return;
    await fetch(url + '/rest/v1/keywords_clasificadas?on_conflict=keyword', {
      method: 'POST',
      headers: {
        apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(filas)
    });
  } catch (_) { /* el cache no puede romper el barrido */ }
}

export async function clasificarKeywords(keywords) {
  const limpios = [...new Set((keywords || []).filter(Boolean))];
  if (!limpios.length) return { mapa: {}, error: null };

  const guardadas = await clasificacionesGuardadas(limpios);
  const faltan = limpios.filter(k => !guardadas[k]);
  if (!faltan.length) return { mapa: guardadas, error: null, desdeCache: limpios.length, preguntadas: 0 };

  const lotes = [];
  for (let i = 0; i < faltan.length; i += LOTE) lotes.push(faltan.slice(i, i + LOTE));

  const resultados = await Promise.all(lotes.map(async (lote) => {
    try { return { ok: true, mapa: await clasificarLote(lote) }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 120) }; }
  }));

  const nuevas = {};
  const errores = [];
  for (const r of resultados) {
    if (r.ok) Object.assign(nuevas, r.mapa);
    else errores.push(r.error);
  }
  await guardarClasificaciones(nuevas);

  // El error se devuelve para que se vea en la respuesta del endpoint, en vez
  // de quedar como un "traducidos: 0" sin explicacion.
  return {
    mapa: Object.assign({}, guardadas, nuevas),
    error: errores.length ? errores[0] + (errores.length > 1 ? ' (x' + errores.length + ')' : '') : null,
    desdeCache: Object.keys(guardadas).length,
    preguntadas: faltan.length
  };
}

// ------------------------------------------------------------
// Descubrimiento
// ------------------------------------------------------------

// Un termino brasileño "ya llego" a Argentina si el termino traducido, o
// alguna de sus palabras significativas, aparece en las listas argentinas.
function yaEstaEnArgentina(traducido, listasAR) {
  const t = normalizar(traducido);
  if (!t) return true;   // sin traduccion no se puede afirmar novedad
  const palabras = t.split(' ').filter(w => w.length > 3);
  for (const kw of listasAR) {
    const k = normalizar(kw);
    if (k.includes(t) || t.includes(k)) return true;
    // Coincidencia por palabra fuerte: "lampara led h4" contra "lampara led".
    const compartidas = palabras.filter(w => k.includes(w)).length;
    if (palabras.length && compartidas >= Math.max(2, palabras.length - 1)) return true;
  }
  return false;
}

// Las tendencias son gratis, pero son dos consultas por rubro y Vercel corta a
// los 60 segundos. Se van de a tandas y se para cuando se acaba el presupuesto:
// mejor devolver 20 rubros barridos que morir en el intento con 40.
async function tendenciasPorRubro(pares, token, limiteMs) {
  const salida = [];
  const TANDA = 6;
  const hasta = Date.now() + (limiteMs || 25000);
  for (let i = 0; i < pares.length; i += TANDA) {
    if (Date.now() > hasta) break;
    const tanda = pares.slice(i, i + TANDA);
    const hechas = await Promise.all(tanda.map(async (par) => {
      const [ar, br] = await Promise.all([
        tendencias('MLA', par.ar.id, token),
        par.br ? tendencias('MLB', par.br.id, token) : Promise.resolve(partirTendencias([]))
      ]);
      return { par, ar, br };
    }));
    salida.push(...hechas);
  }
  return salida;
}

export async function descubrir(token, opts) {
  const o = opts || {};
  // Antes eran 6 rubros. Con las clasificaciones cacheadas el barrido grande ya
  // no le cuesta a Claude lo que costaba, asi que se puede mirar mucho mas.
  const maxCategorias = o.maxCategorias || 20;

  const [catsAR, catsBR] = await Promise.all([categorias('MLA', token), categorias('MLB', token)]);
  if (!catsAR.length) return { error: 'MercadoLibre no devolvio las categorias' };

  let pares = emparejarCategorias(catsAR, catsBR);
  const disponibles = pares.length;
  if (o.categoria) pares = pares.filter(p => p.ar.id === o.categoria);
  pares = pares.slice(0, maxCategorias);
  const pedidos = pares.length;

  const porRubro = await tendenciasPorRubro(pares, token, o.presupuestoMs);
  const barridos = porRubro.length;

  // Una sola clasificacion para todos los rubros: traduce los brasileños y
  // marca cuales sirven para importar, de los dos paises.
  const aClasificar = [];
  porRubro.forEach(r => {
    aClasificar.push(...r.br.crecimiento);
    aClasificar.push(...r.ar.crecimiento);
  });
  const clasif = await clasificarKeywords(aClasificar);
  const info = clasif.mapa;
  const traducciones = {};
  Object.keys(info).forEach(k => { if (info[k] && info[k].es) traducciones[k] = info[k].es; });

  // Si no viene clasificado, no se descarta: no saber no es lo mismo que saber
  // que no sirve.
  const importable = (kw) => !(info[kw] && info[kw].imp === false);

  const candidatos = [];
  for (const { par, ar, br } of porRubro) {
    const listasAR = ar.todas;

    // Lo que crece en Argentina: demanda local ya despertando.
    ar.crecimiento.forEach((kw, i) => {
      if (!importable(kw)) return;
      candidatos.push({
        keyword: info[kw] && info[kw].es ? info[kw].es : kw,
        origen: 'AR',
        categoria: par.ar.id,
        categoriaNombre: par.ar.name,
        posicionAR: i + 1,
        posicionBR: null,
        traducidoDe: null,
        senal: 'Está creciendo en las búsquedas de MercadoLibre Argentina esta semana.'
      });
    });

    // Lo que crece en Brasil. Lo valioso es lo que todavia no aparece aca.
    br.crecimiento.forEach((kw, i) => {
      if (!importable(kw)) return;
      const es = traducciones[kw] || null;
      const llego = es ? yaEstaEnArgentina(es, listasAR) : null;
      const tambienAR = es ? ar.crecimiento.findIndex(k => normalizar(k) === normalizar(es)) : -1;
      candidatos.push({
        keyword: es || kw,
        origen: llego === false ? 'BR-nuevo' : 'BR',
        categoria: par.ar.id,
        categoriaNombre: par.ar.name,
        posicionAR: tambienAR >= 0 ? tambienAR + 1 : null,
        posicionBR: i + 1,
        traducidoDe: es ? kw : null,
        senal: llego === false
          ? 'Crece en Brasil y no aparece en las búsquedas argentinas: todavía no llegó.'
          : (tambienAR >= 0
              ? 'Crece en Brasil y en Argentina a la vez: demanda confirmada en los dos mercados.'
              : 'Crece en Brasil.')
      });
    });
  }

  // Un mismo termino puede venir por los dos lados: se queda la mejor señal.
  const porClave = new Map();
  for (const c of candidatos) {
    const clave = normalizar(c.keyword);
    const previo = porClave.get(clave);
    if (!previo) { porClave.set(clave, c); continue; }
    porClave.set(clave, {
      ...previo,
      posicionAR: previo.posicionAR || c.posicionAR,
      posicionBR: previo.posicionBR || c.posicionBR,
      origen: (previo.posicionAR || c.posicionAR) && (previo.posicionBR || c.posicionBR) ? 'ambos' : previo.origen,
      senal: (previo.posicionAR || c.posicionAR) && (previo.posicionBR || c.posicionBR)
        ? 'Crece en Brasil y en Argentina a la vez: demanda confirmada en los dos mercados.'
        : previo.senal
    });
  }

  const lista = [...porClave.values()].map(c => ({ ...c, scoreDemanda: scoreDemanda(c) }));
  lista.sort((a, b) => b.scoreDemanda - a.scoreDemanda);
  const descartados = aClasificar.filter(k => info[k] && info[k].imp === false);
  return {
    candidatos: lista,
    rubros: porRubro.map(r => ({ ar: r.par.ar.name, br: r.par.br ? r.par.br.name : null, parecido: r.par.parecido })),
    // Cuantos rubros se miraron de verdad, contra los que hay. Si el
    // presupuesto de tiempo corto el barrido, se ve en estos numeros.
    rubros_barridos: barridos,
    rubros_pedidos: pedidos,
    rubros_disponibles: disponibles,
    clasificacion_desde_cache: clasif.desdeCache || 0,
    clasificacion_preguntadas: clasif.preguntadas || 0,
    clasificados: Object.keys(info).length,
    descartadosNoImportables: descartados.length,
    ejemploDescartado: descartados.slice(0, 5),
    errorClasificacion: clasif.error
  };
}

// ------------------------------------------------------------
// Score
// ------------------------------------------------------------

// Demanda, con lo que sale gratis. Cuanto mas arriba en la lista de
// crecimiento, mas fuerte la señal; y estar en los dos paises pesa mas que
// estar en uno solo.
export function scoreDemanda(c) {
  let s = 0;
  if (c.posicionAR) s += 40 - (c.posicionAR - 1) * 2;     // 40 a 22
  if (c.posicionBR) s += 35 - (c.posicionBR - 1) * 2;     // 35 a 17
  if (c.origen === 'BR-nuevo') s += 25;                    // todavia no llego
  if (c.posicionAR && c.posicionBR) s += 15;               // confirmado en dos mercados
  return Math.max(0, Math.min(100, Math.round(s)));
}

// Score final, una vez que se pago la consulta de saturacion en MLA.
// Mucha demanda afuera y poca oferta aca = alto. Saturado = bajo, por mas que
// afuera explote.
export function opportunityScore(c, mla) {
  const demanda = c.scoreDemanda != null ? c.scoreDemanda : scoreDemanda(c);
  if (!mla || !mla.listings) return { score: null, motivo: 'Falta medir la competencia en Argentina.' };

  // Sin total real no se puede hablar de saturacion. El scraper devuelve una
  // muestra (pedimos 48 y trae lo que encuentra), y confundirla con el total
  // hacia decir "solo 39 publicaciones: el mercado esta casi vacio" cuando en
  // realidad no sabemos cuantas hay. Es justo el numero inventado que la app
  // promete no dar.
  // MercadoLibre no publica cuantas publicaciones hay para un termino, y el
  // scraper tampoco: se miro el dataset campo por campo y no esta. Contar la
  // muestra y llamarla "total" era el numero inventado que esta app promete no
  // dar, asi que la saturacion por conteo queda en null para siempre.
  //
  // Lo que si se puede medir con datos reales es como esta repartida la venta
  // entre los que ya estan. Un rubro donde tres vendedores se llevan casi todo
  // esta tomado aunque haya pocas publicaciones; uno donde la venta esta
  // repartida deja lugar aunque haya muchas. Eso es otra pregunta que "cuantas
  // publicaciones hay", y se informa como lo que es.
  if (!mla.totalReal) {
    const cp = mla.competencia;
    const precios = mla.precioMediana
      ? ' Precio típico $' + Math.round(mla.precioMediana).toLocaleString('es-AR') + '.'
      : '';
    const base = 'Vistas ' + mla.muestra + ' publicaciones, ' + mla.vendedores + ' vendedores distintos.';

    // Sin ventas informadas no hay nada que concluir: se dice y se corta.
    if (!cp || cp.concentracion_top3 == null) {
      return {
        score: null, saturacion: null, concentracion: null, pelea: null,
        motivo: 'No hay datos de ventas para saber quién se queda con este mercado. ' + base + precios,
        soloMuestra: true
      };
    }

    const conc = cp.concentracion_top3;
    // Tiendas oficiales y platinum encarecen la pelea aunque la venta este
    // repartida: no es lo mismo competirle a un revendedor que a una marca.
    const peso = Math.min(30, (cp.tiendas_oficiales || 0) * 6 + (cp.platinum || 0) * 3);
    const score = Math.max(-100, Math.min(100, Math.round(demanda - conc * 0.5 - peso)));

    let lectura;
    if (conc >= 80) lectura = 'Tomado: los 3 primeros vendedores se llevan el ' + conc + '% de las ventas.';
    else if (conc >= 55) lectura = 'Concentrado: los 3 primeros se llevan el ' + conc + '%, pero hay resto.';
    else lectura = 'Repartido: los 3 primeros se llevan el ' + conc + '%, la venta está distribuida.';

    const quien = [];
    if (cp.tiendas_oficiales) quien.push(cp.tiendas_oficiales + ' tienda' + (cp.tiendas_oficiales > 1 ? 's' : '') + ' oficial' + (cp.tiendas_oficiales > 1 ? 'es' : ''));
    if (cp.platinum) quien.push(cp.platinum + ' platinum');

    return {
      score,
      saturacion: null,
      concentracion: conc,
      pelea: null,
      competencia: cp,
      motivo: lectura + ' ' + base + (quien.length ? ' Enfrente: ' + quien.join(' y ') + '.' : '') + precios +
        ' No puedo decir cuántas publicaciones hay en total: MercadoLibre no lo expone.',
      soloMuestra: true
    };
  }

  const listings = mla.listings;
  // Saturacion: 0 publicaciones no penaliza, 5000 o mas penaliza al maximo.
  const saturacion = Math.min(100, Math.round(Math.log10(Math.max(1, listings)) / Math.log10(5000) * 100));
  // Competencia de precio: muchos vendedores distintos en pocos listings
  // significa pelea por precio.
  const vendedores = mla.vendedores || 0;
  const pelea = listings > 0 ? Math.min(100, Math.round((vendedores / Math.max(1, listings)) * 100)) : 0;

  const score = Math.max(-100, Math.min(100, Math.round(demanda - saturacion * 0.6 - pelea * 0.15)));

  let motivo;
  if (listings < 200) motivo = 'Sólo ' + listings + ' publicaciones en MercadoLibre Argentina: el mercado está casi vacío.';
  else if (listings < 1500) motivo = listings + ' publicaciones: hay competencia pero todavía queda lugar.';
  else if (listings < 6000) motivo = listings + ' publicaciones: el rubro ya está trabajado.';
  else motivo = listings + ' publicaciones: saturado, no importa cuánto crezca afuera.';

  return { score, saturacion, pelea, motivo, soloMuestra: false };
}

// Saturacion real en MLA. Reusa el mismo pipeline que el analizador: mismo
// cache, mismas corridas asincronicas, mismo "preparando". No duplica nada.
// Cuantas publicaciones tiene la categoria entera, segun MercadoLibre.
// OJO con que es esto: el tamano del rubro, no la competencia del termino.
// "Faros Auxiliares" tiene 124.635 publicaciones, pero "faro antiniebla moto"
// es una rebanada de eso. Sirve para ubicar el producto (¿cae en un rubro
// gigante o en un nicho chico?), no para reemplazar la saturacion que no
// tenemos. Se muestra como contexto y no entra en el puntaje: inventar un
// peso para un numero que mide otra cosa seria el mismo error de antes.
export async function infoCategoria(id, token) {
  if (!id || !/^ML[A-Z]\d{3,}$/.test(String(id))) return null;
  const r = await fetchJson(MELI_API + '/categories/' + id, token, 5000);
  if (!r || r.status !== 200 || !r.json) return null;
  const j = r.json;
  const total = typeof j.total_items_in_this_category === 'number' ? j.total_items_in_this_category : null;
  if (total == null) return null;
  return {
    id,
    nombre: j.name || '',
    total,
    camino: Array.isArray(j.path_from_root) ? j.path_from_root.map(p => p.name).join(' > ') : ''
  };
}

export async function saturacionMLA(keyword, token) {
  const r = await buscarPublicaciones(keyword, token, { budgetMs: 6000, maxIds: 48 });
  if (!r) return null;
  if (r.pendiente) return { pendiente: true };
  const precios = (r.results || []).map(x => x.price).filter(p => typeof p === 'number' && p > 0);
  const vendedores = new Set((r.results || []).map(x => x.seller && x.seller.id).filter(Boolean));
  precios.sort((a, b) => a - b);

  // La categoria que mas se repite en la muestra es la del producto.
  const catId = r.competencia && r.competencia.categoria_dominante && r.competencia.categoria_dominante.id;
  const cat = catId ? await infoCategoria(catId, token) : null;

  return {
    fuente: r.fuente,
    listings: (typeof r.total === 'number' && r.total > 0) ? r.total : (r.results || []).length,
    totalReal: typeof r.total === 'number' && r.total > 0,
    muestra: (r.results || []).length,
    vendedores: vendedores.size,
    competencia: r.competencia || null,
    categoria: cat,
    // De cuando es la medicion. Se cachea una semana porque cada consulta
    // nueva cuesta plata, asi que hay que decir que no es de recien.
    desdeCache: !!r.desdeCache,
    medidoEn: r.guardadoEn || null,
    precioMin: precios[0] || null,
    precioMediana: precios.length ? precios[Math.floor(precios.length / 2)] : null,
    precioMax: precios[precios.length - 1] || null
  };
}
