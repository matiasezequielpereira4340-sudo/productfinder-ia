// ProductFinder IA - Users Management API (Vercel KV / env-based storage)
const ADMIN_USER = process.env.APP_USER || 'matypereira';
const ADMIN_PASS = process.env.APP_PASS || 'maty123';
const ADMIN_KEY = process.env.ADMIN_KEY || 'pf-admin-secret-2024';

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
                  if (!res.ok) return process.env.USERS_DB ? JSON.parse(process.env.USERS_DB) : [];
                  const data = await res.json();
                  const envVar = data.envs?.find(e => e.key === 'USERS_DB');
                  if (!envVar) return [];
                  const valRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env/${envVar.id}`, {
                              headers: { Authorization: `Bearer ${token}` }
                  });
                  if (!valRes.ok) return [];
                  const valData = await valRes.json();
                  return valData.value ? JSON.parse(valData.value) : [];
        } catch { return []; }
}

async function persistUsers(users) {
        const token = process.env.VERCEL_TOKEN;
        const projectId = process.env.VERCEL_PROJECT_ID;
        if (!token || !projectId) throw new Error('VERCEL_TOKEN/VERCEL_PROJECT_ID not set');
        const serialized = JSON.stringify(users);
        const listRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
                  headers: { Authorization: `Bearer ${token}` }
        });
        const listData = await listRes.json();
        const existing = listData.envs?.find(e => e.key === 'USERS_DB');
        if (existing) {
                  await fetch(`https://api.vercel.com/v10/projects/${projectId}/env/${existing.id}`, {
                              method: 'PATCH',
                              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                              body: JSON.stringify({ value: serialized })
                  });
        } else {
                  await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
                              method: 'POST',
                              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                              body: JSON.stringify({ key: 'USERS_DB', value: serialized, type: 'encrypted', target: ['production', 'preview'] })
                  });
        }
}

function isExpired(u) {
        if (!u.expiresAt) return false;
        return new Date(u.expiresAt) < new Date();
}

function cors(res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-key');
}

export default async function handler(req, res) {
        cors(res);
        if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
            return res.status(401).json({ error: 'No autorizado' });
  }

  // GET - list users
  if (req.method === 'GET') {
            const stored = await getUsers();
            const adminEntry = {
                        id: 'admin',
                        username: ADMIN_USER,
                        role: 'admin',
                        active: true,
                        expired: false,
                        createdAt: null,
                        expiresAt: null,
                        meli_connected: false,
            };
            const users = [adminEntry, ...stored.map(u => ({
                        id: u.username,
                        username: u.username,
                        role: 'user',
                        active: u.active !== false,
                        expired: isExpired(u),
                        createdAt: u.createdAt,
                        expiresAt: u.expiresAt,
                        meli_connected: u.meli_connected || false,
            }))];
            return res.status(200).json({ users });
  }

  // POST - create user
  if (req.method === 'POST') {
            const { username, password, days } = req.body;
            if (!username || !password) return res.status(400).json({ error: 'username y password requeridos' });
            const stored = await getUsers();
            if (stored.find(u => u.username === username) || username === ADMIN_USER) {
                        return res.status(409).json({ error: 'El usuario ya existe' });
            }
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + (parseInt(days) || 30));
            const newUser = { username, password, active: true, createdAt: new Date().toISOString(), expiresAt: expiresAt.toISOString(), meli_connected: false };
            stored.push(newUser);
            await persistUsers(stored);
            return res.status(201).json({ user: { id: username, username, active: true, expiresAt: newUser.expiresAt, createdAt: newUser.createdAt } });
  }

  // DELETE - remove user by id (username)
  if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'id requerido' });
            const stored = await getUsers();
            const filtered = stored.filter(u => u.username !== id);
            if (filtered.length === stored.length) return res.status(404).json({ error: 'Usuario no encontrado' });
            await persistUsers(filtered);
            return res.status(200).json({ ok: true });
  }

  // PATCH - toggle active
  if (req.method === 'PATCH') {
            const { id } = req.query;
            const { active } = req.body;
            if (!id) return res.status(400).json({ error: 'id requerido' });
            const stored = await getUsers();
            const user = stored.find(u => u.username === id);
            if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
            user.active = active;
            await persistUsers(stored);
            return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Metodo no permitido' });
}
