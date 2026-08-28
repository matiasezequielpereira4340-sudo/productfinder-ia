// ProductFinder IA - Users Management API (Vercel KV / env-based storage)
const ADMIN_USER = process.env.APP_USER;
const ADMIN_PASS = process.env.APP_PASS;
const ADMIN_KEY = process.env.ADMIN_KEY;

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
        res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-key');
}

export default async function handler(req, res) {
        cors(res);
        if (req.method === 'OPTIONS') return res.status(200).end();

  if (!ADMIN_USER || !ADMIN_PASS || !ADMIN_KEY) return res.status(500).json({ success:false, error:'Servidor mal configurado' });

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
                        meli_connected: false, premium: true,
            };
            const users = [adminEntry, ...stored.map(u => ({
                        id: u.username,
                        username: u.username,
                        email: u.email || u.username,
                        role: 'user',
                        active: u.active !== false,
                        approved: u.approved !== false,
                        pending: u.approved === false,
                        expiryDays: u.expiryDays || null,
                        expired: isExpired(u),
                        createdAt: u.createdAt,
                        expiresAt: (u.createdAt && u.expiryDays) ? new Date(new Date(u.createdAt).getTime() + u.expiryDays*86400000).toISOString() : (u.expiresAt || null),
                        meli_connected: u.meli_connected || false, premium: u.premium || false,
            }))];
            return res.status(200).json({ users });
  }

  // POST - create user
  if (req.method === 'POST') {
            const { username, password, email, days } = req.body;
            const uid = (email || username || '').trim().toLowerCase();
            if (!uid || !password) return res.status(400).json({ error: 'email y password requeridos' });
            const stored = await getUsers();
            if (stored.find(u => (u.username||'').toLowerCase() === uid || (u.email||'').toLowerCase() === uid) || uid === (ADMIN_USER||'').toLowerCase()) {
                        return res.status(409).json({ error: 'El usuario ya existe' });
            }
            const expiryDays = parseInt(days) || 120;
            const createdAt = new Date().toISOString();
            const newUser = { username: uid, email: uid, password, active: true, approved: true, expiryDays, createdAt, premium: (req.body.premium !== false), meli_connected: false };
            stored.push(newUser);
            await persistUsers(stored);
            return res.status(201).json({ user: { id: uid, username: uid, email: uid, active: true, approved: true, expiryDays, createdAt } });
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
            const { active, premium, days, approve } = req.body;
            if (!id) return res.status(400).json({ error: 'id requerido' });
            const stored = await getUsers();
            const user = stored.find(u => u.username === id || u.email === id || u.id === id);
            if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
            if (typeof active !== 'undefined') user.active = active;
      if (typeof premium !== 'undefined') user.premium = !!premium;
            if (typeof days !== 'undefined' && days !== null && days !== '') {
                const nd = parseInt(days);
                if (!isNaN(nd) && nd > 0) {
                    user.expiryDays = nd;
                    if (!user.createdAt) user.createdAt = new Date().toISOString();
                }
            }
            if (approve === true) {
                user.approved = true;
                user.active = true;
                if (!user.createdAt) user.createdAt = new Date().toISOString();
                if (!user.expiryDays) user.expiryDays = 120;
            }
            await persistUsers(stored);
            return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Metodo no permitido' });
}
