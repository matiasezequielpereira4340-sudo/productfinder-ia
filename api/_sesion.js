// api/_sesion.js
// ------------------------------------------------------------
// Sesion firmada. Antes, "este usuario es cliente" vivia solo en
// localStorage (pf_premium) y /api/analyze devolvia los 12 productos
// a cualquiera: el candado se salteaba desde la consola del navegador.
//
// Ahora, al loguearse, el servidor firma un token con HMAC-SHA256 y una
// clave que solo conoce el servidor. El navegador lo guarda y lo manda en
// cada consulta; el servidor lo verifica y recien ahi decide cuantos
// productos entrega. Sin la clave no se puede fabricar un token valido.
// ------------------------------------------------------------

import crypto from 'node:crypto';

// Duracion del token. Si vence, el front vuelve a pedir login.
const VIDA_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function clave() {
  // SESSION_SECRET es la variable a cargar en Vercel. Si no esta, se usa
  // ADMIN_KEY como respaldo para no romper un deploy existente.
  return process.env.SESSION_SECRET || process.env.ADMIN_KEY || '';
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function desdeB64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function firmar(texto) {
  return b64url(crypto.createHmac('sha256', clave()).update(texto).digest());
}

// Crea el token que viaja al navegador.
export function emitirToken({ user, role, premium }) {
  if (!clave()) return null; // sin secreto no emitimos nada
  const cuerpo = b64url(JSON.stringify({
    u: String(user || ''),
    r: role === 'admin' ? 'admin' : 'user',
    p: !!premium,
    exp: Date.now() + VIDA_MS
  }));
  return cuerpo + '.' + firmar(cuerpo);
}

// Devuelve los datos del token solo si la firma es valida y no vencio.
export function leerToken(token) {
  if (!token || !clave()) return null;
  const partes = String(token).split('.');
  if (partes.length !== 2) return null;
  const [cuerpo, firma] = partes;
  let esperada;
  try { esperada = firmar(cuerpo); } catch (_) { return null; }
  // Comparacion en tiempo constante: no filtra informacion por cuanto tarda.
  const a = Buffer.from(firma), b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let datos;
  try { datos = JSON.parse(desdeB64url(cuerpo).toString('utf8')); } catch (_) { return null; }
  if (!datos || typeof datos.exp !== 'number' || Date.now() > datos.exp) return null;
  return { user: datos.u, role: datos.r, premium: !!datos.p };
}

// Un cliente es el admin o un usuario marcado como premium.
export function esCliente(token) {
  const s = leerToken(token);
  if (!s) return false;
  return s.role === 'admin' || s.premium === true;
}

// Hay una sesion valida (cualquier usuario logueado, no hace falta que sea
// cliente pago). Se usa para proteger los endpoints que consumen creditos
// de servicios externos: sin esto, cualquiera con la URL podia dispararlos.
export function haySesion(token) {
  return leerToken(token) !== null;
}

// Solo el administrador. Para diagnosticos que exponen que variables de
// entorno estan cargadas.
export function esAdmin(token) {
  const s = leerToken(token);
  return !!s && s.role === 'admin';
}

// Respuesta unica para lo que necesita sesion, en criollo.
export function pedirSesion(res, motivo) {
  return res.status(401).json({
    ok: false,
    requiereSesion: true,
    error: motivo || 'Esta consulta necesita que inicies sesion. Es para que nadie de afuera nos gaste los creditos.'
  });
}

// Toma el token del header Authorization o del body, lo que venga.
export function tokenDe(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  if (h && /^Bearer /i.test(h)) return h.replace(/^Bearer /i, '').trim();
  if (req.body && req.body.token) return String(req.body.token);
  return null;
}
