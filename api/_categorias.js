// api/_categorias.js
// Categoria de MercadoLibre de cada producto del catalogo.
//
// Antes la categoria salia de las ofertas que devolvia la busqueda por
// palabras, y MeLi a veces trae otro rubro (gel limpiador de teclado ->
// Desmaquillantes, enrollador de cable -> carretes de manguera). Ahora cada
// producto tiene su categoria y su dominio fijados (api/_categorias-datos.js):
// la busqueda de catalogo se filtra por ese dominio y las ofertas de otra
// categoria se descartan.
//
// Este modulo tambien tiene el resolvedor que armo esos datos: consulta
// domain_discovery de MeLi con dos textos independientes (las palabras de
// busqueda y el nombre del producto) y /categories para la ruta. Si las dos
// consultas coinciden, la categoria se da por validada; si no, queda para
// revision manual (no se adivina).
import { CATEGORIAS } from './_categorias-datos.js';

const MELI_API = 'https://api.mercadolibre.com';

// { cat, dom } fijados para la query del producto, o null si no hay (o si
// quedo para revision: ahi se sigue como antes, sin filtro).
export function categoriaDe(prod) {
  if (prod && prod.cat) return { cat: prod.cat, dom: prod.dom || null };
  const c = prod && CATEGORIAS[prod.q];
  return c && c.cat ? { cat: c.cat, dom: c.dom || null } : null;
}

export function enRevision(prod) {
  const c = prod && CATEGORIAS[prod.q];
  return !!(c && c.revisar);
}

function textoNombre(nombre) {
  return String(nombre || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

// Resuelve un producto: { q, nicho, nombre, cat, cat_nombre, dom, ruta, estado, motivo, alt }
export async function resolverCategoria(cli, prod, nicho, cacheRutas) {
  const dd = async texto => {
    const r = await cli.get('domain_discovery', MELI_API + '/sites/MLA/domain_discovery/search?limit=3&q=' + encodeURIComponent(texto));
    return r.ok && Array.isArray(r.json) ? r.json.map(x => ({ cat: x.category_id, nombre: x.category_name, dom: x.domain_id })) : null;
  };
  const [a, b] = await Promise.all([dd(prod.q), dd(textoNombre(prod.nombre))]);
  const fila = { q: prod.q, nicho, nombre: prod.nombre, cat: null, cat_nombre: null, dom: null, ruta: null, estado: 'revisar', motivo: null, alt: { porPalabras: a, porNombre: b } };
  if (!a || !a.length) { fila.motivo = 'domain_discovery no respondio para las palabras de busqueda'; return fila; }
  const a0 = a[0], b0 = b && b[0];
  let elegida = null;
  if (b0 && a0.cat === b0.cat) { elegida = a0; fila.motivo = 'misma categoria por palabras y por nombre'; }
  else if (b0 && a0.dom && a0.dom === b0.dom) { elegida = a0; fila.motivo = 'mismo dominio por palabras y por nombre'; }
  else if (b && b.some(x => x.cat === a0.cat)) { elegida = a0; fila.motivo = 'la categoria por palabras esta entre las 3 del nombre'; }
  else if (b0 && a.some(x => x.cat === b0.cat)) { elegida = b0; fila.motivo = 'la categoria por nombre esta entre las 3 de las palabras'; }
  else { elegida = a0; fila.motivo = b0 ? 'no coinciden: palabras -> ' + a0.nombre + ', nombre -> ' + b0.nombre : 'sin respuesta por nombre'; }
  fila.cat = elegida.cat; fila.cat_nombre = elegida.nombre; fila.dom = elegida.dom;
  fila.estado = /^(misma|mismo|la categoria)/.test(fila.motivo) ? 'ok' : 'revisar';
  if (!cacheRutas[elegida.cat]) {
    const r = await cli.get('categories', MELI_API + '/categories/' + elegida.cat);
    cacheRutas[elegida.cat] = r.ok && r.json && Array.isArray(r.json.path_from_root) ? r.json.path_from_root.map(x => x.name).join(' > ') : null;
  }
  fila.ruta = cacheRutas[elegida.cat];
  return fila;
}
