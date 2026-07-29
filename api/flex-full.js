// api/flex-full.js
// ============================================================
// MeLi Connect - Calculadora Flex vs Full (Funcionalidad 3)
// Logica de REGLAS (no usa IA). Recibe datos del producto y
// devuelve que modalidad de envio conviene y POR QUE, con el
// costo estimado de cada una, explicado para principiantes.
//
// IMPORTANTE sobre los costos: los valores de tarifas de Mercado
// Envios y de almacenamiento en Full cambian seguido. Aca se usan
// PARAMETROS configurables (abajo) como estimacion educativa. El
// front aclara que son estimados y que hay que validar la tarifa
// real en el simulador oficial de MercadoLibre antes de decidir.
// ============================================================

// --- Parametros de estimacion (ajustables) ---
const P = {
  // Costo de guardar stock en Full por unidad y por mes (estimado, ARS).
  // Depende del tamano; usamos una escala simple por volumen.
  fullStoragePorUnidadMes: { chico: 90, mediano: 220, grande: 650 },
  // Recargo operativo de Full sobre cada venta (preparacion/gestion), estimado ARS/unidad.
  fullFeePorUnidad: 350,
  // Costo que te sale a VOS despachar cada envio en Flex (nafta/tiempo/insumos), estimado ARS/unidad.
  flexCostoOperativoPorEnvio: 900,
  // Umbrales de rotacion (unidades/mes) para la recomendacion.
  rotacionAltaMes: 30,
  rotacionMediaMes: 8
};

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });

  try {
    const b = req.body || {};
    const pesoKg = num(b.pesoKg);
    const largo = num(b.largoCm), ancho = num(b.anchoCm), alto = num(b.altoCm);
    const rotacion = num(b.rotacionMes);        // unidades por mes estimadas
    const margen = num(b.margenUnidad);         // ganancia por unidad en ARS (opcional)
    const toleranciaAlmacenamiento = b.toleranciaAlmacenamiento || 'media'; // baja | media | alta

    if (pesoKg == null || rotacion == null) {
      return res.status(400).json({ error: 'Necesito al menos el peso (kg) y la rotacion estimada (unidades por mes).' });
    }

    const tamano = clasificarTamano(pesoKg, largo, ancho, alto);
    const result = calcular({ pesoKg, tamano, rotacion, margen, toleranciaAlmacenamiento });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: 'Fallo el calculo', detalle: String((e && e.message) || e) });
  }
}

function num(v) { const n = Number(v); return isFinite(n) && v !== '' && v != null ? n : null; }

// Clasifica el producto en chico / mediano / grande usando peso y
// peso volumetrico (los correos cobran por lo que sea mayor).
function clasificarTamano(pesoKg, largo, ancho, alto) {
  let volumetrico = 0;
  if (largo && ancho && alto) volumetrico = (largo * ancho * alto) / 5000; // formula tipica de peso volumetrico
  const pesoFacturable = Math.max(pesoKg || 0, volumetrico);
  if (pesoFacturable <= 1) return 'chico';
  if (pesoFacturable <= 5) return 'mediano';
  return 'grande';
}

function calcular(inp) {
  const { pesoKg, tamano, rotacion, margen, toleranciaAlmacenamiento } = inp;

  // --- Costo estimado por unidad en cada modalidad ---
  // FULL: fee operativo + almacenamiento prorrateado por unidad vendida.
  // Si roto poco, el stock queda guardado mas tiempo => el almacenamiento
  // pesa MAS por unidad (por eso Full castiga la baja rotacion).
  const almacenMes = P.fullStoragePorUnidadMes[tamano];
  const factorTolerancia = toleranciaAlmacenamiento === 'baja' ? 1.6 : (toleranciaAlmacenamiento === 'alta' ? 0.7 : 1);
  // Meses promedio que una unidad queda guardada antes de venderse (aprox: 1 / (rotacion/stock)).
  // Simplificacion educativa: si rota mucho, ~0.5 mes; si rota poco, mas.
  const mesesEnDeposito = rotacion >= P.rotacionAltaMes ? 0.5 : (rotacion >= P.rotacionMediaMes ? 1.2 : 2.5);
  const fullAlmacenPorUnidad = Math.round(almacenMes * mesesEnDeposito * factorTolerancia);
  const fullPorUnidad = P.fullFeePorUnidad + fullAlmacenPorUnidad;

  // FLEX: te lo despachas vos => costo operativo tuyo por envio. No hay almacenamiento de MeLi.
  const flexPorUnidad = P.flexCostoOperativoPorEnvio;

  // --- Puntaje de recomendacion ---
  // Full gana cuando la rotacion es alta y el producto es chico/mediano.
  // Flex gana cuando la rotacion es baja/media o el producto es grande/pesado.
  let recomendacion, motivo;
  const razones = [];

  if (rotacion >= P.rotacionAltaMes && tamano !== 'grande') {
    recomendacion = 'Mercado Full';
    razones.push('Tu rotacion es alta (' + rotacion + ' u/mes): el stock no se queda quieto, asi que el costo de almacenamiento por unidad es bajo.');
    razones.push('El producto es ' + tamano + ', un tamano comodo para Full.');
    razones.push('Full mejora el posicionamiento y te saca la logistica de encima, clave cuando vendes volumen.');
  } else if (rotacion < P.rotacionMediaMes || tamano === 'grande') {
    recomendacion = 'Mercado Flex';
    if (rotacion < P.rotacionMediaMes) razones.push('Tu rotacion es baja (' + rotacion + ' u/mes): en Full el stock quedaria guardado mucho tiempo y el almacenamiento te comeria el margen.');
    if (tamano === 'grande') razones.push('El producto es grande/pesado: almacenarlo en Full es caro.');
    razones.push('Con Flex no pagas deposito y controlas vos los tiempos de entrega.');
  } else {
    recomendacion = fullPorUnidad <= flexPorUnidad ? 'Mercado Full' : 'Mercado Flex';
    razones.push('Tu caso esta en la mitad: rotacion media (' + rotacion + ' u/mes) y tamano ' + tamano + '.');
    razones.push('Por costo estimado por unidad, hoy te conviene ' + recomendacion + ', pero la diferencia es chica: proba las dos y medi.');
  }
  motivo = razones.join(' ');

  // --- Impacto en margen (si lo cargo) ---
  let impacto = null;
  if (margen != null) {
    const elegido = recomendacion === 'Mercado Full' ? fullPorUnidad : flexPorUnidad;
    const otro = recomendacion === 'Mercado Full' ? flexPorUnidad : fullPorUnidad;
    impacto = {
      margenAntes: margen,
      margenConElegido: Math.round(margen - elegido),
      pctDelMargen: Math.round((elegido / margen) * 100),
      ahorroVsOtro: Math.round(otro - elegido)
    };
  }

  return {
    tamano,
    recomendacion,
    motivo,
    razones,
    costos: {
      full: {
        porUnidad: fullPorUnidad,
        detalle: [
          { concepto: 'Gestion/preparacion de Full', valor: P.fullFeePorUnidad },
          { concepto: 'Almacenamiento prorrateado (' + tamano + ', ~' + mesesEnDeposito + ' mes en deposito)', valor: fullAlmacenPorUnidad }
        ]
      },
      flex: {
        porUnidad: flexPorUnidad,
        detalle: [
          { concepto: 'Costo operativo tuyo por despacho (nafta, tiempo, insumos)', valor: P.flexCostoOperativoPorEnvio }
        ]
      }
    },
    impacto,
    aclaracion: 'Los montos son estimaciones EDUCATIVAS para comparar las modalidades. Las tarifas reales de Mercado Envios y de almacenamiento en Full cambian seguido: antes de decidir, valida el costo exacto en el simulador oficial de MercadoLibre para tu producto.',
    requisitos: buildRequisitos()
  };
}

// Aclaracion sobre requisitos de reputacion para cuentas nuevas.
function buildRequisitos() {
  return {
    titulo: 'Ojo si tu cuenta es nueva',
    texto: 'Flex y Full no estan disponibles apenas abris la cuenta. MercadoLibre los habilita cuando ya tenes algo de trayectoria: cierta cantidad de ventas concretadas y una reputacion sana (buen color, pocos reclamos, envios a tiempo). Es decir: primero vendes unas cuantas veces con Mercado Envios normal, y a medida que sumas ventas y reputacion se te van habilitando Flex y despues Full.',
    nota: 'La cantidad exacta de ventas y los requisitos los define (y actualiza) MercadoLibre, y pueden variar por categoria y zona. Si todavia no te aparece la opcion de Flex o Full al publicar, es por esto: segui vendiendo y cuidando la reputacion, y se habilita solo.'
  };
}
