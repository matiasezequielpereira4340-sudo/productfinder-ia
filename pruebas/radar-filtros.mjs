// pruebas/radar-filtros.mjs
// Se corre con: npm run test:radar
//
// Filtros del Radar que corren en codigo, sin Claude: licencias de personajes
// (los nombres ambiguos solo con contexto de personaje) y la forma canonica
// que junta singular y plural al comparar con las busquedas argentinas.
const { esLicencia, esMarca, canonico } = await import('../api/_radar.js');

let fallos = 0, oks = 0;
function chequear(n, c, extra) {
  console.log((c ? '  ok    ' : '  FALLA ') + n + (extra != null ? ' -> ' + extra : ''));
  if (c) oks++; else fallos++;
}

console.log('\n== 1. Licencias: nombres ambiguos solo con contexto de personaje ==');
const licencias = [
  ['cepillo sonic', false], ['cepillo sónico', false], ['limpiador ultrasonic', false],
  ['peluche sonic', true], ['figura sonic', true], ['sonic', true],
  ['cars', true], ['funda cars', false], ['car', false], ['juguete cars', true], ['mochila cars', true],
  ['mario', true], ['marioneta', false], ['super mario', true], ['muñeco mario', true],
  ['frozen', true], ['comida frozen', false], ['disfraz frozen', true], ['tazas frozen', true]
];
for (const [t, filtra] of licencias) chequear('"' + t + '" ' + (filtra ? 'se filtra' : 'pasa'), esLicencia(t) === filtra);

console.log('\n== 2. Licencias por palabra completa ==');
for (const t of ['minions', 'bluey', 'deadpool', 'pokébola', 'pokebola', 'stitch', 'funda stitch', 'minecraft', 'among us', 'labubu'])
  chequear('"' + t + '" se filtra', esLicencia(t) === true);
for (const t of ['peluche', 'remera lisa', 'oscars', 'carsa', 'cama para gatos', 'bomba de agua'])
  chequear('"' + t + '" pasa', esLicencia(t) === false);
chequear('una licencia cuenta como marca', esMarca('peluche sonic') === true && esMarca('cepillo sonic') === false);

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
