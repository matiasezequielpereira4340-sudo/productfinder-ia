// pruebas/radar-filtros.mjs
// Se corre con: npm run test:radar
//
// Filtros del Radar que corren en codigo, sin Claude: licencias de personajes
// (por palabra completa, sin excepciones) y la forma canonica
// que junta singular y plural al comparar con las busquedas argentinas.
const { esLicencia, esMarca, canonico } = await import('../api/_radar.js');

let fallos = 0, oks = 0;
function chequear(n, c, extra) {
  console.log((c ? '  ok    ' : '  FALLA ') + n + (extra != null ? ' -> ' + extra : ''));
  if (c) oks++; else fallos++;
}

console.log('\n== 1. Licencias: filtro estricto por palabra completa ==');
// A proposito: tambien "cepillo sonic" o "funda cars". Un producto con marca o
// licencia no entra sin permiso del titular; mejor descartar de mas.
const licencias = [
  ['sonic', true], ['peluche sonic', true], ['cepillo sonic', true], ['limpiador ultrasonic', false],
  ['cars', true], ['funda cars', true], ['car', false],
  ['mario', true], ['super mario', true], ['marioneta', false],
  ['frozen', true], ['disfraz frozen', true]
];
for (const [t, filtra] of licencias) chequear('"' + t + '" ' + (filtra ? 'se filtra' : 'pasa'), esLicencia(t) === filtra);

console.log('\n== 2. Licencias por palabra completa ==');
for (const t of ['minions', 'bluey', 'deadpool', 'pokébola', 'pokebola', 'stitch', 'funda stitch', 'minecraft', 'among us', 'labubu'])
  chequear('"' + t + '" se filtra', esLicencia(t) === true);
for (const t of ['peluche', 'remera lisa', 'oscars', 'carsa', 'cama para gatos', 'bomba de agua'])
  chequear('"' + t + '" pasa', esLicencia(t) === false);
chequear('una licencia cuenta como marca', esMarca('peluche sonic') === true && esMarca('bomba de agua') === false);

console.log('\n== 3. Singular y plural dan la misma forma ==');
const iguales = [
  ['herramienta', 'herramientas'], ['luz', 'luces'], ['organizador', 'organizadores'],
  ['kit de herramienta', 'kit herramientas'], ['gas', 'gases'], ['mouse', 'mouses'], ['lápiz', 'lápices'],
  ['ananá', 'ananás'], ['juguete', 'juguetes'], ['llave', 'llaves'], ['dulce', 'dulces'], ['mes', 'meses'],
  ['pez', 'peces'], ['país', 'países'], ['botón', 'botones'], ['bus', 'buses'], ['pie', 'pies'],
  ['tenis', 'tenis'], ['virus', 'virus'], ['transportadora para gatos', 'transportadora gatos']
];
for (const [a, b] of iguales) chequear(a + ' = ' + b, canonico(a) === canonico(b), canonico(a) + ' / ' + canonico(b));

console.log('\n== 4. Palabras distintas no se mezclan ==');
for (const [a, b] of [['gas', 'ga'], ['mes', 'me'], ['mesa', 'mes'], ['casa', 'caso'], ['luz', 'lupa'], ['tenis', 'teni']])
  chequear(a + ' != ' + b, canonico(a) !== canonico(b), canonico(a) + ' / ' + canonico(b));

console.log('\n' + oks + ' ok, ' + fallos + ' fallas');
process.exit(fallos ? 1 : 0);
