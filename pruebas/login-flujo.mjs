// pruebas/login-flujo.mjs
// Se corre con: npm run test:login
//
// El loop del Analizador: login.html no guardaba pf_token, el Analizador
// mandaba a login.html, la persona entraba, volvia y le pedia sesion otra vez.
// Esta prueba levanta las paginas REALES en un Chromium, con /api/* simulado,
// y recorre los caminos: login con ?next=, sesion vieja, vuelta despues de
// conectar MeLi, destinos externos rechazados y logout completo.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function cargarChromium() {
  try { return (await import('playwright-core')).chromium; } catch (_) {}
  try { return (await import('playwright')).chromium; } catch (_) {}
  // Instalacion global (como en el entorno de Claude Code).
  const raiz = execSync('npm root -g').toString().trim();
  return createRequire(path.join(raiz, 'x.js'))('playwright').chromium;
}
const chromium = await cargarChromium();

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = Number(process.env.PUERTO || 4320);
const BASE = 'http://127.0.0.1:' + PUERTO;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon' };
const servidor = http.createServer((req, res) => {
  let ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (ruta === '/') ruta = '/index.html';
  const f = path.join(RAIZ, path.normalize(ruta).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => servidor.listen(PUERTO, '127.0.0.1', r));

const exe = process.env.PLAYWRIGHT_CHROMIUM ||
  (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });

let fallas = 0, pasadas = 0;
function check(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ok    ' + nombre); }
  else { fallas++; console.log('  FALLA ' + nombre + (extra !== undefined ? '\n        ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

// Contexto nuevo por caso: localStorage limpio. `storage` se carga antes de
// que corra cualquier script de la pagina.
async function nuevaPagina(storage, apis) {
  const ctx = await browser.newContext();
  if (storage) {
    await ctx.addInitScript(s => {
      if (sessionStorage.getItem('__sembrado')) return;
      sessionStorage.setItem('__sembrado', '1');
      Object.keys(s).forEach(k => localStorage.setItem(k, s[k]));
    }, storage);
  }
  await ctx.route('**/*', ruta => {
    const u = new URL(ruta.request().url());
    if (u.origin !== BASE) return ruta.abort();   // fuentes, insights, etc.
    if (u.pathname.startsWith('/api/')) {
      const r = (apis && apis(u, ruta.request())) || { status: 404, body: { error: 'no simulado' } };
      return ruta.fulfill({ status: r.status || 200, contentType: 'application/json', body: JSON.stringify(r.body) });
    }
    return ruta.continue();
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => { fallas++; console.log('  [JS ERROR] ' + e.message); });
  return { ctx, page };
}
const ls = (page, k) => page.evaluate(k => localStorage.getItem(k), k);
async function esperarRuta(page, ruta, ms) {
  try { await page.waitForURL(u => new URL(u).pathname === ruta, { timeout: ms || 4000 }); return true; }
  catch (_) { return false; }
}
const authOk = { status: 200, body: { success: true, role: 'user', user: 'juan', premium: false, token: 'TOKEN_FIRMADO', expiryDays: 30, createdAt: new Date().toISOString() } };
const apisBase = (extra) => (u, req) => {
  if (u.pathname === '/api/auth') return authOk;
  if (u.pathname === '/api/meli-check') return { body: { connected: true } };
  return extra ? extra(u, req) : null;
};

async function loguear(page) {
  await page.fill('#user', 'juan');
  await page.fill('#pass', 'secreto');
  await page.click('#loginBtn');
}

console.log('Login');
{
  const { ctx, page } = await nuevaPagina(null, apisBase());
  await page.goto(BASE + '/login.html?next=analizador');
  await loguear(page);
  check('login con ?next=analizador vuelve a /analizador.html', await esperarRuta(page, '/analizador.html'), page.url());
  check('login guarda pf_token', await ls(page, 'pf_token') === 'TOKEN_FIRMADO');
  check('login guarda pf_premium', await ls(page, 'pf_premium') === '0');
  await page.waitForTimeout(300);
  check('de vuelta en el Analizador ya NO pide iniciar sesion', !(await page.isVisible('#avisoCuenta')),
    await page.textContent('#avisoCuenta'));
  await ctx.close();
}
{
  const { ctx, page } = await nuevaPagina(null, (u) => u.pathname === '/api/auth'
    ? { body: { success: true, role: 'user', premium: false } } : { body: { connected: true } });
  await page.goto(BASE + '/login.html?next=analizador');
  await page.evaluate(() => localStorage.setItem('pf_token', 'viejo'));
  await loguear(page);
  await esperarRuta(page, '/analizador.html');
  check('si el login no trae token, se borra el pf_token viejo', await ls(page, 'pf_token') === null);
  await ctx.close();
}
{
  const { ctx, page } = await nuevaPagina({ pf_user: 'juan', pf_role: 'user' }, apisBase());
  await page.goto(BASE + '/login.html?next=analizador');
  await page.waitForTimeout(500);
  check('sesion vieja (pf_user sin pf_token): login.html NO la saca de la pagina', new URL(page.url()).pathname === '/login.html', page.url());
  check('sesion vieja: el usuario queda precargado', await page.inputValue('#user') === 'juan');
  await ctx.close();
}
{
  const { ctx, page } = await nuevaPagina({ pf_user: 'juan', pf_role: 'user', pf_token: 'T' }, apisBase());
  await page.goto(BASE + '/login.html?next=analizador');
  check('ya logueado con token + ?next=analizador -> directo al Analizador', await esperarRuta(page, '/analizador.html'), page.url());
  await ctx.close();
}
for (const malo of ['https://evil.example', '//evil.example', '/analizador.html', 'javascript:alert(1)']) {
  const { ctx, page } = await nuevaPagina(null, apisBase());
  await page.goto(BASE + '/login.html?next=' + encodeURIComponent(malo));
  await loguear(page);
  const llego = await esperarRuta(page, '/dashboard.html');
  check('?next=' + malo + ' se ignora (va al destino normal, no afuera)', llego && new URL(page.url()).origin === BASE, page.url());
  await ctx.close();
}

console.log('Analizador');
{
  const { ctx, page } = await nuevaPagina({ pf_user: 'juan', pf_role: 'user' });
  await page.goto(BASE + '/analizador.html');
  const txt = await page.textContent('#avisoCuenta');
  check('sesion vieja -> aviso "de antes de una actualizacion"', /antes de una actualizaci/i.test(txt), txt);
  check('sesion vieja -> boton a login.html?next=analizador',
    await page.getAttribute('#avisoCuenta a', 'href') === 'login.html?next=analizador');
  await ctx.close();
}
{
  const { ctx, page } = await nuevaPagina(null);
  await page.goto(BASE + '/analizador.html');
  const txt = await page.textContent('#avisoCuenta');
  check('sin usuario -> "Primero inicia sesion"', /Primero inici/i.test(txt), txt);
  check('sin usuario -> boton a login.html?next=analizador',
    await page.getAttribute('#avisoCuenta a', 'href') === 'login.html?next=analizador');
  await ctx.close();
}
{
  const { ctx, page } = await nuevaPagina({ pf_user: 'invitado', pf_role: 'guest' });
  await page.goto(BASE + '/analizador.html');
  check('invitado -> aviso generico, no el de sesion vieja', /Primero inici/i.test(await page.textContent('#avisoCuenta')));
  await ctx.close();
}
{
  let authHeader = null;
  const { ctx, page } = await nuevaPagina({ pf_user: 'juan', pf_role: 'user', pf_token: 'T1' }, (u, req) => {
    if (u.pathname === '/api/herramientas') { authHeader = req.headers()['authorization']; return { status: 401, body: { ok: false, codigo: 'sin_meli', error: 'x' } }; }
    return null;
  });
  await page.goto(BASE + '/analizador.html');
  await page.fill('#url', 'https://articulo.mercadolibre.com.ar/MLA-123456789');
  await page.click('#go');
  await page.waitForSelector('#avisoCuenta.on');
  check('analizar manda Authorization: Bearer <pf_token>', authHeader === 'Bearer T1', authHeader);
  check('sin_meli -> boton a meli-connect.html?next=analizador',
    await page.getAttribute('#avisoCuenta a', 'href') === 'meli-connect.html?next=analizador');
  await ctx.close();
}
{
  const { ctx, page } = await nuevaPagina({ pf_user: 'juan', pf_role: 'user', pf_token: 'VENCIDO' }, (u) =>
    u.pathname === '/api/herramientas' ? { status: 401, body: { ok: false, codigo: 'sin_sesion', error: 'x' } } : null);
  await page.goto(BASE + '/analizador.html');
  await page.fill('#url', 'https://articulo.mercadolibre.com.ar/MLA-123456789');
  await page.click('#go');
  await page.waitForSelector('#avisoCuenta.on');
  check('token rechazado por el servidor -> "Tu sesion vencio" y se borra', /venci/i.test(await page.textContent('#avisoCuenta')) && await ls(page, 'pf_token') === null);
  await ctx.close();
}

console.log('Vuelta despues de conectar MeLi');
{
  const { ctx, page } = await nuevaPagina({ pf_user: 'juan', pf_role: 'user', pf_token: 'T' });
  await page.goto(BASE + '/meli-connect.html?next=analizador');
  check('meli-connect?next=analizador guarda el destino', /analizador/.test(await ls(page, 'pf_volver') || ''));
  await page.goto(BASE + '/meli-connect.html?success=1&meli_user=123');
  check('OAuth ok -> vuelve solo a /analizador.html', await esperarRuta(page, '/analizador.html', 5000), page.url());
  check('el destino se consume (no vuelve a redirigir la proxima)', await ls(page, 'pf_volver') === null);
  await ctx.close();
}
{
  const { ctx, page } = await nuevaPagina({ pf_user: 'juan', pf_role: 'user', pf_token: 'T' });
  await page.goto(BASE + '/meli-connect.html?next=' + encodeURIComponent('https://evil.example'));
  check('meli-connect?next=<externo> no se guarda', await ls(page, 'pf_volver') === null);
  await page.evaluate(() => localStorage.setItem('pf_volver', JSON.stringify({ d: 'https://evil.example', t: Date.now() })));
  await page.goto(BASE + '/meli-connect.html?success=1&meli_user=123');
  await page.waitForTimeout(2500);
  check('pf_volver manipulado con URL externa -> se queda en meli-connect', new URL(page.url()).pathname === '/meli-connect.html', page.url());
  await ctx.close();
}
{
  const { ctx, page } = await nuevaPagina({ pf_user: 'juan', pf_role: 'user', pf_token: 'T',
    pf_volver: JSON.stringify({ d: 'analizador', t: Date.now() - 2 * 3600 * 1000 }) });
  await page.goto(BASE + '/meli-connect.html?success=1&meli_user=123');
  await page.waitForTimeout(2500);
  check('destino vencido (2 h) -> no redirige', new URL(page.url()).pathname === '/meli-connect.html', page.url());
  await ctx.close();
}
{
  const { ctx, page } = await nuevaPagina({ pf_user: 'juan', pf_role: 'user' });
  await page.goto(BASE + '/meli-connect.html');
  const btn = await page.$('[onclick*="startAuth"], form[onsubmit*="startAuth"] button, #connectBtn');
  if (btn) {
    await btn.click();
    check('conectar MeLi con sesion vieja -> pide volver a entrar', await esperarRuta(page, '/login.html'), page.url());
  } else {
    check('conectar MeLi: se encontro el boton de startAuth', false);
  }
  await ctx.close();
}

console.log('Logout');
{
  // Cada bloque de logout del repo tiene que borrar pf_token y pf_premium.
  const archivos = fs.readdirSync(RAIZ).filter(f => /\.(html|js)$/.test(f));
  const listas = [];
  for (const f of archivos) {
    const src = fs.readFileSync(path.join(RAIZ, f), 'utf8');
    for (const m of src.matchAll(/\[[^\]]*['"]pf_user['"][^\]]*\]\.forEach/g)) listas.push({ f, s: m[0] });
  }
  const malas = listas.filter(x => !/pf_token/.test(x.s) || !/pf_premium/.test(x.s));
  check('las ' + listas.length + ' listas de logout borran pf_token y pf_premium', listas.length >= 8 && malas.length === 0, malas);
  const app = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8');
  const doLogout = app.slice(app.indexOf('function doLogout'), app.indexOf('function doLogout') + 600);
  check('app.js doLogout borra pf_token y pf_premium', /removeItem\('pf_token'\)/.test(doLogout) && /removeItem\('pf_premium'\)/.test(doLogout));
}
{
  const { ctx, page } = await nuevaPagina({ pf_user: 'juan', pf_role: 'user', pf_token: 'T', pf_premium: '1', pf_expiry: 'x' });
  await page.goto(BASE + '/analizador.html');
  await page.waitForTimeout(600);
  const boton = await page.$('#mcLogout:visible, .mc-logout:visible, [data-mc-logout]:visible');
  if (boton) {
    await boton.click();
    await page.waitForTimeout(400);
    const quedan = await page.evaluate(() => ['pf_user', 'pf_role', 'pf_expiry', 'pf_token', 'pf_premium'].filter(k => localStorage.getItem(k) !== null));
    check('logout desde el header del Analizador borra todo', quedan.length === 0, quedan);
  } else {
    console.log('  (sin boton de logout visible en el header; se cubre con el chequeo de codigo de arriba)');
  }
  await ctx.close();
}

await browser.close();
servidor.close();
console.log('\n' + pasadas + ' ok, ' + fallas + ' fallas');
process.exit(fallas ? 1 : 0);
