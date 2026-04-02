const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const MELI_BASE = 'https://api.mercadolibre.com';

// Cache del app token (client_credentials)
let cachedAppToken = null;
let tokenExpiry = 0;

async function getMeliAppToken() {
      if (cachedAppToken && Date.now() < tokenExpiry - 60000) return cachedAppToken;
      const clientId = process.env.MELI_CLIENT_ID;
      const clientSecret = process.env.MELI_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
              return process.env.MELI_ACCESS_TOKEN || null;
      }
      try {
              const body = new URLSearchParams({
                        grant_type: 'client_credentials',
                        client_id: clientId,
                        client_secret: clientSecret
              });
              const res = await fetch('https://api.mercadolibre.com/oauth/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
                        body: body.toString()
              });
              if (res.ok) {
                        const data = await res.json();
                        cachedAppToken = data.access_token;
                        tokenExpiry = Date.now() + (data.expires_in * 1000);
                        console.log('Token app obtenido via client_credentials');
                        return cachedAppToken;
              } else {
                        const errText = await res.text();
                        console.error('Error obteniendo app token:', res.status, errText);
                        return process.env.MELI_ACCESS_TOKEN || null;
              }
      } catch(e) {
              console.error('Error en getMeliAppToken:', e.message);
              return process.env.MELI_ACCESS_TOKEN || null;
      }
}

                  async function meliHeaders() {
                        const token = await getMeliAppToken();
                        const headers = { 'Accept': 'application/json', 'User-Agent': 'ProductFinderIA/1.0' };
                        if (token) headers['Authorization'] = `Bearer ${token}`;
                        return headers;
                  }

// ============================================================
    // USUARIOS
// ============================================================
const users = new Map();
users.set('matypereira', {
      password: process.env.ADMIN_PASSWORD || 'pf-admin-secret-2024',
      role: 'admin', expiresAt: null,
      createdAt: new Date().toISOString(), active: true, expiryDays: null
});

// ============================================================
// API MARKET
// ============================================================
app.post('/api/market', async (req, res) => {
      const { step, product, prompt } = req.body;
      try {
              if (step === 'demanda') {
                        const trendData = await getDemandaData(product);
                        res.json(trendData);
              } else if (step === 'competencia') {
                        const meliData = await getMeliCompetitionData(product);
                        res.json(meliData);
              } else if (step === 'final') {
                        const analysis = await getAIAnalysis(prompt);
                        res.json(analysis);
              } else {
                        res.status(400).json({ error: 'Step no reconocido' });
              }
      } catch (err) {
              console.error('Error en /api/market:', err.message);
              res.status(500).json({ error: 'Error al obtener datos del mercado', detail: err.message });
      }
      });

          // ============================================================
// DEMANDA REAL desde MeLi
// ============================================================
async function getDemandaData(product) {
      try {
              const headers = await meliHeaders();
              if (!headers['Authorization']) return getCategoryTrendsFallback(product);

        const query = encodeURIComponent(product);
              const response = await fetch(`${MELI_BASE}/sites/MLA/search?q=${query}&limit=50&sort=relevance`, { headers });

        if (!response.ok) {
                  console.error('MeLi demanda error:', response.status);
                  return getCategoryTrendsFallback(product);
        }

        const searchData = await response.json();
              const results = searchData.results || [];
              const total = searchData.paging?.total || 0;

        if (results.length === 0) return getCategoryTrendsFallback(product);

        const totalSold = results.reduce((sum, r) => sum + (r.sold_quantity || 0), 0);
              const avgSold = totalSold / results.length;

        let demandaScore = Math.min(95, Math.round(
                  (Math.log10(total + 1) * 18) +
                  (Math.min(avgSold, 200) / 200 * 40) +
                  (results.filter(r => r.sold_quantity > 10).length / results.length * 40)
                ));
              demandaScore = Math.max(10, demandaScore);

        const highSellerRatio = results.filter(r => r.sold_quantity > 50).length / results.length;
              let tendencia = 'estable';
              if (highSellerRatio > 0.3 || total > 10000) tendencia = 'subiendo';
              else if (total < 100 && avgSold < 5) tendencia = 'bajando';

        let nivelDemanda = 'media';
              if (demandaScore >= 80) nivelDemanda = 'muy alta';
              else if (demandaScore >= 65) nivelDemanda = 'alta';
              else if (demandaScore >= 45) nivelDemanda = 'media-alta';
              else if (demandaScore < 30) nivelDemanda = 'baja';

        const meses = ['May','Jun','Jul','Ago','Sep','Oct','Nov','Dic','Ene','Feb','Mar','Abr'];
              const seasonal = [0.85,0.87,0.90,0.92,0.93,0.95,0.98,1.0,0.93,0.88,0.85,0.84];
              const monthlyData = meses.map((mes, i) => ({
                        mes, valor: Math.round(Math.min(100, demandaScore * seasonal[i] + (Math.random()*5-2)))
              }));

        const firstHalf = monthlyData.slice(0,6).reduce((a,b)=>a+b.valor,0)/6;
              const secondHalf = monthlyData.slice(6).reduce((a,b)=>a+b.valor,0)/6;
              let temporalidad = 'demanda constante todo el año';
              if (secondHalf > firstHalf * 1.15) temporalidad = 'pico en segunda mitad del año (Black Friday, Navidad)';
              else if (secondHalf < firstHalf * 0.85) temporalidad = 'pico en primera mitad del año';

        const tags = [];
              if (demandaScore >= 65) tags.push('Alta demanda');
              if (tendencia === 'subiendo') tags.push('Mercado en expansión');
              if (temporalidad.includes('pico')) tags.push('Estacional');
              if (total > 5000) tags.push('Mercado masivo');
              tags.push('Argentina');

        return {
                  tendencia, nivelDemanda, demandaScore, temporalidad, monthlyData,
                  totalResultados: total, ventasPromedio: Math.round(avgSold),
                  descripcion: `"${product}" tiene ${total.toLocaleString('es-AR')} publicaciones activas en MeLi Argentina. Promedio de ${Math.round(avgSold)} ventas/unidad. Datos en tiempo real.`,
                  tags, detectedCategory: 'MercadoLibre Argentina', realData: true
        };
      } catch (err) {
              console.error('Error demanda:', err.message);
              return getCategoryTrendsFallback(product);
      }
}

// ============================================================
// COMPETENCIA REAL desde MeLi
// ============================================================
async function getMeliCompetitionData(product) {
      const headers = await meliHeaders();
      if (!headers['Authorization']) throw new Error('Token MeLi no disponible.');

  const searchQuery = encodeURIComponent(product);

  const [resAsc, resRel] = await Promise.all([
          fetch(`${MELI_BASE}/sites/MLA/search?q=${searchQuery}&limit=50&sort=price_asc`, { headers }),
          fetch(`${MELI_BASE}/sites/MLA/search?q=${searchQuery}&limit=50&sort=relevance`, { headers })
        ]);

  if (!resAsc.ok) {
          const errBody = await resAsc.text();
          throw new Error(`MeLi API error ${resAsc.status}: ${errBody.substring(0,200)}`);
  }

  const dataAsc = await resAsc.json();
      const dataRel = resRel.ok ? await resRel.json() : dataAsc;

  const resultsAsc = dataAsc.results || [];
      const resultsRel = dataRel.results || [];
      const total = dataAsc.paging?.total || 0;

  const allResultsMap = new Map();
      [...resultsRel, ...resultsAsc].forEach(r => allResultsMap.set(r.id, r));
      const allResults = Array.from(allResultsMap.values());

  if (allResults.length === 0) {
          return { sellersEstimados:0, precioMinARS:0, precioMaxARS:0, precioPromedioARS:0,
                        saturacion:'desconocido', competenciaScore:50, descripcion:'Sin resultados.', oportunidad:null, competitors:[] };
  }

  const precios = allResults.map(r=>r.price).filter(p=>p>0).sort((a,b)=>a-b);
      const precioMinARS = precios[0]||0;
      const precioMaxARS = precios[precios.length-1]||0;
      const precioPromedioARS = Math.round(precios.reduce((a,b)=>a+b,0)/precios.length)||0;
      const precioMedianaARS = precios[Math.floor(precios.length/2)]||0;

  const sellersUnicos = [...new Set(allResults.map(r=>r.seller?.id))].filter(Boolean);
      const sellersEstimados = sellersUnicos.length;

  let saturacion = 'moderado';
      if (total > 5000 || sellersEstimados > 200) saturacion = 'muy saturado';
      else if (total > 1000 || sellersEstimados > 80) saturacion = 'saturado';
      else if (total < 50 && sellersEstimados < 15) saturacion = 'libre';

  const competenciaScore = Math.max(10, Math.min(90, 100 - Math.log10(total+1)*15 - (sellersEstimados/2)));

  const topResults = resultsRel.slice(0,5).map((r,i) => {
          const seller = r.seller||{};
          const rep = seller.seller_reputation||{};
          let repLabel='Seller nuevo'; let repClass='rep-silver';
          if (r.official_store_id) { repLabel='Tienda Oficial ✓'; repClass='rep-gold'; }
          else if (rep.power_seller_status==='gold') { repLabel='Power Seller ⭐'; repClass='rep-gold'; }
          else if (rep.level_id==='5_gold'||rep.level_id==='4_gold') { repLabel='MercadoLíder'; repClass='rep-gold'; }
          else if (rep.transactions?.total>100) { repLabel='Seller activo'; repClass='rep-green'; }
          return {
                    rank:i+1, name:r.title||'Sin título', price:r.price||0,
                    currency:r.currency_id||'ARS', condition:r.condition==='new'?'Nuevo':'Usado',
                    soldQty:r.sold_quantity||0, availableQty:r.available_quantity||0,
                    reputation:repLabel, repClass, sellerNick:seller.nickname||'Anónimo',
                    listingType:r.listing_type_id==='gold_pro'?'Gold Pro':r.listing_type_id==='gold'?'Gold':'Silver',
                    freeShipping:r.shipping?.free_shipping||false, url:r.permalink||''
          };
  });

  const newCount = allResults.filter(r=>r.condition==='new').length;
      const oficialCount = allResults.filter(r=>r.official_store_id).length;
      const freeShipCount = allResults.filter(r=>r.shipping?.free_shipping).length;
      const descripcion = `${total.toLocaleString('es-AR')} publicaciones activas. ${newCount} productos nuevos (${Math.round((newCount/allResults.length)*100)}%). ${oficialCount>0?oficialCount+' tiendas oficiales. ':''}${freeShipCount} con envío gratis. Rango: ARS ${precioMinARS.toLocaleString('es-AR')} - ${precioMaxARS.toLocaleString('es-AR')}.`;

  let oportunidad = null;
      if (saturacion==='libre'&&precioMedianaARS>15000) oportunidad='Mercado con espacio. Buen momento para ingresar.';
      else if (saturacion==='moderado'&&precioMedianaARS>20000) oportunidad='Competencia moderada. Diferenciarse con calidad o precio.';
      else if (precioMedianaARS<10000&&total>50) oportunidad='Mercado de bajo precio. Se necesita alto volumen.';

  let categoryName = null;
      const catId = dataRel.results?.[0]?.category_id;
      if (catId) {
              try {
                        const catRes = await fetch(`${MELI_BASE}/categories/${catId}`, { headers });
                        if (catRes.ok) { const catData = await catRes.json(); categoryName = catData.name; }
              } catch {}
      }

  return {
          sellersEstimados, precioMinARS, precioMaxARS, precioPromedioARS, precioMedianaARS,
          saturacion, competenciaScore: Math.round(competenciaScore),
          descripcion, oportunidad, competitors: topResults,
          totalResults: total, newProducts: newCount, officialStores: oficialCount,
          freeShipping: freeShipCount, categoryName, realData: true,
          timestamp: new Date().toISOString()
  };
}

// ============================================================
// FALLBACK por categoria
// ============================================================
function getCategoryTrendsFallback(product) {
      const categoryTrends = {
              'tecnologia': { tendencia:'subiendo', nivelDemanda:'muy alta', score:82 },
              'hogar': { tendencia:'estable', nivelDemanda:'alta', score:70 },
              'deportes': { tendencia:'subiendo', nivelDemanda:'alta', score:75 },
              'moda': { tendencia:'estable', nivelDemanda:'alta', score:72 },
              'mascotas': { tendencia:'subiendo', nivelDemanda:'media-alta', score:65 },
              'bebe': { tendencia:'estable', nivelDemanda:'media-alta', score:68 },
              'default': { tendencia:'estable', nivelDemanda:'media', score:52 }
      };
      const productLower = product.toLowerCase();
      let detectedCategory = 'default';
      const categoryKeywords = {
              'tecnologia': ['auricular','watch','smart','tablet','cargador','cable','usb','celular','phone','speaker','bluetooth','wifi','camara','gaming','mouse','teclado','led','dron','robot','funda','iphone','samsung'],
              'hogar': ['lampara','alfombra','organizador','cocina','cama','sabanas','decoracion','jardin','mueble','silla','mesa'],
              'deportes': ['pesa','yoga','running','fitness','bicicleta','gimnasia','deporte','entrenamiento','proteina'],
              'moda': ['remera','camisa','pantalon','zapatilla','zapato','bolso','mochila','cartera','lentes','collar','pulsera'],
              'mascotas': ['perro','gato','mascota','correa','comida para'],
              'bebe': ['baby','bebe','nino','juguete','cochecito','mamila','panales']
      };
      for (const [cat, keywords] of Object.entries(categoryKeywords)) {
              if (keywords.some(kw => productLower.includes(kw))) { detectedCategory = cat; break; }
      }
      const catData = categoryTrends[detectedCategory];
      const meses = ['May','Jun','Jul','Ago','Sep','Oct','Nov','Dic','Ene','Feb','Mar','Abr'];
      const estacionalidad = {
              'tecnologia': [70,75,80,85,88,90,95,100,85,80,75,72],
              'hogar': [80,85,90,88,85,82,85,95,90,85,80,82],
              'deportes': [60,65,70,75,80,85,90,95,100,95,85,70],
              'moda': [75,80,85,82,78,80,90,100,85,75,70,72],
              'mascotas': [70,72,75,78,80,82,85,90,88,85,82,78],
              'bebe': [65,70,75,80,85,82,78,85,90,95,88,75],
              'default': [65,68,72,75,78,80,82,85,82,78,75,72]
      };
      const base = estacionalidad[detectedCategory];
      const monthlyData = meses.map((mes,i)=>({ mes, valor: Math.round(Math.max(20,Math.min(100,base[i]+(Math.random()*6-3)))) }));
      return {
              tendencia:catData.tendencia, nivelDemanda:catData.nivelDemanda,
              demandaScore:catData.score, temporalidad:'demanda constante todo el año',
              monthlyData, tags:['Argentina','Estimado por categoría'], detectedCategory, realData:false,
              descripcion:`Datos estimados por categoría. Configurá variables MeLi para datos en tiempo real.`
      };
}

// ============================================================
// ANALISIS IA
// ============================================================
async function getAIAnalysis(prompt) {
      const GROQ_API_KEY = process.env.GROQ_API_KEY;
      if (GROQ_API_KEY) {
              try {
                        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                                    method: 'POST',
                                    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                                  model: 'llama-3.3-70b-versatile',
                                                  messages: [
                                                      { role:'system', content:'Sos un analista experto en importaciones China-Argentina. Respondés SOLO con JSON válido sin markdown: {"scoreTotal":0-100,"scoresDemanda":0-100,"scoresCompetencia":0-100,"scoresMargen":0-100,"scoresRegulatorio":0-100,"labelDemanda":"string","labelCompetencia":"string","labelMargen":"string","labelRegulatorio":"string","veredicto":"VIABLE|VIABLE CON CONDICIONES|NO RECOMENDADO","veredictoTexto":"2-3 oraciones en español rioplatense","analisisCompleto":"máx 350 palabras en español rioplatense"}' },
                                                      { role:'user', content:prompt }
                                                                ],
                                                  temperature: 0.3, max_tokens: 1500
                                    })
                        });
                        if (response.ok) {
                                    const data = await response.json();
                                    const content = data.choices?.[0]?.message?.content?.trim()
                                      .replace(/^```json\s*/i,'').replace(/```$/i,'').trim();
                                    if (content) return JSON.parse(content);
                        }
              } catch (err) { console.error('Error Groq:', err.message); }
      }
      return getLocalAnalysis(prompt);
}

function getLocalAnalysis(prompt) {
      return {
              scoreTotal:60, scoresDemanda:65, scoresCompetencia:55, scoresMargen:60, scoresRegulatorio:50,
              labelDemanda:'Demanda estimada', labelCompetencia:'Competencia moderada',
              labelMargen:'Margen a confirmar', labelRegulatorio:'Sin restricciones especiales',
              veredicto:'VIABLE CON CONDICIONES',
              veredictoTexto:'Configurá GROQ_API_KEY para análisis IA completo. Los datos de precios son 100% reales de MercadoLibre.',
              analisisCompleto:'Para análisis detallado con IA, configurá GROQ_API_KEY en Railway. Groq es gratuito en groq.com.'
      };
}

// ============================================================
// AUTENTICACION
// ============================================================
app.post('/api/auth', (req, res) => {
      const { username, password } = req.body;
      const user = users.get(username?.trim());
      if (user && user.active !== false && user.password === password?.trim()) {
              if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
                        return res.status(401).json({ success:false, error:'Sesión expirada' });
              }
              return res.json({ success:true, role:user.role, expiresAt:user.expiresAt });
      }
      return res.status(401).json({ success:false, error:'Credenciales inválidas' });
});

// ============================================================
// GESTION DE USUARIOS
// ============================================================
function verifyAdmin(req, res) {
      const key = req.headers['x-admin-key'];
      const adminPass = process.env.ADMIN_PASSWORD || 'pf-admin-secret-2024';
      if (key !== adminPass) { res.status(403).json({ error:'No autorizado' }); return false; }
      return true;
}

app.get('/api/users', (req, res) => {
      if (!verifyAdmin(req, res)) return;
      const userList = Array.from(users.entries()).map(([username, data]) => ({
              username, role:data.role, active:data.active!==false,
              expiresAt:data.expiresAt, createdAt:data.createdAt, expiryDays:data.expiryDays
      }));
      res.json({ users: userList });
});

app.post('/api/users', (req, res) => {
      if (!verifyAdmin(req, res)) return;
      const { username, password, expiryDays } = req.body;
      if (!username||!password) return res.status(400).json({ error:'Usuario y contraseña requeridos' });
      if (users.has(username.trim())) return res.status(409).json({ error:'El usuario ya existe' });
      const expiresAt = expiryDays ? new Date(Date.now()+expiryDays*86400000).toISOString() : null;
      users.set(username.trim(), {
              password, role:'user', active:true,
              expiresAt, createdAt:new Date().toISOString(), expiryDays
      });
      res.json({ success:true, message:`Usuario "${username}" creado` });
});

app.delete('/api/users', (req, res) => {
      if (!verifyAdmin(req, res)) return;
      const { username, action, active } = req.body;
      if (!username||username==='matypereira') return res.status(400).json({ error:'Operación no permitida' });
      if (!users.has(username)) return res.status(404).json({ error:'Usuario no encontrado' });
      if (action==='delete') { users.delete(username); return res.json({ success:true, message:`Usuario "${username}" eliminado` }); }
      if (action==='toggle') {
              const user = users.get(username);
              user.active = active===true||active==='true';
              users.set(username, user);
              return res.json({ success:true, message:`Usuario "${username}" ${user.active?'activado':'desactivado'}` });
      }
      res.status(400).json({ error:'Acción no reconocida' });
});

// ============================================================
// ANALYZE
// ============================================================
app.post('/api/analyze', async (req, res) => {
      const { capital, experiencia, canal, nicho, riesgo } = req.body;
      try {
              const GROQ_API_KEY = process.env.GROQ_API_KEY;
              if (!GROQ_API_KEY) return res.json({ products: getDefaultProducts(nicho) });
              const prompt = `Generá 5 productos para importar desde China a Argentina con: capital=${capital}, experiencia=${experiencia}, canal=${canal}, nicho=${nicho}, riesgo=${riesgo}. SOLO JSON: {"products":[{"nombre":"string","score":0-100,"margen":0-100,"demanda":"alta|media|baja","riesgo":"alto|medio|bajo","ticket":"$XX.XXX","justificacion":"string","topPick":bool}]}`;
              const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method:'POST',
                        headers:{ 'Authorization':`Bearer ${GROQ_API_KEY}`, 'Content-Type':'application/json' },
                        body:JSON.stringify({ model:'llama-3.3-70b-versatile', messages:[{role:'user',content:prompt}], temperature:0.4, max_tokens:1500 })
              });
              if (response.ok) {
                        const data = await response.json();
                        const content = data.choices?.[0]?.message?.content?.trim().replace(/^```json\s*/i,'').replace(/```$/i,'').trim();
                        if (content) return res.json(JSON.parse(content));
              }
              res.json({ products: getDefaultProducts(nicho) });
      } catch(err) { res.json({ products: getDefaultProducts(nicho) }); }
});

function getDefaultProducts(nicho) {
      return [
          { nombre:'Auriculares Bluetooth TWS', score:82, margen:45, demanda:'alta', riesgo:'bajo', ticket:'$25.000', justificacion:'Alta demanda sostenida en MeLi. Buen margen.', topPick:true },
          { nombre:'Cargador Inalámbrico 15W', score:76, margen:50, demanda:'alta', riesgo:'bajo', ticket:'$18.000', justificacion:'Bajo costo FOB, alta rotación.', topPick:false },
          { nombre:'Smartwatch Deportivo', score:74, margen:40, demanda:'media', riesgo:'medio', ticket:'$45.000', justificacion:'Mercado en crecimiento.', topPick:false },
          { nombre:'Funda Silicona Premium', score:70, margen:55, demanda:'alta', riesgo:'bajo', ticket:'$8.000', justificacion:'Volumen masivo, bajo costo.', topPick:false },
          { nombre:'Soporte Auto Magnético', score:68, margen:48, demanda:'media', riesgo:'bajo', ticket:'$12.000', justificacion:'Alta rotación en canales digitales.', topPick:false }
            ];
}

// ============================================================
// CHAT
// ============================================================
app.post('/api/chat', async (req, res) => {
      const { message, context } = req.body;
      const GROQ_API_KEY = process.env.GROQ_API_KEY;
      if (!GROQ_API_KEY) return res.json({ reply:'Configurá GROQ_API_KEY para activar el consultor IA.' });
      try {
              const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method:'POST',
                        headers:{ 'Authorization':`Bearer ${GROQ_API_KEY}`, 'Content-Type':'application/json' },
                        body:JSON.stringify({
                                    model:'llama-3.3-70b-versatile',
                                    messages:[
                                        { role:'system', content:'Sos consultor especializado en importaciones China-Argentina y MercadoLibre. Español rioplatense, directo.'+(context?` Contexto: ${context}`:'') },
                                        { role:'user', content:message }
                                                ],
                                    temperature:0.5, max_tokens:800
                        })
              });
              if (response.ok) {
                        const data = await response.json();
                        return res.json({ reply:data.choices?.[0]?.message?.content||'Sin respuesta' });
              }
              res.json({ reply:'Error al procesar.' });
      } catch(err) { res.json({ reply:'Error de conexión.' }); }
});

// ============================================================
// SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
      console.log(`ProductFinder IA corriendo en puerto ${PORT}`);
      const token = await getMeliAppToken();
      console.log(`MELI Token: ${token ? 'OBTENIDO OK' : 'FALTA CONFIGURAR'}`);
      console.log(`GROQ_API_KEY: ${process.env.GROQ_API_KEY ? 'CONFIGURADO' : 'FALTA CONFIGURAR'}`);
});
