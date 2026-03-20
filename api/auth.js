// ProductFinder IA - Auth + User Management API
// Admin: matypereira (never expires, full access)
// Regular users: expire after N days from activation

const ADMIN_USER = process.env.APP_USER || 'matypereira';
const ADMIN_PASS = process.env.APP_PASS  || 'maty123';
const ADMIN_KEY  = process.env.ADMIN_KEY || 'pf-admin-secret-2024';

function getUsers() {
  try { return process.env.USERS_DB ? JSON.parse(process.env.USERS_DB) : []; }
  catch { return []; }
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

async function persistUsers(users) {
  const token = process.env.VERCEL_TOKEN;
  const pid   = process.env.VERCEL_PROJECT_ID;
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
      body: JSON.stringify({ key: 'USERS_DB', value, type: 'plain', target: ['production','preview','development'] })
    });
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const path = (req.url || '').split('?')[0];

  // POST /api/auth - login
  if (path.endsWith('/auth') && req.method === 'POST') {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ success: false, error: 'Faltan credenciales' });

    if (username === ADMIN_USER && password === ADMIN_PASS)
      return res.status(200).json({ success: true, role: 'admin', user: username });

    const users = getUsers();
    const u = users.find(x => x.username === username && x.password === password);
    if (!u) return res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
    if (!u.active) return res.status(403).json({ success: false, error: 'Usuario desactivado. Contactá al administrador.' });
    if (isExpired(u)) return res.status(403).json({ success: false, error: 'Acceso expirado. Contactá al administrador.' });

    return res.status(200).json({ success: true, role: 'user', user: username, expiryDays: u.expiryDays, createdAt: u.createdAt });
  }

  // GET /api/users - listar usuarios (solo admin)
  if (path.endsWith('/users') && req.method === 'GET') {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'No autorizado' });
    const users = getUsers().map(({ password, ...rest }) => rest);
    return res.status(200).json({ users });
  }

  // POST /api/users - crear usuario (solo admin)
  if (path.endsWith('/users') && req.method === 'POST') {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'No autorizado' });
    const { username, password, expiryDays } = req.body || {};
    if (!username || !password || !expiryDays) return res.status(400).json({ error: 'Faltan campos requeridos' });
    if (username === ADMIN_USER) return res.status(400).json({ error: 'Nombre de usuario reservado' });

    const users = getUsers();
    if (users.find(x => x.username === username)) return res.status(409).json({ error: 'El usuario ya existe' });

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

    const users = getUsers();
    const idx = users.findIndex(x => x.username === username);
    if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (action === 'delete') { users.splice(idx, 1); }
    else { users[idx].active = !users[idx].active; }

    await persistUsers(users);
    return res.status(200).json({ success: true });
  }

  return res.status(404).json({ error: 'Endpoint no encontrado' });
}
