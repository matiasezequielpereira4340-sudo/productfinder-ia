// Market Reader IA - Backend API
// Handles /api/market for steps: demanda, competencia, final, productUrl
// Datos de MercadoLibre (catalogo con token de usuario) + Anthropic para el
// armado del informe.

import { anthropicHeaders, buscarPublicaciones, filaDeCache, viaDeBusquedaUsada, candidatosDeListado, traerPagina, extraerIdsMLA, idsPorPatron, hidratarItems, getUserToken, meliCreds, fetchJson, MELI_API } from './_meli.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
      const tok = await getMeliAccessToken();
      if (!tok) return res.status(200).json({ ok: false, error: 'No pude autenticarme contra MercadoLibre.' });
      const radar = await import('./_radar.js');

      // Medir la saturacion de un candidato puntual.
      if (typeof req.query.saturacion === 'string' && req.query.saturacion.length > 1) {
        const kw = req.query.saturacion.slice(0, 60);
        const mla = await radar.saturacionMLA(kw, tok);
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
          maxCategorias: Math.min(parseInt(req.query.rubros, 10) || 6, 12)
        });
        if (r.error) return res.status(200).json({ ok: false, error: r.error });
        return res.status(200).json({
          ok: true,
          consultadoEn: new Date().toISOString(),
          rubros: r.rubros,
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
      const bus = await import('./_buscador.js');
      try { return res.status(200).json(await bus.inspeccionarUltimaCorrida()); }
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
            patrones: ids.length ? idsPorPatron(pag.texto) : undefined,
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

        const final = await safeMeliSearch(termino);
        paso.resultado_final = final
          ? { fuente: final.fuente, resultados: (final.results || []).length, total: final.total }
          : 'no-disponible';
      } catch (e) {
        paso.error = String((e && e.message) || e).slice(0, 200);
      }
      return res.status(200).json({ termino, paso });
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
        const r = await safeMeliSearch(termino);
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

  if (step === 'productUrl') {
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url requerida' });
    let cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = 'https://' + cleanUrl;
    try { return res.status(200).json(await readProductUrl(cleanUrl)); }
    catch (e) { return res.status(400).json({ error: 'No se pudo leer el link', detalle: String(e && e.message || e) }); }
  }
  if (step === 'demanda') {
    try { return res.status(200).json(await stepDemanda(product)); }
    catch (e) { return res.status(500).json({ error: 'Fallo demanda', detalle: String(e && e.message || e) }); }
  }
  if (step === 'competencia') {
    try { return res.status(200).json(await stepCompetencia(product)); }
    catch (e) { return res.status(500).json({ error: 'Fallo competencia', detalle: String(e && e.message || e) }); }
  }
  if (step === 'final') {
    try { return res.status(200).json(await stepFinal(customPrompt)); }
    catch (e) { return res.status(500).json({ error: 'Fallo final', detalle: String(e && e.message || e) }); }
  }
  return res.status(400).json({ error: 'step invalido' });
}

async function stepDemanda(product) {
  if (!product) throw new Error('product requerido');
  const meli = await safeMeliSearch(product);
  const trends = await safeGoogleTrends(product);
  const totalMeli = meli && meli.total != null ? meli.total : 'sin dato';
  const catName = meli && meli.categoryName ? meli.categoryName : 'sin dato';
  const trendsStr = trends && trends.values ? trends.values.join(',') : 'sin dato';
  const prompt = 'Sos analista de e-commerce Argentina. Para el producto "' + product + '" genera JSON de DEMANDA AR. Datos reales: Total publicaciones MeLi AR=' + totalMeli + '; Top categoria=' + catName + '; Google Trends 12m (0-100)=' + trendsStr + '. Responde SOLO JSON sin markdown: {"tendencia":"subiendo|estable|bajando","nivelDemanda":"alto|medio|bajo","demandaScore":0-100,"temporalidad":"string corto","descripcion":"1-2 oraciones rioplatense","tags":["t1","t2","t3"],"monthlyData":[{"mes":"Ene","valor":0-100},{"mes":"Feb","valor":0-100},{"mes":"Mar","valor":0-100},{"mes":"Abr","valor":0-100},{"mes":"May","valor":0-100},{"mes":"Jun","valor":0-100},{"mes":"Jul","valor":0-100},{"mes":"Ago","valor":0-100},{"mes":"Sep","valor":0-100},{"mes":"Oct","valor":0-100},{"mes":"Nov","valor":0-100},{"mes":"Dic","valor":0-100}]}';
  const j = await askClaudeJson(prompt);
  if (trends && trends.monthlyData && trends.monthlyData.length === 12) {
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
  return j;
}

async function stepCompetencia(product) {
  if (!product) throw new Error('product requerido');
  const meli = await safeMeliSearch(product);
  // La busqueda arranco pero todavia no termino: se avisa en vez de mostrar
  // un vacio que parece un error.
  if (meli && meli.pendiente) {
    return { fuente: 'preparando', sellersEstimados: null, precioMinARS: null, precioMaxARS: null,
      precioPromedioARS: null, totalResults: null, categoryName: '', saturacion: null,
      competenciaScore: null, competitors: [],
      aviso: 'Estoy trayendo los datos de MercadoLibre para este producto. La primera vez tarda dos o tres minutos; despues queda guardado y sale al instante.' };
  }
  if (meli && meli.results && meli.results.length > 0) {
    const prices = meli.results.map(x => x.price).filter(p => typeof p === 'number' && p > 0).sort((a,b)=>a-b);
    const min = prices[0] || 0;
    const max = prices[prices.length-1] || 0;
    const avg = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
    const sellers = new Set(meli.results.map(x => x.seller && x.seller.id).filter(Boolean));
    // Solo hay total de publicaciones por algunas vias. Si no lo hay, la
    // saturacion queda en null: no se deduce de una muestra de 40 items.
    const total = (typeof meli.total === 'number' && meli.total > 0) ? meli.total : null;
    let saturacion = null;
    if (total != null) {
      saturacion = 'moderado';
      if (total < 200) saturacion = 'libre';
      else if (total > 10000) saturacion = 'muy saturado';
      else if (total > 2000) saturacion = 'saturado';
    }
    const conEnvioGratis = meli.results.filter(x => x.shipping && x.shipping.free_shipping).length;
    const competitors = meli.results.slice(0,5).map((x,i)=>({rank:i+1, name:(x.seller && x.seller.nickname) || ('Vendedor '+(i+1)), price:x.price||0, soldQty:x.sold_quantity||0, reputation:(x.seller && x.seller.seller_reputation && x.seller.seller_reputation.level_id) || 'N/A', repClass:'comp-rep-ok', freeShipping: !!(x.shipping && x.shipping.free_shipping)}));
    return { fuente: meli.fuente || 'mercadolibre-search', sellersEstimados: sellers.size || meli.results.length, precioMinARS:min, precioMaxARS:max, precioPromedioARS:avg, totalResults:total, categoryName:meli.categoryName||'', saturacion, competenciaScore: total != null ? Math.min(100, Math.round(total/100)) : null, competitors, envioGratisCount: conEnvioGratis, envioGratisTotal: meli.results.length, envioGratisPct: meli.results.length ? Math.round((conEnvioGratis/meli.results.length)*100) : 0,
      aviso: total == null ? 'MercadoLibre no expone el total de publicaciones por esta via: el precio y los competidores son reales, la saturacion no se puede calcular.' : null };
  }
  // IMPORTANTE: si no hay datos reales de MeLi (API 403 o scraping fallido) NO inventamos numeros via IA.
  return { fuente: 'no-disponible', sellersEstimados: null, precioMinARS: null, precioMaxARS: null, precioPromedioARS: null, totalResults: null, categoryName: '', saturacion: null, competenciaScore: null, competitors: [], aviso: 'Datos de Mercado Libre no disponibles ahora (la API publica requiere autenticacion). Mostramos solo lo verificable.' };
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
  // 1) Token explicito en env, si esta configurado.
  const tk = process.env.MELI_ACCESS_TOKEN;
  if (tk && typeof tk === 'string' && tk.length > 10) { _ultimoMotivoToken = 'env'; return tk; }

  // 2) Token "de la casa": el de una cuenta de MercadoLibre ya conectada, que
  //    se usa para las busquedas de la demo del hero y del analizador publico.
  //    MercadoLibre cerro las busquedas anonimas, asi que hace falta el token
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

async function safeMeliSearch(product) {
  const q = encodeURIComponent(product);
  const url = "https://api.mercadolibre.com/sites/MLA/search?q=" + q + "&limit=20";
  const tok = await getMeliAccessToken();

  // 1) Busqueda libre con token de usuario. MeLi la tiene cerrada a terceros
  //    (403) desde 2025, pero si la reabre esta es la mejor fuente.
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
      const r = await buscarPublicaciones(product, tok, { budgetMs: 6000 });
      if (r && r.pendiente) return r;
      if (r && r.results.length) return r;
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
  // Categoria principal: tomar el primer breadcrumb o titulo de filtro
  let categoryName = '';
  const catMatch = html.match(/<h1[^>]*>([^<]{3,80})<\/h1>/i);
  if (catMatch) categoryName = decodeHtml(catMatch[1]).trim();
  if (!categoryName) {
    const og = html.match(/<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"']([^\"']+)[\"']/i);
    if (og) categoryName = decodeHtml(og[1]).trim().replace(/\s*\|.*$/,'');
  }
  // Extraer items: titulo, precio, vendedor, cantidad vendida
  const results = [];
  const itemRegex = /<a[^>]+class="[^"]*poly-component__title[^"]*"[^>]*>([^<]{3,200})<\/a>([\s\S]{0,2500}?)<\/li>/gi;
  let m;
  while ((m = itemRegex.exec(html)) !== null && results.length < 20) {
    const titulo = decodeHtml(m[1]).trim();
    const block = m[2] || '';
    const priceMatch = block.match(/andes-money-amount__fraction[^>]*>([\d.]+)<\/span>/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/\./g,''),10) : null;
    const sellerMatch = block.match(/poly-component__seller[^>]*>(?:Por\s*)?([^<]{2,80})<\//i);
    const sellerName = sellerMatch ? decodeHtml(sellerMatch[1]).trim() : '';
    const soldMatch = block.match(/(\d[\d.,]*)\s*vendidos?/i);
    const sold = soldMatch ? parseInt(String(soldMatch[1]).replace(/[^0-9]/g,''),10) : 0;
    if (titulo && price) {
      results.push({ title: titulo, price, sold_quantity: sold, seller: { id: sellerName || null, nickname: sellerName } });
    }
  }
  if (!results.length && !total) return null;
  return { fuente: 'meli-html', total: total || results.length, results, categoryName };
}

async function safeGoogleTrends(product) {
  try {
    const exploreReq = JSON.stringify({comparisonItem:[{keyword:product,geo:'AR',time:'today 12-m'}],category:0,property:''});
    const r1 = await fetch('https://trends.google.com/trends/api/explore?hl=es-AR&tz=180&req=' + encodeURIComponent(exploreReq), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r1.ok) return null;
    const txt1 = await r1.text();
    const clean1 = txt1.replace(/^\)\]\}',?\n?/, '');
    const j1 = JSON.parse(clean1);
    const tw = (j1.widgets || []).find(w => w.id === 'TIMESERIES');
    if (!tw) return null;
    const r2 = await fetch('https://trends.google.com/trends/api/widgetdata/multiline?hl=es-AR&tz=180&req=' + encodeURIComponent(JSON.stringify(tw.request)) + '&token=' + encodeURIComponent(tw.token), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r2.ok) return null;
    const txt2 = await r2.text();
    const clean2 = txt2.replace(/^\)\]\}',?\n?/, '');
    const j2 = JSON.parse(clean2);
    const points = (j2.default && j2.default.timelineData) || [];
    if (!points.length) return null;
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
    const monthlyData = last12.map(k => {
      const m = parseInt(k.split('-')[1])-1;
      const arr = monthly[k];
      const avg = Math.round(arr.reduce((a,b)=>a+b,0)/arr.length);
      return { mes: meses[m], valor: avg };
    });
    const values = monthlyData.map(x => x.valor);
    return { values, monthlyData };
  } catch { return null; }
}

async function readProductUrl(url) {
  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
  if (host.includes('mercadolibre') || host.includes('mercadolivre')) return await readMercadoLibre(url);
  if (host.includes('alibaba')) return await readAlibaba(url);
  return await readOpenGraph(url);
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
        return { fuente: 'mercadolibre', itemId, titulo: j.title || '', precio: j.price != null ? Number(j.price) : null, moneda: j.currency_id || 'ARS', imagen: (j.pictures && j.pictures[0] && j.pictures[0].secure_url) || j.thumbnail || '', descripcion: j.subtitle || '', url };
      }
    } catch (_) {}
  }
  try {
    const scraped = await scrapeMercadoLibreHtml(url);
    if (scraped && scraped.titulo) return { fuente: 'mercadolibre-html', itemId, ...scraped, url };
  } catch (_) {}
  return { fuente: 'mercadolibre-min', itemId, titulo: 'Producto MeLi ' + (itemId||''), precio: null, moneda: 'ARS', imagen: '', descripcion: '', url };
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
  return { titulo: ogTitle ? decodeHtml(ogTitle).trim() : '', precio: (precio != null && !isNaN(precio)) ? precio : null, moneda, imagen: ogImage || '', descripcion: ogDesc ? decodeHtml(ogDesc).trim() : '' };
}

async function readAlibaba(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductFinderBot/1.0)' } });
  if (!r.ok) throw new Error('Alibaba respondio ' + r.status);
  const html = await r.text();
  const pick = (re) => { const m = html.match(re); return m ? m[1] : null; };
  const titulo = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<title[^>]*>([^<|]+)/i) || '';
  const imagen = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || '';
  const descripcion = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || '';
  let precioMin = null, precioMax = null;
  const priceRangeMatch = html.match(/\$\s?([\d,.]+)\s*[-~]\s*\$?\s?([\d,.]+)/);
  if (priceRangeMatch) { precioMin = parseFloat(priceRangeMatch[1].replace(/,/g,'')); precioMax = parseFloat(priceRangeMatch[2].replace(/,/g,'')); }
  return { fuente: 'alibaba', titulo: decodeHtml(titulo).trim(), precio: precioMin, precioMax, moneda: 'USD', imagen, descripcion: decodeHtml(descripcion).trim(), url };
}

async function readOpenGraph(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductFinderBot/1.0)' } });
  if (!r.ok) throw new Error('Pagina respondio ' + r.status);
  const html = await r.text();
  const pick = (re) => { const m = html.match(re); return m ? m[1] : null; };
  const titulo = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<title[^>]*>([^<|]+)/i) || '';
  const imagen = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) || '';
  const descripcion = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i) || '';
  return { fuente: 'opengraph', titulo: decodeHtml(titulo).trim(), imagen, descripcion: decodeHtml(descripcion).trim(), url };
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
