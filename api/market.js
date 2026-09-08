// Market Reader IA - Backend API
// Handles /api/market for steps: demanda, competencia, final, productUrl
// Datos de MercadoLibre (catalogo con token de usuario) + Anthropic para el
// armado del informe.

import { anthropicHeaders, buscarPublicaciones, contarPublicaciones, relevanciaPorTitulo, leerRelevanciaLog, registrarRelevancia, flushRelevancia, corridasPendientes, cosecharPendientes, estadoEscrituraRelevancia, palabrasSignificativas, RELEVANCIA_UMBRAL_ALTO, RELEVANCIA_UMBRAL_BAJO, SITIOS, filaDeCache, viaDeBusquedaUsada, candidatosDeListado, traerPagina, extraerIdsMLA, idsPorPatron, hidratarItems, getUserToken, meliCreds, fetchJson, MELI_API } from './_meli.js';
import { haySesion, esAdmin, tokenDe, pedirSesion } from './_sesion.js';
import { cotizacionDolar, DOLAR_TIPOS, DOLAR_TIPO_DEFAULT } from './_dolar.js';

// Los diagnosticos de SOLO LECTURA (no arrancan corridas, no gastan) aceptan
// dos credenciales: la ADMIN_KEY por header, o la sesion de admin normal de la
// app. La segunda existe para que se puedan mirar desde el panel /admin.html
// sin tener que pegar una clave secreta a mano, ni menos meterla en una URL.
function admitido(req) {
  const clave = req.headers['x-admin-key'] || (req.query && req.query.key);
  if (process.env.ADMIN_KEY && clave === process.env.ADMIN_KEY) return true;
  return esAdmin(tokenDe(req));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  // GET = simple status endpoint (sin OAuth). El POST sigue debajo.
  if (req.method === 'GET') {
    const estado = {
      ok: true,
      service: 'market',
      meli_token_present: !!process.env.MELI_ACCESS_TOKEN,
      meli_client_creds_present: !!((process.env.MELI_CLIENT_ID || process.env.MELI_APP_ID) &&
                                    (process.env.MELI_CLIENT_SECRET || process.env.MELI_SECRET_KEY)),
      anthropic_present: !!process.env.ANTHROPIC_API_KEY,
      demo_user: process.env.MELI_DEMO_USER_ID || 'matypereira'
    };

    // ?relevancia=1 -> las ultimas mediciones de relevancia, para recalibrar
    // los umbrales con consultas REALES en vez de con titulos supuestos.
    // Protegido con ADMIN_KEY: expone que busca la gente.
    if (req.query && req.query.relevancia) {
      if (!admitido(req)) return res.status(401).json({ error: 'No autorizado' });
      const n = Math.min(200, Math.max(1, parseInt(req.query.n, 10) || 50));
      const filas = leerRelevanciaLog(n);
      // Resumen para ver de una si los umbrales estan bien puestos.
      const porEstado = {};
      let suma = 0, con = 0;
      for (const f of filas) {
        porEstado[f.estado || 'sin-estado'] = (porEstado[f.estado || 'sin-estado'] || 0) + 1;
        if (typeof f.ratio === 'number') { suma += f.ratio; con++; }
      }
      return res.status(200).json({
        ok: true,
        umbrales: { alto: RELEVANCIA_UMBRAL_ALTO, bajo: RELEVANCIA_UMBRAL_BAJO },
        // Si esto dice ok:false, el log NO se esta persistiendo y lo que se ve
        // abajo es solo lo que quedo en memoria de este lambda.
        escrituraSupabase: estadoEscrituraRelevancia(),
        total: filas.length,
        porEstado,
        ratioPromedio: con ? Number((suma / con).toFixed(4)) : null,
        nota: 'El log vive en memoria del proceso: un cold start de Vercel lo vacia. Si existe la tabla relevancia_log en Supabase, ahi queda el historico completo.',
        entradas: filas
      });
    }

    // ?gasto=1 -> en que se fue la plata del proveedor pago, por termino.
    // Existe para poder contestar "cuanto gaste hoy y en que" sin entrar a
    // Apify ni a Supabase. Protegido con ADMIN_KEY: expone los terminos que
    // busca la gente y el gasto de la cuenta.
    if (req.query && req.query.gasto) {
      if (!admitido(req)) return res.status(401).json({ error: 'No autorizado' });
      const gas = await import('./_gasto.js');
      const r = await gas.resumenGasto(req.query.n);
      return res.status(200).json({ ok: true, ...r });
    }

    // ?pendientes=1 -> que paso con cada corrida paga que quedo anotada y sin
    // cosechar. Contesta las dos preguntas que importan sobre plata ya gastada:
    //   1) la corrida ARRANCO y consumio credito, o quedo encolada y no costo?
    //      -> corrida.arrancoDeVerdad, computeUnits, costo_usd
    //   2) el dataset todavia existe, o vencio la retencion del plan?
    //      -> dataset.existe, dataset.items
    // Ojo: run_estado en busquedas_cache es el estado al CREARLA (casi siempre
    // READY = encolada) y nunca se actualizo, asi que no sirve para esto.
    //
    // Con &cosechar=1 ademas guarda las que ya terminaron. Eso es la RETENCION:
    // hoy una corrida solo se cosecha si alguien vuelve a buscar el mismo
    // termino, asi que una que termina cuando nadie mira se pierde aunque se
    // haya pagado. Nada de esto arranca corridas nuevas: no cuesta plata.
    if (req.query && req.query.pendientes) {
      if (!admitido(req)) return res.status(401).json({ error: 'No autorizado' });
      const bus = await import('./_buscador.js');
      const { ok, error, filas } = await corridasPendientes(req.query.n);
      if (!ok) return res.status(200).json({ ok: false, error });
      const corridas = [];
      for (const f of filas) {
        const d = await bus.detalleDeCorrida(f.run_id, f.dataset_id);
        corridas.push({
          termino: f.termino, fuente: f.fuente,
          arrancada_el: f.run_desde,
          estado_guardado: f.run_estado,
          resultados_guardados: Array.isArray(f.resultados) ? f.resultados.length : 0,
          ...d
        });
      }
      const salida = { ok: true, total: corridas.length, corridas };
      if (req.query.cosechar) {
        const tok = await getMeliAccessToken();
        salida.cosecha = await cosecharPendientes(tok, { limite: req.query.n });
      }
      return res.status(200).json(salida);
    }

    // ?dolar=1 -> cotizaciones del dolar para el formulario del Market Reader.
    // Se consulta desde el server para no depender del CORS de dolarapi, y se
    // cachea 30 minutos en _dolar.js. El front lo pide una vez al abrir la
    // pantalla y completa el input de tipo de cambio con el tipo elegido.
    if (req.query && req.query.dolar) {
      const c = await cotizacionDolar();
      return res.status(200).json({
        ok: !!c.ok,
        oficial: c.oficial ?? null,
        mayorista: c.mayorista ?? null,
        mep: c.mep ?? null,
        ccl: c.ccl ?? null,
        tarjeta: c.tarjeta ?? null,
        fecha: c.fecha || null,
        porDefecto: DOLAR_TIPO_DEFAULT,
        tipos: DOLAR_TIPOS,
        fuente: c.fuente || 'dolarapi.com',
        deCache: !!c.deCache,
        vencido: !!c.vencido,
        error: c.error || null
      });
    }

    // ?demo=termino alimenta la demo publica del hero.
    // MercadoLibre cerro /sites/MLA/search (403) y /products/search no trae
    // precios, asi que la demo se apoya en los dos endpoints que si responden:
    //   - domain_discovery: en que categoria real encuadra MeLi ese termino
    //   - trends: las busquedas reales del momento en MercadoLibre Argentina
    // Todo lo que devuelve es dato real de MeLi. Si algo falla, devuelve
    // ok:false y el front lo dice: nunca se completa con numeros inventados.
    if (req.query && typeof req.query.demo === 'string') {
      const termino = req.query.demo.trim().slice(0, 60);
      if (!termino) return res.status(400).json({ ok: false, error: 'Falta el producto' });
      try {
        const tok = await getMeliAccessToken();
        if (!tok) return res.status(200).json({ ok: false, error: 'No pude autenticarme contra MercadoLibre.' });
        const auth = { Authorization: 'Bearer ' + tok, Accept: 'application/json' };

        const [rDom, rTrend] = await Promise.all([
          fetch('https://api.mercadolibre.com/sites/MLA/domain_discovery/search?limit=3&q=' +
                encodeURIComponent(termino), { headers: auth }),
          fetch('https://api.mercadolibre.com/trends/MLA', { headers: auth })
        ]);
        if (!rDom.ok && !rTrend.ok) {
          return res.status(200).json({ ok: false, error: 'MercadoLibre no respondio a la consulta.' });
        }

        const dom = rDom.ok ? await rDom.json().catch(() => []) : [];
        const trend = rTrend.ok ? await rTrend.json().catch(() => []) : [];

        const norm = s => String(s || '').toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const t = norm(termino);
        const palabras = t.split(/\s+/).filter(w => w.length > 3);

        const keywords = (Array.isArray(trend) ? trend : [])
          .map(x => x && x.keyword).filter(Boolean);

        let posicion = null;
        for (let i = 0; i < keywords.length; i++) {
          const k = norm(keywords[i]);
          if (k === t || k.includes(t) || t.includes(k)) { posicion = i + 1; break; }
        }
        // Busquedas del momento que comparten alguna palabra con lo que escribio
        const relacionadas = keywords.filter(k => {
          const nk = norm(k);
          return palabras.some(w => nk.includes(w));
        }).slice(0, 5);

        const d0 = Array.isArray(dom) && dom[0] ? dom[0] : null;

        return res.status(200).json({
          ok: true,
          termino,
          categoria: d0 ? (d0.category_name || d0.domain_name || null) : null,
          dominio: d0 ? (d0.domain_name || null) : null,
          posicionEnTendencias: posicion,
          totalTendencias: keywords.length,
          relacionadas,
          topTendencias: keywords.slice(0, 5),
          consultadoEn: new Date().toISOString(),
          fuente: 'mercadolibre-trends+domain_discovery'
        });
      } catch (e) {
        return res.status(200).json({ ok: false, error: 'No pude consultar MercadoLibre ahora.' });
      }
    }

    // Radar de Oportunidad.
    //   ?radar=1                 -> barrido de rubros, gratis
    //   ?radar=1&categoria=MLA5725
    //   ?radar=1&saturacion=<keyword>  -> mide la saturacion de un candidato
    //
    // El descubrimiento no cuesta nada: sale de /trends de MercadoLibre. Lo
    // unico que se paga es la saturacion, y solo del candidato que se pida.
    if (req.query && req.query.radar) {
      // Las consultas que gastan creditos de servicios externos se cortan ACA,
      // antes de pedir el token de MeLi. Si el chequeo va mas abajo, la falta
      // de token responde primero y el guard no llega a correr nunca.
      const gastaCreditos = ['tiktok', 'gtrends', 'saturacion'].filter(function (k) {
        return typeof req.query[k] === 'string' && req.query[k].length > 1;
      });
      if (gastaCreditos.length && !haySesion(tokenDe(req))) {
        const nombres = { tiktok: 'TikTok Shop', gtrends: 'Google Trends', saturacion: 'la competencia en MercadoLibre' };
        return pedirSesion(res, 'Consultar ' + nombres[gastaCreditos[0]] + ' necesita que inicies sesion.');
      }

      const tok = await getMeliAccessToken();
      if (!tok) return res.status(200).json({ ok: false, error: 'No pude autenticarme contra MercadoLibre.' });
      const radar = await import('./_radar.js');

      // Fuentes que no son MercadoLibre. Cuestan plata, asi que solo corren
      // cuando el usuario las pide explicitamente para un termino, nunca al
      // abrir la pagina. El costo estimado viaja en la respuesta.
      if (typeof req.query.tiktok === 'string' && req.query.tiktok.length > 1) {
        const fu = await import('./_fuentes.js');
        const kw = req.query.tiktok.slice(0, 60);
        const r = await fu.tiktokShopBR(kw, { items: 30 });
        if (r.error) return res.status(200).json({ ok: false, keyword: kw, error: r.error });
        if (r.pendiente) return res.status(200).json({ ok: true, keyword: kw, estado: 'preparando',
          aviso: 'Estoy mirando qué se está vendiendo en TikTok Shop. Tarda dos o tres minutos.' });
        if (r.vacia) return res.status(200).json({ ok: true, keyword: kw, estado: 'sin-datos',
          aviso: 'TikTok Shop no devolvió productos para ese término.' });
        // El pais sale de las urls que trajo, no de lo que se pidio: el actor
        // devuelve la tienda de Estados Unidos aunque se le pida otra.
        const nombrePais = { US: 'Estados Unidos', BR: 'Brasil', MX: 'México', ES: 'España' };
        // Cada producto necesita un nombre corto en español para poder
        // preguntarle a MercadoLibre Argentina por el. El titulo original de
        // TikTok no sirve: es ingles con marca, modelo y especificaciones.
        let productos = r.items;
        try {
          const nombres = await radar.nombrarProductos(productos.map(p => p.titulo));
          productos = productos.map(p => Object.assign({}, p, {
            nombre_es: nombres[String(p.titulo).slice(0, 140)] || null
          }));
        } catch (_) { /* sin nombre corto igual se muestra el producto */ }

        return res.status(200).json({ ok: true, keyword: kw, estado: 'listo',
          fuente: 'TikTok Shop ' + (r.pais ? (nombrePais[r.pais] || r.pais) : '(país no identificado)'),
          pais: r.pais || null, monedas: r.monedas || [], desdeCache: !!r.desdeCache,
          costo_usd: fu.costoEstimado('tiktok', 30), productos });
      }

      if (typeof req.query.gtrends === 'string' && req.query.gtrends.length > 1) {
        const fu = await import('./_fuentes.js');
        const kw = req.query.gtrends.slice(0, 60);
        const geo = typeof req.query.geo === 'string' ? req.query.geo : 'AR';
        const r = await fu.googleTrends(kw, { geo });
        if (r.error) return res.status(200).json({ ok: false, keyword: kw, error: r.error });
        if (r.pendiente) return res.status(200).json({ ok: true, keyword: kw, estado: 'preparando',
          aviso: 'Estoy consultando Google Trends. Tarda uno o dos minutos.' });
        if (r.vacia) return res.status(200).json({ ok: true, keyword: kw, estado: 'sin-datos',
          aviso: 'Google Trends no devolvió datos para ese término.' });
        return res.status(200).json({ ok: true, keyword: kw, estado: 'listo',
          fuente: 'Google Trends', geo, desdeCache: !!r.desdeCache,
          costo_usd: fu.costoEstimado('trends', (r.items || []).length), relacionadas: r.items });
      }

      // Una busqueda con la pagina de detalle apagada, para saber si se puede
      // dejar de pagarla. Cuesta ~$0.048, menos que una busqueda normal.
      if (typeof req.query.barato === 'string' && req.query.barato.length > 1) {
        const fu = await import('./_fuentes.js');
        const r = await fu.pruebaSinEnriquecer(req.query.barato.slice(0, 60));
        if (r.error) return res.status(200).json({ ok: false, error: r.error });
        if (r.pendiente) return res.status(200).json({ ok: true, estado: 'preparando',
          aviso: 'Corriendo la busqueda sin pagina de detalle. Tarda dos o tres minutos.' });
        if (r.vacia) return res.status(200).json({ ok: true, estado: 'sin-datos',
          aviso: 'La corrida termino sin resultados.' });
        return res.status(200).json({ ok: true, estado: 'listo', ...r });
      }

      // Si la API oficial (gratis) tapa lo que pierde la corrida barata.
      // No gasta credito: lee el dataset ya pagado y consulta MercadoLibre.
      if (typeof req.query.tapa === 'string' && req.query.tapa.length > 1) {
        const fu = await import('./_fuentes.js');
        const r = await fu.seTapaConLaApi(req.query.tapa.slice(0, 60), tok);
        return res.status(200).json({ ok: !r.error, ...r });
      }

      // Medir la saturacion de un candidato puntual.
      if (typeof req.query.saturacion === 'string' && req.query.saturacion.length > 1) {
        const kw = req.query.saturacion.slice(0, 60);
        // Este camino ya paso por el guard de haySesion de arriba (saturacion
        // esta en gastaCreditos), asi que aca la sesion esta verificada.
        const mla = await radar.saturacionMLA(kw, tok, { puedeGastar: true, origen: 'radar:saturacion' });
        if (!mla) {
          return res.status(200).json({ ok: true, keyword: kw, estado: 'sin-datos',
            aviso: 'No pude medir la saturación de este producto en MercadoLibre Argentina.' });
        }
        if (mla.pendiente) {
          return res.status(200).json({ ok: true, keyword: kw, estado: 'preparando',
            aviso: 'Estoy midiendo cuánta competencia tiene en Argentina. Tarda dos o tres minutos la primera vez.' });
        }
        const demandaPrevia = parseInt(req.query.demanda, 10);
        const score = radar.opportunityScore(
          { scoreDemanda: isFinite(demandaPrevia) ? demandaPrevia : 50 }, mla);
        return res.status(200).json({ ok: true, keyword: kw, estado: 'listo', mla, ...score });
      }

      try {
        const r = await radar.descubrir(tok, {
          categoria: typeof req.query.categoria === 'string' ? req.query.categoria : null,
          // Antes: 6 por defecto, tope 12. Con las clasificaciones cacheadas
          // el barrido grande dejo de ser caro, asi que se abre.
          maxCategorias: Math.min(parseInt(req.query.rubros, 10) || 20, 40),
          // Margen para que la funcion no muera a los 60s de Vercel.
          presupuestoMs: 25000
        });
        if (r.error) return res.status(200).json({ ok: false, error: r.error });
        return res.status(200).json({
          ok: true,
          consultadoEn: new Date().toISOString(),
          rubros: r.rubros,
          sin_clasificar: r.sin_clasificar,
          marcas_filtradas: r.marcas_filtradas,
          rubros_barridos: r.rubros_barridos,
          rubros_pedidos: r.rubros_pedidos,
          rubros_disponibles: r.rubros_disponibles,
          clasificacion_desde_cache: r.clasificacion_desde_cache,
          clasificacion_preguntadas: r.clasificacion_preguntadas,
          clasificados: r.clasificados,
          descartados_no_importables: r.descartadosNoImportables,
          ejemplo_descartado: r.ejemploDescartado,
          // Si la clasificacion fallo se dice, en vez de devolver una lista sin
          // traducir y sin filtrar como si estuviera todo bien.
          error_clasificacion: r.errorClasificacion || undefined,
          total: r.candidatos.length,
          candidatos: r.candidatos.slice(0, 60)
        });
      } catch (e) {
        return res.status(200).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
      }
    }

    // ?tendencias=1 mide de que sirve el recurso /trends de MercadoLibre para
    // descubrir productos, en vez de solo validar los que ya se te ocurrieron.
    // La documentacion dice que los 50 elementos vienen ordenados: los primeros
    // 10 son las busquedas con MAYOR CRECIMIENTO, los 20 siguientes las mas
    // buscadas y los ultimos 20 las mas populares de la semana. Si eso se
    // confirma, el crecimiento de demanda en Argentina sale gratis y por
    // categoria, y solo hay que pagar la saturacion.
    if (req.query && req.query.tendencias) {
      const tok = await getMeliAccessToken();
      if (!tok) return res.status(200).json({ error: 'sin token de MercadoLibre' });
      const cat = typeof req.query.tendencias === 'string' && req.query.tendencias.length > 3
        ? req.query.tendencias : null;

      const pedir = async (ruta) => {
        const r = await fetchJson(MELI_API + ruta, tok, 6000);
        const arr = Array.isArray(r.json) ? r.json : [];
        return {
          ruta,
          status: r.status,
          cantidad: arr.length,
          // Si el orden documentado es cierto, estos 10 son los que crecen.
          crecimiento_top10: arr.slice(0, 10).map(x => x && x.keyword).filter(Boolean),
          mas_buscadas_muestra: arr.slice(10, 15).map(x => x && x.keyword).filter(Boolean),
          claves: arr[0] ? Object.keys(arr[0]) : []
        };
      };

      const salida = {};
      // Categorias de primer nivel: son el esqueleto del barrido por rubro.
      const cats = await fetchJson(MELI_API + '/sites/MLA/categories', tok, 6000);
      salida.categorias_MLA = {
        status: cats.status,
        cantidad: Array.isArray(cats.json) ? cats.json.length : 0,
        muestra: (Array.isArray(cats.json) ? cats.json : []).slice(0, 6).map(c => c.id + ' ' + c.name)
      };

      const catAR = cat || (Array.isArray(cats.json) && cats.json[0] ? cats.json[0].id : null);
      const rutas = ['/trends/MLA', '/trends/MLB'];
      if (catAR) rutas.push('/trends/MLA/' + catAR);
      // Brasil por categoria: si responde, se puede comparar rubro contra rubro
      // y encontrar lo que alla crece y aca todavia no aparece.
      const catsBR = await fetchJson(MELI_API + '/sites/MLB/categories', tok, 6000);
      salida.categorias_MLB = {
        status: catsBR.status,
        cantidad: Array.isArray(catsBR.json) ? catsBR.json.length : 0
      };
      if (Array.isArray(catsBR.json) && catsBR.json[0]) rutas.push('/trends/MLB/' + catsBR.json[0].id);

      salida.trends = [];
      for (const ruta of rutas) salida.trends.push(await pedir(ruta));
      return res.status(200).json(salida);
    }

    // ?ia=1 prueba la llamada a Anthropic con el mismo modelo y la misma key
    // que usan el analizador y el radar, y muestra el mensaje de error tal cual
    // lo devuelve Anthropic.
    if (req.query && req.query.ia) {
      // Diagnostico: dice que variables de entorno estan cargadas. Solo admin.
      if (!esAdmin(tokenDe(req))) return pedirSesion(res, 'Diagnostico reservado al administrador.');
      const salida = {
        anthropic_key: !!process.env.ANTHROPIC_API_KEY,
        // Si esto es false y los modelos dan 400 pidiendo el workspace, ese es
        // el problema: falta cargar la variable en Vercel.
        anthropic_workspace_id: !!process.env.ANTHROPIC_WORKSPACE_ID
      };
      for (const modelo of ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5']) {
        try {
          const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: anthropicHeaders(),
            body: JSON.stringify({
              model: modelo,
              max_tokens: 64,
              messages: [{ role: 'user', content: 'Responde solo: ok' }]
            })
          });
          const j = await r.json().catch(() => ({}));
          salida[modelo] = r.ok
            ? 'ok'
            : (r.status + ': ' + String((j.error && j.error.message) || '').slice(0, 160));
        } catch (e) {
          salida[modelo] = 'excepcion: ' + String((e && e.message) || e).slice(0, 100);
        }
      }
      return res.status(200).json(salida);
    }

    // ?actors=1 lista los actors de Apify que sirven para el Radar de
    // Oportunidad, con su precio real. Es read-only: no corre ninguno, asi que
    // no gasta credito. Elegir el actor mirando esto y no el marketplace evita
    // descubrir el precio (o que no existe) recien cuando falla en produccion.
    // ?corrida=1 mira los datos crudos de la ultima corrida pagada, para saber
    // si el actor informa el total de publicaciones. Leer datasets es gratis.
    if (req.query && req.query.corrida) {
      // Diagnostico: dice que variables de entorno estan cargadas. Solo admin.
      if (!esAdmin(tokenDe(req))) return pedirSesion(res, 'Diagnostico reservado al administrador.');
      const bus = await import('./_buscador.js');
      const filtro = typeof req.query.corrida === 'string' && req.query.corrida.length > 2
        ? req.query.corrida : null;
      try { return res.status(200).json(await bus.inspeccionarUltimaCorrida(filtro)); }
      catch (e) { return res.status(200).json({ error: String((e && e.message) || e).slice(0, 200) }); }
    }

    // ?esquema=<actor> muestra que campos acepta. Sirve para saber que apagar
    // para no pagar el enriquecimiento. Es lectura: no corre nada.
    if (req.query && req.query.esquema) {
      // Diagnostico: dice que variables de entorno estan cargadas. Solo admin.
      if (!esAdmin(tokenDe(req))) return pedirSesion(res, 'Diagnostico reservado al administrador.');
      const bus = await import('./_buscador.js');
      const id = typeof req.query.esquema === 'string' && req.query.esquema.length > 3
        ? req.query.esquema : (process.env.APIFY_ACTOR || 'devcake~mercadolibre-scraper');
      try { return res.status(200).json(await bus.esquemaDeActor(id)); }
      catch (e) { return res.status(200).json({ error: String((e && e.message) || e).slice(0, 200) }); }
    }

    if (req.query && req.query.actors) {
      const bus = await import('./_buscador.js');
      const consultas = typeof req.query.actors === 'string' && req.query.actors.length > 2
        ? [req.query.actors]
        : ['google trends', 'tiktok shop', 'mercadolibre'];
      try {
        const [cuenta, ...resultados] = await Promise.all([
          bus.estadoCuentaApify(),
          ...consultas.map(c => bus.buscarActors(c, 8))
        ]);
        return res.status(200).json({
          cuenta,
          actor_en_uso: process.env.APIFY_ACTOR || 'devcake~mercadolibre-scraper',
          busquedas: resultados
        });
      } catch (e) {
        return res.status(200).json({ error: String((e && e.message) || e).slice(0, 200) });
      }
    }

    // ?proveedor=termino corre el proveedor externo y mide cuanto tarda.
    // Va aparte de ?catalogo= porque una corrida de Apify puede llevar
    // decenas de segundos y arrastraba a todo el diagnostico al timeout.
    if (req.query && typeof req.query.proveedor === 'string') {
      const termino = req.query.proveedor.length > 1 ? req.query.proveedor : 'auriculares bluetooth';
      const bus = await import('./_buscador.js');
      const salida = { termino, ...bus.estadoProveedor() };
      if (bus.proveedor() === 'off') {
        salida.aviso = 'No hay proveedor configurado (falta APIFY_TOKEN o similar).';
        return res.status(200).json(salida);
      }
      const arranque = Date.now();
      try {
        const tok = await getMeliAccessToken();
        const ext = await bus.buscarConProveedor(termino, tok, { maxItems: 48, timeoutMs: 50000 });
        salida.tardo_ms = Date.now() - arranque;
        salida.resultado = ext
          ? {
              fuente: ext.fuente,
              resultados: ext.results.length,
              total: ext.total,
              muestra: ext.results.slice(0, 5).map(x => ({ titulo: String(x.title).slice(0, 45), precio: x.price }))
            }
          : 'sin resultados';
      } catch (e) {
        salida.tardo_ms = Date.now() - arranque;
        salida.error = String((e && e.message) || e).slice(0, 300);
        if (e && e.input_enviado) salida.campos_enviados = e.input_enviado;
      }
      return res.status(200).json(salida);
    }

    // ?catalogo=termino recorre paso a paso las vias de precio y reporta que
    // devuelve cada endpoint de MercadoLibre. Es para diagnosticar por que una
    // busqueda vuelve vacia, sin adivinar. No expone tokens.
    if (req.query && typeof req.query.catalogo === 'string') {
      const termino = req.query.catalogo.length > 1 ? req.query.catalogo : 'auriculares bluetooth';
      const q = encodeURIComponent(termino);
      const paso = {};
      try {
        const tok = await getMeliAccessToken();
        paso.token = !!tok;
        paso.token_origen = _ultimoMotivoToken;
        paso.via_recordada = viaDeBusquedaUsada();

        // Proveedor externo: aca solo la configuracion. Correr el actor es
        // lento (levanta un contenedor) y hacia que el diagnostico entero se
        // pasara del tiempo de la funcion: se prueba en ?proveedor=<termino>.
        const bus = await import('./_buscador.js');
        paso.proveedor_externo = bus.estadoProveedor();

        // Estado vivo de la corrida pendiente, si hay. Consultarlo no arranca
        // ninguna corrida nueva, asi que no cuesta plata. Sirve para ver si
        // quedo encolada o si fallo, en vez de deducirlo.
        try {
          const fila = await filaDeCache(termino);
          if (fila && fila.run_id) {
            const est = await bus.estadoCorrida(fila.run_id);
            paso.corrida_pendiente = {
              run_id: fila.run_id,
              estado_vivo: est.estado,
              arrancada: fila.run_desde
            };
          }
        } catch (_) { /* el diagnostico no puede romperse por esto */ }

        const busq = await fetchJson('https://api.mercadolibre.com/products/search?status=active&site_id=MLA&limit=10&q=' + q, tok, 5000);
        paso.products_search = { ok: busq.ok, status: busq.status };
        const lista = (busq.json && Array.isArray(busq.json.results)) ? busq.json.results : [];
        paso.products_search.resultados = lista.length;
        paso.products_search.claves = lista[0] ? Object.keys(lista[0]).slice(0, 14) : [];
        const pid = lista[0] && (lista[0].id || lista[0].catalog_product_id || lista[0].product_id);
        paso.products_search.primer_id = pid || null;

        if (pid) {
          const det = await fetchJson('https://api.mercadolibre.com/products/' + pid, tok, 4000);
          paso.producto_detalle = { status: det.status, buy_box: det.json ? !!det.json.buy_box_winner : false };
          const its = await fetchJson('https://api.mercadolibre.com/products/' + pid + '/items?limit=10', tok, 4000);
          const arr = (its.json && Array.isArray(its.json.results)) ? its.json.results : [];
          paso.producto_items = {
            status: its.status,
            cantidad: arr.length,
            con_precio: arr.filter(x => x && typeof x.price === 'number' && x.price > 0).length,
            claves: arr[0] ? Object.keys(arr[0]).slice(0, 14) : []
          };
        }

        const dom = await fetchJson('https://api.mercadolibre.com/sites/MLA/domain_discovery/search?limit=3&q=' + q, tok, 4000);
        const catId = (dom.json && dom.json[0] && dom.json[0].category_id) || null;
        paso.domain_discovery = { status: dom.status, category_id: catId };
        if (catId) {
          const hl = await fetchJson('https://api.mercadolibre.com/highlights/MLA/category/' + catId, tok, 4000);
          const cont = (hl.json && Array.isArray(hl.json.content)) ? hl.json.content : [];
          paso.highlights = { status: hl.status, cantidad: cont.length };
          const ids = cont.filter(c => c && c.id).map(c => c.id).slice(0, 20);
          if (ids.length) {
            const it = await fetchJson('https://api.mercadolibre.com/items?ids=' + ids.join(',') + '&attributes=id,title,price,sold_quantity,seller_id,shipping', tok, 5000);
            const filas = Array.isArray(it.json) ? it.json : [];
            const cuerpos = filas.map(f => (f && (f.body || f))).filter(Boolean);
            paso.items_por_ids = {
              status: it.status,
              devueltos: cuerpos.length,
              con_precio: cuerpos.filter(b => typeof b.price === 'number' && b.price > 0).length,
              muestra: cuerpos.slice(0, 3).map(b => ({ titulo: String(b.title || '').slice(0, 50), precio: b.price }))
            };
          }
        }

        // Que devuelven las paginas publicas desde el server. El listado
        // contestaba 200 pero con 0 IDs y 38 KB: eso no es una pagina de
        // resultados, asi que hay que ver que es.
        paso.paginas_publicas = [];
        for (const cand of candidatosDeListado(termino)) {
          const pag = await traerPagina(cand, 6000);
          const ids = extraerIdsMLA(pag.texto);
          const t = pag.texto.toLowerCase();
          paso.paginas_publicas.push({
            url: cand,
            status: pag.status,
            url_final: pag.urlFinal !== cand ? pag.urlFinal : undefined,
            bytes: pag.texto.length,
            titulo: (pag.texto.match(/<title[^>]*>([^<]{0,90})/i) || [])[1] || null,
            ids: ids.length,
            muro: /suspicious-traffic|account-verification|captcha|unusual traffic/.test(t) || undefined,
            patrones: ids.length ? idsPorPatron(pag.texto, 'MLA') : undefined,
            inicio: pag.texto.replace(/\s+/g, ' ').slice(0, 160)
          });
          if (ids.length) { paso.ids_de = cand; paso.ids_muestra = ids.slice(0, 8); break; }
        }

        // Prueba decisiva: /items?ids= nunca se pudo probar por falta de IDs.
        // Se prueba con publicaciones de la propia cuenta, que son IDs validos
        // seguros. Si esto anda, el problema es solo de donde sacar los IDs.
        const yo = await fetchJson(MELI_API + '/users/me', tok, 4000);
        const miId = yo.json && yo.json.id;
        paso.mi_cuenta = { status: yo.status, id: miId || null };
        if (miId) {
          const mios = await fetchJson(MELI_API + '/users/' + miId + '/items/search?limit=3', tok, 4000);
          const misIds = (mios.json && Array.isArray(mios.json.results)) ? mios.json.results : [];
          paso.mis_publicaciones = { status: mios.status, cantidad: misIds.length };
          // Prueba 1: IDs propios, que son validos con certeza. Esto dice si
          // /items?ids= sirve, sin mezclarlo con IDs sacados del HTML.
          // (Antes un slice(0,5) se comia estos IDs y la prueba no medía nada.)
          if (misIds.length) {
            const propios = await hidratarItems(misIds.slice(0, 3), tok, Date.now() + 5000);
            paso.items_propios = {
              pedidos: Math.min(3, misIds.length),
              devueltos: propios.length,
              muestra: propios.slice(0, 2).map(b => ({ titulo: String(b.title || '').slice(0, 40), precio: b.price }))
            };
            const uno = await fetchJson(MELI_API + '/items/' + misIds[0], tok, 4000);
            paso.item_individual = { status: uno.status, precio: uno.json ? uno.json.price : null };
          }
          // Prueba 2: IDs sacados del HTML publico. Con la extraccion vieja
          // salian ids de tracking de 13 y 15 digitos que MeLi rechazaba.
          const delHtml = (paso.ids_muestra || []).slice(0, 5);
          if (delHtml.length) {
            const hidratados = await hidratarItems(delHtml, tok, Date.now() + 5000);
            paso.items_del_html = {
              pedidos: delHtml.length,
              devueltos: hidratados.length,
              muestra: hidratados.slice(0, 3).map(b => ({ titulo: String(b.title || '').slice(0, 45), precio: b.price }))
            };
          }
        }

        // Solo el admin puede hacer que un diagnostico gaste una corrida.
        // Hasta ahora ?catalogo= arrancaba el actor para cualquiera con la URL.
        const final = await safeMeliSearch(termino, { puedeGastar: esAdmin(tokenDe(req)), origen: 'diag:catalogo' });
        paso.resultado_final = final
          ? { fuente: final.fuente, resultados: (final.results || []).length, total: final.total }
          : 'no-disponible';
      } catch (e) {
        paso.error = String((e && e.message) || e).slice(0, 200);
      }
      return res.status(200).json({ termino, paso });
    }

    // ?catinfo=MLA433655 pregunta a MercadoLibre cuantas publicaciones tiene
    // esa categoria. Es la unica via que queda para medir saturacion: el
    // scraper devuelve la publicacion pero nunca el total del mercado.
    // Acepta varias separadas por coma y prueba tambien el arbol de la
    // categoria, porque el numero sirve solo si es de la hoja y no del rubro.
    if (req.query && req.query.catinfo) {
      const ids = String(req.query.catinfo).split(',')
        .map(s => s.trim()).filter(s => /^ML[A-Z]\d{3,}$/.test(s)).slice(0, 4);
      if (!ids.length) return res.status(200).json({ error: 'pasa ids tipo MLA433655' });
      const tok = await getMeliAccessToken();
      const auth = tok ? { Authorization: 'Bearer ' + tok, Accept: 'application/json' } : { Accept: 'application/json' };
      const salida = {};
      for (const id of ids) {
        try {
          const r = await fetch(MELI_API + '/categories/' + id, { headers: auth });
          if (!r.ok) { salida[id] = { status: r.status }; continue; }
          const j = await r.json().catch(() => null);
          salida[id] = {
            status: r.status,
            nombre: j && j.name,
            total_items: j && j.total_items_in_this_category,
            camino: j && Array.isArray(j.path_from_root) ? j.path_from_root.map(p => p.name).join(' > ') : null,
            hijas: j && Array.isArray(j.children_categories)
              ? j.children_categories.slice(0, 6).map(c => c.id + ' ' + c.name + ': ' + c.total_items_in_this_category)
              : null
          };
        } catch (e) { salida[id] = { error: String((e && e.message) || e).slice(0, 120) }; }
      }
      return res.status(200).json({ token: !!tok, categorias: salida });
    }

    // ?probe=termino hace una consulta real y reporta a que endpoints de
    // MercadoLibre llega la app. Sirve para diagnosticar sin abrir la web.
    // No devuelve tokens ni datos de ningun usuario.
    if (req.query && req.query.probe) {
      const termino = typeof req.query.probe === 'string' && req.query.probe.length > 1
        ? req.query.probe : 'auriculares bluetooth';
      const q = encodeURIComponent(termino);
      try {
        const tok = await getMeliAccessToken();
        estado.token_obtenido = !!tok;
        estado.token_origen = _ultimoMotivoToken;
        const auth = tok ? { Authorization: 'Bearer ' + tok, Accept: 'application/json' } : { Accept: 'application/json' };
        const endpoints = {
          sites_search:     'https://api.mercadolibre.com/sites/MLA/search?q=' + q + '&limit=1',
          products_search:  'https://api.mercadolibre.com/products/search?status=active&site_id=MLA&q=' + q,
          domain_discovery: 'https://api.mercadolibre.com/sites/MLA/domain_discovery/search?limit=3&q=' + q,
          trends:           'https://api.mercadolibre.com/trends/MLA'
        };
        estado.endpoints = {};
        for (const [nombre, u] of Object.entries(endpoints)) {
          try {
            const r = await fetch(u, { headers: auth });
            if (!r.ok) { estado.endpoints[nombre] = r.status; continue; }
            const j = await r.json().catch(() => null);
            const n = Array.isArray(j) ? j.length : (j && Array.isArray(j.results) ? j.results.length : '?');
            estado.endpoints[nombre] = r.status + ' (' + n + ')';
          } catch (e) { estado.endpoints[nombre] = 'excepcion'; }
        }
        // Que devuelve hoy la cadena completa de busqueda, con precios.
        // Idem ?catalogo=: sin admin, este diagnostico no gasta.
        const r = await safeMeliSearch(termino, { puedeGastar: esAdmin(tokenDe(req)), origen: 'diag:probe' });
        const precios = r ? (r.results || []).map(x => x && x.price).filter(p => typeof p === 'number' && p > 0) : [];
        estado.probe = r
          ? { termino, fuente: r.fuente, resultados: (r.results || []).length, con_precio: precios.length, total: r.total || 0 }
          : { termino, fuente: 'no-disponible', resultados: 0, con_precio: 0 };
      } catch (e) {
        estado.probe = { termino, error: String((e && e.message) || e).slice(0, 200) };
      }
    }
    return res.status(200).json(estado);
  }
  const { step, product, url, customPrompt } = req.body || {};
    if (!step) return res.status(400).json({ error: 'step requerido' });

  // Contexto de la consulta. puedeGastar habilita SOLO la via paga de Apify:
  // sin sesion el Market Reader sigue andando con las vias gratuitas, que es
  // lo que necesita el demo publico de la portada.
  const ctx = { puedeGastar: haySesion(tokenDe(req)), origen: 'market:' + step };

  if (step === 'productUrl') {
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url requerida' });
    let cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = 'https://' + cleanUrl;
    try { return res.status(200).json(await readProductUrl(cleanUrl)); }
    catch (e) { return res.status(400).json({ error: 'No se pudo leer el link', detalle: String(e && e.message || e) }); }
  }
  if (step === 'demanda') {
    try { return res.status(200).json(await stepDemanda(product, ctx)); }
    catch (e) { return res.status(500).json({ error: 'Fallo demanda', detalle: String(e && e.message || e) }); }
  }
  if (step === 'competencia') {
    // El flush va ANTES de responder: si se responde primero, Vercel congela
    // el proceso y el insert no sale nunca.
    try { const r = await stepCompetencia(product, ctx); await flushRelevancia(); return res.status(200).json(r); }
    catch (e) { return res.status(500).json({ error: 'Fallo competencia', detalle: String(e && e.message || e) }); }
  }
  if (step === 'exploracion') {
    try { const r = await stepExploracion(product, ctx); await flushRelevancia(); return res.status(200).json(r); }
    catch (e) { return res.status(500).json({ error: 'Fallo exploracion', detalle: String(e && e.message || e) }); }
  }
  if (step === 'region') {
    try { const r = await stepRegion(product); await flushRelevancia(); return res.status(200).json(r); }
    catch (e) { return res.status(500).json({ error: 'Fallo region', detalle: String(e && e.message || e) }); }
  }
  if (step === 'testBusqueda') {
    try { const r = await stepTestBusqueda(product, ctx); await flushRelevancia(); return res.status(200).json(r); }
    catch (e) { return res.status(500).json({ error: 'Fallo test de busqueda', detalle: String(e && e.message || e) }); }
  }
  if (step === 'final') {
    try { return res.status(200).json(await stepFinal(customPrompt)); }
    catch (e) { return res.status(500).json({ error: 'Fallo final', detalle: String(e && e.message || e) }); }
  }
  return res.status(400).json({ error: 'step invalido' });
}

async function stepDemanda(product, ctx) {
  if (!product) throw new Error('product requerido');
  const meli = await safeMeliSearch(product, ctx);
  const trends = await safeGoogleTrends(product);
  const hayTrends = !!(trends && trends.monthlyData && trends.monthlyData.length === 12);
  // De donde sale la curva de demanda. Google bloquea las IPs de datacenter,
  // asi que desde Vercel safeGoogleTrends devuelve null casi siempre: cuando
  // eso pasa los 12 meses y el score los estima el modelo, y el front lo tiene
  // que decir con todas las letras en vez de mostrarlo como dato medido.
  const fuenteDemanda = hayTrends ? 'google-trends' : 'estimacion-ia';
  const totalMeli = meli && meli.total != null ? meli.total : 'sin dato';
  const catName = meli && meli.categoryName ? meli.categoryName : 'sin dato';
  const trendsStr = hayTrends ? trends.values.join(',') : 'sin dato';
  const prompt = 'Sos analista de e-commerce Argentina. Para el producto "' + product + '" genera JSON de DEMANDA AR. Datos reales: Total publicaciones MeLi AR=' + totalMeli + '; Top categoria=' + catName + '; Google Trends 12m (0-100)=' + trendsStr + '. Responde SOLO JSON sin markdown: {"tendencia":"subiendo|estable|bajando","nivelDemanda":"alto|medio|bajo","demandaScore":0-100,"temporalidad":"string corto","descripcion":"1-2 oraciones rioplatense","tags":["t1","t2","t3"],"monthlyData":[{"mes":"Ene","valor":0-100},{"mes":"Feb","valor":0-100},{"mes":"Mar","valor":0-100},{"mes":"Abr","valor":0-100},{"mes":"May","valor":0-100},{"mes":"Jun","valor":0-100},{"mes":"Jul","valor":0-100},{"mes":"Ago","valor":0-100},{"mes":"Sep","valor":0-100},{"mes":"Oct","valor":0-100},{"mes":"Nov","valor":0-100},{"mes":"Dic","valor":0-100}]}';
  const j = await askClaudeJson(prompt);
  // El prompt pedia la clave con tilde ("descripcion") y el front leia
  // r.descripcion: el texto nunca se mostraba. Se acepta cualquiera de las dos
  // por si el modelo devuelve la vieja, pero la que viaja es sin tilde.
  if (!j.descripcion && j['descripci\u00f3n']) j.descripcion = j['descripci\u00f3n'];
  delete j['descripci\u00f3n'];

  if (hayTrends) {
    j.monthlyData = trends.monthlyData;
    const first3 = (trends.values[0]+trends.values[1]+trends.values[2])/3;
    const last3 = (trends.values[9]+trends.values[10]+trends.values[11])/3;
    if (last3 > first3*1.15) j.tendencia = 'subiendo';
    else if (last3 < first3*0.85) j.tendencia = 'bajando';
    else j.tendencia = 'estable';
    const avg = trends.values.reduce((a,b)=>a+b,0)/12;
    j.demandaScore = Math.round(Math.min(100, Math.max(0, avg)));
  }
  j.monthlyData = buildRollingMonths(j.monthlyData);
  j.rangoFechas = j.monthlyData[0].label + ' - ' + j.monthlyData[11].label;
  j.fuenteDemanda = fuenteDemanda;
  j.trendsMotivo = hayTrends ? null : (_ultimoMotivoTrends || 'Google Trends no respondio');
  return j;
}

async function stepCompetencia(product, ctx) {
  if (!product) throw new Error('product requerido');
  const meli = await safeMeliSearch(product, ctx);
  // Este es el paso que mas se usa, y hasta ahora era el UNICO que no
  // registraba: registrarRelevancia() vivia solo adentro de contarPublicaciones(),
  // que stepCompetencia no usa. Por eso la tabla quedaba vacia aunque el
  // endpoint de competencia se llamara todo el dia.
  //
  // Se registra tambien cuando NO hubo datos ('no-disponible', muestra 0):
  // esas son las consultas que hay que poder mirar despues, no las que salieron
  // bien.
  registrarRelevanciaDeCompetencia(product, meli);
  // La busqueda arranco pero todavia no termino: se avisa en vez de mostrar
  // un vacio que parece un error.
  if (meli && meli.pendiente) {
    return { fuente: 'preparando', sellersEstimados: null, precioMinARS: null, precioMaxARS: null,
      precioPromedioARS: null, totalResults: null, categoryName: '', saturacion: null,
      competenciaScore: null, competitors: [],
      aviso: 'Estoy trayendo los datos de MercadoLibre para este producto. La primera vez tarda dos o tres minutos; despues queda guardado y sale al instante.' };
  }
  // Freno de gasto: NO se consulto. Esto es consultaFallida, no sinComparable.
  // La diferencia importa mas que ninguna otra en este archivo: "no hay
  // comparable" es un veredicto sobre el mercado y dispara el modo sin
  // comparable; "no consulte" es un estado del sistema. Confundirlos le diria
  // al usuario que su producto no tiene mercado cuando lo unico que pasa es
  // que no inicio sesion.
  if (meli && meli.requiereSesion) {
    return { fuente: 'requiere-sesion', requiereSesion: true,
      muestraInsuficiente: true, muestra: 0, sinComparable: false, consultaFallida: true,
      sellersEstimados: null, precioMinARS: null, precioMaxARS: null, precioPromedioARS: null,
      totalResults: null, categoryName: '', saturacion: null, competenciaScore: null,
      competitors: [], envioGratisPct: null,
      aviso: meli.aviso || 'Para traer publicaciones reales de MercadoLibre necesitas iniciar sesion.' };
  }
  if (meli && meli.topeAlcanzado) {
    return { fuente: 'tope-diario', topeAlcanzado: true, gasto: meli.gasto || null,
      muestraInsuficiente: true, muestra: 0, sinComparable: false, consultaFallida: true,
      sellersEstimados: null, precioMinARS: null, precioMaxARS: null, precioPromedioARS: null,
      totalResults: null, categoryName: '', saturacion: null, competenciaScore: null,
      competitors: [], envioGratisPct: null,
      aviso: meli.aviso || 'Se alcanzo el tope diario de busquedas pagas en MercadoLibre.' };
  }
  // Cero CONFIRMADO: se entro al listado publico y no hay ninguna publicacion.
  // Es un dato, y es el que dispara el modo "sin comparable". Distinto del
  // caso de mas abajo, donde MercadoLibre no nos dejo consultar.
  if (meli && meli.vacioConfirmado) {
    return {
      fuente: meli.fuente || 'meli-listado+items',
      muestraInsuficiente: true, muestra: 0, sinComparable: true, consultaFallida: false,
      sellersEstimados: 0,
      precioMinARS: null, precioMaxARS: null, precioPromedioARS: null,
      totalResults: 0, totalCatalogo: null, totalLabel: 'Total publicaciones activas',
      categoryName: meli.categoryName || '', saturacion: null, competenciaScore: null,
      competitors: [], envioGratisPct: null,
      aviso: 'Cero publicaciones en MercadoLibre Argentina. No es poca competencia: no hay comparable.'
    };
  }
  // Relevancia cero: MercadoLibre devolvio publicaciones pero ninguna es del
  // producto buscado. Medido en la pagina real, una busqueda sin coincidencias
  // devuelve resultados DE RESCATE (bujias, repuestos) presentados como
  // normales. Antes esto se leia como "existe, competencia moderada" y encima
  // el precio mediano y la saturacion se calculaban sobre esos productos.
  // 'dudoso': MercadoLibre devolvio cosas parcialmente relacionadas. No se
  // afirma ausencia (eso cerraria SIN MERCADO sobre una duda) pero tampoco se
  // publica un precio de referencia como si fuera del producto.
  if (meli && meli.relevancia && meli.relevancia.estado === 'dudoso') {
    const rel = meli.relevancia;
    return {
      fuente: meli.fuente || 'meli-listado+items',
      muestraInsuficiente: true, muestra: (meli.results || []).length,
      sinComparable: true, consultaFallida: false, relevanciaDudosa: true,
      estadoRelevancia: 'dudoso',
      relevantes: rel.relevantes, muestraDevuelta: rel.muestra, ratioRelevancia: rel.ratio,
      sellersEstimados: null,
      precioMinARS: null, precioMaxARS: null, precioPromedioARS: null,
      totalResults: null, totalCatalogo: null, totalLabel: null,
      totalCrudoMeli: (typeof meli.total === 'number') ? meli.total : null,
      categoryName: meli.categoryName || '', saturacion: null, competenciaScore: null,
      competitors: [], envioGratisPct: null,
      aviso: 'MercadoLibre devolvio resultados parcialmente relacionados (relevancia ' +
             rel.ratio.toFixed(2) + '): no puedo confirmar si tu producto exacto se vende aca.'
    };
  }

  if (meli && meli.relevanciaCero && meli.relevancia) {
    const rel = meli.relevancia;
    return {
      fuente: meli.fuente || 'meli-listado+items',
      muestraInsuficiente: true, muestra: 0, sinComparable: true, consultaFallida: false,
      relevantes: 0, muestraDevuelta: rel.muestra, ratioRelevancia: 0, estadoRelevancia: 'noExiste',
      sellersEstimados: 0,
      precioMinARS: null, precioMaxARS: null, precioPromedioARS: null,
      totalResults: null, totalCatalogo: null, totalLabel: null,
      totalCrudoMeli: (typeof meli.total === 'number') ? meli.total : null,
      categoryName: '', saturacion: null, competenciaScore: null,
      competitors: [], envioGratisPct: null,
      aviso: 'MercadoLibre te devolvio resultados, pero no son tu producto: ' + rel.muestra +
             ' publicaciones y ninguna coincide con la busqueda. Son resultados de rescate.'
    };
  }

  if (meli && meli.results && meli.results.length > 0) {
    // Los results que llegan ya vienen filtrados por relevancia desde la via
    // de busqueda. Igual se recalcula aca para poder informar el ratio y para
    // no depender de que toda via lo haya hecho.
    const relCalc = relevanciaPorTitulo(product, meli.results);
    const rel = meli.relevancia || { relevantes: relCalc.relevantes, muestra: relCalc.muestra, ratio: relCalc.ratio };
    const results = relCalc.items.length ? relCalc.items : meli.results;
    const fuente = meli.fuente || 'mercadolibre-search';
    const prices = results.map(x => x.price).filter(p => typeof p === 'number' && p > 0).sort((a,b)=>a-b);
    const sellers = new Set(results.map(x => x.seller && x.seller.id).filter(Boolean));
    const conEnvioGratis = results.filter(x => x.shipping && x.shipping.free_shipping).length;
    const competitors = results.slice(0,5).map((x,i)=>({rank:i+1, name:(x.seller && x.seller.nickname) || ('Vendedor '+(i+1)), price:x.price||0, soldQty:x.sold_quantity||0, reputation:(x.seller && x.seller.seller_reputation && x.seller.seller_reputation.level_id) || 'N/A', repClass:'comp-rep-ok', freeShipping: !!(x.shipping && x.shipping.free_shipping)}));

    // El "total" del catalogo NO son publicaciones activas: paging.total de
    // /products/search cuenta PRODUCTOS DE CATALOGO. Rotularlo como
    // publicaciones y sacarle saturacion es inventar un dato. Por esa via el
    // numero se muestra con su nombre real y la saturacion queda en null.
    const esCatalogo = fuente === 'meli-catalogo';
    const totalCrudo = (typeof meli.total === 'number' && meli.total > 0) ? meli.total : null;
    const total = esCatalogo ? null : totalCrudo;
    const totalCatalogo = esCatalogo ? totalCrudo : null;
    const totalLabel = esCatalogo ? 'Productos en el catalogo de MeLi' : 'Total publicaciones activas';

    let saturacion = null;
    if (total != null) {
      saturacion = 'moderado';
      if (total < 200) saturacion = 'libre';
      else if (total > 10000) saturacion = 'muy saturado';
      else if (total > 2000) saturacion = 'saturado';
    }

    // Muestra chica: con menos de 8 publicaciones el rango, el promedio y la
    // mediana no describen nada. Medido en produccion, el catalogo devolvia
    // UNA publicacion y el front mostraba precioMin = precioMax como si fuera
    // el precio de mercado. Con muestra insuficiente no se devuelve precio de
    // referencia: se devuelve el aviso.
    const MUESTRA_MINIMA = 8;
    if (results.length < MUESTRA_MINIMA) {
      // Con 2 o menos publicaciones no hay comparable: no es "poca
      // competencia", es que el producto no se vende aca. El competenciaScore
      // se anula a proposito, porque un score alto por ausencia de
      // competidores premiaba justamente el caso mas riesgoso.
      const sinComp = results.length <= 2;
      return {
        fuente, muestraInsuficiente: true, muestra: results.length,
        sinComparable: sinComp,
        relevantes: rel.relevantes, muestraDevuelta: rel.muestra, ratioRelevancia: rel.ratio,
        estadoRelevancia: rel.estado || 'existe',
        totalCrudoMeli: (typeof meli.total === 'number') ? meli.total : null,
        sellersEstimados: sellers.size || results.length,
        precioMinARS: null, precioMaxARS: null, precioPromedioARS: null,
        totalResults: total, totalCatalogo, totalLabel,
        categoryName: meli.categoryName || '',
        saturacion: null, competenciaScore: null,
        competitors,
        envioGratisCount: conEnvioGratis, envioGratisTotal: results.length,
        envioGratisPct: null,
        aviso: 'Muestra insuficiente (' + results.length + ' publicaciones). No calculo precio de referencia con esto.'
      };
    }

    const min = prices[0] || 0;
    const max = prices[prices.length-1] || 0;
    const avg = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
    return {
      fuente, muestraInsuficiente: false, sinComparable: false, muestra: results.length,
      relevantes: rel.relevantes, muestraDevuelta: rel.muestra, ratioRelevancia: rel.ratio,
      estadoRelevancia: rel.estado || 'existe',
      totalCrudoMeli: (typeof meli.total === 'number') ? meli.total : null,
      sellersEstimados: sellers.size || results.length,
      precioMinARS: min, precioMaxARS: max, precioPromedioARS: avg,
      totalResults: total, totalCatalogo, totalLabel,
      categoryName: meli.categoryName || '',
      saturacion,
      competenciaScore: total != null ? Math.min(100, Math.round(total/100)) : null,
      competitors,
      envioGratisCount: conEnvioGratis, envioGratisTotal: results.length,
      envioGratisPct: Math.round((conEnvioGratis/results.length)*100),
      aviso: esCatalogo
        ? 'Este numero sale del catalogo de MercadoLibre: son productos de catalogo, no publicaciones activas. Por eso no calculo saturacion.'
        : (total == null ? 'MercadoLibre no expone el total de publicaciones por esta via: el precio y los competidores son reales, la saturacion no se puede calcular.' : null)
    };
  }
  // IMPORTANTE: si no hay datos reales de MeLi (API 403 o scraping fallido) NO inventamos numeros via IA.
  // Ojo con la diferencia: aca NO se pudo consultar. Eso no es lo mismo que
  // "no hay publicaciones", asi que no se marca sinComparable: marcarlo
  // dispararia el modo de producto sin comparable por un bloqueo de MeLi.
  return { fuente: 'no-disponible', muestraInsuficiente: true, muestra: 0, sinComparable: false, consultaFallida: true, sellersEstimados: null, precioMinARS: null, precioMaxARS: null, precioPromedioARS: null, totalResults: null, totalCatalogo: null, totalLabel: null, categoryName: '', saturacion: null, competenciaScore: null, competitors: [], envioGratisPct: null, aviso: 'Datos de Mercado Libre no disponibles ahora (la API publica requiere autenticacion). Mostramos solo lo verificable.' };
}

// ============================================================
// MODO "PRODUCTO SIN COMPARABLE EN MERCADO LIBRE"
//
// Cuando un producto no esta en MeLi Argentina, el sistema viejo lo leia como
// saturacion baja -> competencia buena -> sumaba al veredicto. Estaba
// premiando la ausencia de competencia. En importacion eso es al reves: casi
// nunca significa "nadie lo descubrio", significa "alguien ya lo probo y no
// funciono" o "no se puede traer". Estos dos steps juntan la evidencia para
// distinguir esos casos en vez de premiarlos.
// ============================================================

// PRESUPUESTO DE TIEMPO. vercel.json le da 60 s a las funciones. Medido con
// latencia realista, categoria madre + tres paises tarda 17-26 s; pero en el
// peor caso (cada URL de listado colgada, 6 s de timeout x 4 candidatas x
// varios terminos) supera los dos minutos, y ese peor caso es JUSTO el de un
// producto que no existe, o sea el que esta funcion tiene que atender.
//
// Por eso son dos steps, cada uno con su propia invocacion de 60 s:
//   'exploracion' -> Argentina: categoria madre + conteo local
//   'region'      -> Brasil y Mexico, en paralelo
// El front los pide a la vez y pinta el bloque a medida que llegan, asi el
// usuario ve algo mucho antes del limite. Ademas cada uno corta a los 40 s y
// devuelve lo que junto: lo que no se llego a consultar queda como "sin dato",
// nunca como cero.
const PRESUPUESTO_MS = Number(process.env.MARKET_PRESUPUESTO_MS || 40000);

// 8.b: categoria madre, y el conteo de Argentina.
async function stepExploracion(product, ctx) {
  if (!product) throw new Error('product requerido');
  const puedeGastar = !!(ctx && ctx.puedeGastar);
  const deadline = Date.now() + PRESUPUESTO_MS;
  const tok = await getMeliAccessToken();
  const radar = await import('./_radar.js');

  let progresivos = [];
  try { progresivos = await radar.terminosProgresivos(product); }
  catch (e) { console.warn('[exploracion] terminosProgresivos fallo: ' + String((e && e.message) || e).slice(0, 140)); }

  // Se busca hacia ARRIBA, de lo especifico a lo generico, hasta encontrar un
  // termino con al menos 8 publicaciones. Se corta ahi.
  const escalones = [];
  let categoriaMadre = null;
  for (const t of progresivos) {
    if (Date.now() > deadline) {
      escalones.push({ termino: t, ok: false, publicaciones: null, muestra: 0, sinTiempo: true,
                       motivo: 'no alcanzo el tiempo para consultarlo' });
      continue;
    }
    const c = await contarPublicaciones(t, tok, 'MLA', { budgetMs: 5000, maxIds: 30, deadline, puedeGastar, origen: 'exploracion' });
    escalones.push({ termino: t, ok: c.ok, estado: c.estado, publicaciones: c.publicaciones,
                     muestra: c.muestra, relevantes: c.relevantes, ratio: c.ratio,
                     sinTiempo: !!c.sinTiempo, motivo: c.motivo });
    // Ocho publicaciones RELEVANTES, no ocho devueltas: con resultados de
    // rescate cualquier termino llegaba a ocho.
    if (c.estado === 'existe' && c.muestra >= 8) {
      categoriaMadre = {
        termino: t, publicaciones: c.publicaciones, muestra: c.muestra,
        precioMediano: c.precioMediano, ventasTop3: c.ventasTop3,
        // El mediano es de la CATEGORIA, no del producto. El front lo rotula
        // asi y no lo carga en el precio de venta.
        esReferenciaDeCategoria: true
      };
      break;
    }
  }

  const mla = await contarPublicaciones(product, tok, 'MLA', { budgetMs: 5000, maxIds: 30, deadline, puedeGastar, origen: 'exploracion' });

  // "Ni siquiera la categoria generica existe" solo se puede afirmar si TODOS
  // los escalones se consultaron bien Y todos dieron cero. Si alguno quedo
  // bloqueado o sin tiempo, o alguno trajo publicaciones (aunque sean menos de
  // 8), afirmar que no existe dispara un "SIN MERCADO" falso.
  const escalonesOk = escalones.length > 0 && escalones.every(e => e.ok);
  // "No existe" ya no es contar cero: MercadoLibre casi nunca devuelve cero.
  // Es que ninguna de las publicaciones devueltas sea del producto.
  // 'dudoso' NO cuenta: no se afirma que la categoria no exista sobre una duda.
  const todosEnCero = escalonesOk && escalones.every(e => e.estado === 'noExiste');

  return {
    producto: product,
    terminosProgresivos: progresivos,
    escalones,
    escalonesTodosConsultados: escalonesOk,
    categoriaMadre,
    categoriaMadreAusenteConfirmada: !categoriaMadre && todosEnCero,
    sinCategoriaMadre: !categoriaMadre,
    terminos: { MLA: product },
    paises: { MLA: mla },
    // El conteo que se muestra son las publicaciones RELEVANTES de la muestra,
    // no el total que informa MeLi (que es post-rescate).
    conteos: { MLA: mla.ok ? (mla.relevantes != null ? mla.relevantes : mla.muestra) : null },
    // Tres estados: true / false / null. Nunca un booleano derivado de un conteo.
    // 'dudoso' viaja como null en existeEn a proposito: no afirma presencia ni
    // ausencia. El estado exacto va aparte, en estados.
    existeEn: { MLA: mla.ok ? (mla.estado === 'existe' ? true : (mla.estado === 'noExiste' ? false : null)) : null },
    estados: { MLA: mla.estado },
    relevancia: { MLA: { relevantes: mla.relevantes, devueltas: mla.muestraDevuelta, ratio: mla.ratio,
                         estimadas: mla.relevantesEstimadas != null ? mla.relevantesEstimadas : mla.relevantes } },
    parcial: Date.now() > deadline,
    consultadoEn: new Date().toISOString()
  };
}

// 8.c: Brasil y Mexico. Va en su propia invocacion para no compartir los 60 s
// con la categoria madre. Los dos paises se consultan en paralelo.
async function stepRegion(product) {
  if (!product) throw new Error('product requerido');
  const deadline = Date.now() + PRESUPUESTO_MS;
  const tok = await getMeliAccessToken();
  const radar = await import('./_radar.js');

  let terminoBR = null, terminoMX = null;
  try {
    const [br, mx] = await Promise.all([
      radar.traducirTerminos([product], 'pt-BR'),
      radar.traducirTerminos([product], 'es-MX')
    ]);
    terminoBR = (br && br[product]) || null;
    terminoMX = (mx && mx[product]) || null;
  } catch (e) {
    console.warn('[region] traduccion fallo: ' + String((e && e.message) || e).slice(0, 140));
  }

  const [mlb, mlm] = await Promise.all([
    contarPublicaciones(terminoBR || product, tok, 'MLB', { budgetMs: 5000, maxIds: 30, deadline }),
    contarPublicaciones(terminoMX || product, tok, 'MLM', { budgetMs: 5000, maxIds: 30, deadline })
  ]);

  const paises = { MLB: mlb, MLM: mlm };
  const existeEn = {}, conteos = {}, estados = {}, relevancia = {};
  for (const k of Object.keys(paises)) {
    const c = paises[k];
    // Solo se afirma "existe" o "no existe" si la consulta ANDUVO. Si no, null,
    // y el front muestra "sin dato". El conteo son las RELEVANTES.
    conteos[k] = c.ok ? (c.relevantes != null ? c.relevantes : c.muestra) : null;
    existeEn[k] = c.ok ? (c.estado === 'existe' ? true : (c.estado === 'noExiste' ? false : null)) : null;
    estados[k] = c.estado;
    relevancia[k] = { relevantes: c.relevantes, devueltas: c.muestraDevuelta, ratio: c.ratio,
                      estimadas: c.relevantesEstimadas != null ? c.relevantesEstimadas : c.relevantes };
  }

  return {
    producto: product,
    terminos: { MLB: terminoBR, MLM: terminoMX },
    paises, conteos, existeEn, estados, relevancia,
    parcial: Date.now() > deadline,
    consultadoEn: new Date().toISOString()
  };
}

// 8.e: el test de busqueda. Se corre con las palabras que escribe el usuario,
// no con el nombre tecnico del proveedor.
async function stepTestBusqueda(product, ctx) {
  if (!product || !String(product).trim()) throw new Error('product requerido');
  const tok = await getMeliAccessToken();
  const c = await contarPublicaciones(String(product).trim(), tok, 'MLA', {
    budgetMs: 6000, maxIds: 30,
    puedeGastar: !!(ctx && ctx.puedeGastar), origen: 'test-busqueda'
  });
  // Lo que cuenta son las publicaciones que HABLAN del termino, no las que
  // MercadoLibre devuelve: para un termino que nadie busca devuelve rescate.
  const encontradas = c.ok ? (c.relevantes != null ? c.relevantes : c.muestra) : null;
  return {
    termino: product,
    ok: c.ok,
    estado: c.estado,
    relevantes: c.relevantes,
    devueltas: c.muestraDevuelta,
    ratio: c.ratio,
    publicaciones: c.publicaciones,
    muestra: c.muestra,
    encontradas,
    precioMediano: c.precioMediano,
    // suficiente:true  -> hay categoria y la gente sabe nombrarla
    // suficiente:false -> nadie busca eso
    // suficiente:null  -> no se pudo consultar, no se concluye nada
    suficiente: c.ok ? (c.estado === 'existe' && c.muestra >= 8) : null,
    motivo: c.motivo
  };
}

// Registro del paso de competencia. Aparte para no ensuciar stepCompetencia y
// porque tiene que cubrir todas las salidas, incluidas las que no traen nada.
function registrarRelevanciaDeCompetencia(product, meli) {
  try {
    const rel = meli && meli.relevancia ? meli.relevancia : null;
    const results = (meli && Array.isArray(meli.results)) ? meli.results : [];
    let estado;
    if (!meli) estado = 'sin-respuesta';
    else if (meli.pendiente) estado = 'preparando';
    else if (rel) estado = rel.estado || 'existe';
    else if (meli.vacioConfirmado) estado = 'noExiste';
    else estado = 'sin-datos';
    registrarRelevancia({
      query: product, site: 'MLA',
      palabras: rel ? rel.palabras : palabrasSignificativas(product),
      ratio: rel ? rel.ratio : null,
      estado,
      muestra: rel ? rel.muestra : results.length,
      relevantes: rel ? rel.relevantes : 0,
      titulos: (meli && meli.titulosMuestra) || results.map(x => x && x.title)
    });
  } catch (e) {
    console.warn('[relevancia] no pude registrar competencia: ' + String((e && e.message) || e).slice(0, 140));
  }
}

async function stepFinal(customPrompt) {
  if (!customPrompt) throw new Error('prompt requerido');
  return await askClaudeJson(customPrompt);
}

async function askClaudeJson(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: anthropicHeaders(),
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  // Mismo problema que en el radar: sin el mensaje de Anthropic, un 400 no dice
  // nada. Este es el analizador, que usa el mismo modelo y la misma key.
  if (!r.ok) {
    const msg = (j && j.error && j.error.message) || JSON.stringify(j);
    throw new Error('Anthropic ' + r.status + ': ' + String(msg).slice(0, 250));
  }
  const texto = (j.content && j.content[0] && j.content[0].text) || '';
  let cleaned = texto.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch (e) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Respuesta no JSON: ' + cleaned.substring(0,200));
  }
}

// Cache del access_token en memoria del proceso (Vercel cold start lo resetea, no es problema)
let _appTokenCache = { token: null, expiresAt: 0 };
// Ultimo motivo por el que no se pudo conseguir token: lo reporta ?probe.
let _ultimoMotivoToken = null;

async function getMeliAccessToken() {
  // 1) Token explicito en env, si está configurado.
  const tk = process.env.MELI_ACCESS_TOKEN;
  if (tk && typeof tk === 'string' && tk.length > 10) { _ultimoMotivoToken = 'env'; return tk; }

  // 2) Token "de la casa": el de una cuenta de MercadoLibre ya conectada, que
  //    se usa para las busquedas de la demo del hero y del analizador publico.
  //    MercadoLibre cerro las busquedas anonimas, así que hace falta el token
  //    de un usuario real. Se elige con MELI_DEMO_USER_ID (el mismo user_id con
  //    el que la cuenta se conecto en /meli-connect.html) y se apaga con "off".
  const demoUser = process.env.MELI_DEMO_USER_ID || 'matypereira';
  if (demoUser && demoUser !== 'off') {
    const t = await getUserToken(demoUser);
    if (t.token) { _ultimoMotivoToken = 'cuenta:' + demoUser; return t.token; }
    _ultimoMotivoToken = 'cuenta:' + demoUser + ' -> ' + t.motivo + (t.error ? ' (' + t.error + ')' : '');
  }

  // 3) Token de aplicacion via client_credentials. Hoy MeLi lo rechaza para el
  //    buscador, pero lo dejamos por si vuelve a habilitarlo.
  if (_appTokenCache.token && Date.now() < _appTokenCache.expiresAt) {
    return _appTokenCache.token;
  }
  const { clientId, clientSecret, ok } = meliCreds();
  if (!ok) { _ultimoMotivoToken = (_ultimoMotivoToken || '') + ' | faltan credenciales de la app'; return null; }
  try {
    const r = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString()
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.access_token) return null;
    // Renovamos 5 min antes de que venza.
    const ttl = Math.max(60, (j.expires_in || 21600) - 300);
    _appTokenCache = { token: j.access_token, expiresAt: Date.now() + ttl * 1000 };
    _ultimoMotivoToken = 'client_credentials';
    return j.access_token;
  } catch (_) { return null; }
}

// ctx.puedeGastar decide si la cadena de busqueda puede llegar a la via PAGA.
// Va como parametro y no como variable de modulo a proposito: un lambda de
// Vercel puede atender dos requests a la vez, y una variable de modulo le
// prestaria la sesion de uno al otro.
async function safeMeliSearch(product, ctx) {
  const c = ctx || {};
  const q = encodeURIComponent(product);
  const url = "https://api.mercadolibre.com/sites/MLA/search?q=" + q + "&limit=20";
  const tok = await getMeliAccessToken();

  // 1) Busqueda libre con token de usuario. MeLi la tiene cerrada a terceros
  //    (403) desde 2025, pero si la reabre está es la mejor fuente.
  if (tok) {
    try {
      const r = await fetch(url, { headers: { "Authorization": "Bearer " + tok, "Accept": "application/json" } });
      if (r.ok) {
        const j = await r.json();
        const catFilter = (j.available_filters || []).find(f => f.id === "category");
        const categoryName = catFilter && catFilter.values && catFilter.values[0] ? catFilter.values[0].name : "";
        return { fuente: "meli-api-oauth", total: (j.paging && j.paging.total) || 0, results: j.results || [], categoryName };
      }
    } catch (_) {}
  }

  // 2) Cadena compartida: catalogo -> destacados -> listado publico -> el
  //    proveedor externo. Recuerda cual responde para no reintentar las muertas.
  if (tok) {
    try {
      const r = await buscarPublicaciones(product, tok, {
        budgetMs: 6000,
        puedeGastar: !!c.puedeGastar,
        origen: c.origen || 'market'
      });
      if (r && r.pendiente) return r;
      if (r && r.results.length) return r;
      // Frenos de gasto: hay que devolverlos tal cual. Si se siguiera de largo
      // terminarian en el "no-disponible" del final, que significa "MercadoLibre
      // no respondio" -- una mentira: MercadoLibre no se consulto porque el
      // sistema decidio no gastar, y el usuario tiene derecho a saberlo.
      if (r && r.requiereSesion) return r;
      if (r && r.topeAlcanzado) return r;
      // Cero confirmado: se entro al listado publico y no hay publicaciones.
      // Es un dato y hay que devolverlo. Si se sigue de largo, termina en el
      // "no-disponible" de abajo, que significa "no pude consultar": lo
      // opuesto, y el modo sin comparable nunca se enteraria.
      if (r && r.vacioConfirmado) return r;
      // Relevancia cero: MercadoLibre devolvio publicaciones de rescate y
      // ninguna es del producto. Es la respuesta, no una falla: si se sigue de
      // largo termina en "no pude consultar", que es otra cosa.
      if (r && r.relevanciaCero) return r;
    } catch (_) {}
  }

  // 3) API publica anonima (suele dar 403 ahora, pero por si vuelve)
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ProductFinderBot/1.0)" } });
    if (r.ok) {
      const j = await r.json();
      const catFilter = (j.available_filters || []).find(f => f.id === "category");
      const categoryName = catFilter && catFilter.values && catFilter.values[0] ? catFilter.values[0].name : "";
      return { fuente: "meli-api", total: (j.paging && j.paging.total) || 0, results: j.results || [], categoryName };
    }
  } catch (_) {}

  // 4) Ultimo recurso: HTML publico (desde Vercel MeLi suele bloquearlo)
  try { return await scrapeMeliSearchHtml(product); } catch (_) { return null; }
}

async function scrapeMeliSearchHtml(product) {
  const slug = String(product).trim().toLowerCase().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-');
  const url = 'https://listado.mercadolibre.com.ar/' + encodeURIComponent(slug);
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'es-AR,es;q=0.9' } });
  if (!r.ok) return null;
  const html = await r.text();
  // Total de resultados
  let total = 0;
  const totalMatches = [
    html.match(/(\d[\d.,]*)\s*resultados/i),
    html.match(/quantity[\\"']{1,3}\s*:\s*(\d+)/i),
    html.match(/"total"\s*:\s*(\d+)/i)
  ];
  for (const m of totalMatches) { if (m) { total = parseInt(String(m[1]).replace(/[^0-9]/g,''),10) || 0; if (total) break; } }
  // Categoría principal: tomar el primer breadcrumb o título de filtro
  let categoryName = '';
  const catMatch = html.match(/<h1[^>]*>([^<]{3,80})<\/h1>/i);
  if (catMatch) categoryName = decodeHtml(catMatch[1]).trim();
  if (!categoryName) {
    const og = html.match(/<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"']([^\"']+)[\"']/i);
    if (og) categoryName = decodeHtml(og[1]).trim().replace(/\s*\|.*$/,'');
  }
  // Extraer items: título, precio, vendedor, cantidad vendida
  const results = [];
  const itemRegex = /<a[^>]+class="[^"]*poly-component__title[^"]*"[^>]*>([^<]{3,200})<\/a>([\s\S]{0,2500}?)<\/li>/gi;
  let m;
  while ((m = itemRegex.exec(html)) !== null && results.length < 20) {
    const título = decodeHtml(m[1]).trim();
    const block = m[2] || '';
    const priceMatch = block.match(/andes-money-amount__fraction[^>]*>([\d.]+)<\/span>/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/\./g,''),10) : null;
    const sellerMatch = block.match(/poly-component__seller[^>]*>(?:Por\s*)?([^<]{2,80})<\//i);
    const sellerName = sellerMatch ? decodeHtml(sellerMatch[1]).trim() : '';
    const soldMatch = block.match(/(\d[\d.,]*)\s*vendidos?/i);
    const sold = soldMatch ? parseInt(String(soldMatch[1]).replace(/[^0-9]/g,''),10) : 0;
    if (título && price) {
      results.push({ title: título, price, sold_quantity: sold, seller: { id: sellerName || null, nickname: sellerName } });
    }
  }
  if (!results.length && !total) return null;
  return { fuente: 'meli-html', total: total || results.length, results, categoryName };
}

// Ultimo motivo por el que Google Trends no devolvio datos. stepDemanda lo
// adjunta a la respuesta para que el front pueda decir por que la curva es una
// estimacion y no un dato medido.
let _ultimoMotivoTrends = null;

// OJO: desde Vercel esto devuelve null practicamente siempre. Google bloquea
// las IPs de datacenter contra su endpoint interno de Trends (responde 429 o
// una pagina de consentimiento). Antes el catch se tragaba la falla en
// silencio y los 12 meses inventados por el modelo se mostraban como Google
// Trends. Ahora cada salida deja el motivo en _ultimoMotivoTrends y lo loguea.
async function safeGoogleTrends(product) {
  _ultimoMotivoTrends = null;
  const fallo = (motivo) => {
    _ultimoMotivoTrends = motivo;
    console.warn('[trends] sin datos para "' + product + '": ' + motivo);
    return null;
  };
  try {
    const exploreReq = JSON.stringify({comparisonItem:[{keyword:product,geo:'AR',time:'today 12-m'}],category:0,property:''});
    const r1 = await fetch('https://trends.google.com/trends/api/explore?hl=es-AR&tz=180&req=' + encodeURIComponent(exploreReq), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r1.ok) return fallo('explore respondio HTTP ' + r1.status + (r1.status === 429 ? ' (Google bloquea IPs de datacenter)' : ''));
    const txt1 = await r1.text();
    const clean1 = txt1.replace(/^\)\]\}',?\n?/, '');
    let j1;
    try { j1 = JSON.parse(clean1); }
    catch (e) { return fallo('explore no devolvio JSON (probable pagina de consentimiento o captcha)'); }
    const tw = (j1.widgets || []).find(w => w.id === 'TIMESERIES');
    if (!tw) return fallo('explore no trajo el widget TIMESERIES');
    const r2 = await fetch('https://trends.google.com/trends/api/widgetdata/multiline?hl=es-AR&tz=180&req=' + encodeURIComponent(JSON.stringify(tw.request)) + '&token=' + encodeURIComponent(tw.token), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r2.ok) return fallo('widgetdata respondio HTTP ' + r2.status + (r2.status === 429 ? ' (Google bloquea IPs de datacenter)' : ''));
    const txt2 = await r2.text();
    const clean2 = txt2.replace(/^\)\]\}',?\n?/, '');
    let j2;
    try { j2 = JSON.parse(clean2); }
    catch (e) { return fallo('widgetdata no devolvio JSON'); }
    const points = (j2.default && j2.default.timelineData) || [];
    if (!points.length) return fallo('la serie vino vacia');
    const monthly = {};
    points.forEach(p => {
      const d = new Date(parseInt(p.time)*1000);
      const k = d.getFullYear() + '-' + (d.getMonth()+1);
      if (!monthly[k]) monthly[k] = [];
      monthly[k].push(p.value[0]);
    });
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const keys = Object.keys(monthly).sort();
    const last12 = keys.slice(-12);
    if (last12.length < 12) return fallo('solo vinieron ' + last12.length + ' meses de 12');
    const monthlyData = last12.map(k => {
      const m = parseInt(k.split('-')[1])-1;
      const arr = monthly[k];
      const avg = Math.round(arr.reduce((a,b)=>a+b,0)/arr.length);
      return { mes: meses[m], valor: avg };
    });
    const values = monthlyData.map(x => x.valor);
    return { values, monthlyData };
  } catch (e) {
    return fallo(String((e && e.message) || e).slice(0, 160));
  }
}

async function readProductUrl(url) {
  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
  let r;
  if (host.includes('mercadolibre') || host.includes('mercadolivre')) r = await readMercadoLibre(url);
  else if (host.includes('alibaba')) r = await readAlibaba(url);
  else r = await readOpenGraph(url);
  return await conTerminoDeBusqueda(r);
}

// El titulo de origen ("Magcubic HY300Pro Projector 290ANSI Android 14 Dual
// WiFi6 8K") no sirve para buscar en MercadoLibre Argentina: hay que reducirlo
// al producto generico en castellano ("mini proyector"). Esa traduccion ya
// existe y esta cacheada en _radar.js, asi que se reusa tal cual.
// El front usa terminoBusqueda para el buscador de MeLi y muestra los dos, con
// el termino editable: si la traduccion sale mal, el usuario la corrige.
async function conTerminoDeBusqueda(r) {
  if (!r || typeof r !== 'object') return r;
  const titulo = String((r['t\u00edtulo'] || r.titulo || '')).trim();
  if (!titulo || r.lecturaFallida) return r;
  try {
    const radar = await import('./_radar.js');
    const mapa = await radar.nombrarProductos([titulo.slice(0, 140)]);
    const t = mapa && mapa[titulo.slice(0, 140)];
    if (t && String(t).trim()) {
      r.terminoBusqueda = String(t).trim().toLowerCase();
      r.terminoBusquedaFuente = 'ia-nombrarProductos';
      return r;
    }
  } catch (e) {
    console.warn('[terminoBusqueda] no pude traducir el titulo: ' + String((e && e.message) || e).slice(0, 140));
  }
  // Sin traduccion se devuelve el titulo crudo, avisando de donde salio, para
  // que el front no muestre un termino traducido que no lo es.
  r.terminoBusqueda = titulo.slice(0, 60);
  r.terminoBusquedaFuente = 'titulo-original';
  return r;
}

async function readMercadoLibre(url) {
  let itemId = null;
  const directMatch = url.match(/MLA[-]?(\d{6,})/i);
  if (directMatch) itemId = 'MLA' + directMatch[1];
  else {
    try {
      const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductFinderBot/1.0)' } });
      const finalUrl = r.url || url;
      const m2 = finalUrl.match(/MLA[-]?(\d{6,})/i);
      if (m2) itemId = 'MLA' + m2[1];
      if (!itemId) {
        const html = await r.text();
        const m3 = html.match(/MLA(\d{6,})/);
        if (m3) itemId = 'MLA' + m3[1];
      }
    } catch (_) {}
  }
  if (itemId) {
    try {
      const apiRes = await fetch('https://api.mercadolibre.com/items/' + itemId);
      if (apiRes.ok) {
        const j = await apiRes.json();
        return { fuente: 'mercadolibre', itemId, lecturaFallida: false, título: j.title || '', titulo: j.title || '', precio: j.price != null ? Number(j.price) : null, moneda: j.currency_id || 'ARS', imagen: (j.pictures && j.pictures[0] && j.pictures[0].secure_url) || j.thumbnail || '', descripción: j.subtitle || '', descripcion: j.subtitle || '', permalink: j.permalink || url, condicion: j.condition || '', vendidos: j.sold_quantity != null ? j.sold_quantity : null, disponibles: j.available_quantity != null ? j.available_quantity : null, realData: true, url };
      }
    } catch (_) {}
  }
  try {
    const scraped = await scrapeMercadoLibreHtml(url);
    if (scraped && scraped.título) return { fuente: 'mercadolibre-html', itemId, lecturaFallida: false, ...scraped, titulo: scraped.título, descripcion: scraped.descripción, realData: false, url };
  } catch (_) {}
  return { fuente: 'mercadolibre-min', itemId, lecturaFallida: true, motivo: 'MercadoLibre no devolvio los datos de esta publicacion', título: '', titulo: '', precio: null, moneda: 'ARS', imagen: '', descripción: '', descripcion: '', url };
}

async function scrapeMercadoLibreHtml(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'es-AR,es;q=0.9' } });
  if (!r.ok) throw new Error('HTML status ' + r.status);
  const html = await r.text();
  const pick = (re) => { const m = html.match(re); return m ? m[1] : null; };
  const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<title[^>]*>([^<|]+)/i);
  const ogImage = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const ogDesc  = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const priceStr = pick(/<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i);
  const moneda   = pick(/<meta[^>]+itemprop=["']priceCurrency["'][^>]+content=["']([^"']+)["']/i) || 'ARS';
  const precio = priceStr ? Number(priceStr) : null;
  return { título: ogTitle ? decodeHtml(ogTitle).trim() : '', precio: (precio != null && !isNaN(precio)) ? precio : null, moneda, imagen: ogImage || '', descripción: ogDesc ? decodeHtml(ogDesc).trim() : '' };
}

// Alibaba bloquea las lecturas desde IPs de datacenter: sirve una pagina de
// challenge sin og: tags. Medido en produccion, esto devolvia HTTP 200 con
// titulo, precio, imagen y descripcion TODOS vacios, y la UI mostraba el
// formulario manual como si hubiera leido algo. No se puede arreglar el
// scraping desde Vercel; lo que si se puede es decirlo.
async function readAlibaba(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductFinderBot/1.0)' } });
  if (!r.ok) {
    console.warn('[alibaba] respondio HTTP ' + r.status);
    return { fuente: 'alibaba', url, lecturaFallida: true, motivo: 'Alibaba bloquea la lectura automatica desde el servidor', detalle: 'HTTP ' + r.status };
  }
  const html = await r.text();
  const pick = (re) => { const m = html.match(re); return m ? m[1] : null; };
  const título = decodeHtml(pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<title[^>]*>([^<|]+)/i) || '').trim();
  const imagen = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || '';
  const descripción = decodeHtml(pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || '').trim();

  // El rango "$X - $Y" se agarra del primer match del HTML: no se sabe a que
  // tramo de cantidad corresponde ni si es de otro producto de la barra
  // lateral. Viaja como SUGERENCIA para que el usuario la confirme; el FOB
  // nunca se autocompleta con esto.
  let precioSugeridoMin = null, precioSugeridoMax = null;
  const priceRangeMatch = html.match(/\$\s?([\d,.]+)\s*[-~]\s*\$?\s?([\d,.]+)/);
  if (priceRangeMatch) {
    const a = parseFloat(priceRangeMatch[1].replace(/,/g,''));
    const b = parseFloat(priceRangeMatch[2].replace(/,/g,''));
    if (isFinite(a) && isFinite(b) && a > 0) { precioSugeridoMin = a; precioSugeridoMax = b; }
  }

  // Sin titulo, sin precio y sin imagen no se leyo nada: se dice, en vez de
  // devolver un objeto lleno de nulls que la UI disimula.
  if (!título && precioSugeridoMin == null && !imagen) {
    console.warn('[alibaba] HTTP 200 pero sin og: tags — pagina de challenge');
    return { fuente: 'alibaba', url, lecturaFallida: true, motivo: 'Alibaba bloquea la lectura automatica desde el servidor' };
  }

  return {
    fuente: 'alibaba', url, lecturaFallida: false,
    'título': título, titulo: título,
    // El FOB NO se autocompleta: el rango leido es una sugerencia a confirmar.
    precio: null, moneda: 'USD',
    precioSugeridoMin, precioSugeridoMax,
    imagen, 'descripción': descripción, descripcion: descripción
  };
}

async function readOpenGraph(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductFinderBot/1.0)' } });
  if (!r.ok) {
    console.warn('[opengraph] ' + url + ' respondio HTTP ' + r.status);
    return { fuente: 'opengraph', url, lecturaFallida: true, motivo: 'La pagina no dejo leerla desde el servidor', detalle: 'HTTP ' + r.status };
  }
  const html = await r.text();
  const pick = (re) => { const m = html.match(re); return m ? m[1] : null; };
  const título = decodeHtml(pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<title[^>]*>([^<|]+)/i) || '').trim();
  const imagen = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) || '';
  const descripción = decodeHtml(pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i) || '').trim();
  // Mismo criterio que Alibaba: si no vino nada, se avisa.
  if (!título && !imagen && !descripción) {
    console.warn('[opengraph] ' + url + ' devolvio HTTP 200 sin og: tags');
    return { fuente: 'opengraph', url, lecturaFallida: true, motivo: 'La pagina no expone titulo ni imagen legibles desde el servidor' };
  }
  return { fuente: 'opengraph', url, lecturaFallida: false, 'título': título, titulo: título, imagen, 'descripción': descripción, descripcion: descripción };
}

function decodeHtml(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');
}

// ============================================================
// HELPER: Rolling 12-month window (Google Trends style)
// Toma la respuesta de Claude o Trends y reordena los meses
// para que terminen siempre en el mes actual (ventana movil).
// Ej: Mayo 2026 -> Jun 25, Jul 25, ..., May 26.
// Cada vez que pasa un mes, la ventana se desplaza sola.
// ============================================================
const MES_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function buildRollingMonths(sourceMonthly) {
    const now = new Date();
    // Index del valor por nombre de mes en el array fuente (asumimos Ene-Dic calendario).
  const byMes = {};
    if (Array.isArray(sourceMonthly)) {
          sourceMonthly.forEach(item => {
                  if (item && item.mes && typeof item.valor === 'number') {
                            byMes[item.mes] = item.valor;
                  }
          });
    }
    const out = [];
    for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const mes = MES_LABELS[d.getMonth()];
          const year = d.getFullYear();
          const yy = String(year).slice(2);
          let valor = byMes[mes];
          if (typeof valor !== 'number') {
                  // Fallback: curva estacional suave si no hay dato
            valor = Math.round(65 + Math.sin((d.getMonth()/12)*Math.PI*2) * 15 + Math.random()*5);
          }
          out.push({
                  mes,
                  label: `${mes} ${year}`,
                  year,
                  monthIndex: d.getMonth(),
                  valor: Math.max(0, Math.min(100, Math.round(valor)))
          });
    }
    return out;
}
