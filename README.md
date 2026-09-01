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
| `ANTHROPIC_API_KEY` | Análisis con IA del analizador | Sí, para el analizador |
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
