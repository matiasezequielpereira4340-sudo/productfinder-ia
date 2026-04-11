import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const supabase = createClient(
      'https://qglieqpcmmffgxijbysb.supabase.co',
      process.env.SUPABASE_SERVICE_KEY
    );

const ADMIN_USER = process.env.APP_USER || 'matypereira';
const ADMIN_KEY = process.env.ADMIN_KEY || 'pf-admin-secret-2024';

function cors(res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-key');
}

function isExpired(expiresAt) {
      if (!expiresAt) return false;
      return new Date(expiresAt) < new Date();
}

export default async function handler(req, res) {
      cors(res);
      if (req.method === 'OPTIONS') return res.status(200).end();

  const adminKey = req.headers['x-admin-key'];
      if (adminKey !== ADMIN_KEY) {
              return res.status(401).json({ error: 'No autorizado' });
      }

  // GET - list all users
  if (req.method === 'GET') {
          const { data, error } = await supabase
            .from('clientes')
            .select('id,username,created_at,expires_at,active,meli_connected')
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        const users = data.map(u => ({
                  ...u,
                  role: u.username === ADMIN_USER ? 'admin' : 'user',
                  expired: isExpired(u.expires_at),
                  expiresAt: u.expires_at,
                  createdAt: u.created_at,
        }));

        return res.status(200).json({ users });
  }

  // POST - create user
  if (req.method === 'POST') {
          const { username, password, days } = req.body;
          if (!username || !password) {
                    return res.status(400).json({ error: 'username y password requeridos' });
          }

        const { data: existing } = await supabase
            .from('clientes')
            .select('id')
            .eq('username', username)
            .single();

        if (existing) {
                  return res.status(409).json({ error: 'El usuario ya existe' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + (parseInt(days) || 30));

        const { data, error } = await supabase
            .from('clientes')
            .insert({
                        username,
                        password_hash: passwordHash,
                        expires_at: expiresAt.toISOString(),
                        active: true,
                        meli_connected: false,
            })
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });
          return res.status(201).json({ user: data });
  }

  // DELETE - remove user
  if (req.method === 'DELETE') {
          const { id } = req.query;
          if (!id) return res.status(400).json({ error: 'id requerido' });

        await supabase.from('meli_tokens').delete().eq('user_id', id);
          const { error } = await supabase.from('clientes').delete().eq('id', id);
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ ok: true });
  }

  // PATCH - toggle active
  if (req.method === 'PATCH') {
          const { id } = req.query;
          const { active } = req.body;
          if (!id) return res.status(400).json({ error: 'id requerido' });

        const { error } = await supabase
            .from('clientes')
            .update({ active })
            .eq('id', id);

        if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Metodo no permitido' });
}
