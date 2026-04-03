// ProductFinder IA - Users Management API
// Admin: matypereira (never expires, full access)
// Regular users: expire after N days from activation

const ADMIN_USER = process.env.APP_USER || 'matypereira';
const ADMIN_KEY = process.env.ADMIN_KEY || 'pf-admin-secret-2024';

function getUsers() {
  try { return process.env.USERS_DB ? JSON.parse(process.env.USERS_DB) : []; }
  catch { return []; }
}

function isExpired(u) {
  if (!u.expiryDays || !u.createdAt) return false;
  const expiry = new Date(u.createdAt);
  expiry.setDate(expiry.getDate() + u.expiryDays);
  return new Date() > expiry;
}

async function persistUsers(users, projectId, token) {
  if (!projectId || !token) return false;
  try {
    const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    const envVar = data.envs && data.envs.find(e => e.key === 'USERS_DB');
    const method = envVar ? 'PATCH' : 'POST';
    const url = envVar
      ? `https://api.vercel.com/v10/projects/${projectId}/env/${envVar.id}`
      : `https://api.vercel.com/v10/projects/${projectId}/env`;
    const body = envVar
      ? { value: JSON.stringify(users) }
      : { key: 'USERS_DB', value: JSON.stringify(users), type: 'plain', target: ['production', 'preview', 'development'] };
    await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return true;
  } catch { return false; }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-key');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  const projectId = process.env.VERCEL_PROJECT_ID;
  const token = process.env.VERCEL_TOKEN;
  let users = getUsers();

  // GET /api/users - List all users
  if (req.method === 'GET') {
    const usersWithStatus = [
      { username: ADMIN_USER, role: 'admin', active: true, expiryDays: null, createdAt: null },
      ...users.map(u => ({
        ...u,
        role: 'user',
        expired: isExpired(u),
        expiresAt: u.createdAt && u.expiryDays
          ? (() => { const d = new Date(u.createdAt); d.setDate(d.getDate() + u.expiryDays); return d.toISOString(); })()
          : null
      }))
    ];
    return res.status(200).json({ users: usersWithStatus });
  }

  // POST /api/users - Create new user
  if (req.method === 'POST') {
    const { username, password, expiryDays } = req.body || {};
    if (!username || !password || !expiryDays) {
      return res.status(400).json({ error: 'Usuario, contraseña y días de expiración son requeridos' });
    }
    if (username === ADMIN_USER) {
      return res.status(400).json({ error: 'No podés crear un usuario con ese nombre' });
    }
    if (users.find(u => u.username === username)) {
      return res.status(409).json({ error: 'El usuario ya existe' });
    }
    const newUser = {
      username,
      password,
      expiryDays: parseInt(expiryDays),
      createdAt: new Date().toISOString(),
      active: true
    };
    users.push(newUser);
    const persisted = await persistUsers(users, projectId, token);
    if (!persisted) {
      return res.status(500).json({ error: 'Error al guardar usuario. Verificá que VERCEL_PROJECT_ID y VERCEL_TOKEN estén configurados en las variables de entorno de Vercel.' });
    }
    return res.status(201).json({ success: true, message: 'Usuario creado correctamente' });
  }

  // DELETE /api/users - Toggle or delete user
  if (req.method === 'DELETE') {
    const { username, action, active } = req.body || {};
    if (!username) return res.status(400).json({ error: 'Username requerido' });
    if (username === ADMIN_USER) return res.status(400).json({ error: 'No podés modificar al administrador' });

    const idx = users.findIndex(u => u.username === username);
    if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (action === 'toggle') {
      users[idx].active = active === 'true' || active === true;
      await persistUsers(users, projectId, token);
      return res.status(200).json({ success: true, message: 'Estado actualizado' });
    } else if (action === 'delete') {
      users.splice(idx, 1);
      const persistedDel = await persistUsers(users, projectId, token);
      if (!persistedDel) return res.status(500).json({ error: 'Error al guardar cambios. Verificá variables de entorno de Vercel.' });
      return res.status(200).json({ success: true, message: 'Usuario eliminado' });
    }
    return res.status(400).json({ error: 'Acción inválida' });
  }

  return res.status(405).json({ error: 'Método no permitido' });
  }
