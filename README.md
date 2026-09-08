[README.md](https://github.com/user-attachments/files/26444661/README.md)
# ProductFinder IA - Backend con Datos Reales

## Datos Reales Implementados

### Mercado Libre (100% real)
- **Precios reales** de productos en MLA
- **Sellers únicos reales** contados de los resultados
- **Top 3 listings** con datos reales: título, precio, vendidos, reputación del seller
- **Saturación del mercado** calculada con datos reales
- **Categoría detectada** real de MeLi

### Google Trends (basado en categoría + estacionalidad)
- Datos mensuales de demanda basados en la **categoría del producto**
- Estacionalidad real para el mercado argentino (Black Friday, Navidad, rebajas de enero)
- Detección automática de categoría por palabras clave

### Análisis IA (opcional - Groq gratis)
- Configurá `GROQ_API_KEY` para análisis con IA real
- Groq es **gratis** y muy rápido (modelo: llama-3.3-70b-versatile)

---

## Instalación

### Opción 1: Deploy en Railway/Render/Heroku (recomendado)

```bash
# 1. Subí los archivos a GitHub
# 2. Conectá el repo a Railway.app
# 3. Agregá variable de entorno (opcional):
#    GROQ_API_KEY=tu_key_de_groq
# 4. Deploy automático
```

### Opción 2: Servidor local

```bash
cd C:\productfinder-ia
npm install
npm start
# Abrí http://localhost:3000
```

### Opción 3: Vercel + Backend separado

El frontend (`index.html`) sigue funcionando con `/api/*` endpoints.
Necesitás un backend que sirva en el mismo dominio o configurá los endpoints.

---

## Variables de Entorno

| Variable | Descripción | Requerido |
|----------|-------------|-----------|
| `MELI_APP_ID` (o `MELI_CLIENT_ID`) | App ID de la aplicación de MercadoLibre | Sí, para conectar cuentas |
| `MELI_SECRET_KEY` (o `MELI_CLIENT_SECRET`) | Secret de esa aplicación | Sí, para conectar cuentas |
| `MELI_REDIRECT_URI` | Fuerza la URL de retorno del OAuth. Si no está, se arma con el dominio desde el que se sirve la app (`https://<dominio>/api/meli-callback`) | No |
| `MELI_SCOPES` | Scopes pedidos en el OAuth (default `offline_access read`). `offline_access` es lo que da el `refresh_token` | No |
| `MELI_DEMO_USER_ID` | Cuenta ya conectada que se usa para las búsquedas públicas del hero. `off` la apaga | No |
| `SUPABASE_SERVICE_KEY` | Service key de Supabase: sin esto no se puede guardar ni leer ninguna conexión | Sí |
| `SUPABASE_URL` | URL del proyecto de Supabase (default: el del proyecto) | No |
| `ANTHROPIC_API_KEY` | Análisis con IA del analizador y del Radar | Sí, para el analizador |
| `ANTHROPIC_WORKSPACE_ID` | ID del workspace de Anthropic. **Obligatorio si la API key está vinculada a una identidad**: sin esto, todas las llamadas a Claude devuelven `400 anthropic-workspace-id is required`. Se saca de la consola de Anthropic → Settings → Workspaces | Depende de la key |
| `APP_ORIGIN` | Dominio público de la app, si hace falta fijarlo | No |
| `PORT` | Puerto del servidor local (default: 3000) | No |

Antes de conectar la primera cuenta hay que correr `supabase/meli_tokens_migration.sql`
en el SQL Editor de Supabase.

Para que el margen del dashboard sea real hace falta además
`supabase/costos_migration.sql`: sin el costo de compra cargado, la app sólo
puede descontar la comisión de MercadoLibre y el envío, y muestra casi todo el
precio de venta como ganancia. Los costos se cargan desde la pestaña **Stock**
del dashboard, producto por producto.

> Los costos viven dentro de `/api/meli-stock` y no en su propio endpoint: el
> plan de Vercel permite **12 funciones** y el proyecto ya las tiene todas. Un
> archivo nuevo en `/api` hace fallar el deploy entero con `NOT_FOUND` en todas
> las rutas nuevas. Si hace falta agregar un endpoint, hay que fusionarlo con
> uno existente o subir de plan. Los archivos que empiezan con `_` no cuentan:
> por eso los helpers compartidos viven en `api/_meli.js` y `api/_buscador.js`.

### Fuente externa de búsquedas (opcional, es la única paga)

MercadoLibre cerró sus tres endpoints de búsqueda a terceros y además bloquea
por IP a los servidores: las páginas públicas responden con
`/gz/account-verification`, su muro de tráfico sospechoso. La app funciona sin
esto — muestra "sin datos" en vez de inventar números — pero para tener precios
y competencia hace falta una fuente externa.

Se paga lo mínimo a propósito: **el proveedor externo se usa sólo para obtener
los IDs de publicación**; el precio, el vendedor, las ventas y el envío se
siguen pidiendo gratis a la API oficial de MeLi, que desde el servidor
funciona. Si el proveedor ya devuelve precios, se usan y se ahorra esa vuelta.

| Variable | Descripción |
|----------|-------------|
| `BUSCADOR_PROVEEDOR` | `apify`, `scrapingbee`, `scraperapi` u `off`. Si no está, se deduce de la credencial cargada |
| `APIFY_TOKEN` | Token de Apify (apify.com → Settings → Integrations) |
| `APIFY_ACTOR` | Actor a correr. Default: `devcake~mercadolibre-scraper` |
| `APIFY_INPUT_JSON` | Input propio del actor, si el default no le sirve. `{{q}}` se reemplaza por el término y `{{max}}` por el límite. Ej: `{"searchTerms":["{{q}}"],"limit":{{max}}}` |
| `SCRAPINGBEE_KEY` / `SCRAPERAPI_KEY` | Alternativa: traen el HTML del listado desde una IP no bloqueada |
| `APIFY_MIN_ITEMS` | Mínimo de resultados por corrida. Default 48, que es lo que exige el actor |
| `BUSQUEDA_CACHE_HORAS` | Ventana del caché de búsquedas. Default 12; `0` lo apaga |

El proveedor externo es la **última** vía de la cadena: primero se prueban las
gratuitas y sólo se gasta si ninguna respondió.

**Caché de búsquedas.** El actor de Apify cobra el lote entero de 48 resultados
aunque se pidan menos, y el recomendador repite los mismos 12 términos de un
nicho en cada corrida. El caché guarda cada búsqueda en Supabase (tabla
`busquedas_cache`, ver `supabase/busquedas_cache_migration.sql`) para que la
segunda corrida del día no gaste nada. Se controla con `BUSQUEDA_CACHE_HORAS`
(default 12; `0` lo apaga). Si la tabla no existe, la app funciona igual sin
caché. Si falla o se acaba el crédito,
la app no se rompe: vuelve al estado honesto de "sin datos".

Para ver qué está configurado y qué devuelve: `GET /api/market?catalogo=<término>`,
campo `proveedor_externo`. No expone credenciales, sólo si están cargadas.

**La `redirect_uri` tiene que estar cargada igual, carácter por carácter, en el
panel de la app de MercadoLibre.** `GET /api/meli-auth?diag=1` te dice cuál está
usando el servidor.

---

## Si MercadoLibre no conecta o no trae resultados

Tres endpoints de diagnóstico, en orden:

1. `GET /api/meli-auth?diag=1` — si faltan credenciales en el servidor y qué
   `redirect_uri` se está mandando.
2. `GET /api/meli-check?user_id=<tu usuario>&diag=1` — si tu usuario tiene
   conexión guardada, si el token se puede renovar y si MercadoLibre lo acepta
   (`meli_users_me`). Muestra también `user_id_de_la_conexion`: el usuario real
   contra el que está guardado el token.
3. `GET /api/market?probe=auriculares` — a qué endpoints de MercadoLibre llega
   la app hoy y cuántos resultados con precio devuelve la búsqueda.

Ninguno expone tokens ni claves: sólo dicen si están y si funcionan.

**Si cambiás `APP_USER`**, la conexión de MercadoLibre queda guardada con el
nombre viejo. En vez de reconectar, agregá el puente en `meli_user_aliases`
(hay un ejemplo al final de `supabase/meli_tokens_migration.sql`).

---

## API Endpoints

### POST /api/market

**Step: demanda**
```json
{
  "step": "demanda",
  "product": "auriculares bluetooth"
}
```
Devuelve: tendencia, nivelDemanda, demandaScore, temporalidad, monthlyData (12 meses), tags, descripcion

**Step: competencia**
```json
{
  "step": "competencia",
  "product": "auriculares bluetooth"
}
```
Devuelve: sellersEstimados, precioMinARS, precioMaxARS, precioPromedioARS, saturacion, competenciaScore, competitors (top 3 reales), descripcion, oportunidad, category, categoryName

**Step: final**
```json
{
  "step": "final",
  "prompt": "texto del análisis"
}
```
Devuelve: scoreTotal, scoresDemanda, scoresCompetencia, scoresMargen, scoresRegulatorio, labelDemanda, labelCompetencia, labelMargen, labelRegulatorio, veredicto, veredictoTexto, analisisCompleto

---

## Cómo Obtener API Key de Groq (gratis)

1. Entrá a [console.groq.com](https://console.groq.com)
2. Creá cuenta (gratis)
3. API Keys → Create Key
4. Copiá la key y ponela como `GROQ_API_KEY` en tu deploy

---

## Limitaciones Conocidas

1. **Ventas/mes reales**: MeLi no expone ventas mensuales por listing. El campo `sold_quantity` es **total histórico**, no mensual.
2. **Google Trends real**: Sin SerpApi o API de pago, los datos de tendencia se generan con estacionalidad por categoría (más preciso que random).
3. **Sellers estimados**: Es una aproximación ( sellers únicos en los primeros 50 resultados).

---

## Para Datos 100% Completos

| Dato | Fuente | Costo |
|------|--------|-------|
| Ventas mensuales reales | MeLi Seller API (auth vendedor) | Gratis (requiere ser vendedor) |
| Google Trends histórico | SerpApi Google Trends API | ~$50/mes |
| Scraping completo MeLi | Bright Data / ScraperAPI | ~$100/mes+ |
| Análisis IA avanzado | OpenAI GPT-4o | ~$20/mes |

---

## Estructura de Archivos

```
productfinder-ia/
├── index.html      # Frontend (UI completa)
├── server.js       # Backend (API real de MeLi)
├── package.json    # Dependencias de Node.js
└── README.md       # Este archivo
```

---

## Navegación: por qué el nav no depende del evento `hashchange`

Un clic en un link cuyo hash es **igual al actual** no navega y **no dispara
`hashchange`**. Como toda la navegación entre pantallas colgaba de ese evento,
esos clics quedaban muertos: parado en `#menu` (donde `showMenu()` deja la home
apenas carga), tocar el logo no hacía nada; parado en `#market`, tocar "Buscador
de oportunidades" tampoco. Es comportamiento estándar del navegador, así que
pasaba igual en celular.

La solución no es cambiar el `href`, es **no depender del hash**: `mc-ui.js`
engancha un `click` que hace `preventDefault()` y llama directo a
`showMenu()` / `showMarket()` / `showApp()`. El `href` se deja como está para
que el link siga siendo un link de verdad (clic derecho, abrir en pestaña
nueva, y funcionar si el JS no cargó). El handler se aplica **sólo dentro de
index**: en las subpáginas `/index.html#menu` tiene que navegar normal.

La referencia a la función se resuelve **en el clic**, no al enganchar: si se
capturara al enganchar, el nav se quedaría con una versión vieja si algo la
reemplaza después de cargar.

Además:

- `setHash()` usa **`pushState`**, no `replaceState`. Con `replaceState` el
  botón Atrás no volvía entre pantallas: te sacaba del sitio, porque cada
  cambio pisaba la misma entrada del historial. En celular eso es peor, porque
  Atrás es el gesto principal. Dos excepciones: si el hash destino es igual al
  actual no se toca nada, y si la URL todavía no tiene hash se usa
  `replaceState` (así entrar al sitio no deja una entrada basura).
- Se escucha **`popstate`** además de `hashchange`: `pushState` no dispara
  `hashchange`, así que sin eso Atrás cambiaba la URL y dejaba la pantalla
  anterior puesta. `routeFromHash()` no rehace nada si ya estás en la pantalla
  destino, porque Atrás dispara los dos eventos en el mismo gesto.

### Prueba

```bash
npm i --no-save playwright-core   # una sola vez; ver nota abajo
npm run test:nav                  # escritorio 1280x900
npm run test:nav:movil            # 360x800
```

`playwright-core` **no** es dependencia del proyecto a propósito: son 14 MB de
herramienta de prueba y este repo versiona `node_modules`, así que agregarla la
mandaría a producción. Por eso va con `--no-save` y fuera del árbol commiteado.

El test levanta su propio servidor estático y maneja Chromium. **La aserción que
importa es que el clic INVOQUE la función de navegación**, no que termines en
la pantalla correcta: cuando el hash destino es igual al actual ya estás en la
pantalla correcta, así que ese chequeo pasa igual con el clic muerto. Y "scrolleó
al tope" tampoco sirve: el navegador scrollea al tope solo por ser un link a un
fragmento inexistente, haya o no JavaScript.

## Freno de gasto del proveedor pago (Apify)

Las tres vías gratuitas de MercadoLibre están caídas (medido en producción:
`/sites/MLA/search` 403, `/highlights` 403, `/products/{id}/items` 404, y el
listado público devuelve el muro anti-bot). Consecuencia: **hoy casi toda
búsqueda nueva termina arrancando una corrida paga de Apify.** Hasta septiembre
de 2026 eso corría sin ningún tope.

Hay dos frenos, y los dos actúan **antes** de arrancar la corrida:

**1. Gate de sesión.** Sólo sobre la vía paga, no sobre el endpoint. Sin sesión
el Market Reader sigue funcionando con las vías gratuitas y la demo pública del
hero (`?demo=`) no se toca — nunca pasó por ahí. Sin sesión, la vía paga
devuelve `fuente: 'requiere-sesion'` con un aviso, no un error.

El front tiene que mandar el token: `mrCabeceras()` en `app.js` agrega
`Authorization: Bearer <pf_token>` a todos los POST de `/api/market`. Sin ese
header el usuario logueado no llega a la vía paga.

**2. Tope diario global.** Contador en Supabase (tabla `apify_gasto`), **no en
memoria**: Vercel mata y levanta lambdas todo el tiempo y un contador en memoria
se reinicia en cada cold start, o sea que no sería un tope.

- Día calendario **America/Argentina/Buenos_Aires**, no UTC. Con UTC el corte
  caería a las 21:00 hora de Buenos Aires.
- Se **reserva** el cupo antes de arrancar, no se anota después: si se contara
  después, dos requests simultáneos leerían el mismo número y pasarían los dos.
- Si la corrida no arranca (error de Apify, no se pudo registrar en
  `busquedas_cache`), la reserva se anula y deja de contar.
- Si el contador no se puede consultar, **no se gasta**. Un freno que se abre
  cuando falla no es un freno.

Cubre las corridas de MercadoLibre y también las de `_fuentes.js` (TikTok Shop,
Google Trends): es la misma cuenta de Apify.

### Quién puede llegar a la vía paga, y quién no

No es un tope por request: es una exclusión. La decisión de fondo es **qué tipo
de consulta merece pagar**.

| Camino | ¿Puede pagar? | Por qué |
|---|---|---|
| Market Reader (`stepCompetencia`, `exploracion`, `testBusqueda`) | Sí, con sesión | El usuario pidió evaluar **ese** producto |
| Radar, saturación de un candidato puntual | Sí, con sesión | Idem: un producto, pedido explícitamente |
| `/api/analyze` (buscador de oportunidades) | **Nunca** | Es un barrido: el usuario pidió ver un nicho, no evaluar 12 productos |

`/api/analyze` pasa `sinPago: true` y eso **saca `proveedor` de la lista de vías
entera** — no es un guard adentro de la vía, la vía no está. Es imposible por
diseño, no por disciplina. Hay un segundo freno redundante adentro de la vía por
si alguien vuelve a meterla en la lista sin mirar.

La aritmética que lo justifica: un barrido de 12 productos podía costar hasta
**USD 2,30**, mientras el Market Reader paga **USD 0,19** por el único producto
que la persona está evaluando de verdad. Con la exclusión, el tope de 30 pasa a
ser 30 productos analizados en serio, no dos barridos y medio.

Lo que `/api/analyze` **sí** sigue haciendo gratis: leer el caché y cosechar una
corrida ya pagada por el Market Reader. Eso no arranca nada.

Cuando no hay dato, la tarjeta lo dice con todas las letras y ofrece el camino
bueno, en vez de mostrar un "A validar" pelado que se lee como si el sistema
hubiera mirado el mercado:

> **Competencia sin datos:** MercadoLibre no permite consultarla gratis.
> Analizá el producto en el Market Reader para traer las publicaciones reales.

(TikTok Shop y Google Trends en `_fuentes.js` son otra cosa: ahí el actor no es
la última vía, es la **única** fuente. Siguen pagando, con sesión y contra el
mismo tope.)

### Variables de entorno

| Variable | Default | Qué hace |
|---|---|---|
| `APIFY_MAX_RUNS_DIA` | `30` | Corridas pagas por día calendario argentino |
| `APIFY_COSTO_ITEM_ENRIQUECIDO` | `0.004` | USD por item con `enrichDetailPage` |
| `APIFY_COSTO_ITEM_PELADO` | `0.001` | USD por item sin página de detalle |
| `APIFY_ENRIQUECER` | prendido | `0` apaga `enrichDetailPage` (4x más barato) |
| `MELI_MARGEN_TOKEN_SEG` | `600` | Con menos de esto de vida, el token de MeLi se renueva |

`costo_estimado` es una **estimación** (items × precio por item del actor), no la
factura de Apify. Sirve para saber por dónde se fue la plata, no para conciliar.

### Auditoría

```bash
curl -s -H "x-admin-key: $ADMIN_KEY" \
  "https://productfinder-ia.vercel.app/api/market?gasto=1&n=50" | jq
```

Devuelve: día argentino en curso, tope, usadas, restantes, cuándo se reinicia,
el detalle de cada corrida (término, timestamp, `run_id`, si iba enriquecida,
costo estimado, `origen`) y el resumen agrupado **por término**, que es la
pregunta real: en qué se fue la plata.

`origen` dice qué camino la disparó: `market:competencia`, `exploracion`,
`test-busqueda`, `analyze`, `radar:saturacion`, `diag:catalogo`, `diag:probe`,
`fuente:tiktok`.

### Cómo mirarlo sin escribir comandos

Los tres diagnósticos de solo lectura (`?gasto=1`, `?pendientes=1`,
`?relevancia=1`) aceptan **dos** credenciales: la `ADMIN_KEY` por header
`x-admin-key`, o la **sesión de admin normal de la app**. Ninguno arranca
corridas.

Por eso hay una sección **"Gasto de MercadoLibre (Apify)"** en `/admin.html`
con tres botones: cuánto se gastó hoy, corridas sin cosechar, y cosechar las
que terminaron. Usa la clave que el panel ya tiene guardada en ese navegador,
así que no hay que escribir ningún comando ni meter la clave en una URL.

### Enriquecimiento: por qué NO se apaga

`enrichDetailPage` cuesta 4x. La pregunta era si el resultado pelado alcanza.
Medido sobre 48 filas crudas con `enrichment_status: "not_requested"`:

| Campo | Sin enriquecer | Enriquecido |
|---|---|---|
| título, precio, `category_id` | 48/48 | ✅ |
| `free_shipping` | 46/48 | ✅ |
| nickname del vendedor | **27/48 (56%)** | 44–48 de 46–48 (~96%) |
| tienda oficial, rating | 27/48, 24/48 | ✅ |
| **`sold_quantity`** | **0/48** | 12–45 por corrida |
| **stock, reputación, nº de opiniones** | **0/48** | — |

Se probaron los 8 nombres que la app acepta para "vendidos"
(`soldQuantity`, `sold_quantity`, `sold`, `sales`, `quantitySold`, `vendidos`,
`sold_quantity_text`, `soldQuantityText`): **ninguno aparece**. No es un
problema de parseo.

Conclusión: el resultado pelado **alcanza para competencia** (precio, categoría,
envío, cuántos vendedores distintos) y **no alcanza para rotación**, que es
exactamente lo que mide `sold_quantity`. Apagarlo ahorra un 62% (USD 0,088
contra 0,232 por 48 items) a cambio de perder la mitad de lo que el Market
Reader existe para decir. Por eso `APIFY_ENRIQUECER` queda prendido.

### Costo real de una corrida

La ficha del actor cobra por item, pero hay además un **costo de arranque fijo**
que no está documentado. Cinco corridas reales de 48 items enriquecidos,
según la factura de Apify: 0,22405 / 0,22805 / 0,23205 / 0,23605 / 0,24005 —
promedio **0,23205**. 48 × 0,004 = 0,192, así que el arranque son **USD 0,040**
por corrida, corra 1 item o 48.

`costoEstimado()` es `arranque + items × unitario`. Sin ese término subestimaba
un 17% cada corrida, y el error crece cuanto más chicas son. Una corrida que
falla y no produce nada **igual cuesta el arranque** (medido: una corrida de
Google Trends terminó FAILED con 0 items y consumió crédito igual).

### Google Trends: por qué la curva de demanda es estimada

Hay **dos** caminos distintos, y sólo uno alimenta el Market Reader:

| Camino | Quién lo usa | Estado |
|---|---|---|
| `safeGoogleTrends()` en `market.js` — scrapea `trends.google.com` **directo desde Vercel** | Market Reader, bloque de demanda | Google devuelve 429: bloquea IPs de datacenter |
| `consultarTrends()` en `_fuentes.js` — actor de Apify | Radar, búsquedas relacionadas | 4 de 4 corridas en FAILED por rate limit de Google |

Los dos fallan por la misma razón de fondo (Google bloquea automatización) pero
**son código separado**: que el actor de Apify falle no es lo que hace caer al
Market Reader en estimación de IA. El bloque de demanda nunca llamó al actor.

El error que devuelve el actor, textual:

> `No data returned for any requested type (related_queries: 0). Google likely
> rate-limited this run after all retries. This is temporary - try again in 2-3
> minutes, change geo to US, or reduce dataTypes.`

El input está bien armado (`geo: AR`, `timeframe: 'today 12-m'`, `dataTypes`,
`maxResults`). No es un bug de integración.

**Reintento único.** Cuando una corrida falla con firma de rate limit, la fila
queda en `RATE_LIMIT_ESPERANDO` con el momento **de la falla** (no el del
arranque, que es uno o dos minutos antes). Pasados `TRENDS_ESPERA_REINTENTO_SEG`
(default 180) se arranca **una** corrida más y la fila pasa a
`RATE_LIMIT_REINTENTADO`. Si esa también falla, se corta: un tercer arranque
contra un Google que sigue bloqueando es tirar plata. El reintento pasa por el
mismo tope diario que cualquier otra corrida.

**Pendiente, no hecho:** el actor acepta `interest_over_time` en `dataTypes`
—que es la serie temporal que el Market Reader necesita— y produce **1 fila por
keyword** con toda la línea de tiempo adentro, no una fila por fecha. Hoy se
pide sólo `related_queries`. Ver la nota en `_fuentes.js`.

### Corridas pagas sin cosechar (retención)

Una corrida sólo se cosecha si alguien vuelve a buscar el mismo término. Si
termina cuando ya nadie está mirando, se pagó y se pierde cuando vence la
retención del dataset. Para verlo y arreglarlo:

```bash
# Qué pasó con cada corrida anotada: ¿arrancó de verdad y consumió crédito?
# ¿el dataset todavía existe?
curl -s -H "x-admin-key: $ADMIN_KEY" \
  "https://productfinder-ia.vercel.app/api/market?pendientes=1&n=30" | jq

# Lo mismo, y además guarda las que ya terminaron
curl -s -H "x-admin-key: $ADMIN_KEY" \
  "https://productfinder-ia.vercel.app/api/market?pendientes=1&cosechar=1" | jq
```

Ninguna de las dos arranca corridas: leer el estado de una corrida y un dataset
ya producido es gratis.

**El barrido corre solo.** Un cron diario (9:00 UTC) llama a
`/api/market?cosechar=1`. Antes, una corrida sólo se cosechaba si alguien volvía
a buscar el mismo término: la que terminaba cuando el usuario ya se había ido se
pagaba y se perdía. Medido: de 13 corridas pagas, **5 habían quedado sin
levantar** (4 de Google Trends y 1 de TikTok Shop, que el barrido salteaba por
no ser de MercadoLibre — ahora las levanta también).

### `CRON_SECRET`: un secreto para los dos crons

`esCron()` y `esCronVerificado()` viven en `api/_sesion.js` para que los dos
crons compartan la misma variable. Hay que cargarla **una sola vez**:

> Vercel → proyecto `productfinder-ia` → **Settings → Environment Variables** →
> **Add New**. Name: `CRON_SECRET`. Value: cualquier texto largo y al azar
> (40+ caracteres). Environment: **Production**. Guardar y **redeploy**.

Qué cambia al cargarla:

| Endpoint | Sin `CRON_SECRET` | Con `CRON_SECRET` |
|---|---|---|
| `/api/market?cosechar=1` (barrido) | user-agent del cron — débil, pero no gasta nada | sólo el secreto |
| `/api/meli-refresh?all=1` (tokens) | user-agent del cron | **sólo el secreto** |

`/api/meli-refresh?all=1` estaba **abierto**: un endpoint sin credencial que
rotaba los tokens OAuth de todas las cuentas conectadas y devolvía los mails de
los clientes. No es teórico — se comprobó por accidente: un request de prueba
desde afuera, sin ninguna credencial, rotó los tokens de 11 cuentas reales y
devolvió sus emails.

El cierre de `meli-refresh` es **escalonado a propósito**: si exigiera el
secreto antes de que exista, el cron diario empezaría a dar 401 en silencio y
los `refresh_token` de los clientes caducarían por no usarse — peor que el
agujero que se cierra. Mientras la variable no esté, vale el user-agent; en
cuanto esté, el user-agent solo deja de alcanzar, sin tocar código. La respuesta
del endpoint informa en qué modo está, en el campo `proteccion`.

**`CORRIDA_VIGENTE_HORAS`** (default **168**, o sea 7 días) reemplaza a la
ventana de 15 minutos que había antes. Medido: los datasets de Apify siguen
vivos un mes después (13 de 13 corridas del 1 al 5 de septiembre tenían su
dataset disponible el 8 de octubre). Subirla no arriesga nada: si la corrida
falló, la cosecha devuelve null y el flujo arranca otra.

Ojo con `run_estado` de `busquedas_cache`: es el estado que devolvió Apify **al
crear** la corrida (casi siempre `READY`, o sea encolada) y nunca se actualizó.
No dice si después corrió. Eso lo contesta `corrida.arrancoDeVerdad` /
`computeUnits` / `costo_usd` de este endpoint.

### Pista pendiente: `mercadolibre.com.ar/ofertas?q=`

Medido el 8/9/2026 en el diagnóstico `?catalogo=`: de las cuatro URLs públicas
que se prueban, tres devuelven el muro anti-bot (`ids: 0`, `muro: true`) y
**`/ofertas?q=` no** — devolvió 634 KB y 48 IDs.

Pero de 5 de esos IDs hidratados con `/items?ids=` volvieron **0**. La sospecha
es que la página de ofertas **ignora el `q=`** y devuelve la grilla genérica de
ofertas del día: o sea, otra trampa de resultados de rescate, con la forma
exacta que ya conocemos (muchos IDs, ninguno del producto).

No se siguió. Si algún día se retoma, lo primero a probar es si los 48 IDs
cambian al cambiar el `q=`. Si no cambian, está confirmado que la página lo
ignora y la pista se cierra.

### Prueba

```bash
npm run test:gasto
```

Levanta un Supabase falso y un Apify falso en localhost y hace correr el código
real: gate de sesión, tope, liberación del cupo cuando la corrida no arranca,
freno cerrado cuando no se puede contar, y la regresión de que **sin sesión las
vías gratuitas siguen andando**.

## Constantes calibradas contra fixtures, no contra datos reales

Esta sección existe porque dentro de tres meses nadie se va a acordar de cuáles
números salieron de una medición y cuáles de una suposición razonable. La
distinción importa: son las que deciden si un producto se marca como "no se
vende en Argentina".

**El problema que resuelven.** MercadoLibre casi nunca devuelve cero. Ante una
búsqueda sin coincidencias sirve *resultados de rescate* y los presenta como
normales: verificado en el navegador, `listado.mercadolibre.com.ar/qwzxvbnmklpoiuy-asdfghjk-zzz`
devuelve "78 resultados" con bujías NGK y repuestos de moto, sin ningún aviso.
Los marcadores `rescue`/`zrp`/`intervention` del HTML **no sirven** como señal:
aparecen también en búsquedas con resultados reales, son strings del bundle.
Por eso la señal es la *relevancia por título*: qué fracción de las palabras de
la búsqueda aparece en los títulos devueltos.

**Qué está estimado** (todo en `api/_meli.js`):

| Constante | Valor | Cómo se eligió |
|---|---|---|
| `RELEVANCIA_UMBRAL_ALTO` | `0.40` | **Ya no es fixture.** Calibrado el 8/9/2026 contra 693 títulos reales (ver abajo). |
| `RELEVANCIA_UMBRAL_BAJO` | `0.15` | **Ya no es fixture.** Mismo origen. Se dejó bajo a propósito (ver asimetría, abajo). |
| `PESOS_POSICION` | `[1.0, 0.6, 0.3]` | Fixture. Corrige el sesgo por largo de consulta; medido, lo reduce pero no lo elimina del todo. |
| Mínimo de muestra | `8` publicaciones | Heurística, nunca medida. |

Los tres se pueden pisar por variable de entorno: `RELEVANCIA_UMBRAL_ALTO`,
`RELEVANCIA_UMBRAL_BAJO`.

### Cómo se calibraron los umbrales contra datos reales

Las corridas pagas dejaron **693 títulos reales de MercadoLibre Argentina** en
`busquedas_cache`, repartidos en 18 términos. Eso da los positivos. El problema
era conseguir **negativos**: con sólo positivos no se puede elegir un umbral.

La solución fue gratis: **correr cada término contra los títulos de los otros
17**. Eso es exactamente lo que hace MercadoLibre cuando sirve resultados de
rescate — publicaciones reales que no son lo que se buscó. 18 positivos y **306
negativos reales**, sin gastar una corrida.

```
POSITIVOS (18)    min 0.2630   p25 0.7182   mediana 1.0000
NEGATIVOS (306)   mediana 0.0000   p95 0.1030   p99 0.3750   max 0.6458
                  81% de los negativos da exactamente 0.0000
```

Barrido de umbrales sobre esos datos:

| alto | positivos correctos | negativos que pasan como "existe" | de esos, errores genuinos |
|---|---|---|---|
| 0.25 | 18/18 | 8 | 5 |
| 0.35 (anterior) | 17/18 | 6 | 3 |
| **0.40 (actual)** | **17/18** | **3** | **0** |
| 0.50 | 15/18 | 3 | 0 |

Con 0.35 pasaban tres cruces que comparten **una sola palabra genérica**
(`bomba solar` contra títulos de `boyero solar`, `parasol auto` contra
`rastreador gps auto` y al revés), los tres en 0.3750. Con 0.40 caen y no se
pierde ningún positivo. Los tres que quedan arriba de 0.40 son pares que **sí**
son el mismo producto con otro nombre (`rastreador gps auto` /
`rastreador veicular`, `boyero` / `electrificador de alambrados`).

`bajo` se quedó en 0.15: el positivo real más bajo es 0.2630, y subirlo a 0.20
recortaría el margen justo contra el error caro.

**Cero falsos `noExiste` en los 18 positivos.** El error que importa no apareció
ni una vez.

### Pendiente: verificar que el traductor elija la palabra del MERCADO

El único positivo que no llega a `existe` es `electrificador de alambrados`
(0.2630), y no es un problema de umbral: MercadoLibre devuelve publicaciones que
dicen **"boyero"**, que es como se le llama al mismo aparato en Argentina.
`boyero solar` da 1.0000; `electrificador de alambrados`, 0.2630. Mismo
producto, mismo mercado, distinta palabra.

El riesgo no es del scoring, es de **`nombrarProductos()`**: traduce títulos
chinos o ingleses al castellano, y si elige la palabra *correcta* en vez de la
palabra que usa el mercado, el producto puntúa bajo y parece menos presente de
lo que está.

Hay con qué verificarlo y no cuesta nada: los 693 títulos reales que ya están en
`busquedas_cache` son un corpus del vocabulario real de MercadoLibre Argentina.
**No hecho.**

**La asimetría es deliberada.** Los dos errores no cuestan lo mismo:

- Un falso `existe` arma un precio de referencia con productos equivocados.
  Malo, pero queda **visible** en pantalla (el ratio se muestra siempre) y el
  usuario lo puede desconfiar.
- Un falso `noExiste` le dice que un producto no tiene mercado. **Invisible**:
  no vuelve a mirarlo, y no deja rastro para auditar después.

Por eso el piso es bajo y existe la banda `dudoso` en el medio, que no afirma
ausencia. Si hay que equivocarse, que sea para el lado que se ve.

**Cómo recalibrar, que es lo que hay que hacer.** No se puede medir esto sin
consultas reales. Cada medición queda registrada con la búsqueda, las palabras
significativas, el ratio, el estado y los primeros 5 títulos **devueltos**
(crudos, incluidos los de rescate: sin ellos un ratio suelto no dice nada):

```bash
curl -H "x-admin-key: $ADMIN_KEY" \
     "https://productfinder-ia.vercel.app/api/market?relevancia=1&n=50"
```

Requiere la tabla `relevancia_log` (ver `supabase/relevancia_log_migration.sql`).
Sin ella el registro vive sólo en memoria del proceso y **un cold start de
Vercel lo vacía**, con lo cual nunca se juntan suficientes consultas para
decidir nada. Las tres consultas SQL para recalibrar están comentadas al final
de ese archivo de migración.

Lo primero que hay que mirar son los productos que vos sabés que se venden y
quedaron en `dudoso` o `noExiste`: esos son los falsos negativos, el error que
no se ve solo.

**Lo que sí está medido**, para no confundirlo con lo de arriba: el tipo de
cambio sale de `dolarapi.com` en vivo (`api/_dolar.js`), el IVA de importación y
la percepción salen de la base imponible real (CIF + aranceles + tasa de
estadística), y los precios de competencia salen de `/items?ids=` de la API
oficial de MercadoLibre.
