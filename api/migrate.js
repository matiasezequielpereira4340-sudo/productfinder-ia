const ADMIN_KEY = process.env.ADMIN_KEY || 'pf-admin-secret-2024';
const SUPABASE_URL = 'https://qglieqpcmmffgxijbysb.supabase.co';

export default async function handler(req, res) {
      res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
          return res.status(401).json({ error: 'No autorizado' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
      const results = [];

  // Use Supabase Management API to run SQL
  // First, drop and recreate the clientes table with correct schema
  const sql = `
      DROP TABLE IF EXISTS clientes CASCADE;
          CREATE TABLE clientes (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                      username TEXT UNIQUE NOT NULL,
                            password_hash TEXT NOT NULL,
                                  active BOOLEAN DEFAULT true,
                                        meli_connected BOOLEAN DEFAULT false,
                                              expires_at TIMESTAMPTZ,
                                                    created_at TIMESTAMPTZ DEFAULT NOW()
                                                        );
                                                            CREATE INDEX IF NOT EXISTS idx_clientes_username ON clientes(username);
                                                                ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
                                                                    CREATE POLICY "service_role_all" ON clientes FOR ALL USING (true);
                                                                      `;

  // Use the pg REST endpoint
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/query`, {
          method: 'POST',
          headers: {
                    'Content-Type': 'application/json',
                    'apikey': serviceKey,
                    'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ query: sql }),
  });

  const text = await resp.text();
      results.push(`Status: ${resp.status}, Body: ${text.substring(0, 200)}`);

  // Try alternative: use the SQL endpoint directly
  const resp2 = await fetch(`${SUPABASE_URL}/pg/query`, {
          method: 'POST',
          headers: {
                    'Content-Type': 'application/json',
                    'apikey': serviceKey,
                    'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ query: sql }),
  });

  const text2 = await resp2.text();
      results.push(`Alt Status: ${resp2.status}, Body: ${text2.substring(0, 200)}`);

  return res.status(200).json({ results });
}
