import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://qglieqpcmmffgxijbysb.supabase.co',
    process.env.SUPABASE_SERVICE_KEY
  );

const ADMIN_KEY = process.env.ADMIN_KEY || 'pf-admin-secret-2024';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
        return res.status(401).json({ error: 'No autorizado' });
  }

  const results = [];

  // Check what columns exist first
  const { data: sample, error: sampleErr } = await supabase
      .from('clientes')
        .select('*')
      .limit(1);

  if (sampleErr) {
        results.push('Error reading table: ' + sampleErr.message);
  } else {
        results.push('Current columns: ' + (sample.length > 0 ? Object.keys(sample[0]).join(', ') : 'empty table'));
  }

  // Run migrations via raw SQL
  const migrations = [
        `ALTER TABLE clientes ADD COLUMN IF NOT EXISTS username TEXT`,
        `ALTER TABLE clientes ADD COLUMN IF NOT EXISTS password_hash TEXT`,
        `ALTER TABLE clientes ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true`,
        `ALTER TABLE clientes ADD COLUMN IF NOT EXISTS meli_connected BOOLEAN DEFAULT false`,
        `ALTER TABLE clientes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
        `ALTER TABLE clientes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      ];

  for (const sql of migrations) {
        const { error } = await supabase.rpc('exec_sql', { sql });
        if (error) {
                // Try using the REST API directly
          results.push('Migration skipped (rpc): ' + sql.substring(0, 60));
        } else {
                results.push('OK: ' + sql.substring(0, 60));
        }
  }

  return res.status(200).json({ results });
}
