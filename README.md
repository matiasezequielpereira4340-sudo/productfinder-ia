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
| `GROQ_API_KEY` | API key de Groq (gratis en groq.com) | No (usa fallback local) |
| `PORT` | Puerto del servidor (default: 3000) | No |

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
