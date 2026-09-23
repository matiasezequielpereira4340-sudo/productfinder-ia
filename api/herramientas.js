// api/herramientas.js
// ============================================================
// MeLi Connect - Endpoint unificado de herramientas.
// Varias funcionalidades en una sola Serverless Function para respetar el
// limite del plan Hobby de Vercel (max 12).
//
// Ruteo por el campo 'accion' del body (POST):
//   accion: 'estado'      -> analisis gratis que le quedan hoy + un ejemplo
//   accion: 'comisiones'  -> comisiones reales de MeLi (MargenClear)
//   accion: 'flex-full'   -> Calculadora Flex vs Full
//   (sin accion)          -> Analizador de publicaciones (api/_analizador.js)
// GET ?item_id=X&history=1 -> historial de puntajes de una publicacion
// ============================================================

import { MELI_API, fetchJson } from './_meli.js';
import { analizar, estado, historial, usuarioDeSesion, tokenDelVisitante } from './_analizador.js';

export default async function handler(req, res) {
  var accion = (req.body && req.body.accion) ? String(req.body.accion) : '';
  if (accion === 'comisiones') return handleComisiones(req, res);
  if (accion === 'flex-full') return handleFlexFull(req, res);
  return handleAnalisis(req, res, accion);
}

function cabecerasCors(res, metodos) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', metodos);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function fetchJSON(url, token, timeoutMs) {
  const r = await fetchJson(url, token, timeoutMs || 6000);
  return { ok: r.ok, status: r.status, data: r.json };
}

// ------------------------------------------------------------
// Analizador de publicaciones (la logica vive en _analizador.js)
// ------------------------------------------------------------
// Sin login obligatorio: cualquiera analiza, con limite por IP. La sesion, si
// esta, solo se usa para leer por la API oficial una publicacion propia.
async function handleAnalisis(req, res, accion) {
  cabecerasCors(res, 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') {
      const { item_id, history } = req.query || {};
      if (!item_id) return res.status(400).json({ error: 'item_id requerido' });
      if (history) return res.status(200).json({ ok: true, item_id, history: await historial(String(item_id)) });
      return res.status(400).json({ error: 'Falta ?history=1' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no soportado' });
    // 'ejemplo' queda como alias de 'estado' para paginas viejas en cache.
    if (accion === 'estado' || accion === 'ejemplo') return res.status(200).json(await estado(req));
    const r = await analizar(req);
    return res.status(r.status).json(r.cuerpo);
  } catch (e) {
    console.error('[analizador] excepcion:', e && e.stack || e);
    return res.status(500).json({ ok: false, error: 'Fall\u00f3 el an\u00e1lisis. Prob\u00e1 de nuevo en un rato.' });
  }
}

// ------------------------------------------------------------
// Comisiones reales de MercadoLibre
// ------------------------------------------------------------
// MargenClear tenia la tabla escrita a mano: { clasica: 13.5, premium: 16 }.
// MercadoLibre publica la comision real en /sites/MLA/listing_prices, que
// devuelve, para un precio dado, el cargo de cada tipo de publicacion.
//
// El endpoint necesita token: se usa el del usuario de la sesion firmada.
// Sin sesion o sin cuenta de MeLi conectada se devuelve ok:false con
// motivo 'sin_meli' y el front sigue con los valores manuales, avisando que
// son estimados. Nunca se inventa un porcentaje y se lo presenta como dato
// de MercadoLibre.
async function handleComisiones(req, res) {
  cabecerasCors(res, 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const precio = Math.max(1000, Math.min(5000000, Number((req.body && req.body.precio) || 100000)));
  const categoria = (req.body && req.body.categoria) ? String(req.body.categoria).slice(0, 20) : null;

  try {
    const user = usuarioDeSesion(req);
    const { token: tok } = await tokenDelVisitante(user);
    if (!tok) {
      return res.status(200).json({ ok: false, motivo: 'sin_meli', sinSesion: !user,
        detalle: user ? 'Tu cuenta de MercadoLibre no est\u00e1 conectada.' : 'No hay sesi\u00f3n iniciada.' });
    }

    let url = MELI_API + '/sites/MLA/listing_prices?price=' + precio;
    if (categoria) url += '&category_id=' + encodeURIComponent(categoria);

    const r = await fetchJSON(url, tok);
    if (!r.ok) {
      const rechazo = r.status === 401 || r.status === 403;
      return res.status(200).json({ ok: false, motivo: rechazo ? 'meli_rechazo' : 'MercadoLibre no respondio (' + r.status + ')' });
    }
    const datos = r.data;
    const lista = Array.isArray(datos) ? datos : [datos];

    // El formato documentado trae sale_fee_details.percentage_fee. Si algun
    // dia cambia, se deriva del monto: sale_fee_amount / precio * 100.
    const tipos = {};
    for (const t of lista) {
      if (!t || !t.listing_type_id) continue;
      const det = t.sale_fee_details || {};
      let pct = Number(det.percentage_fee);
      if (!isFinite(pct) || pct <= 0) {
        const monto = Number(t.sale_fee_amount);
        if (isFinite(monto) && monto > 0) pct = (monto / precio) * 100;
      }
      if (!isFinite(pct) || pct <= 0) continue;
      tipos[t.listing_type_id] = {
        nombre: t.listing_type_name || t.listing_type_id,
        porcentaje: Math.round(pct * 100) / 100,
        cargoFijo: Number(det.fixed_fee) || 0
      };
    }

    if (!Object.keys(tipos).length) {
      return res.status(200).json({ ok: false, motivo: 'MercadoLibre no devolvio comisiones para ese precio' });
    }

    return res.status(200).json({
      ok: true,
      precioConsultado: precio,
      categoria: categoria,
      // Los nombres que usa MargenClear, mapeados a los de MercadoLibre.
      clasica: tipos.gold_special || null,
      premium: tipos.gold_pro || null,
      gratuita: tipos.free || { nombre: 'Gratuita', porcentaje: 0, cargoFijo: 0 },
      todos: tipos,
      conToken: !!tok
    });
  } catch (e) {
    return res.status(200).json({ ok: false, motivo: 'No pudimos consultar las comisiones ahora' });
  }
}

// ------------------------------------------------------------
// Funcionalidad 3: Calculadora Flex vs Full
// ------------------------------------------------------------
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

// --- Umbrales de la recomendacion ---
// Aca antes habia montos en pesos escritos a mano: $350 de gestion de Full,
// $900 de despacho propio en Flex y $90/$220/$650 de almacenamiento. Eran
// numeros inventados que la pantalla mostraba grandes y en negrita, con la
// aclaracion en gris chico al final. Con la inflacion argentina envejecian en
// meses y no habia forma de mantenerlos al dia.
//
// La herramienta ahora NO dice cuanto cuesta cada modalidad: dice cual te
// conviene y por que, que es lo que realmente se puede afirmar sin tarifas
// oficiales en vivo. El costo exacto sale del simulador de MercadoLibre, y a
// eso se manda al usuario.
const P = {
  rotacionAltaMes: 30,
  rotacionMediaMes: 8
};

function handleFlexFull(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
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
      return res.status(400).json({ error: 'Necesito al menos el peso (kg) y la rotación estimada (unidades por mes).' });
    }

    const tamano = clasificarTamano(pesoKg, largo, ancho, alto);
    const result = calcular({ pesoKg, tamano, rotacion, margen, toleranciaAlmacenamiento });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: 'Fallo el cálculo', detalle: String((e && e.message) || e) });
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

  // Cuanto tiempo queda una unidad guardada antes de venderse: es lo que
  // decide si Full conviene o no. No se convierte a pesos porque la tarifa
  // real la publica MercadoLibre y cambia seguido.
  const mesesEnDeposito = rotacion >= P.rotacionAltaMes ? 0.5 : (rotacion >= P.rotacionMediaMes ? 1.2 : 2.5);
  const toleranciaTexto = toleranciaAlmacenamiento === 'baja'
    ? 'Dijiste que te molesta pagar depósito, así que el peso del almacenamiento cuenta doble en está recomendacion.'
    : (toleranciaAlmacenamiento === 'alta'
        ? 'Dijiste que no te molesta pagar depósito con tal de no ocuparte de la logística.'
        : 'Tomamos una tolerancia media al costo de almacenamiento.');

  // --- Puntaje de recomendacion ---
  // Full gana cuando la rotacion es alta y el producto es chico/mediano.
  // Flex gana cuando la rotacion es baja/media o el producto es grande/pesado.
  let recomendacion, motivo;
  const razones = [];

  if (rotacion >= P.rotacionAltaMes && tamano !== 'grande') {
    recomendacion = 'Mercado Full';
    razones.push('Tu rotación es alta (' + rotacion + ' u/mes): el stock no se queda quieto, así que el costo de almacenamiento por unidad es bajo.');
    razones.push('El producto es ' + tamano + ', un tamaño cómodo para Full.');
    razones.push('Full mejora el posicionamiento y te saca la logística de encima, clave cuando vendés volumen.');
  } else if (rotacion < P.rotacionMediaMes || tamano === 'grande') {
    recomendacion = 'Mercado Flex';
    if (rotacion < P.rotacionMediaMes) razones.push('Tu rotación es baja (' + rotacion + ' u/mes): en Full el stock quedaria guardado mucho tiempo y el almacenamiento te comeria el margen.');
    if (tamano === 'grande') razones.push('El producto es grande/pesado: almacenarlo en Full es caro.');
    razones.push('Con Flex no pagás depósito y controlás vos los tiempos de entrega.');
  } else {
    recomendacion = mesesEnDeposito <= 1.2 ? 'Mercado Full' : 'Mercado Flex';
    razones.push('Tu caso está en la mitad: rotación media (' + rotacion + ' u/mes) y tamaño ' + tamano + '.');
    razones.push('Con esa rotación, cada unidad queda alrededor de ' + mesesEnDeposito + ' mes en depósito. Se inclina para ' + recomendacion + ', pero la diferencia es chica: la única forma de estar seguro es correr las dos y medir.');
  }
  motivo = razones.join(' ');

  return {
    tamano,
    recomendacion,
    motivo,
    razones,
    // Comparacion cualitativa: que te cobra cada modalidad, sin inventar
    // cuanto. El monto exacto lo da el simulador oficial.
    comparacion: {
      full: {
        titulo: 'Mercado Full',
        queTePaga: 'Vos mandás el stock una vez. MeLi guarda, empaqueta y despacha.',
        queTeCobra: [
          'Una tarifa por cada venta preparada y despachada.',
          'Almacenamiento por el tiempo que el stock queda guardado (~' + mesesEnDeposito + ' mes con tu rotación).'
        ],
        aFavor: 'Mejor posicionamiento en el buscador y cero logística de tu lado.',
        enContra: 'Si rota lento, el almacenamiento se come el margen.'
      },
      flex: {
        titulo: 'Mercado Flex',
        queTePaga: 'El stock queda en tu casa o depósito y entregas vos el mismo día.',
        queTeCobra: [
          'No pagás depósito a MeLi.',
          'Pagás con tu tiempo, nafta e insumos en cada entrega.'
        ],
        aFavor: 'Sin costo de almacenamiento y controlás los tiempos.',
        enContra: 'No escala: cada venta es una entrega que tenés que hacer.'
      }
    },
    tolerancia: toleranciaTexto,
    aclaracion: 'Esta herramienta te dice que modalidad conviene según el peso, el tamaño y la rotación de tu producto. NO estima cuanto sale cada una: las tarifas de Mercado Envios y de almacenamiento en Full las fija MercadoLibre y cambian seguido, así que el número exacto lo tenés que sacar del simulador oficial para tu producto y tu categoría.',
    requisitos: buildRequisitos()
  };
}

// Aclaracion sobre requisitos de reputacion para cuentas nuevas.
function buildRequisitos() {
  return {
    titulo: 'Ojo si tu cuenta es nueva',
    texto: 'Flex y Full no están disponibles apenas abris la cuenta. MercadoLibre los habilita cuando ya tenés algo de trayectoria: cierta cantidad de ventas concretadas y una reputación sana (buen color, pocos reclamos, envios a tiempo). Es decir: primero vendés unas cuantas veces con Mercado Envios normal, y a medida que sumas ventas y reputación se te van habilitando Flex y despues Full.',
    nota: 'La cantidad exacta de ventas y los requisitos los define (y actualiza) MercadoLibre, y pueden variar por categoría y zona. Si todavia no te aparece la opción de Flex o Full al publicar, es por esto: segui vendiendo y cuidando la reputación, y se habilita solo.'
  };
}
