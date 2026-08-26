// ProductFinder IA - Auth API
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-key');
}

// Devuelve true si puede seguir; si ADMIN_KEY no esta configurada o no coincide, ya respondio.
function checkAdminKey(req, res) {
    if (!ADMIN_KEY) {
        console.error('[api/auth] Falta configurar ADMIN_KEY en las variables de entorno');
        res.status(500).json({ error: 'Configuración incompleta' });
        return false;
    }
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
        res.status(401).json({ error: 'No autorizado' });
        return false;
    }
    return true;
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

  const path = (req.url || '').split('?')[0];

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
        usersR.push({ username: em, email: em, password, expiryDays: 120, createdAt: null, active: false, approved: false, premium: false, requestedAt: new Date().toISOString() });
        await persistUsers(usersR);
        return res.status(201).json({ success: true, pending: true, message: 'Cuenta creada. Queda pendiente de aprobacion del administrador.' });
      }

      if (!ADMIN_USER || !ADMIN_PASS) {
        console.error('[api/auth] Falta configurar APP_USER y/o APP_PASS en las variables de entorno');
        return res.status(500).json({ success: false, error: 'Configuración incompleta' });
      }

      if (username === ADMIN_USER && password === ADMIN_PASS) {
              return res.status(200).json({ success: true, role: 'admin', user: username });
      }

      const users = await getUsers();
        const loginId = (username || email || '').trim().toLowerCase();
      const user = users.find(u => ((u.email||'').toLowerCase() === loginId || (u.username||'').toLowerCase() === loginId) && u.password === password);
        if (!user) return res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
        if (user.approved === false) return res.status(403).json({ success: false, error: 'Tu cuenta esta pendiente de aprobacion. El administrador te habilitara pronto.' });
      if (!user.active) return res.status(403).json({ success: false, error: 'Usuario desactivado. ContactÃÂ¡ al administrador.' });
        if (isExpired(user)) return res.status(403).json({ success: false, error: 'Acceso expirado. ContactÃÂ¡ al administrador.' });

      return res.status(200).json({
              success: true, role: 'user', user: username, premium: !!user.premium,
              expiryDays: user.expiryDays, createdAt: user.createdAt
      });
  }

  // GET /api/users - listar usuarios (solo admin)
  if (path.endsWith('/users') && req.method === 'GET') {
        if (!checkAdminKey(req, res)) return;
        const users = await getUsers();
        return res.status(200).json({ users: users.map(({ password, ...rest }) => rest) });
  }

  // POST /api/users - crear usuario (solo admin)
  if (path.endsWith('/users') && req.method === 'POST') {
        if (!checkAdminKey(req, res)) return;
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
        if (!checkAdminKey(req, res)) return;
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
