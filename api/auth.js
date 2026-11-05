// ProductFinder IA - Auth API
import { emitirToken, estadoSesion, renovarSiHaceFalta, tokenDe, usuarioEsAdmin } from './_sesion.js';
import { hashearClave, verificarClave } from './_clave.js';
// Admin: matypereira (never expires, full access)
// Regular users: expire after N days from activation

const ADMIN_USER = process.env.APP_USER;
const ADMIN_PASS = process.env.APP_PASS;
const ADMIN_KEY = process.env.ADMIN_KEY;

// Lee usuarios en tiempo real desde la Vercel API (evita el cache de process.env)
async function getUsers() {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    try { return process.env.USERS_DB ? JSON.parse(process.env.USERS_DB) : []; }
    catch { return []; }
  }
  try {
    const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    const envVar = (data.envs || []).find(e => e.key === 'USERS_DB');
    if (!envVar) return [];
    const valRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env/${envVar.id}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const valData = await valRes.json();
    return valData.value ? JSON.parse(valData.value) : [];
  } catch {
    try { return process.env.USERS_DB ? JSON.parse(process.env.USERS_DB) : []; }
    catch { return []; }
  }
}

function isExpired(u) {
  if (!u.expiryDays || !u.createdAt) return false;
  return Date.now() > new Date(u.createdAt).getTime() + u.expiryDays * 86400000;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-key,Authorization');
}

async function persistUsers(users) {
  const token = process.env.VERCEL_TOKEN;
  const pid = process.env.VERCEL_PROJECT_ID;
  if (!token || !pid) return;
  const base = 'https://api.vercel.com/v10/projects/' + pid + '/env';
  const list = await fetch(base, { headers: { Authorization: 'Bearer ' + token } });
  const data = await list.json();
  const existing = (data.envs || []).find(e => e.key === 'USERS_DB');
  const value = JSON.stringify(users);
  if (existing) {
    await fetch(base + '/' + existing.id, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
    });
  } else {
    await fetch(base, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'USERS_DB', value, type: 'plain', target: ['production', 'preview', 'development'] })
    });
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /api/auth?sesion=1 - el front valida pf_token al arrancar. Va antes del
  // chequeo de configuracion: solo necesita la clave de firma, no ADMIN_KEY. Devuelve el
  // estado real de la sesion y, si le queda poco, un token renovado.
  if ((req.url || '').split('?')[0].endsWith('/auth') && req.method === 'GET' && /[?&]sesion=1/.test(req.url || '')) {
    res.setHeader('Cache-Control', 'no-store');
    const t = tokenDe(req);
    const e = estadoSesion(t);
    if (e.estado === 'valida') { const n = renovarSiHaceFalta(t); if (n) e.tokenRenovado = n; }
    return res.status(200).json(e);
  }

  // El login solo necesita APP_USER/APP_PASS (y la clave de firma de sesiones).
  // Antes tambien exigia ADMIN_KEY, asi que en un entorno sin ADMIN_KEY (los
  // previews) no entraba nadie. Las rutas que administran usuarios SI la exigen
  // aparte: sin ADMIN_KEY, "header !== ADMIN_KEY" daria undefined !== undefined
  // = false y quedarian abiertas.
  if (!ADMIN_USER || !ADMIN_PASS) return res.status(500).json({ success:false, error:'Servidor mal configurado' });

  const path = (req.url || '').split('?')[0];
  const esLogin = path.endsWith('/auth') && req.method === 'POST';
  if (!esLogin && !ADMIN_KEY) return res.status(500).json({ success:false, error:'Servidor mal configurado' });

  // POST /api/auth - login
  if (path.endsWith('/auth') && req.method === 'POST') {
    const { username, password, email, action } = req.body || {};
    if (action !== 'register' && (!username || !password)) return res.status(400).json({ success: false, error: 'Faltan credenciales' });

    // --- REGISTRO PUBLICO (self-service, queda pendiente de aprobacion) ---
    if (action === 'register') {
      const em = (email || username || '').trim().toLowerCase();
      if (!em || !password) return res.status(400).json({ success: false, error: 'Falta email o contrasena' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return res.status(400).json({ success: false, error: 'Email invalido' });
      if (password.length < 6) return res.status(400).json({ success: false, error: 'La contrasena debe tener al menos 6 caracteres' });
      const usersR = await getUsers();
      if (usersR.find(u => (u.email||'').toLowerCase() === em || (u.username||'').toLowerCase() === em)) {
        return res.status(409).json({ success: false, error: 'Ya existe una cuenta con ese email' });
      }
      usersR.push({ username: em, email: em, password: hashearClave(password), expiryDays: 120, createdAt: null, active: false, approved: false, premium: false, requestedAt: new Date().toISOString() });
      await persistUsers(usersR);
      return res.status(201).json({ success: true, pending: true, message: 'Cuenta creada. Queda pendiente de aprobacion del administrador.' });
    }

    // Usuario de admin sin distinguir mayusculas ni espacios (la contraseña si, exacta).
    const esUserAdmin = ADMIN_USER && String(username || '').trim().toLowerCase() === String(ADMIN_USER).trim().toLowerCase();
    if (esUserAdmin && password === ADMIN_PASS) {
      const tk = emitirToken({ user: String(username).trim(), role: 'admin', premium: true });
      return res.status(200).json({ success: true, role: 'admin', user: String(username).trim(),
          premium: true, token: tk,
          // Sin clave de firma en este entorno no hay sesion para el servidor:
          // se avisa en vez de dejar entrar con un "admin" que nadie reconoce.
          aviso: tk ? undefined : 'Este entorno no tiene clave de firma de sesiones (SESSION_SECRET o ADMIN_KEY): el servidor no te va a reconocer como admin.' });
    }

    const users = await getUsers();
    const loginId = (username || email || '').trim().toLowerCase();
    const user = users.find(u => ((u.email||'').toLowerCase() === loginId || (u.username||'').toLowerCase() === loginId));
    const chequeo = user ? verificarClave(password, user.password) : { ok: false, necesitaMigrar: false };
    if (user && chequeo.ok && chequeo.necesitaMigrar) {
      // Entro con una contrasena que todavia estaba en plano: la convertimos
      // ahora y la guardamos hasheada. El usuario no se entera de nada.
      try {
        user.password = hashearClave(password);
        await persistUsers(users);
      } catch (e) { /* si falla el guardado, el login sigue valiendo */ }
    }
    if (!chequeo.ok) return res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
    if (!user) return res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
    if (user.approved === false) return res.status(403).json({ success: false, error: 'Tu cuenta esta pendiente de aprobacion. El administrador te habilitara pronto.' });
    if (!user.active) return res.status(403).json({ success: false, error: 'Usuario desactivado. Contactá al administrador.' });
    if (isExpired(user)) return res.status(403).json({ success: false, error: 'Acceso expirado. Contactá al administrador.' });

    // Un usuario de la lista que figura como admin (ADMIN_USERS / dueño de MeLi) entra como admin.
    if (usuarioEsAdmin(username)) {
      return res.status(200).json({ success: true, role: 'admin', user: username, premium: true,
        token: emitirToken({ user: username, role: 'admin', premium: true }) });
    }
    return res.status(200).json({
        success: true, role: 'user', user: username, premium: !!user.premium,
        expiryDays: user.expiryDays, createdAt: user.createdAt,
        token: emitirToken({ user: username, role: 'user', premium: !!user.premium })
    });
  }

  // GET /api/users - listar usuarios (solo admin)
  if (path.endsWith('/users') && req.method === 'GET') {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'No autorizado' });
    const users = await getUsers();
    return res.status(200).json({ users: users.map(({ password, ...rest }) => rest) });
  }

  // POST /api/users - crear usuario (solo admin)
  if (path.endsWith('/users') && req.method === 'POST') {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'No autorizado' });
    const { username, password, expiryDays } = req.body || {};
    if (!username || !password || !expiryDays) return res.status(400).json({ error: 'Faltan campos requeridos' });
    if (username === ADMIN_USER) return res.status(400).json({ error: 'Nombre de usuario reservado' });
    const users = await getUsers();
    if (users.find(u => u.username === username)) return res.status(409).json({ error: 'El usuario ya existe' });
    const newUser = { username, password, expiryDays: parseInt(expiryDays), createdAt: new Date().toISOString(), active: true };
    users.push(newUser);
    await persistUsers(users);
    return res.status(201).json({ success: true, user: { ...newUser, password: '***' } });
  }

  // DELETE /api/users - desactivar o eliminar (solo admin)
  if (path.endsWith('/users') && req.method === 'DELETE') {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'No autorizado' });
    const { username, action } = req.body || {};
    if (!username) return res.status(400).json({ error: 'username requerido' });
    const users = await getUsers();
    const idx = users.findIndex(u => u.username === username);
    if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (action === 'delete') {
      users.splice(idx, 1);
    } else {
      users[idx].active = !users[idx].active;
    }
    await persistUsers(users);
    return res.status(200).json({ success: true });
  }

  return res.status(404).json({ error: 'Endpoint no encontrado' });
}
