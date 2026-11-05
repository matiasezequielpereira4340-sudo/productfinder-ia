// api/_pool.js
// Pool de candidatos por rubro, seleccion semanal con rotacion, descubrimiento
// en tendencias de MercadoLibre y variantes de busqueda.
//
// Por que existe: cada rubro tenia 12 productos FIJOS y el refresco semanal
// solo actualizaba los precios de esos mismos 12, asi que el usuario veia lo
// mismo durante un mes. Ahora cada rubro tiene un POOL (catalogo original +
// ampliado + descubiertos en /trends de MeLi) y cada semana se elige una
// seleccion nueva priorizando lo que no se mostro en las ultimas 3 semanas.
//
// Todo lo que vive aca es puro (sin red) salvo descubrir() y
// analizarConVariantes(), que reciben el cliente de MeLi ya armado. El
// historial y la ronda se guardan DENTRO de la fila de buscador_cache del
// rubro (mercado.__historial, mercado.__ronda): no hace falta tabla nueva.

import { EXTRA } from './_pool-extra.js';
import { costoImportacion, moqTipico, limpiarMuestra, acotarPorCosto } from './_oportunidad.js';
import { esMarca } from './_radar.js';
import { categoriaDe } from './_categorias.js';

const MELI_API = 'https://api.mercadolibre.com';

// Cuantos productos con datos reales se buscan por ronda. Se analizan mas de
// los 12 que se muestran para que el perfil (capital, experiencia, riesgo)
// pueda elegir: con exactamente 12 el perfil solo reordenaba la misma lista.
// 24: con 15 el perfil solo podia cambiar 3 de 12 (capital bajo vs alto
// difería en 1-2 productos). El costo es mas llamadas a MeLi (ver README).
export const OBJETIVO_RONDA = () => Math.max(12, Math.min(30, Number(process.env.BUSCADOR_SELECCION || 24)));
// Cuantos de la ronda anterior se quedan fijos (los mejores con medicion de
// vendidos hecha o en curso), para que lleguen a la 2.a medicion y puedan ser
// "Oportunidad alta". El resto rota.
export const FIJOS_POR_RONDA = () => Math.max(0, Math.min(12, Number(process.env.BUSCADOR_FIJOS || 6)));

// Elige los que se quedan fijos. prev: seleccion de la ronda anterior (con su
// mercado), hist: historialDe() de _rotacion.js. Primero los que ya tienen 2
// mediciones, despues 1, despues en curso; dentro, por vendidos medidos.
export function elegirFijos(prev, hist, n) {
  const estadoDe = q => {
    const h = hist && hist[q];
    if (!h) return null;
    const c = (h.cosechadas || []).length;
    if (c >= 2) return 3;
    if (c === 1) return 2;
    if (h.ultimo && /^(en_cola|arrancada)$/.test(h.ultimo.estado)) return 1;
    return null;
  };
  return (prev || []).map(p => ({ p, e: estadoDe(p.q), v: hist && hist[p.q] && hist[p.q].cosechadas[0] ? (hist[p.q].cosechadas[0].vendidos_total || 0) : 0 }))
    .filter(x => x.e != null)
    .sort((a, b) => (b.e - a.e) || (b.v - a.v))
    .slice(0, n)
    .map(x => Object.assign({}, x.p, { fijo: true, motivoFijo: x.e === 3 ? 'ventas por mes medidas' : x.e === 2 ? 'falta la 2.a medición' : 'medición en curso' }));
}
export const MOSTRAR_MAX = 12;
export const SEMANAS_SIN_REPETIR = 3;
const RONDAS_GUARDADAS = 8;
const DESCUBIERTOS_MAX = 60;
const DESCUBIERTOS_POR_RONDA = 8;

export function normalizar(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------
// Pool
// ------------------------------------------------------------
// EXTRA viene compacto: [nombre, q, keyword_en, volCm3, fobMin, fobMax, pesoG, nota?]
function desdeCompacto(a) {
  return { nombre: a[0], q: a[1], keyword_en: a[2], volCm3: a[3], costoMin: a[4], costoMax: a[5], pesoG: a[6], nota: a[7] || null };
}

export function extraDe(nichoKey) {
  return (EXTRA[nichoKey] || []).map(desdeCompacto);
}

// base: productos del CATALOGO original del rubro. descubiertos: los que ya se
// guardaron en la fila del rubro. Sin duplicados por busqueda normalizada.
export function poolDe(nichoKey, base, descubiertos) {
  const out = [], vistos = new Set();
  const sumar = (p, origen) => {
    const k = normalizar(p && p.q);
    if (!k || vistos.has(k)) return;
    vistos.add(k);
    out.push(Object.assign({}, p, { origen: p.origen || origen }));
  };
  (base || []).forEach(p => sumar(p, 'catalogo'));
  extraDe(nichoKey).forEach(p => sumar(p, 'ampliado'));
  (descubiertos || []).forEach(p => sumar(p, 'descubierto'));
  return out;
}

// Solo se puede MOSTRAR un producto con categoria de MeLi asignada: fijada a
// mano (_categorias-datos.js), validada para el pool (_categorias-pool.js) o,
// si se descubrio en /trends, la categoria de donde salio. Lo demas queda
// fuera de la seleccion (sin categoria no hay forma de saber si la busqueda
// trae el producto correcto).
export function tieneCategoria(p) {
  if (!p) return false;
  if (p.origen === 'descubierto') return !!p.cat;
  return !!categoriaDe(p);
}
export function poolElegible(nichoKey, base, descubiertos) {
  return poolDe(nichoKey, base, descubiertos).filter(tieneCategoria);
}

// Tramo de inversion del pedido minimo (USD, desembolso con tributos): sirve
// para que la seleccion semanal tenga productos para todos los capitales.
export function inversionMinima(prod, nichoKey, usdArs) {
  const c = costoImportacion(prod, usdArs || 1500, nichoKey);
  const porUnidad = c.desembolsoUSD || c.costoPuestoUSD || 0;
  return Math.round(moqTipico(c.fobUSD) * porUnidad);
}
export function tramoDe(inv) { return inv < 700 ? 'chico' : inv < 2000 ? 'medio' : 'grande'; }

// ------------------------------------------------------------
// Historial
// ------------------------------------------------------------
// historial = { rondas: [{ id, fecha, qs: [...] }] (mas nueva primero), vistos: [q...] }
// Una fila del formato viejo (12 fijos) se convierte: esos 12 ya se mostraron.
export function historialDesdeFila(fila, base) {
  const m = fila && fila.mercado;
  if (m && m.__historial && Array.isArray(m.__historial.rondas)) {
    return { rondas: m.__historial.rondas.slice(0, RONDAS_GUARDADAS), vistos: Array.isArray(m.__historial.vistos) ? m.__historial.vistos.slice() : [] };
  }
  if (m && typeof m === 'object') {
    const qs = (base || []).map(p => p.q);
    return { rondas: [{ id: 'catalogo-fijo', fecha: fila.created_at || new Date().toISOString(), qs }], vistos: qs.slice() };
  }
  // Sin fila: los 12 del catalogo fijo son los que se venian mostrando.
  const qs = (base || []).map(p => p.q);
  return { rondas: qs.length ? [{ id: 'catalogo-fijo', fecha: new Date(Date.now() - 7 * 86400e3).toISOString(), qs }] : [], vistos: qs.slice() };
}

export function cerrarRonda(historial, ronda, qs) {
  const rondas = [{ id: ronda.id, fecha: ronda.fecha, qs: qs.slice() }].concat((historial.rondas || []).filter(r => r.id !== ronda.id)).slice(0, RONDAS_GUARDADAS);
  const vistos = Array.from(new Set((historial.vistos || []).concat(qs)));
  return { rondas, vistos };
}

// hash chico y estable para rotar dentro de un mismo grupo de prioridad
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ------------------------------------------------------------
// Seleccion de la ronda
// ------------------------------------------------------------
// Devuelve TODO el pool ordenado por prioridad: los primeros se analizan, el
// resto queda de reserva para reemplazar a los que no tengan datos.
// Prioridad: 1) no mostrado en las ultimas 3 semanas (nunca mostrado antes que
// mostrado hace mucho; descubiertos primero entre los nunca mostrados);
// 2) el resto, del mostrado hace mas tiempo al mas reciente. Dentro de cada
// grupo se rota con la semilla de la ronda. Despues se intercala por tramo de
// inversion para que haya productos para capital bajo, medio y alto.
export function ordenarCandidatos(pool, historial, opts) {
  const o = opts || {};
  const ahora = o.ahora || Date.now();
  const semilla = String(o.semilla || '');
  const limite = ahora - SEMANAS_SIN_REPETIR * 7 * 86400e3;
  const ultima = {};
  (historial.rondas || []).forEach(r => {
    const t = new Date(r.fecha).getTime() || 0;
    (r.qs || []).forEach(q => { if (!(ultima[q] >= t)) ultima[q] = t; });
  });
  const vistosAntes = new Set(historial.vistos || []);
  const grupo = p => {
    const t = ultima[p.q];
    if (t == null && !vistosAntes.has(p.q)) return p.origen === 'descubierto' ? 0 : 1;
    if (t == null || t < limite) return 2;
    return 3;
  };
  const ordenado = pool.map(p => ({ p, g: grupo(p), t: ultima[p.q] || 0, h: hash(semilla + '|' + p.q), tramo: tramoDe(inversionMinima(p, o.nichoKey, o.usdArs)) }))
    .sort((a, b) => (a.g - b.g) || (a.g >= 2 ? a.t - b.t : 0) || (a.h - b.h));
  // Intercalado por tramo dentro de cada grupo de prioridad.
  const out = [];
  for (const g of [0, 1, 2, 3]) {
    const del = ordenado.filter(x => x.g === g);
    const porTramo = { chico: [], medio: [], grande: [] };
    del.forEach(x => porTramo[x.tramo].push(x));
    const orden = ['medio', 'grande', 'chico'];
    while (orden.some(t => porTramo[t].length)) {
      for (const t of orden) if (porTramo[t].length) out.push(porTramo[t].shift());
    }
  }
  const fijos = (o.fijos || []).filter(f => pool.some(p => p.q === f.q));
  const qsFijos = new Set(fijos.map(f => f.q));
  return fijos.map(f => Object.assign({}, pool.find(p => p.q === f.q), f, { tramo: tramoDe(inversionMinima(f, o.nichoKey, o.usdArs)) }))
    .concat(out.filter(x => !qsFijos.has(x.p.q)).map(x => Object.assign({}, x.p, { tramo: x.tramo, recienMostrado: x.g === 3 })));
}

// ------------------------------------------------------------
// Variantes de busqueda (para los que no traen datos)
// ------------------------------------------------------------
const SINONIMOS = {
  soporte: 'base', base: 'soporte', organizador: 'organizadora', estuche: 'funda', funda: 'estuche',
  set: 'kit', kit: 'set', protector: 'cubre', lampara: 'luz', luz: 'lampara', bolso: 'bolsa', bolsa: 'bolso',
  cepillo: 'cepillos', porta: 'portador', recargable: 'usb', adhesivo: 'autoadhesivo', plegable: 'portatil'
};
const VACIAS = new Set(['de', 'para', 'con', 'y', 'la', 'el', 'en', 'sin', 'los', 'las', 'del', 'por', 'x', 'a']);

export function variantesDe(prod) {
  const q = normalizar(prod.q);
  const pal = q.split(' ').filter(Boolean);
  const sig = pal.filter(w => !VACIAS.has(w));
  const out = [];
  const sumar = v => { v = normalizar(v); if (v && v !== q && v.split(' ').length >= 2 && out.indexOf(v) < 0) out.push(v); };
  // 1. sinonimo en la primera palabra que tenga uno
  const iSin = pal.findIndex(w => SINONIMOS[w]);
  if (iSin > -1) { const c = pal.slice(); c[iSin] = SINONIMOS[pal[iSin]]; sumar(c.join(' ')); }
  // 2. mas generica: sin la ultima palabra
  if (pal.length >= 3) sumar(pal.slice(0, -1).join(' '));
  // 3. el nucleo: las dos primeras palabras significativas
  if (sig.length >= 2) sumar(sig.slice(0, 2).join(' '));
  // 4. desde el nombre visible (sin parentesis)
  const nom = normalizar(String(prod.nombre || '').replace(/\([^)]*\)/g, ' ')).split(' ').filter(w => w && !VACIAS.has(w));
  if (nom.length >= 2) sumar(nom.slice(0, 3).join(' '));
  return out.slice(0, 3);
}

// Tiene datos reales = el mismo criterio que la tarjeta (evaluarProducto):
// 3 ofertas comparables, sin marcas, dentro del tope de precio por costo.
export function tieneDatos(mercado, prod, nichoKey, usdArs) {
  if (!mercado || !Array.isArray(mercado.results)) return false;
  const costo = costoImportacion(prod, usdArs || 1500, nichoKey);
  return acotarPorCosto(limpiarMuestra(mercado.results), costo.costoPuestoARS).length >= 3;
}

// analizar: (cli, prod) => mercado, inyectado para no depender de _precalculo
// (y poder probarlo). Devuelve { mercado, consulta, intentos, cortado }.
export async function analizarConVariantes(cli, prod, analizar, ctx) {
  const c = ctx || {};
  const antesCortes = cli.estado.cortadasPorTiempo || 0;
  const intentos = [prod.q];
  let m = await analizar(cli, prod).catch(() => null);
  if (tieneDatos(m, prod, c.nichoKey, c.usdArs)) return { mercado: m, consulta: prod.q, intentos, cortado: false };
  const fija = categoriaDe(prod);
  for (const v of variantesDe(prod)) {
    if ((cli.estado.cortadasPorTiempo || 0) > antesCortes) break;
    intentos.push(v);
    const alt = Object.assign({}, prod, { q: v }, fija ? { cat: fija.cat, dom: fija.dom } : {});
    const m2 = await analizar(cli, alt).catch(() => null);
    if (tieneDatos(m2, prod, c.nichoKey, c.usdArs)) {
      m2.consultaUsada = v;
      return { mercado: m2, consulta: v, intentos, cortado: false };
    }
    if (m2 && (!m || !(m.results || []).length)) m = m2;
  }
  return { mercado: m, consulta: null, intentos, cortado: (cli.estado.cortadasPorTiempo || 0) > antesCortes };
}

// ------------------------------------------------------------
// Descubrimiento en MercadoLibre (APIs oficiales)
// ------------------------------------------------------------
// Fuentes, en este orden: /highlights/MLA/category/{cat} (mas vendidos: hoy da
// 403 con el token, medido el 20/10/2026; si algun dia responde, se usa) y
// /trends/MLA/{cat} (busquedas top de la categoria: responde 200). Las
// categorias salen de los productos del pool que tienen categoria fijada.
// Se descartan marcas/licencias, alimentos y medicamentos, y lo que no es un
// producto importable (vehiculos, inmuebles, servicios).
const PROHIBIDO = /\b(alimento|alimentos|comida|balanceado|yerba|cafe|te en|galletit|chocolate|golosina|bebida|cerveza|vino|whisky|fernet|gaseosa|leche|carne|queso|medicamento|remedio|ibuprofeno|paracetamol|antibiotico|pastillas?|capsulas? de|vitaminas?|suplemento|proteina|creatina|colageno|whey|melatonina|aceite de cannabis|cbd|tabaco|vape|cigarrillo|usad[oa]s?|0 ?km|departamento|alquiler|terreno|inmueble|servicio|curso|repuesto original|celular samsung|iphone|ps5|playstation|xbox|nintendo|perfume|arma|municion)\b/;

function capitalizar(t) { const s = String(t || '').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
function mediana(arr) { const s = arr.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function parecido(a, b) {
  const pa = new Set(normalizar(a).split(' ').filter(w => w.length > 2 && !VACIAS.has(w)).map(w => w.replace(/s$/, '')));
  const pb = normalizar(b).split(' ').filter(w => w.length > 2 && !VACIAS.has(w)).map(w => w.replace(/s$/, ''));
  if (!pa.size || !pb.length) return 0;
  const comunes = pb.filter(w => pa.has(w)).length;
  return comunes / Math.min(pa.size, pb.length);
}

export function keywordAceptable(k) {
  const n = normalizar(k);
  if (!n || n.split(' ').length < 2 || n.length > 60) return false;
  if (esMarca(k)) return false;
  if (PROHIBIDO.test(n)) return false;
  return true;
}

export async function descubrir(cli, nichoKey, pool, opts) {
  const o = opts || {};
  const porCat = {};
  pool.forEach(p => { const f = categoriaDe(p); if (f && f.cat) (porCat[f.cat] = porCat[f.cat] || []).push(p); });
  const cats = Object.keys(porCat).sort((a, b) => porCat[b].length - porCat[a].length).slice(0, o.categorias || 4);
  const todosMed = { min: mediana(pool.map(p => p.costoMin)), max: mediana(pool.map(p => p.costoMax)), vol: mediana(pool.map(p => p.volCm3)), peso: mediana(pool.map(p => p.pesoG)) };
  const nuevos = [];
  const fuentes = { highlights: 0, trends: 0, descartadas: 0 };
  for (const cat of cats) {
    if (nuevos.length >= DESCUBIERTOS_POR_RONDA) break;
    let keywords = [];
    // /highlights da 403 con el token (medido 20/10/2026): solo se prueba si
    // se pide explicitamente, para no gastar llamadas en algo que no responde.
    const hl = process.env.BUSCADOR_PROBAR_HIGHLIGHTS === '1'
      ? await cli.get('highlights/category', MELI_API + '/highlights/MLA/category/' + cat) : { ok: false };
    if (hl.ok && hl.json && Array.isArray(hl.json.content)) {
      const ids = hl.json.content.filter(x => x && x.type === 'PRODUCT' && x.id).slice(0, 5).map(x => x.id);
      const ps = await Promise.all(ids.map(id => cli.get('products', MELI_API + '/products/' + id)));
      ps.forEach(r => { if (r.ok && r.json && r.json.name) { keywords.push({ k: r.json.name, fuente: 'más vendidos' }); fuentes.highlights++; } });
    }
    const tr = await cli.get('trends/category', MELI_API + '/trends/MLA/' + cat);
    if (tr.ok && Array.isArray(tr.json)) tr.json.forEach((x, i) => { if (x && x.keyword) { keywords.push({ k: x.keyword, fuente: 'tendencias', pos: i + 1, total: tr.json.length }); fuentes.trends++; } });
    const hermanos = porCat[cat];
    const ref = {
      min: mediana(hermanos.map(p => p.costoMin)) || todosMed.min || 1,
      max: mediana(hermanos.map(p => p.costoMax)) || todosMed.max || 3,
      vol: mediana(hermanos.map(p => p.volCm3)) || todosMed.vol || 800,
      peso: mediana(hermanos.map(p => p.pesoG)) || todosMed.peso || 150
    };
    for (const kw of keywords) {
      if (nuevos.length >= DESCUBIERTOS_POR_RONDA) break;
      const q = normalizar(kw.k).replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
      if (!keywordAceptable(q)) { fuentes.descartadas++; continue; }
      if (pool.concat(nuevos).some(p => parecido(p.q, q) >= 0.75)) { fuentes.descartadas++; continue; }
      nuevos.push({
        nombre: capitalizar(q), q, keyword_en: q,
        volCm3: Math.round(ref.vol), costoMin: Math.round(ref.min * 100) / 100, costoMax: Math.round(ref.max * 100) / 100, pesoG: Math.round(ref.peso),
        cat, origen: 'descubierto', descubiertoEn: new Date(o.ahora || Date.now()).toISOString(),
        nota: 'Descubierto en ' + kw.fuente + ' de MeLi' + (kw.pos ? ' (#' + kw.pos + ' de ' + kw.total + ')' : '') + '. FOB y volumen estimados con la mediana del rubro: confirmalos con tu proveedor.'
      });
    }
  }
  return { nuevos, fuentes, categorias: cats };
}

export function sumarDescubiertos(previos, nuevos) {
  const out = [], vistos = new Set();
  (nuevos || []).concat(previos || []).forEach(p => { const k = normalizar(p.q); if (k && !vistos.has(k)) { vistos.add(k); out.push(p); } });
  return out.slice(0, DESCUBIERTOS_MAX);
}

// ------------------------------------------------------------
// Seleccion por perfil (12 de la ronda)
// ------------------------------------------------------------
// evaluados: productos ya pasados por evaluarProducto (con datos). Filtra por
// experiencia (sin certificaciones para "ninguna"), riesgo y capital, y deja
// el orden de ordenar(). Devuelve tambien cuantos se sacaron y por que.
export function filtrarPorPerfil(evaluados, perfil) {
  const fuera = { certificaciones: 0, riesgo: 0, capital: 0 };
  const quedan = evaluados.filter(p => {
    const certs = (p.certificaciones || []).length;
    if (perfil.experiencia === 'ninguna' && certs > 0) { fuera.certificaciones++; return false; }
    if (perfil.experiencia === 'poca' && certs > 1) { fuera.certificaciones++; return false; }
    if (perfil.riesgo === 'bajo' && p.riesgo === 'Alto') { fuera.riesgo++; return false; }
    if (p.capacidad && p.capacidad.escenario === 'ninguno') { fuera.capital++; return false; }
    return true;
  });
  return { quedan, fuera };
}
