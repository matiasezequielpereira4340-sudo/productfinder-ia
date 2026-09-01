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

import { MELI_API, fetchJson, buscarPublicaciones } from './_meli.js';

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
export async function traducirKeywords(keywords) {
  const limpios = [...new Set((keywords || []).filter(Boolean))];
  if (!limpios.length) return {};
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return {};
  const prompt = 'Traduci al español rioplatense estos terminos de busqueda de productos de ' +
    'MercadoLibre Brasil. Son nombres de productos que la gente busca para comprar. ' +
    'Usa el nombre con el que se lo busca en Argentina, no la traduccion literal. ' +
    'Responde SOLO un JSON {"termino en portugues": "termino en español"} sin markdown.\n' +
    JSON.stringify(limpios);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
    });
    if (!r.ok) return {};
    const j = await r.json();
    let texto = ((j.content && j.content[0] && j.content[0].text) || '').trim();
    texto = texto.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    const m = texto.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  } catch (_) { return {}; }
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

export async function descubrir(token, opts) {
  const o = opts || {};
  const maxCategorias = o.maxCategorias || 6;

  const [catsAR, catsBR] = await Promise.all([categorias('MLA', token), categorias('MLB', token)]);
  if (!catsAR.length) return { error: 'MercadoLibre no devolvio las categorias' };

  let pares = emparejarCategorias(catsAR, catsBR);
  if (o.categoria) pares = pares.filter(p => p.ar.id === o.categoria);
  pares = pares.slice(0, maxCategorias);

  // Las tendencias de cada rubro, en los dos paises, en paralelo.
  const porRubro = await Promise.all(pares.map(async (par) => {
    const [ar, br] = await Promise.all([
      tendencias('MLA', par.ar.id, token),
      par.br ? tendencias('MLB', par.br.id, token) : Promise.resolve(partirTendencias([]))
    ]);
    return { par, ar, br };
  }));

  // Una sola traduccion para todos los rubros.
  const aTraducir = [];
  porRubro.forEach(r => aTraducir.push(...r.br.crecimiento));
  const traducciones = await traducirKeywords(aTraducir);

  const candidatos = [];
  for (const { par, ar, br } of porRubro) {
    const listasAR = ar.todas;

    // Lo que crece en Argentina: demanda local ya despertando.
    ar.crecimiento.forEach((kw, i) => {
      candidatos.push({
        keyword: kw,
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
  return {
    candidatos: lista,
    rubros: pares.map(p => ({ ar: p.ar.name, br: p.br ? p.br.name : null, parecido: p.parecido })),
    traducidos: Object.keys(traducciones).length
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
  if (!mla || !mla.listings) return { score: null, motivo: 'Falta medir la saturación en Argentina.' };

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

  return { score, saturacion, pelea, motivo };
}

// Saturacion real en MLA. Reusa el mismo pipeline que el analizador: mismo
// cache, mismas corridas asincronicas, mismo "preparando". No duplica nada.
export async function saturacionMLA(keyword, token) {
  const r = await buscarPublicaciones(keyword, token, { budgetMs: 6000, maxIds: 48 });
  if (!r) return null;
  if (r.pendiente) return { pendiente: true };
  const precios = (r.results || []).map(x => x.price).filter(p => typeof p === 'number' && p > 0);
  const vendedores = new Set((r.results || []).map(x => x.seller && x.seller.id).filter(Boolean));
  precios.sort((a, b) => a - b);
  return {
    fuente: r.fuente,
    listings: (typeof r.total === 'number' && r.total > 0) ? r.total : (r.results || []).length,
    totalReal: typeof r.total === 'number' && r.total > 0,
    muestra: (r.results || []).length,
    vendedores: vendedores.size,
    precioMin: precios[0] || null,
    precioMediana: precios.length ? precios[Math.floor(precios.length / 2)] : null,
    precioMax: precios[precios.length - 1] || null
  };
}
