// pruebas/generar-categorias-pool.mjs
// Uso: node pruebas/generar-categorias-pool.mjs <export.json>
//
// Genera api/_categorias-pool.js a partir de las filas de buscador_categorias
// (export JSON: [{q, nicho, nombre, cat, cat_nombre, dom, ruta, estado}]) que
// dejo precalcular=categorias. REGLA (un producto sin categoria valida NO se
// muestra):
//   1. estado "ok": domain_discovery dio la misma categoria (o dominio) por las
//      palabras de busqueda y por el nombre. "revisar" = descartado.
//   2. coherente con el rubro: la raiz de su ruta en MeLi (p. ej. "Celulares y
//      Teléfonos") tiene que ser una de las raices de los productos del rubro
//      con categoria fijada a mano. Si el rubro no tiene ninguno, la raiz mas
//      comun entre sus "ok".
// Tambien escribe el resumen por rubro (validos / descartados y por que).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filas = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { CATEGORIAS } = await import('../api/_categorias-datos.js');
const { extraDe } = await import('../api/_pool.js');
const analyze = await import('../api/analyze.js');
const CAT = analyze.__CATALOGO;
const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const raizDe = ruta => ruta ? String(ruta).split('>')[0].trim() : null;
const porQ = {};
filas.forEach(f => { porQ[f.q] = f; });

const out = {}, resumen = {};
for (const k of Object.keys(CAT)) {
  // Raices permitidas: las de los productos del catalogo con categoria fijada.
  const fijados = CAT[k].productos.filter(p => CATEGORIAS[p.q] && CATEGORIAS[p.q].cat);
  const raices = new Set(fijados.map(p => {
    const f = porQ[p.q];
    return f && f.cat === CATEGORIAS[p.q].cat ? raizDe(f.ruta) : (f ? raizDe(f.ruta) : null);
  }).filter(Boolean));
  // Los 20 rubros: el ampliado de todos los rubros viejos que absorbe.
  const extra = Array.from(new Set(extraDe(k).map(p => p.q))).filter(q => !CATEGORIAS[q]);
  if (!raices.size) {
    const cuenta = {};
    extra.forEach(q => { const f = porQ[q]; if (f && f.estado === 'ok' && raizDe(f.ruta)) cuenta[raizDe(f.ruta)] = (cuenta[raizDe(f.ruta)] || 0) + 1; });
    const top = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a])[0];
    if (top) raices.add(top);
  }
  const r = { catalogoConCategoria: fijados.length, catalogoSinCategoria: CAT[k].productos.length - fijados.length,
    ampliadoValidos: 0, sinResultado: 0, revisar: 0, otroRubro: 0, raices: Array.from(raices), ejemplosOtroRubro: [] };
  for (const q of extra) {
    const f = porQ[q];
    if (!f || !f.cat) { r.sinResultado++; continue; }
    if (f.estado !== 'ok') { r.revisar++; continue; }
    if (!raices.has(raizDe(f.ruta))) { r.otroRubro++; if (r.ejemplosOtroRubro.length < 3) r.ejemplosOtroRubro.push(q + ' -> ' + f.ruta); continue; }
    out[q] = { cat: f.cat, dom: f.dom || null, nicho: k };
    r.ampliadoValidos++;
  }
  r.poolValido = r.catalogoConCategoria + r.ampliadoValidos;
  resumen[k] = r;
}
const cuerpo = '// api/_categorias-pool.js\n' +
  '// GENERADO por pruebas/generar-categorias-pool.mjs el ' + new Date().toISOString().slice(0, 10) + ' a partir de\n' +
  '// precalcular=categorias (buscador_categorias). Solo los validos: estado "ok" (misma\n' +
  '// categoria por palabras y por nombre) y raiz de la ruta coherente con el rubro.\n' +
  '// Un producto del pool que no esta aca (ni en _categorias-datos.js) NO se muestra.\n' +
  'export const CATEGORIAS_POOL = ' + JSON.stringify(out, null, 0).replace(/\},"/g, '},\n  "').replace(/^\{"/, '{\n  "') + ';\n' +
  'export const RESUMEN_POOL = ' + JSON.stringify(resumen) + ';\n';
fs.writeFileSync(path.join(RAIZ, 'api/_categorias-pool.js'), cuerpo);
const tot = Object.values(resumen).reduce((a, r) => { Object.keys(r).forEach(x => { if (typeof r[x] === 'number') a[x] = (a[x] || 0) + r[x]; }); return a; }, {});
console.log(JSON.stringify(tot));
