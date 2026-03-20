// ProductFinder IA - Auth endpoint
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const { username, password } = req.body;
  const validUser = process.env.APP_USER || 'matypereira';
  const validPass = process.env.APP_PASS || 'maty123';

  if (username === validUser && password === validPass) {
    return res.status(200).json({success: true, user: username});
  }
  return res.status(401).json({success: false, error: 'Credenciales incorrectas'});
}
