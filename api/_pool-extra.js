// api/_pool-extra.js
// Pool ampliado por rubro: productos importables de China que se suman a los
// 12 del catalogo original (api/analyze.js) para que cada semana se pueda
// elegir una seleccion distinta. Sin marcas registradas ni alimentos o
// medicamentos (en suplementos, vinos y reposteria, solo accesorios).
// FOB, volumen y peso son ESTIMADOS por tipo de producto, igual que en el
// catalogo original: la tarjeta lo dice y "Ajustar con mi cotizacion" los cambia.
import { EXTRA_1 } from './_pool-extra-1.js';
import { EXTRA_2 } from './_pool-extra-2.js';
import { EXTRA_3 } from './_pool-extra-3.js';
import { EXTRA_4 } from './_pool-extra-4.js';
import { EXTRA_5 } from './_pool-extra-5.js';
import { EXTRA_6 } from './_pool-extra-6.js';
import { EXTRA_7 } from './_pool-extra-7.js';
import { EXTRA_8 } from './_pool-extra-8.js';
import { EXTRA_9 } from './_pool-extra-9.js';
import { EXTRA_10 } from './_pool-extra-10.js';

export const EXTRA = Object.assign({}, EXTRA_1, EXTRA_2, EXTRA_3, EXTRA_4, EXTRA_5, EXTRA_6, EXTRA_7, EXTRA_8, EXTRA_9, EXTRA_10);
