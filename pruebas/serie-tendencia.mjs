// pruebas/serie-tendencia.mjs
// Se corre con: npm run test:serie
//
// serieAMeses() tiene que leer la fila que devuelve el actor de Google Trends,
// y la ficha del actor NO publica como se llaman los campos del timeline. Asi
// que el parser prueba varios nombres. Estos tests fijan ese comportamiento:
// que lea las formas plausibles, y sobre todo que cuando NO reconoce la forma
// lo DIGA en vez de inventar una curva. Una curva inventada seria el peor
// resultado posible: se mostraria como dato medido.
import { serieAMeses } from '../api/_fuentes.js';

let fallos = 0;
function ok(n, c, extra) {
  console.log((c ? '  OK   ' : '  FALLA') + ' | ' + n + (extra ? ' -> ' + extra : ''));
  if (!c) fallos++;
}

// 12 meses de puntos semanales, como los devuelve Google Trends.
function puntos(claveFecha, claveValor, formatoFecha) {
  const out = [];
  const hoy = new Date(Date.UTC(2026, 8, 1));
  for (let semana = 51; semana >= 0; semana--) {
    const d = new Date(hoy.getTime() - semana * 7 * 86400000);
    const valor = 40 + (11 - (semana % 12)) * 4;   // sube hacia el final
    const p = {};
    if (formatoFecha === 'epoch_s') p[claveFecha] = Math.floor(d.getTime() / 1000);
    else if (formatoFecha === 'epoch_ms') p[claveFecha] = d.getTime();
    else p[claveFecha] = d.toISOString().slice(0, 10);
    p[claveValor] = valor;
    out.push(p);
  }
  return out;
}

console.log('\n== Formas que TIENE que reconocer ==');
const formas = [
  ['timeline + date/value ISO',        { timeline: puntos('date', 'value', 'iso') }],
  ['values + time/value epoch(s)',     { values: puntos('time', 'value', 'epoch_s') }],
  ['data + timestamp/valor epoch(ms)', { data: puntos('timestamp', 'valor', 'epoch_ms') }],
  ['interest_over_time + date/value',  { interest_over_time: puntos('date', 'value', 'iso') }],
  ['clave desconocida, pero los puntos tienen date+value',
                                       { loQueSea: puntos('date', 'value', 'iso') }]
];
for (const [nombre, fila] of formas) {
  const r = serieAMeses(fila);
  ok(nombre, !r.error && r.monthlyData && r.monthlyData.length === 12,
     r.error ? r.error : ('12 meses, campo "' + r.campoSerie + '"'));
}

console.log('\n== Que la curva sea la de los datos, no una inventada ==');
const r = serieAMeses({ timeline: puntos('date', 'value', 'iso') });
ok('los 12 valores estan entre 0 y 100', r.values.every(v => v >= 0 && v <= 100), JSON.stringify(r.values));
ok('los meses salen en castellano', /^(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)$/.test(r.monthlyData[0].mes),
   r.monthlyData.map(m => m.mes).join(' '));
ok('no repite el mismo mes 12 veces', new Set(r.monthlyData.map(m => m.mes)).size === 12,
   r.monthlyData.map(m => m.mes).join(' '));
ok('cuenta los puntos que leyo', r.puntosLeidos === 52, String(r.puntosLeidos));

console.log('\n== Lo que importa: NO inventar cuando no entiende ==');
const malas = [
  ['fila vacia', null],
  ['sin ningun array', { keyword: 'x', averageValue: 50, peakValue: 100 }],
  ['array pero sin fecha ni valor', { timeline: [{ a: 1 }, { b: 2 }] }],
  ['solo 3 meses de 12', { timeline: puntos('date', 'value', 'iso').slice(-12) }],
  ['fechas ilegibles', { timeline: [{ date: 'ayer', value: 10 }, { date: 'hoy', value: 20 }] }]
];
for (const [nombre, fila] of malas) {
  const x = serieAMeses(fila);
  ok('devuelve error, no una curva: ' + nombre, !!x.error && !x.monthlyData,
     x.error ? String(x.error).slice(0, 70) : 'DEVOLVIO CURVA (mal)');
}

console.log('\n== El error tiene que servir para arreglarlo ==');
const desconocida = serieAMeses({ keyword: 'mordedor bebe', averageValue: 42, peakValue: 100, latestValue: 55 });
ok('dice que campos vinieron', Array.isArray(desconocida.campos) && desconocida.campos.length > 0,
   JSON.stringify(desconocida.campos));
const sinLeer = serieAMeses({ timeline: [{ a: 1 }] });
ok('dice en que campo encontro la serie y muestra un punto',
   !!sinLeer.campoSerie && !!sinLeer.muestraPunto, sinLeer.campoSerie + ' ' + sinLeer.muestraPunto);

console.log('\n== Se conserva lo que el propio actor dice de la serie ==');
const conResumen = serieAMeses(Object.assign({ timeline: puntos('date', 'value', 'iso') },
  { averageValue: 61, peakValue: 100, latestValue: 84 }));
ok('trae promedio, pico y ultimo del actor',
   conResumen.resumenDelActor && conResumen.resumenDelActor.promedio === 61 &&
   conResumen.resumenDelActor.pico === 100 && conResumen.resumenDelActor.ultimo === 84,
   JSON.stringify(conResumen.resumenDelActor));

console.log('\n' + (fallos ? '>>> FALLARON ' + fallos : '>>> TODOS LOS CHEQUEOS PASARON'));
process.exit(fallos ? 1 : 0);
