// api/_oportunidad.js
// Evaluacion de un producto del Buscador de oportunidades.
//
// Antes cada pedazo de la tarjeta salia de un lugar distinto: el backend
// mandaba un markup sobre costo (222%) como "margen", un parche del front
// calculaba otro margen neto (40%), otro restaba precio menos costo y lo
// llamaba "dato real", y el badge "Oportunidad alta" se leia del texto del
// score en el DOM. Resultado: OPORTUNIDAD ALTA arriba y "Margen bajo, no
// conviene" abajo, en la misma tarjeta.
//
// Ahora todo sale de aca, en este orden, y el front solo dibuja:
//   costo estimado -> margen neto (margen-core.js, el mismo de MargenClear)
//   -> competencia y demanda con numeros -> perfil -> score -> veredicto.
// El veredicto, el score y el semaforo del margen salen de la misma funcion.
//
// Todo es puro (sin red): se prueba con pruebas/buscador.mjs.

import MargenCore from '../margen-core.js';
import { esMarca } from './_radar.js';

// ------------------------------------------------------------
// Costo de importacion estimado
// ------------------------------------------------------------
// El FOB sale del rango cargado a mano por producto en el catalogo (por
// categoria de producto), NO de una cotizacion. Se muestra como rango y con
// la fuente, y la tarjeta ofrece ajustarlo con la cotizacion propia.
export const USD_KG_COURIER = 12;      // flete aereo puerta a puerta, USD por kilo
export const MIN_FLETE_USD = 2.5;      // ningun envio sale menos que esto
export const RECARGO_IMPUESTOS = 1.85; // aranceles + tasa + IVA + percepciones + gastos sobre (FOB + flete)
// De ese 1,85, la parte que es IVA de importacion (21% sobre CIF + arancel +
// tasa, ~1,23): es credito fiscal y se descuenta del IVA de la venta.
const BASE_IVA_IMPORTACION = 1.23;

export function costoImportacion(prod, usdArs) {
  const fobMin = Number(prod.costoMin) || 0;
  const fobMax = Number(prod.costoMax) || fobMin;
  const fob = (fobMin + fobMax) / 2;
  const kg = Math.max(0.02, (prod.pesoG || 200) / 1000);
  const fleteUSD = Math.max(MIN_FLETE_USD, kg * USD_KG_COURIER);
  const puestoUSD = (fob + fleteUSD) * RECARGO_IMPUESTOS;
  return {
    fobMinUSD: fobMin, fobMaxUSD: fobMax, fobUSD: Math.round(fob * 100) / 100,
    fleteUSD: Math.round(fleteUSD * 100) / 100,
    costoPuestoUSD: Math.round(puestoUSD * 100) / 100,
    costoPuestoARS: Math.round(puestoUSD * usdArs),
    ivaCreditoARS: Math.round((fob + fleteUSD) * BASE_IVA_IMPORTACION * 0.21 * usdArs),
    fuente: 'estimado por categoría',
    detalle: 'FOB del rango típico de la categoría + flete courier por peso (USD ' + USD_KG_COURIER +
      '/kg) × ' + RECARGO_IMPUESTOS + ' de aranceles, tasas, IVA y gastos. No es una cotización.'
  };
}

// ------------------------------------------------------------
// Certificaciones obligatorias (heuristica por palabras)
// ------------------------------------------------------------
// Con "sin experiencia" no se recomienda arrancar por un producto que exige
// un tramite previo a la importacion. Es una alerta para confirmar con el
// despachante, no un dictamen.
const REGLAS_CERT = [
  { codigo: 'enacom', label: 'ENACOM',
    detalle: 'Equipos con conexión inalámbrica (WiFi, Bluetooth, RF) necesitan homologación de ENACOM.',
    re: /\b(wifi|wi-fi|bluetooth|inalambric[oa]s?|smart ?(plug|ring|watch)|smartwatch|rf|dron(es)?|intercomunicador|camara ip|timbre wifi|rastreador|localizador|control remoto)\b/ },
  { codigo: 'electrica', label: 'Seguridad Eléctrica',
    detalle: 'Productos que se enchufan a 220 V (o sus cargadores) requieren certificación de Seguridad Eléctrica (Res. 169/2018).',
    re: /\b(electric[oa]s?|enchufe|220 ?v|cargador(es)? (gan|de pared|auto)|cargador gan|pava|plancha|secador|calefactor|aspiradora|zapatilla usb|regleta|extractor|deshumidificador|humidificador|lampara uv|torno|depilador[a]?|recortadora|maquina de coser electrica|selladora)\b/ },
  { codigo: 'inal', label: 'INAL (contacto con alimentos)',
    detalle: 'Utensilios y envases que tocan alimentos o bebidas necesitan registro/aptitud bromatológica (INAL / Código Alimentario).',
    re: /\b(cocina|utensilios?|molde|moldes|tabla (de )?picar|tabla flexible|pelador|picador|prensa palta|rociador aceite|bolsas reutilizables alimentos|tupper|vianda|viandas|botella|botellas|vaso|vasos|termo|mate|bombilla|yerbera|sorbetes?|bowls?|cubiertos|jarra|especiero|mamadera|mordillo|babero|tapa antiderrame|shaker|coctelera|aireador|sacacorchos|tapon vacio|reposteria|manga repostera|boquillas|cortantes|capsulas cupcakes|escurridor pasta|batidor leche|espumador)\b/ },
  { codigo: 'anmat', label: 'ANMAT',
    detalle: 'Cosmética, cuidado personal y productos médicos u ortopédicos se registran en ANMAT.',
    re: /\b(crema|cremas|serum|maquillaje|skincare|parches ojeras|gel masaje|aceite masaje|ortopedic[oa]s?|rodillera ortopedica|faja lumbar|ferula|cabestrillo|doppler|sacaleche|irrigador|cepillo (de )?dientes|medias compresion|plantillas ortopedicas|talonera|corrector (de )?postura|tiras test|pastillero|suplementos?)\b/ },
  { codigo: 'juguetes', label: 'Certificación de juguetes',
    detalle: 'Los juguetes para menores de 14 años requieren certificación de seguridad de juguetes antes de despachar.',
    re: /\b(juguetes?|didactico|puzzle|pop it|slime|cubo magico|bloques magneticos|masa moldear|pista autos|figuras dinosaurios|burbujas|sonajero|peluche)\b/ }
];
// En mascotas, "juguete" y "comedero" no son juguetes infantiles ni contacto
// con alimentos humanos: no aplica la certificacion.
const NICHOS_SIN_JUGUETE = new Set(['mascotas', 'coleccionables', 'drones', 'sexshop']);
const NICHOS_SIN_INAL = new Set(['mascotas', 'agro', 'camping']);

function normalizar(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function certificaciones(prod, nichoKey) {
  const t = normalizar((prod.nombre || '') + ' ' + (prod.q || ''));
  const out = [];
  for (const r of REGLAS_CERT) {
    if (r.codigo === 'juguetes' && NICHOS_SIN_JUGUETE.has(nichoKey)) continue;
    if (r.codigo === 'inal' && NICHOS_SIN_INAL.has(nichoKey)) continue;
    if (r.re.test(t)) out.push({ codigo: r.codigo, label: r.label, detalle: r.detalle });
  }
  return out;
}

// ------------------------------------------------------------
// Competencia con numeros
// ------------------------------------------------------------
function mediana(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Saca de la muestra las publicaciones con marca o licencia (no se pueden
// importar sin permiso del titular) y las que no tienen precio.
export function limpiarMuestra(results) {
  return (Array.isArray(results) ? results : [])
    .filter(x => x && typeof x.price === 'number' && x.price > 0)
    .filter(x => !esMarca(x.title || ''));
}

// Precios fuera de [0,8 x costo, 5 x costo] casi siempre son otro producto
// (repuestos, packs, kits premium). Antes el piso era 1,3 x costo, lo que
// escondia justamente el caso que importa: el mercado vende por debajo de lo
// que te cuesta traerlo.
export function acotarPorCosto(results, costoPuestoARS) {
  if (!(costoPuestoARS > 0)) return results;
  const min = costoPuestoARS * 0.8, max = costoPuestoARS * 5;
  return results.filter(x => x.price >= min && x.price <= max);
}

export function estadisticasCompetencia(results, total) {
  const r = Array.isArray(results) ? results : [];
  const precios = r.map(x => x.price).sort((a, b) => a - b);
  const conLogistica = r.filter(x => x.shipping && typeof x.shipping.logistic_type === 'string');
  const conTienda = r.filter(x => 'official_store_id' in x);
  const conVendidos = r.filter(x => typeof x.sold_quantity === 'number' && x.sold_quantity > 0);
  const top10 = r.slice(0, 10);
  const vendTop = new Set(top10.map(x => x.seller && x.seller.id).filter(Boolean));
  return {
    muestra: r.length,
    totalCatalogo: (typeof total === 'number' && total > 0) ? total : null,
    precioMin: precios.length ? Math.round(precios[0]) : null,
    precioMediana: precios.length ? Math.round(mediana(precios)) : null,
    precioMax: precios.length ? Math.round(precios[precios.length - 1]) : null,
    pctFull: conLogistica.length >= 3
      ? Math.round(conLogistica.filter(x => x.shipping.logistic_type === 'fulfillment').length / conLogistica.length * 100) : null,
    pctOficiales: conTienda.length >= 3
      ? Math.round(conTienda.filter(x => x.official_store_id).length / conTienda.length * 100) : null,
    pctEnvioGratis: r.length ? Math.round(r.filter(x => x.shipping && x.shipping.free_shipping).length / r.length * 100) : null,
    top10: top10.length,
    vendedoresTop10: top10.length && vendTop.size ? vendTop.size : null,
    vendidosMuestra: conVendidos.length ? conVendidos.reduce((a, x) => a + x.sold_quantity, 0) : null
  };
}

// Componente "competencia" (100 = poca competencia). Recalibrado: con el
// umbral viejo (<2.000 = "Baja") un producto con 1.331 productos de catalogo
// salia "saturacion baja" y casi todo terminaba en riesgo bajo.
export function puntajeCompetencia(c) {
  if (!c || (c.totalCatalogo == null && !c.muestra)) return { valor: null, detalle: 'Sin datos de competencia' };
  const t = c.totalCatalogo;
  let v = t == null ? 50 : t < 100 ? 90 : t < 300 ? 78 : t < 800 ? 62 : t < 2000 ? 45 : t < 5000 ? 30 : 15;
  const notas = [];
  if (t != null) notas.push(t.toLocaleString('es-AR') + ' productos en catálogo');
  if (c.pctFull != null) {
    if (c.pctFull >= 50) { v -= 15; notas.push(c.pctFull + '% en Full (vendedores profesionales)'); }
    else if (c.pctFull >= 25) { v -= 7; notas.push(c.pctFull + '% en Full'); }
    else notas.push(c.pctFull + '% en Full');
  }
  if (c.pctOficiales != null && c.pctOficiales >= 20) { v -= 10; notas.push(c.pctOficiales + '% tiendas oficiales'); }
  if (c.vendedoresTop10 != null && c.top10 >= 5) {
    if (c.vendedoresTop10 <= 3) { v -= 10; notas.push('top ' + c.top10 + ' en manos de ' + c.vendedoresTop10 + ' vendedores'); }
    else if (c.vendedoresTop10 >= 8) { v += 5; notas.push('top ' + c.top10 + ' repartido en ' + c.vendedoresTop10 + ' vendedores'); }
  }
  v = Math.max(0, Math.min(100, Math.round(v)));
  return { valor: v, detalle: notas.join(' · ') };
}

export function saturacionDe(valor) {
  if (valor == null) return 'Sin dato';
  return valor >= 70 ? 'Baja' : valor >= 50 ? 'Media' : valor >= 30 ? 'Alta' : 'Muy alta';
}

// Componente "demanda". Sin vendidos ni tendencia no se inventa: queda null y
// el score se arma con los otros componentes, avisandolo.
export function puntajeDemanda(c, enTendencia) {
  if (c && c.vendidosMuestra != null) {
    const s = c.vendidosMuestra;
    const v = s >= 500 ? 90 : s >= 100 ? 70 : s >= 20 ? 50 : 25;
    return { valor: v, nivel: v >= 70 ? 'Alta' : v >= 50 ? 'Media' : 'Baja',
      detalle: s.toLocaleString('es-AR') + ' vendidos en las ' + c.muestra + ' publicaciones de la muestra' };
  }
  if (enTendencia) {
    return { valor: 75, nivel: 'En tendencia',
      detalle: 'Aparece entre las búsquedas más frecuentes de MercadoLibre en su categoría ("' + enTendencia + '")' };
  }
  return { valor: null, nivel: 'Sin dato',
    detalle: 'MercadoLibre no informa vendidos para estas publicaciones y no aparece en sus tendencias: validá la demanda antes de comprar.' };
}

// ------------------------------------------------------------
// Canal de venta: cambia precio, comision y envio
// ------------------------------------------------------------
// Valores de referencia (se pueden recalibrar por variable de entorno sin
// tocar codigo). Todos se muestran como estimados en la tarjeta.
const UMBRAL_ENVIO_GRATIS = Number(process.env.MELI_UMBRAL_ENVIO_GRATIS || 33000);
function envioMeliEstimado(pesoG) {
  const g = pesoG || 200;
  const base = Number(process.env.MELI_ENVIO_BASE_ARS || 6500);
  return Math.round(g <= 500 ? base : g <= 1000 ? base * 1.3 : base * 1.7);
}

export const COMISION_RESPALDO_PCT = 14;

export function condicionesCanal(canal, precioMercado, pesoG, comisionMeli) {
  const c = String(canal || 'mercadolibre');
  if (c === 'mayorista') {
    return { canal: c, etiqueta: 'Mayorista', precio: Math.round(precioMercado * 0.55),
      comisionBasePct: 0, cargoFijo: 0, envio: 0,
      notaPrecio: 'Precio mayorista estimado: 55% de la mediana minorista de MercadoLibre.',
      notaComision: 'Sin comisión de plataforma.' };
  }
  if (c === 'local') {
    return { canal: c, etiqueta: 'Local físico', precio: precioMercado,
      comisionBasePct: 3, cargoFijo: 0, envio: 0,
      notaPrecio: 'Precio de referencia: mediana de MercadoLibre.',
      notaComision: 'Cobro con tarjeta/QR estimado en 3%. Sin envío.' };
  }
  if (c === 'tiendanube') {
    return { canal: c, etiqueta: 'Tienda Nube', precio: precioMercado,
      comisionBasePct: 6, cargoFijo: 0, envio: 0,
      notaPrecio: 'Precio de referencia: mediana de MercadoLibre.',
      notaComision: 'Pasarela de pago + costo por transacción estimados en 6%. Envío a cargo del comprador.' };
  }
  const real = comisionMeli && comisionMeli.porcentaje > 0;
  const envio = precioMercado >= UMBRAL_ENVIO_GRATIS ? envioMeliEstimado(pesoG) : 0;
  return { canal: 'mercadolibre', etiqueta: 'MercadoLibre', precio: precioMercado,
    comisionBasePct: real ? comisionMeli.porcentaje : COMISION_RESPALDO_PCT,
    cargoFijo: real ? (comisionMeli.cargoFijo || 0) : 0,
    envio,
    comisionReal: !!real,
    notaPrecio: 'Mediana de las publicaciones comparables en MercadoLibre.',
    notaComision: real
      ? 'Comisión clásica de MercadoLibre para esta categoría (dato de la API de MeLi).'
      : 'Comisión clásica estimada en ' + COMISION_RESPALDO_PCT + '% (MeLi no respondió para esta categoría).',
    notaEnvio: envio
      ? 'Envío gratis obligatorio desde $' + UMBRAL_ENVIO_GRATIS.toLocaleString('es-AR') + ': estimado por peso.'
      : 'Debajo de $' + UMBRAL_ENVIO_GRATIS.toLocaleString('es-AR') + ' el envío lo paga el comprador.' };
}

// Una sola metrica: margen neto sobre el precio de venta.
export function margenNeto(cond, costo) {
  const u = MargenCore.calcularUnidad(Object.assign({}, MargenCore.DEFAULTS, {
    precio: cond.precio, costo: costo.costoPuestoARS,
    comisionBasePct: cond.comisionBasePct, cargoFijo: cond.cargoFijo, envio: cond.envio,
    ivaVentaPct: 21, ivaCreditoARS: costo.ivaCreditoARS
  }));
  return {
    pct: Math.round(u.margenPct * 10) / 10,
    netoARS: Math.round(u.ganReal),
    desglose: {
      precio: Math.round(u.precio), costo: Math.round(u.costo),
      comision: Math.round(u.comisionARS), envio: Math.round(u.envioARS),
      iibb: Math.round(u.iibbARS), iva: Math.round(u.ivaNetoARS), devoluciones: Math.round(u.impactoDevARS)
    }
  };
}

// ------------------------------------------------------------
// Perfil: capital y experiencia
// ------------------------------------------------------------
// Capital de referencia por rango (USD). Se toma un valor conservador dentro
// del rango y se usa hasta el 60% en un solo producto: el resto queda para
// imprevistos, publicidad y la segunda compra.
export const CAPITAL_USD = { bajo: 2000, medio: 6000, alto: 18000, premium: 40000 };
export const CAPITAL_LABEL = { bajo: 'menos de USD 3.000', medio: 'USD 3.000 - 10.000', alto: 'USD 10.000 - 30.000', premium: 'más de USD 30.000' };
const FRACCION_POR_PRODUCTO = 0.6;

// MOQ tipico (negociado) de proveedor en Alibaba segun el FOB unitario.
export function moqTipico(fobUSD) {
  return fobUSD < 1 ? 300 : fobUSD < 3 ? 200 : fobUSD < 6 ? 100 : 50;
}

export function capacidadDeCompra(costo, capitalKey) {
  const capital = CAPITAL_USD[capitalKey] || CAPITAL_USD.bajo;
  const presupuesto = capital * FRACCION_POR_PRODUCTO;
  const moq = moqTipico(costo.fobUSD);
  const inversionMoqUSD = Math.round(moq * costo.costoPuestoUSD);
  const unidadesPosibles = costo.costoPuestoUSD > 0 ? Math.floor(presupuesto / costo.costoPuestoUSD) : 0;
  return { capitalReferenciaUSD: capital, presupuestoUSD: presupuesto, moq, inversionMoqUSD,
    unidadesPosibles, alcanza: inversionMoqUSD <= presupuesto };
}

const PENAL_CERT = { ninguna: 50, poca: 35, media: 20, alta: 10 };

export function puntajeRiesgo(prod, comp, certs, experiencia) {
  let v = 100;
  const notas = [];
  if (prod.pesoG > 500) { v -= 20; notas.push('pesado (' + prod.pesoG + ' g): flete caro'); }
  else if (prod.pesoG > 300) { v -= 10; notas.push(prod.pesoG + ' g'); }
  if (certs.length) {
    const p = Math.min(70, (PENAL_CERT[experiencia] != null ? PENAL_CERT[experiencia] : 35) + (certs.length - 1) * 10);
    v -= p;
    notas.push('requiere ' + certs.map(c => c.label).join(' + ') +
      (experiencia === 'ninguna' ? ' (no recomendado para la primera importación)' : ''));
  }
  if (comp && comp.precioMin && comp.precioMax && comp.precioMax / comp.precioMin > 4) {
    v -= 10; notas.push('precios muy dispersos: mercado poco claro');
  }
  if (comp && comp.muestra > 0 && comp.muestra < 5) { v -= 15; notas.push('muestra chica (' + comp.muestra + ' publicaciones)'); }
  v = Math.max(0, Math.min(100, Math.round(v)));
  return { valor: v, detalle: notas.length ? notas.join(' · ') : 'Liviano, sin certificaciones previas detectadas' };
}

export function riesgoDe(valor) { return valor >= 70 ? 'Bajo' : valor >= 45 ? 'Medio' : 'Alto'; }

// ------------------------------------------------------------
// Score y veredicto: UNA funcion
// ------------------------------------------------------------
export const PESOS = {
  bajo:  { margen: 35, demanda: 20, competencia: 25, riesgo: 20 },
  medio: { margen: 40, demanda: 25, competencia: 25, riesgo: 10 },
  alto:  { margen: 45, demanda: 25, competencia: 25, riesgo: 5 }
};
export const MARGEN_MIN_ALTA = 30;   // por debajo, nunca "Oportunidad alta"
export const MARGEN_MIN_VIABLE = 15; // por debajo, "no conviene"

export function puntajeMargen(pct) {
  if (pct == null) return null;
  const tramos = [[0, 0], [10, 25], [20, 50], [30, 75], [35, 85], [45, 100]];
  if (pct <= 0) return 0;
  if (pct >= 45) return 100;
  for (let i = 1; i < tramos.length; i++) {
    const [x1, y1] = tramos[i], [x0, y0] = tramos[i - 1];
    if (pct <= x1) return Math.round(y0 + (y1 - y0) * (pct - x0) / (x1 - x0));
  }
  return 100;
}

export function semaforoMargen(pct) {
  if (pct == null) return { color: 'gris', label: 'Margen sin calcular' };
  if (pct >= MARGEN_MIN_ALTA) return { color: 'verde', label: 'Margen sano' };
  if (pct >= MARGEN_MIN_VIABLE) return { color: 'amarillo', label: 'Margen ajustado' };
  return { color: 'rojo', label: 'Margen bajo, no conviene' };
}

// e = { margenPct, competencia:{valor,detalle}, demanda:{valor,detalle},
//       riesgo:{valor,detalle}, riesgoTolerancia, capacidad }
export function evaluar(e) {
  const pesos = PESOS[e.riesgoTolerancia] || PESOS.medio;
  const componentes = [
    { clave: 'margen', label: 'Margen neto', valor: puntajeMargen(e.margenPct), peso: pesos.margen,
      detalle: e.margenPct != null ? e.margenPct.toLocaleString('es-AR') + '% neto sobre el precio de venta' : 'Sin precio de venta real' },
    { clave: 'demanda', label: 'Demanda', valor: e.demanda.valor, peso: pesos.demanda, detalle: e.demanda.detalle },
    { clave: 'competencia', label: 'Competencia', valor: e.competencia.valor, peso: pesos.competencia, detalle: e.competencia.detalle },
    { clave: 'riesgo', label: 'Riesgo operativo', valor: e.riesgo.valor, peso: pesos.riesgo, detalle: e.riesgo.detalle }
  ];
  const usados = componentes.filter(c => c.valor != null);
  const pesoUsado = usados.reduce((a, c) => a + c.peso, 0);
  componentes.forEach(c => {
    c.pesoEfectivo = c.valor != null && pesoUsado ? Math.round(c.peso / pesoUsado * 100) : 0;
    c.aporte = c.valor != null && pesoUsado ? Math.round(c.valor * c.peso / pesoUsado * 10) / 10 : 0;
  });
  const ajustes = [];
  if (e.capacidad && !e.capacidad.alcanza) {
    ajustes.push({ label: 'El pedido mínimo (~' + e.capacidad.moq + ' u, USD ' + e.capacidad.inversionMoqUSD.toLocaleString('es-AR') +
      ') supera el ' + Math.round(FRACCION_POR_PRODUCTO * 100) + '% de tu capital', puntos: -15 });
  }

  // Sin margen calculable no hay score: no se puede decidir una compra.
  if (e.margenPct == null) {
    return { score: null, componentes, ajustes,
      veredicto: { nivel: 'sin_dato', label: 'Sin datos de mercado', motivos: ['No hay precio de venta real para calcular el margen.'] },
      semaforo: semaforoMargen(null) };
  }
  const base = pesoUsado ? usados.reduce((a, c) => a + c.valor * c.peso, 0) / pesoUsado : 0;
  const score = Math.max(0, Math.min(100, Math.round(base + ajustes.reduce((a, x) => a + x.puntos, 0))));
  const semaforo = semaforoMargen(e.margenPct);

  const motivos = [];
  let nivel;
  if (e.margenPct < MARGEN_MIN_VIABLE) {
    nivel = 'baja';
    motivos.push('Margen neto de ' + e.margenPct.toLocaleString('es-AR') + '%: no cubre imprevistos.');
  } else {
    if (e.margenPct < MARGEN_MIN_ALTA) motivos.push('Margen neto menor a ' + MARGEN_MIN_ALTA + '%.');
    if (e.demanda.valor == null) motivos.push('Falta validar la demanda.');
    if (e.capacidad && !e.capacidad.alcanza) motivos.push('No te alcanza el capital para el pedido mínimo típico.');
    if (score >= 70 && motivos.length === 0) nivel = 'alta';
    else if (score >= 50) nivel = 'media';
    else { nivel = 'baja'; if (!motivos.length) motivos.push('Score menor a 50.'); }
  }
  const labels = { alta: 'Oportunidad alta', media: 'Oportunidad media', baja: e.margenPct < MARGEN_MIN_VIABLE ? 'No conviene' : 'Requiere validación' };
  return { score, componentes, ajustes, veredicto: { nivel, label: labels[nivel], motivos }, semaforo };
}

// ------------------------------------------------------------
// Links (todos armados, sin costo)
// ------------------------------------------------------------
function slugListado(q) {
  return String(q || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

function urlPublicacion(x) {
  if (!x) return null;
  if (x.permalink && /^https:\/\/[a-z.]*mercadolibre\.com\.ar\//.test(x.permalink)) return x.permalink;
  const m = /^MLA(\d+)$/.exec(String(x.id || ''));
  if (m) return 'https://articulo.mercadolibre.com.ar/MLA-' + m[1] + '-_JM';
  if (x.catalog_product_id && /^MLA\d+$/.test(x.catalog_product_id)) return 'https://www.mercadolibre.com.ar/p/' + x.catalog_product_id;
  return null;
}

export function linksDe(prod, results) {
  const q = prod.q || prod.nombre || '';
  const en = prod.keyword_en || q;
  const r = Array.isArray(results) ? results : [];
  const conVendidos = r.filter(x => typeof x.sold_quantity === 'number' && x.sold_quantity > 0);
  const top = conVendidos.length
    ? conVendidos.reduce((a, x) => (x.sold_quantity > a.sold_quantity ? x : a))
    : r[0];
  return {
    meli: 'https://listado.mercadolibre.com.ar/' + slugListado(q),
    publicacion: urlPublicacion(top),
    publicacionEsMasVendida: conVendidos.length > 0,
    alibaba: 'https://www.alibaba.com/trade/search?SearchText=' + encodeURIComponent(en),
    s1688: 'https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(en),
    tendencia: 'https://trends.google.com/trends/explore?geo=AR&q=' + encodeURIComponent(q)
  };
}

// Coincidencia del termino con las tendencias de MeLi: alcanza con que una
// keyword en tendencia contenga todas las palabras significativas del
// producto, o al revés.
export function enTendencias(q, keywords) {
  const ignorar = new Set(['de', 'para', 'con', 'set', 'pack', 'mini', 'y', 'la', 'el', 'en', 'sin']);
  const palabras = normalizar(q).split(/\s+/).filter(w => w.length > 2 && !ignorar.has(w));
  if (!palabras.length || !Array.isArray(keywords)) return null;
  const nucleo = palabras.slice(0, 2);
  for (const k of keywords) {
    const kn = normalizar(k);
    if (nucleo.every(w => kn.includes(w.replace(/s$/, '')))) return k;
  }
  return null;
}

// ------------------------------------------------------------
// Armado final de un producto
// ------------------------------------------------------------
// mercado = { results, total, categoryName, comision, tendencia, guardadoEn } o null
export function evaluarProducto(prod, nichoKey, mercado, perfil, usdArs) {
  const costo = costoImportacion(prod, usdArs);
  const certs = certificaciones(prod, nichoKey);
  const capacidad = capacidadDeCompra(costo, perfil.capital);
  const limpios = mercado ? limpiarMuestra(mercado.results) : [];
  const acotados = acotarPorCosto(limpios, costo.costoPuestoARS);
  const comp = estadisticasCompetencia(acotados, mercado ? mercado.total : null);
  const links = linksDe(prod, acotados.length ? acotados : limpios);
  const base = {
    nombre: prod.nombre, query: prod.q, keyword_en: prod.keyword_en || null, nota: prod.nota, pesoG: prod.pesoG,
    costo, certificaciones: certs, capacidad, links, competencia: comp,
    categoria: (mercado && mercado.categoryName) || null
  };

  // Menos de 3 precios comparables: no alcanza para una mediana confiable.
  if (!mercado || comp.muestra < 3) {
    const compP = puntajeCompetencia(comp.muestra ? comp : (mercado ? { totalCatalogo: comp.totalCatalogo, muestra: 0 } : null));
    const riesgo = puntajeRiesgo(prod, comp, certs, perfil.experiencia);
    const ev = evaluar({ margenPct: null, competencia: compP, demanda: puntajeDemanda(null, null), riesgo,
      riesgoTolerancia: perfil.riesgo, capacidad });
    return Object.assign(base, {
      fuente: mercado ? 'MercadoLibre (muestra insuficiente)' : 'Sin datos de mercado',
      precioVentaARS: null, margen: null, margenNeto: null,
      demanda: 'Sin dato', saturacion: saturacionDe(compP.valor), riesgo: riesgoDe(riesgo.valor),
      score: null, componentes: ev.componentes, ajustes: ev.ajustes, veredicto: ev.veredicto, semaforo: ev.semaforo,
      competenciaSinDatos: !mercado,
      muestraInsuficiente: !!mercado
    });
  }

  const cond = condicionesCanal(perfil.canal, comp.precioMediana, prod.pesoG, mercado.comision);
  const mn = margenNeto(cond, costo);
  const compP = puntajeCompetencia(comp);
  const dem = puntajeDemanda(comp, mercado.tendencia || null);
  const riesgo = puntajeRiesgo(prod, comp, certs, perfil.experiencia);
  const ev = evaluar({ margenPct: mn.pct, competencia: compP, demanda: dem, riesgo, riesgoTolerancia: perfil.riesgo, capacidad });
  return Object.assign(base, {
    fuente: 'MercadoLibre (real)',
    precioVentaARS: cond.precio, precioMercadoARS: comp.precioMediana,
    canal: { clave: cond.canal, etiqueta: cond.etiqueta, notaPrecio: cond.notaPrecio, notaComision: cond.notaComision,
      notaEnvio: cond.notaEnvio || null, comisionPct: cond.comisionBasePct, comisionReal: !!cond.comisionReal },
    margen: mn.pct, margenNeto: mn,
    demanda: dem.nivel, demandaDetalle: dem.detalle,
    saturacion: saturacionDe(compP.valor), riesgo: riesgoDe(riesgo.valor),
    score: ev.score, componentes: ev.componentes, ajustes: ev.ajustes, veredicto: ev.veredicto, semaforo: ev.semaforo
  });
}

// Orden: primero los que tienen score, despues por score, y los que no le
// alcanzan el capital al final de su grupo.
export function ordenar(lista) {
  const rango = p => p.veredicto && p.veredicto.nivel === 'sin_dato' ? 2 : 0;
  return lista.slice().sort((a, b) => (rango(a) - rango(b)) ||
    ((a.capacidad.alcanza ? 0 : 1) - (b.capacidad.alcanza ? 0 : 1)) ||
    ((b.score || 0) - (a.score || 0)));
}
