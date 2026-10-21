// ============================================================
// ProductFinder IA - /api/analyze (v2 datos reales de MercadoLibre)
// AUTH y CHAT se mantienen intactos. El bloque ANALYZE ahora
// recomienda productos del catalogo curado y trae precios y
// competencia REALES desde la API oficial de MeLi (token OAuth
// del usuario en Supabase). Si no hay token vigente, marca los
// datos como estimados y nunca inventa precios reales.
// ============================================================

import { resolveUserId, anthropicHeaders } from './_meli.js';
import { esCliente, tokenDe, leerToken, esAdmin, cronAdmitido } from './_sesion.js';
import { cotizacionDolar, tipoDeCambio, DOLAR_TIPO_DEFAULT } from './_dolar.js';
import { resolverCategoria } from './_categorias.js';
import { CATEGORIAS } from './_categorias-datos.js';
import { evaluarProducto, ordenar, CAPITAL_LABEL, estadisticasCompetencia, limpiarMuestra, puntajeDemanda, puntajeSaturacion, costoImportacion, acotarPorCosto } from './_oportunidad.js';
import { cosechar, encolar, arrancarCola, historialDe, ITEMS_POR_PRODUCTO, estadoPresupuesto } from './_rotacion.js';
import { probarEndpoints, tokenDeCorridaValido, MELI_USER_PRECALCULO, crearCliente, analizarNicho, VERSION_MERCADO } from './_precalculo.js';

const USD_ARS_FALLBACK = 1510;
const MELI_API_BUSCADOR = 'https://api.mercadolibre.com';
const LIMITE_GRATIS = 3;

// El costo puesto, el margen, el score y el veredicto ahora salen de
// _oportunidad.js (y el margen, de margen-core.js, el mismo de MargenClear).
const SUPA_URL = process.env.SUPABASE_URL || 'https://qglieqpcmmffgxijbysb.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const CATALOGO = {
  tecnologia: { label: 'Tecnología / Gadgets', icon: '💻', productos: [
    { nombre:'Soporte magnético para cable bajo escritorio (clip)', q:'clip organizador cable bajo escritorio', keyword_en:'under desk cable management clip', volCm3:150, costoMin:0.4, costoMax:1.1, pesoG:30, nota:'Nicho oficina en casa' },
    { nombre:'Soporte para tablet ajustable de escritorio', q:'soporte tablet escritorio ajustable', keyword_en:'adjustable desktop tablet stand', volCm3:1200, costoMin:1.2, costoMax:3, pesoG:130, nota:'Menos saturado que celular' },
    { nombre:'Lector microSD USB-C a tipo C rapido', q:'lector microsd usb c tipo c', keyword_en:'usb c micro sd card reader', volCm3:60, costoMin:0.8, costoMax:2, pesoG:15, nota:'Diminuto, recompra' },
    { nombre:'Aro de luz para celular con clip (mini)', q:'aro luz celular clip', keyword_en:'clip on phone ring light', volCm3:350, costoMin:1.2, costoMax:3, pesoG:60, nota:'Tendencia contenido' },
    { nombre:'Soporte colgante para auriculares bajo escritorio', q:'soporte auricular gancho bajo escritorio', keyword_en:'under desk headphone hook holder', volCm3:500, costoMin:1, costoMax:2.5, pesoG:70, nota:'Gamer setup' },
    { nombre:'Grip anillo adhesivo para celular', q:'soporte anillo celular adhesivo', keyword_en:'phone ring holder grip', volCm3:60, costoMin:0.2, costoMax:0.7, pesoG:20, nota:'Barato, recompra' },
    { nombre:'Limpiador de teclado gel reutilizable', q:'gel limpiador teclado reutilizable', keyword_en:'reusable keyboard cleaning gel', volCm3:300, costoMin:0.5, costoMax:1.5, pesoG:60, nota:'Consumible, recompra' },
    { nombre:'Splitter auxiliar 3.5mm para compartir audio', q:'splitter auxiliar 3.5mm audio', keyword_en:'3.5mm audio splitter', volCm3:80, costoMin:0.6, costoMax:1.8, pesoG:25, nota:'Accesorio de nicho' },
    { nombre:'Soporte notebook plegable de aluminio', q:'soporte notebook aluminio plegable', keyword_en:'foldable aluminum laptop stand', volCm3:1800, costoMin:3, costoMax:7, pesoG:300, nota:'Ergonomía' },
    { nombre:'Mouse pad XL antideslizante', q:'mousepad gamer xl', keyword_en:'xl gaming mouse pad', volCm3:2500, costoMin:1, costoMax:3, pesoG:250, nota:'Liviano' },
    { nombre:'Etiquetadores de cable de silicona (set)', q:'etiquetas cables silicona set', keyword_en:'silicone cable labels set', volCm3:150, costoMin:0.5, costoMax:1.5, pesoG:40, nota:'Home office prolijo' },
    { nombre:'Enrollador retractil para cable de carga', q:'enrollador retractil cable carga', keyword_en:'retractable charging cable winder', volCm3:150, costoMin:0.7, costoMax:2, pesoG:40, nota:'Viajero, liviano' },
  ]},
  hogar: { label: 'Hogar y Deco', icon: '🏠', productos: [
    { nombre:'Soporte cepillo de dientes magnetico adhesivo', q:'soporte cepillo dientes magnetico adhesivo', keyword_en:'magnetic adhesive toothbrush holder', volCm3:300, costoMin:0.6, costoMax:1.8, pesoG:60, nota:'Bano, novedoso' },
    { nombre:'Separadores de cajon expandibles (par)', q:'separadores cajon expandibles', keyword_en:'expandable drawer dividers', volCm3:2400, costoMin:1.5, costoMax:3.5, pesoG:180, nota:'Menos comun que set modular' },
    { nombre:'Portallaves magnetico adhesivo de pared', q:'portallaves magnetico adhesivo pared', keyword_en:'magnetic adhesive wall key holder', volCm3:400, costoMin:0.8, costoMax:2, pesoG:80, nota:'Entrada de casa' },
    { nombre:'Tira LED USB para ambiente (2m)', q:'tira led usb ambiente', keyword_en:'usb led strip light', volCm3:400, costoMin:0.8, costoMax:2.5, pesoG:80, nota:'Deco tendencia' },
    { nombre:'Rociador presurizado para plantas', q:'rociador presion plantas', keyword_en:'pressure plant sprayer', volCm3:1800, costoMin:1.5, costoMax:3.5, pesoG:180, nota:'Jardín interior' },
    { nombre:'Bolsas al vacío para ropa (set)', q:'bolsas vacio ropa', keyword_en:'vacuum storage bags clothes', volCm3:1500, costoMin:1, costoMax:3, pesoG:150, nota:'Ahorro espacio' },
    { nombre:'Colgador apilable de carteras y bolsos', q:'colgador apilable carteras placard', keyword_en:'stackable closet handbag hanger', volCm3:1200, costoMin:1.2, costoMax:3, pesoG:150, nota:'Placard, nicho' },
    { nombre:'Difusor de aromas mini USB', q:'difusor aromas usb mini', keyword_en:'mini usb aroma diffuser', volCm3:800, costoMin:1.5, costoMax:4, pesoG:150, nota:'Deco + bienestar' },
    { nombre:'Burlete adhesivo bajo puerta anti ruido', q:'burlete adhesivo bajo puerta', keyword_en:'adhesive door draft stopper', volCm3:1500, costoMin:1, costoMax:2.5, pesoG:120, nota:'Ahorro energia, nicho' },
    { nombre:'Set de utensilios de silicona', q:'utensilios silicona cocina set', keyword_en:'silicone kitchen utensils set', volCm3:3500, costoMin:2, costoMax:5, pesoG:400, nota:'No frágil' },
    { nombre:'Reloj proyector de techo mini', q:'reloj proyector techo mini', keyword_en:'mini ceiling projection clock', volCm3:900, costoMin:2, costoMax:4, pesoG:150, nota:'Novedoso dormitorio' },
    { nombre:'Organizador de cosméticos giratorio', q:'organizador cosmeticos giratorio', keyword_en:'rotating makeup organizer', volCm3:6000, costoMin:2, costoMax:5, pesoG:350, nota:'Público femenino' },
  ]},
  deportes: { label: 'Deportes / Fitness', icon: '🏋️', productos: [
    { nombre:'Mini bandas de gluteos de tela (set)', q:'banda tela gluteos set', keyword_en:'fabric booty resistance bands set', volCm3:700, costoMin:1.5, costoMax:3.5, pesoG:150, nota:'Tendencia fitness femenino' },
    { nombre:'Disco giratorio de equilibrio y core', q:'disco equilibrio balance core', keyword_en:'balance disc core trainer', volCm3:4500, costoMin:2, costoMax:4.5, pesoG:300, nota:'Menos saturado que rueda' },
    { nombre:'Cuerda de saltar sin cuerda con peso', q:'cuerda saltar sin cuerda cordless', keyword_en:'cordless jump rope weighted', volCm3:800, costoMin:1.2, costoMax:3, pesoG:150, nota:'Novedad indoor' },
    { nombre:'Guantes de gimnasio antideslizantes', q:'guantes gimnasio', keyword_en:'gym gloves', volCm3:500, costoMin:1, costoMax:3, pesoG:120, nota:'Recompra' },
    { nombre:'Botella plegable de silicona compacta', q:'botella plegable silicona deporte', keyword_en:'collapsible silicone sports bottle', volCm3:600, costoMin:1.5, costoMax:3.5, pesoG:120, nota:'Viaje, ocupa poco' },
    { nombre:'Rodillo masajeador muscular', q:'rodillo masajeador muscular', keyword_en:'muscle massage roller stick', volCm3:1500, costoMin:2, costoMax:5, pesoG:350, nota:'Recuperación' },
    { nombre:'Tobilleras con peso ajustable', q:'tobilleras peso ejercicio', keyword_en:'ankle weights exercise', volCm3:1500, costoMin:2.5, costoMax:6, pesoG:500, nota:'Peso ok' },
    { nombre:'Fortalecedor de mano ajustable', q:'fortalecedor mano grip', keyword_en:'adjustable hand grip strengthener', volCm3:400, costoMin:0.8, costoMax:2.5, pesoG:100, nota:'Chico' },
    { nombre:'Cinta kinesiológica deportiva', q:'cinta kinesiologica deportiva', keyword_en:'kinesiology tape', volCm3:300, costoMin:1, costoMax:3, pesoG:80, nota:'Consumible' },
    { nombre:'Riñonera deportiva para running', q:'riñonera running deportiva', keyword_en:'running waist belt bag', volCm3:500, costoMin:1.5, costoMax:4, pesoG:120, nota:'Textil liviano' },
    { nombre:'Discos deslizantes para core', q:'sliders discos ejercicio core', keyword_en:'core sliders exercise discs', volCm3:900, costoMin:1, costoMax:3, pesoG:150, nota:'Chico' },
    { nombre:'Toalla de microfibra deportiva', q:'toalla microfibra deportiva', keyword_en:'microfiber sports towel', volCm3:800, costoMin:1.5, costoMax:4, pesoG:200, nota:'Recompra' },
  ]},
  moda: { label: 'Moda / Indumentaria', icon: '👕', productos: [
    { nombre:'Clip solar polarizado para anteojos', q:'clip solar polarizado anteojos', keyword_en:'polarized clip on sunglasses', volCm3:150, costoMin:1, costoMax:2.5, pesoG:30, nota:'Nicho usuarios de lentes' },
    { nombre:'Riñonera urbana de tela', q:'riñonera urbana tela', keyword_en:'fabric waist bag fanny pack', volCm3:900, costoMin:2, costoMax:5, pesoG:200, nota:'Tendencia' },
    { nombre:'Medias antideslizantes pilates (pack)', q:'medias antideslizantes pilates', keyword_en:'non slip pilates socks', volCm3:300, costoMin:1, costoMax:3, pesoG:100, nota:'Recompra' },
    { nombre:'Organizador de aros/piercings de viaje', q:'organizador aros joyas viaje', keyword_en:'travel jewelry earring organizer', volCm3:400, costoMin:1, costoMax:2.5, pesoG:80, nota:'Accesorio nicho' },
    { nombre:'Bucket hat reversible de tela', q:'bucket hat reversible', keyword_en:'reversible bucket hat', volCm3:900, costoMin:1.5, costoMax:3.5, pesoG:100, nota:'Tendencia joven' },
    { nombre:'Pañuelo de seda satinado', q:'pañuelo seda satinado mujer', keyword_en:'satin silk scarf women', volCm3:250, costoMin:1, costoMax:3.5, pesoG:60, nota:'Liviano' },
    { nombre:'Billetera slim antirrobo RFID', q:'billetera slim rfid', keyword_en:'slim rfid wallet', volCm3:200, costoMin:1.5, costoMax:4, pesoG:80, nota:'Chica' },
    { nombre:'Scrunchies de tela (pack)', q:'scrunchies pack pelo', keyword_en:'hair scrunchies pack', volCm3:300, costoMin:0.5, costoMax:2, pesoG:50, nota:'Barato, recompra' },
    { nombre:'Guantes touchscreen de invierno', q:'guantes touchscreen invierno', keyword_en:'touchscreen winter gloves', volCm3:400, costoMin:1, costoMax:3, pesoG:100, nota:'Estacional' },
    { nombre:'Aros minimalistas de acero (set)', q:'aros acero quirurgico set mujer', keyword_en:'stainless steel earrings set women', volCm3:100, costoMin:0.8, costoMax:3, pesoG:30, nota:'Sin níquel' },
    { nombre:'Medias térmicas de invierno (pack)', q:'medias termicas invierno', keyword_en:'thermal winter socks', volCm3:500, costoMin:1, costoMax:3, pesoG:150, nota:'Estacional' },
    { nombre:'Corbata slim moderna', q:'corbata slim', keyword_en:'slim necktie', volCm3:300, costoMin:1, costoMax:3, pesoG:80, nota:'Liviano' },
  ]},
  mascotas: { label: 'Mascotas', icon: '🐶', productos: [
    { nombre:'Cepillo quita pelos para mascotas', q:'cepillo quita pelos mascotas', keyword_en:'pet hair remover brush', volCm3:700, costoMin:1, costoMax:3, pesoG:120, nota:'Recompra' },
    { nombre:'Comedero antivoracidad para perros', q:'comedero antivoracidad perro', keyword_en:'slow feeder dog bowl', volCm3:2500, costoMin:1.5, costoMax:4, pesoG:200, nota:'No frágil' },
    { nombre:'Juguete dispensador de premios', q:'juguete dispensador premios perro', keyword_en:'dog treat dispenser toy', volCm3:1000, costoMin:1.5, costoMax:4, pesoG:150, nota:'Tendencia' },
    { nombre:'Cortauñas para mascotas con lima', q:'cortauñas mascotas', keyword_en:'pet nail clipper with file', volCm3:250, costoMin:0.8, costoMax:2.5, pesoG:80, nota:'Chico' },
    { nombre:'Alfombra de lameteo antiestres para perros', q:'alfombra lameteo lick mat perro', keyword_en:'dog lick mat', volCm3:600, costoMin:1.5, costoMax:3.5, pesoG:150, nota:'Tendencia bienestar animal' },
    { nombre:'Collar LED recargable de seguridad', q:'collar led perro recargable', keyword_en:'rechargeable led dog collar', volCm3:300, costoMin:1.5, costoMax:4, pesoG:80, nota:'Seguridad' },
    { nombre:'Bolsas biodegradables para heces', q:'bolsas caca perro biodegradables', keyword_en:'biodegradable dog poop bags', volCm3:600, costoMin:0.5, costoMax:2, pesoG:100, nota:'Consumible' },
    { nombre:'Tunel plegable de juego para gatos', q:'tunel plegable juego gato', keyword_en:'collapsible cat tunnel', volCm3:3500, costoMin:2, costoMax:4.5, pesoG:250, nota:'Novedoso, liviano plegado' },
    { nombre:'Bebedero plegable de viaje', q:'bebedero plegable perro viaje', keyword_en:'collapsible travel dog water bowl', volCm3:500, costoMin:1, costoMax:3, pesoG:90, nota:'Liviano' },
    { nombre:'Bolsa dispensadora de premios de entrenamiento', q:'bolsa premios entrenamiento perro cinturon', keyword_en:'dog treat training pouch', volCm3:800, costoMin:1, costoMax:2.5, pesoG:120, nota:'Adiestramiento, nicho' },
    { nombre:'Guante de aseo para mascotas', q:'guante aseo mascotas', keyword_en:'pet grooming glove', volCm3:400, costoMin:1, costoMax:3, pesoG:100, nota:'Recompra' },
    { nombre:'Juguete de plumas para gato', q:'juguete gato plumas varita', keyword_en:'cat feather wand toy', volCm3:600, costoMin:0.5, costoMax:2, pesoG:60, nota:'Barato' },
  ]},
  bebes: { label: 'Bebés / Niños', icon: '🍼', productos: [
    { nombre:'Babero de silicona impermeable', q:'babero silicona bebe', keyword_en:'silicone baby bib', volCm3:500, costoMin:1, costoMax:3, pesoG:80, nota:'Recompra' },
    { nombre:'Mordillo de silicona para dentición', q:'mordillo silicona bebe', keyword_en:'silicone baby teether', volCm3:200, costoMin:0.8, costoMax:2.5, pesoG:50, nota:'Grado alimenticio' },
    { nombre:'Sujetador de manta/juguete para cochecito', q:'sujetador manta juguete cochecito clip', keyword_en:'stroller blanket toy clip', volCm3:150, costoMin:0.8, costoMax:2, pesoG:60, nota:'Practico, liviano' },
    { nombre:'Protectores de esquinas (pack)', q:'protector esquinas bebe seguridad', keyword_en:'baby corner guards', volCm3:500, costoMin:0.5, costoMax:2, pesoG:100, nota:'Consumible' },
    { nombre:'Tapas antiderrame para vasos', q:'tapa antiderrame vaso niños', keyword_en:'spill proof cup lid kids', volCm3:300, costoMin:1, costoMax:3, pesoG:80, nota:'Novedad' },
    { nombre:'Juguete apilable de silicona', q:'juguete apilable silicona bebe', keyword_en:'silicone stacking toy baby', volCm3:1500, costoMin:1.5, costoMax:4, pesoG:150, nota:'Didáctico' },
    { nombre:'Termómetro de baño para bebé', q:'termometro baño bebe', keyword_en:'baby bath thermometer', volCm3:400, costoMin:1, costoMax:3, pesoG:80, nota:'Chico' },
    { nombre:'Protector de arnes de cochecito acolchado', q:'protector arnes cochecito acolchado', keyword_en:'stroller strap covers padded', volCm3:500, costoMin:1, costoMax:2.5, pesoG:100, nota:'Nicho, recompra' },
    { nombre:'Broches para chupete (set)', q:'broche chupete bebe', keyword_en:'pacifier clip', volCm3:100, costoMin:0.5, costoMax:2, pesoG:40, nota:'Recompra' },
    { nombre:'Luz nocturna quitamiedos LED', q:'luz nocturna infantil led', keyword_en:'kids led night light', volCm3:800, costoMin:1.5, costoMax:4, pesoG:150, nota:'Deco infantil' },
    { nombre:'Libro sensorial de tela quiet book', q:'libro sensorial tela bebe quiet book', keyword_en:'baby quiet book cloth sensory', volCm3:1500, costoMin:2, costoMax:4.5, pesoG:200, nota:'Educativo, tendencia' },
    { nombre:'Delantal de pintura para niños', q:'delantal pintura niños', keyword_en:'kids painting apron', volCm3:400, costoMin:1, costoMax:3, pesoG:120, nota:'Textil' },
  ]},
  belleza: { label: 'Salud y Belleza', icon: '💄', productos: [
    { nombre:'Rodillo facial de cuarzo/jade', q:'rodillo facial jade cuarzo', keyword_en:'jade quartz face roller', volCm3:300, costoMin:1, costoMax:3, pesoG:100, nota:'Tendencia skincare' },
    { nombre:'Esponja limpiadora de brochas de silicona', q:'limpiador brochas silicona', keyword_en:'silicone makeup brush cleaner', volCm3:200, costoMin:0.6, costoMax:1.8, pesoG:60, nota:'Accesorio, recompra' },
    { nombre:'Aplicador de pestañas postizas de precision', q:'aplicador pestanas postizas pinza', keyword_en:'false eyelash applicator tweezers', volCm3:80, costoMin:0.8, costoMax:2, pesoG:40, nota:'Nicho, liviano' },
    { nombre:'Masajeador facial gua sha', q:'gua sha masajeador facial', keyword_en:'gua sha facial tool', volCm3:150, costoMin:0.8, costoMax:2.5, pesoG:60, nota:'Tendencia' },
    { nombre:'Bandeja magnetica organizadora de aros', q:'organizador aros pendientes bandeja', keyword_en:'earring organizer tray', volCm3:1200, costoMin:1.2, costoMax:3, pesoG:180, nota:'Nicho joyeria' },
    { nombre:'Rizador de pestañas', q:'rizador pestañas', keyword_en:'eyelash curler', volCm3:200, costoMin:0.5, costoMax:2, pesoG:40, nota:'Recompra' },
    { nombre:'Secador difusor de bolsillo para rulos', q:'difusor plegable secador rulos', keyword_en:'collapsible hair dryer diffuser', volCm3:1500, costoMin:1.5, costoMax:3.5, pesoG:150, nota:'Nicho cabello rizado' },
    { nombre:'Kit de manicura (set)', q:'kit manicura set', keyword_en:'manicure kit set', volCm3:400, costoMin:1, costoMax:3, pesoG:150, nota:'Recompra' },
    { nombre:'Vincha de spa skincare (pack)', q:'vincha spa skincare', keyword_en:'spa headband skincare', volCm3:250, costoMin:0.5, costoMax:2, pesoG:50, nota:'Barato' },
    { nombre:'Depilador facial eléctrico mini', q:'depilador facial electrico mini', keyword_en:'mini electric facial hair remover', volCm3:200, costoMin:1.5, costoMax:4, pesoG:80, nota:'Chico' },
    { nombre:'Lámpara mini LED para uñas', q:'lampara uñas mini led', keyword_en:'mini uv led nail lamp', volCm3:1000, costoMin:2, costoMax:5, pesoG:200, nota:'Nicho nails' },
    { nombre:'Parches de hidrogel para ojeras', q:'parches ojeras hidrogel', keyword_en:'hydrogel under eye patches', volCm3:150, costoMin:0.8, costoMax:2.5, pesoG:60, nota:'Consumible' },
  ]},
  cocina: { label: 'Cocina / Gastronomía', icon: '🍳', productos: [
    { nombre:'Cortador de hierbas y ajo manual mini', q:'picador ajo hierbas manual mini', keyword_en:'mini manual garlic chopper', volCm3:600, costoMin:0.8, costoMax:2, pesoG:120, nota:'Especifico, menos saturado' },
    { nombre:'Molinillo manual de sal y pimienta', q:'molinillo sal pimienta manual', keyword_en:'manual salt pepper grinder', volCm3:700, costoMin:1.5, costoMax:4, pesoG:200, nota:'No frágil' },
    { nombre:'Moldes de silicona repostería (set)', q:'moldes silicona reposteria set', keyword_en:'silicone baking molds set', volCm3:2000, costoMin:1.5, costoMax:4, pesoG:250, nota:'Recompra' },
    { nombre:'Prensa manual para palta/guacamole', q:'prensa palta guacamole utensilio', keyword_en:'avocado masher tool', volCm3:500, costoMin:0.9, costoMax:2.2, pesoG:130, nota:'Tendencia saludable' },
    { nombre:'Tabla flexible para picar (set colores)', q:'tabla flexible picar set', keyword_en:'flexible cutting board mats set', volCm3:1200, costoMin:1, costoMax:2.5, pesoG:150, nota:'Higiene por color' },
    { nombre:'Rociador de aceite en spray', q:'rociador aceite spray cocina', keyword_en:'oil sprayer bottle kitchen', volCm3:700, costoMin:1.5, costoMax:4, pesoG:150, nota:'Fitness cook' },
    { nombre:'Pelador de cerámica (set)', q:'pelador ceramica set', keyword_en:'ceramic peeler set', volCm3:400, costoMin:0.8, costoMax:2.5, pesoG:100, nota:'Recompra' },
    { nombre:'Termómetro digital de cocina', q:'termometro cocina digital', keyword_en:'digital kitchen thermometer', volCm3:250, costoMin:1, costoMax:3, pesoG:80, nota:'Chico' },
    { nombre:'Batidor eléctrico mini de leche', q:'batidor leche electrico mini', keyword_en:'handheld electric milk frother', volCm3:300, costoMin:1, costoMax:3, pesoG:100, nota:'Barista casero' },
    { nombre:'Bolsas reutilizables de silicona', q:'bolsas reutilizables alimentos silicona', keyword_en:'reusable silicone food bags', volCm3:800, costoMin:1.5, costoMax:4, pesoG:150, nota:'Eco tendencia' },
    { nombre:'Sellador manual de bolsas recargable', q:'sellador bolsas manual mini', keyword_en:'mini handheld bag sealer', volCm3:200, costoMin:0.7, costoMax:2, pesoG:80, nota:'Consumo diario, nicho' },
    { nombre:'Escurridor de pasta con clip', q:'escurridor pasta olla clip', keyword_en:'clip on pot strainer', volCm3:600, costoMin:1, costoMax:3, pesoG:100, nota:'Novedad' },
  ]},
  automotor: { label: 'Automotor / Moto', icon: '🚗', productos: [
    { nombre:'Soporte magnético de celular para auto', q:'soporte celular auto magnetico', keyword_en:'magnetic car phone mount', volCm3:200, costoMin:1, costoMax:3, pesoG:80, nota:'Alta demanda' },
    { nombre:'Gancho organizador entre asientos de auto', q:'gancho organizador entre asientos auto', keyword_en:'car seat back hook organizer', volCm3:200, costoMin:0.8, costoMax:2, pesoG:60, nota:'Practico, liviano' },
    { nombre:'Cargador USB dual para auto', q:'cargador auto usb dual', keyword_en:'dual usb car charger', volCm3:100, costoMin:0.8, costoMax:2.5, pesoG:40, nota:'Chico' },
    { nombre:'Kit de luces LED interior', q:'luces led interior auto', keyword_en:'car interior led lights', volCm3:500, costoMin:1.5, costoMax:4, pesoG:120, nota:'Tuning' },
    { nombre:'Ganchos organizadores de baúl (par)', q:'gancho baul auto organizador', keyword_en:'car trunk hook organizer', volCm3:300, costoMin:1, costoMax:3, pesoG:100, nota:'Chico' },
    { nombre:'Limpiador de rejillas de aire de auto (kit)', q:'cepillo limpiador rejillas auto detailing', keyword_en:'car air vent cleaning brush detailing', volCm3:500, costoMin:0.7, costoMax:2, pesoG:80, nota:'Tendencia detailing' },
    { nombre:'Escobillas de silicona (par)', q:'escobilla limpiaparabrisas silicona', keyword_en:'silicone windshield wiper blades', volCm3:1500, costoMin:1.5, costoMax:4, pesoG:200, nota:'Consumible' },
    { nombre:'Aromatizante clip de ventilación', q:'aromatizante auto clip', keyword_en:'car vent clip air freshener', volCm3:100, costoMin:0.5, costoMax:2, pesoG:40, nota:'Recompra' },
    { nombre:'Removedor de pelos de mascota para tapizado', q:'removedor pelos mascota auto tapizado', keyword_en:'pet hair remover car upholstery', volCm3:500, costoMin:0.8, costoMax:2.2, pesoG:100, nota:'Nicho detailing' },
    { nombre:'Plumero para tablero', q:'plumero limpieza auto tablero', keyword_en:'car dashboard duster', volCm3:1500, costoMin:1, costoMax:3, pesoG:100, nota:'Recompra' },
    { nombre:'Gancho de casco para moto', q:'gancho casco moto', keyword_en:'motorcycle helmet hook', volCm3:200, costoMin:1, costoMax:3, pesoG:100, nota:'Nicho moto' },
    { nombre:'Guantes de moto media estación', q:'guantes moto verano', keyword_en:'summer motorcycle gloves', volCm3:700, costoMin:2, costoMax:5, pesoG:150, nota:'Textil' },
  ]},
  herramientas: { label: 'Herramientas / Bricolaje', icon: '🔧', productos: [
    { nombre:'Kit reparacion de electronica con puas (celular)', q:'kit apertura reparacion celular puas', keyword_en:'phone repair opening tool kit', volCm3:400, costoMin:1.5, costoMax:3.5, pesoG:150, nota:'Reparadores, nicho' },
    { nombre:'Nivel láser mini autonivelante', q:'nivel laser mini', keyword_en:'mini laser level', volCm3:600, costoMin:3, costoMax:7, pesoG:250, nota:'Alto margen' },
    { nombre:'Medidor láser de distancia', q:'medidor laser distancia', keyword_en:'laser distance meter', volCm3:400, costoMin:3, costoMax:8, pesoG:150, nota:'Alto ticket' },
    { nombre:'Pulsera magnetica porta tornillos', q:'pulsera magnetica tornillos', keyword_en:'magnetic wristband screw holder', volCm3:500, costoMin:1, costoMax:2.5, pesoG:120, nota:'Novedoso, manos libres' },
    { nombre:'Adaptador de taladro a lijadora/pulidora', q:'adaptador taladro lijadora disco', keyword_en:'drill sanding disc attachment', volCm3:600, costoMin:1.2, costoMax:3, pesoG:150, nota:'Nicho DIY' },
    { nombre:'Linterna LED recargable de mano', q:'linterna led recargable mano', keyword_en:'rechargeable led flashlight', volCm3:400, costoMin:2, costoMax:5, pesoG:150, nota:'Recompra' },
    { nombre:'Cinta métrica retráctil 5m', q:'cinta metrica 5 metros', keyword_en:'5m tape measure', volCm3:300, costoMin:1, costoMax:3, pesoG:150, nota:'Chico' },
    { nombre:'Pistola de silicona caliente mini', q:'pistola silicona caliente mini', keyword_en:'mini hot glue gun', volCm3:800, costoMin:1.5, costoMax:4, pesoG:200, nota:'Manualidades' },
    { nombre:'Guantes de trabajo anticorte', q:'guantes trabajo anticorte', keyword_en:'cut resistant work gloves', volCm3:400, costoMin:1, costoMax:3, pesoG:120, nota:'Recompra' },
    { nombre:'Set de llaves allen plegable', q:'set llaves allen plegable', keyword_en:'folding hex key set', volCm3:250, costoMin:1, costoMax:3, pesoG:150, nota:'Chico' },
    { nombre:'Cinta doble faz montaje extra fuerte (nano)', q:'cinta nano doble faz montaje', keyword_en:'nano double sided mounting tape', volCm3:300, costoMin:0.8, costoMax:2.5, pesoG:120, nota:'Viral, recompra' },
    { nombre:'Detector de cables de pared', q:'detector cables pared', keyword_en:'wall wire detector', volCm3:400, costoMin:2, costoMax:5, pesoG:150, nota:'Novedad' },
  ]},
  camping: { label: 'Camping / Outdoor', icon: '🏕️', productos: [
    { nombre:'Farol colgante plegable USB para carpa', q:'farol plegable usb camping carpa', keyword_en:'collapsible usb camping lantern', volCm3:800, costoMin:1.5, costoMax:3.5, pesoG:150, nota:'Compacto, liviano' },
    { nombre:'Cubiertos plegables de viaje', q:'cubiertos plegables camping', keyword_en:'folding camping cutlery', volCm3:300, costoMin:1.5, costoMax:4, pesoG:150, nota:'Liviano' },
    { nombre:'Manta térmica de emergencia (pack)', q:'manta termica emergencia', keyword_en:'emergency thermal blanket', volCm3:150, costoMin:0.5, costoMax:2, pesoG:60, nota:'Consumible' },
    { nombre:'Filtro de agua portátil personal', q:'filtro agua portatil camping', keyword_en:'portable water filter camping', volCm3:500, costoMin:3, costoMax:8, pesoG:120, nota:'Alto margen' },
    { nombre:'Almohada inflable de camping ultraliviana', q:'almohada inflable camping ultraliviana', keyword_en:'ultralight inflatable camping pillow', volCm3:500, costoMin:1.2, costoMax:3, pesoG:120, nota:'Trekking, ligero' },
    { nombre:'Silbato de supervivencia multiuso', q:'silbato supervivencia', keyword_en:'survival whistle', volCm3:50, costoMin:0.3, costoMax:1.5, pesoG:30, nota:'Diminuto' },
    { nombre:'Bolsa seca impermeable (dry bag)', q:'bolsa seca impermeable dry bag', keyword_en:'waterproof dry bag', volCm3:800, costoMin:1.5, costoMax:4, pesoG:150, nota:'Textil' },
    { nombre:'Ganchos mosqueton de aluminio (set)', q:'mosqueton aluminio set camping', keyword_en:'aluminum carabiner set', volCm3:150, costoMin:0.6, costoMax:1.8, pesoG:80, nota:'Multiuso, liviano' },
    { nombre:'Lámpara solar inflable portátil', q:'lampara solar inflable camping', keyword_en:'inflatable solar lantern', volCm3:600, costoMin:2, costoMax:5, pesoG:120, nota:'Novedad eco' },
    { nombre:'Mochila plegable ultraliviana', q:'mochila plegable ultraliviana', keyword_en:'ultralight foldable backpack', volCm3:800, costoMin:2, costoMax:5, pesoG:150, nota:'Textil liviano' },
    { nombre:'Pulsera repelente de mosquitos (pack)', q:'pulsera repelente mosquitos', keyword_en:'mosquito repellent bracelet', volCm3:150, costoMin:0.5, costoMax:2, pesoG:40, nota:'Estacional' },
    { nombre:'Brújula de supervivencia', q:'brujula supervivencia', keyword_en:'survival compass', volCm3:150, costoMin:1, costoMax:3, pesoG:80, nota:'Chico' },
  ]},
  oficina: { label: 'Papelería / Oficina', icon: '📎', productos: [
    { nombre:'Resaltadores pastel (set)', q:'resaltadores pastel set', keyword_en:'pastel highlighters set', volCm3:300, costoMin:0.8, costoMax:2.5, pesoG:120, nota:'Recompra estudiantes' },
    { nombre:'Soporte elevador para monitor plegable', q:'soporte elevador monitor plegable', keyword_en:'foldable monitor riser stand', volCm3:3000, costoMin:2, costoMax:4.5, pesoG:300, nota:'Home office ergonomico' },
    { nombre:'Notas adhesivas y separadores (set)', q:'notas adhesivas set separadores', keyword_en:'sticky notes index tabs set', volCm3:400, costoMin:0.5, costoMax:2, pesoG:100, nota:'Consumible' },
    { nombre:'Lapiceras borrables (pack)', q:'lapicera borrable pack', keyword_en:'erasable gel pens pack', volCm3:200, costoMin:0.8, costoMax:2.5, pesoG:80, nota:'Recompra' },
    { nombre:'Pizarra magnetica de heladera semanal', q:'pizarra magnetica heladera planificador', keyword_en:'magnetic fridge whiteboard weekly planner', volCm3:1200, costoMin:1.5, costoMax:3.5, pesoG:200, nota:'Organizacion, nicho' },
    { nombre:'Soporte adhesivo para auriculares bajo escritorio', q:'soporte auriculares adhesivo escritorio', keyword_en:'adhesive under desk headphone holder', volCm3:250, costoMin:0.8, costoMax:2, pesoG:60, nota:'Setup, liviano' },
    { nombre:'Organizador de cables para mochila', q:'organizador cables mochila electronica', keyword_en:'electronics cable organizer bag', volCm3:1500, costoMin:1.5, costoMax:4, pesoG:150, nota:'Textil' },
    { nombre:'Sello autoentintable', q:'sello autoentintable', keyword_en:'self inking stamp', volCm3:200, costoMin:1, costoMax:3, pesoG:80, nota:'Chico' },
    { nombre:'Reposamuñecas de gel para teclado/mouse (set)', q:'reposamuñecas gel teclado mouse', keyword_en:'gel wrist rest keyboard mouse set', volCm3:1500, costoMin:1.2, costoMax:3, pesoG:200, nota:'Ergonomia home office' },
    { nombre:'Stickers decorativos (packs)', q:'stickers decorativos pack', keyword_en:'decorative stickers pack', volCm3:150, costoMin:0.3, costoMax:1.5, pesoG:40, nota:'Recompra' },
    { nombre:'Cinta correctora (pack)', q:'cinta correctora pack', keyword_en:'correction tape pack', volCm3:200, costoMin:0.5, costoMax:2, pesoG:60, nota:'Consumible' },
    { nombre:'Atril soporte para libros/tablet', q:'atril soporte libros ajustable', keyword_en:'adjustable book stand', volCm3:2500, costoMin:2, costoMax:5, pesoG:300, nota:'Estudio' },
  ]},
  domotica: { label: 'Domótica / Casa Inteligente', icon: '🏡', productos: [
    { nombre:'Enchufe inteligente WiFi (smart plug)', q:'enchufe inteligente wifi', keyword_en:'wifi smart plug', volCm3:300, costoMin:2.5, costoMax:5, pesoG:60, nota:'Alta demanda smart home' },
    { nombre:'Tira LED RGB WiFi con app', q:'tira led rgb wifi', keyword_en:'wifi rgb led strip', volCm3:1000, costoMin:3, costoMax:6, pesoG:120, nota:'Deco + tendencia' },
    { nombre:'Sensor de movimiento PIR inalámbrico', q:'sensor movimiento inalambrico', keyword_en:'wireless pir motion sensor', volCm3:300, costoMin:2, costoMax:4, pesoG:50, nota:'Seguridad hogar' },
    { nombre:'Control remoto universal IR WiFi', q:'control universal ir wifi', keyword_en:'wifi ir universal remote', volCm3:300, costoMin:3, costoMax:6, pesoG:70, nota:'Reemplaza varios remotos' },
    { nombre:'Lámpara inteligente WiFi RGB E27', q:'lampara inteligente wifi e27', keyword_en:'wifi smart bulb e27', volCm3:500, costoMin:2.5, costoMax:5, pesoG:90, nota:'Recompra por pack' },
    { nombre:'Sensor de apertura puerta/ventana', q:'sensor apertura puerta ventana', keyword_en:'door window contact sensor', volCm3:150, costoMin:1.5, costoMax:3.5, pesoG:40, nota:'Kit de seguridad' },
    { nombre:'Timbre WiFi con cámara mini', q:'timbre wifi camara', keyword_en:'wifi video doorbell', volCm3:600, costoMin:6, costoMax:12, pesoG:150, nota:'Ticket medio-alto' },
    { nombre:'Adaptador smart para portón/garage', q:'control garage wifi', keyword_en:'wifi garage door controller', volCm3:300, costoMin:5, costoMax:10, pesoG:80, nota:'Nicho poco saturado' },
    { nombre:'Repetidor de señal WiFi compacto', q:'repetidor wifi', keyword_en:'wifi range extender', volCm3:400, costoMin:3, costoMax:6, pesoG:70, nota:'Complemento smart home' },
    { nombre:'Regleta inteligente con USB', q:'regleta inteligente usb wifi', keyword_en:'wifi smart power strip usb', volCm3:1200, costoMin:4, costoMax:8, pesoG:200, nota:'Escritorio smart' },
    { nombre:'Sensor de temperatura y humedad WiFi', q:'sensor temperatura humedad wifi', keyword_en:'wifi temperature humidity sensor', volCm3:200, costoMin:3, costoMax:6, pesoG:60, nota:'Datos en app' },
    { nombre:'Cerradura inteligente con huella (portátil)', q:'candado huella inteligente', keyword_en:'smart fingerprint padlock', volCm3:300, costoMin:5, costoMax:11, pesoG:120, nota:'Novedad' },
  ]},
  jardineria: { label: 'Jardinería / Plantas', icon: '🌱', productos: [
    { nombre:'Pistola rociadora ajustable para manguera', q:'pistola riego manguera', keyword_en:'garden hose spray nozzle', volCm3:1200, costoMin:1.5, costoMax:4, pesoG:120, nota:'Temporada alta' },
    { nombre:'Set de herramientas de jardín de mano', q:'set herramientas jardin mano', keyword_en:'garden hand tools set', volCm3:2500, costoMin:2.5, costoMax:6, pesoG:300, nota:'Regalo' },
    { nombre:'Guantes de jardinería con garras', q:'guantes jardineria garras', keyword_en:'garden gloves with claws', volCm3:600, costoMin:1, costoMax:3, pesoG:80, nota:'Recompra' },
    { nombre:'Medidor 3 en 1 de humedad/pH/luz', q:'medidor humedad ph suelo', keyword_en:'soil moisture ph meter', volCm3:500, costoMin:2, costoMax:5, pesoG:90, nota:'Sin batería, práctico' },
    { nombre:'Aspersor giratorio automático', q:'aspersor giratorio jardin', keyword_en:'rotating garden sprinkler', volCm3:1500, costoMin:2, costoMax:5, pesoG:150, nota:'Riego fácil' },
    { nombre:'Macetas de tela geotextil (pack)', q:'macetas tela geotextil pack', keyword_en:'fabric grow bags pack', volCm3:800, costoMin:2, costoMax:5, pesoG:120, nota:'Cultivo urbano' },
    { nombre:'Tijera de podar bypass', q:'tijera podar bypass', keyword_en:'bypass pruning shears', volCm3:600, costoMin:2, costoMax:5, pesoG:150, nota:'Herramienta base' },
    { nombre:'Kit de germinación con bandeja', q:'bandeja germinacion semillas', keyword_en:'seed starting tray', volCm3:3000, costoMin:1.5, costoMax:4, pesoG:110, nota:'Huerta en casa' },
    { nombre:'Manguera expandible retráctil', q:'manguera expandible', keyword_en:'expandable garden hose', volCm3:3000, costoMin:4, costoMax:9, pesoG:300, nota:'Ticket medio' },
    { nombre:'Etiquetas para plantas (pack)', q:'etiquetas plantas jardin', keyword_en:'plant labels garden', volCm3:200, costoMin:1, costoMax:2.5, pesoG:50, nota:'Complemento huerta' },
    { nombre:'Rodillera almohadilla para jardinería', q:'almohadilla rodilla jardin', keyword_en:'garden kneeling pad', volCm3:2500, costoMin:1.5, costoMax:3.5, pesoG:120, nota:'Comodidad' },
    { nombre:'Luz solar de jardín estaca (pack)', q:'luz solar jardin estaca', keyword_en:'solar garden stake lights', volCm3:1200, costoMin:2, costoMax:5, pesoG:150, nota:'Deco exterior' },
  ]},
  joyeria: { label: 'Joyería / Bijouterie', icon: '💍', productos: [
    { nombre:'Set de aros de acero quirúrgico (pack)', q:'aros acero quirurgico pack', keyword_en:'stainless steel stud earrings pack', volCm3:100, costoMin:1, costoMax:3, pesoG:30, nota:'Hipoalergénico, recompra' },
    { nombre:'Collar de acero inoxidable minimalista', q:'collar acero inoxidable minimalista', keyword_en:'minimalist stainless steel necklace', volCm3:80, costoMin:1.5, costoMax:4, pesoG:25, nota:'Tendencia' },
    { nombre:'Organizador de joyas de viaje', q:'organizador joyas viaje', keyword_en:'travel jewelry organizer case', volCm3:800, costoMin:2, costoMax:5, pesoG:120, nota:'Complemento' },
    { nombre:'Pulsera ajustable de acero', q:'pulsera acero ajustable', keyword_en:'adjustable stainless steel bracelet', volCm3:80, costoMin:1, costoMax:3, pesoG:20, nota:'Unisex' },
    { nombre:'Anillos apilables (set)', q:'anillos apilables set', keyword_en:'stackable rings set', volCm3:80, costoMin:1, costoMax:3, pesoG:20, nota:'Pack rentable' },
    { nombre:'Cadena tobillera de acero', q:'tobillera acero', keyword_en:'stainless steel anklet', volCm3:80, costoMin:1, costoMax:2.5, pesoG:15, nota:'Verano' },
    { nombre:'Piercings de acero falsos (sin perforar)', q:'piercing falso acero', keyword_en:'fake piercing stainless steel', volCm3:50, costoMin:0.8, costoMax:2, pesoG:10, nota:'Sin perforar' },
    { nombre:'Reloj-pulsera fashion económico', q:'reloj pulsera fashion mujer', keyword_en:'fashion women wrist watch', volCm3:400, costoMin:2.5, costoMax:6, pesoG:60, nota:'Ticket medio' },
    { nombre:'Set de aros de perlas sintéticas', q:'aros perla sintetica set', keyword_en:'faux pearl earrings set', volCm3:100, costoMin:1, costoMax:3, pesoG:25, nota:'Elegante' },
    { nombre:'Colgante con inicial personalizable', q:'colgante inicial acero', keyword_en:'stainless steel initial pendant necklace', volCm3:80, costoMin:1.5, costoMax:4, pesoG:25, nota:'Regalo' },
    { nombre:'Limpiador de joyas ultrasónico mini', q:'limpiador joyas ultrasonico', keyword_en:'ultrasonic jewelry cleaner', volCm3:2000, costoMin:6, costoMax:12, pesoG:300, nota:'Ticket alto' },
    { nombre:'Exhibidor de joyas para venta', q:'exhibidor joyas display', keyword_en:'jewelry display stand', volCm3:2500, costoMin:3, costoMax:7, pesoG:200, nota:'Para revendedores' },
  ]},
  relojes: { label: 'Relojes', icon: '⌚', productos: [
    { nombre:'Malla de silicona para smartwatch', q:'malla silicona smartwatch', keyword_en:'silicone smartwatch band', volCm3:150, costoMin:0.8, costoMax:2.5, pesoG:20, nota:'Recompra alta' },
    { nombre:'Reloj digital deportivo resistente', q:'reloj digital deportivo', keyword_en:'digital sports watch', volCm3:400, costoMin:3, costoMax:7, pesoG:60, nota:'Clásico' },
    { nombre:'Correa de acero milanesa para reloj', q:'correa milanesa reloj', keyword_en:'milanese loop watch strap', volCm3:150, costoMin:2, costoMax:5, pesoG:50, nota:'Upgrade estético' },
    { nombre:'Reloj analógico minimalista unisex', q:'reloj analogico minimalista', keyword_en:'minimalist analog watch', volCm3:400, costoMin:3, costoMax:8, pesoG:70, nota:'Tendencia' },
    { nombre:'Protector de pantalla para smartwatch (pack)', q:'protector smartwatch pack', keyword_en:'smartwatch screen protector pack', volCm3:100, costoMin:0.8, costoMax:2, pesoG:10, nota:'Complemento' },
    { nombre:'Estuche organizador para relojes', q:'estuche relojes organizador', keyword_en:'watch storage box organizer', volCm3:4000, costoMin:3, costoMax:7, pesoG:250, nota:'Ticket medio' },
    { nombre:'Reloj para niños con diseño', q:'reloj niños', keyword_en:'kids watch', volCm3:300, costoMin:2, costoMax:5, pesoG:60, nota:'Regalo' },
    { nombre:'Smartwatch económico básico', q:'smartwatch economico', keyword_en:'budget smartwatch', volCm3:500, costoMin:6, costoMax:13, pesoG:80, nota:'Ticket alto' },
    { nombre:'Cargador magnético para smartwatch', q:'cargador smartwatch magnetico', keyword_en:'magnetic smartwatch charger', volCm3:100, costoMin:1.5, costoMax:4, pesoG:30, nota:'Recompra' },
    { nombre:'Reloj despertador digital LED', q:'reloj despertador led', keyword_en:'led digital alarm clock', volCm3:1200, costoMin:2, costoMax:6, pesoG:150, nota:'Deco escritorio' },
    { nombre:'Correa deportiva transpirable', q:'correa reloj deportiva transpirable', keyword_en:'breathable sport watch strap', volCm3:150, costoMin:1, costoMax:3, pesoG:25, nota:'Fitness' },
    { nombre:'Soporte de carga para reloj', q:'soporte carga reloj', keyword_en:'watch charging stand', volCm3:400, costoMin:1.5, costoMax:4, pesoG:40, nota:'Complemento' },
  ]},
  iluminacion: { label: 'Iluminación / LED', icon: '💡', productos: [
    { nombre:'Lámpara LED de escritorio recargable', q:'lampara led escritorio recargable', keyword_en:'rechargeable led desk lamp', volCm3:2500, costoMin:3, costoMax:7, pesoG:200, nota:'Home office' },
    { nombre:'Tira LED USB para TV/monitor', q:'tira led usb tv', keyword_en:'usb tv backlight led strip', volCm3:400, costoMin:1.5, costoMax:4, pesoG:60, nota:'Ambiente' },
    { nombre:'Luz nocturna con sensor de movimiento', q:'luz nocturna sensor movimiento', keyword_en:'motion sensor night light', volCm3:300, costoMin:1.5, costoMax:4, pesoG:70, nota:'Pasillo/placar' },
    { nombre:'Proyector de luz galaxia/estrellas', q:'proyector galaxia estrellas', keyword_en:'galaxy star projector', volCm3:2500, costoMin:4, costoMax:9, pesoG:250, nota:'Tendencia deco' },
    { nombre:'Panel LED hexagonal modular (set)', q:'panel led hexagonal', keyword_en:'hexagon led wall panels', volCm3:4000, costoMin:6, costoMax:13, pesoG:300, nota:'Gamer/deco' },
    { nombre:'Aplique LED con panel solar exterior', q:'aplique led solar exterior', keyword_en:'solar outdoor wall light', volCm3:1200, costoMin:3, costoMax:7, pesoG:200, nota:'Sin cableado' },
    { nombre:'Aro de luz de pie para selfies', q:'aro luz pie selfie', keyword_en:'ring light with tripod stand', volCm3:3500, costoMin:6, costoMax:14, pesoG:400, nota:'Contenido/streaming' },
    { nombre:'Lámpara LED de ambiente', q:'lampara led ambiente', keyword_en:'led ambient lamp', volCm3:2000, costoMin:3, costoMax:7, pesoG:250, nota:'Deco' },
    { nombre:'Cinta LED direccionable RGBIC', q:'tira led rgbic', keyword_en:'rgbic led strip', volCm3:1000, costoMin:4, costoMax:9, pesoG:150, nota:'Efectos' },
    { nombre:'Foco LED inteligente de color', q:'foco led color', keyword_en:'color led bulb', volCm3:400, costoMin:2, costoMax:5, pesoG:90, nota:'Recompra' },
    { nombre:'Vela LED sin llama (pack)', q:'vela led sin llama pack', keyword_en:'flameless led candles pack', volCm3:1500, costoMin:1.5, costoMax:4, pesoG:120, nota:'Deco eventos' },
    { nombre:'Lámpara de lectura con clip', q:'lampara lectura clip', keyword_en:'clip on reading light', volCm3:400, costoMin:1.5, costoMax:4, pesoG:80, nota:'Práctica' },
  ]},
  gaming: { label: 'Gaming / Consolas', icon: '🎮', productos: [
    { nombre:'Grips de silicona para joystick (pack)', q:'grips joystick silicona', keyword_en:'silicone thumb grips controller', volCm3:80, costoMin:0.8, costoMax:2.5, pesoG:15, nota:'Recompra alta' },
    { nombre:'Soporte para auriculares gamer', q:'soporte auriculares gamer', keyword_en:'gaming headset stand', volCm3:2000, costoMin:3, costoMax:7, pesoG:250, nota:'Setup' },
    { nombre:'Mouse pad gamer XL con RGB', q:'mousepad gamer rgb xl', keyword_en:'xl rgb gaming mouse pad', volCm3:3000, costoMin:4, costoMax:9, pesoG:400, nota:'Ticket medio' },
    { nombre:'Gatillos/triggers para celular gamer', q:'gatillos celular gamer', keyword_en:'mobile gaming triggers', volCm3:100, costoMin:1, costoMax:3, pesoG:30, nota:'Mobile gaming' },
    { nombre:'Cooler ventilador para celular gamer', q:'cooler celular gamer', keyword_en:'phone cooler fan gaming', volCm3:400, costoMin:3, costoMax:7, pesoG:120, nota:'Anti recalentamiento' },
    { nombre:'Skins/cubre-analógicos para joystick', q:'skin joystick control', keyword_en:'controller skin cover', volCm3:300, costoMin:1, costoMax:3, pesoG:20, nota:'Personalización' },
    { nombre:'Base de carga para joysticks', q:'base carga joystick', keyword_en:'controller charging dock', volCm3:1200, costoMin:4, costoMax:9, pesoG:200, nota:'Complemento consola' },
    { nombre:'Auriculares gamer con micrófono', q:'auriculares gamer microfono', keyword_en:'gaming headset with microphone', volCm3:4000, costoMin:5, costoMax:12, pesoG:300, nota:'Ticket alto' },
    { nombre:'Luz LED ambiental para setup', q:'luz led setup gamer', keyword_en:'gaming setup led light', volCm3:1000, costoMin:2, costoMax:5, pesoG:90, nota:'Ambiente' },
    { nombre:'Organizador de juegos y controles', q:'organizador juegos consola', keyword_en:'game disc storage organizer', volCm3:3000, costoMin:3, costoMax:7, pesoG:250, nota:'Orden setup' },
    { nombre:'Adaptador de teclado y mouse para consola', q:'adaptador teclado mouse consola', keyword_en:'keyboard mouse adapter console', volCm3:200, costoMin:6, costoMax:14, pesoG:150, nota:'Nicho específico' },
    { nombre:'Dedales para mobile gaming (pack)', q:'dedales mobile gaming pack', keyword_en:'mobile gaming finger sleeves', volCm3:50, costoMin:0.8, costoMax:2, pesoG:10, nota:'Recompra' },
  ]},
  ferreteria: { label: 'Ferretería / Construcción', icon: '🔩', productos: [
    { nombre:'Cinta métrica retráctil 5m', q:'cinta metrica 5m', keyword_en:'5m tape measure', volCm3:300, costoMin:1.5, costoMax:4, pesoG:120, nota:'Uso universal' },
    { nombre:'Set de brocas para taladro', q:'set brocas taladro', keyword_en:'drill bit set', volCm3:500, costoMin:2.5, costoMax:6, pesoG:200, nota:'Recompra' },
    { nombre:'Nivel láser autonivelante mini', q:'nivel laser autonivelante', keyword_en:'self leveling laser level', volCm3:1500, costoMin:6, costoMax:13, pesoG:250, nota:'Ticket alto' },
    { nombre:'Organizador de tornillos y herrajes', q:'organizador tornillos cajas', keyword_en:'screw organizer box', volCm3:3000, costoMin:3, costoMax:7, pesoG:300, nota:'Taller' },
    { nombre:'Juego de llaves Allen (set)', q:'juego llaves allen set', keyword_en:'hex allen key set', volCm3:300, costoMin:1.5, costoMax:4, pesoG:150, nota:'Base' },
    { nombre:'Guantes de trabajo anticorte', q:'guantes trabajo anticorte', keyword_en:'cut resistant work gloves', volCm3:400, costoMin:1.5, costoMax:3.5, pesoG:90, nota:'Seguridad' },
    { nombre:'Cinta aisladora (pack)', q:'cinta aisladora pack', keyword_en:'electrical insulating tape pack', volCm3:400, costoMin:1, costoMax:3, pesoG:150, nota:'Recompra alta' },
    { nombre:'Kit de destornilladores de precisión', q:'kit destornillador precision', keyword_en:'precision screwdriver kit', volCm3:500, costoMin:2.5, costoMax:6, pesoG:200, nota:'Electrónica' },
    { nombre:'Abrazaderas metálicas (set)', q:'abrazaderas metalicas set', keyword_en:'hose clamps set', volCm3:800, costoMin:1, costoMax:3, pesoG:120, nota:'Complemento' },
    { nombre:'Cinta de teflón para plomería (pack)', q:'cinta teflon plomeria pack', keyword_en:'ptfe thread seal tape pack', volCm3:200, costoMin:0.8, costoMax:2, pesoG:50, nota:'Recompra' },
    { nombre:'Pistola de silicona caliente', q:'pistola silicona caliente', keyword_en:'hot glue gun', volCm3:1500, costoMin:2.5, costoMax:6, pesoG:250, nota:'DIY' },
    { nombre:'Linterna de trabajo LED recargable', q:'linterna trabajo led recargable', keyword_en:'rechargeable led work light', volCm3:800, costoMin:3, costoMax:7, pesoG:150, nota:'Ticket medio' },
  ]},
  musica: { label: 'Música / Instrumentos', icon: '🎸', productos: [
    { nombre:'Púas de guitarra (set variado)', q:'puas guitarra set', keyword_en:'guitar picks set', volCm3:50, costoMin:0.5, costoMax:2, pesoG:10, nota:'Recompra alta' },
    { nombre:'Afinador digital con clip', q:'afinador clip guitarra', keyword_en:'clip on guitar tuner', volCm3:150, costoMin:1.5, costoMax:4, pesoG:30, nota:'Base músico' },
    { nombre:'Cejilla/capo para guitarra', q:'capo guitarra', keyword_en:'guitar capo', volCm3:150, costoMin:1, costoMax:3, pesoG:40, nota:'Complemento' },
    { nombre:'Soporte plegable para guitarra', q:'soporte guitarra plegable', keyword_en:'foldable guitar stand', volCm3:1500, costoMin:3, costoMax:7, pesoG:300, nota:'Ticket medio' },
    { nombre:'Cable plug 6.35mm para instrumento', q:'cable plug instrumento', keyword_en:'instrument guitar cable', volCm3:800, costoMin:2, costoMax:5, pesoG:150, nota:'Recompra' },
    { nombre:'Metrónomo digital', q:'metronomo digital', keyword_en:'digital metronome', volCm3:300, costoMin:2, costoMax:5, pesoG:60, nota:'Estudio' },
    { nombre:'Micrófono condensador USB para PC', q:'microfono usb condensador', keyword_en:'usb condenser microphone', volCm3:3000, costoMin:6, costoMax:14, pesoG:250, nota:'Streaming/podcast' },
    { nombre:'Cuerdas de guitarra (set)', q:'cuerdas guitarra set', keyword_en:'guitar strings set', volCm3:150, costoMin:1.5, costoMax:4, pesoG:60, nota:'Recompra alta' },
    { nombre:'Baquetas de batería (par)', q:'baquetas bateria par', keyword_en:'drumsticks pair', volCm3:600, costoMin:1.5, costoMax:4, pesoG:120, nota:'Recompra' },
    { nombre:'Soporte para micrófono de escritorio', q:'soporte microfono escritorio', keyword_en:'desktop microphone stand', volCm3:2500, costoMin:4, costoMax:9, pesoG:300, nota:'Setup' },
    { nombre:'Kalimba 17 teclas', q:'kalimba 17 teclas', keyword_en:'17 key kalimba', volCm3:1200, costoMin:5, costoMax:11, pesoG:300, nota:'Novedad regalo' },
    { nombre:'Filtro antipop para micrófono', q:'filtro antipop microfono', keyword_en:'microphone pop filter', volCm3:1500, costoMin:2, costoMax:5, pesoG:90, nota:'Complemento' },
  ]},
  arte: { label: 'Arte / Manualidades', icon: '🎨', productos: [
    { nombre:'Set de marcadores/rotuladores (pack)', q:'set marcadores dibujo pack', keyword_en:'art markers set', volCm3:1500, costoMin:3, costoMax:7, pesoG:300, nota:'Recompra' },
    { nombre:'Tabla de dibujo con clip A4', q:'tabla dibujo clip', keyword_en:'drawing clipboard', volCm3:1500, costoMin:2, costoMax:5, pesoG:250, nota:'Base' },
    { nombre:'Set de pinceles para pintura', q:'set pinceles pintura', keyword_en:'paint brush set', volCm3:500, costoMin:2, costoMax:5, pesoG:120, nota:'Recompra' },
    { nombre:'Kit de caligrafía y lettering', q:'kit caligrafia lettering', keyword_en:'calligraphy lettering kit', volCm3:800, costoMin:3, costoMax:7, pesoG:200, nota:'Tendencia' },
    { nombre:'Cuaderno de bocetos (sketchbook)', q:'sketchbook cuaderno dibujo', keyword_en:'sketchbook drawing pad', volCm3:1200, costoMin:2, costoMax:5, pesoG:250, nota:'Recompra' },
    { nombre:'Set de acuarelas portátil', q:'set acuarelas portatil', keyword_en:'portable watercolor paint set', volCm3:400, costoMin:3, costoMax:7, pesoG:200, nota:'Regalo' },
    { nombre:'Herramientas de modelado de arcilla (set)', q:'herramientas modelado arcilla set', keyword_en:'clay sculpting tools set', volCm3:500, costoMin:2, costoMax:5, pesoG:120, nota:'Manualidades' },
    { nombre:'Pistola de silicona para manualidades', q:'pistola silicona manualidades', keyword_en:'craft hot glue gun', volCm3:800, costoMin:2.5, costoMax:6, pesoG:250, nota:'DIY' },
    { nombre:'Kit de resina epoxi con moldes', q:'kit resina epoxi moldes', keyword_en:'epoxy resin silicone molds kit', volCm3:2500, costoMin:6, costoMax:13, pesoG:400, nota:'Ticket alto tendencia' },
    { nombre:'Lápices de colores profesionales (set)', q:'lapices colores profesional set', keyword_en:'professional colored pencils set', volCm3:1200, costoMin:3, costoMax:8, pesoG:300, nota:'Regalo' },
    { nombre:'Tabla de luz LED para calcar A4', q:'tabla luz calcar led', keyword_en:'led light tracing pad', volCm3:1500, costoMin:6, costoMax:13, pesoG:400, nota:'Ticket alto' },
    { nombre:'Set de sellos para manualidades', q:'set sellos manualidades', keyword_en:'craft stamps set', volCm3:600, costoMin:2, costoMax:5, pesoG:150, nota:'Scrapbooking' },
  ]},
  energiasolar: { label: 'Energía Solar / Portátil', icon: '☀️', productos: [
    { nombre:'Cargador solar USB portátil', q:'cargador solar usb portatil', keyword_en:'portable usb solar charger', volCm3:600, costoMin:5, costoMax:11, pesoG:300, nota:'Camping/emergencia' },
    { nombre:'Luz solar de exterior con sensor', q:'luz solar exterior sensor', keyword_en:'solar motion sensor outdoor light', volCm3:800, costoMin:3, costoMax:7, pesoG:250, nota:'Recompra por pack' },
    { nombre:'Panel solar plegable 20W', q:'panel solar plegable 20w', keyword_en:'20w foldable solar panel', volCm3:3500, costoMin:12, costoMax:25, pesoG:600, nota:'Ticket alto' },
    { nombre:'Powerbank solar', q:'powerbank solar', keyword_en:'solar power bank', volCm3:500, costoMin:6, costoMax:14, pesoG:350, nota:'Outdoor' },
    { nombre:'Ventilador con panel solar', q:'ventilador solar', keyword_en:'solar powered fan', volCm3:3000, costoMin:5, costoMax:11, pesoG:300, nota:'Nicho verano' },
    { nombre:'Reflector LED solar exterior', q:'reflector led solar', keyword_en:'solar led flood light', volCm3:3000, costoMin:4, costoMax:9, pesoG:300, nota:'Seguridad' },
    { nombre:'Farol/lámpara solar recargable', q:'farol solar recargable', keyword_en:'rechargeable solar lantern', volCm3:1500, costoMin:4, costoMax:9, pesoG:300, nota:'Camping' },
    { nombre:'Guirnalda de luces solares', q:'guirnalda luces solares', keyword_en:'solar string lights', volCm3:1500, costoMin:3, costoMax:7, pesoG:200, nota:'Deco exterior' },
    { nombre:'Regulador de carga solar PWM', q:'regulador carga solar', keyword_en:'solar charge controller', volCm3:500, costoMin:5, costoMax:11, pesoG:150, nota:'Instaladores' },
    { nombre:'Bomba de agua solar para fuente', q:'bomba agua solar fuente', keyword_en:'solar fountain water pump', volCm3:800, costoMin:4, costoMax:9, pesoG:250, nota:'Jardín' },
    { nombre:'Cargador solar mantenedor para auto', q:'cargador solar auto', keyword_en:'solar car battery charger', volCm3:800, costoMin:5, costoMax:11, pesoG:300, nota:'Automotor' },
    { nombre:'Kit de luz solar para interior', q:'kit luz solar interior', keyword_en:'solar indoor light kit', volCm3:2500, costoMin:6, costoMax:13, pesoG:400, nota:'Sin instalación' },
  ]},
  fotografia: { label: 'Fotografía / Drones', icon: '📷', productos: [
    { nombre:'Trípode flexible tipo pulpo para celular', q:'tripode flexible pulpo celular', keyword_en:'flexible octopus phone tripod', volCm3:500, costoMin:2, costoMax:5, pesoG:150, nota:'Recompra alta' },
    { nombre:'Estabilizador gimbal para celular', q:'gimbal celular', keyword_en:'smartphone gimbal stabilizer', volCm3:2500, costoMin:15, costoMax:30, pesoG:400, nota:'Ticket alto' },
    { nombre:'Aro de luz con trípode', q:'aro luz tripode', keyword_en:'ring light tripod', volCm3:3500, costoMin:6, costoMax:14, pesoG:500, nota:'Contenido' },
    { nombre:'Lentes clip para celular (kit)', q:'lentes clip celular kit', keyword_en:'clip on phone lens kit', volCm3:300, costoMin:2.5, costoMax:6, pesoG:80, nota:'Complemento' },
    { nombre:'Micrófono lavalier para celular', q:'microfono lavalier celular', keyword_en:'lavalier microphone for phone', volCm3:200, costoMin:3, costoMax:7, pesoG:60, nota:'Video/vlog' },
    { nombre:'Fondo croma verde plegable', q:'fondo croma verde', keyword_en:'green screen backdrop', volCm3:3000, costoMin:6, costoMax:13, pesoG:400, nota:'Streaming' },
    { nombre:'Control bluetooth disparador para celular', q:'control bluetooth disparador celular', keyword_en:'bluetooth camera shutter remote', volCm3:80, costoMin:1, costoMax:3, pesoG:20, nota:'Recompra' },
    { nombre:'Soporte de teléfono para trípode', q:'soporte celular tripode', keyword_en:'tripod phone holder mount', volCm3:150, costoMin:1.5, costoMax:4, pesoG:60, nota:'Complemento' },
    { nombre:'Softbox difusor de luz portátil', q:'softbox portatil', keyword_en:'portable softbox light', volCm3:3000, costoMin:6, costoMax:13, pesoG:400, nota:'Producto/foto' },
    { nombre:'Estuche organizador de tarjetas de memoria', q:'estuche tarjetas memoria', keyword_en:'memory card case', volCm3:150, costoMin:1, costoMax:3, pesoG:40, nota:'Complemento' },
    { nombre:'Selfie stick con trípode y control', q:'selfie stick tripode', keyword_en:'selfie stick tripod', volCm3:500, costoMin:3, costoMax:7, pesoG:200, nota:'Recompra' },
    { nombre:'Kit de limpieza de lentes', q:'kit limpieza lentes camara', keyword_en:'camera lens cleaning kit', volCm3:500, costoMin:1.5, costoMax:4, pesoG:80, nota:'Recompra' },
  ]},
  viajes: { label: 'Viajes / Valijas', icon: '🧳', productos: [
    { nombre:'Organizadores de valija (packing cubes)', q:'packing cubes organizadores valija', keyword_en:'packing cubes luggage organizers', volCm3:3000, costoMin:3, costoMax:7, pesoG:250, nota:'Recompra alta' },
    { nombre:'Almohada de viaje cervical', q:'almohada viaje cervical', keyword_en:'travel neck pillow', volCm3:2500, costoMin:2, costoMax:5, pesoG:150, nota:'Recompra' },
    { nombre:'Adaptador universal de enchufe', q:'adaptador universal viaje', keyword_en:'universal travel adapter', volCm3:300, costoMin:3, costoMax:7, pesoG:120, nota:'Internacional' },
    { nombre:'Candado TSA para valija', q:'candado tsa valija', keyword_en:'tsa luggage lock', volCm3:150, costoMin:1.5, costoMax:4, pesoG:60, nota:'Seguridad' },
    { nombre:'Botella plegable de silicona', q:'botella plegable silicona', keyword_en:'collapsible silicone water bottle', volCm3:600, costoMin:2, costoMax:5, pesoG:120, nota:'Eco' },
    { nombre:'Balanza digital para equipaje', q:'balanza digital equipaje', keyword_en:'digital luggage scale', volCm3:300, costoMin:2, costoMax:5, pesoG:90, nota:'Evita exceso' },
    { nombre:'Neceser organizador de higiene colgante', q:'neceser colgante viaje', keyword_en:'hanging travel toiletry bag', volCm3:1500, costoMin:3, costoMax:7, pesoG:200, nota:'Regalo' },
    { nombre:'Funda protectora para valija', q:'funda valija', keyword_en:'luggage cover', volCm3:1500, costoMin:3, costoMax:7, pesoG:250, nota:'Complemento' },
    { nombre:'Riñonera antirrobo de viaje', q:'riñonera antirrobo viaje', keyword_en:'anti theft travel waist bag', volCm3:600, costoMin:3, costoMax:7, pesoG:150, nota:'Seguridad' },
    { nombre:'Etiquetas de equipaje (pack)', q:'etiquetas equipaje pack', keyword_en:'luggage tags pack', volCm3:200, costoMin:1, costoMax:3, pesoG:50, nota:'Recompra' },
    { nombre:'Powerbank/cargador portátil de viaje', q:'powerbank viaje', keyword_en:'travel power bank', volCm3:400, costoMin:6, costoMax:13, pesoG:300, nota:'Ticket alto' },
    { nombre:'Set de botellas de viaje para líquidos', q:'botellas viaje liquidos set', keyword_en:'travel toiletry bottles set', volCm3:800, costoMin:1.5, costoMax:4, pesoG:90, nota:'Avión' },
  ]},
  libreria: { label: 'Librería / Libros', icon: '📚', productos: [
    { nombre:'Set de resaltadores pastel de doble punta', q:'resaltadores pastel doble punta set', keyword_en:'dual tip pastel highlighters set', volCm3:300, costoMin:0.8, costoMax:2.2, pesoG:90, nota:'Recompra escolar' },
    { nombre:'Estuche organizador de lapices tipo rollo', q:'cartuchera rollo organizadora lapices', keyword_en:'roll up pencil case', volCm3:600, costoMin:1.2, costoMax:3.2, pesoG:120, nota:'Liviano, alto margen' },
    { nombre:'Set de plantillas de lettering y stencils', q:'plantillas lettering stencil set', keyword_en:'lettering stencil set', volCm3:500, costoMin:0.6, costoMax:1.8, pesoG:60, nota:'Muy liviano' },
    { nombre:'Separadores magneticos de pagina', q:'separadores magneticos libros', keyword_en:'magnetic bookmarks', volCm3:100, costoMin:0.5, costoMax:1.5, pesoG:30, nota:'Micro ticket, se vende en packs' },
    { nombre:'Sello personalizable autoentintable', q:'sello autoentintable personalizado', keyword_en:'custom self inking stamp', volCm3:200, costoMin:1.5, costoMax:4, pesoG:70, nota:'Diferenciacion' },
    { nombre:'Cortadora de papel manual A4', q:'guillotina papel a4 manual', keyword_en:'a4 paper trimmer', volCm3:4000, costoMin:5, costoMax:11, pesoG:900, nota:'Ticket alto, pesa' },
    { nombre:'Set de marcadores acrilicos para superficies', q:'marcadores acrilicos permanentes set', keyword_en:'acrylic paint markers set', volCm3:800, costoMin:2, costoMax:5, pesoG:180, nota:'Tendencia manualidades' },
    { nombre:'Agenda tipo bullet journal con elastico', q:'cuaderno bullet journal puntos', keyword_en:'dotted bullet journal notebook', volCm3:1000, costoMin:1.5, costoMax:4, pesoG:280, nota:'Estacional enero-marzo' },
    { nombre:'Perforadora de figuras decorativas', q:'perforadora figuras scrapbook', keyword_en:'craft shape punch scrapbook', volCm3:300, costoMin:1, costoMax:3, pesoG:150, nota:'Nicho scrapbook' },
    { nombre:'Set de clips binder de colores', q:'clips binder colores set', keyword_en:'colored binder clips set', volCm3:300, costoMin:0.4, costoMax:1.2, pesoG:110, nota:'Recompra oficina' },
    { nombre:'Portanotas adhesivo para monitor', q:'soporte notas monitor acrilico', keyword_en:'acrylic monitor memo board', volCm3:600, costoMin:0.8, costoMax:2.2, pesoG:70, nota:'Home office' },
    { nombre:'Set de sellos de goma para planificador', q:'sellos goma planner set', keyword_en:'planner rubber stamps set', volCm3:500, costoMin:1, costoMax:2.8, pesoG:90, nota:'Nicho planners' },
  ]},
  juguetes: { label: 'Juguetes / Juegos', icon: '🧸', productos: [
    { nombre:'Cubo magico de velocidad 3x3', q:'cubo magico 3x3 speed', keyword_en:'3x3 speed cube', volCm3:300, costoMin:1, costoMax:3, pesoG:100, nota:'Demanda constante' },
    { nombre:'Set de bloques magneticos de construccion', q:'bloques magneticos construccion set', keyword_en:'magnetic building tiles set', volCm3:4000, costoMin:5, costoMax:14, pesoG:600, nota:'Ticket alto, pesa' },
    { nombre:'Juguete antiestres tipo pop it', q:'pop it antiestres', keyword_en:'push bubble fidget toy', volCm3:400, costoMin:0.5, costoMax:1.8, pesoG:80, nota:'Modas, riesgo de saturacion' },
    { nombre:'Kit de slime para armar', q:'kit slime para hacer', keyword_en:'diy slime kit', volCm3:2000, costoMin:1.5, costoMax:4, pesoG:250, nota:'Contenido para redes' },
    { nombre:'Pista de autos flexible luminosa', q:'pista autos flexible luminosa', keyword_en:'glow in the dark flexible race track', volCm3:3000, costoMin:4, costoMax:10, pesoG:500, nota:'Regalo, estacional' },
    { nombre:'Juego de cartas familiar tipo UNO', q:'juego cartas familiar mesa', keyword_en:'family card game', volCm3:300, costoMin:0.8, costoMax:2.5, pesoG:130, nota:'Liviano, recompra regalo' },
    { nombre:'Set de figuras de dinosaurios', q:'set figuras dinosaurios juguete', keyword_en:'dinosaur figures toy set', volCm3:2000, costoMin:2, costoMax:6, pesoG:400, nota:'Evergreen infantil' },
    { nombre:'Lanzador de burbujas automatico', q:'maquina burbujas automatica juguete', keyword_en:'automatic bubble machine toy', volCm3:2000, costoMin:3, costoMax:8, pesoG:300, nota:'Estacional verano' },
    { nombre:'Puzzle 3D de madera para armar', q:'puzzle 3d madera armar', keyword_en:'3d wooden puzzle', volCm3:1200, costoMin:2, costoMax:6, pesoG:250, nota:'Regalo adulto y nino' },
    { nombre:'Set de masas moldeables con moldes', q:'masa moldear set moldes ninos', keyword_en:'kids play dough molds set', volCm3:2500, costoMin:2, costoMax:5, pesoG:450, nota:'Recompra' },
    { nombre:'Auto a friccion con luces', q:'auto friccion luces juguete', keyword_en:'friction powered toy car with lights', volCm3:1000, costoMin:1.5, costoMax:4, pesoG:200, nota:'Ticket bajo' },
    { nombre:'Kit de ciencia experimentos para chicos', q:'kit experimentos ciencia ninos', keyword_en:'kids science experiment kit', volCm3:3000, costoMin:4, costoMax:10, pesoG:500, nota:'Educativo, buen margen' },
  ]},
  audio: { label: 'Audio / Parlantes', icon: '🔊', productos: [
    { nombre:'Parlante bluetooth portatil mini', q:'parlante bluetooth portatil mini', keyword_en:'mini portable bluetooth speaker', volCm3:600, costoMin:4, costoMax:11, pesoG:250, nota:'Muy saturado, validar' },
    { nombre:'Auriculares in-ear con cable tipo C', q:'auriculares in ear usb c', keyword_en:'usb c in ear earphones', volCm3:150, costoMin:1.5, costoMax:4, pesoG:40, nota:'Liviano, recompra' },
    { nombre:'Soporte de auriculares para escritorio', q:'soporte auriculares escritorio', keyword_en:'desk headphone stand', volCm3:2000, costoMin:2, costoMax:5, pesoG:200, nota:'Complemento gamer' },
    { nombre:'Adaptador bluetooth para equipo de audio', q:'receptor bluetooth audio 3.5mm', keyword_en:'3.5mm bluetooth audio receiver', volCm3:100, costoMin:2, costoMax:5, pesoG:50, nota:'Nicho equipos viejos' },
    { nombre:'Microfono lavalier para celular', q:'microfono corbatero celular', keyword_en:'lavalier mic for phone', volCm3:200, costoMin:1.5, costoMax:4, pesoG:60, nota:'Creadores de contenido' },
    { nombre:'Espuma antipop para microfono', q:'antipop filtro microfono', keyword_en:'microphone pop filter', volCm3:1500, costoMin:1, costoMax:3, pesoG:80, nota:'Accesorio, poco saturado' },
    { nombre:'Cable auxiliar reforzado 3.5mm', q:'cable auxiliar 3.5mm reforzado', keyword_en:'braided 3.5mm aux cable', volCm3:150, costoMin:0.6, costoMax:1.8, pesoG:60, nota:'Micro ticket' },
    { nombre:'Almohadillas de repuesto para auriculares', q:'almohadillas repuesto auriculares', keyword_en:'replacement headphone ear pads', volCm3:300, costoMin:1, costoMax:3, pesoG:50, nota:'Recompra pura' },
    { nombre:'Amplificador de auriculares portatil', q:'amplificador auriculares portatil', keyword_en:'portable headphone amplifier', volCm3:300, costoMin:6, costoMax:15, pesoG:150, nota:'Nicho audiofilo' },
    { nombre:'Splitter de audio para dos auriculares', q:'splitter audio dos auriculares', keyword_en:'headphone splitter', volCm3:80, costoMin:0.6, costoMax:1.8, pesoG:25, nota:'Diminuto' },
    { nombre:'Estuche rigido para auriculares inalambricos', q:'estuche rigido auriculares', keyword_en:'hard headphone case', volCm3:1500, costoMin:1, costoMax:3, pesoG:90, nota:'Accesorio de accesorio' },
    { nombre:'Aislante acustico adhesivo en paneles', q:'paneles acusticos espuma adhesivos', keyword_en:'adhesive acoustic foam panels', volCm3:12000, costoMin:4, costoMax:10, pesoG:700, nota:'Streamers, pesa volumen' },
  ]},
  celulares: { label: 'Celulares / Accesorios', icon: '📱', productos: [
    { nombre:'Cargador rapido GaN de 30W', q:'cargador gan 30w usb c', keyword_en:'30w gan usb c charger', volCm3:150, costoMin:5, costoMax:12, pesoG:90, nota:'Ticket medio, buen margen' },
    { nombre:'Cable USB-C trenzado 100W', q:'cable usb c 100w trenzado', keyword_en:'100w braided usb c cable', volCm3:150, costoMin:1.2, costoMax:3.5, pesoG:70, nota:'Recompra alta' },
    { nombre:'Soporte de celular para auto magnetico', q:'soporte celular auto magnetico', keyword_en:'magnetic car phone mount', volCm3:200, costoMin:1.5, costoMax:4, pesoG:120, nota:'Evergreen' },
    { nombre:'Aro de luz clip para celular', q:'aro luz clip celular selfie', keyword_en:'clip on selfie ring light', volCm3:350, costoMin:1.5, costoMax:4, pesoG:90, nota:'Contenido, liviano' },
    { nombre:'Anillo soporte adhesivo para celular', q:'anillo soporte celular adhesivo', keyword_en:'phone ring stand grip', volCm3:60, costoMin:0.4, costoMax:1.2, pesoG:25, nota:'Micro ticket, packs' },
    { nombre:'Vidrio templado con marco de instalacion', q:'vidrio templado kit instalacion', keyword_en:'tempered glass screen protector installation kit', volCm3:200, costoMin:0.8, costoMax:2.5, pesoG:60, nota:'Alta recompra' },
    { nombre:'Estabilizador gimbal manual para celular', q:'gimbal estabilizador celular', keyword_en:'phone gimbal stabilizer', volCm3:2500, costoMin:14, costoMax:30, pesoG:450, nota:'Ticket alto, mas riesgo' },
    { nombre:'Powerbank magnetico inalambrico', q:'powerbank magnetico inalambrico', keyword_en:'magnetic wireless power bank', volCm3:400, costoMin:7, costoMax:16, pesoG:200, nota:'Bateria: revisar courier' },
    { nombre:'Lente macro clip para celular', q:'lente macro clip celular', keyword_en:'clip on macro lens phone', volCm3:150, costoMin:1.5, costoMax:4, pesoG:60, nota:'Nicho fotografia' },
    { nombre:'Soporte plegable de escritorio para celular', q:'soporte plegable escritorio celular aluminio', keyword_en:'foldable aluminum desk phone stand', volCm3:400, costoMin:1.5, costoMax:4, pesoG:130, nota:'Home office' },
    { nombre:'Funda impermeable para celular', q:'funda impermeable celular sumergible', keyword_en:'waterproof phone pouch', volCm3:200, costoMin:0.8, costoMax:2.2, pesoG:60, nota:'Estacional verano' },
    { nombre:'Kit de limpieza de puerto de carga', q:'kit limpieza puerto carga celular', keyword_en:'phone charging port cleaning kit', volCm3:150, costoMin:0.6, costoMax:2, pesoG:50, nota:'Poco saturado' },
  ]},
  informatica: { label: 'Informática / PC', icon: '🖥️', productos: [
    { nombre:'Hub USB-C 6 en 1 con HDMI', q:'hub usb c hdmi 6 en 1', keyword_en:'6 in 1 usb c hub hdmi', volCm3:200, costoMin:6, costoMax:14, pesoG:120, nota:'Ticket medio' },
    { nombre:'Soporte elevador de notebook de aluminio', q:'soporte notebook aluminio elevador', keyword_en:'aluminum laptop riser stand', volCm3:2500, costoMin:4, costoMax:10, pesoG:450, nota:'Ergonomia, pesa' },
    { nombre:'Mouse pad extendido para escritorio', q:'mouse pad extendido escritorio xl', keyword_en:'xl extended desk mat', volCm3:2500, costoMin:2, costoMax:5, pesoG:400, nota:'Volumen, no peso' },
    { nombre:'Cooler base para notebook', q:'base cooler notebook', keyword_en:'laptop cooling pad', volCm3:5000, costoMin:5, costoMax:12, pesoG:600, nota:'Pesa, ticket medio' },
    { nombre:'Adaptador WiFi USB de banda dual', q:'adaptador wifi usb doble banda', keyword_en:'dual band usb wifi adapter', volCm3:150, costoMin:3, costoMax:8, pesoG:40, nota:'Liviano, buen margen' },
    { nombre:'Organizador de cables tipo canaleta adhesiva', q:'canaleta organizadora cables escritorio', keyword_en:'desk cable raceway organizer', volCm3:1500, costoMin:1.2, costoMax:3.5, pesoG:150, nota:'Complemento setup' },
    { nombre:'Keycaps de repuesto para teclado mecanico', q:'keycaps teclado mecanico set', keyword_en:'mechanical keyboard keycaps set', volCm3:1200, costoMin:4, costoMax:12, pesoG:250, nota:'Nicho entusiasta' },
    { nombre:'Cepillo y kit de limpieza de teclado', q:'kit limpieza teclado pc', keyword_en:'keyboard cleaning kit', volCm3:400, costoMin:1, costoMax:3, pesoG:100, nota:'Poco saturado' },
    { nombre:'Cable HDMI 2.1 de alta velocidad', q:'cable hdmi 2.1 8k', keyword_en:'8k hdmi 2.1 cable', volCm3:500, costoMin:2, costoMax:6, pesoG:180, nota:'Recompra' },
    { nombre:'Case externo para disco M.2 NVMe', q:'carry disk m2 nvme usb c', keyword_en:'m.2 nvme ssd enclosure usb c', volCm3:200, costoMin:5, costoMax:12, pesoG:90, nota:'Liviano, ticket medio' },
    { nombre:'Filtro de privacidad para monitor', q:'filtro privacidad monitor', keyword_en:'monitor privacy filter', volCm3:2000, costoMin:4, costoMax:11, pesoG:350, nota:'Nicho oficina' },
    { nombre:'Webcam cover deslizante adhesivo', q:'tapa webcam deslizante', keyword_en:'sliding webcam cover', volCm3:30, costoMin:0.3, costoMax:1, pesoG:10, nota:'Micro ticket, solo packs' },
  ]},
  electrodomesticos: { label: 'Electrodomésticos', icon: '🔌', productos: [
    { nombre:'Mini pava electrica de viaje', q:'pava electrica viaje portatil', keyword_en:'portable travel electric kettle', volCm3:2500, costoMin:6, costoMax:14, pesoG:600, nota:'Pesa, ticket alto' },
    { nombre:'Batidor de leche electrico manual', q:'espumador leche electrico', keyword_en:'electric milk frother', volCm3:300, costoMin:1, costoMax:3, pesoG:90, nota:'Liviano, buen margen' },
    { nombre:'Mini picadora de alimentos manual', q:'picadora manual alimentos', keyword_en:'manual food chopper', volCm3:1500, costoMin:2, costoMax:6, pesoG:350, nota:'Cocina practica' },
    { nombre:'Balanza digital de cocina', q:'balanza digital cocina', keyword_en:'digital kitchen scale', volCm3:1200, costoMin:3, costoMax:8, pesoG:400, nota:'Evergreen' },
    { nombre:'Sellador de bolsas al vacio', q:'selladora bolsas vacio hogar', keyword_en:'household vacuum sealer', volCm3:3000, costoMin:8, costoMax:18, pesoG:800, nota:'Ticket alto, pesa' },
    { nombre:'Mini plancha de viaje plegable', q:'plancha viaje plegable portatil', keyword_en:'portable foldable travel iron', volCm3:2000, costoMin:5, costoMax:12, pesoG:600, nota:'Nicho viajes' },
    { nombre:'Removedor de pelusas electrico', q:'quita pelusas electrico ropa', keyword_en:'electric lint remover', volCm3:800, costoMin:2, costoMax:5, pesoG:200, nota:'Alta demanda, barato' },
    { nombre:'Timer digital de enchufe', q:'timer enchufe digital programable', keyword_en:'digital programmable plug timer', volCm3:400, costoMin:2, costoMax:6, pesoG:150, nota:'Ahorro energia' },
    { nombre:'Zapatilla con puertos USB y protector', q:'zapatilla usb protector picos', keyword_en:'surge protector power strip usb', volCm3:1200, costoMin:4, costoMax:10, pesoG:400, nota:'Certificacion electrica: verificar' },
    { nombre:'Aspiradora de mano inalambrica mini', q:'aspiradora mano inalambrica mini', keyword_en:'mini cordless handheld vacuum', volCm3:3000, costoMin:8, costoMax:18, pesoG:700, nota:'Ticket alto' },
    { nombre:'Repuesto de filtro para purificador', q:'filtro repuesto purificador aire', keyword_en:'air purifier replacement filter', volCm3:4000, costoMin:2, costoMax:6, pesoG:200, nota:'Recompra pura' },
    { nombre:'Calentador de tazas USB para escritorio', q:'calentador taza usb escritorio', keyword_en:'usb mug warmer', volCm3:800, costoMin:3, costoMax:8, pesoG:300, nota:'Estacional invierno' },
  ]},
  climatizacion: { label: 'Climatización / Ventilación', icon: '🌬️', productos: [
    { nombre:'Ventilador de cuello portatil recargable', q:'ventilador cuello portatil recargable', keyword_en:'rechargeable portable neck fan', volCm3:1200, costoMin:3, costoMax:8, pesoG:250, nota:'Estacional verano fuerte' },
    { nombre:'Ventilador USB de escritorio silencioso', q:'ventilador usb escritorio', keyword_en:'usb desk fan', volCm3:2000, costoMin:2, costoMax:6, pesoG:250, nota:'Verano, ticket bajo' },
    { nombre:'Termometro higrometro digital de ambiente', q:'termometro higrometro digital ambiente', keyword_en:'digital thermometer hygrometer', volCm3:200, costoMin:1.5, costoMax:4, pesoG:80, nota:'Liviano, todo el ano' },
    { nombre:'Deshumidificador de ambiente recargable', q:'deshumidificador recargable placard', keyword_en:'rechargeable closet dehumidifier', volCm3:1200, costoMin:6, costoMax:14, pesoG:500, nota:'Estacional invierno' },
    { nombre:'Filtro lavable universal para split', q:'filtro lavable aire acondicionado split', keyword_en:'washable air conditioner filter', volCm3:800, costoMin:2, costoMax:6, pesoG:200, nota:'Recompra estacional' },
    { nombre:'Kit de limpieza de aire acondicionado', q:'kit limpieza aire acondicionado split', keyword_en:'split air conditioner cleaning kit', volCm3:3000, costoMin:3, costoMax:9, pesoG:400, nota:'Nicho service' },
    { nombre:'Cortina de aire tipo burlete para puerta', q:'burlete puerta aislante termico', keyword_en:'door weather stripping seal', volCm3:1500, costoMin:1.2, costoMax:3.5, pesoG:200, nota:'Ahorro energia' },
    { nombre:'Extractor de aire de bano silencioso', q:'extractor aire bano silencioso', keyword_en:'quiet bathroom exhaust fan', volCm3:3500, costoMin:6, costoMax:14, pesoG:600, nota:'Pesa, ticket medio' },
    { nombre:'Ventilador de techo portatil para carpa', q:'ventilador carpa camping colgante', keyword_en:'hanging camping tent fan', volCm3:1500, costoMin:4, costoMax:10, pesoG:350, nota:'Cruza con camping' },
    { nombre:'Difusor humidificador ultrasonico', q:'humidificador ultrasonico difusor', keyword_en:'ultrasonic humidifier diffuser', volCm3:2500, costoMin:5, costoMax:12, pesoG:450, nota:'Muy saturado, validar' },
    { nombre:'Panel calefactor bajo escritorio', q:'calefactor panel escritorio bajo consumo', keyword_en:'low wattage desk panel heater', volCm3:3500, costoMin:8, costoMax:18, pesoG:800, nota:'Invierno, ticket alto' },
    { nombre:'Rejilla direccionadora de aire para split', q:'deflector aire acondicionado split', keyword_en:'air conditioner wind deflector', volCm3:4000, costoMin:1.5, costoMax:4, pesoG:250, nota:'Poco saturado' },
  ]},
  pesca: { label: 'Pesca / Náutica', icon: '🎣', productos: [
    { nombre:'Set de senuelos artificiales surtidos', q:'senuelos pesca set artificiales', keyword_en:'fishing lures set', volCm3:800, costoMin:2, costoMax:6, pesoG:200, nota:'Recompra, se pierden' },
    { nombre:'Caja organizadora de aparejos', q:'caja organizadora aparejos pesca', keyword_en:'fishing tackle box organizer', volCm3:3000, costoMin:2.5, costoMax:7, pesoG:400, nota:'Volumen, no peso' },
    { nombre:'Pinza de pesca con corta linea', q:'pinza pesca corta linea', keyword_en:'fishing pliers line cutter', volCm3:400, costoMin:1.5, costoMax:4, pesoG:120, nota:'Accesorio, buen margen' },
    { nombre:'Linterna frontal para pesca nocturna', q:'linterna frontal led recargable', keyword_en:'rechargeable led headlamp', volCm3:400, costoMin:2, costoMax:6, pesoG:150, nota:'Cruza con camping' },
    { nombre:'Portacana de aluminio para bote', q:'portacana aluminio soporte bote', keyword_en:'aluminum boat rod holder', volCm3:800, costoMin:4, costoMax:11, pesoG:400, nota:'Nautica, nicho' },
    { nombre:'Balanza digital con cinta para peces', q:'balanza digital pesca gancho', keyword_en:'digital fishing hook scale', volCm3:300, costoMin:2, costoMax:6, pesoG:180, nota:'Nicho especifico' },
    { nombre:'Guante de pesca antideslizante', q:'guante pesca antideslizante', keyword_en:'non slip fishing gloves', volCm3:300, costoMin:1.5, costoMax:4, pesoG:100, nota:'Recompra' },
    { nombre:'Copo / red de mano plegable', q:'copo pesca plegable red mano', keyword_en:'folding fishing landing net', volCm3:3000, costoMin:4, costoMax:10, pesoG:450, nota:'Volumen alto' },
    { nombre:'Alarma sonora de picada para cana', q:'alarma picada pesca electronica', keyword_en:'electronic fishing bite alarm', volCm3:300, costoMin:2, costoMax:6, pesoG:80, nota:'Poco saturado' },
    { nombre:'Bolso porta senuelos impermeable', q:'bolso pesca impermeable senuelos', keyword_en:'waterproof fishing tackle bag', volCm3:6000, costoMin:5, costoMax:12, pesoG:500, nota:'Ticket medio' },
    { nombre:'Set de plomadas y anzuelos surtidos', q:'set anzuelos plomadas pesca', keyword_en:'fishing hooks sinkers set', volCm3:400, costoMin:1.5, costoMax:4, pesoG:250, nota:'Recompra pura' },
    { nombre:'Chaleco salvavidas inflable manual', q:'chaleco salvavidas inflable', keyword_en:'inflatable life vest', volCm3:1500, costoMin:10, costoMax:22, pesoG:600, nota:'Certificacion: verificar' },
  ]},
  bicicletas: { label: 'Bicicletas / Ciclismo', icon: '🚲', productos: [
    { nombre:'Luz trasera LED recargable USB', q:'luz trasera bicicleta led recargable', keyword_en:'rechargeable led bike tail light', volCm3:200, costoMin:1.5, costoMax:4, pesoG:60, nota:'Recompra, liviano' },
    { nombre:'Soporte de celular para manubrio', q:'soporte celular bicicleta manubrio', keyword_en:'bike handlebar phone mount', volCm3:500, costoMin:1.5, costoMax:4, pesoG:100, nota:'Evergreen' },
    { nombre:'Inflador de mano compacto con manometro', q:'inflador bicicleta mano manometro', keyword_en:'bike hand pump with gauge', volCm3:600, costoMin:3, costoMax:8, pesoG:200, nota:'Utilidad real' },
    { nombre:'Kit de parche y desarmadores de cubierta', q:'kit parche bicicleta cubierta', keyword_en:'bike tire patch kit', volCm3:150, costoMin:1, costoMax:3, pesoG:120, nota:'Recompra' },
    { nombre:'Bolso de cuadro impermeable', q:'bolso cuadro bicicleta impermeable', keyword_en:'waterproof bike frame bag', volCm3:1500, costoMin:3, costoMax:8, pesoG:250, nota:'Buen margen' },
    { nombre:'Multiherramienta plegable para bici', q:'multiherramienta bicicleta plegable', keyword_en:'folding bike multi tool', volCm3:200, costoMin:2.5, costoMax:7, pesoG:180, nota:'Compacto' },
    { nombre:'Guantes de ciclismo con gel', q:'guantes ciclismo gel', keyword_en:'gel cycling gloves', volCm3:400, costoMin:2.5, costoMax:7, pesoG:120, nota:'Talles: cuidado stock' },
    { nombre:'Ciclocomputadora inalambrica', q:'ciclocomputadora inalambrica bicicleta', keyword_en:'wireless bike computer speedometer', volCm3:300, costoMin:4, costoMax:10, pesoG:100, nota:'Ticket medio' },
    { nombre:'Pedales de aluminio con pins', q:'pedales aluminio bicicleta mtb', keyword_en:'aluminum mtb bike pedals', volCm3:1500, costoMin:5, costoMax:12, pesoG:400, nota:'Pesa, ticket medio' },
    { nombre:'Candado plegable antirrobo', q:'candado bicicleta plegable antirrobo', keyword_en:'folding bike lock', volCm3:1200, costoMin:6, costoMax:15, pesoG:900, nota:'Pesa mucho' },
    { nombre:'Guardabarros rapido desmontable', q:'guardabarro bicicleta desmontable mtb', keyword_en:'detachable mtb bike fender', volCm3:2500, costoMin:2, costoMax:6, pesoG:200, nota:'Estacional lluvia' },
    { nombre:'Cinta de manubrio para ruta', q:'cinta manubrio bicicleta ruta', keyword_en:'road bike handlebar tape', volCm3:600, costoMin:2, costoMax:6, pesoG:120, nota:'Recompra nicho ruta' },
  ]},
  sexshop: { label: 'Sex Shop / Intimidad', icon: '💋', productos: [
    { nombre:'Aceite de masaje corporal con aroma', q:'aceite masaje corporal', keyword_en:'body massage oil', volCm3:300, costoMin:1.5, costoMax:4, pesoG:250, nota:'Liquido: revisar courier' },
    { nombre:'Vela de masaje aromatica', q:'vela masaje aromatica', keyword_en:'scented massage candle', volCm3:500, costoMin:2, costoMax:5, pesoG:200, nota:'Regalo, buen margen' },
    { nombre:'Juego de cartas para parejas', q:'juego cartas parejas', keyword_en:'couples card game', volCm3:300, costoMin:1, costoMax:3, pesoG:120, nota:'Liviano, alto margen' },
    { nombre:'Antifaz de seda para dormir', q:'antifaz seda dormir', keyword_en:'silk sleep eye mask', volCm3:200, costoMin:0.8, costoMax:2.5, pesoG:40, nota:'Cruza con descanso' },
    { nombre:'Set de lenceria en caja regalo', q:'lenceria set caja regalo', keyword_en:'lingerie set gift box', volCm3:1200, costoMin:3, costoMax:9, pesoG:200, nota:'Talles: complejo' },
    { nombre:'Ligas y accesorios de lenceria', q:'liga lenceria accesorio', keyword_en:'lingerie garter belt', volCm3:200, costoMin:1, costoMax:3, pesoG:60, nota:'Liviano' },
    { nombre:'Kit de bienestar intimo en caja', q:'kit regalo parejas caja', keyword_en:'couples gift box kit', volCm3:1500, costoMin:4, costoMax:10, pesoG:400, nota:'Ticket alto, San Valentin' },
    { nombre:'Almohada de posicionamiento para pareja', q:'almohada posicion pareja', keyword_en:'positioning wedge pillow', volCm3:8000, costoMin:6, costoMax:14, pesoG:800, nota:'Volumen alto' },
    { nombre:'Esposas de tela con velcro', q:'esposas tela velcro', keyword_en:'fabric velcro restraints', volCm3:400, costoMin:1.5, costoMax:4, pesoG:120, nota:'Nicho, poco saturado' },
    { nombre:'Pluma y accesorios de juego sensorial', q:'pluma juego sensorial pareja', keyword_en:'feather tickler', volCm3:500, costoMin:1, costoMax:3, pesoG:60, nota:'Micro ticket' },
    { nombre:'Bolsa organizadora discreta con cierre', q:'bolsa organizadora discreta cierre', keyword_en:'discreet zipper storage bag', volCm3:1000, costoMin:1.5, costoMax:4, pesoG:100, nota:'Complemento' },
    { nombre:'Gel de masaje efecto calor', q:'gel masaje efecto calor', keyword_en:'warming massage gel', volCm3:250, costoMin:1.5, costoMax:4, pesoG:200, nota:'Cosmetico: ANMAT, verificar' },
  ]},
  esoterismo: { label: 'Esoterismo / Velas', icon: '🔮', productos: [
    { nombre:'Set de velas de soja aromaticas chicas', q:'velas soja aromaticas set', keyword_en:'scented soy candles set', volCm3:1500, costoMin:2, costoMax:6, pesoG:400, nota:'Recompra alta' },
    { nombre:'Quemador de sahumerios de ceramica', q:'porta sahumerios ceramica', keyword_en:'ceramic incense holder', volCm3:400, costoMin:1.5, costoMax:4, pesoG:200, nota:'Fragil: embalaje' },
    { nombre:'Set de piedras y minerales naturales', q:'set piedras minerales naturales', keyword_en:'natural crystal stones set', volCm3:500, costoMin:3, costoMax:9, pesoG:350, nota:'Alto margen percibido' },
    { nombre:'Mazo de cartas de tarot con guia', q:'cartas tarot mazo guia', keyword_en:'tarot cards deck with guidebook', volCm3:400, costoMin:2, costoMax:6, pesoG:200, nota:'Nicho con comunidad' },
    { nombre:'Pendulo de cristal con cadena', q:'pendulo cristal radiestesia', keyword_en:'crystal pendulum dowsing', volCm3:100, costoMin:1.5, costoMax:4, pesoG:60, nota:'Liviano, buen margen' },
    { nombre:'Atrapasuenos decorativo', q:'atrapasuenos decorativo', keyword_en:'decorative dream catcher', volCm3:800, costoMin:1.5, costoMax:5, pesoG:150, nota:'Volumen alto' },
    { nombre:'Cuenco tibetano chico con mazo', q:'cuenco tibetano chico', keyword_en:'small tibetan singing bowl', volCm3:1500, costoMin:5, costoMax:13, pesoG:500, nota:'Ticket alto, pesa' },
    { nombre:'Difusor de aceites esenciales de ceramica', q:'difusor aceites esenciales ceramica', keyword_en:'ceramic essential oil diffuser', volCm3:1500, costoMin:3, costoMax:8, pesoG:400, nota:'Fragil' },
    { nombre:'Mantel / pano de tarot bordado', q:'pano tarot mantel', keyword_en:'tarot altar cloth', volCm3:300, costoMin:2, costoMax:6, pesoG:150, nota:'Complemento del mazo' },
    { nombre:'Pulsera de piedras energeticas', q:'pulsera piedras energeticas', keyword_en:'natural stone bead bracelet', volCm3:80, costoMin:0.8, costoMax:2.5, pesoG:40, nota:'Micro ticket, packs' },
    { nombre:'Portavela de vidrio con tapa', q:'portavela vidrio con tapa', keyword_en:'glass candle jar with lid', volCm3:800, costoMin:1.5, costoMax:4, pesoG:300, nota:'Fragil, pesa' },
    { nombre:'Set de sahumerios importados surtidos', q:'sahumerios set surtido', keyword_en:'assorted incense sticks set', volCm3:300, costoMin:1, costoMax:3, pesoG:150, nota:'Recompra pura' },
  ]},
  seguridad: { label: 'Seguridad / Cámaras', icon: '🎥', productos: [
    { nombre:'Camara WiFi interior con vision nocturna', q:'camara wifi interior vision nocturna', keyword_en:'indoor wifi camera night vision', volCm3:800, costoMin:8, costoMax:18, pesoG:300, nota:'Ticket alto, competitivo' },
    { nombre:'Sensor de apertura de puerta WiFi', q:'sensor apertura puerta wifi alarma', keyword_en:'wifi door sensor alarm', volCm3:200, costoMin:3, costoMax:8, pesoG:80, nota:'Liviano, poco saturado' },
    { nombre:'Alarma personal de bolsillo con sirena', q:'alarma personal bolsillo sirena', keyword_en:'personal safety alarm keychain', volCm3:150, costoMin:1.5, costoMax:4, pesoG:60, nota:'Muy liviano, alto margen' },
    { nombre:'Mirilla digital para puerta', q:'mirilla digital puerta camara', keyword_en:'digital door peephole camera', volCm3:1000, costoMin:10, costoMax:22, pesoG:400, nota:'Ticket alto' },
    { nombre:'Detector de humo autonomo', q:'detector humo autonomo bateria', keyword_en:'battery smoke detector', volCm3:600, costoMin:3, costoMax:8, pesoG:200, nota:'Certificacion: verificar' },
    { nombre:'Caja fuerte chica con clave', q:'caja fuerte chica clave digital', keyword_en:'small digital safe box', volCm3:12000, costoMin:12, costoMax:28, pesoG:2500, nota:'Pesa mucho: flete caro' },
    { nombre:'Soporte de pared para camara de seguridad', q:'soporte pared camara seguridad', keyword_en:'security camera wall mount', volCm3:400, costoMin:2, costoMax:6, pesoG:200, nota:'Complemento' },
    { nombre:'Cartel disuasivo de alarma y camara', q:'cartel disuasivo alarma camara', keyword_en:'security camera warning sign', volCm3:600, costoMin:0.5, costoMax:1.8, pesoG:60, nota:'Micro ticket, packs' },
    { nombre:'Rastreador bluetooth tipo llavero', q:'rastreador bluetooth llavero localizador', keyword_en:'bluetooth key finder tracker', volCm3:100, costoMin:2, costoMax:6, pesoG:30, nota:'Diminuto, buen margen' },
    { nombre:'Cerradura inteligente para portamaletas', q:'candado huella digital', keyword_en:'fingerprint padlock', volCm3:300, costoMin:5, costoMax:13, pesoG:150, nota:'Poco saturado' },
    { nombre:'Traba de seguridad para cajones y placard', q:'traba seguridad cajones bebes', keyword_en:'child safety cabinet locks', volCm3:300, costoMin:0.8, costoMax:2.5, pesoG:100, nota:'Cruza con bebes' },
    { nombre:'Detector de billetes falsos portatil', q:'detector billetes falsos portatil', keyword_en:'portable counterfeit money detector', volCm3:300, costoMin:3, costoMax:9, pesoG:200, nota:'Nicho comercios' },
  ]},
  pintura: { label: 'Pinturería', icon: '🖌️', productos: [
    { nombre:'Set de rodillos y bandeja para pintar', q:'set rodillo bandeja pintura', keyword_en:'paint roller tray set', volCm3:4000, costoMin:2.5, costoMax:7, pesoG:500, nota:'Volumen alto' },
    { nombre:'Cinta de enmascarar de precision', q:'cinta enmascarar pintura precision', keyword_en:'precision masking tape painting', volCm3:400, costoMin:1, costoMax:3, pesoG:150, nota:'Recompra pura' },
    { nombre:'Pistola pulverizadora manual para pintura', q:'pistola pintura manual pulverizador', keyword_en:'manual paint spray gun', volCm3:2500, costoMin:8, costoMax:18, pesoG:900, nota:'Ticket alto, pesa' },
    { nombre:'Set de espatulas y llanas plasticas', q:'set espatulas plasticas pintura', keyword_en:'plastic putty knife set', volCm3:500, costoMin:1.5, costoMax:4, pesoG:250, nota:'Ticket bajo' },
    { nombre:'Mezclador de pintura para taladro', q:'mezclador pintura taladro', keyword_en:'drill paint mixer', volCm3:1500, costoMin:2, costoMax:6, pesoG:300, nota:'Complemento herramientas' },
    { nombre:'Guarda cantos y protector de zocalo', q:'protector zocalo pintura guia', keyword_en:'paint edger guide tool', volCm3:1500, costoMin:2, costoMax:6, pesoG:300, nota:'Poco saturado' },
    { nombre:'Set de pinceles de artista surtidos', q:'set pinceles artista surtidos', keyword_en:'assorted artist brushes set', volCm3:500, costoMin:1.5, costoMax:4, pesoG:120, nota:'Cruza con arte' },
    { nombre:'Rodillo de textura decorativa', q:'rodillo textura decorativa pared', keyword_en:'decorative texture paint roller', volCm3:1500, costoMin:2, costoMax:6, pesoG:200, nota:'Nicho deco' },
    { nombre:'Mono descartable para pintar', q:'mameluco descartable pintor', keyword_en:'disposable painter coverall', volCm3:800, costoMin:1.5, costoMax:4, pesoG:200, nota:'Recompra, talles simples' },
    { nombre:'Lija de esponja de grano surtido', q:'lija esponja grano surtido', keyword_en:'sanding sponge assorted grit', volCm3:600, costoMin:1, costoMax:3, pesoG:150, nota:'Recompra' },
    { nombre:'Extensor telescopico para rodillo', q:'extensor telescopico rodillo pintura', keyword_en:'telescopic paint roller extension pole', volCm3:3000, costoMin:4, costoMax:10, pesoG:500, nota:'Largo: flete' },
    { nombre:'Lampara de trabajo LED portatil', q:'lampara trabajo led portatil recargable', keyword_en:'portable rechargeable led work lamp', volCm3:1200, costoMin:4, costoMax:11, pesoG:350, nota:'Cruza con herramientas' },
  ]},
  textil: { label: 'Textil / Mercería', icon: '🧵', productos: [
    { nombre:'Set de agujas de coser surtidas con enhebrador', q:'set agujas coser enhebrador', keyword_en:'sewing needles set with threader', volCm3:100, costoMin:0.6, costoMax:2, pesoG:60, nota:'Micro ticket, packs' },
    { nombre:'Maquina de coser portatil manual', q:'maquina coser portatil manual', keyword_en:'handheld portable sewing machine', volCm3:600, costoMin:5, costoMax:12, pesoG:600, nota:'Ticket alto, pesa' },
    { nombre:'Cortador rotativo con base de corte', q:'cortador rotativo tela base corte', keyword_en:'rotary fabric cutter with cutting mat', volCm3:3000, costoMin:4, costoMax:11, pesoG:500, nota:'Nicho patchwork' },
    { nombre:'Set de hilos de colores surtidos', q:'set hilos coser colores', keyword_en:'sewing thread spools set', volCm3:800, costoMin:1.5, costoMax:4, pesoG:250, nota:'Recompra pura' },
    { nombre:'Alfileres de cabeza de vidrio con alfiletero', q:'alfileres cabeza vidrio alfiletero', keyword_en:'glass head pins with pincushion', volCm3:300, costoMin:0.8, costoMax:2.5, pesoG:120, nota:'Recompra' },
    { nombre:'Cinta metrica de modista retractil', q:'cinta metrica modista', keyword_en:'tailor measuring tape', volCm3:100, costoMin:0.5, costoMax:1.5, pesoG:40, nota:'Micro ticket' },
    { nombre:'Prensatelas de repuesto surtidos', q:'prensatelas repuesto maquina coser', keyword_en:'sewing machine presser feet set', volCm3:400, costoMin:3, costoMax:8, pesoG:200, nota:'Nicho, poco saturado' },
    { nombre:'Botones a presion con pinza colocadora', q:'broches presion pinza colocadora', keyword_en:'snap fasteners kit with pliers', volCm3:800, costoMin:3, costoMax:8, pesoG:300, nota:'Alto margen percibido' },
    { nombre:'Aplicaciones y parches termoadhesivos', q:'parches termoadhesivos aplicaciones', keyword_en:'iron on patches', volCm3:200, costoMin:0.8, costoMax:2.5, pesoG:60, nota:'Liviano, tendencia' },
    { nombre:'Deshilachador y descosedor de costuras', q:'descosedor costuras', keyword_en:'seam ripper', volCm3:50, costoMin:0.4, costoMax:1.2, pesoG:25, nota:'Micro ticket' },
    { nombre:'Set de elasticos y cintas surtidas', q:'set elasticos cintas mercería', keyword_en:'elastic bands sewing set', volCm3:500, costoMin:1.5, costoMax:4, pesoG:200, nota:'Recompra' },
    { nombre:'Maniqui de mesa regulable chico', q:'maniqui mesa regulable costura', keyword_en:'adjustable dress form mannequin', volCm3:40000, costoMin:12, costoMax:28, pesoG:2000, nota:'Pesa mucho: evaluar flete' },
  ]},
  calzado: { label: 'Calzado / Zapatillas', icon: '👟', productos: [
    { nombre:'Plantillas ortopedicas de gel', q:'plantillas gel ortopedicas', keyword_en:'orthopedic gel insoles', volCm3:800, costoMin:1.5, costoMax:4, pesoG:120, nota:'Recompra, sin talle exacto' },
    { nombre:'Cordones elasticos sin atar con traba', q:'cordones elasticos sin atar', keyword_en:'elastic no tie shoelaces', volCm3:150, costoMin:0.6, costoMax:2, pesoG:50, nota:'Micro ticket, packs' },
    { nombre:'Kit de limpieza de zapatillas', q:'kit limpieza zapatillas', keyword_en:'sneaker cleaning kit', volCm3:800, costoMin:2, costoMax:6, pesoG:300, nota:'Recompra, buen margen' },
    { nombre:'Protector de arrugas para puntera', q:'protector arrugas zapatillas', keyword_en:'sneaker crease protectors', volCm3:300, costoMin:1, costoMax:3, pesoG:80, nota:'Nicho sneakerhead' },
    { nombre:'Horma expandidora de calzado', q:'horma expandidora zapatos', keyword_en:'shoe stretcher', volCm3:2500, costoMin:3, costoMax:8, pesoG:400, nota:'Poco saturado' },
    { nombre:'Taloneras antirozadura de silicona', q:'taloneras silicona antirozadura', keyword_en:'silicone heel grips', volCm3:150, costoMin:0.8, costoMax:2.5, pesoG:40, nota:'Recompra' },
    { nombre:'Organizador apilable de zapatillas', q:'organizador apilable zapatillas caja', keyword_en:'stackable shoe storage box', volCm3:12000, costoMin:2.5, costoMax:7, pesoG:400, nota:'Volumen alto' },
    { nombre:'Cepillo de cerdas para gamuza', q:'cepillo gamuza calzado', keyword_en:'suede shoe brush', volCm3:300, costoMin:1, costoMax:3, pesoG:80, nota:'Complemento kit' },
    { nombre:'Secador de calzado electrico', q:'secador calzado electrico', keyword_en:'electric shoe dryer', volCm3:1500, costoMin:5, costoMax:12, pesoG:500, nota:'Estacional invierno' },
    { nombre:'Bolsa de viaje para zapatos', q:'bolsa viaje zapatos organizadora', keyword_en:'travel shoe bags', volCm3:800, costoMin:1, costoMax:3, pesoG:80, nota:'Cruza con viajes' },
    { nombre:'Impermeabilizante en spray para calzado', q:'impermeabilizante spray calzado', keyword_en:'waterproof shoe spray', volCm3:500, costoMin:1.5, costoMax:4, pesoG:250, nota:'Aerosol: revisar courier' },
    { nombre:'Media invisible antideslizante pack', q:'medias invisibles antideslizantes pack', keyword_en:'no show non slip socks pack', volCm3:300, costoMin:1, costoMax:3, pesoG:80, nota:'Recompra pura' },
  ]},
  reposteria: { label: 'Repostería / Panadería', icon: '🧁', productos: [
    { nombre:'Set de boquillas de decoracion con manga', q:'boquillas reposteria set manga', keyword_en:'piping tips set with bags', volCm3:500, costoMin:2, costoMax:6, pesoG:250, nota:'Alto margen, liviano' },
    { nombre:'Molde de silicona para tortas y budines', q:'molde silicona torta budin', keyword_en:'silicone cake loaf mold', volCm3:1500, costoMin:1.5, costoMax:4, pesoG:200, nota:'Volumen, no peso' },
    { nombre:'Termometro digital de cocina con sonda', q:'termometro digital cocina sonda', keyword_en:'digital probe kitchen thermometer', volCm3:250, costoMin:2, costoMax:6, pesoG:100, nota:'Liviano, utilidad real' },
    { nombre:'Base giratoria para decorar tortas', q:'base giratoria decorar tortas', keyword_en:'cake decorating turntable', volCm3:5000, costoMin:4, costoMax:11, pesoG:700, nota:'Pesa, ticket medio' },
    { nombre:'Set de cortantes de galletitas', q:'cortantes galletitas set', keyword_en:'cookie cutters set', volCm3:800, costoMin:1.5, costoMax:4, pesoG:200, nota:'Estacional fiestas' },
    { nombre:'Espatula y alisador de tortas', q:'espatula alisadora tortas', keyword_en:'cake scraper smoother', volCm3:300, costoMin:1.5, costoMax:4, pesoG:150, nota:'Complemento' },
    { nombre:'Moldes de bombones de policarbonato', q:'molde bombones policarbonato', keyword_en:'polycarbonate chocolate mold', volCm3:1500, costoMin:4, costoMax:11, pesoG:400, nota:'Nicho pastelero, pascuas' },
    { nombre:'Set de capsulas y wrappers para cupcakes', q:'capsulas cupcakes wrappers set', keyword_en:'cupcake liners wrappers set', volCm3:600, costoMin:1, costoMax:3, pesoG:120, nota:'Recompra pura' },
    { nombre:'Balanza digital de precision para gramos', q:'balanza precision gramos reposteria', keyword_en:'precision gram scale baking', volCm3:300, costoMin:2.5, costoMax:7, pesoG:200, nota:'Liviano, buen margen' },
    { nombre:'Sellos e impresores para fondant', q:'sellos fondant impresores', keyword_en:'fondant embosser stamps', volCm3:500, costoMin:2, costoMax:6, pesoG:150, nota:'Nicho, poco saturado' },
    { nombre:'Manga repostera reutilizable de silicona', q:'manga repostera silicona reutilizable', keyword_en:'reusable silicone piping bag', volCm3:300, costoMin:1, costoMax:3, pesoG:100, nota:'Recompra' },
    { nombre:'Bandeja y cajas para transportar tortas', q:'caja transporte torta bandeja', keyword_en:'cake carrier box', volCm3:15000, costoMin:2, costoMax:6, pesoG:300, nota:'Volumen alto, revisar flete' },
  ]},
  vinos: { label: 'Vinos / Bebidas', icon: '🍷', productos: [
    { nombre:'Aireador de vino de pico', q:'aireador vino pico decantador', keyword_en:'wine aerator pourer', volCm3:300, costoMin:1.5, costoMax:4, pesoG:100, nota:'Regalo, alto margen' },
    { nombre:'Sacacorchos de camarero profesional', q:'sacacorchos camarero profesional', keyword_en:'waiters corkscrew', volCm3:150, costoMin:1.5, costoMax:4, pesoG:100, nota:'Evergreen' },
    { nombre:'Tapon al vacio para botella', q:'tapon vacio botella vino', keyword_en:'wine bottle vacuum stopper', volCm3:150, costoMin:1, costoMax:3, pesoG:60, nota:'Micro ticket, packs' },
    { nombre:'Set de piedras de whisky con pinza', q:'piedras whisky set', keyword_en:'whiskey stones set', volCm3:500, costoMin:2, costoMax:6, pesoG:400, nota:'Regalo, pesa' },
    { nombre:'Coctelera de acero con set de barman', q:'coctelera acero set barman', keyword_en:'stainless steel cocktail shaker set', volCm3:2500, costoMin:6, costoMax:15, pesoG:900, nota:'Ticket alto, pesa' },
    { nombre:'Termometro de collar para botella', q:'termometro collar botella vino', keyword_en:'wine bottle thermometer', volCm3:100, costoMin:1, costoMax:3, pesoG:50, nota:'Nicho, liviano' },
    { nombre:'Dispenser dosificador para botella', q:'dosificador pico vertedor botella', keyword_en:'bottle pourer spout', volCm3:100, costoMin:0.6, costoMax:2, pesoG:40, nota:'Recompra bares' },
    { nombre:'Enfriador de botella en manga de gel', q:'enfriador botella manga gel', keyword_en:'gel wine bottle cooler sleeve', volCm3:600, costoMin:1.5, costoMax:4, pesoG:200, nota:'Estacional verano' },
    { nombre:'Set de marcadores de copas', q:'marcadores copas set fiesta', keyword_en:'wine glass charms markers', volCm3:100, costoMin:0.5, costoMax:1.8, pesoG:40, nota:'Micro ticket, cruza cotillon' },
    { nombre:'Bomba y tapon de conservacion al vacio', q:'bomba vacio vino conservador', keyword_en:'wine vacuum pump preserver', volCm3:400, costoMin:2, costoMax:6, pesoG:120, nota:'Utilidad real' },
    { nombre:'Porta botellas de pared decorativo', q:'porta botellas pared decorativo', keyword_en:'wall mounted wine rack', volCm3:2000, costoMin:3, costoMax:9, pesoG:500, nota:'Deco, pesa' },
    { nombre:'Bolso termico para dos botellas', q:'bolso termico botellas vino', keyword_en:'insulated wine bottle bag', volCm3:2000, costoMin:3, costoMax:8, pesoG:300, nota:'Regalo, volumen' },
  ]},
  limpieza: { label: 'Limpieza / Hogar', icon: '🧽', productos: [
    { nombre:'Mopa giratoria con balde escurridor', q:'mopa giratoria balde escurridor', keyword_en:'spin mop bucket set', volCm3:25000, costoMin:8, costoMax:18, pesoG:2000, nota:'Pesa mucho: flete caro' },
    { nombre:'Cepillo electrico multiuso recargable', q:'cepillo electrico limpieza recargable', keyword_en:'rechargeable electric cleaning brush', volCm3:1500, costoMin:5, costoMax:12, pesoG:400, nota:'Ticket medio' },
    { nombre:'Set de panos de microfibra', q:'panos microfibra set limpieza', keyword_en:'microfiber cleaning cloths set', volCm3:800, costoMin:1.5, costoMax:4, pesoG:250, nota:'Recompra pura' },
    { nombre:'Limpiavidrios magnetico de doble cara', q:'limpiavidrios magnetico doble cara', keyword_en:'magnetic double sided window cleaner', volCm3:1500, costoMin:3, costoMax:9, pesoG:300, nota:'Nicho altura' },
    { nombre:'Cepillo de ranuras y juntas', q:'cepillo ranuras juntas limpieza', keyword_en:'grout gap cleaning brush', volCm3:400, costoMin:1, costoMax:3, pesoG:100, nota:'Micro ticket viral' },
    { nombre:'Dispenser de jabon automatico con sensor', q:'dispenser jabon automatico sensor', keyword_en:'automatic sensor soap dispenser', volCm3:1200, costoMin:4, costoMax:11, pesoG:350, nota:'Ticket medio' },
    { nombre:'Escurridor de trapo de piso con mango', q:'escurridor trapo piso mango', keyword_en:'floor squeegee mop', volCm3:3000, costoMin:3, costoMax:8, pesoG:600, nota:'Pesa' },
    { nombre:'Recogedor de pelos para lavarropas', q:'atrapa pelos lavarropas', keyword_en:'washing machine lint catcher', volCm3:300, costoMin:0.5, costoMax:1.8, pesoG:40, nota:'Micro ticket, packs' },
    { nombre:'Organizador de ducha adhesivo sin taladro', q:'organizador ducha adhesivo sin taladro', keyword_en:'adhesive shower caddy no drill', volCm3:2500, costoMin:2.5, costoMax:7, pesoG:350, nota:'Volumen' },
    { nombre:'Guantes de limpieza reutilizables largos', q:'guantes limpieza largos reutilizables', keyword_en:'reusable long cleaning gloves', volCm3:300, costoMin:1, costoMax:3, pesoG:120, nota:'Recompra' },
    { nombre:'Cepillo de inodoro con base cerrada', q:'cepillo inodoro base cerrada', keyword_en:'toilet brush with closed holder', volCm3:3000, costoMin:2, costoMax:6, pesoG:400, nota:'Volumen alto' },
    { nombre:'Bolsas de residuos con aroma pack', q:'bolsas residuos aroma pack', keyword_en:'scented trash bags pack', volCm3:800, costoMin:1.5, costoMax:4, pesoG:400, nota:'Recompra, margen bajo' },
  ]},
  organizacion: { label: 'Organización / Guardado', icon: '📦', productos: [
    { nombre:'Bolsas de vacio para ropa con bomba', q:'bolsas vacio ropa bomba', keyword_en:'vacuum storage bags with pump', volCm3:2000, costoMin:3, costoMax:8, pesoG:400, nota:'Alta demanda estacional' },
    { nombre:'Cajas organizadoras plegables de tela', q:'cajas organizadoras plegables tela', keyword_en:'foldable fabric storage boxes', volCm3:3000, costoMin:2, costoMax:6, pesoG:300, nota:'Volumen alto' },
    { nombre:'Divisores ajustables para cajones', q:'divisores cajones ajustables', keyword_en:'adjustable drawer dividers', volCm3:2400, costoMin:2, costoMax:6, pesoG:250, nota:'Poco saturado' },
    { nombre:'Organizador colgante de puerta multiuso', q:'organizador colgante puerta zapatos', keyword_en:'over door hanging shoe organizer', volCm3:1500, costoMin:2.5, costoMax:7, pesoG:400, nota:'Volumen' },
    { nombre:'Ganchos adhesivos de alta carga', q:'ganchos adhesivos alta carga pack', keyword_en:'heavy duty adhesive hooks pack', volCm3:300, costoMin:1, costoMax:3, pesoG:100, nota:'Recompra, packs' },
    { nombre:'Organizador de cables tipo velcro', q:'precintos velcro organizador cables', keyword_en:'reusable velcro cable ties', volCm3:200, costoMin:0.6, costoMax:2, pesoG:60, nota:'Micro ticket' },
    { nombre:'Cesto plegable de ropa sucia', q:'cesto plegable ropa sucia', keyword_en:'collapsible laundry basket', volCm3:3000, costoMin:3, costoMax:8, pesoG:500, nota:'Volumen alto' },
    { nombre:'Perchas antideslizantes de terciopelo pack', q:'perchas terciopelo antideslizantes pack', keyword_en:'velvet non slip hangers pack', volCm3:3000, costoMin:2, costoMax:6, pesoG:500, nota:'Volumen, recompra' },
    { nombre:'Organizador giratorio de escritorio', q:'organizador giratorio escritorio', keyword_en:'rotating desk organizer', volCm3:3000, costoMin:3, costoMax:9, pesoG:450, nota:'Ticket medio' },
    { nombre:'Etiquetadora manual con cinta', q:'etiquetadora manual cinta rotuladora', keyword_en:'handheld label maker', volCm3:800, costoMin:6, costoMax:14, pesoG:400, nota:'Ticket alto' },
    { nombre:'Fundas guardaropa con cierre', q:'fundas guardaropa cierre antipolvo', keyword_en:'zippered garment bags dustproof', volCm3:1200, costoMin:1.5, costoMax:4, pesoG:200, nota:'Recompra estacional' },
    { nombre:'Organizador de bijou de viaje', q:'organizador bijou viaje joyero', keyword_en:'travel jewelry box organizer', volCm3:800, costoMin:2, costoMax:6, pesoG:200, nota:'Regalo, buen margen' },
  ]},
  maquillaje: { label: 'Maquillaje / Uñas', icon: '💅', productos: [
    { nombre:'Set de brochas de maquillaje con estuche', q:'set brochas maquillaje estuche', keyword_en:'makeup brush set with case', volCm3:800, costoMin:3, costoMax:9, pesoG:250, nota:'Buen margen, liviano' },
    { nombre:'Esponja de maquillaje con soporte', q:'esponja maquillaje lagrima soporte', keyword_en:'makeup sponge with holder', volCm3:200, costoMin:0.8, costoMax:2.5, pesoG:60, nota:'Recompra pura' },
    { nombre:'Lampara UV/LED para unas portatil', q:'lampara uv led unas portatil', keyword_en:'portable uv led nail lamp', volCm3:1200, costoMin:6, costoMax:14, pesoG:400, nota:'Ticket alto, nicho nails' },
    { nombre:'Torno electrico para unas portatil', q:'torno unas electrico portatil', keyword_en:'portable electric nail drill', volCm3:800, costoMin:8, costoMax:18, pesoG:400, nota:'Profesional, ticket alto' },
    { nombre:'Set de pinceles de nail art', q:'pinceles nail art set', keyword_en:'nail art brushes set', volCm3:200, costoMin:1.5, costoMax:4, pesoG:80, nota:'Liviano, alto margen' },
    { nombre:'Limpiador electrico de brochas', q:'limpiador brochas maquillaje electrico', keyword_en:'electric makeup brush cleaner', volCm3:800, costoMin:3, costoMax:9, pesoG:250, nota:'Poco saturado' },
    { nombre:'Organizador acrilico de maquillaje', q:'organizador acrilico maquillaje', keyword_en:'acrylic makeup organizer', volCm3:6000, costoMin:3, costoMax:9, pesoG:500, nota:'Fragil, volumen' },
    { nombre:'Espejo con luz LED y aumento', q:'espejo maquillaje luz led aumento', keyword_en:'led lighted magnifying makeup mirror', volCm3:3000, costoMin:4, costoMax:11, pesoG:400, nota:'Fragil, ticket medio' },
    { nombre:'Set de stickers y plantillas de unas', q:'stickers unas plantillas set', keyword_en:'nail stickers stencils set', volCm3:100, costoMin:0.6, costoMax:2, pesoG:40, nota:'Micro ticket, packs' },
    { nombre:'Rizador de pestanas con repuestos', q:'rizador pestanas repuestos', keyword_en:'eyelash curler with refill pads', volCm3:200, costoMin:1, costoMax:3, pesoG:80, nota:'Recompra' },
    { nombre:'Kit de manicura profesional en estuche', q:'kit manicura profesional estuche', keyword_en:'professional manicure kit case', volCm3:500, costoMin:3, costoMax:9, pesoG:300, nota:'Regalo' },
    { nombre:'Banda / vincha para lavarse la cara', q:'vincha spa lavar cara', keyword_en:'spa face wash headband', volCm3:250, costoMin:0.6, costoMax:2, pesoG:40, nota:'Micro ticket, cruza skincare' },
  ]},
  cuidadopersonal: { label: 'Cuidado Personal', icon: '🧴', productos: [
    { nombre:'Cepillo de dientes electrico sonico', q:'cepillo dientes electrico sonico', keyword_en:'sonic electric toothbrush', volCm3:400, costoMin:4, costoMax:11, pesoG:200, nota:'Recompra de cabezales' },
    { nombre:'Cabezales de repuesto para cepillo electrico', q:'cabezales repuesto cepillo electrico', keyword_en:'replacement electric toothbrush heads', volCm3:100, costoMin:1.5, costoMax:4, pesoG:60, nota:'Recompra pura, alto margen' },
    { nombre:'Irrigador dental portatil', q:'irrigador dental portatil', keyword_en:'portable water flosser', volCm3:1200, costoMin:8, costoMax:18, pesoG:400, nota:'Ticket alto' },
    { nombre:'Rodillo facial de jade o cuarzo', q:'rodillo facial jade masajeador', keyword_en:'jade face roller massager', volCm3:300, costoMin:1.5, costoMax:4, pesoG:120, nota:'Fragil, alto margen' },
    { nombre:'Recortadora de nariz y orejas', q:'recortadora nariz orejas', keyword_en:'nose ear hair trimmer', volCm3:250, costoMin:2.5, costoMax:7, pesoG:120, nota:'Regalo, poco saturado' },
    { nombre:'Set de peines y cepillos desenredantes', q:'cepillo desenredante set', keyword_en:'detangling hair brush set', volCm3:600, costoMin:1.5, costoMax:4, pesoG:150, nota:'Recompra' },
    { nombre:'Depiladora facial electrica', q:'depiladora facial electrica', keyword_en:'electric facial epilator', volCm3:200, costoMin:3, costoMax:8, pesoG:100, nota:'Liviano, buen margen' },
    { nombre:'Set de limas y cortauna profesional', q:'set cortaunas profesional acero', keyword_en:'stainless steel nail clipper set', volCm3:300, costoMin:1.5, costoMax:4, pesoG:150, nota:'Regalo, evergreen' },
    { nombre:'Cepillo secador voluminizador', q:'cepillo secador voluminizador', keyword_en:'hot air brush volumizer', volCm3:4000, costoMin:8, costoMax:18, pesoG:600, nota:'Ticket alto, pesa' },
    { nombre:'Limpiador facial por ultrasonido', q:'limpiador facial ultrasonico spatula', keyword_en:'ultrasonic skin scrubber spatula', volCm3:400, costoMin:5, costoMax:12, pesoG:150, nota:'Nicho skincare' },
    { nombre:'Neceser de viaje colgante', q:'neceser viaje colgante organizador', keyword_en:'hanging travel toiletry organizer', volCm3:1500, costoMin:2.5, costoMax:7, pesoG:250, nota:'Cruza con viajes' },
    { nombre:'Masajeador de cuero cabelludo', q:'masajeador cuero cabelludo', keyword_en:'scalp massager brush', volCm3:300, costoMin:0.8, costoMax:2.5, pesoG:80, nota:'Micro ticket, viral' },
  ]},
  suplementos: { label: 'Suplementos / Nutrición', icon: '💊', productos: [
    { nombre:'Shaker con compartimentos para suplementos', q:'shaker vaso proteina compartimentos', keyword_en:'protein shaker bottle with compartments', volCm3:1500, costoMin:2, costoMax:6, pesoG:250, nota:'Complemento, no es suplemento' },
    { nombre:'Pastillero semanal organizador', q:'pastillero semanal organizador', keyword_en:'weekly pill organizer', volCm3:300, costoMin:1, costoMax:3, pesoG:120, nota:'Liviano, evergreen' },
    { nombre:'Dosificador de polvo portatil', q:'dosificador proteina portatil', keyword_en:'portable protein powder dispenser', volCm3:400, costoMin:1.5, costoMax:4, pesoG:120, nota:'Nicho gym' },
    { nombre:'Botella con infusor de frutas', q:'botella infusor frutas', keyword_en:'fruit infuser water bottle', volCm3:1200, costoMin:2.5, costoMax:7, pesoG:350, nota:'Estacional verano' },
    { nombre:'Balanza de alimentos para dieta', q:'balanza alimentos digital dieta', keyword_en:'digital food scale', volCm3:1200, costoMin:3, costoMax:8, pesoG:400, nota:'Cruza con cocina' },
    { nombre:'Set de viales para porciones diarias', q:'viales porciones suplementos set', keyword_en:'supplement portion containers set', volCm3:500, costoMin:1, costoMax:3, pesoG:100, nota:'Micro ticket' },
    { nombre:'Cuchara medidora de acero con clip', q:'cucharas medidoras acero set', keyword_en:'stainless steel measuring spoons set', volCm3:300, costoMin:1, costoMax:3, pesoG:120, nota:'Recompra baja' },
    { nombre:'Bolso termico para viandas fitness', q:'bolso termico viandas fitness', keyword_en:'insulated meal prep bag', volCm3:4000, costoMin:4, costoMax:11, pesoG:400, nota:'Volumen' },
    { nombre:'Set de tuppers de vidrio con divisiones', q:'tupper vidrio divisiones set', keyword_en:'glass meal prep containers set', volCm3:6000, costoMin:6, costoMax:14, pesoG:1500, nota:'Pesa y es fragil' },
    { nombre:'Aplicacion de bandas de test de hidratacion', q:'tiras test hidratacion', keyword_en:'urine hydration test strips', volCm3:100, costoMin:2, costoMax:6, pesoG:60, nota:'Producto sanitario: verificar' },
    { nombre:'Botella deportiva con marcas de horario', q:'botella agua motivacional horarios', keyword_en:'motivational water bottle time marker', volCm3:3500, costoMin:2.5, costoMax:7, pesoG:300, nota:'Tendencia, buen margen' },
    { nombre:'Mortero y triturador de pastillas', q:'triturador pastillas cortador', keyword_en:'pill crusher cutter', volCm3:100, costoMin:1, costoMax:3, pesoG:80, nota:'Nicho adulto mayor' },
  ]},
  tejido: { label: 'Tejido / Lana', icon: '🧶', productos: [
    { nombre:'Set de agujas de crochet ergonomicas', q:'set agujas crochet ergonomicas', keyword_en:'ergonomic crochet hooks set', volCm3:300, costoMin:2.5, costoMax:7, pesoG:250, nota:'Alto margen, nicho fiel' },
    { nombre:'Agujas circulares intercambiables kit', q:'agujas circulares intercambiables kit tejer', keyword_en:'interchangeable circular knitting needles kit', volCm3:800, costoMin:6, costoMax:15, pesoG:400, nota:'Ticket alto, nicho' },
    { nombre:'Contador de vueltas digital para tejer', q:'contador vueltas tejido digital', keyword_en:'digital knitting row counter', volCm3:50, costoMin:0.8, costoMax:2.5, pesoG:30, nota:'Micro ticket, diminuto' },
    { nombre:'Devanadora manual de ovillos', q:'devanadora ovillos manual', keyword_en:'manual yarn ball winder', volCm3:3000, costoMin:6, costoMax:15, pesoG:700, nota:'Pesa, ticket alto' },
    { nombre:'Set de marcadores de puntos', q:'marcadores puntos tejido set', keyword_en:'knitting stitch markers set', volCm3:100, costoMin:0.5, costoMax:1.8, pesoG:30, nota:'Micro ticket, packs' },
    { nombre:'Telar circular para gorros', q:'telar circular gorros tejido', keyword_en:'round knitting loom set', volCm3:1500, costoMin:2.5, costoMax:7, pesoG:300, nota:'Volumen' },
    { nombre:'Bolso organizador de lanas', q:'bolso organizador lanas tejido', keyword_en:'yarn storage tote bag', volCm3:3000, costoMin:4, costoMax:11, pesoG:400, nota:'Volumen alto' },
    { nombre:'Set de agujas de tapiceria romas', q:'agujas lana romas set', keyword_en:'blunt yarn needles set', volCm3:50, costoMin:0.5, costoMax:1.5, pesoG:30, nota:'Micro ticket' },
    { nombre:'Kit de amigurumi con relleno y ojos', q:'kit amigurumi ojos seguridad', keyword_en:'amigurumi safety eyes kit', volCm3:300, costoMin:2, costoMax:6, pesoG:200, nota:'Tendencia fuerte' },
    { nombre:'Bloqueadores y alfileres para bloqueo', q:'alfileres bloqueo tejido set', keyword_en:'knitting blocking pins set', volCm3:200, costoMin:2, costoMax:6, pesoG:200, nota:'Nicho avanzado' },
    { nombre:'Regla y medidor de puntos', q:'medidor puntos regla tejido', keyword_en:'knitting gauge ruler', volCm3:50, costoMin:0.8, costoMax:2.5, pesoG:40, nota:'Micro ticket' },
    { nombre:'Maquina de tejer circular manual', q:'maquina tejer circular manual', keyword_en:'manual circular knitting machine', volCm3:8000, costoMin:10, costoMax:24, pesoG:900, nota:'Ticket alto, pesa' },
  ]},
  agro: { label: 'Agro / Campo', icon: '🚜', productos: [
    { nombre:'Medidor de pH y humedad de suelo', q:'medidor ph humedad suelo', keyword_en:'soil ph moisture meter', volCm3:500, costoMin:2, costoMax:6, pesoG:150, nota:'Liviano, buen margen' },
    { nombre:'Pulverizador de presion previa 2L', q:'pulverizador presion previa 2 litros', keyword_en:'2l pressure garden sprayer', volCm3:4000, costoMin:3, costoMax:9, pesoG:600, nota:'Volumen y peso' },
    { nombre:'Cinta y tutores para plantas pack', q:'tutores plantas cinta pack', keyword_en:'plant support stakes ties pack', volCm3:1500, costoMin:1.5, costoMax:4, pesoG:300, nota:'Recompra estacional' },
    { nombre:'Comedero automatico para aves de corral', q:'comedero automatico gallinas', keyword_en:'automatic chicken feeder', volCm3:8000, costoMin:5, costoMax:13, pesoG:700, nota:'Nicho, pesa' },
    { nombre:'Cinta de alambrado electrico para ganado', q:'cinta alambrado electrico ganado', keyword_en:'electric fence polytape', volCm3:3000, costoMin:6, costoMax:15, pesoG:900, nota:'Pesa, nicho campo' },
    { nombre:'Kit de injerto con navajas y cintas', q:'kit injerto navaja cinta', keyword_en:'grafting knife tape kit', volCm3:300, costoMin:2.5, costoMax:7, pesoG:250, nota:'Nicho fruticultura' },
    { nombre:'Trampa cromatica para insectos pack', q:'trampas cromaticas insectos pack', keyword_en:'yellow sticky insect traps pack', volCm3:600, costoMin:1.5, costoMax:4, pesoG:150, nota:'Recompra pura' },
    { nombre:'Termometro maximo minimo de invernadero', q:'termometro maxima minima invernadero', keyword_en:'max min greenhouse thermometer', volCm3:400, costoMin:2, costoMax:6, pesoG:120, nota:'Poco saturado' },
    { nombre:'Malla antiheladas / media sombra', q:'media sombra malla antihelada', keyword_en:'shade cloth frost protection net', volCm3:4000, costoMin:5, costoMax:13, pesoG:1200, nota:'Pesa: evaluar flete' },
    { nombre:'Guantes de trabajo de nitrilo pack', q:'guantes trabajo nitrilo pack', keyword_en:'nitrile coated work gloves pack', volCm3:1500, costoMin:1.5, costoMax:4, pesoG:200, nota:'Recompra' },
    { nombre:'Bebedero automatico a flotante', q:'bebedero automatico flotante animales', keyword_en:'automatic float valve livestock waterer', volCm3:1500, costoMin:3, costoMax:9, pesoG:400, nota:'Nicho productivo' },
    { nombre:'Semillero con domo y bandeja', q:'semillero bandeja domo germinacion', keyword_en:'seed tray with humidity dome', volCm3:5000, costoMin:2, costoMax:6, pesoG:350, nota:'Volumen, estacional' },
  ]},
  motos: { label: 'Motos / Repuestos', icon: '🏍️', productos: [
    { nombre:'Soporte de celular para moto con carga USB', q:'soporte celular moto cargador usb', keyword_en:'motorcycle phone mount usb charger', volCm3:600, costoMin:4, costoMax:11, pesoG:200, nota:'Buen margen' },
    { nombre:'Cubre pierna termico impermeable', q:'cubre pierna moto impermeable', keyword_en:'motorcycle waterproof leg cover', volCm3:2000, costoMin:5, costoMax:13, pesoG:700, nota:'Estacional invierno, volumen' },
    { nombre:'Guantes de moto con proteccion', q:'guantes moto proteccion nudillos', keyword_en:'motorcycle gloves knuckle protection', volCm3:1000, costoMin:4, costoMax:11, pesoG:250, nota:'Talles: cuidado stock' },
    { nombre:'Red elastica porta equipaje', q:'red elastica porta equipaje moto', keyword_en:'motorcycle cargo net', volCm3:400, costoMin:1, costoMax:3, pesoG:150, nota:'Micro ticket, recompra' },
    { nombre:'Camara y kit de reparacion de pinchaduras', q:'kit reparacion pinchadura moto tubeless', keyword_en:'tubeless tire repair kit motorcycle', volCm3:600, costoMin:2.5, costoMax:7, pesoG:300, nota:'Recompra, utilidad real' },
    { nombre:'Antirrobo de disco con alarma', q:'traba disco moto alarma', keyword_en:'motorcycle disc lock alarm', volCm3:600, costoMin:6, costoMax:15, pesoG:600, nota:'Ticket alto, pesa' },
    { nombre:'Funda cubre moto impermeable', q:'funda cubre moto impermeable', keyword_en:'waterproof motorcycle cover', volCm3:3000, costoMin:5, costoMax:13, pesoG:800, nota:'Volumen y peso' },
    { nombre:'Espejos retrovisores de aluminio', q:'espejos retrovisores moto aluminio', keyword_en:'aluminum motorcycle mirrors', volCm3:1500, costoMin:5, costoMax:13, pesoG:500, nota:'Compatibilidad: cuidado' },
    { nombre:'Puños de goma antivibracion', q:'punos moto goma antivibracion', keyword_en:'motorcycle rubber hand grips', volCm3:500, costoMin:2, costoMax:6, pesoG:200, nota:'Recompra' },
    { nombre:'Intercomunicador bluetooth para casco', q:'intercomunicador bluetooth casco moto', keyword_en:'motorcycle helmet bluetooth intercom', volCm3:800, costoMin:14, costoMax:32, pesoG:250, nota:'Ticket alto, mas riesgo' },
    { nombre:'Manoplas cubre manos para invierno', q:'manoplas moto cubre manos', keyword_en:'motorcycle handlebar muffs', volCm3:3000, costoMin:4, costoMax:11, pesoG:400, nota:'Estacional fuerte' },
    { nombre:'Kit de tornillos y grampas de carenado', q:'tornillos carenado moto kit', keyword_en:'motorcycle fairing bolts kit', volCm3:300, costoMin:2, costoMax:6, pesoG:250, nota:'Recompra taller' },
  ]},
  ferrmanuales: { label: 'Herramientas Manuales', icon: '🪛', productos: [
    { nombre:'Set de destornilladores de precision 25 en 1', q:'set destornilladores precision 25 en 1', keyword_en:'25 in 1 precision screwdriver set', volCm3:400, costoMin:2.5, costoMax:7, pesoG:250, nota:'Evergreen, buen margen' },
    { nombre:'Pinza multiuso plegable tipo multitool', q:'multiherramienta pinza plegable', keyword_en:'folding multi tool pliers', volCm3:300, costoMin:4, costoMax:11, pesoG:250, nota:'Regalo, ticket medio' },
    { nombre:'Nivel laser de linea cruzada', q:'nivel laser lineas cruzadas', keyword_en:'cross line laser level', volCm3:2000, costoMin:8, costoMax:20, pesoG:400, nota:'Ticket alto' },
    { nombre:'Cinta metrica de 5m con traba', q:'cinta metrica 5 metros', keyword_en:'5m tape measure', volCm3:300, costoMin:1.5, costoMax:4, pesoG:250, nota:'Ticket bajo, saturado' },
    { nombre:'Set de llaves allen con soporte', q:'set llaves allen soporte', keyword_en:'hex key set with holder', volCm3:300, costoMin:2, costoMax:6, pesoG:300, nota:'Evergreen' },
    { nombre:'Detector de cables y metal en pared', q:'detector cables metal pared', keyword_en:'wall stud metal wire detector', volCm3:400, costoMin:4, costoMax:11, pesoG:250, nota:'Poco saturado' },
    { nombre:'Alicate pelacables automatico', q:'pelacables automatico alicate', keyword_en:'automatic wire stripper', volCm3:600, costoMin:3, costoMax:9, pesoG:250, nota:'Nicho electricista' },
    { nombre:'Set de puntas de atornillador con adaptador', q:'set puntas atornillador magnetico', keyword_en:'magnetic screwdriver bit set', volCm3:300, costoMin:2, costoMax:6, pesoG:250, nota:'Recompra' },
    { nombre:'Sargento / prensa rapida en F', q:'sargento prensa rapida carpinteria', keyword_en:'quick release bar clamp', volCm3:2500, costoMin:3, costoMax:9, pesoG:600, nota:'Pesa' },
    { nombre:'Calibre digital de precision', q:'calibre digital precision', keyword_en:'digital caliper', volCm3:600, costoMin:4, costoMax:11, pesoG:200, nota:'Nicho taller, buen margen' },
    { nombre:'Cinturon portaherramientas de lona', q:'cinturon portaherramientas lona', keyword_en:'canvas tool belt', volCm3:2000, costoMin:4, costoMax:11, pesoG:500, nota:'Volumen' },
    { nombre:'Escuadra magnetica para soldar', q:'escuadra magnetica soldadura', keyword_en:'magnetic welding square', volCm3:600, costoMin:2.5, costoMax:7, pesoG:400, nota:'Nicho, pesa' },
  ]},
  maternidad: { label: 'Maternidad / Embarazo', icon: '🤰', productos: [
    { nombre:'Faja de sosten abdominal para embarazo', q:'faja soporte abdominal embarazo', keyword_en:'pregnancy belly support band', volCm3:800, costoMin:3, costoMax:9, pesoG:250, nota:'Talles: cuidado' },
    { nombre:'Almohada de lactancia y descanso', q:'almohada lactancia embarazo', keyword_en:'pregnancy nursing pillow', volCm3:12000, costoMin:6, costoMax:15, pesoG:800, nota:'Volumen muy alto' },
    { nombre:'Sacaleche manual de silicona', q:'sacaleche manual silicona', keyword_en:'silicone manual breast pump', volCm3:600, costoMin:2, costoMax:6, pesoG:150, nota:'Producto sanitario: verificar' },
    { nombre:'Bolsas de conservacion de leche materna', q:'bolsas leche materna conservacion', keyword_en:'breast milk storage bags', volCm3:600, costoMin:1.5, costoMax:4, pesoG:120, nota:'Recompra pura' },
    { nombre:'Discos absorbentes lavables pack', q:'discos absorbentes lactancia lavables', keyword_en:'washable nursing pads', volCm3:300, costoMin:1.5, costoMax:4, pesoG:100, nota:'Recompra, ecologico' },
    { nombre:'Doppler fetal domestico', q:'doppler fetal casero', keyword_en:'fetal doppler', volCm3:1200, costoMin:8, costoMax:20, pesoG:250, nota:'Producto sanitario: verificar ANMAT' },
    { nombre:'Cinturon adaptador de cinturon de seguridad', q:'adaptador cinturon seguridad embarazo', keyword_en:'pregnancy seat belt adjuster', volCm3:400, costoMin:2.5, costoMax:7, pesoG:200, nota:'Nicho, poco saturado' },
    { nombre:'Set de cremas antiestrias envase de viaje', q:'envases viaje cremas set', keyword_en:'travel cream containers set', volCm3:300, costoMin:1, costoMax:3, pesoG:100, nota:'Envases, no cosmetico' },
    { nombre:'Cubre asiento de auto para lactancia', q:'poncho lactancia cubre', keyword_en:'nursing cover poncho', volCm3:400, costoMin:2.5, costoMax:7, pesoG:200, nota:'Buen margen' },
    { nombre:'Rueda / calendario de seguimiento de embarazo', q:'libro registro embarazo album', keyword_en:'pregnancy journal memory book', volCm3:1500, costoMin:2, costoMax:6, pesoG:250, nota:'Regalo' },
    { nombre:'Medias de compresion graduada', q:'medias compresion graduada', keyword_en:'graduated compression socks', volCm3:300, costoMin:3, costoMax:9, pesoG:120, nota:'Talles, producto sanitario' },
    { nombre:'Organizador de bolso de maternidad', q:'organizador bolso maternidad panalera', keyword_en:'diaper bag organizer', volCm3:2000, costoMin:3, costoMax:9, pesoG:300, nota:'Volumen' },
  ]},
  pilates: { label: 'Yoga / Pilates', icon: '🧘', productos: [
    { nombre:'Bandas elasticas de resistencia set', q:'bandas elasticas resistencia set', keyword_en:'resistance bands set', volCm3:800, costoMin:2, costoMax:6, pesoG:250, nota:'Evergreen, liviano' },
    { nombre:'Rueda de yoga para estiramiento', q:'rueda yoga estiramiento', keyword_en:'yoga wheel', volCm3:12000, costoMin:5, costoMax:13, pesoG:900, nota:'Volumen muy alto' },
    { nombre:'Ladrillos de yoga de EVA par', q:'ladrillos yoga eva par', keyword_en:'eva yoga blocks pair', volCm3:4000, costoMin:2.5, costoMax:7, pesoG:400, nota:'Volumen alto' },
    { nombre:'Aro de pilates de resistencia', q:'aro pilates anillo resistencia', keyword_en:'pilates ring', volCm3:2500, costoMin:3, costoMax:9, pesoG:400, nota:'Volumen' },
    { nombre:'Correa de yoga con hebillas', q:'correa yoga cinta estiramiento', keyword_en:'yoga stretching strap', volCm3:300, costoMin:1.5, costoMax:4, pesoG:180, nota:'Liviano, buen margen' },
    { nombre:'Pelota de pilates chica antiestallido', q:'pelota pilates chica 25cm', keyword_en:'25cm mini pilates ball', volCm3:1000, costoMin:2, costoMax:6, pesoG:200, nota:'Se envia desinflada' },
    { nombre:'Rodillo de espuma para masaje muscular', q:'rodillo espuma foam roller', keyword_en:'foam roller', volCm3:5000, costoMin:4, costoMax:11, pesoG:600, nota:'Volumen muy alto' },
    { nombre:'Bandas circulares de gluteos de tela', q:'bandas gluteos tela set', keyword_en:'fabric glute bands set', volCm3:700, costoMin:2, costoMax:6, pesoG:200, nota:'Tendencia fuerte' },
    { nombre:'Bolso de transporte para mat de yoga', q:'bolso transporte mat yoga', keyword_en:'yoga mat carry bag', volCm3:1500, costoMin:2.5, costoMax:7, pesoG:250, nota:'Complemento' },
    { nombre:'Pelota de masaje miofascial', q:'pelota masaje miofascial', keyword_en:'myofascial massage ball', volCm3:300, costoMin:1, costoMax:3, pesoG:150, nota:'Micro ticket' },
    { nombre:'Deslizadores para entrenamiento core', q:'deslizadores core sliders', keyword_en:'core sliders', volCm3:900, costoMin:1.5, costoMax:4, pesoG:150, nota:'Liviano, poco saturado' },
    { nombre:'Toalla antideslizante para mat', q:'toalla antideslizante yoga mat', keyword_en:'non slip yoga mat towel', volCm3:1500, costoMin:3, costoMax:9, pesoG:350, nota:'Buen margen' },
  ]},
  coleccionables: { label: 'Coleccionables / Figuras', icon: '🏆', productos: [
    { nombre:'Vitrina acrilica para figuras', q:'vitrina acrilica figuras exhibidor', keyword_en:'acrylic display case figures', volCm3:5000, costoMin:3, costoMax:9, pesoG:400, nota:'Fragil, volumen' },
    { nombre:'Base giratoria de exhibicion con luz', q:'base giratoria exhibidor luz led', keyword_en:'rotating led display stand', volCm3:1000, costoMin:4, costoMax:11, pesoG:300, nota:'Complemento' },
    { nombre:'Fundas protectoras para cartas coleccionables', q:'fundas cartas coleccionables protectores', keyword_en:'trading card sleeves', volCm3:200, costoMin:1, costoMax:3, pesoG:100, nota:'Recompra pura' },
    { nombre:'Album de carpeta para cartas', q:'album carpeta cartas coleccion', keyword_en:'trading card binder album', volCm3:3000, costoMin:3, costoMax:9, pesoG:500, nota:'Pesa' },
    { nombre:'Soporte de pared para figuras', q:'soporte pared figuras coleccion', keyword_en:'wall display shelf collectibles', volCm3:600, costoMin:2, costoMax:6, pesoG:200, nota:'Poco saturado' },
    { nombre:'Caja de almacenamiento para cartas', q:'caja almacenamiento cartas deck box', keyword_en:'card deck box', volCm3:300, costoMin:1.5, costoMax:4, pesoG:150, nota:'Recompra' },
    { nombre:'Monedas y capsulas protectoras', q:'capsulas protectoras monedas coleccion', keyword_en:'coin capsules holders', volCm3:200, costoMin:1.5, costoMax:4, pesoG:120, nota:'Nicho numismatica' },
    { nombre:'Lupa con luz para inspeccion', q:'lupa con luz coleccionista', keyword_en:'led magnifying glass', volCm3:300, costoMin:2, costoMax:6, pesoG:150, nota:'Cruza con varios nichos' },
    { nombre:'Set de placas y etiquetas para exhibicion', q:'placas identificacion exhibicion coleccion', keyword_en:'display name plates', volCm3:200, costoMin:1.5, costoMax:4, pesoG:100, nota:'Nicho' },
    { nombre:'Maletin rigido para miniaturas', q:'maletin transporte miniaturas espuma', keyword_en:'miniature figure foam carry case', volCm3:6000, costoMin:8, costoMax:20, pesoG:900, nota:'Ticket alto, pesa' },
    { nombre:'Set de pinceles y pinturas para miniaturas', q:'pinceles miniaturas pintura set', keyword_en:'miniature painting brushes set', volCm3:200, costoMin:3, costoMax:9, pesoG:200, nota:'Nicho wargaming' },
    { nombre:'Bandeja de dados con superficie de fieltro', q:'bandeja dados rol fieltro', keyword_en:'felt dice tray', volCm3:1000, costoMin:3, costoMax:9, pesoG:300, nota:'Nicho rol' },
  ]},
  drones: { label: 'Drones / RC', icon: '🚁', productos: [
    { nombre:'Mini dron de entrenamiento con camara', q:'mini dron camara principiante', keyword_en:'mini drone with camera beginner', volCm3:2500, costoMin:14, costoMax:32, pesoG:250, nota:'Ticket alto, riesgo aduana' },
    { nombre:'Bateria de repuesto para dron', q:'bateria repuesto dron lipo', keyword_en:'drone lipo replacement battery', volCm3:150, costoMin:6, costoMax:15, pesoG:120, nota:'Lipo: restringido en courier' },
    { nombre:'Helices de repuesto set con protectores', q:'helices repuesto dron set protectores', keyword_en:'drone propellers guards set', volCm3:500, costoMin:2, costoMax:6, pesoG:80, nota:'Recompra pura, liviano' },
    { nombre:'Auto RC todo terreno escala chica', q:'auto rc todo terreno control remoto', keyword_en:'rc off road car', volCm3:6000, costoMin:10, costoMax:24, pesoG:700, nota:'Ticket alto, pesa' },
    { nombre:'Maletin de transporte para dron', q:'maletin transporte dron espuma', keyword_en:'drone foam carrying case', volCm3:6000, costoMin:6, costoMax:15, pesoG:600, nota:'Volumen' },
    { nombre:'Filtros ND para camara de dron', q:'filtros nd dron set', keyword_en:'drone nd filters set', volCm3:200, costoMin:5, costoMax:13, pesoG:50, nota:'Diminuto, alto margen' },
    { nombre:'Plataforma plegable de aterrizaje', q:'plataforma aterrizaje dron plegable', keyword_en:'foldable drone landing pad', volCm3:1500, costoMin:3, costoMax:9, pesoG:250, nota:'Complemento' },
    { nombre:'Motor brushless de repuesto', q:'motor brushless repuesto dron', keyword_en:'drone brushless motor replacement', volCm3:150, costoMin:4, costoMax:11, pesoG:80, nota:'Recompra tecnica' },
    { nombre:'Antena extensora de senal para control', q:'antena extensor senal control dron', keyword_en:'drone controller signal booster antenna', volCm3:200, costoMin:2.5, costoMax:7, pesoG:60, nota:'Liviano, nicho' },
    { nombre:'Cargador multiple de baterias LiPo', q:'cargador baterias lipo multiple', keyword_en:'multi lipo battery charger', volCm3:400, costoMin:8, costoMax:20, pesoG:350, nota:'Ticket alto' },
    { nombre:'Simulador y cable de entrenamiento RC', q:'simulador rc cable entrenamiento', keyword_en:'rc flight simulator usb cable', volCm3:150, costoMin:3, costoMax:9, pesoG:80, nota:'Nicho, poco saturado' },
    { nombre:'Luces LED de senalizacion para dron', q:'luces led dron senalizacion', keyword_en:'drone led strobe lights', volCm3:100, costoMin:2, costoMax:6, pesoG:40, nota:'Diminuto' },
  ]},
  smartwatch: { label: 'Smartwatch / Wearables', icon: '📲', productos: [
    { nombre:'Malla de silicona de repuesto universal', q:'malla silicona smartwatch repuesto', keyword_en:'silicone smartwatch replacement band', volCm3:150, costoMin:0.8, costoMax:2.5, pesoG:40, nota:'Recompra pura, diminuto' },
    { nombre:'Malla metalica milanesa magnetica', q:'malla milanesa metalica smartwatch', keyword_en:'milanese metal smartwatch band', volCm3:150, costoMin:2, costoMax:6, pesoG:80, nota:'Buen margen percibido' },
    { nombre:'Vidrio protector para smartwatch pack', q:'vidrio protector smartwatch pack', keyword_en:'smartwatch tempered glass pack', volCm3:100, costoMin:0.8, costoMax:2.5, pesoG:30, nota:'Recompra, packs' },
    { nombre:'Case protector con bumper para reloj', q:'case protector smartwatch bumper', keyword_en:'smartwatch bumper case', volCm3:100, costoMin:1, costoMax:3, pesoG:40, nota:'Micro ticket' },
    { nombre:'Cable de carga magnetico de repuesto', q:'cable carga magnetico smartwatch', keyword_en:'magnetic smartwatch charging cable', volCm3:100, costoMin:1.5, costoMax:4, pesoG:40, nota:'Recompra: se pierden' },
    { nombre:'Base de carga con soporte de exhibicion', q:'soporte carga smartwatch base', keyword_en:'smartwatch charging stand', volCm3:400, costoMin:2, costoMax:6, pesoG:150, nota:'Complemento' },
    { nombre:'Banda deportiva perforada transpirable', q:'malla deportiva perforada smartwatch', keyword_en:'perforated sport smartwatch band', volCm3:150, costoMin:1, costoMax:3, pesoG:40, nota:'Recompra' },
    { nombre:'Anillo inteligente contador de pasos', q:'anillo inteligente smart ring', keyword_en:'smart ring', volCm3:200, costoMin:12, costoMax:28, pesoG:30, nota:'Tendencia, ticket alto' },
    { nombre:'Adaptadores de malla para relojes clasicos', q:'adaptador malla reloj smartwatch', keyword_en:'smartwatch band adapter', volCm3:50, costoMin:1, costoMax:3, pesoG:30, nota:'Nicho compatibilidad' },
    { nombre:'Banda para banda cardiaca de pecho', q:'banda cardiaca pecho bluetooth', keyword_en:'bluetooth chest heart rate monitor', volCm3:400, costoMin:6, costoMax:15, pesoG:100, nota:'Nicho running' },
    { nombre:'Organizador de mallas intercambiables', q:'organizador mallas smartwatch caja', keyword_en:'watch band organizer box', volCm3:1500, costoMin:2, costoMax:6, pesoG:150, nota:'Poco saturado' },
    { nombre:'Kit de herramientas para cambiar mallas', q:'kit herramientas cambiar malla reloj', keyword_en:'watch band removal tool kit', volCm3:500, costoMin:1.5, costoMax:4, pesoG:100, nota:'Complemento' },
  ]},
  bazar: { label: 'Bazar / Vajilla', icon: '🍽️', productos: [
    { nombre:'Set de cubiertos de acero para viaje', q:'set cubiertos viaje acero estuche', keyword_en:'stainless steel travel cutlery set with case', volCm3:400, costoMin:2, costoMax:6, pesoG:200, nota:'Ecologico, tendencia' },
    { nombre:'Tabla de corte plegable de silicona', q:'tabla corte plegable silicona', keyword_en:'foldable silicone cutting board', volCm3:1200, costoMin:2.5, costoMax:7, pesoG:300, nota:'Volumen' },
    { nombre:'Set de bowls de acero apilables', q:'bowls acero apilables set', keyword_en:'stackable stainless steel bowls set', volCm3:5000, costoMin:5, costoMax:13, pesoG:900, nota:'Pesa, evaluar flete' },
    { nombre:'Vasos de vidrio con tapa y sorbete', q:'vaso vidrio tapa sorbete', keyword_en:'glass cup with lid and straw', volCm3:1500, costoMin:2.5, costoMax:7, pesoG:450, nota:'Fragil, pesa' },
    { nombre:'Escurridor de platos plegable', q:'escurridor platos plegable', keyword_en:'collapsible dish drying rack', volCm3:3000, costoMin:3, costoMax:9, pesoG:500, nota:'Volumen alto' },
    { nombre:'Set de sorbetes de acero con cepillo', q:'sorbetes acero set cepillo', keyword_en:'stainless steel straws set with brush', volCm3:300, costoMin:1, costoMax:3, pesoG:120, nota:'Micro ticket, packs' },
    { nombre:'Tapas de silicona ajustables universales', q:'tapas silicona ajustables set', keyword_en:'silicone stretch lids set', volCm3:800, costoMin:1.5, costoMax:4, pesoG:150, nota:'Tendencia, liviano' },
    { nombre:'Bandeja giratoria organizadora de mesa', q:'bandeja giratoria mesa organizadora', keyword_en:'lazy susan turntable organizer', volCm3:4000, costoMin:3, costoMax:9, pesoG:600, nota:'Pesa' },
    { nombre:'Set de saleros y especieros de vidrio', q:'especiero set vidrio frascos', keyword_en:'glass spice jars set', volCm3:3000, costoMin:3, costoMax:9, pesoG:700, nota:'Fragil, pesa' },
    { nombre:'Jarra medidora con escala doble', q:'jarra medidora escala cocina', keyword_en:'measuring jug kitchen', volCm3:1500, costoMin:1.5, costoMax:4, pesoG:200, nota:'Ticket bajo' },
    { nombre:'Set de posavasos absorbentes', q:'posavasos absorbentes set', keyword_en:'absorbent coasters set', volCm3:500, costoMin:1.5, costoMax:4, pesoG:200, nota:'Regalo, buen margen' },
    { nombre:'Mantel individual de PVC tejido', q:'mantel individual pvc tejido set', keyword_en:'woven pvc placemats set', volCm3:2000, costoMin:2, costoMax:6, pesoG:300, nota:'Deco mesa' },
  ]},
  muebles: { label: 'Muebles', icon: '🪑', productos: [
    { nombre:'Mesa auxiliar plegable de notebook', q:'mesa plegable notebook cama', keyword_en:'foldable laptop bed table', volCm3:15000, costoMin:6, costoMax:15, pesoG:1200, nota:'Pesa: flete puede matar el margen' },
    { nombre:'Banqueta plegable portatil', q:'banqueta plegable portatil', keyword_en:'portable folding stool', volCm3:6000, costoMin:5, costoMax:13, pesoG:1000, nota:'Pesa y ocupa' },
    { nombre:'Patas de mueble de repuesto set', q:'patas muebles repuesto set', keyword_en:'replacement furniture legs set', volCm3:2000, costoMin:3, costoMax:9, pesoG:600, nota:'Nicho repuesto' },
    { nombre:'Estante flotante invisible set', q:'estante flotante invisible soporte', keyword_en:'invisible floating shelf bracket', volCm3:300, costoMin:3, costoMax:9, pesoG:500, nota:'Volumen' },
    { nombre:'Ruedas giratorias de repuesto para sillas', q:'ruedas silla oficina repuesto set', keyword_en:'office chair caster wheels set', volCm3:2500, costoMin:3, costoMax:9, pesoG:400, nota:'Recompra, poco saturado' },
    { nombre:'Protectores de patas de silla de silicona', q:'protectores patas sillas silicona', keyword_en:'silicone chair leg protectors', volCm3:300, costoMin:0.8, costoMax:2.5, pesoG:100, nota:'Micro ticket, packs' },
    { nombre:'Kit de anclaje antivuelco para muebles', q:'anclaje antivuelco muebles seguridad', keyword_en:'furniture anti tip straps', volCm3:200, costoMin:1.5, costoMax:4, pesoG:200, nota:'Seguridad infantil' },
    { nombre:'Perchero de pie plegable', q:'perchero pie plegable', keyword_en:'foldable standing coat rack', volCm3:12000, costoMin:6, costoMax:15, pesoG:1500, nota:'Pesa mucho' },
    { nombre:'Soporte elevador de muebles set', q:'elevadores muebles patas set', keyword_en:'furniture risers set', volCm3:3000, costoMin:2.5, costoMax:7, pesoG:400, nota:'Nicho espacio' },
    { nombre:'Cojin de asiento ergonomico de gel', q:'almohadon ergonomico gel silla', keyword_en:'gel seat cushion ergonomic', volCm3:6000, costoMin:5, costoMax:13, pesoG:700, nota:'Volumen alto' },
    { nombre:'Bisagras de cierre suave para alacena', q:'bisagras cierre suave alacena', keyword_en:'soft close cabinet hinges', volCm3:400, costoMin:2, costoMax:6, pesoG:300, nota:'Nicho carpinteria' },
    { nombre:'Manijas y tiradores de mueble set', q:'tiradores manijas muebles set', keyword_en:'cabinet handles pulls set', volCm3:800, costoMin:2.5, costoMax:7, pesoG:400, nota:'Renovacion, buen margen' },
  ]},
  decoracion: { label: 'Decoración / Cuadros', icon: '🖼️', productos: [
    { nombre:'Tira LED con control y adhesivo', q:'tira led control adhesiva rgb', keyword_en:'rgb led strip with remote', volCm3:800, costoMin:2.5, costoMax:7, pesoG:250, nota:'Muy vendido, validar saturacion' },
    { nombre:'Marcos de foto colgantes set', q:'marcos fotos set colgante', keyword_en:'hanging photo frames set', volCm3:3000, costoMin:3, costoMax:9, pesoG:500, nota:'Fragil, volumen' },
    { nombre:'Vinilos decorativos de pared', q:'vinilo decorativo pared', keyword_en:'wall decal sticker', volCm3:800, costoMin:1.5, costoMax:4, pesoG:150, nota:'Liviano, alto margen' },
    { nombre:'Espejo decorativo hexagonal acrilico set', q:'espejos hexagonales acrilicos pared', keyword_en:'hexagon acrylic mirror wall stickers', volCm3:1500, costoMin:3, costoMax:9, pesoG:400, nota:'Volumen' },
    { nombre:'Cortina de luces LED tipo cascada', q:'cortina luces led cascada', keyword_en:'led curtain string lights', volCm3:1200, costoMin:3, costoMax:9, pesoG:400, nota:'Estacional fiestas' },
    { nombre:'Reloj de pared silencioso minimalista', q:'reloj pared silencioso minimalista', keyword_en:'silent minimalist wall clock', volCm3:3500, costoMin:3, costoMax:9, pesoG:500, nota:'Fragil, volumen' },
    { nombre:'Macetas colgantes de macrame', q:'macetero colgante macrame', keyword_en:'macrame plant hanger', volCm3:600, costoMin:1.5, costoMax:4, pesoG:150, nota:'Cruza con plantas' },
    { nombre:'Lampara de mesa de sal o silicona LED', q:'lampara mesa led decorativa recargable', keyword_en:'rechargeable led table lamp', volCm3:2500, costoMin:4, costoMax:11, pesoG:400, nota:'Ticket medio' },
    { nombre:'Set de canvas / laminas decorativas', q:'laminas decorativas cuadros set', keyword_en:'wall art prints set', volCm3:1200, costoMin:2, costoMax:6, pesoG:200, nota:'Se envia enrollado' },
    { nombre:'Proyector de luz de ambiente galaxia', q:'proyector luz galaxia ambiente', keyword_en:'galaxy light projector', volCm3:2500, costoMin:6, costoMax:15, pesoG:500, nota:'Tendencia, ticket medio' },
    { nombre:'Guirnalda de fotos con clips y luces', q:'guirnalda fotos clips luces', keyword_en:'photo clip string lights', volCm3:500, costoMin:1.5, costoMax:4, pesoG:150, nota:'Regalo, liviano' },
    { nombre:'Panel decorativo hexagonal de pared', q:'paneles hexagonales decorativos pared', keyword_en:'hexagon decorative wall panels', volCm3:3000, costoMin:4, costoMax:11, pesoG:600, nota:'Volumen alto' },
  ]},
  plantas: { label: 'Plantas / Suculentas', icon: '🪴', productos: [
    { nombre:'Set de herramientas de jardineria mini', q:'herramientas mini suculentas set', keyword_en:'mini succulent tools set', volCm3:400, costoMin:1.5, costoMax:4, pesoG:200, nota:'Alto margen, liviano' },
    { nombre:'Macetas de ceramica chicas para suculentas', q:'macetas ceramica suculentas set', keyword_en:'ceramic succulent pots set', volCm3:3000, costoMin:3, costoMax:9, pesoG:700, nota:'Fragil y pesa' },
    { nombre:'Riego automatico por goteo con temporizador', q:'riego automatico goteo temporizador', keyword_en:'automatic drip irrigation timer', volCm3:1200, costoMin:6, costoMax:15, pesoG:500, nota:'Ticket alto' },
    { nombre:'Medidor 3 en 1 de luz, pH y humedad', q:'medidor 3 en 1 plantas', keyword_en:'3 in 1 plant soil meter', volCm3:500, costoMin:2, costoMax:6, pesoG:150, nota:'Liviano, buen margen' },
    { nombre:'Bulbos de riego autoregulable de vidrio', q:'bulbos riego plantas vidrio', keyword_en:'glass plant watering globes', volCm3:1500, costoMin:1.5, costoMax:4, pesoG:200, nota:'Fragil' },
    { nombre:'Soporte de pared para macetas', q:'soporte pared macetas colgante', keyword_en:'wall mounted plant hanger bracket', volCm3:600, costoMin:3, costoMax:9, pesoG:500, nota:'Volumen' },
    { nombre:'Lampara LED de crecimiento full spectrum', q:'lampara led crecimiento plantas', keyword_en:'led grow light', volCm3:2000, costoMin:5, costoMax:13, pesoG:350, nota:'Nicho indoor' },
    { nombre:'Tutores de musgo para plantas trepadoras', q:'tutor musgo planta trepadora', keyword_en:'moss pole plant support', volCm3:3000, costoMin:2.5, costoMax:7, pesoG:400, nota:'Tendencia monstera' },
    { nombre:'Etiquetas plasticas para plantas pack', q:'etiquetas plantas plastico pack', keyword_en:'plastic plant labels pack', volCm3:200, costoMin:0.5, costoMax:1.8, pesoG:80, nota:'Micro ticket' },
    { nombre:'Pulverizador de niebla fina decorativo', q:'pulverizador plantas niebla decorativo', keyword_en:'decorative plant mister', volCm3:1500, costoMin:2, costoMax:6, pesoG:250, nota:'Buen margen percibido' },
    { nombre:'Bandeja de propagacion con vasos de vidrio', q:'propagador plantas vidrio bandeja', keyword_en:'glass plant propagation station', volCm3:4000, costoMin:3, costoMax:9, pesoG:600, nota:'Fragil, pesa' },
    { nombre:'Tijera de podar de precision', q:'tijera podar precision bonsai', keyword_en:'bonsai precision pruning scissors', volCm3:300, costoMin:2, costoMax:6, pesoG:150, nota:'Nicho bonsai' },
  ]},
  mate: { label: 'Mate / Termos', icon: '🧉', productos: [
    { nombre:'Bombilla de acero desarmable', q:'bombilla acero desarmable mate', keyword_en:'stainless steel yerba mate straw bombilla', volCm3:100, costoMin:1.5, costoMax:4, pesoG:60, nota:'Recompra, liviano' },
    { nombre:'Matera / bolso porta equipo de mate', q:'matera bolso porta termo', keyword_en:'mate thermos carry bag', volCm3:4000, costoMin:5, costoMax:13, pesoG:500, nota:'Volumen, muy argentino' },
    { nombre:'Yerbera y azucarera set', q:'yerbera azucarera set', keyword_en:'yerba sugar container set', volCm3:2000, costoMin:2.5, costoMax:7, pesoG:300, nota:'Regalo' },
    { nombre:'Termo de acero inoxidable 1L', q:'termo acero inoxidable 1 litro', keyword_en:'1l stainless steel vacuum flask', volCm3:3000, costoMin:8, costoMax:20, pesoG:800, nota:'Pesa: evaluar flete' },
    { nombre:'Mate de acero con recubrimiento', q:'mate acero inoxidable', keyword_en:'stainless steel yerba mate cup', volCm3:800, costoMin:3, costoMax:9, pesoG:250, nota:'Alta demanda local' },
    { nombre:'Base y posamate antideslizante', q:'posa mate base antideslizante', keyword_en:'non slip mate cup holder', volCm3:200, costoMin:1, costoMax:3, pesoG:100, nota:'Micro ticket' },
    { nombre:'Cepillo limpiador de bombilla', q:'cepillo limpiar bombilla mate', keyword_en:'straw cleaning brush', volCm3:50, costoMin:0.5, costoMax:1.5, pesoG:30, nota:'Micro ticket, packs' },
    { nombre:'Funda termica para termo', q:'funda termica termo neoprene', keyword_en:'neoprene thermos sleeve', volCm3:300, costoMin:2, costoMax:6, pesoG:200, nota:'Complemento' },
    { nombre:'Tapa cebadora para termo', q:'tapa cebadora termo pico', keyword_en:'thermos pour spout lid', volCm3:200, costoMin:1.5, costoMax:4, pesoG:100, nota:'Repuesto, poco saturado' },
    { nombre:'Mate de vidrio con funda de silicona', q:'mate vidrio funda silicona', keyword_en:'glass mate cup silicone sleeve', volCm3:800, costoMin:2.5, costoMax:7, pesoG:300, nota:'Fragil' },
    { nombre:'Set de mate completo en caja regalo', q:'set mate completo caja regalo', keyword_en:'yerba mate gift set', volCm3:5000, costoMin:8, costoMax:20, pesoG:900, nota:'Ticket alto, pesa' },
    { nombre:'Filtro de bombilla de repuesto', q:'filtro bombilla mate repuesto', keyword_en:'bombilla replacement filter', volCm3:30, costoMin:0.4, costoMax:1.5, pesoG:20, nota:'Micro ticket, recompra' },
  ]},
  fitness: { label: 'Running / Fitness', icon: '🏃', productos: [
    { nombre:'Rinonera deportiva ajustable para correr', q:'rinonera deportiva correr ajustable', keyword_en:'adjustable running belt', volCm3:500, costoMin:2, costoMax:6, pesoG:150, nota:'Liviano, buen margen' },
    { nombre:'Brazalete porta celular para correr', q:'brazalete celular correr deportivo', keyword_en:'running phone armband', volCm3:300, costoMin:1.5, costoMax:4, pesoG:80, nota:'Recompra' },
    { nombre:'Soga de saltar con rulemanes y contador', q:'soga saltar rulemanes contador', keyword_en:'ball bearing jump rope with counter', volCm3:600, costoMin:2, costoMax:6, pesoG:250, nota:'Evergreen' },
    { nombre:'Guantes de gym con muneca reforzada', q:'guantes gym muneca reforzada', keyword_en:'gym gloves wrist support', volCm3:500, costoMin:2.5, costoMax:7, pesoG:150, nota:'Talles simples' },
    { nombre:'Muneequeras y tobilleras con peso', q:'tobilleras con peso ajustables', keyword_en:'adjustable ankle weights', volCm3:1500, costoMin:5, costoMax:13, pesoG:1200, nota:'Pesa mucho: flete' },
    { nombre:'Banda de resistencia con anclaje de puerta', q:'banda resistencia anclaje puerta', keyword_en:'resistance band door anchor', volCm3:300, costoMin:3, costoMax:9, pesoG:300, nota:'Entrenamiento en casa' },
    { nombre:'Chaleco reflectivo para correr de noche', q:'chaleco reflectivo correr noche', keyword_en:'reflective running vest', volCm3:400, costoMin:1.5, costoMax:4, pesoG:120, nota:'Seguridad, liviano' },
    { nombre:'Cinturon de hidratacion con botellas', q:'cinturon hidratacion running botellas', keyword_en:'running hydration belt bottles', volCm3:1200, costoMin:4, costoMax:11, pesoG:300, nota:'Nicho running' },
    { nombre:'Pesas de mano de neoprene par', q:'mancuernas neoprene par', keyword_en:'neoprene dumbbells pair', volCm3:2000, costoMin:6, costoMax:15, pesoG:2000, nota:'Pesa mucho: flete mata margen' },
    { nombre:'Rodillera deportiva de compresion', q:'rodillera compresion deportiva', keyword_en:'knee compression sleeve', volCm3:400, costoMin:2, costoMax:6, pesoG:120, nota:'Talles, recompra' },
    { nombre:'Cronometro deportivo digital', q:'cronometro deportivo digital', keyword_en:'digital sports stopwatch', volCm3:200, costoMin:2.5, costoMax:7, pesoG:80, nota:'Nicho entrenadores' },
    { nombre:'Toalla deportiva de secado rapido', q:'toalla deportiva secado rapido microfibra', keyword_en:'quick dry microfiber sports towel', volCm3:800, costoMin:2, costoMax:6, pesoG:200, nota:'Recompra' },
  ]},
  natacion: { label: 'Natación / Pileta', icon: '🏊', productos: [
    { nombre:'Antiparras de natacion antiempanante', q:'antiparras natacion antiempanante', keyword_en:'anti fog swim goggles', volCm3:400, costoMin:2, costoMax:6, pesoG:100, nota:'Estacional fuerte, liviano' },
    { nombre:'Gorra de silicona para natacion', q:'gorra natacion silicona', keyword_en:'silicone swim cap', volCm3:200, costoMin:1, costoMax:3, pesoG:70, nota:'Recompra' },
    { nombre:'Tapones de oido y nariz set', q:'tapones oidos nariz natacion set', keyword_en:'swimming ear plugs nose clip set', volCm3:100, costoMin:0.6, costoMax:2, pesoG:40, nota:'Micro ticket, packs' },
    { nombre:'Tabla de flotacion de entrenamiento', q:'tabla natacion entrenamiento flotacion', keyword_en:'swimming kickboard', volCm3:6000, costoMin:3, costoMax:9, pesoG:400, nota:'Volumen alto' },
    { nombre:'Bolso impermeable seco para pileta', q:'bolso seco impermeable playa', keyword_en:'waterproof beach dry bag', volCm3:1000, costoMin:3, costoMax:9, pesoG:250, nota:'Estacional verano' },
    { nombre:'Manoplas de entrenamiento (paddles)', q:'paletas natacion entrenamiento paddles', keyword_en:'swim training hand paddles', volCm3:800, costoMin:3, costoMax:9, pesoG:250, nota:'Nicho nadadores' },
    { nombre:'Termometro flotante para pileta', q:'termometro flotante pileta', keyword_en:'floating pool thermometer', volCm3:500, costoMin:1.5, costoMax:4, pesoG:120, nota:'Estacional' },
    { nombre:'Set de juguetes de buceo para pileta', q:'juguetes buceo pileta set', keyword_en:'pool diving toys set', volCm3:800, costoMin:2, costoMax:6, pesoG:250, nota:'Cruza con juguetes' },
    { nombre:'Red recogedora de hojas para pileta', q:'red recogedora hojas pileta', keyword_en:'pool leaf skimmer net', volCm3:3000, costoMin:3, costoMax:9, pesoG:400, nota:'Largo: revisar flete' },
    { nombre:'Test de cloro y pH en tiras', q:'tiras test cloro ph pileta', keyword_en:'pool chlorine ph test strips', volCm3:300, costoMin:2, costoMax:6, pesoG:80, nota:'Recompra estacional' },
    { nombre:'Inflador electrico para inflables', q:'inflador electrico inflables pileta', keyword_en:'electric air pump inflatables', volCm3:1500, costoMin:5, costoMax:13, pesoG:500, nota:'Estacional, ticket medio' },
    { nombre:'Reposera / flotador inflable individual', q:'flotador inflable individual pileta', keyword_en:'inflatable pool float', volCm3:1500, costoMin:4, costoMax:11, pesoG:600, nota:'Volumen muy alto' },
  ]},
  golf: { label: 'Golf', icon: '⛳', productos: [
    { nombre:'Set de tees de golf de bambu', q:'tees golf set bambu', keyword_en:'bamboo golf tees set', volCm3:200, costoMin:1, costoMax:3, pesoG:120, nota:'Recompra pura' },
    { nombre:'Marcador de bola magnetico con clip', q:'marcador bola golf magnetico clip', keyword_en:'magnetic golf ball marker hat clip', volCm3:50, costoMin:1, costoMax:3, pesoG:40, nota:'Micro ticket, regalo' },
    { nombre:'Alfombra de practica de putting', q:'alfombra practica putting golf', keyword_en:'golf putting mat', volCm3:8000, costoMin:8, costoMax:20, pesoG:1500, nota:'Pesa: evaluar flete' },
    { nombre:'Red plegable de practica de swing', q:'red practica golf plegable', keyword_en:'foldable golf practice net', volCm3:8000, costoMin:10, costoMax:24, pesoG:1800, nota:'Volumen y peso altos' },
    { nombre:'Fundas de palos de golf set', q:'fundas palos golf set', keyword_en:'golf club head covers set', volCm3:3000, costoMin:4, costoMax:11, pesoG:300, nota:'Buen margen' },
    { nombre:'Toalla de golf con mosqueton', q:'toalla golf mosqueton microfibra', keyword_en:'microfiber golf towel with carabiner', volCm3:500, costoMin:2, costoMax:6, pesoG:150, nota:'Complemento' },
    { nombre:'Telemetro laser de golf', q:'telemetro laser golf', keyword_en:'golf laser rangefinder', volCm3:800, costoMin:35, costoMax:80, pesoG:300, nota:'Ticket muy alto, riesgo' },
    { nombre:'Contador de golpes de muneca', q:'contador golpes golf muneca', keyword_en:'golf stroke counter wristband', volCm3:50, costoMin:1.5, costoMax:4, pesoG:50, nota:'Nicho, liviano' },
    { nombre:'Limpiador de ranuras de palos', q:'limpiador ranuras palos golf', keyword_en:'golf club groove cleaner', volCm3:100, costoMin:1.5, costoMax:4, pesoG:80, nota:'Micro ticket' },
    { nombre:'Guante de golf sintetico', q:'guante golf sintetico', keyword_en:'synthetic golf glove', volCm3:200, costoMin:2.5, costoMax:7, pesoG:60, nota:'Talles, recompra' },
    { nombre:'Bolsa de bolas de practica', q:'bolsa bolas practica golf', keyword_en:'golf ball pick up bag', volCm3:800, costoMin:3, costoMax:9, pesoG:400, nota:'Complemento' },
    { nombre:'Grips de repuesto para palos', q:'grips repuesto palos golf', keyword_en:'golf club grips replacement', volCm3:1500, costoMin:3, costoMax:9, pesoG:250, nota:'Recompra tecnica' },
  ]},
  festejos: { label: 'Cotillón / Fiestas', icon: '🎉', productos: [
    { nombre:'Arco de globos kit con cinta', q:'kit arco globos cinta', keyword_en:'balloon arch kit', volCm3:2500, costoMin:2, costoMax:6, pesoG:250, nota:'Liviano, alto margen' },
    { nombre:'Velas numericas de cumpleanos', q:'velas numero cumpleanos', keyword_en:'birthday number candles', volCm3:100, costoMin:0.5, costoMax:1.8, pesoG:50, nota:'Micro ticket, recompra' },
    { nombre:'Maquina de burbujas para fiestas', q:'maquina burbujas fiesta', keyword_en:'party bubble machine', volCm3:3000, costoMin:6, costoMax:15, pesoG:700, nota:'Ticket alto, pesa' },
    { nombre:'Set de accesorios para photobooth', q:'accesorios photobooth set fiesta', keyword_en:'photo booth props set', volCm3:1500, costoMin:1.5, costoMax:4, pesoG:150, nota:'Liviano, alto margen' },
    { nombre:'Globos de latex metalizados pack', q:'globos latex metalizados pack', keyword_en:'metallic latex balloons pack', volCm3:800, costoMin:1, costoMax:3, pesoG:150, nota:'Recompra pura' },
    { nombre:'Banderin personalizable de cumpleanos', q:'banderin cumpleanos personalizable', keyword_en:'birthday banner bunting', volCm3:500, costoMin:1, costoMax:3, pesoG:80, nota:'Liviano' },
    { nombre:'Luces LED de fiesta con control', q:'luz led fiesta control rgb', keyword_en:'rgb party led light with remote', volCm3:1200, costoMin:5, costoMax:13, pesoG:500, nota:'Ticket medio' },
    { nombre:'Cotillon de anteojos y vinchas pack', q:'cotillon anteojos vinchas pack', keyword_en:'party glasses headbands pack', volCm3:2000, costoMin:2, costoMax:6, pesoG:250, nota:'Volumen' },
    { nombre:'Pinata para armar con relleno', q:'pinata cumpleanos armar', keyword_en:'birthday pinata', volCm3:6000, costoMin:3, costoMax:9, pesoG:400, nota:'Volumen muy alto' },
    { nombre:'Canon de papel picado y serpentina', q:'canon papel picado serpentina', keyword_en:'confetti cannon', volCm3:800, costoMin:1.5, costoMax:4, pesoG:200, nota:'Presurizado: revisar courier' },
    { nombre:'Globos de aluminio con forma de numero', q:'globo numero aluminio grande', keyword_en:'large foil number balloon', volCm3:500, costoMin:1, costoMax:3, pesoG:60, nota:'Se envia desinflado, liviano' },
    { nombre:'Mantel y set descartable tematico', q:'set descartable tematico cumpleanos', keyword_en:'themed party tableware set', volCm3:3000, costoMin:2.5, costoMax:7, pesoG:300, nota:'Recompra estacional' },
  ]},
  ortopedia: { label: 'Ortopedia / Rehabilitación', icon: '🦴', productos: [
    { nombre:'Rodillera ortopedica con estabilizadores', q:'rodillera ortopedica estabilizadores', keyword_en:'knee brace with side stabilizers', volCm3:1500, costoMin:2, costoMax:6, pesoG:250, nota:'Talles, alta demanda' },
    { nombre:'Tobillera elastica con velcro', q:'tobillera ortopedica velcro', keyword_en:'ankle brace support', volCm3:600, costoMin:1, costoMax:3.5, pesoG:120, nota:'Liviana, cruza con deporte' },
    { nombre:'Munequera con ferula para tunel carpiano', q:'muñequera ferula tunel carpiano', keyword_en:'carpal tunnel wrist brace splint', volCm3:800, costoMin:2, costoMax:5, pesoG:150, nota:'Confirmar NCM con despachante' },
    { nombre:'Faja lumbar con soporte', q:'faja lumbar ortopedica', keyword_en:'lumbar back support belt', volCm3:2000, costoMin:3, costoMax:8, pesoG:350, nota:'Talles: complejo' },
    { nombre:'Corrector de postura de espalda', q:'corrector postura espalda', keyword_en:'back posture corrector', volCm3:800, costoMin:1.5, costoMax:4, pesoG:150, nota:'Muy buscado, competitivo' },
    { nombre:'Plantillas ortopedicas con arco', q:'plantillas ortopedicas arco', keyword_en:'arch support insoles', volCm3:800, costoMin:1, costoMax:3, pesoG:120, nota:'Confirmar NCM con despachante' },
    { nombre:'Corrector de juanete / separador de dedos', q:'corrector juanete separador dedos', keyword_en:'bunion corrector toe separator', volCm3:100, costoMin:0.5, costoMax:2, pesoG:40, nota:'Micro ticket, packs' },
    { nombre:'Talonera de gel para espolon', q:'talonera gel espolon', keyword_en:'gel heel cups', volCm3:300, costoMin:0.8, costoMax:2.5, pesoG:80, nota:'Sin promesas terapeuticas en MeLi' },
    { nombre:'Cabestrillo inmovilizador de brazo', q:'cabestrillo brazo inmovilizador', keyword_en:'arm sling immobilizer', volCm3:1000, costoMin:1.5, costoMax:4, pesoG:200, nota:'Confirmar NCM con despachante' },
    { nombre:'Almohada cervical viscoelastica', q:'almohada cervical viscoelastica', keyword_en:'memory foam cervical pillow', volCm3:10000, costoMin:6, costoMax:14, pesoG:1200, nota:'Volumen alto: flete caro' },
    { nombre:'Almohadon de asiento para coxis', q:'almohadon coxis viscoelastico', keyword_en:'memory foam coccyx seat cushion', volCm3:8000, costoMin:5, costoMax:12, pesoG:600, nota:'Voluminoso, ticket medio' },
    { nombre:'Ejercitador de mano para rehabilitacion', q:'ejercitador mano rehabilitacion', keyword_en:'hand exerciser rehabilitation', volCm3:300, costoMin:0.8, costoMax:2.5, pesoG:100, nota:'Chico, poco saturado' },
  ]},
};

// ------------------------------------------------------------
// Resolutor de nichos (guardrail)
// El selector del front y este catalogo son la misma lista, pero si alguna vez
// vuelven a desincronizarse el usuario NO tiene que ver cero productos: antes,
// un nicho desconocido devolvia 400 y la pantalla quedaba vacia sin explicar
// nada. Ahora se normaliza la entrada, se busca por clave y por etiqueta, y
// como ultimo recurso se cae en un nicho por defecto avisandolo en la respuesta.
// ------------------------------------------------------------
const NICHO_POR_DEFECTO = 'tecnologia';

function _slugNicho(v){
  return String(v == null ? '' : v)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Indice: clave -> clave, etiqueta completa -> clave, y cada mitad de la
// etiqueta -> clave ("Celulares / Accesorios" tambien entra por "accesorios").
const _INDICE_NICHOS = (function(){
  const idx = {};
  Object.keys(CATALOGO).forEach(function(k){
    idx[_slugNicho(k)] = k;
    const lab = CATALOGO[k].label || '';
    const sLab = _slugNicho(lab);
    if(sLab && !idx[sLab]) idx[sLab] = k;
    lab.split('/').forEach(function(parte){
      const sp = _slugNicho(parte);
      if(sp && sp.length >= 4 && !idx[sp]) idx[sp] = k;
    });
  });
  return idx;
})();

function resolverNicho(entrada){
  if(entrada && CATALOGO[entrada]) return { key: entrada, exacto: true };
  const s = _slugNicho(entrada);
  if(!s) return { key: NICHO_POR_DEFECTO, exacto: false };
  if(_INDICE_NICHOS[s]) return { key: _INDICE_NICHOS[s], exacto: true };
  // Coincidencia parcial: "celulares-accesorios", "Mate", "audio pro", etc.
  const claves = Object.keys(_INDICE_NICHOS);
  for(let i = 0; i < claves.length; i++){
    const c = claves[i];
    if(c.length >= 4 && (s.indexOf(c) > -1 || c.indexOf(s) > -1)) {
      return { key: _INDICE_NICHOS[c], exacto: false };
    }
  }
  return { key: NICHO_POR_DEFECTO, exacto: false };
}

function listarNichos(){
  return Object.keys(CATALOGO).map(function(v){
    return { v: v, l: CATALOGO[v].label, icon: CATALOGO[v].icon, productos: CATALOGO[v].productos.length };
  });
}

async function getMeliToken(userIdEntrada){
  if(!SUPA_KEY || !userIdEntrada) return null;
  try{
    // El usuario logueado puede ser un alias del usuario con el que se conecto
    // MercadoLibre (ver meli_user_aliases): sin resolverlo, el recomendador no
    // encontraba el token y devolvia todo como estimado.
    const userId = await resolveUserId(userIdEntrada);
    const url = SUPA_URL + '/rest/v1/meli_tokens?user_id=eq.' + encodeURIComponent(userId) + '&select=access_token,refresh_token,expires_at&limit=1';
    const r = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } });
    if(!r.ok) return null;
    const rows = await r.json();
    if(!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    // Si el token sigue vigente por mas de 5 minutos, lo usamos tal cual.
    const venceMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if(venceMs && venceMs - Date.now() > 5 * 60 * 1000) return { token: row.access_token, expired: false };
    // Token vencido o por vencer: intentamos renovarlo con el refresh_token.
    if(!row.refresh_token) return { token: null, expired: true };
    try{
      // Los dos juegos de nombres que conviven en el proyecto. Si aca solo se
      // leia MELI_APP_ID y en Vercel estaba cargada MELI_CLIENT_ID, el refresco
      // fallaba en silencio y el recomendador mostraba todo como estimado.
      const appId = process.env.MELI_APP_ID || process.env.MELI_CLIENT_ID;
      const secret = process.env.MELI_SECRET_KEY || process.env.MELI_CLIENT_SECRET;
      if(!appId || !secret) return { token: null, expired: true };
      const rr = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: appId, client_secret: secret, refresh_token: row.refresh_token })
      });
      const td = await rr.json();
      if(!rr.ok || !td.access_token) return { token: null, expired: true };
      // Guardamos el token renovado en Supabase (no pisamos refresh_token si ML no manda uno nuevo).
      const nuevoExpira = new Date(Date.now() + (td.expires_in || 21600) * 1000).toISOString();
      const patchBody = { access_token: td.access_token, expires_at: nuevoExpira, updated_at: new Date().toISOString() };
      if(td.refresh_token) patchBody.refresh_token = td.refresh_token;
      await fetch(SUPA_URL + '/rest/v1/meli_tokens?user_id=eq.' + encodeURIComponent(userId), { method: 'PATCH', headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(patchBody) });
      return { token: td.access_token, expired: false };
    }catch(_){ return { token: null, expired: true }; }
  }catch(e){ return null; }
}

// El mercado de cada producto lo arma api/_precalculo.js (analizarNicho), con
// los endpoints de MeLi que responden de verdad. Lo usan el proceso nocturno y
// la consulta en vivo de un visitante con MeLi conectado.

// ------------------------------------------------------------
// Cache por nicho (24 h) en Supabase: buscador_cache
// ------------------------------------------------------------
// Se guarda el MERCADO (publicaciones, comision, tendencia), no el resultado
// ya puntuado: el perfil se aplica encima en cada consulta, que es una cuenta
// local. Asi cambiar capital, experiencia, canal o riesgo no vuelve a pedirle
// nada a MercadoLibre, y un usuario sin MeLi conectado igual ve los datos del
// nicho si alguien los trajo en las ultimas 24 h. Si la tabla no existe, todo
// funciona igual, sin cache.
const CACHE_HORAS = Math.max(0, Number(process.env.BUSCADOR_CACHE_HORAS || 168));

function supaHeaders(extra) {
  return Object.assign({ apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }, extra || {});
}

async function leerCacheNicho(nicho) {
  if (!SUPA_KEY || !CACHE_HORAS) return null;
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/buscador_cache?nicho=eq.' + encodeURIComponent(nicho) + '&select=mercado,created_at&limit=1',
      { headers: supaHeaders() });
    if (!r.ok) return null;
    const filas = await r.json();
    const f = Array.isArray(filas) && filas[0];
    if (!f || !f.mercado || typeof f.mercado !== 'object') return null;
    const edadMs = Date.now() - new Date(f.created_at).getTime();
    if (!(edadMs >= 0) || edadMs > CACHE_HORAS * 3600 * 1000) return null;
    return { mercado: f.mercado, creadoEn: f.created_at };
  } catch (e) { return null; }
}

async function guardarCacheNicho(nicho, mercado) {
  if (!SUPA_KEY || !CACHE_HORAS) return false;
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/buscador_cache?on_conflict=nicho', {
      method: 'POST',
      headers: supaHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ nicho, mercado, created_at: new Date().toISOString() })
    });
    if (!r.ok) console.error('[buscador_cache] HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 200));
    return r.ok;
  } catch (e) { return false; }
}

// ------------------------------------------------------------
// "Guardar en mi lista": buscador_lista, por usuario de la sesion firmada
// ------------------------------------------------------------
// Va dentro de este archivo y no en uno nuevo porque api/ ya tiene 12
// funciones, el tope del plan Hobby de Vercel.
function usuarioFirmado(req) {
  const s = leerToken(tokenDe(req));
  return s && s.user ? String(s.user).slice(0, 120) : null;
}

async function manejarLista(req, res, accion) {
  const user = usuarioFirmado(req);
  if (!user) return res.status(401).json({ ok: false, requiereSesion: true, error: 'Sin sesión: la lista queda guardada en este navegador.' });
  if (!SUPA_KEY) return res.status(503).json({ ok: false, error: 'Lista no disponible ahora.' });
  try {
    if (accion === 'leer') {
      const r = await fetch(SUPA_URL + '/rest/v1/buscador_lista?user_id=eq.' + encodeURIComponent(user) +
        '&select=producto_key,producto,nicho,created_at&order=created_at.desc&limit=200', { headers: supaHeaders() });
      if (!r.ok) return res.status(503).json({ ok: false, error: 'No pude leer tu lista.' });
      return res.status(200).json({ ok: true, items: await r.json() });
    }
    const b = req.body || {};
    const key = String(b.key || '').slice(0, 200);
    if (!key) return res.status(400).json({ ok: false, error: 'Falta el producto.' });
    if (accion === 'borrar') {
      const r = await fetch(SUPA_URL + '/rest/v1/buscador_lista?user_id=eq.' + encodeURIComponent(user) +
        '&producto_key=eq.' + encodeURIComponent(key), { method: 'DELETE', headers: supaHeaders({ Prefer: 'return=minimal' }) });
      return res.status(r.ok ? 200 : 503).json({ ok: r.ok });
    }
    // guardar: solo un resumen chico, no la respuesta entera.
    const p = b.producto || {};
    const resumen = {
      nombre: String(p.nombre || '').slice(0, 160), query: String(p.query || '').slice(0, 160),
      precioVentaARS: Number(p.precioVentaARS) || null, margen: Number(p.margen) || null,
      score: Number(p.score) || null, veredicto: String(p.veredicto || '').slice(0, 40),
      links: (p.links && typeof p.links === 'object') ? {
        meli: String(p.links.meli || '').slice(0, 400), alibaba: String(p.links.alibaba || '').slice(0, 400)
      } : null
    };
    const r = await fetch(SUPA_URL + '/rest/v1/buscador_lista?on_conflict=user_id,producto_key', {
      method: 'POST',
      headers: supaHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ user_id: user, producto_key: key, producto: resumen, nicho: String(b.nicho || '').slice(0, 40) || null })
    });
    return res.status(r.ok ? 200 : 503).json({ ok: r.ok });
  } catch (e) {
    return res.status(503).json({ ok: false, error: 'No pude actualizar tu lista.' });
  }
}

// ------------------------------------------------------------
// Pre-analisis de fondo: autorizacion y despacho
// ------------------------------------------------------------
async function precalculoAutorizado(req, url) {
  if (cronAdmitido(req)) return 'cron';
  const clave = req.headers['x-admin-key'];
  if (process.env.ADMIN_KEY && clave && clave === process.env.ADMIN_KEY) return 'admin-key';
  if (esAdmin(tokenDe(req))) return 'admin-sesion';
  const run = (new URL(url, 'http://x')).searchParams.get('run');
  if (await tokenDeCorridaValido(run, { url: SUPA_URL, key: SUPA_KEY })) return 'token-corrida';
  return null;
}

async function manejarPrecalculo(req, res, url) {
  const via = await precalculoAutorizado(req, url);
  if (!via) return res.status(401).json({ ok: false, error: 'No autorizado.' });
  const sp = (new URL(url, 'http://x')).searchParams;
  const modo = sp.get('precalcular');
  // Lecturas gratis de Apify (no arranca nada): esquema del actor y uso del ciclo.
  if (modo === 'apify') {
    const bus = await import('./_buscador.js');
    const [esquema, cuenta] = await Promise.all([
      bus.esquemaDeActor(sp.get('actor') || process.env.APIFY_ACTOR || 'devcake~mercadolibre-scraper').catch(e => ({ error: e.message })),
      bus.estadoCuentaApify().catch(e => ({ error: e.message }))
    ]);
    // dataset/run ya pagados: leerlos es gratis. Sirve para ver los campos
    // crudos del actor (vendidos, fechas) y el costo real facturado.
    let muestra = null, corrida = null;
    if (sp.get('dataset')) {
      const filas = await bus.itemsDeCorrida(sp.get('dataset'), { limite: 48 });
      const claves = {};
      filas.forEach(f => Object.keys(f || {}).forEach(k => { claves[k] = (claves[k] || 0) + (f[k] != null && f[k] !== '' ? 1 : 0); }));
      muestra = { filas: filas.length, campos_con_dato: claves, primeras: filas.slice(0, 2) };
    }
    if (sp.get('apifyRun')) corrida = await bus.detalleDeCorrida(sp.get('apifyRun'), sp.get('dataset'));
    return res.status(200).json({ ok: true, via, esquema: sp.get('dataset') ? undefined : esquema, cuenta, muestra, corrida });
  }
  const tk = await getMeliToken(MELI_USER_PRECALCULO());
  if (!tk || !tk.token) {
    return res.status(503).json({ ok: false, error: 'No hay token vigente de MercadoLibre para ' + MELI_USER_PRECALCULO() + (tk && tk.expired ? ' (vencido y no se pudo renovar)' : '') + '.' });
  }
  // Resuelve la categoria de MeLi de un tramo del catalogo (todos los nichos)
  // y la guarda en buscador_categorias para revisarla. Solo lectura de MeLi.
  if (modo === 'categorias') {
    const todos = [];
    Object.keys(CATALOGO).forEach(k => CATALOGO[k].productos.forEach(p => todos.push({ k, p })));
    const desde = Math.max(0, Number(sp.get('desde')) || 0);
    const n = Math.max(1, Math.min(150, Number(sp.get('n')) || 60));
    const tramo = todos.slice(desde, desde + n);
    const cli = crearCliente(tk.token, { deadline: Date.now() + 50000 });
    const rutas = {};
    const filas = [];
    for (let i = 0; i < tramo.length; i += 4) {
      const lote = tramo.slice(i, i + 4);
      const rs = await Promise.all(lote.map(x => resolverCategoria(cli, x.p, x.k, rutas).catch(e => ({ q: x.p.q, nicho: x.k, nombre: x.p.nombre, estado: 'revisar', motivo: 'error: ' + e.message }))));
      rs.forEach(r => filas.push(Object.assign(r, { actualizado: new Date().toISOString() })));
    }
    let guardadas = false;
    if (SUPA_KEY && filas.length) {
      const r = await fetch(SUPA_URL + '/rest/v1/buscador_categorias?on_conflict=q', {
        method: 'POST', headers: supaHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(filas) }).catch(() => null);
      guardadas = !!(r && r.ok);
    }
    return res.status(200).json({ ok: true, via, desde, procesados: filas.length, total: todos.length, siguiente: desde + filas.length < todos.length ? desde + filas.length : null,
      ok_: filas.filter(f => f.estado === 'ok').length, revisar: filas.filter(f => f.estado === 'revisar').length, guardadas,
      llamadas: cli.estado.llamadas, respuestas429: cli.estado.limitado, cortadas: cli.estado.cortadasPorTiempo || 0 });
  }
  // Mide cuantos productos estaban mal con la busqueda vieja (sin filtro): de
  // los 10 primeros productos de catalogo de la busqueda por palabras, cuantos
  // son del dominio fijado. Lo guarda en buscador_categorias.
  if (modo === 'compararcategorias') {
    const todos = Object.keys(CATEGORIAS).filter(q => CATEGORIAS[q].cat);
    const desde = Math.max(0, Number(sp.get('desde')) || 0);
    const n = Math.max(1, Math.min(200, Number(sp.get('n')) || 100));
    const tramo = todos.slice(desde, desde + n);
    const cli = crearCliente(tk.token, { deadline: Date.now() + 50000 });
    const filas = [];
    for (let i = 0; i < tramo.length; i += 4) {
      const lote = tramo.slice(i, i + 4);
      const rs = await Promise.all(lote.map(q => cli.get('products/search', MELI_API_BUSCADOR + '/products/search?status=active&site_id=MLA&limit=10&q=' + encodeURIComponent(q))));
      rs.forEach((r, k) => {
        const res0 = r.ok && r.json && Array.isArray(r.json.results) ? r.json.results : null;
        if (!res0) return;
        const cuenta = {};
        res0.forEach(x => { cuenta[x.domain_id] = (cuenta[x.domain_id] || 0) + 1; });
        const mayor = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a])[0] || null;
        filas.push({ q: lote[k], sin_filtro_resultados: res0.length, sin_filtro_en_dominio: cuenta[CATEGORIAS[lote[k]].dom] || 0, sin_filtro_dominio_mayoritario: mayor });
      });
    }
    let guardadas = 0;
    for (let i = 0; i < filas.length; i += 20) {
      const rs = await Promise.all(filas.slice(i, i + 20).map(f => fetch(SUPA_URL + '/rest/v1/buscador_categorias?q=eq.' + encodeURIComponent(f.q), { method: 'PATCH',
        headers: supaHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify(f) }).catch(() => null)));
      guardadas += rs.filter(r => r && r.ok).length;
    }
    return res.status(200).json({ ok: true, via, desde, procesados: filas.length, total: todos.length, siguiente: desde + tramo.length < todos.length ? desde + tramo.length : null, guardadas, cortadas: cli.estado.cortadasPorTiempo || 0 });
  }
  // Prueba si /products/search acepta filtro por dominio o categoria.
  if (modo === 'probarfiltro') {
    const q = encodeURIComponent(sp.get('q') || 'gel limpiador teclado');
    const base = MELI_API_BUSCADOR + '/products/search?status=active&site_id=MLA&limit=10&q=' + q;
    const variantes = { sinFiltro: base, domain_id: base + '&domain_id=' + encodeURIComponent(sp.get('dom') || ''), category: base + '&category=' + encodeURIComponent(sp.get('cat') || '') };
    const out = {};
    for (const [nombre, url] of Object.entries(variantes)) {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk.token } }).catch(() => null);
      const j = r ? await r.json().catch(() => null) : null;
      out[nombre] = { status: r && r.status, total: j && j.paging && j.paging.total, dominios: j && Array.isArray(j.results) ? j.results.map(x => x.domain_id) : null, nombres: j && Array.isArray(j.results) ? j.results.slice(0, 4).map(x => String(x.name).slice(0, 50)) : null };
    }
    return res.status(200).json({ ok: true, via, ...out });
  }
  if (modo === 'probar') {
    return res.status(200).json({ ok: true, via, usuario: MELI_USER_PRECALCULO(), ...(await probarEndpoints(tk.token, sp.get('q'), sp.get('item'))) });
  }
  if (modo === 'tanda' || modo === '1') {
    const solo = sp.get('solo') ? sp.get('solo').split(',').map(x => x.trim()).filter(x => CATALOGO[x]) : null;
    const hop = Math.max(0, Math.min(150, Number(sp.get('hop')) || 0));
    // hechos: nichos ya procesados en esta noche (el cron lo pasa de tanda en tanda).
    const hechos = Math.max(0, Number(sp.get('hechos')) || 0);
    // antes=<ISO>: rehace todo lo guardado antes de esa fecha ("Forzar todos"
    // del admin, que corre en varias tandas con la misma fecha de corte).
    const antes = sp.get('antes') && !isNaN(Date.parse(sp.get('antes'))) ? Date.parse(sp.get('antes')) : null;
    // Reparto del presupuesto de Apify por noche: solo en el cron. Una corrida
    // a mano (admin o token) puede usar lo que quede del tope mensual.
    // sinApify=1: recalcula con MeLi y reusa la rotacion ya guardada, sin
    // encolar ni arrancar corridas de Apify (para correcciones a mano).
    const sinApify = sp.get('sinApify') === '1';
    const r = await precalcularTanda({ token: tk.token, solo, antes, hechos, repartir: via === 'cron', sinApify });
    // El cron encadena la tanda siguiente mientras queden nichos de esta noche
    // o corridas de Apify por cosechar. Cada invocacion es una funcion nueva.
    let encadenada = false;
    if (via === 'cron' && r.pendientes > 0 && hop < 120) encadenada = await encadenarTanda(hop + 1, solo, hechos + r.procesados.length);
    return res.status(200).json({ ok: true, via, usuario: MELI_USER_PRECALCULO(), hop, encadenada, ...r });
  }
  if (modo === 'presupuesto') {
    return res.status(200).json({ ok: true, via, ...(await estadoPresupuesto()) });
  }
  return res.status(400).json({ ok: false, error: 'Modo desconocido.' });
}

// Estado del cache de todos los nichos: fecha y version del formato.
async function fechasCacheNichos() {
  const out = {};
  if (!SUPA_KEY) return out;
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/buscador_cache?select=nicho,created_at,v:mercado->__v,parcial:mercado->__parcial', { headers: supaHeaders() });
    if (!r.ok) return out;
    for (const f of await r.json()) out[f.nicho] = { creado: f.created_at, v: f.v, parcial: f.parcial === true };
  } catch (e) {}
  return out;
}

// ------------------------------------------------------------
// Agenda de la noche
// ------------------------------------------------------------
// ~10 nichos por noche (BUSCADOR_NICHOS_POR_NOCHE), cada nicho una vez por
// semana, con prioridad a los que alguien busco en los ultimos 7 dias. El cache
// vale 7 dias (BUSCADOR_CACHE_HORAS = 168).
const NICHOS_POR_NOCHE = () => Math.max(1, Number(process.env.BUSCADOR_NICHOS_POR_NOCHE || 10));
const DIAS_REFRESCO = 6;          // un nicho sin busquedas se rehace a los 6 dias
const DIAS_REFRESCO_BUSCADO = 3;  // uno buscado esta semana, a los 3

async function busquedasRecientes() {
  const out = {};
  if (!SUPA_KEY) return out;
  try {
    const desde = new Date(Date.now() - 7 * 86400e3).toISOString();
    const r = await fetch(SUPA_URL + '/rest/v1/buscador_busquedas?select=nicho&ts=gte.' + encodeURIComponent(desde) + '&limit=5000', { headers: supaHeaders() });
    if (r.ok) for (const f of await r.json()) out[f.nicho] = (out[f.nicho] || 0) + 1;
  } catch (e) {}
  return out;
}

async function registrarBusqueda(nicho) {
  if (!SUPA_KEY) return;
  try {
    await fetch(SUPA_URL + '/rest/v1/buscador_busquedas', { method: 'POST',
      headers: supaHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ nicho }) });
  } catch (e) {}
}

export function agendaDeNichos(claves, fechas, busquedas, opts) {
  const o = opts || {};
  const ahora = o.ahora || Date.now();
  const dias = k => fechas[k] && fechas[k].v === VERSION_MERCADO && !fechas[k].parcial ? (ahora - new Date(fechas[k].creado).getTime()) / 86400e3 : Infinity;
  const creado = k => fechas[k] && fechas[k].v === VERSION_MERCADO && !fechas[k].parcial ? new Date(fechas[k].creado).getTime() : 0;
  let cola;
  if (o.antes != null) cola = claves.filter(k => creado(k) < o.antes).sort((a, b) => dias(b) - dias(a));
  else {
    const buscados = claves.filter(k => (busquedas[k] || 0) > 0 && dias(k) >= DIAS_REFRESCO_BUSCADO)
      .sort((a, b) => (busquedas[b] - busquedas[a]) || (dias(b) - dias(a)));
    const resto = claves.filter(k => buscados.indexOf(k) < 0 && dias(k) >= DIAS_REFRESCO).sort((a, b) => dias(b) - dias(a));
    cola = buscados.concat(resto);
  }
  return cola;
}

// Ranking para la rotacion: demanda + (100 - saturacion), con datos gratis.
function rankingParaRotacion(nichoKey, mercado) {
  const out = [];
  for (const prod of CATALOGO[nichoKey].productos) {
    const m = mercado[prod.q];
    if (!m || !Array.isArray(m.results)) continue;
    const limpios = limpiarMuestra(m.results);
    // Mismo filtro que la tarjeta: si no quedan 3 ofertas comparables con su
    // costo, el producto va a "Pendientes" y medirle vendidos es plata tirada.
    const usdArs = parseFloat(process.env.USD_ARS) || USD_ARS_FALLBACK;
    if (acotarPorCosto(limpios, costoImportacion(prod, usdArs, nichoKey).costoPuestoARS).length < 3) continue;
    const comp = estadisticasCompetencia(limpios, m.catalogoTotal);
    const dem = puntajeDemanda(comp, m);
    const sat = puntajeSaturacion(comp, dem.valor);
    const puntaje = Math.round((dem.valor != null ? dem.valor : 40) + (sat.valor != null ? 100 - sat.valor : 50));
    // Publicaciones a medir: una por producto de catalogo primero (variedad),
    // despues el resto, hasta ITEMS_POR_PRODUCTO.
    const ids = [], vistosCat = new Set();
    for (const x of limpios) if (x.id && !vistosCat.has(x.catalog_product_id)) { vistosCat.add(x.catalog_product_id); ids.push(x.id); }
    for (const x of limpios) if (x.id && ids.indexOf(x.id) < 0) ids.push(x.id);
    out.push({ q: prod.q, puntaje, itemIds: ids.slice(0, ITEMS_POR_PRODUCTO()) });
  }
  return out.sort((a, b) => b.puntaje - a.puntaje);
}

// Una tanda: 1) cosecha corridas de Apify terminadas; 2) procesa UN nicho
// (MEDIDO: 30-40 s a 8 llamadas/s) y encola su top 3 para rotacion; 3) cuando
// no quedan nichos esta noche, arranca UNA corrida de Apify con toda la cola.
async function precalcularTanda({ token, solo, antes, hechos, repartir, sinApify }) {
  const inicio = Date.now();
  // Corte duro a los 50 s de la invocacion: nunca llegar al timeout de 60 s.
  const cli = crearCliente(token, { deadline: inicio + 50000 });
  let rot = { cosecha: null, cola: null, arranque: null };
  try { rot.cosecha = await cosechar(); } catch (e) { rot.cosecha = { error: e.message }; }

  const [fechas, busquedas] = await Promise.all([fechasCacheNichos(), busquedasRecientes()]);
  let claves = Object.keys(CATALOGO);
  if (solo && solo.length) claves = claves.filter(k => solo.indexOf(k) > -1);
  const cupo = solo && solo.length ? claves.length : Math.max(0, NICHOS_POR_NOCHE() - (hechos || 0));
  const cola = agendaDeNichos(claves, fechas, busquedas, { antes }).slice(0, cupo);
  const hechosAhora = [];
  const k = cola[0];
  if (k) {
    const t0 = Date.now();
    const antesLl = cli.estado.llamadas;
    const mercado = await analizarNicho(cli, CATALOGO[k].productos);
    const conDatos = Object.values(mercado).filter(m => m && Array.isArray(m.results) && m.results.length >= 3).length;
    // Cortado por tiempo: queda incompleto. Se guarda marcado como parcial (la
    // tanda siguiente lo rehace) y solo si no habia uno completo del formato
    // actual, para no pisar datos buenos con datos a medias.
    const cortado = (cli.estado.cortadasPorTiempo || 0) > 0;
    const habiaCompleto = fechas[k] && fechas[k].v === VERSION_MERCADO && !fechas[k].parcial;
    let guardado = false;
    if (conDatos > 0 && !(cortado && habiaCompleto)) {
      mercado.__v = VERSION_MERCADO;
      if (cortado) mercado.__parcial = true;
      guardado = await guardarCacheNicho(k, mercado);
    }
    let encolados = null;
    if (guardado && !cortado && !sinApify) {
      try { encolados = await encolar(k, rankingParaRotacion(k, mercado)); } catch (e) { encolados = { error: e.message }; }
    }
    hechosAhora.push({ nicho: k, conDatos, de: CATALOGO[k].productos.length, llamadas: cli.estado.llamadas - antesLl,
      salteados404: cli.estado.salteados404 || 0, ms: Date.now() - t0, guardado, cortadoPorTiempo: cortado,
      buscadoEstaSemana: busquedas[k] || 0, rotacionEncolada: encolados });
  }
  const nichosPendientes = Math.max(0, cola.length - hechosAhora.length);
  // Sin nichos pendientes esta noche: una sola corrida de Apify para toda la cola.
  if (!nichosPendientes && !sinApify) {
    try { rot.arranque = await arrancarCola({ repartir }); } catch (e) { rot.arranque = { error: e.message }; }
  }
  // Corridas por cosechar: si no hubo nicho que procesar, se espera un rato
  // aca adentro (una corrida tarda 1-3 min) para no encadenar tandas vacias.
  let porCosechar = (rot.cosecha && rot.cosecha.pendientes) || 0;
  if ((rot.arranque && rot.arranque.arrancada) || porCosechar) {
    if (!k) {
      while (Date.now() - inicio < 45000) {
        await new Promise(z => setTimeout(z, 8000));
        try { const c = await cosechar(); rot.cosecha = c; porCosechar = c.pendientes || 0; } catch (e) { break; }
        if (!porCosechar) break;
      }
    } else if (rot.arranque && rot.arranque.arrancada) porCosechar = Math.max(porCosechar, rot.arranque.productos);
  }
  return {
    procesados: hechosAhora, pendientes: nichosPendientes + porCosechar,
    nichosPendientes, rotacionPorCosechar: porCosechar, nichosTotales: Object.keys(CATALOGO).length, cupoNoche: NICHOS_POR_NOCHE(),
    rotacion: rot,
    llamadas: cli.estado.llamadas, porEndpoint: cli.estado.porEndpoint, errores: cli.estado.errores,
    respuestas429: cli.estado.limitado, intervaloFinalMs: cli.intervaloActual(), ms: Date.now() - inicio
  };
}

async function encadenarTanda(hop, solo, hechos) {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || 'productfinder-ia.vercel.app';
  const qs = 'precalcular=tanda&hop=' + hop + '&hechos=' + (hechos || 0) + (solo ? '&solo=' + encodeURIComponent(solo.join(',')) : '');
  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), 3000);
  try {
    // No se espera la respuesta: alcanza con que el pedido salga. La tanda
    // siguiente corre en su propia invocacion.
    await fetch('https://' + host + '/api/analyze?' + qs, {
      headers: { Authorization: 'Bearer ' + (process.env.CRON_SECRET || ''), 'user-agent': 'vercel-cron/1.0 (encadenado)' },
      signal: ctrl.signal
    });
    return true;
  } catch (e) {
    return e && e.name === 'AbortError';   // abortar por tiempo es lo esperado
  } finally { clearTimeout(corte); }
}

// ProductFinder IA - API Handler
// Handles /api/auth, /api/analyze, /api/chat

export default async function handler(req, res) {
  const url = req.url || '';
  const path = url.split('?')[0];

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // El login vive en api/auth.js: Vercel rutea /api/auth a ese archivo.
  // Aca habia una copia que nunca se ejecutaba.

  // CHAT ENDPOINT
  if (path.endsWith('/chat')) {
    if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});
    const { message, context } = req.body;
    if (!message) return res.status(400).json({error: 'Message required'});

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({error: 'API key not configured'});

    try {
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: anthropicHeaders(),
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 512,
          system: 'Sos un asesor especialista en importacion desde China hacia Argentina con 15 anos de experiencia. Respondés en español argentino de forma concisa y practica. Te especializas en logistica, aranceles, productos rentables, estrategias de venta en Mercado Libre y e-commerce. Maximo 3 parrafos por respuesta.',
          messages: [{role: 'user', content: message}]
        })
      });

      const data = await apiRes.json();
      if (!apiRes.ok) throw new Error(data.error?.message || 'API error');
      const response = data.content?.[0]?.text || 'No pude generar una respuesta.';
      return res.status(200).json({response});
    } catch(err) {
      return res.status(500).json({error: err.message, response: 'Error al conectar con el asesor IA. Por favor intentá de nuevo.'});
    }
  }
  // ANALYZE ENDPOINT (default) - datos reales de MercadoLibre

  // GET /api/analyze -> la lista de nichos que el backend REALMENTE sabe
  // analizar. El selector del front la consume para no volver a ofrecer
  // opciones que despues no devuelven nada.
  // Pre-analisis de fondo (cron nocturno, boton de admin o token de corrida).
  if (/[?&]precalcular=/.test(url)) {
    res.setHeader('Cache-Control', 'no-store');
    return manejarPrecalculo(req, res, url);
  }
  if (req.method === 'GET' && /[?&]lista=1/.test(url)) {
    res.setHeader('Cache-Control', 'no-store');
    return manejarLista(req, res, 'leer');
  }
  // GET con ?nicho=: la misma consulta que el POST pero SOLO con datos ya
  // pre-analizados (sin token: nunca llama a MercadoLibre). Sirve para
  // compartir un resultado por link y para verificar un preview.
  const _sp = new URL(url, 'http://x').searchParams;
  const _vista = req.method === 'GET' && _sp.get('nicho');
  if (_vista) {
    req.body = { nicho: _sp.get('nicho'), capital: _sp.get('capital'), experiencia: _sp.get('experiencia'),
      canal: _sp.get('canal'), riesgo: _sp.get('riesgo'), user_id: '' };
    res.setHeader('Cache-Control', 'no-store');
  }
  if (req.method === 'GET' && !_vista) {
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=86400');
    const nichos = listarNichos();
    // La cotizacion viaja junto con la lista: MargenClear la usa para no
    // arrancar con un tipo de cambio clavado, y al pedirla por aca (mismo
    // origen) no depende de que dolarapi habilite CORS en el navegador.
    // Una sola fuente de dolar para toda la app (_dolar.js), con el mismo
    // default que el Market Reader: MEP. Antes aca se pedia /dolares/tarjeta
    // (~1989) mientras el Market Reader arrancaba en 1250 hardcodeado: 59% de
    // diferencia entre dos pantallas de la misma app.
    let dolar = null, dolarFuente = null, dolarTipo = null;
    const _cot = await tipoDeCambio(DOLAR_TIPO_DEFAULT);
    if (_cot.valor != null) {
      dolar = _cot.valor;
      dolarTipo = _cot.tipo;
      dolarFuente = 'dolarapi.com (' + _cot.tipo + ')';
    }
    return res.status(200).json({
      nichos: nichos, total: nichos.length, porDefecto: NICHO_POR_DEFECTO,
      dolar: dolar, dolarFuente: dolarFuente, dolarTipo: dolarTipo,
      cotizaciones: await cotizacionDolar()
    });
  }

  if (req.method !== 'POST' && !_vista) return res.status(405).json({error: 'Method not allowed'});
  const accion = !_vista && req.body && req.body.accion;
  if (accion === 'lista_guardar') return manejarLista(req, res, 'guardar');
  if (accion === 'lista_borrar') return manejarLista(req, res, 'borrar');
  try {
    const { nicho, capital, experiencia, canal, riesgo, user_id } = req.body || {};
    const resuelto = resolverNicho(nicho);
    const nichoKey = resuelto.key;
    const niche = CATALOGO[nichoKey];
    const uno = (v, ok, d) => ok.indexOf(v) > -1 ? v : d;
    const perfil = {
      capital: uno(capital, ['bajo', 'medio', 'alto', 'premium'], 'bajo'),
      experiencia: uno(experiencia, ['ninguna', 'poca', 'media', 'alta'], 'ninguna'),
      canal: uno(canal, ['mercadolibre', 'tiendanube', 'local', 'mayorista'], 'mercadolibre'),
      riesgo: uno(riesgo, ['bajo', 'medio', 'alto'], 'medio')
    };

    // Mismo tipo de cambio y misma funcion que el Market Reader: MEP.
    let usdArs = parseFloat(process.env.USD_ARS) || USD_ARS_FALLBACK;
    const _tc = await tipoDeCambio(DOLAR_TIPO_DEFAULT);
    if (_tc.valor != null) usdArs = _tc.valor;

    // 1. Cache del nicho (lo llena el pre-analisis nocturno; 24 h). Si esta, no
    //    se le pide nada a MercadoLibre. Solo vale el formato actual: un cache
    //    del formato anterior no tiene demanda/rotacion y se trata como pendiente.
    const lista = niche.productos;
    let mercadoPorQ = null, datosDe = null, desdeCache = false;
    const enCache = await leerCacheNicho(nichoKey);
    if (enCache && enCache.mercado.__v === VERSION_MERCADO) { mercadoPorQ = enCache.mercado; datosDe = enCache.creadoEn; desdeCache = true; }

    const tk = mercadoPorQ ? null : await getMeliToken(user_id);
    const token = tk && tk.token ? tk.token : null;
    const tokenExpired = tk && tk.expired ? true : false;

    // 2. Sin cache y con MeLi conectado: el mismo recolector del proceso
    //    nocturno, con el token del visitante (gratis, nunca Apify).
    if (!mercadoPorQ && token) {
      const cli = crearCliente(token, { rps: 12 });
      mercadoPorQ = await analizarNicho(cli, lista);
      datosDe = new Date().toISOString();
      if (Object.values(mercadoPorQ).some(m => m && Array.isArray(m.results) && m.results.length >= 3)) {
        mercadoPorQ.__v = VERSION_MERCADO;
        await guardarCacheNicho(nichoKey, mercadoPorQ);
      }
    }

    // 3. Perfil encima del mercado: cuenta local, sin red.
    // Vendidos medidos (rotacion) y registro de la busqueda (prioriza el nicho
    // en el proceso nocturno). Las dos cosas en paralelo, sin frenar la respuesta.
    const [historial] = await Promise.all([historialDe(lista.map(p => p.q)), registrarBusqueda(nichoKey)]);
    const productos = lista.map(prod => evaluarProducto(prod, nichoKey, mercadoPorQ ? (mercadoPorQ[prod.q] || null) : null, perfil, usdArs, historial[prod.q] || null));
    // Sin datos reales no hay tarjeta: van a "Pendientes de analisis" con
    // nombre y links, nada mas.
    const conDatos = ordenar(productos.filter(p => !p.sinDatos));
    const pendientes = productos.filter(p => p.sinDatos).map(p => ({ nombre: p.nombre, query: p.query, links: p.links, motivo: p.motivoSinDatos }));
    // TOP PICK solo si de verdad es una oportunidad: nunca un "no conviene", ni un
    // producto con rotacion medida baja, ni uno sin margen (pocos precios).
    const top = conDatos.find(p => p.veredicto && (p.veredicto.nivel === 'alta' || p.veredicto.nivel === 'media') && p.capacidad.escenario !== 'ninguno' && p.margen != null &&
      !(p.metricas && p.metricas.rotacion && p.metricas.rotacion.nivel === 'Baja'));
    if (top) top.topPick = true;
    const conDato = conDatos.length;

    // El recorte se decide ACA, no en el navegador: sin token firmado de
    // cliente, los productos bloqueados directamente no salen del servidor.
    // Se recortan solo los que tienen datos; los pendientes no tienen nada que
    // esconder.
    const cliente = esCliente(tokenDe(req));
    const totalDisponibles = conDatos.length;
    let filtrados = conDatos;
    if (!cliente && filtrados.length > LIMITE_GRATIS) {
      filtrados = filtrados.slice(0, LIMITE_GRATIS);
    }
    const edadHoras = datosDe ? Math.max(0, (Date.now() - new Date(datosDe).getTime()) / 3600000) : null;
    return res.status(200).json({
      nicho: nichoKey, nichoLabel: niche.label, icon: niche.icon, usdArs: usdArs,
      nichoSolicitado: nicho || null, nichoAproximado: !resuelto.exacto,
      perfil: Object.assign({}, perfil, { capitalLabel: CAPITAL_LABEL[perfil.capital] }),
      totalEvaluados: productos.length, conDatoReal: conDato,
      esCliente: cliente, productosMostrados: filtrados.length, productosTotales: totalDisponibles,
      // Con cache no se mira el token (no hace falta): se informa como conectado
      // para no mostrar el aviso de "precios estimados" sobre datos reales.
      meliConectado: !!token || conDato > 0, meliTokenExpirado: tokenExpired,
      datosDe: datosDe, desdeCache: desdeCache, edadHoras: edadHoras != null ? Math.round(edadHoras * 10) / 10 : null,
      edadDias: edadHoras != null ? Math.floor(edadHoras / 24) : null,
      cacheHoras: CACHE_HORAS,
      products: filtrados, pendientes: pendientes,
      disclaimer: 'Demanda, rotación, saturación, precio y comisión: datos de la API oficial de MercadoLibre (pre-analizados cada noche). El costo de importación es una ESTIMACIÓN por categoría (FOB típico + logística marítima por volumen + tributos), no una cotización: ajustalo con la tuya en MargenClear.'
    });
  } catch(err) {
    return res.status(500).json({error: 'Error interno del servidor', detail: err.message});
  }
}
