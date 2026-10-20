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
//
// Logistica: carga consolidada maritima, USD por m3 puerta a puerta
// (FLETE_USD_M3, 450 por defecto: flete + despacho + gastos) x el volumen
// empaquetado de cada producto (volCm3 en el catalogo, estimado). Tributos
// aparte, en margen-core.js. Reemplaza el modelo courier (minimo USD 2,50/u x
// 1,85), que hacia inviable cualquier producto barato.
export const FLETE_USD_M3 = () => Number(process.env.FLETE_USD_M3 || 450);

// Derecho de importacion estimado POR RUBRO (sin NCM no hay posicion exacta):
// la tarjeta lo dice y en "Ajustar con mi cotizacion" se cambia.
const DI_POR_RUBRO = {
  juguetes: 35, moda: 35, calzado: 35, textil: 26, tejido: 26, bebes: 25,
  tecnologia: 16, celulares: 16, informatica: 14, audio: 20, fotografia: 16, smartwatch: 16, domotica: 16, seguridad: 16,
  drones: 20, gaming: 20, energiasolar: 14, agro: 14, ortopedia: 14
};
export const DI_DEFAULT = 20;
export function derechoImportacion(nichoKey) { return DI_POR_RUBRO[nichoKey] != null ? DI_POR_RUBRO[nichoKey] : DI_DEFAULT; }

export function costoImportacion(prod, usdArs, nichoKey) {
  const fobMin = Number(prod.costoMin) || 0;
  const fobMax = Number(prod.costoMax) || fobMin;
  const fob = (fobMin + fobMax) / 2;
  const vol = Number(prod.volCm3) > 0 ? Number(prod.volCm3) : 1000;
  const di = derechoImportacion(nichoKey);
  const c = MargenCore.costoImportacion({ fobUSD: fob, volCm3: vol, fleteUsdM3: FLETE_USD_M3(), diPct: di, usdArs });
  return Object.assign(c, {
    fobMinUSD: fobMin, fobMaxUSD: fobMax,
    // Compatibilidad con el resto del modulo: costo que NO se recupera.
    costoPuestoUSD: c.costoUSD, costoPuestoARS: c.costoARS,
    ivaCreditoARS: c.creditoIvaARS,
    volEstimado: !(Number(prod.volCm3) > 0),
    fuente: 'estimado por categoría',
    detalle: 'FOB del rango típico de la categoría + logística marítima consolidada (' + vol.toLocaleString('es-AR') + ' cm³/u estimado × USD ' +
      FLETE_USD_M3() + '/m³ puerta a puerta) + derecho de importación ' + di + '% (estimado por rubro, sin NCM) + tasa de estadística 3%. ' +
      'IVA 21% e IVA adicional 20% son crédito fiscal; Ganancias 6% e IIBB 2,5% son pagos a cuenta. No es una cotización.'
  });
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

// Precios por encima de 12 x costo casi siempre son otro producto (kits,
// packs, versiones premium) y se descartan. Era 5 x con el costo courier; con
// el maritimo consolidado el costo puesto baja mucho y un markup de 5-10x es
// normal en importacion chica (medidor laser: FOB USD 5,5 -> $55.000).
// Por ABAJO no hay piso: medido con datos reales, el "juguete de plumas para
// gato" se vendia por debajo de lo que costaba traerlo; con piso quedaba como
// "sin ofertas comparables" en vez de mostrar ese dato.
export const TOPE_PRECIO_X_COSTO = 12;
export function acotarPorCosto(results, costoPuestoARS) {
  if (!(costoPuestoARS > 0)) return results;
  const max = costoPuestoARS * TOPE_PRECIO_X_COSTO;
  return results.filter(x => x.price <= max);
}

export function estadisticasCompetencia(results, total) {
  const r = Array.isArray(results) ? results : [];
  const precios = r.map(x => x.price).sort((a, b) => a - b);
  const conLogistica = r.filter(x => x.shipping && typeof x.shipping.logistic_type === 'string');
  const conTienda = r.filter(x => 'official_store_id' in x);
  const conVendidos = r.filter(x => typeof x.sold_quantity === 'number' && x.sold_quantity > 0);
  const top10 = r.slice(0, 10);
  const vendTop = new Set(top10.map(x => x.seller && x.seller.id).filter(Boolean));
  const vendTodos = new Set(r.map(x => x.seller && x.seller.id).filter(Boolean));
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
    vendedoresDistintos: vendTodos.size || null,
    vendidosMuestra: conVendidos.length ? conVendidos.reduce((a, x) => a + x.sold_quantity, 0) : null
  };
}

const fmt = n => Number(n).toLocaleString('es-AR');
function nivel3(v, alto, medio) { return v == null ? 'Sin dato' : v >= alto ? 'Alta' : v >= medio ? 'Media' : 'Baja'; }

// ------------------------------------------------------------
// DEMANDA: tendencias de busqueda de MeLi en la categoria (+ vendidos si
// MeLi los devolviera). /highlights (mas vendidos) da 403 con el token.
// ------------------------------------------------------------
export function puntajeDemanda(c, mercado) {
  const tend = mercado && mercado.tendencia;
  const cat = mercado && mercado.categoria;
  const nombreCat = cat && cat.nombre ? '"' + cat.nombre + '"' : 'su categoría';
  if (c && c.vendidosMuestra != null) {
    const s = c.vendidosMuestra;
    const v = s >= 500 ? 90 : s >= 100 ? 70 : s >= 20 ? 50 : 25;
    return { valor: v, nivel: nivel3(v, 70, 50), numero: fmt(s) + ' vendidos',
      detalle: fmt(s) + ' vendidos en las ' + c.muestra + ' publicaciones de la muestra',
      como: 'Suma de vendidos que informa MercadoLibre en las publicaciones comparables.' };
  }
  if (tend && tend.posicion) {
    // Posicion relativa dentro de la lista de la categoria (MeLi devuelve
    // entre ~5 y 50 busquedas segun la categoria). Si coincide con el producto:
    // 92 (#1) a 70 (ultima). Si coincide con la busqueda general del rubro
    // ("comederos para perros" para un comedero antivoracidad): 70 a 55, o sea
    // Media: hay demanda de la categoria, no esta medida la del producto.
    const p = tend.posicion, n = Math.max(tend.total || 1, 1);
    const rel = n > 1 ? (p - 1) / (n - 1) : 0;
    const generico = tend.tipo === 'generico';
    const v = Math.round(generico ? 70 - rel * 15 : 92 - rel * 22);
    return { valor: v, nivel: nivel3(v, 70, 55), numero: (generico ? 'rubro #' : '#') + p + ' de ' + n + ' búsquedas',
      detalle: '"' + tend.keyword + '" está #' + p + ' de ' + n + ' en las búsquedas top de ' + nombreCat +
        (generico ? ' (es la búsqueda general del rubro, no la de este producto)' : ''),
      como: 'Posición en /trends de MercadoLibre para la categoría del producto (sus búsquedas más frecuentes y de mayor crecimiento de la semana). Si la búsqueda es la del producto: #1 = 92 puntos, la última = 70. Si es la búsqueda general del rubro: 70 a 55. MeLi no informa vendidos por publicación y /highlights (más vendidos) responde 403.' };
  }
  if (cat && cat.tendenciasRevisadas) {
    return { valor: 30, nivel: 'Baja', numero: '0 de ' + cat.tendenciasRevisadas,
      detalle: 'No aparece entre las ' + cat.tendenciasRevisadas + ' búsquedas top de ' + nombreCat,
      como: 'Se buscó el producto en las ' + cat.tendenciasRevisadas + ' búsquedas que MercadoLibre informa para su categoría (/trends). No estar ahí no es cero demanda, pero sí que no es de lo más buscado. MeLi no informa vendidos por publicación.' };
  }
  return { valor: null, nivel: 'Sin dato', numero: '—', detalle: 'Sin datos de búsqueda de MercadoLibre para su categoría.',
    como: 'MercadoLibre no devolvió tendencias para la categoría y no informa vendidos por publicación.' };
}

// ------------------------------------------------------------
// ROTACION: vendidos reales (Apify, proceso nocturno, top 3 por nicho)
// ------------------------------------------------------------
// hist = { ultimo: {estado, motivo}, cosechadas: [mas nueva, anterior] } de
// api/_rotacion.js. MeLi muestra los vendidos en rangos ("+100", "+5 mil") y
// sin fecha de publicacion: con UNA medicion solo hay acumulado; con DOS, la
// variacion. Las reseñas son exactas: ventas del periodo por publicacion =
// max(salto de rango, delta reseñas x vendidos/reseñas de esa publicacion).
const fechaCorta = d => { const x = new Date(d); return String(x.getUTCDate()).padStart(2, '0') + '/' + String(x.getUTCMonth() + 1).padStart(2, '0'); };

export function ventasEntreMediciones(nueva, anterior) {
  const dias = (new Date(nueva.medido_en) - new Date(anterior.medido_en)) / 86400e3;
  if (!(dias >= 2)) return null;
  const antes = {};
  (anterior.items || []).forEach(i => { if (i && i.id) antes[i.id] = i; });
  let ventas = 0, comparadas = 0;
  for (const i of (nueva.items || [])) {
    const a = antes[i.id];
    if (!a) continue;
    comparadas++;
    const saltoRango = (typeof i.vendidos === 'number' && typeof a.vendidos === 'number') ? Math.max(0, i.vendidos - a.vendidos) : 0;
    let porResenas = 0;
    if (typeof i.reviews === 'number' && typeof a.reviews === 'number' && i.reviews > a.reviews) {
      // Vendidos por reseña de ESA publicacion (piso del rango / reseñas); si no
      // hay como calcularlo, 10 (conservador).
      const ratio = (i.vendidos && i.reviews) ? Math.max(1, i.vendidos / i.reviews) : 10;
      porResenas = (i.reviews - a.reviews) * ratio;
    }
    ventas += Math.max(saltoRango, porResenas);
  }
  if (!comparadas) return null;
  return { ventasMes: Math.round(ventas / dias * 30), dias: Math.round(dias), comparadas,
    desde: anterior.medido_en, hasta: nueva.medido_en };
}

export function puntajeRotacion(hist) {
  const h = hist || {};
  const ult = h.ultimo || null;
  const cos = h.cosechadas || [];
  const comoBase = 'Vendidos reales de las publicaciones top del producto (Apify, página de detalle de MercadoLibre), medidos de noche para los 3 mejores productos de cada rubro por demanda + saturación. MeLi muestra los vendidos en rangos ("+100", "+5 mil"): se toma el piso. ';
  if (cos.length >= 2) {
    const v = ventasEntreMediciones(cos[0], cos[1]);
    if (v) {
      const m = v.ventasMes;
      const valor = m >= 300 ? 90 : m >= 100 ? 75 : m >= 30 ? 55 : m >= 10 ? 40 : 20;
      return { valor, nivel: nivel3(valor, 70, 45), numero: '≈ ' + fmt(m) + ' ventas/mes',
        detalle: '≈ ' + fmt(m) + ' ventas/mes en ' + v.comparadas + ' publicaciones top, medido entre el ' + fechaCorta(v.desde) + ' y el ' + fechaCorta(v.hasta) + ' (' + v.dias + ' días)',
        como: comoBase + 'Ventas/mes = ventas entre dos mediciones ÷ días × 30. Por publicación: el salto de rango de vendidos o, si es mayor, el aumento de reseñas (exactas) × vendidos/reseñas de esa publicación. Es una estimación: MeLi no publica vendidos exactos.',
        tipo: 'variacion' };
    }
  }
  if (cos.length >= 1) {
    const c = cos[0];
    const t = c.vendidos_total;
    if (typeof t === 'number') {
      const valor = t >= 5000 ? 80 : t >= 1000 ? 65 : t >= 250 ? 50 : t >= 50 ? 35 : 20;
      const n = (c.items || []).length;
      return { valor, nivel: nivel3(valor, 65, 45), numero: '≥ ' + fmt(t) + ' vendidos',
        detalle: '≥ ' + fmt(t) + ' vendidos acumulados en ' + n + ' publicaciones top (medido el ' + fechaCorta(c.medido_en) + '). Las ventas por mes salen de la segunda medición, en una semana.',
        como: comoBase + 'Con una sola medición hay acumulado, no ventas por mes (MeLi no informa la fecha de publicación); a la semana se vuelve a medir y se calcula la variación.',
        tipo: 'acumulado' };
    }
  }
  const estado = ult && ult.estado;
  const motivo = estado === 'sin_presupuesto' ? 'tope mensual alcanzado'
    : (estado === 'en_cola' || estado === 'arrancada') ? 'medición en curso'
    : estado === 'fallida' ? 'la medición falló, se reintenta'
    : 'se mide para los 3 mejores de cada rubro';
  return { valor: null, nivel: 'Pendiente', numero: motivo, pendiente: motivo,
    detalle: 'Rotación: pendiente (' + motivo + ').',
    como: comoBase + (estado === 'sin_presupuesto' ? 'Se alcanzó el tope mensual de gasto en Apify (APIFY_MONTHLY_BUDGET_USD): no se piden más vendidos hasta el próximo ciclo.' : '') };
}

// ------------------------------------------------------------
// SATURACION: oferta comparada contra la demanda (100 = muy saturado)
// ------------------------------------------------------------
// Mucha oferta con mucha demanda no es lo mismo que mucha oferta con poca:
// la demanda corrige el indice de oferta.
export function puntajeSaturacion(c, demandaValor) {
  if (!c || (c.totalCatalogo == null && !c.muestra)) {
    return { valor: null, nivel: 'Sin dato', numero: '—', detalle: 'Sin datos de oferta.', como: '' };
  }
  const t = c.totalCatalogo;
  let oferta = t == null ? 50 : t < 100 ? 15 : t < 300 ? 30 : t < 800 ? 45 : t < 2000 ? 60 : t < 5000 ? 75 : 90;
  const notas = [];
  if (t != null) notas.push(fmt(t) + ' productos en catálogo');
  if (c.vendedoresDistintos != null) notas.push(c.vendedoresDistintos + ' vendedores en la muestra');
  if (c.vendedoresTop10 != null && c.top10 >= 5) {
    notas.push('top ' + c.top10 + ' en ' + c.vendedoresTop10 + ' vendedores');
    if (c.vendedoresTop10 <= 3) oferta += 10;
  }
  if (c.pctFull != null) { notas.push(c.pctFull + '% en Full'); if (c.pctFull >= 50) oferta += 10; else if (c.pctFull >= 25) oferta += 5; }
  if (c.pctOficiales != null) { notas.push(c.pctOficiales + '% tiendas oficiales'); if (c.pctOficiales >= 20) oferta += 10; }
  let v = oferta;
  let ajuste = '';
  if (demandaValor != null) {
    const d = Math.round((50 - demandaValor) * 0.4);
    v += d;
    ajuste = d < 0 ? ' · la demanda alta la compensa (' + d + ')' : d > 0 ? ' · la demanda baja la agrava (+' + d + ')' : '';
  }
  v = Math.max(0, Math.min(100, Math.round(v)));
  return { valor: v, nivel: nivel3(v, 65, 40), numero: t != null ? fmt(t) + ' en catálogo' : c.muestra + ' ofertas',
    detalle: notas.join(' · ') + ajuste,
    como: 'Índice de oferta: productos en el catálogo de MeLi (/products/search; el total de publicaciones de la búsqueda da 403), +10 si el top 10 está en 3 vendedores o menos, +5/+10 por % en Full, +10 si 20% o más son tiendas oficiales. Después se corrige por demanda: (50 − demanda) × 0,4. Más alto = más saturado.' };
}

export function saturacionDe(valor) { return nivel3(valor, 65, 40); }

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

// Pedido de prueba: lo que se suele negociar como primera compra o muestra
// ampliada cuando el MOQ de lista no entra en el capital.
export const UNIDADES_PRUEBA = 50;

// escenario: 'moq'     -> entra el pedido minimo tipico
//            'prueba'  -> no entra el MOQ pero si un pedido de prueba de 50 u
//            'ninguno' -> no entra ni la prueba
// Para el capital se usa el DESEMBOLSO por unidad (costo + IVA + percepciones):
// esos tributos se recuperan despues, pero hay que tenerlos para nacionalizar.
export function capacidadDeCompra(costo, capitalKey) {
  const porUnidad = costo.desembolsoUSD || costo.costoPuestoUSD;
  const capital = CAPITAL_USD[capitalKey] || CAPITAL_USD.bajo;
  const presupuesto = capital * FRACCION_POR_PRODUCTO;
  const moq = moqTipico(costo.fobUSD);
  const inversionMoqUSD = Math.round(moq * porUnidad);
  const unidadesPosibles = porUnidad > 0 ? Math.floor(presupuesto / porUnidad) : 0;
  const alcanza = inversionMoqUSD <= presupuesto;
  const prueba = {
    unidades: Math.min(UNIDADES_PRUEBA, moq),
    inversionUSD: Math.round(Math.min(UNIDADES_PRUEBA, moq) * porUnidad)
  };
  prueba.alcanza = prueba.inversionUSD <= presupuesto;
  return { capitalReferenciaUSD: capital, presupuestoUSD: presupuesto, moq, inversionMoqUSD,
    unidadesPosibles, alcanza, prueba,
    escenario: alcanza ? 'moq' : (prueba.alcanza ? 'prueba' : 'ninguno') };
}

const PENAL_CERT = { ninguna: 50, poca: 35, media: 20, alta: 10 };

// Riesgo operativo Y de capital. Antes era solo operativo, y una tarjeta podia
// decir "No te alcanza para el pedido minimo" con "Riesgo: Bajo" al lado.
export function puntajeRiesgo(prod, comp, certs, experiencia, capacidad) {
  let v = 100;
  const notas = [];
  if (capacidad && capacidad.escenario === 'prueba') {
    v -= 35;
    notas.push('el capital solo da para un pedido de prueba de ' + capacidad.prueba.unidades + ' u, no para el mínimo típico');
  } else if (capacidad && capacidad.escenario === 'ninguno') {
    v -= 60;
    notas.push('el capital no alcanza ni para un pedido de prueba de ' + capacidad.prueba.unidades + ' u');
  }
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
  return { valor: v, detalle: notas.length ? notas.join(' · ') : 'Te alcanza el capital, liviano y sin certificaciones previas detectadas' };
}

export function riesgoDe(valor) { return valor >= 70 ? 'Bajo' : valor >= 45 ? 'Medio' : 'Alto'; }

// ------------------------------------------------------------
// Score y veredicto: UNA funcion
// ------------------------------------------------------------
// Demanda + rotacion + saturacion ~70%, margen ~20%, riesgo/capital ~10%.
// La tolerancia al riesgo mueve 5 puntos entre margen y riesgo.
export const PESOS = {
  bajo:  { demanda: 25, rotacion: 20, saturacion: 25, margen: 15, riesgo: 15 },
  medio: { demanda: 25, rotacion: 20, saturacion: 25, margen: 20, riesgo: 10 },
  alto:  { demanda: 25, rotacion: 20, saturacion: 25, margen: 25, riesgo: 5 }
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
  // Saturacion entra invertida: 100 = nada saturado suma todo.
  const sat = e.saturacion || { valor: null, detalle: '' };
  const rot = e.rotacion || { valor: null, detalle: '' };
  const componentes = [
    { clave: 'demanda', label: 'Demanda', valor: e.demanda.valor, peso: pesos.demanda, detalle: e.demanda.detalle },
    { clave: 'rotacion', label: 'Rotación', valor: rot.valor, peso: pesos.rotacion, detalle: rot.detalle },
    { clave: 'saturacion', label: 'Saturación (invertida)', valor: sat.valor == null ? null : 100 - sat.valor, peso: pesos.saturacion, detalle: sat.detalle },
    { clave: 'margen', label: 'Margen neto', valor: puntajeMargen(e.margenPct), peso: pesos.margen,
      detalle: e.margenPct != null ? e.margenPct.toLocaleString('es-AR') + '% neto sobre el precio de venta' : 'Sin precio de venta real' },
    { clave: 'riesgo', label: 'Riesgo (operativo y de capital)', valor: e.riesgo.valor, peso: pesos.riesgo, detalle: e.riesgo.detalle }
  ];
  const usados = componentes.filter(c => c.valor != null);
  const pesoUsado = usados.reduce((a, c) => a + c.peso, 0);
  componentes.forEach(c => {
    c.pesoEfectivo = c.valor != null && pesoUsado ? Math.round(c.peso / pesoUsado * 100) : 0;
    c.aporte = c.valor != null && pesoUsado ? Math.round(c.valor * c.peso / pesoUsado * 10) / 10 : 0;
  });
  const ajustes = [];
  // El pedido de prueba ya pesa en el componente de riesgo. Solo cuando no
  // entra ni la prueba se resta aparte: no hay forma de arrancar.
  if (e.capacidad && e.capacidad.escenario === 'ninguno') {
    ajustes.push({ label: 'Ni un pedido de prueba de ' + e.capacidad.prueba.unidades + ' u (USD ' +
      e.capacidad.prueba.inversionUSD.toLocaleString('es-AR') + ') entra en el ' + Math.round(FRACCION_POR_PRODUCTO * 100) + '% de tu capital', puntos: -15 });
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
    if (rot.valor == null) motivos.push('Rotación pendiente: sin vendidos medidos no puede ser oportunidad alta.');
    else if (e.demanda.valor < 55) motivos.push('Demanda baja: no está entre lo más buscado de su categoría.');
    if (sat.valor != null && sat.valor >= 65) motivos.push('Mercado saturado para la demanda que tiene.');
    if (e.capacidad && e.capacidad.escenario === 'prueba') motivos.push('Con tu capital arrancás con un pedido de prueba de ' + e.capacidad.prueba.unidades + ' u, no con el mínimo típico.');
    if (e.capacidad && e.capacidad.escenario === 'ninguno') motivos.push('No te alcanza el capital ni para un pedido de prueba.');
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
// mercado: lo que arma api/_precalculo.js (analizarProducto) o null.
export function evaluarProducto(prod, nichoKey, mercado, perfil, usdArs, historial) {
  const costo = costoImportacion(prod, usdArs, nichoKey);
  const certs = certificaciones(prod, nichoKey);
  const capacidad = capacidadDeCompra(costo, perfil.capital);
  const limpios = mercado ? limpiarMuestra(mercado.results) : [];
  const acotados = acotarPorCosto(limpios, costo.costoPuestoARS);
  const links = linksDe(prod, acotados.length ? acotados : limpios);
  const base = {
    nombre: prod.nombre, query: prod.q, keyword_en: prod.keyword_en || null, nota: prod.nota, pesoG: prod.pesoG,
    costo, certificaciones: certs, capacidad, links,
    categoria: (mercado && mercado.categoryName) || null
  };
  // Sin 3 ofertas comparables con precio no hay producto para mostrar: va a
  // "Pendientes de analisis" (solo nombre y links), no a una tarjeta vacia.
  if (!mercado || acotados.length < 3) {
    return Object.assign(base, { sinDatos: true,
      motivoSinDatos: !mercado ? 'Todavía no se analizó.' : 'MercadoLibre no tiene suficientes ofertas comparables (' + acotados.length + ').' });
  }
  // Oferta: toda la muestra limpia (el filtro por costo es para el precio).
  const oferta = estadisticasCompetencia(limpios, mercado.catalogoTotal);
  const precios = estadisticasCompetencia(acotados, mercado.catalogoTotal);
  const comp = Object.assign({}, oferta, { precioMin: precios.precioMin, precioMediana: precios.precioMediana, precioMax: precios.precioMax, muestraPrecios: precios.muestra });
  const cond = condicionesCanal(perfil.canal, comp.precioMediana, prod.pesoG, mercado.comision);
  const mn = margenNeto(cond, costo);
  const dem = puntajeDemanda(comp, mercado);
  const rot = puntajeRotacion(historial);
  const sat = puntajeSaturacion(comp, dem.valor);
  const riesgo = puntajeRiesgo(prod, comp, certs, perfil.experiencia, capacidad);
  const ev = evaluar({ margenPct: mn.pct, demanda: dem, rotacion: rot, saturacion: sat, riesgo, riesgoTolerancia: perfil.riesgo, capacidad });
  const m = x => ({ nivel: x.nivel, valor: x.valor, numero: x.numero, detalle: x.detalle, como: x.como });
  return Object.assign(base, {
    fuente: 'MercadoLibre (API oficial)',
    competencia: comp,
    metricas: { demanda: m(dem), rotacion: m(rot), saturacion: m(sat) },
    precioVentaARS: cond.precio, precioMercadoARS: comp.precioMediana,
    canal: { clave: cond.canal, etiqueta: cond.etiqueta, notaPrecio: cond.notaPrecio, notaComision: cond.notaComision,
      notaEnvio: cond.notaEnvio || null, comisionPct: cond.comisionBasePct, cargoFijo: cond.cargoFijo, comisionReal: !!cond.comisionReal },
    margen: mn.pct, margenNeto: mn,
    demanda: dem.nivel, demandaDetalle: dem.detalle, rotacion: rot.nivel, saturacion: sat.nivel,
    riesgo: riesgoDe(riesgo.valor),
    score: ev.score, componentes: ev.componentes, ajustes: ev.ajustes, veredicto: ev.veredicto, semaforo: ev.semaforo
  });
}

// Orden: primero los que tienen score; dentro, los que entran con el MOQ, despues
// los que entran con un pedido de prueba, despues los que no entran; y por score.
const ESC = { moq: 0, prueba: 1, ninguno: 2 };
export function ordenar(lista) {
  const rango = p => p.sinDatos ? 2 : 0;
  return lista.slice().sort((a, b) => (rango(a) - rango(b)) ||
    (a.sinDatos || b.sinDatos ? 0 : (ESC[a.capacidad.escenario] - ESC[b.capacidad.escenario])) ||
    ((b.score || 0) - (a.score || 0)));
}
