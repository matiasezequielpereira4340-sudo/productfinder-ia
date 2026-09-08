// pruebas/navegacion.mjs
// Se corre con: npm run test:nav        (escritorio)
//               npm run test:nav:movil  (360x800)
//
// Levanta su propio servidor estatico y maneja Chromium.
//
// playwright-core NO es dependencia del proyecto a proposito: es una
// herramienta de prueba de 14 MB y este repo versiona node_modules, o sea que
// meterla ahi la manda a produccion. Antes de correr el test:
//
//   npm i --no-save playwright-core
//
// El Chromium se toma de PLAYWRIGHT_CHROMIUM, y por defecto del que ya viene
// instalado en /opt/pw-browsers.
//
// Prueba de navegacion del nav compartido.
//
// LA ASERCION QUE IMPORTA: que el clic INVOQUE la funcion de navegacion del
// SPA. Medir "quedo en la pantalla correcta" no sirve para este bug: cuando el
// hash destino es igual al actual ya estas en la pantalla correcta, asi que el
// chequeo pasa igual con el clic muerto. Y "scrolleo al tope" tampoco: el
// navegador scrollea al tope solo por ser un link a un fragmento inexistente,
// haya o no JavaScript. Por eso se cuentan las llamadas a showMenu/showMarket/
// showApp: eso es exactamente lo que dejaba de pasar.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = Number(process.env.PUERTO || 4310);
const BASE = 'http://127.0.0.1:' + PUERTO;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon' };
const servidor = http.createServer((req, res) => {
  try {
    let ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (ruta === '/') ruta = '/index.html';
    const f = path.join(RAIZ, path.normalize(ruta).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end('404');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream',
                         'cache-control': 'no-store' });
    res.end(fs.readFileSync(f));
  } catch (e) { res.writeHead(500); res.end(String(e && e.message || e)); }
});
await new Promise(r => servidor.listen(PUERTO, '127.0.0.1', r));
const ancho = Number(process.env.W || 1280), alto = Number(process.env.H || 900);
const etiqueta = process.env.W ? ('MOVIL ' + ancho + 'x' + alto) : ('ESCRITORIO ' + ancho + 'x' + alto);

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: ancho, height: alto },
  isMobile: !!process.env.W, hasTouch: !!process.env.W,
  deviceScaleFactor: process.env.W ? 3 : 1
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('  [JS ERROR] ' + e.message));

let fallos = 0;
function ok(n, c, extra){ console.log((c?'  OK   ':'  FALLA')+' | '+n+(extra?' -> '+extra:'')); if(!c) fallos++; }
const pantalla = () => page.evaluate(() => { const a=document.querySelector('.screen.active'); return a?a.id:null; });
const hash     = () => page.evaluate(() => location.hash);
const scrollY  = () => page.evaluate(() => window.scrollY);
const histLen  = () => page.evaluate(() => history.length);

// Cuenta cuantas veces se llamo a cada funcion de navegacion del SPA.
async function instrumentar(){
  await page.evaluate(() => {
    window.__nav = { showMenu:0, showMarket:0, showApp:0 };
    ['showMenu','showMarket','showApp'].forEach(function(n){
      var orig = window[n];
      if (typeof orig !== 'function') return;
      window[n] = function(){ window.__nav[n]++; return orig.apply(this, arguments); };
    });
  });
}
const llamadas = () => page.evaluate(() => Object.assign({}, window.__nav));
const resetLlamadas = () => page.evaluate(() => { window.__nav = { showMenu:0, showMarket:0, showApp:0 }; });

async function entrarComoInvitado(){
  await page.goto(BASE + '/index.html', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.evaluate(() => { if (typeof doGuest === 'function') doGuest(); });
  await page.evaluate(() => { if (typeof showMenu === 'function') showMenu(); });
  await page.waitForTimeout(400);
  await instrumentar();
}

async function esLayoutMovil(){
  return await page.evaluate(() => {
    const t = document.getElementById('mcToggle');
    return !!t && getComputedStyle(t).display !== 'none';
  });
}
async function abrirMenuSiHaceFalta(){
  await page.evaluate(() => window.scrollTo(0,0));
  await page.waitForTimeout(150);
  const enMovil = await esLayoutMovil();
  if (enMovil) {
    const abierto = await page.evaluate(() => { const m=document.getElementById('mcMenu'); return !!(m&&m.classList.contains('show')); });
    if (!abierto) { await page.click('#mcToggle'); await page.waitForTimeout(300); }
  }
  return enMovil;
}
async function abrirDesplegableDe(clave){
  const enMovil = await abrirMenuSiHaceFalta();
  const padre = await page.$('.mc-item:has([data-mc-key="' + clave + '"])');
  if (!padre) return;
  const btn = await padre.$('button.mc-link');
  if (!btn) return;
  if (enMovil) await btn.click({ force:true }); else await btn.hover({ force:true });
  await page.waitForTimeout(300);
}
async function visibilidad(sel){
  return await page.evaluate((s)=>{
    const e=document.querySelector(s); if(!e) return 'no-existe';
    const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    if(cs.display==='none'||cs.visibility==='hidden'||!r.width||!r.height) return 'oculto';
    const centro=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
    const alcanzable = centro && (centro===e || e.contains(centro) || centro.contains(e));
    return Math.round(r.width)+'x'+Math.round(r.height)+(alcanzable?' clickeable':' TAPADO por '+(centro?(centro.className||centro.tagName):'nada'));
  }, sel);
}

console.log('\n===== ' + etiqueta + ' =====');
await entrarComoInvitado();
ok('arranca en el hub con #menu', await pantalla()==='menuScreen' && (await hash())==='#menu', (await pantalla())+' '+(await hash()));
console.log('  marca (.mc-brand):        ' + await visibilidad('.mc-brand'));
console.log('  hamburguesa (#mcToggle):  ' + await visibilidad('#mcToggle'));
console.log('  nav colapsado en movil:   ' + (await esLayoutMovil() ? 'SI, los items viven adentro del menu' : 'no, los items estan a la vista'));

// --- CASO 1: en #menu, clic en el logo (MISMO hash que el actual) ---
console.log('\n-- Caso 1: en #menu, clic en el logo --');
await abrirMenuSiHaceFalta();
await page.evaluate(() => window.scrollTo(0, 600));
await page.waitForTimeout(300);
const y0 = await scrollY();
await resetLlamadas();
await page.click('.mc-brand', { force:true });
await page.waitForTimeout(700);
const l1 = await llamadas();
ok('EL CLIC EJECUTO showMenu() (esto era el clic muerto)', l1.showMenu >= 1, JSON.stringify(l1));
ok('sigue en el hub', await pantalla()==='menuScreen', await pantalla());
ok('subio al tope (estaba en ' + y0 + ')', await scrollY() < 50, 'ahora ' + await scrollY());

// --- CASO 2: en #market, clic en el logo (hash DISTINTO) ---
console.log('\n-- Caso 2: en #market, clic en el logo --');
await page.evaluate(() => showMarket());
await page.waitForTimeout(600);
const h0 = await histLen();
ok('esta en el buscador', await pantalla()==='marketScreen' && (await hash())==='#market', (await pantalla())+' '+(await hash()));
await resetLlamadas();
await abrirMenuSiHaceFalta();
await page.click('.mc-brand', { force:true });
await page.waitForTimeout(700);
const l2 = await llamadas();
ok('EL CLIC EJECUTO showMenu()', l2.showMenu >= 1, JSON.stringify(l2));
ok('volvio al hub', await pantalla()==='menuScreen', (await pantalla())+' '+(await hash()));
ok('el menu movil quedo cerrado', await page.evaluate(()=>{const m=document.getElementById('mcMenu');return !m||!m.classList.contains('show');}));

// --- CASO 3: en #market, clic en "Buscador de oportunidades" (MISMO hash) ---
console.log('\n-- Caso 3: en #market, clic en "Buscador de oportunidades" --');
await page.evaluate(() => showMarket());
await page.waitForTimeout(600);
await abrirDesplegableDe('market');
await page.evaluate(() => window.scrollTo(0, 500));
await page.waitForTimeout(250);
const y1 = await scrollY();
await resetLlamadas();
await page.click('[data-mc-key="market"]', { force:true });
await page.waitForTimeout(700);
const l3 = await llamadas();
ok('EL CLIC EJECUTO showMarket() (esto era el clic muerto)', l3.showMarket >= 1, JSON.stringify(l3));
ok('sigue en el buscador', await pantalla()==='marketScreen', await pantalla());
ok('subio al tope (estaba en ' + y1 + ')', await scrollY() < 50, 'ahora ' + await scrollY());

// --- CASO 4: desde radar.html, clic en el logo ---
console.log('\n-- Caso 4: desde radar.html, clic en el logo --');
await page.goto(BASE + '/radar.html', { waitUntil:'domcontentloaded' });
await page.waitForTimeout(600);
const hrefMarca = await page.evaluate(() => { const a=document.querySelector('.mc-brand'); return a?a.getAttribute('href'):null; });
ok('en subpagina la marca sigue apuntando a la home', hrefMarca === '/index.html#menu', hrefMarca);
await abrirMenuSiHaceFalta();
await page.click('.mc-brand', { force:true });
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(900);
ok('navego a index', /index\.html$|\/$/.test(new URL(page.url()).pathname), page.url());
ok('con el hash del hub', (await hash())==='#menu', await hash());

// --- CASO 5: Atras del navegador, con historial limpio ---
console.log('\n-- Caso 5: boton Atras --');
await page.goto(BASE + '/index.html', { waitUntil:'domcontentloaded' });
await page.waitForTimeout(500);
await page.evaluate(() => { if (typeof doGuest === 'function') doGuest(); if (typeof showMenu === 'function') showMenu(); });
await page.waitForTimeout(400);
const hA = await histLen();
await page.evaluate(() => showMarket());
await page.waitForTimeout(600);
const hB = await histLen();
ok('ir al buscador AGREGA una entrada al historial (pushState)', hB > hA, hA + ' -> ' + hB);
ok('esta en el buscador', await pantalla()==='marketScreen' && (await hash())==='#market', (await pantalla())+' '+(await hash()));
await page.goBack();
await page.waitForTimeout(900);
ok('Atras vuelve al HUB, no saca del sitio', await pantalla()==='menuScreen' && (await hash())==='#menu',
   (await pantalla())+' '+(await hash())+' url='+page.url());
await page.goForward();
await page.waitForTimeout(900);
ok('Adelante vuelve al buscador', await pantalla()==='marketScreen', (await pantalla())+' '+(await hash()));

// --- EXTRA: resaltado del item activo ---
console.log('\n-- Extra: resaltado del item activo en el nav --');
await page.evaluate(() => showMarket()); await page.waitForTimeout(500);
const act = await page.evaluate(() => { const a=document.querySelector('#mcNav [data-mc-key].active'); return a?a.getAttribute('data-mc-key'):null; });
ok('marca "market" estando en el buscador', act === 'market', String(act));
await page.evaluate(() => showMenu()); await page.waitForTimeout(500);
const act2 = await page.evaluate(() => { const a=document.querySelector('#mcNav [data-mc-key].active'); return a?a.getAttribute('data-mc-key'):null; });
ok('marca "inicio" estando en el hub', act2 === 'inicio', String(act2));

console.log('\n' + (fallos ? '>>> ' + fallos + ' FALLAS en ' + etiqueta : '>>> TODO OK en ' + etiqueta));
await browser.close();
servidor.close();
process.exit(fallos?1:0);
