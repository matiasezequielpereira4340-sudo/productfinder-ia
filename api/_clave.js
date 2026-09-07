// api/_clave.js
// ------------------------------------------------------------
// Contrasenas
// ------------------------------------------------------------
// Antes se guardaban en texto plano dentro de USERS_DB (una variable de
// entorno de Vercel) y el login comparaba `u.password === password`.
// Cualquiera con acceso al panel de Vercel veia la contrasena de todos los
// usuarios, y como la gente reusa contrasenas el problema se escapaba a
// otros servicios.
//
// Ahora se guarda un hash scrypt con sal unica por usuario. scrypt viene en
// Node, no hace falta instalar nada.
//
// Migracion: los usuarios que ya existen tienen la contrasena en plano. En
// su primer login se compara en plano, se convierte a hash y se guarda. No
// hay que avisarles nada ni resetear a nadie.
// ------------------------------------------------------------

import crypto from 'node:crypto';

const PREFIJO = 'scrypt$';
const LARGO = 64;

// Guardado: scrypt$<sal en hex>$<hash en hex>
export function hashearClave(clave) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(clave), sal, LARGO);
  return PREFIJO + sal.toString('hex') + '$' + hash.toString('hex');
}

export function estaHasheada(guardada) {
  return typeof guardada === 'string' && guardada.indexOf(PREFIJO) === 0;
}

// Compara sin filtrar informacion por cuanto tarda.
function iguales(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Devuelve { ok, necesitaMigrar }.
// necesitaMigrar = entro con una contrasena que todavia estaba en plano.
export function verificarClave(ingresada, guardada) {
  if (!ingresada || !guardada) return { ok: false, necesitaMigrar: false };

  if (!estaHasheada(guardada)) {
    // Usuario viejo: comparacion en plano, y avisamos que hay que convertirlo.
    return { ok: iguales(ingresada, guardada), necesitaMigrar: true };
  }

  const partes = String(guardada).slice(PREFIJO.length).split('$');
  if (partes.length !== 2) return { ok: false, necesitaMigrar: false };
  try {
    const sal = Buffer.from(partes[0], 'hex');
    const esperado = Buffer.from(partes[1], 'hex');
    const calculado = crypto.scryptSync(String(ingresada), sal, esperado.length);
    return { ok: crypto.timingSafeEqual(calculado, esperado), necesitaMigrar: false };
  } catch (e) {
    return { ok: false, necesitaMigrar: false };
  }
}
