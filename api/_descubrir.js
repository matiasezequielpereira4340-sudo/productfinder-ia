// api/_descubrir.js
// Descubrimiento de productos nuevos para el Buscador de oportunidades.
//
// Por que existe: el pool del buscador era el CATALOGO fijo de 12 productos
// por rubro (api/analyze.js) y llevaba meses sin cambiar: el usuario veia
// siempre lo mismo. Ahora, una vez por semana por rubro, se toman las
// busquedas en tendencia de MercadoLibre (/trends/MLA/{categoria}) de las
// categorias del rubro, se descartan marcas, lo que ya esta en el pool y lo
// que no se importa de China, y con lo que queda la API de Anthropic arma la
// ficha (nombre, q, keyword_en, volumen, costo FOB, peso, nota) en JSON
// estricto. Cada campo se valida aca: si uno no pasa, el candidato se
// descarta entero. Maximo 6 nuevos por rubro por semana.
//
// Los descubiertos viven en Supabase (buscador_descubiertos). Al analizar un
// rubro se suman a los 12 fijos; los que despues de 2 analisis siguen sin
// datos o con veredicto "No conviene" se desactivan solos.
//
// Este archivo NO es un endpoint (api/ ya tiene 12 funciones, el tope del plan
// Hobby): lo usa api/analyze.js.

import { anthropicHeaders } from './_meli.js';
import { esMarca, esModeloVehiculo } from './_radar.js';
import { categoriaDe } from './_categorias.js';
import { datosCategoria } from './_precalculo.js';

export const MAX_NUEVOS_POR_SEMANA = 6;
export const DIAS_ENTRE_DESCUBRIMIENTOS = 7;
export const DIAS_NUEVO = 14;          // badge "NUEVO" en la tarjeta
export const DIAS_PRIORIDAD = 30;      // descubiertos recientes van primero
export const TOPE_POR_CONSULTA = 20;   // fijos + descubiertos, por tiempo de Vercel
export const FALLOS_PARA_DESACTIVAR = 2;
const MAX_CANDIDATOS_IA = 14;          // lo que se le manda al modelo por corrida
const MODELO = () => process.env.BUSCADOR_DESCUBRIR_MODELO || 'claude-opus-5-5';

function supa() {
  return { url: process.env.SUPABASE_URL || 'https://qglieqpcmmffgxijbysb.supabase.co', key: process.env.SUPABASE_SERVICE_KEY || '' };
}
function cab(extra) { const { key } = supa(); return Object.assign({ apikey: key, Authorization: 'Bearer ' + key }, extra || {}); }

// ------------------------------------------------------------
// Normalizacion y duplicados
// ------------------------------------------------------------
const IGNORAR = new Set(['de', 'para', 'con', 'set', 'pack', 'mini', 'y', 'la', 'el', 'en', 'sin', 'los', 'las', 'del', 'por', 'x', 'a', 'al', 'un', 'una', 'kit', 'tipo']);
export function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function raiz(w) { return w.length > 4 ? w.replace(/(es|s)$/, '') : w; }
export function tokens(t) { return Array.from(new Set(norm(t).split(' ').filter(w => w.length > 1 && !IGNORAR.has(w)).map(raiz))); }

// Dos textos son "el mismo producto" si las palabras significativas de uno
// estan todas en el otro (con 2 o mas palabras), o si son iguales.
export function mismoProducto(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return false;
  if (A.join(' ') === B.join(' ')) return true;
  const [chico, grande] = A.length <= B.length ? [A, new Set(B)] : [B, new Set(A)];
  return chico.length >= 2 && chico.every(w => grande.has(w));
}

// Lo que no se importa de China para revender: servicios, alimentos y
// bebidas, usados, vehiculos, inmuebles, digital. Es un primer filtro barato;
// el modelo tambien marca "importable" y se descarta lo que diga que no.
const NO_IMPORTABLE = [
  /\b(servicio|service|alquiler|arriendo|turno|curso|clase|clases|reparacion|mantenimiento|seguro|envio gratis)\b/,
  /\b(usad[oa]s?|seminuev[oa]s?|reacondicionad[oa]s?|segunda mano|0 ?km)\b/,
  /\b(alimento|alimentos|comestible|yerba|cafe|vino|vinos|cerveza|fernet|whisky|carne|leche|queso|galletitas?|chocolate|golosinas?|suplemento|proteina|whey|creatina|medicamento|remedio|vitaminas?)\b/,
  /\b(departamento|casa en|terreno|lote|inmueble|monoambiente)\b/,
  /\b(gift ?card|tarjeta de regalo|suscripcion|licencia|software|ebook|digital)\b/,
  /^(autos?|motos?|camionetas?|camion(es)?|cuatriciclos?|lanchas?|tractor(es)?|utilitarios?)( (nuevo|nueva|usado|usada|\d{4}))?$/
];
export function esNoImportable(kw, rubro) {
  const t = norm(kw);
  if (!t) return true;
  if (NO_IMPORTABLE.some(r => r.test(t))) return true;
  try { if (esModeloVehiculo(kw, rubro)) return true; } catch (e) {}
  return false;
}

// ------------------------------------------------------------
// Validacion de la ficha que devuelve el modelo
// ------------------------------------------------------------
// Rangos razonables para un producto que se importa por maritimo consolidado
// y se vende en MercadoLibre. Fuera de rango = el modelo invento: se descarta.
const num = v => typeof v === 'number' && isFinite(v);
export function validarFicha(f, rubro) {
  if (!f || typeof f !== 'object') return { ok: false, motivo: 'sin ficha' };
  if (f.importable !== true) return { ok: false, motivo: 'no importable: ' + String(f.motivo || '').slice(0, 80) };
  const nombre = String(f.nombre || '').trim();
  const q = norm(f.q);
  const en = String(f.keyword_en || '').trim().toLowerCase();
  const nota = String(f.nota || '').trim();
  if (nombre.length < 5 || nombre.length > 90) return { ok: false, motivo: 'nombre fuera de rango' };
  const palabrasQ = q.split(' ').filter(Boolean);
  if (palabrasQ.length < 2 || palabrasQ.length > 7 || q.length > 70) return { ok: false, motivo: 'q fuera de rango' };
  if (!/^[a-z0-9 .\-/]{3,80}$/.test(en) || en.split(' ').length < 2) return { ok: false, motivo: 'keyword_en invalida' };
  if (nota.length < 3 || nota.length > 60) return { ok: false, motivo: 'nota fuera de rango' };
  if (!num(f.volCm3) || f.volCm3 < 10 || f.volCm3 > 60000) return { ok: false, motivo: 'volCm3 fuera de rango' };
  if (!num(f.pesoG) || f.pesoG < 5 || f.pesoG > 15000) return { ok: false, motivo: 'pesoG fuera de rango' };
  if (f.pesoG / f.volCm3 > 8) return { ok: false, motivo: 'densidad imposible' };
  if (!num(f.costoMin) || !num(f.costoMax) || f.costoMin < 0.05 || f.costoMax > 400 || f.costoMax < f.costoMin || f.costoMax > f.costoMin * 6)
    return { ok: false, motivo: 'costo FOB fuera de rango' };
  if (esMarca(nombre) || esMarca(q)) return { ok: false, motivo: 'marca o licencia' };
  if (esNoImportable(q, rubro)) return { ok: false, motivo: 'no importable (filtro)' };
  return { ok: true, ficha: {
    nombre, q, keyword_en: en, nota,
    volCm3: Math.round(f.volCm3), pesoG: Math.round(f.pesoG),
    costoMin: Math.round(f.costoMin * 100) / 100, costoMax: Math.round(f.costoMax * 100) / 100
  } };
}

// ------------------------------------------------------------
// Supabase
// ------------------------------------------------------------
export async function leerDescubiertos(nicho, opts) {
  const o = opts || {};
  const { url, key } = supa();
  if (!key) return [];
  try {
    const r = await fetch(url + '/rest/v1/buscador_descubiertos?select=*' + (nicho ? '&nicho=eq.' + encodeURIComponent(nicho) : '') +
      (o.todos ? '' : '&activo=eq.true') + '&order=descubierto_en.desc&limit=500', { headers: cab() });
    if (!r.ok) return [];
    const filas = await r.json();
    return Array.isArray(filas) ? filas : [];
  } catch (e) { return []; }
}

async function ultimaCorrida(nicho) {
  const { url, key } = supa();
  if (!key) return null;
  try {
    const r = await fetch(url + '/rest/v1/buscador_descubrimiento_corridas?select=corrido_en&nicho=eq.' + encodeURIComponent(nicho) + '&limit=1', { headers: cab() });
    if (!r.ok) return null;
    const f = (await r.json())[0];
    return f ? Date.parse(f.corrido_en) : null;
  } catch (e) { return null; }
}

export async function corridasPorNicho() {
  const out = {};
  const { url, key } = supa();
  if (!key) return out;
  try {
    const r = await fetch(url + '/rest/v1/buscador_descubrimiento_corridas?select=nicho,corrido_en', { headers: cab() });
    if (r.ok) for (const f of await r.json()) out[f.nicho] = Date.parse(f.corrido_en);
  } catch (e) {}
  return out;
}

async function anotarCorrida(nicho, resultado) {
  const { url, key } = supa();
  if (!key) return;
  try {
    await fetch(url + '/rest/v1/buscador_descubrimiento_corridas?on_conflict=nicho', {
      method: 'POST', headers: cab({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ nicho, corrido_en: new Date().toISOString(), resultado })
    });
  } catch (e) {}
}

async function insertarDescubiertos(filas) {
  const { url, key } = supa();
  if (!key || !filas.length) return { ok: false, insertados: 0 };
  try {
    const r = await fetch(url + '/rest/v1/buscador_descubiertos?on_conflict=nicho,q', {
      method: 'POST', headers: cab({ 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' }),
      body: JSON.stringify(filas)
    });
    if (!r.ok) return { ok: false, insertados: 0, error: 'HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 200) };
    const out = await r.json();
    return { ok: true, insertados: Array.isArray(out) ? out.length : 0, filas: out };
  } catch (e) { return { ok: false, insertados: 0, error: e.message }; }
}

// ------------------------------------------------------------
// Pool a evaluar: 12 fijos + descubiertos activos, tope 20
// ------------------------------------------------------------
// Primero los descubiertos de los ultimos 30 dias (mas nuevos primero),
// despues los fijos, despues los descubiertos mas viejos. Un descubierto que
// repite la q de un fijo no entra.
export function armarLista(fijos, descubiertos, opts) {
  const o = opts || {};
  const ahora = o.ahora || Date.now();
  const tope = o.tope || TOPE_POR_CONSULTA;
  const qs = new Set(fijos.map(p => p.q));
  const desc = (descubiertos || []).filter(d => d && d.activo !== false && d.q && !qs.has(d.q)).map(d => ({
    nombre: d.nombre, q: d.q, keyword_en: d.keyword_en, volCm3: Number(d.volCm3), costoMin: Number(d.costoMin),
    costoMax: Number(d.costoMax), pesoG: Number(d.pesoG), nota: d.nota || '', cat: d.cat || undefined,
    descubiertoId: d.id, descubiertoEn: d.descubierto_en,
    nuevo: (ahora - Date.parse(d.descubierto_en)) / 86400e3 <= DIAS_NUEVO
  }));
  const edad = d => (ahora - Date.parse(d.descubiertoEn)) / 86400e3;
  const recientes = desc.filter(d => edad(d) <= DIAS_PRIORIDAD).sort((a, b) => edad(a) - edad(b));
  const viejos = desc.filter(d => edad(d) > DIAS_PRIORIDAD).sort((a, b) => edad(a) - edad(b));
  const vistos = new Set();
  const out = [];
  for (const p of recientes.concat(fijos, viejos)) {
    if (out.length >= tope) break;
    if (vistos.has(p.q)) continue;
    vistos.add(p.q); out.push(p);
  }
  return out;
}

// ------------------------------------------------------------
// Llamada al modelo
// ------------------------------------------------------------
const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['productos'],
  properties: {
    productos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['keyword', 'importable', 'motivo', 'nombre', 'q', 'keyword_en', 'volCm3', 'costoMin', 'costoMax', 'pesoG', 'nota'],
        properties: {
          keyword: { type: 'string' },
          importable: { type: 'boolean' },
          motivo: { type: 'string' },
          nombre: { type: 'string' },
          q: { type: 'string' },
          keyword_en: { type: 'string' },
          volCm3: { type: 'number' },
          costoMin: { type: 'number' },
          costoMax: { type: 'number' },
          pesoG: { type: 'number' },
          nota: { type: 'string' }
        }
      }
    }
  }
};

function promptPara(rubroLabel, candidatos, ejemplos) {
  return 'Rubro: ' + rubroLabel + '\n\n' +
    'Estas son búsquedas en tendencia en MercadoLibre Argentina de las categorías de este rubro. ' +
    'Para cada una, decidí si corresponde a un producto físico genérico que un importador chico puede traer de China ' +
    '(por contenedor marítimo consolidado) y revender sin licencia ni marca registrada. Marcá importable=false si es un servicio, ' +
    'alimento, bebida, suplemento o medicamento, un usado, un vehículo entero, un inmueble, algo digital, una marca o modelo de marca ' +
    '(iPhone, Samsung, Xiaomi, etc.), algo que necesita licencia, o una búsqueda tan genérica que no es un producto concreto.\n\n' +
    'Si es importable, completá la ficha:\n' +
    '- nombre: nombre comercial corto en español (5 a 90 caracteres), sin marcas.\n' +
    '- q: la búsqueda en MercadoLibre para encontrar ese producto, 2 a 6 palabras en minúscula, sin acentos ni marcas.\n' +
    '- keyword_en: la búsqueda equivalente en inglés para Alibaba, 2 a 6 palabras.\n' +
    '- volCm3: volumen de UNA unidad empaquetada en cm³.\n' +
    '- pesoG: peso de una unidad empaquetada en gramos.\n' +
    '- costoMin y costoMax: rango típico de precio FOB China por unidad en USD para pedidos de 100 a 500 unidades (costoMax como mucho 6 veces costoMin).\n' +
    '- nota: 3 a 60 caracteres con el ángulo comercial (estacionalidad, recompra, ticket, riesgo).\n' +
    '- motivo: una frase con por qué es o no es importable.\n' +
    'Si no es importable, igual devolvé todos los campos (podés dejarlos vacíos o en 0). Usá cifras realistas: no inventes precios bajos para que parezca buen negocio.\n\n' +
    'Ejemplos de fichas del catálogo actual:\n' + ejemplos.map(e => JSON.stringify(e)).join('\n') + '\n\n' +
    'Búsquedas a evaluar (devolvé una ficha por cada una, en el mismo orden, con keyword igual a la búsqueda):\n' +
    candidatos.map((c, i) => (i + 1) + '. ' + c.keyword).join('\n');
}

async function pedirFichas(rubroLabel, candidatos, ejemplos, opts) {
  const o = opts || {};
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Falta ANTHROPIC_API_KEY.' };
  const cuerpo = (conFallback) => JSON.stringify(Object.assign({
    model: MODELO(),
    max_tokens: 8000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
    system: 'Sos analista de importaciones China-Argentina. Respondés solo con el JSON pedido.',
    messages: [{ role: 'user', content: promptPara(rubroLabel, candidatos, ejemplos) }]
  }, conFallback ? { fallbacks: 'default' } : {}));
  async function llamar(conFallback) {
    const ctrl = new AbortController();
    const corte = setTimeout(() => ctrl.abort(), o.timeoutMs || 40000);
    try {
      const h = anthropicHeaders();
      if (conFallback) h['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: h, body: cuerpo(conFallback), signal: ctrl.signal });
      const j = await r.json().catch(() => null);
      return { r, j };
    } finally { clearTimeout(corte); }
  }
  try {
    let { r, j } = await llamar(true);
    // Si la cuenta no tiene el beta de fallbacks, se reintenta sin el.
    if (r.status === 400) ({ r, j } = await llamar(false));
    if (!r.ok || !j) return { ok: false, error: 'Anthropic HTTP ' + r.status + ': ' + String(j && j.error && j.error.message || '').slice(0, 200) };
    if (j.stop_reason === 'refusal') return { ok: false, error: 'el modelo rechazo el pedido' };
    if (j.stop_reason === 'max_tokens') return { ok: false, error: 'respuesta cortada por max_tokens' };
    const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let datos;
    try { datos = JSON.parse(txt); } catch (e) { return { ok: false, error: 'JSON invalido del modelo' }; }
    if (!datos || !Array.isArray(datos.productos)) return { ok: false, error: 'JSON sin productos' };
    return { ok: true, productos: datos.productos, modelo: j.model, uso: j.usage ? { in: j.usage.input_tokens, out: j.usage.output_tokens } : null };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'Anthropic no respondio a tiempo' : String(e && e.message || e).slice(0, 200) };
  }
}

// ------------------------------------------------------------
// Descubrimiento de un rubro
// ------------------------------------------------------------
// catalogo: el CATALOGO entero (para descartar lo que ya esta en cualquier
// rubro). forzar: ignora la semana de espera (boton del admin).
export async function descubrirRubro(cli, nichoKey, catalogo, opts) {
  const o = opts || {};
  const t0 = Date.now();
  const rubro = catalogo[nichoKey];
  if (!rubro) return { ok: false, nicho: nichoKey, error: 'rubro desconocido' };
  if (!o.forzar) {
    const ult = await ultimaCorrida(nichoKey);
    if (ult && Date.now() - ult < DIAS_ENTRE_DESCUBRIMIENTOS * 86400e3) return { ok: true, nicho: nichoKey, salteado: 'ya se corrio esta semana', ultima: new Date(ult).toISOString() };
  }
  // 1. Busquedas en tendencia de las categorias del rubro (las mismas que pide
  // datosCategoria en el analisis; con el mismo cliente salen del cache).
  const cats = Array.from(new Set(rubro.productos.map(p => (categoriaDe(p) || {}).cat).filter(Boolean)));
  const infos = await Promise.all(cats.map(c => datosCategoria(cli, c).catch(() => null)));
  const crudos = [];
  infos.forEach((inf, i) => (inf && inf.tendencias || []).forEach((kw, pos) => crudos.push({ keyword: kw, cat: cats[i], posicion: pos + 1 })));
  // 2. Filtros: marca, no importable, duplicado dentro de las tendencias, ya en
  // CATALOGO (cualquier rubro) o ya descubierto (activo o no: lo desactivado no vuelve).
  const yaDescubiertos = await leerDescubiertos(null, { todos: true });
  const fijosTodos = [];
  Object.keys(catalogo).forEach(k => catalogo[k].productos.forEach(p => fijosTodos.push(p.q, p.nombre)));
  const descTextos = [];
  yaDescubiertos.forEach(d => { descTextos.push(d.q, d.nombre); if (d.keyword_origen) descTextos.push(d.keyword_origen); });
  const descartes = { marca: 0, noImportable: 0, enCatalogo: 0, yaDescubierto: 0, repetido: 0 };
  const candidatos = [];
  for (const c of crudos.sort((a, b) => a.posicion - b.posicion)) {
    if (esMarca(c.keyword)) { descartes.marca++; continue; }
    if (esNoImportable(c.keyword, nichoKey)) { descartes.noImportable++; continue; }
    if (candidatos.some(x => mismoProducto(x.keyword, c.keyword))) { descartes.repetido++; continue; }
    if (fijosTodos.some(t => mismoProducto(t, c.keyword))) { descartes.enCatalogo++; continue; }
    if (descTextos.some(t => mismoProducto(t, c.keyword))) { descartes.yaDescubierto++; continue; }
    candidatos.push(c);
  }
  const resultado = { ok: true, nicho: nichoKey, categorias: cats.length, tendencias: crudos.length, descartes, candidatos: candidatos.length };
  if (!candidatos.length) {
    resultado.nuevos = [];
    resultado.ms = Date.now() - t0;
    if (!o.sinAnotar) await anotarCorrida(nichoKey, resultado);
    return resultado;
  }
  // 3. Fichas con el modelo, validadas campo por campo.
  const enviar = candidatos.slice(0, MAX_CANDIDATOS_IA);
  const ejemplos = rubro.productos.slice(0, 3).map(p => ({ nombre: p.nombre, q: p.q, keyword_en: p.keyword_en, volCm3: p.volCm3, costoMin: p.costoMin, costoMax: p.costoMax, pesoG: p.pesoG, nota: p.nota }));
  const ia = await pedirFichas(rubro.label, enviar, ejemplos, { timeoutMs: o.timeoutMs });
  if (!ia.ok) {
    // Sin anotar la corrida: el error no consume la semana.
    return Object.assign(resultado, { ok: false, error: ia.error, ms: Date.now() - t0 });
  }
  resultado.modelo = ia.modelo; resultado.uso = ia.uso;
  const rechazados = [];
  const filas = [];
  const qsNuevas = [];
  for (const f of ia.productos) {
    if (filas.length >= MAX_NUEVOS_POR_SEMANA) break;
    const orig = enviar.find(c => norm(c.keyword) === norm(f && f.keyword));
    if (!orig) { rechazados.push({ keyword: f && f.keyword, motivo: 'keyword que no se pidio' }); continue; }
    const v = validarFicha(f, nichoKey);
    if (!v.ok) { rechazados.push({ keyword: orig.keyword, motivo: v.motivo }); continue; }
    // La ficha final tampoco puede repetir algo del pool.
    if (fijosTodos.some(t => mismoProducto(t, v.ficha.q)) || descTextos.some(t => mismoProducto(t, v.ficha.q)) || qsNuevas.some(t => mismoProducto(t, v.ficha.q))) {
      rechazados.push({ keyword: orig.keyword, motivo: 'la ficha repite un producto del pool' }); continue;
    }
    qsNuevas.push(v.ficha.q);
    filas.push(Object.assign({}, v.ficha, {
      nicho: nichoKey, cat: orig.cat, keyword_origen: orig.keyword,
      origen: 'trends/MLA/' + orig.cat + ' #' + orig.posicion + (process.env.VERCEL_ENV === 'preview' ? ' (preview)' : ''),
      descubierto_en: new Date().toISOString(), activo: true
    }));
  }
  const ins = filas.length ? await insertarDescubiertos(filas) : { ok: true, insertados: 0 };
  Object.assign(resultado, {
    enviadosAlModelo: enviar.length, rechazados,
    nuevos: (ins.filas || []).map(f => ({ nombre: f.nombre, q: f.q, costo: f.costoMin + '-' + f.costoMax, origen: f.origen })),
    insertados: ins.insertados, errorInsert: ins.error || null, ms: Date.now() - t0
  });
  if (!ins.ok) resultado.ok = false;
  if (ins.ok && !o.sinAnotar) await anotarCorrida(nichoKey, resultado);
  return resultado;
}

// ------------------------------------------------------------
// Despues de cada analisis: contar y desactivar la basura
// ------------------------------------------------------------
// evaluados: [{ descubiertoId, sinDatos, veredictoLabel }]. Un descubierto que
// suma FALLOS_PARA_DESACTIVAR analisis seguidos sin datos o con "No conviene"
// queda activo=false.
export async function registrarAnalisisDescubiertos(evaluados, filasActuales) {
  const { url, key } = supa();
  if (!key || !evaluados.length) return { actualizados: 0, desactivados: [] };
  const porId = new Map((filasActuales || []).map(f => [f.id, f]));
  const desactivados = [];
  let actualizados = 0;
  await Promise.all(evaluados.map(async e => {
    const fila = porId.get(e.descubiertoId);
    if (!fila) return;
    const malo = e.sinDatos || /no conviene/i.test(e.veredictoLabel || '');
    const fallos = malo ? (Number(fila.fallos) || 0) + 1 : 0;
    const activo = fallos < FALLOS_PARA_DESACTIVAR;
    if (!activo) desactivados.push(fila.q);
    const r = await fetch(url + '/rest/v1/buscador_descubiertos?id=eq.' + encodeURIComponent(fila.id), {
      method: 'PATCH', headers: cab({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ analisis: (Number(fila.analisis) || 0) + 1, fallos, activo,
        ultimo_estado: e.sinDatos ? 'sin datos' : (e.veredictoLabel || 'evaluado'), actualizado: new Date().toISOString() })
    }).catch(() => null);
    if (r && r.ok) actualizados++;
  }));
  return { actualizados, desactivados };
}
