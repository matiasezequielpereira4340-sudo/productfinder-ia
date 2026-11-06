// api/_rubros.js
// Los 20 rubros del buscador (aprobados el 5/11/2026) y de que rubros viejos
// sale cada uno. Antes eran 65: muchos se pisaban entre si y el pre-analisis
// nocturno no llegaba a refrescarlos (40 sin cache o vencidos). Los productos
// conservan su rubro de ORIGEN (rubroOrigen): con el se calculan las
// certificaciones (coleccionables y drones no exigen la de juguetes) y el
// derecho de importacion estimado (calzado 35%, textil 26%, etc.).
//
// Las claves nuevas son claves que ya existian: las filas de buscador_cache de
// esos rubros siguen sirviendo.

export const RUBROS = {
  tecnologia:   { label: 'Tecnología / PC', icon: '💻', absorbe: ['tecnologia', 'informatica', 'domotica', 'smartwatch', 'seguridad'] },
  celulares:    { label: 'Celulares / Accesorios', icon: '📱', absorbe: ['celulares'] },
  gaming:       { label: 'Gaming / Audio / Música', icon: '🎮', absorbe: ['gaming', 'audio', 'musica'] },
  hogar:        { label: 'Hogar / Deco', icon: '🏠', absorbe: ['hogar', 'decoracion', 'iluminacion', 'muebles', 'climatizacion'] },
  organizacion: { label: 'Organización / Limpieza', icon: '📦', absorbe: ['organizacion', 'limpieza'] },
  cocina:       { label: 'Cocina / Bazar', icon: '🍳', absorbe: ['cocina', 'bazar', 'reposteria', 'mate'] },
  mascotas:     { label: 'Mascotas', icon: '🐶', absorbe: ['mascotas'] },
  deportes:     { label: 'Deportes / Fitness', icon: '🏋️', absorbe: ['deportes', 'fitness', 'pilates', 'natacion', 'golf', 'bicicletas'] },
  camping:      { label: 'Camping / Pesca / Solar', icon: '🏕️', absorbe: ['camping', 'pesca', 'energiasolar'] },
  automotor:    { label: 'Auto / Moto', icon: '🚗', absorbe: ['automotor', 'motos'] },
  herramientas: { label: 'Herramientas / Ferretería', icon: '🔧', absorbe: ['herramientas', 'ferreteria', 'ferrmanuales', 'pintura'] },
  jardineria:   { label: 'Jardín / Plantas / Campo', icon: '🌱', absorbe: ['jardineria', 'plantas', 'agro'] },
  moda:         { label: 'Moda / Calzado / Viajes', icon: '👕', absorbe: ['moda', 'calzado', 'viajes'] },
  joyeria:      { label: 'Bijou / Relojes', icon: '💍', absorbe: ['joyeria', 'relojes'] },
  belleza:      { label: 'Belleza / Cuidado personal', icon: '💄', absorbe: ['belleza', 'maquillaje', 'cuidadopersonal'] },
  bebes:        { label: 'Bebés / Maternidad', icon: '🍼', absorbe: ['bebes', 'maternidad'] },
  juguetes:     { label: 'Juguetes / Fiestas / Colección', icon: '🧸', absorbe: ['juguetes', 'coleccionables', 'drones', 'festejos'] },
  arte:         { label: 'Arte / Mercería / Tejido', icon: '🎨', absorbe: ['arte', 'textil', 'tejido'] },
  oficina:      { label: 'Oficina / Librería', icon: '📎', absorbe: ['oficina', 'libreria'] },
  fotografia:   { label: 'Foto / Video para creadores', icon: '📷', absorbe: ['fotografia'] }
};

// Rubros eliminados: sus productos salen del pool (aprobado el 5/11/2026).
// Solo queda el mapeo de los links viejos, sin aviso de "aproximado".
export const ELIMINADOS = {
  sexshop: 'belleza', vinos: 'cocina', electrodomesticos: 'cocina', suplementos: 'deportes', ortopedia: 'deportes',
  esoterismo: 'hogar'   // sacado del pool el 6/11/2026
};

// Clave vieja -> clave nueva (absorbidas y eliminadas).
export const ALIAS = (() => {
  const a = {};
  Object.keys(RUBROS).forEach(k => RUBROS[k].absorbe.forEach(v => { a[v] = k; }));
  Object.keys(ELIMINADOS).forEach(v => { a[v] = ELIMINADOS[v]; });
  return a;
})();

export function absorbidos(k) { return (RUBROS[k] && RUBROS[k].absorbe) || [k]; }

// Arma el catalogo de 20 rubros a partir del original de 65: productos de los
// rubros absorbidos, marcados con su rubro de origen.
export function armarCatalogo(original) {
  const out = {};
  Object.keys(RUBROS).forEach(k => {
    const productos = [];
    absorbidos(k).forEach(v => ((original[v] && original[v].productos) || []).forEach(p => productos.push(Object.assign({}, p, { rubroOrigen: v }))));
    out[k] = { label: RUBROS[k].label, icon: RUBROS[k].icon, productos };
  });
  return out;
}
