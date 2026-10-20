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
  ['servicios', 'servicos'],
  // "Arte, Librería y Mercería" contra "Arte, Papelaria e Armarinho": la unica
  // palabra en comun es "arte", que tiene 4 letras y no cuenta como fuerte.
  ['libreria', 'papelaria'],
  ['merceria', 'armarinho']
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

// El prompt ya pedia descartar marcas y aun asi pasaron apple, Insta360, osmo
// y camara DJI: los ejemplos eran todos de alimento para mascotas y el modelo
// no generalizo a electronica. Un modelo no es un filtro confiable para algo
// binario y conocido de antemano, asi que las marcas que se repiten se filtran
// en codigo. La lista se puede ampliar sin tocar nada mas.
const MARCAS = [
  'apple', 'iphone', 'ipad', 'samsung', 'xiaomi', 'motorola', 'huawei', 'lg',
  'sony', 'jbl', 'bose', 'dji', 'osmo', 'insta360', 'gopro', 'nintendo',
  'playstation', 'xbox', 'lenovo', 'hp', 'dell', 'asus', 'acer', 'philips',
  'bosch', 'makita', 'dewalt', 'stanley', 'black+decker', 'nike', 'adidas',
  'royal canin', 'nutrique', 'militec', 'roundup', 'randap', 'tramontina',
  'stray kids', 'katseye', 'bts', 'blackpink'
];

// "camara DJI" y "photocard Stray Kids" son marcas aunque tengan otra palabra
// al lado. Se compara por palabra completa para no comer terminos legitimos:
// "lg" no debe matchear "lg" dentro de "algo".
export function esMarca(kw) {
  const t = normalizar(kw);
  if (!t) return false;
  for (const m of MARCAS) {
    const mm = normalizar(m);
    if (t === mm) return true;
    const re = new RegExp('(^|\\s)' + mm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|\\s)');
    if (re.test(t)) return true;
  }
  return false;
}

// Modelos de autos y motos. En el rubro de vehiculos, "polo" o "gol" a secas
// es el auto entero, no un producto: el modelo lo tradujo como "remera polo".
// Solo se aplica dentro de los rubros de vehiculos, porque en ropa "polo" si es
// un producto. Y solo cuando el termino es el modelo pelado (con año o version
// como mucho): "retrovisor gol" es un repuesto y tiene que seguir pasando.
const VEHICULOS = [
  'polo', 'gol', 'onix', 'hb20', 'hb20s', 'focus', 'fiesta', 'ka', 'ecosport',
  'corsa', 'celta', 'prisma', 'cruze', 'tracker', 's10', 'spin', 'cobalt',
  'palio', 'uno', 'mobi', 'argo', 'cronos', 'strada', 'toro', 'siena', 'fiorino',
  'fox', 'up', 'voyage', 'saveiro', 'virtus', 'nivus', 't cross', 'taos', 'amarok', 'vento',
  'golf', 'jetta', 'gol trend', 'suran', 'hilux', 'corolla', 'etios', 'yaris', 'sw4',
  'ranger', 'civic', 'fit', 'city', 'hr v', 'creta', 'kicks', 'versa', 'march',
  'frontier', 'sandero', 'logan', 'duster', 'kwid', 'stepway', 'clio', 'kangoo',
  'compass', 'renegade', 'commander', '208', '2008', '308', '3008', 'c3', 'c4',
  'biz', 'cg 160', 'cg 150', 'fan 160', 'titan', 'bros', 'pop 110', 'pcx', 'xre',
  'xre 300', 'cb 300', 'cb 500', 'twister', 'tornado', 'fazer', 'factor', 'lander',
  'nmax', 'xtz', 'crosser', 'ybr', 'wave', 'g310'
];
const VERSION_VEHICULO = /^(\d{1,4}|g\d|plus|sedan|hatch|gt|gti|gts|tsi|flex|turbo|usado|usada|0km|cross|highline|trendline|comfortline|ltz|lt|premier)$/;

// Marca de auto seguida de un modelo ("gwm h7", "ford f350", "chevrolet c10")
// tambien es el vehiculo. El modelo convirtio "gwm h7" en "faro H7".
const MARCAS_VEHICULO = [
  'vw', 'volkswagen', 'ford', 'chevrolet', 'fiat', 'toyota', 'renault', 'peugeot',
  'citroen', 'nissan', 'honda', 'hyundai', 'kia', 'jeep', 'gwm', 'haval', 'byd',
  'chery', 'caoa chery', 'jac', 'bmw', 'mercedes', 'mercedes benz', 'audi', 'volvo',
  'mitsubishi', 'suzuki', 'yamaha', 'kawasaki', 'ram', 'iveco', 'ika', 'lotus'
];
// Si el termino nombra una pieza, es un repuesto y no el vehiculo.
const PIEZA = /\b(farol|faro|lampada|lampara|retrovisor|parachoque|para choque|capa|funda|tapete|alfombra|kit|filtro|pastilha|pastilla|bateria|pneu|neumatico|radio|central|modulo)\b/;

function esRubroVehiculos(rubro) {
  return /\b(carros|autos|motos|veiculos|vehiculos)\b/.test(normalizar(rubro));
}

export function esModeloVehiculo(kw, rubro) {
  if (!esRubroVehiculos(rubro)) return false;
  const t = normalizar(kw);
  if (!t) return false;
  if (PIEZA.test(t)) return false;
  // Marca + hasta 3 palabras: es el auto ("ford f350", "honda wr v vermelho").
  for (const mv of MARCAS_VEHICULO) {
    const mm = normalizar(mv);
    if (t === mm) return true;
    if (t.startsWith(mm + ' ') && t.slice(mm.length + 1).split(' ').filter(Boolean).length <= 3) return true;
  }
  for (const m of VEHICULOS) {
    const mm = normalizar(m);
    if (t === mm) return true;
    if (t.startsWith(mm + ' ')) {
      const resto = t.slice(mm.length + 1).split(' ').filter(Boolean);
      if (resto.length && resto.every(w => VERSION_VEHICULO.test(w))) return true;
    }
  }
  return false;
}

// Genericos conocidos, filtrados en codigo por el mismo motivo que las marcas:
// el prompt los da como ejemplo y aun asi el modelo convirtio "halloween" en
// "disfraz halloween" y lo dejo pasar. Se compara el termino original entero.
const GENERICOS = [
  'pa', 'pá', 'spray', 'retrovisor', 'fundas', 'bebe', 'bebes', 'cosas de bebe',
  'cosas para bebe', 'cosas para bebes', 'halloween', 'expositor', 'embalagem', 'ofertas'
].map(normalizar);

export function esGenericoConocido(kw) {
  return GENERICOS.includes(normalizar(kw));
}

// Cada termino viaja con su rubro. Sin contexto, "pa" en Accesorios para
// Vehiculos salio "pala" y "polo" en Autos salio "remera polo". La respuesta
// va por "id" y no por termino: el mismo termino puede venir de dos rubros en
// el mismo lote ("bomba de agua" en Agro de los dos paises) y con el termino
// como clave una respuesta pisaria a la otra.
async function clasificarLote(items) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada');
  const prompt =
    'Sos analista de importaciones China->Argentina. Te paso terminos de busqueda ' +
    'de MercadoLibre (algunos en portugues de Brasil, otros en español), cada uno con ' +
    'el rubro de MercadoLibre donde aparecio: [{"id": 0, "t": "termino", "rubro": "rubro"}].\n' +
    'Usá el rubro para desambiguar: "polo" en un rubro de autos es el VW Polo, no una remera; ' +
    '"pa" en accesorios para vehiculos es una abreviatura, no una pala.\n' +
    'Para cada uno devolve:\n' +
    '- "es": el nombre de PRODUCTO con el que un argentino lo buscaria en MercadoLibre ' +
    'Argentina, en español rioplatense. Nunca lo dejes en portugues ni lo traduzcas palabra ' +
    'por palabra: "pipoqueira" -> "maquina de pochoclos", "caixa transporte gato" -> ' +
    '"transportadora para gatos", "coleira peitoral" -> "pretal para perro", "tapete ' +
    'emborrachado infantil" -> "alfombra de goma eva infantil", "misturador de racao" -> ' +
    '"mezcladora de alimento balanceado", "brinquedo 1 ano menino" -> "juguete para nene de ' +
    '1 año" (sin palabras que sobren). Si la palabra sola no alcanza para buscarlo, ' +
    'agregale la que lo hace buscable: "wallbox" -> "cargador wallbox", "h7" en accesorios ' +
    'para vehiculos -> "lámpara H7". Nunca agregues un ' +
    'producto que el termino no nombra: "gwm h7" es una camioneta, no un faro. Si ya está ' +
    'en español y ya es un producto concreto, repetilo igual. En minuscula, salvo siglas y ' +
    'codigos (H4, H7, USB, LED).\n' +
    '- "generico": true SOLO si el termino no identifica un producto concreto: una palabra ' +
    'suelta o una categoria entera (pa, spray, retrovisor, fundas, bebes, cosas de bebé, ' +
    'halloween, embalagem, expositor, accesorios para auto). Un nombre de producto de 2 o mas ' +
    'palabras que se puede vender tal cual NO es generico: "aromatizador de ambiente" y ' +
    '"kit vinho" (kit de vino / accesorios de vino) son productos y quedan con generico false, ' +
    'igual que "compresor de aire portatil", "bebedero para gatos" o "lampara H4". Un producto ' +
    'que se importa tal cual tampoco es generico aunque sea una sola palabra: "guantes" es un ' +
    'producto (generico false); si aparecio en un rubro que no le corresponde, marcalo con ' +
    'fuera_rubro.\n' +
    '- "imp": true si es un producto fisico que un importador chico podria traer de ' +
    'China y revender; false si es un alimento fresco o commodity (leche, carne, cafe), ' +
    'una MARCA o un modelo de una marca (apple, iphone, dji, osmo, insta360, gopro, ' +
    'xiaomi, royal canin, nutrique, militec, tramontina) o mercaderia de un artista ' +
    '(photocard stray kids), un servicio, un vehiculo completo o un MODELO de auto o moto ' +
    '(polo, gol, onix, hb20, focus, cg 160), un inmueble, o algo demasiado pesado o ' +
    'voluminoso para importar en poco volumen. Que sea generico no cambia "imp": se marca aparte.\n' +
    '- "fuera_rubro": true si el termino no tiene relacion con el rubro donde aparecio ' +
    '(halloween en Alimentos y Bebidas, guantes en Antigüedades y Colecciones); false si ' +
    'pertenece a ese rubro.\n' +
    'Responde SOLO un JSON {"<id>": {"es": "...", "imp": true, "generico": false, "fuera_rubro": false}} ' +
    'con una entrada por cada id, sin markdown.\n' +
    JSON.stringify(items);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: anthropicHeaders(),
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        // Sin azar: la respuesta se guarda en cache, y una que salio mal por
        // casualidad quedaria fija. Con temperature 0 el mismo termino da
        // siempre lo mismo.
        temperature: 0,
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

// Traducir y clasificar es lo único caro y lento del barrido, y se repetia
// entero cada vez: "farol de milha" se traduce igual hoy que la semana que
// viene. Guardadas, un segundo barrido de los mismos rubros no le pregunta
// nada a Claude, y eso es lo que permite mirar muchas más categorías.
// Se lee en tandas de 100: antes se cortaba en 400 claves, y con un barrido de
// 32 rubros (y claves mas largas, con la categoria adentro) lo que quedaba
// afuera se le volvia a preguntar a Claude en cada busqueda.
async function clasificacionesGuardadas(keywords) {
  try {
    const { url, key, ok } = supa();
    if (!ok || !keywords.length) return {};
    const tandas = [];
    for (let i = 0; i < keywords.length; i += 100) tandas.push(keywords.slice(i, i + 100));
    const mapa = {};
    await Promise.all(tandas.map(async (tanda) => {
      const enLista = tanda.map(k => '"' + String(k).replace(/"/g, '') + '"').join(',');
      const r = await fetch(url + '/rest/v1/keywords_clasificadas?keyword=in.(' +
        encodeURIComponent(enLista) + ')&select=keyword,es,importable,motivo',
        { headers: { apikey: key, Authorization: 'Bearer ' + key } });
      if (!r.ok) return;
      const filas = await r.json();
      for (const f of (Array.isArray(filas) ? filas : [])) {
        mapa[f.keyword] = { es: f.es, imp: f.importable, motivo: f.motivo };
      }
    }));
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

// Version de la clasificacion del Radar. v1 se hizo sin rubro y quedo mal
// ("pa" -> "pala"); v2 tenia rubro pero la clave era solo el termino, asi que
// "polo" en Ropa y en Autos compartian clasificacion. v3 lleva la categoria en
// la clave. v4 es el mismo formato que v3: el prompt de v3 dejaba terminos en
// portugues ("pipoqueira") e inventaba productos ("gwm h7" -> "faro H7"). v5
// es el primero con temperature 0: lo de v4 salio con azar y no se reusa. Lo
// anterior queda en la tabla y se ignora. Para corregir un termino suelto sin
// subir de version esta reclasificarTermino() (?reclasificar= en market.js). Si cambia el prompt de
// nuevo, subir el numero.
const VERSION_CLASIF = 'v5|';
export function claveClasificacion(cat, término) {
  return VERSION_CLASIF + String(cat || '') + '|' + String(término || '');
}

// "Juguete Para Niño 1 Año" y "juguete para niño 1 año" son el mismo termino
// y se tienen que ver igual. Se pasa a minuscula salvo siglas y codigos: lo que
// el modelo ya escribio en mayuscula (USB, LED, GPS) y lo que mezcla letras con
// numeros (h4 -> H4, 12v -> 12V).
export function normalizarEs(es) {
  if (es == null) return es;
  return String(es).trim().split(/\s+/).map(w => {
    const letras = w.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (/[0-9]/.test(w) && letras) return w.toUpperCase();
    if (letras.length >= 2 && letras.length <= 5 && letras === letras.toUpperCase() && letras !== letras.toLowerCase()) return w;
    return w.toLowerCase();
  }).join(' ');
}

// Generico y fuera de rubro se guardan en "motivo" para no tocar el esquema.
function motivoDe(v) {
  return [v.generico ? 'generico' : null, v.fueraRubro ? 'fuera_rubro' : null].filter(Boolean).join(',') || null;
}

function desdeModelo(v) {
  return {
    es: normalizarEs(v.es),
    imp: v.imp !== false,
    generico: v.generico === true,
    fueraRubro: v.fuera_rubro === true
  };
}

// Recibe [{t, rubro, cat}]. Devuelve un mapa por claveClasificacion(cat, t):
// el mismo termino en dos rubros son dos clasificaciones distintas.
export async function clasificarKeywords(entrada) {
  const porClave = {};
  for (const x of (entrada || [])) {
    if (!x || !x.t) continue;
    const k = claveClasificacion(x.cat, x.t);
    if (!porClave[k]) porClave[k] = { t: x.t, rubro: x.rubro || '' };
  }
  const claves = Object.keys(porClave);
  if (!claves.length) return { mapa: {}, error: null };

  const enCache = await clasificacionesGuardadas(claves);
  const guardadas = {};
  for (const k of claves) {
    const g = enCache[k];
    if (!g) continue;
    const motivo = String(g.motivo || '');
    guardadas[k] = { es: g.es, imp: g.imp, generico: motivo.includes('generico'), fueraRubro: motivo.includes('fuera_rubro') };
  }
  const faltan = claves.filter(k => !guardadas[k]);
  if (!faltan.length) return { mapa: guardadas, error: null, desdeCache: claves.length, preguntadas: 0 };

  const lotes = [];
  for (let i = 0; i < faltan.length; i += LOTE) lotes.push(faltan.slice(i, i + LOTE));

  const resultados = await Promise.all(lotes.map(async (lote) => {
    const items = lote.map((k, id) => ({ id, t: porClave[k].t, rubro: porClave[k].rubro }));
    try { return { ok: true, lote, mapa: await clasificarLote(items) }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 120) }; }
  }));

  const nuevas = {};
  const errores = [];
  for (const r of resultados) {
    if (!r.ok) { errores.push(r.error); continue; }
    // Solo se aceptan ids que se preguntaron: si el modelo inventa uno, no
    // tiene que entrar al cache.
    r.lote.forEach((k, id) => {
      const v = r.mapa && r.mapa[String(id)];
      if (!v || typeof v !== 'object') return;
      nuevas[k] = desdeModelo(v);
    });
  }
  const paraGuardar = {};
  Object.keys(nuevas).forEach(k => {
    paraGuardar[k] = Object.assign({}, nuevas[k], { motivo: motivoDe(nuevas[k]) });
  });
  await guardarClasificaciones(paraGuardar);

  // El error se devuelve para que se vea en la respuesta del endpoint, en vez
  // de quedar como un "traducidos: 0" sin explicacion.
  return {
    mapa: Object.assign({}, guardadas, nuevas),
    error: errores.length ? errores[0] + (errores.length > 1 ? ' (x' + errores.length + ')' : '') : null,
    desdeCache: Object.keys(guardadas).length,
    preguntadas: faltan.length
  };
}

// Corrige UN termino sin subir de version: lo vuelve a preguntar y pisa su
// fila en el cache. Para cuando una traduccion puntual salio mal y no vale la
// pena retraducir todo. El rubro sale de la categoria, igual que en el barrido.
export async function reclasificarTermino(término, cat, token) {
  const t = String(término || '').trim().slice(0, 140);
  const id = String(cat || '').trim();
  if (!t) return { error: 'falta el termino' };
  if (!/^ML[AB]\d{3,}$/.test(id)) return { error: 'categoria invalida: va el id, ej. MLB1743 o MLA1368' };

  const r = await fetchJson(MELI_API + '/categories/' + id, token, 5000);
  if (!r || !r.ok || !r.json || !r.json.name) return { error: 'MercadoLibre no devolvio la categoria ' + id };
  // Las tendencias son por categoria de primer nivel: el rubro es la raiz.
  const camino = Array.isArray(r.json.path_from_root) ? r.json.path_from_root : [];
  const rubro = camino.length ? camino[0].name : r.json.name;

  const clave = claveClasificacion(id, t);
  const previa = (await clasificacionesGuardadas([clave]))[clave] || null;
  const respuesta = await clasificarLote([{ id: 0, t, rubro }]);
  const v = respuesta && respuesta['0'];
  if (!v || typeof v !== 'object') return { error: 'el modelo no devolvio la clasificacion' };
  const nueva = desdeModelo(v);
  await guardarClasificaciones({ [clave]: Object.assign({}, nueva, { motivo: motivoDe(nueva) }) });

  return {
    clave, rubro,
    antes: previa ? { es: previa.es, imp: previa.imp, motivo: previa.motivo } : null,
    ahora: Object.assign({}, nueva, { descartado_en_codigo: esGenericoConocido(t) ? 'generico' :
      (esModeloVehiculo(t, rubro) ? 'vehiculo' : (esMarca(nueva.es || t) ? 'marca' : null)) })
  };
}

// Un producto de TikTok se llama "Magcubic HY300Pro Projector 290ANSI Android
// 14 Dual WiFi6 8K 4K Decode Auto Keystone". Con eso no se puede preguntar
// nada en MercadoLibre Argentina: hay que reducirlo al producto generico, en
// español, como se lo busca acá ("mini proyector"). Se cachea igual que las
// traducciones, porque el mismo título se repite entre consultas.
export async function nombrarProductos(títulos) {
  const limpios = [...new Set((títulos || []).filter(Boolean).map(t => String(t).slice(0, 140)))];
  if (!limpios.length) return {};

  const guardadas = await clasificacionesGuardadas(limpios);
  const mapa = {};
  Object.keys(guardadas).forEach(k => { if (guardadas[k].es) mapa[k] = guardadas[k].es; });
  const faltan = limpios.filter(k => !mapa[k]);
  if (!faltan.length) return mapa;

  const lotes = [];
  for (let i = 0; i < faltan.length; i += LOTE) lotes.push(faltan.slice(i, i + LOTE));

  const resultados = await Promise.all(lotes.map(async (lote) => {
    try {
      const prompt =
        'Te paso títulos de productos de TikTok Shop, en inglés y llenos de ' +
        'especificaciones y marcas.\n' +
        'Para cada uno devolve el PRODUCTO GENERICO en español rioplatense, con el ' +
        'nombre con el que se lo buscaria en MercadoLibre Argentina: 2 a 4 palabras, ' +
        'sin marca, sin modelo, sin números de especificacion.\n' +
        'Ejemplo: "Magcubic HY300Pro Projector 290ANSI Android 14 Dual WiFi6" -> "mini proyector".\n' +
        'Responde SOLO un JSON {"título original": "termino corto"} sin markdown.\n' +
        JSON.stringify(lote);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25000);
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ctrl.signal, headers: anthropicHeaders(),
          body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 2000, temperature: 0,
            messages: [{ role: 'user', content: prompt }] })
        });
        const texto = await r.text();
        if (!r.ok) throw new Error('Anthropic HTTP ' + r.status + ': ' + texto.slice(0, 150));
        const j = JSON.parse(texto);
        const salida = ((j.content || [])[0] || {}).text || '{}';
        return JSON.parse(salida.replace(/^```(json)?|```$/g, '').trim());
      } finally { clearTimeout(t); }
    } catch (_) { return {}; }
  }));

  const nuevos = {};
  for (const r of resultados) Object.assign(nuevos, r);
  // Se guardan como "no importable" a proposito: son titulos, no keywords de
  // busqueda, y no deben aparecer como candidatos por su cuenta.
  const paraGuardar = {};
  Object.keys(nuevos).forEach(k => { paraGuardar[k] = { es: nuevos[k], imp: false, motivo: 'título de tiktok' }; });
  await guardarClasificaciones(paraGuardar);

  return Object.assign(mapa, nuevos);
}

// Igual que nombrarProductos, pero para otros idiomas y con clave de cache
// propia. IMPORTANTE: la tabla keywords_clasificadas tiene UNA sola columna
// "es", que el Radar usa para el termino castellano. Guardar aca la version en
// portugues bajo la misma clave pisaria ese dato. Por eso la clave lleva
// prefijo de idioma ("pt-BR::mini proyector") y nunca colisiona con la del
// Radar.
const IDIOMAS = {
  'pt-BR': { nombre: 'portugues de Brasil', tienda: 'MercadoLivre Brasil', ejemplo: '"mini proyector" -> "mini projetor"' },
  'es-MX': { nombre: 'español de Mexico',   tienda: 'MercadoLibre Mexico',  ejemplo: '"mini proyector" -> "mini proyector"' }
};

// La clave del cache se arma en UN solo lugar. Antes el read y el write
// repetian la expresion "idioma + '::' + termino" en cuatro puntos distintos:
// si uno solo se desincroniza, el cache no pega nunca (y se paga Haiku en cada
// consulta) o, peor, se lee la entrada castellana creyendo que es la
// portuguesa. Con una sola funcion eso no puede pasar.
export function claveTraduccion(idioma, término) {
  return idioma + '::' + String(término || '').slice(0, 140);
}
export function claveProgresivos(término) {
  return 'progresivo::' + String(término || '').trim().slice(0, 140);
}

export async function traducirTerminos(términos, idioma) {
  const cfg = IDIOMAS[idioma];
  if (!cfg) throw new Error('idioma no soportado: ' + idioma);
  const limpios = [...new Set((términos || []).filter(Boolean).map(t => String(t).slice(0, 140)))];
  if (!limpios.length) return {};

  const claves = limpios.map(t => claveTraduccion(idioma, t));
  const guardadas = await clasificacionesGuardadas(claves);
  const mapa = {};
  limpios.forEach(t => {
    const g = guardadas[claveTraduccion(idioma, t)];
    if (g && g.es) mapa[t] = g.es;
  });
  const faltan = limpios.filter(t => !mapa[t]);
  if (!faltan.length) return mapa;

  const lotes = [];
  for (let i = 0; i < faltan.length; i += LOTE) lotes.push(faltan.slice(i, i + LOTE));

  const resultados = await Promise.all(lotes.map(async (lote) => {
    try {
      const prompt =
        'Te paso terminos de busqueda de producto en español rioplatense.\n' +
        'Para cada uno devolve como se busca ESE MISMO producto en ' + cfg.tienda +
        ', en ' + cfg.nombre + ': 2 a 4 palabras, sin marca, sin modelo.\n' +
        'Ejemplo: ' + cfg.ejemplo + '.\n' +
        'Si el producto no tiene un nombre corriente en ese mercado, devolve igual la traduccion literal mas usable.\n' +
        'Responde SOLO un JSON {"termino original": "termino traducido"} sin markdown.\n' +
        JSON.stringify(lote);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25000);
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ctrl.signal, headers: anthropicHeaders(),
          body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1200, temperature: 0,
            messages: [{ role: 'user', content: prompt }] })
        });
        const texto = await r.text();
        if (!r.ok) throw new Error('Anthropic HTTP ' + r.status + ': ' + texto.slice(0, 150));
        const j = JSON.parse(texto);
        const salida = ((j.content || [])[0] || {}).text || '{}';
        return JSON.parse(salida.replace(/^```(json)?|```$/g, '').trim());
      } finally { clearTimeout(t); }
    } catch (_) { return {}; }
  }));

  const nuevos = {};
  for (const r of resultados) Object.assign(nuevos, r);
  const paraGuardar = {};
  Object.keys(nuevos).forEach(k => {
    paraGuardar[claveTraduccion(idioma, k)] = { es: nuevos[k], imp: false, motivo: 'traduccion ' + idioma };
  });
  await guardarClasificaciones(paraGuardar);

  return Object.assign(mapa, nuevos);
}

// De lo especifico a lo generico. Cuando un producto no existe en MercadoLibre
// Argentina, la pregunta util no es "que otro producto se le parece" sino "en
// que categoria caeria". Se busca hacia ARRIBA:
//   "organizador de cables magnetico de silicona"
//     -> organizador de cables magnetico
//     -> organizador de cables
//     -> organizador escritorio
// Misma cache que las traducciones, con su propio prefijo.
export async function terminosProgresivos(término) {
  const base = String(término || '').trim().slice(0, 140);
  if (!base) return [];
  const clave = claveProgresivos(base);

  const guardadas = await clasificacionesGuardadas([clave]);
  if (guardadas[clave] && guardadas[clave].es) {
    try {
      const arr = JSON.parse(guardadas[clave].es);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (_) { /* si el cache quedo con basura, se vuelve a preguntar */ }
  }

  try {
    const prompt =
      'Te paso un termino de producto en español rioplatense: "' + base + '".\n' +
      'Devolve 3 terminos de busqueda para MercadoLibre Argentina, ordenados de MAS ESPECIFICO a MAS GENERICO. ' +
      'Cada uno tiene que ser una categoria mas amplia que el anterior, no un sinonimo ni un producto distinto.\n' +
      'Ejemplo: "organizador de cables magnetico de silicona" -> ["organizador de cables magnetico", "organizador de cables", "organizador escritorio"].\n' +
      'Sin marcas, sin modelos, 2 a 4 palabras cada uno.\n' +
      'Responde SOLO un JSON array de 3 strings, sin markdown.';
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    let arr;
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctrl.signal, headers: anthropicHeaders(),
        body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 400, temperature: 0,
          messages: [{ role: 'user', content: prompt }] })
      });
      const texto = await r.text();
      if (!r.ok) throw new Error('Anthropic HTTP ' + r.status + ': ' + texto.slice(0, 150));
      const j = JSON.parse(texto);
      const salida = ((j.content || [])[0] || {}).text || '[]';
      arr = JSON.parse(salida.replace(/^```(json)?|```$/g, '').trim());
    } finally { clearTimeout(t); }

    if (!Array.isArray(arr)) return [];
    const limpios = arr.map(x => String(x || '').trim().toLowerCase()).filter(Boolean).slice(0, 3);
    if (!limpios.length) return [];
    await guardarClasificaciones({ [clave]: { es: JSON.stringify(limpios), imp: false, motivo: 'terminos progresivos' } });
    return limpios;
  } catch (e) {
    console.warn('[terminosProgresivos] ' + String((e && e.message) || e).slice(0, 140));
    return [];
  }
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
  if (!catsAR.length) return { error: 'MercadoLibre no devolvio las categorías' };

  let pares = emparejarCategorias(catsAR, catsBR);
  const disponibles = pares.length;
  if (o.categoria) pares = pares.filter(p => p.ar.id === o.categoria);
  pares = pares.slice(0, maxCategorias);
  const pedidos = pares.length;

  const porRubro = await tendenciasPorRubro(pares, token, o.presupuestoMs);
  const barridos = porRubro.length;

  // Una sola clasificacion para todos los rubros: traduce los brasileños y
  // marca cuales sirven para importar, de los dos paises.
  // Cada keyword viaja con el rubro donde aparecio (el brasileño para las de
  // Brasil, el argentino para las de aca) y se clasifica por categoria: "polo"
  // en Carros es un auto y en Ropa una remera, y no comparten resultado.
  const entradas = [];
  porRubro.forEach(r => {
    const rubroBR = r.par.br ? r.par.br.name : r.par.ar.name;
    const catBR = r.par.br ? r.par.br.id : r.par.ar.id;
    r.br.crecimiento.forEach(t => entradas.push({ t, rubro: rubroBR, cat: catBR }));
    r.ar.crecimiento.forEach(t => entradas.push({ t, rubro: r.par.ar.name, cat: r.par.ar.id }));
  });
  entradas.forEach(e => { e.k = claveClasificacion(e.cat, e.t); });
  const clasif = await clasificarKeywords(entradas);
  const info = clasif.mapa;
  const de = (e) => info[e.k];

  // Antes, una keyword sin clasificar contaba como importable. Cuando Anthropic
  // devolvia 503 en un lote, esas pasaban sin traducir y aparecian en portugues
  // como si estuvieran vetadas. No saber no es lo mismo que estar bien: se
  // descartan y se informa cuantas, para que el hueco se vea.
  // Un termino generico ("spray", "expositor") no identifica un producto: se
  // descarta y se cuenta junto con los no importables. Los modelos de auto se
  // filtran en codigo, como las marcas, porque el modelo no siempre los ve.
  // Fuera de rubro NO descarta: por ahora solo se marca en la tarjeta.
  const generico = (e) => !!de(e) && (de(e).generico === true || esGenericoConocido(e.t));
  const vehiculo = (e) => esModeloVehiculo(e.t, e.rubro);
  const marca = (e) => !!de(e) && esMarca(de(e).es || e.t);
  const importable = (e) => !!de(e) && de(e).imp !== false && !generico(e) && !vehiculo(e) && !marca(e);
  const sinClasificar = entradas.filter(e => !de(e)).length;
  const marcasFiltradas = entradas.filter(marca).length;

  const candidatos = [];
  for (const { par, ar, br } of porRubro) {
    const listasAR = ar.todas;
    const catBR = par.br ? par.br.id : par.ar.id;
    const rubroBR = par.br ? par.br.name : par.ar.name;

    // Lo que crece en Argentina: demanda local ya despertando.
    ar.crecimiento.forEach((kw, i) => {
      const e = { t: kw, rubro: par.ar.name, k: claveClasificacion(par.ar.id, kw) };
      if (!importable(e)) return;
      candidatos.push({
        keyword: de(e).es || kw,
        origen: 'AR',
        categoria: par.ar.id,
        categoriaNombre: par.ar.name,
        posicionAR: i + 1,
        posicionBR: null,
        traducidoDe: null,
        fueraRubro: de(e).fueraRubro === true,
        senal: 'Está creciendo en las búsquedas de MercadoLibre Argentina esta semana.'
      });
    });

    // Lo que crece en Brasil. Lo valioso es lo que todavia no aparece aca.
    br.crecimiento.forEach((kw, i) => {
      const e = { t: kw, rubro: rubroBR, k: claveClasificacion(catBR, kw) };
      if (!importable(e)) return;
      const es = de(e).es || null;
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
        fueraRubro: de(e).fueraRubro === true,
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
      traducidoDe: previo.traducidoDe || c.traducidoDe,
      // Si en alguno de los dos lados pertenece al rubro, no se marca.
      fueraRubro: previo.fueraRubro && c.fueraRubro,
      origen: (previo.posicionAR || c.posicionAR) && (previo.posicionBR || c.posicionBR) ? 'ambos' : previo.origen,
      senal: (previo.posicionAR || c.posicionAR) && (previo.posicionBR || c.posicionBR)
        ? 'Crece en Brasil y en Argentina a la vez: demanda confirmada en los dos mercados.'
        : previo.senal
    });
  }

  const lista = [...porClave.values()].map(c => ({ ...c, scoreDemanda: scoreDemanda(c) }));
  lista.sort((a, b) => b.scoreDemanda - a.scoreDemanda);
  const descartados = entradas.filter(e => de(e) && !importable(e));
  const genericos = entradas.filter(generico);
  const vehiculos = entradas.filter(e => de(e) && vehiculo(e));
  return {
    candidatos: lista,
    rubros: porRubro.map(r => ({ ar: r.par.ar.name, br: r.par.br ? r.par.br.name : null, parecido: r.par.parecido, via: r.par.via })),
    // Cuantos rubros se miraron de verdad, contra los que hay. Si el
    // presupuesto de tiempo corto el barrido, se ve en estos numeros.
    sin_clasificar: sinClasificar,
    marcas_filtradas: marcasFiltradas,
    rubros_barridos: barridos,
    rubros_pedidos: pedidos,
    rubros_disponibles: disponibles,
    // Cuantas busquedas en tendencia devolvio MercadoLibre. Con 0 candidatos,
    // es lo que distingue "vino vacio" de "vino todo y se descarto".
    tendenciasVistas: entradas.length,
    clasificacion_desde_cache: clasif.desdeCache || 0,
    clasificacion_preguntadas: clasif.preguntadas || 0,
    clasificados: Object.keys(info).length,
    descartadosNoImportables: descartados.length,
    ejemploDescartado: descartados.slice(0, 5).map(e => e.t),
    descartadosGenericos: genericos.length,
    ejemploGenerico: [...new Set(genericos.map(e => e.t))].slice(0, 8),
    descartadosVehiculos: vehiculos.length,
    fueraRubro: lista.filter(c => c.fueraRubro).length,
    // Solo con ?detalle=1: cada termino, su rubro y como quedo clasificado,
    // para poder revisar las traducciones sin abrir Supabase.
    clasificaciones: o.detalle ? entradas.filter((e, i) => entradas.findIndex(x => x.k === e.k) === i).map(e => ({
      original: e.t, rubro: e.rubro, cat: e.cat,
      es: de(e) ? de(e).es : null,
      imp: de(e) ? de(e).imp !== false : null,
      generico: generico(e), vehiculo: vehiculo(e), marca: marca(e),
      fuera_rubro: !!de(e) && de(e).fueraRubro === true
    })) : undefined,
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
  // hacia decir "solo 39 publicaciones: el mercado está casi vacio" cuando en
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

export async function saturacionMLA(keyword, token, opts) {
  const o = opts || {};
  // puedeGastar habilita la via paga. Lo decide quien llama: aca no se sabe si
  // hay sesion. Por defecto NO se gasta.
  const r = await buscarPublicaciones(keyword, token, {
    budgetMs: 6000, maxIds: 48,
    puedeGastar: !!o.puedeGastar, origen: o.origen || 'radar:saturacion'
  });
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
