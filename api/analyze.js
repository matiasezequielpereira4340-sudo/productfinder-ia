// ============================================================
// ProductFinder IA - /api/analyze (v2 datos reales de MercadoLibre)
// AUTH y CHAT se mantienen intactos. El bloque ANALYZE ahora
// recomienda productos del catalogo curado y trae precios y
// competencia REALES desde la API oficial de MeLi (token OAuth
// del usuario en Supabase). Si no hay token vigente, marca los
// datos como estimados y nunca inventa precios reales.
// ============================================================

import { resolveUserId, buscarPublicaciones, anthropicHeaders } from './_meli.js';

const USD_ARS_FALLBACK = 1510;
const SUPA_URL = process.env.SUPABASE_URL || 'https://qglieqpcmmffgxijbysb.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const CATALOGO = {
  tecnologia: { label: 'Tecnología / Gadgets', icon: '💻', productos: [
    { nombre:'Soporte magnético para cable bajo escritorio (clip)', q:'clip organizador cable bajo escritorio', costoMin:0.4, costoMax:1.1, pesoG:30, nota:'Nicho oficina en casa' },
    { nombre:'Soporte para tablet ajustable de escritorio', q:'soporte tablet escritorio ajustable', costoMin:1.2, costoMax:3, pesoG:130, nota:'Menos saturado que celular' },
    { nombre:'Lector microSD USB-C a tipo C rapido', q:'lector microsd usb c tipo c', costoMin:0.8, costoMax:2, pesoG:15, nota:'Diminuto, recompra' },
    { nombre:'Aro de luz para celular con clip (mini)', q:'aro luz celular clip', costoMin:1.2, costoMax:3, pesoG:60, nota:'Tendencia contenido' },
    { nombre:'Soporte colgante para auriculares bajo escritorio', q:'soporte auricular gancho bajo escritorio', costoMin:1, costoMax:2.5, pesoG:70, nota:'Gamer setup' },
    { nombre:'Grip anillo adhesivo para celular', q:'popsocket soporte anillo celular', costoMin:0.2, costoMax:0.7, pesoG:20, nota:'Barato, recompra' },
    { nombre:'Limpiador de teclado gel reutilizable', q:'gel limpiador teclado reutilizable', costoMin:0.5, costoMax:1.5, pesoG:60, nota:'Consumible, recompra' },
    { nombre:'Splitter auxiliar 3.5mm para compartir audio', q:'splitter auxiliar 3.5mm audio', costoMin:0.6, costoMax:1.8, pesoG:25, nota:'Accesorio de nicho' },
    { nombre:'Soporte notebook plegable de aluminio', q:'soporte notebook aluminio plegable', costoMin:3, costoMax:7, pesoG:300, nota:'Ergonomía' },
    { nombre:'Mouse pad XL antideslizante', q:'mousepad gamer xl', costoMin:1, costoMax:3, pesoG:250, nota:'Liviano' },
    { nombre:'Etiquetadores de cable de silicona (set)', q:'etiquetas cables silicona set', costoMin:0.5, costoMax:1.5, pesoG:40, nota:'Home office prolijo' },
    { nombre:'Enrollador retractil para cable de carga', q:'enrollador retractil cable carga', costoMin:0.7, costoMax:2, pesoG:40, nota:'Viajero, liviano' },
  ]},
  hogar: { label: 'Hogar y Deco', icon: '🏠', productos: [
    { nombre:'Soporte cepillo de dientes magnetico adhesivo', q:'soporte cepillo dientes magnetico adhesivo', costoMin:0.6, costoMax:1.8, pesoG:60, nota:'Bano, novedoso' },
    { nombre:'Separadores de cajon expandibles (par)', q:'separadores cajon expandibles', costoMin:1.5, costoMax:3.5, pesoG:180, nota:'Menos comun que set modular' },
    { nombre:'Portallaves magnetico adhesivo de pared', q:'portallaves magnetico adhesivo pared', costoMin:0.8, costoMax:2, pesoG:80, nota:'Entrada de casa' },
    { nombre:'Tira LED USB para ambiente (2m)', q:'tira led usb ambiente', costoMin:0.8, costoMax:2.5, pesoG:80, nota:'Deco tendencia' },
    { nombre:'Rociador presurizado para plantas', q:'rociador presion plantas', costoMin:1.5, costoMax:3.5, pesoG:180, nota:'Jardín interior' },
    { nombre:'Bolsas al vacío para ropa (set)', q:'bolsas vacio ropa', costoMin:1, costoMax:3, pesoG:150, nota:'Ahorro espacio' },
    { nombre:'Colgador apilable de carteras y bolsos', q:'colgador apilable carteras placard', costoMin:1.2, costoMax:3, pesoG:150, nota:'Placard, nicho' },
    { nombre:'Difusor de aromas mini USB', q:'difusor aromas usb mini', costoMin:1.5, costoMax:4, pesoG:150, nota:'Deco + bienestar' },
    { nombre:'Burlete adhesivo bajo puerta anti ruido', q:'burlete adhesivo bajo puerta', costoMin:1, costoMax:2.5, pesoG:120, nota:'Ahorro energia, nicho' },
    { nombre:'Set de utensilios de silicona', q:'utensilios silicona cocina set', costoMin:2, costoMax:5, pesoG:400, nota:'No frágil' },
    { nombre:'Reloj proyector de techo mini', q:'reloj proyector techo mini', costoMin:2, costoMax:4, pesoG:150, nota:'Novedoso dormitorio' },
    { nombre:'Organizador de cosméticos giratorio', q:'organizador cosmeticos giratorio', costoMin:2, costoMax:5, pesoG:350, nota:'Público femenino' },
  ]},
  deportes: { label: 'Deportes / Fitness', icon: '🏋️', productos: [
    { nombre:'Mini bandas de gluteos de tela (set)', q:'banda tela gluteos set', costoMin:1.5, costoMax:3.5, pesoG:150, nota:'Tendencia fitness femenino' },
    { nombre:'Disco giratorio de equilibrio y core', q:'disco equilibrio balance core', costoMin:2, costoMax:4.5, pesoG:300, nota:'Menos saturado que rueda' },
    { nombre:'Cuerda de saltar sin cuerda con peso', q:'cuerda saltar sin cuerda cordless', costoMin:1.2, costoMax:3, pesoG:150, nota:'Novedad indoor' },
    { nombre:'Guantes de gimnasio antideslizantes', q:'guantes gimnasio', costoMin:1, costoMax:3, pesoG:120, nota:'Recompra' },
    { nombre:'Botella plegable de silicona compacta', q:'botella plegable silicona deporte', costoMin:1.5, costoMax:3.5, pesoG:120, nota:'Viaje, ocupa poco' },
    { nombre:'Rodillo masajeador muscular', q:'rodillo masajeador muscular', costoMin:2, costoMax:5, pesoG:350, nota:'Recuperación' },
    { nombre:'Tobilleras con peso ajustable', q:'tobilleras peso ejercicio', costoMin:2.5, costoMax:6, pesoG:500, nota:'Peso ok' },
    { nombre:'Fortalecedor de mano ajustable', q:'fortalecedor mano grip', costoMin:0.8, costoMax:2.5, pesoG:100, nota:'Chico' },
    { nombre:'Cinta kinesiológica deportiva', q:'cinta kinesiologica deportiva', costoMin:1, costoMax:3, pesoG:80, nota:'Consumible' },
    { nombre:'Riñonera deportiva para running', q:'riñonera running deportiva', costoMin:1.5, costoMax:4, pesoG:120, nota:'Textil liviano' },
    { nombre:'Discos deslizantes para core', q:'sliders discos ejercicio core', costoMin:1, costoMax:3, pesoG:150, nota:'Chico' },
    { nombre:'Toalla de microfibra deportiva', q:'toalla microfibra deportiva', costoMin:1.5, costoMax:4, pesoG:200, nota:'Recompra' },
  ]},
  moda: { label: 'Moda / Indumentaria', icon: '👕', productos: [
    { nombre:'Clip solar polarizado para anteojos', q:'clip solar polarizado anteojos', costoMin:1, costoMax:2.5, pesoG:30, nota:'Nicho usuarios de lentes' },
    { nombre:'Riñonera urbana de tela', q:'riñonera urbana tela', costoMin:2, costoMax:5, pesoG:200, nota:'Tendencia' },
    { nombre:'Medias antideslizantes pilates (pack)', q:'medias antideslizantes pilates', costoMin:1, costoMax:3, pesoG:100, nota:'Recompra' },
    { nombre:'Organizador de aros/piercings de viaje', q:'organizador aros joyas viaje', costoMin:1, costoMax:2.5, pesoG:80, nota:'Accesorio nicho' },
    { nombre:'Bucket hat reversible de tela', q:'bucket hat reversible', costoMin:1.5, costoMax:3.5, pesoG:100, nota:'Tendencia joven' },
    { nombre:'Pañuelo de seda satinado', q:'pañuelo seda satinado mujer', costoMin:1, costoMax:3.5, pesoG:60, nota:'Liviano' },
    { nombre:'Billetera slim antirrobo RFID', q:'billetera slim rfid', costoMin:1.5, costoMax:4, pesoG:80, nota:'Chica' },
    { nombre:'Scrunchies de tela (pack)', q:'scrunchies pack pelo', costoMin:0.5, costoMax:2, pesoG:50, nota:'Barato, recompra' },
    { nombre:'Guantes touchscreen de invierno', q:'guantes touchscreen invierno', costoMin:1, costoMax:3, pesoG:100, nota:'Estacional' },
    { nombre:'Aros minimalistas de acero (set)', q:'aros acero quirurgico set mujer', costoMin:0.8, costoMax:3, pesoG:30, nota:'Sin níquel' },
    { nombre:'Medias térmicas de invierno (pack)', q:'medias termicas invierno', costoMin:1, costoMax:3, pesoG:150, nota:'Estacional' },
    { nombre:'Corbata slim moderna', q:'corbata slim', costoMin:1, costoMax:3, pesoG:80, nota:'Liviano' },
  ]},
  mascotas: { label: 'Mascotas', icon: '🐶', productos: [
    { nombre:'Cepillo quita pelos para mascotas', q:'cepillo quita pelos mascotas', costoMin:1, costoMax:3, pesoG:120, nota:'Recompra' },
    { nombre:'Comedero antivoracidad para perros', q:'comedero antivoracidad perro', costoMin:1.5, costoMax:4, pesoG:200, nota:'No frágil' },
    { nombre:'Juguete dispensador de premios', q:'juguete dispensador premios perro', costoMin:1.5, costoMax:4, pesoG:150, nota:'Tendencia' },
    { nombre:'Cortauñas para mascotas con lima', q:'cortauñas mascotas', costoMin:0.8, costoMax:2.5, pesoG:80, nota:'Chico' },
    { nombre:'Alfombra de lameteo antiestres para perros', q:'alfombra lameteo lick mat perro', costoMin:1.5, costoMax:3.5, pesoG:150, nota:'Tendencia bienestar animal' },
    { nombre:'Collar LED recargable de seguridad', q:'collar led perro recargable', costoMin:1.5, costoMax:4, pesoG:80, nota:'Seguridad' },
    { nombre:'Bolsas biodegradables para heces', q:'bolsas caca perro biodegradables', costoMin:0.5, costoMax:2, pesoG:100, nota:'Consumible' },
    { nombre:'Tunel plegable de juego para gatos', q:'tunel plegable juego gato', costoMin:2, costoMax:4.5, pesoG:250, nota:'Novedoso, liviano plegado' },
    { nombre:'Bebedero plegable de viaje', q:'bebedero plegable perro viaje', costoMin:1, costoMax:3, pesoG:90, nota:'Liviano' },
    { nombre:'Bolsa dispensadora de premios de entrenamiento', q:'bolsa premios entrenamiento perro cinturon', costoMin:1, costoMax:2.5, pesoG:120, nota:'Adiestramiento, nicho' },
    { nombre:'Guante de aseo para mascotas', q:'guante aseo mascotas', costoMin:1, costoMax:3, pesoG:100, nota:'Recompra' },
    { nombre:'Juguete de plumas para gato', q:'juguete gato plumas varita', costoMin:0.5, costoMax:2, pesoG:60, nota:'Barato' },
  ]},
  bebes: { label: 'Bebés / Niños', icon: '🍼', productos: [
    { nombre:'Babero de silicona impermeable', q:'babero silicona bebe', costoMin:1, costoMax:3, pesoG:80, nota:'Recompra' },
    { nombre:'Mordillo de silicona para dentición', q:'mordillo silicona bebe', costoMin:0.8, costoMax:2.5, pesoG:50, nota:'Grado alimenticio' },
    { nombre:'Sujetador de manta/juguete para cochecito', q:'sujetador manta juguete cochecito clip', costoMin:0.8, costoMax:2, pesoG:60, nota:'Practico, liviano' },
    { nombre:'Protectores de esquinas (pack)', q:'protector esquinas bebe seguridad', costoMin:0.5, costoMax:2, pesoG:100, nota:'Consumible' },
    { nombre:'Tapas antiderrame para vasos', q:'tapa antiderrame vaso niños', costoMin:1, costoMax:3, pesoG:80, nota:'Novedad' },
    { nombre:'Juguete apilable de silicona', q:'juguete apilable silicona bebe', costoMin:1.5, costoMax:4, pesoG:150, nota:'Didáctico' },
    { nombre:'Termómetro de baño para bebé', q:'termometro baño bebe', costoMin:1, costoMax:3, pesoG:80, nota:'Chico' },
    { nombre:'Protector de arnes de cochecito acolchado', q:'protector arnes cochecito acolchado', costoMin:1, costoMax:2.5, pesoG:100, nota:'Nicho, recompra' },
    { nombre:'Broches para chupete (set)', q:'broche chupete bebe', costoMin:0.5, costoMax:2, pesoG:40, nota:'Recompra' },
    { nombre:'Luz nocturna quitamiedos LED', q:'luz nocturna infantil led', costoMin:1.5, costoMax:4, pesoG:150, nota:'Deco infantil' },
    { nombre:'Libro sensorial de tela quiet book', q:'libro sensorial tela bebe quiet book', costoMin:2, costoMax:4.5, pesoG:200, nota:'Educativo, tendencia' },
    { nombre:'Delantal de pintura para niños', q:'delantal pintura niños', costoMin:1, costoMax:3, pesoG:120, nota:'Textil' },
  ]},
  belleza: { label: 'Salud y Belleza', icon: '💄', productos: [
    { nombre:'Rodillo facial de cuarzo/jade', q:'rodillo facial jade cuarzo', costoMin:1, costoMax:3, pesoG:100, nota:'Tendencia skincare' },
    { nombre:'Esponja limpiadora de brochas de silicona', q:'limpiador brochas silicona', costoMin:0.6, costoMax:1.8, pesoG:60, nota:'Accesorio, recompra' },
    { nombre:'Aplicador de pestañas postizas de precision', q:'aplicador pestanas postizas pinza', costoMin:0.8, costoMax:2, pesoG:40, nota:'Nicho, liviano' },
    { nombre:'Masajeador facial gua sha', q:'gua sha masajeador facial', costoMin:0.8, costoMax:2.5, pesoG:60, nota:'Tendencia' },
    { nombre:'Bandeja magnetica organizadora de aros', q:'organizador aros pendientes bandeja', costoMin:1.2, costoMax:3, pesoG:180, nota:'Nicho joyeria' },
    { nombre:'Rizador de pestañas', q:'rizador pestañas', costoMin:0.5, costoMax:2, pesoG:40, nota:'Recompra' },
    { nombre:'Secador difusor de bolsillo para rulos', q:'difusor plegable secador rulos', costoMin:1.5, costoMax:3.5, pesoG:150, nota:'Nicho cabello rizado' },
    { nombre:'Kit de manicura (set)', q:'kit manicura set', costoMin:1, costoMax:3, pesoG:150, nota:'Recompra' },
    { nombre:'Vincha de spa skincare (pack)', q:'vincha spa skincare', costoMin:0.5, costoMax:2, pesoG:50, nota:'Barato' },
    { nombre:'Depilador facial eléctrico mini', q:'depilador facial electrico mini', costoMin:1.5, costoMax:4, pesoG:80, nota:'Chico' },
    { nombre:'Lámpara mini LED para uñas', q:'lampara uñas mini led', costoMin:2, costoMax:5, pesoG:200, nota:'Nicho nails' },
    { nombre:'Parches de hidrogel para ojeras', q:'parches ojeras hidrogel', costoMin:0.8, costoMax:2.5, pesoG:60, nota:'Consumible' },
  ]},
  cocina: { label: 'Cocina / Gastronomía', icon: '🍳', productos: [
    { nombre:'Cortador de hierbas y ajo manual mini', q:'picador ajo hierbas manual mini', costoMin:0.8, costoMax:2, pesoG:120, nota:'Especifico, menos saturado' },
    { nombre:'Molinillo manual de sal y pimienta', q:'molinillo sal pimienta manual', costoMin:1.5, costoMax:4, pesoG:200, nota:'No frágil' },
    { nombre:'Moldes de silicona repostería (set)', q:'moldes silicona reposteria set', costoMin:1.5, costoMax:4, pesoG:250, nota:'Recompra' },
    { nombre:'Prensa manual para palta/guacamole', q:'prensa palta guacamole utensilio', costoMin:0.9, costoMax:2.2, pesoG:130, nota:'Tendencia saludable' },
    { nombre:'Tabla flexible para picar (set colores)', q:'tabla flexible picar set', costoMin:1, costoMax:2.5, pesoG:150, nota:'Higiene por color' },
    { nombre:'Rociador de aceite en spray', q:'rociador aceite spray cocina', costoMin:1.5, costoMax:4, pesoG:150, nota:'Fitness cook' },
    { nombre:'Pelador de cerámica (set)', q:'pelador ceramica set', costoMin:0.8, costoMax:2.5, pesoG:100, nota:'Recompra' },
    { nombre:'Termómetro digital de cocina', q:'termometro cocina digital', costoMin:1, costoMax:3, pesoG:80, nota:'Chico' },
    { nombre:'Batidor eléctrico mini de leche', q:'batidor leche electrico mini', costoMin:1, costoMax:3, pesoG:100, nota:'Barista casero' },
    { nombre:'Bolsas reutilizables de silicona', q:'bolsas reutilizables alimentos silicona', costoMin:1.5, costoMax:4, pesoG:150, nota:'Eco tendencia' },
    { nombre:'Sellador manual de bolsas recargable', q:'sellador bolsas manual mini', costoMin:0.7, costoMax:2, pesoG:80, nota:'Consumo diario, nicho' },
    { nombre:'Escurridor de pasta con clip', q:'escurridor pasta olla clip', costoMin:1, costoMax:3, pesoG:100, nota:'Novedad' },
  ]},
  automotor: { label: 'Automotor / Moto', icon: '🚗', productos: [
    { nombre:'Soporte magnético de celular para auto', q:'soporte celular auto magnetico', costoMin:1, costoMax:3, pesoG:80, nota:'Alta demanda' },
    { nombre:'Gancho organizador entre asientos de auto', q:'gancho organizador entre asientos auto', costoMin:0.8, costoMax:2, pesoG:60, nota:'Practico, liviano' },
    { nombre:'Cargador USB dual para auto', q:'cargador auto usb dual', costoMin:0.8, costoMax:2.5, pesoG:40, nota:'Chico' },
    { nombre:'Kit de luces LED interior', q:'luces led interior auto', costoMin:1.5, costoMax:4, pesoG:120, nota:'Tuning' },
    { nombre:'Ganchos organizadores de baúl (par)', q:'gancho baul auto organizador', costoMin:1, costoMax:3, pesoG:100, nota:'Chico' },
    { nombre:'Limpiador de rejillas de aire de auto (kit)', q:'cepillo limpiador rejillas auto detailing', costoMin:0.7, costoMax:2, pesoG:80, nota:'Tendencia detailing' },
    { nombre:'Escobillas de silicona (par)', q:'escobilla limpiaparabrisas silicona', costoMin:1.5, costoMax:4, pesoG:200, nota:'Consumible' },
    { nombre:'Aromatizante clip de ventilación', q:'aromatizante auto clip', costoMin:0.5, costoMax:2, pesoG:40, nota:'Recompra' },
    { nombre:'Removedor de pelos de mascota para tapizado', q:'removedor pelos mascota auto tapizado', costoMin:0.8, costoMax:2.2, pesoG:100, nota:'Nicho detailing' },
    { nombre:'Plumero para tablero', q:'plumero limpieza auto tablero', costoMin:1, costoMax:3, pesoG:100, nota:'Recompra' },
    { nombre:'Gancho de casco para moto', q:'gancho casco moto', costoMin:1, costoMax:3, pesoG:100, nota:'Nicho moto' },
    { nombre:'Guantes de moto media estación', q:'guantes moto verano', costoMin:2, costoMax:5, pesoG:150, nota:'Textil' },
  ]},
  herramientas: { label: 'Herramientas / Bricolaje', icon: '🔧', productos: [
    { nombre:'Kit reparacion de electronica con puas (celular)', q:'kit apertura reparacion celular puas', costoMin:1.5, costoMax:3.5, pesoG:150, nota:'Reparadores, nicho' },
    { nombre:'Nivel láser mini autonivelante', q:'nivel laser mini', costoMin:3, costoMax:7, pesoG:250, nota:'Alto margen' },
    { nombre:'Medidor láser de distancia', q:'medidor laser distancia', costoMin:3, costoMax:8, pesoG:150, nota:'Alto ticket' },
    { nombre:'Pulsera magnetica porta tornillos', q:'pulsera magnetica tornillos', costoMin:1, costoMax:2.5, pesoG:120, nota:'Novedoso, manos libres' },
    { nombre:'Adaptador de taladro a lijadora/pulidora', q:'adaptador taladro lijadora disco', costoMin:1.2, costoMax:3, pesoG:150, nota:'Nicho DIY' },
    { nombre:'Linterna LED recargable de mano', q:'linterna led recargable mano', costoMin:2, costoMax:5, pesoG:150, nota:'Recompra' },
    { nombre:'Cinta métrica retráctil 5m', q:'cinta metrica 5 metros', costoMin:1, costoMax:3, pesoG:150, nota:'Chico' },
    { nombre:'Pistola de silicona caliente mini', q:'pistola silicona caliente mini', costoMin:1.5, costoMax:4, pesoG:200, nota:'Manualidades' },
    { nombre:'Guantes de trabajo anticorte', q:'guantes trabajo anticorte', costoMin:1, costoMax:3, pesoG:120, nota:'Recompra' },
    { nombre:'Set de llaves allen plegable', q:'set llaves allen plegable', costoMin:1, costoMax:3, pesoG:150, nota:'Chico' },
    { nombre:'Cinta doble faz montaje extra fuerte (nano)', q:'cinta nano doble faz montaje', costoMin:0.8, costoMax:2.5, pesoG:120, nota:'Viral, recompra' },
    { nombre:'Detector de cables de pared', q:'detector cables pared', costoMin:2, costoMax:5, pesoG:150, nota:'Novedad' },
  ]},
  camping: { label: 'Camping / Outdoor', icon: '🏕️', productos: [
    { nombre:'Farol colgante plegable USB para carpa', q:'farol plegable usb camping carpa', costoMin:1.5, costoMax:3.5, pesoG:150, nota:'Compacto, liviano' },
    { nombre:'Cubiertos plegables de viaje', q:'cubiertos plegables camping', costoMin:1.5, costoMax:4, pesoG:150, nota:'Liviano' },
    { nombre:'Manta térmica de emergencia (pack)', q:'manta termica emergencia', costoMin:0.5, costoMax:2, pesoG:60, nota:'Consumible' },
    { nombre:'Filtro de agua portátil personal', q:'filtro agua portatil camping', costoMin:3, costoMax:8, pesoG:120, nota:'Alto margen' },
    { nombre:'Almohada inflable de camping ultraliviana', q:'almohada inflable camping ultraliviana', costoMin:1.2, costoMax:3, pesoG:120, nota:'Trekking, ligero' },
    { nombre:'Silbato de supervivencia multiuso', q:'silbato supervivencia', costoMin:0.3, costoMax:1.5, pesoG:30, nota:'Diminuto' },
    { nombre:'Bolsa seca impermeable (dry bag)', q:'bolsa seca impermeable dry bag', costoMin:1.5, costoMax:4, pesoG:150, nota:'Textil' },
    { nombre:'Ganchos mosqueton de aluminio (set)', q:'mosqueton aluminio set camping', costoMin:0.6, costoMax:1.8, pesoG:80, nota:'Multiuso, liviano' },
    { nombre:'Lámpara solar inflable portátil', q:'lampara solar inflable camping', costoMin:2, costoMax:5, pesoG:120, nota:'Novedad eco' },
    { nombre:'Mochila plegable ultraliviana', q:'mochila plegable ultraliviana', costoMin:2, costoMax:5, pesoG:150, nota:'Textil liviano' },
    { nombre:'Pulsera repelente de mosquitos (pack)', q:'pulsera repelente mosquitos', costoMin:0.5, costoMax:2, pesoG:40, nota:'Estacional' },
    { nombre:'Brújula de supervivencia', q:'brujula supervivencia', costoMin:1, costoMax:3, pesoG:80, nota:'Chico' },
  ]},
  oficina: { label: 'Papelería / Oficina', icon: '📎', productos: [
    { nombre:'Resaltadores pastel (set)', q:'resaltadores pastel set', costoMin:0.8, costoMax:2.5, pesoG:120, nota:'Recompra estudiantes' },
    { nombre:'Soporte elevador para monitor plegable', q:'soporte elevador monitor plegable', costoMin:2, costoMax:4.5, pesoG:300, nota:'Home office ergonomico' },
    { nombre:'Notas adhesivas y separadores (set)', q:'notas adhesivas set separadores', costoMin:0.5, costoMax:2, pesoG:100, nota:'Consumible' },
    { nombre:'Lapiceras borrables (pack)', q:'lapicera borrable pack', costoMin:0.8, costoMax:2.5, pesoG:80, nota:'Recompra' },
    { nombre:'Pizarra magnetica de heladera semanal', q:'pizarra magnetica heladera planificador', costoMin:1.5, costoMax:3.5, pesoG:200, nota:'Organizacion, nicho' },
    { nombre:'Soporte adhesivo para auriculares bajo escritorio', q:'soporte auriculares adhesivo escritorio', costoMin:0.8, costoMax:2, pesoG:60, nota:'Setup, liviano' },
    { nombre:'Organizador de cables para mochila', q:'organizador cables mochila electronica', costoMin:1.5, costoMax:4, pesoG:150, nota:'Textil' },
    { nombre:'Sello autoentintable', q:'sello autoentintable', costoMin:1, costoMax:3, pesoG:80, nota:'Chico' },
    { nombre:'Reposamuñecas de gel para teclado/mouse (set)', q:'reposamuñecas gel teclado mouse', costoMin:1.2, costoMax:3, pesoG:200, nota:'Ergonomia home office' },
    { nombre:'Stickers decorativos (packs)', q:'stickers decorativos pack', costoMin:0.3, costoMax:1.5, pesoG:40, nota:'Recompra' },
    { nombre:'Cinta correctora (pack)', q:'cinta correctora pack', costoMin:0.5, costoMax:2, pesoG:60, nota:'Consumible' },
    { nombre:'Atril soporte para libros/tablet', q:'atril soporte libros ajustable', costoMin:2, costoMax:5, pesoG:300, nota:'Estudio' },
  ]},
  domotica: { label: 'Domótica / Casa Inteligente', icon: '🏡', productos: [
    { nombre:'Enchufe inteligente WiFi (smart plug)', q:'enchufe inteligente wifi', costoMin:2.5, costoMax:5, pesoG:60, nota:'Alta demanda smart home' },
    { nombre:'Tira LED RGB WiFi con app', q:'tira led rgb wifi', costoMin:3, costoMax:6, pesoG:120, nota:'Deco + tendencia' },
    { nombre:'Sensor de movimiento PIR inalámbrico', q:'sensor movimiento inalambrico', costoMin:2, costoMax:4, pesoG:50, nota:'Seguridad hogar' },
    { nombre:'Control remoto universal IR WiFi', q:'control universal ir wifi', costoMin:3, costoMax:6, pesoG:70, nota:'Reemplaza varios remotos' },
    { nombre:'Lámpara inteligente WiFi RGB E27', q:'lampara inteligente wifi e27', costoMin:2.5, costoMax:5, pesoG:90, nota:'Recompra por pack' },
    { nombre:'Sensor de apertura puerta/ventana', q:'sensor apertura puerta ventana', costoMin:1.5, costoMax:3.5, pesoG:40, nota:'Kit de seguridad' },
    { nombre:'Timbre WiFi con cámara mini', q:'timbre wifi camara', costoMin:6, costoMax:12, pesoG:150, nota:'Ticket medio-alto' },
    { nombre:'Adaptador smart para portón/garage', q:'control garage wifi', costoMin:5, costoMax:10, pesoG:80, nota:'Nicho poco saturado' },
    { nombre:'Repetidor de señal WiFi compacto', q:'repetidor wifi', costoMin:3, costoMax:6, pesoG:70, nota:'Complemento smart home' },
    { nombre:'Regleta inteligente con USB', q:'regleta inteligente usb wifi', costoMin:4, costoMax:8, pesoG:200, nota:'Escritorio smart' },
    { nombre:'Sensor de temperatura y humedad WiFi', q:'sensor temperatura humedad wifi', costoMin:3, costoMax:6, pesoG:60, nota:'Datos en app' },
    { nombre:'Cerradura inteligente con huella (portátil)', q:'candado huella inteligente', costoMin:5, costoMax:11, pesoG:120, nota:'Novedad' },
  ]},
  jardineria: { label: 'Jardinería / Plantas', icon: '🌱', productos: [
    { nombre:'Pistola rociadora ajustable para manguera', q:'pistola riego manguera', costoMin:1.5, costoMax:4, pesoG:120, nota:'Temporada alta' },
    { nombre:'Set de herramientas de jardín de mano', q:'set herramientas jardin mano', costoMin:2.5, costoMax:6, pesoG:300, nota:'Regalo' },
    { nombre:'Guantes de jardinería con garras', q:'guantes jardineria garras', costoMin:1, costoMax:3, pesoG:80, nota:'Recompra' },
    { nombre:'Medidor 3 en 1 de humedad/pH/luz', q:'medidor humedad ph suelo', costoMin:2, costoMax:5, pesoG:90, nota:'Sin batería, práctico' },
    { nombre:'Aspersor giratorio automático', q:'aspersor giratorio jardin', costoMin:2, costoMax:5, pesoG:150, nota:'Riego fácil' },
    { nombre:'Macetas de tela geotextil (pack)', q:'macetas tela geotextil pack', costoMin:2, costoMax:5, pesoG:120, nota:'Cultivo urbano' },
    { nombre:'Tijera de podar bypass', q:'tijera podar bypass', costoMin:2, costoMax:5, pesoG:150, nota:'Herramienta base' },
    { nombre:'Kit de germinación con bandeja', q:'bandeja germinacion semillas', costoMin:1.5, costoMax:4, pesoG:110, nota:'Huerta en casa' },
    { nombre:'Manguera expandible retráctil', q:'manguera expandible', costoMin:4, costoMax:9, pesoG:300, nota:'Ticket medio' },
    { nombre:'Etiquetas para plantas (pack)', q:'etiquetas plantas jardin', costoMin:1, costoMax:2.5, pesoG:50, nota:'Complemento huerta' },
    { nombre:'Rodillera almohadilla para jardinería', q:'almohadilla rodilla jardin', costoMin:1.5, costoMax:3.5, pesoG:120, nota:'Comodidad' },
    { nombre:'Luz solar de jardín estaca (pack)', q:'luz solar jardin estaca', costoMin:2, costoMax:5, pesoG:150, nota:'Deco exterior' },
  ]},
  joyeria: { label: 'Joyería / Bijouterie', icon: '💍', productos: [
    { nombre:'Set de aros de acero quirúrgico (pack)', q:'aros acero quirurgico pack', costoMin:1, costoMax:3, pesoG:30, nota:'Hipoalergénico, recompra' },
    { nombre:'Collar de acero inoxidable minimalista', q:'collar acero inoxidable minimalista', costoMin:1.5, costoMax:4, pesoG:25, nota:'Tendencia' },
    { nombre:'Organizador de joyas de viaje', q:'organizador joyas viaje', costoMin:2, costoMax:5, pesoG:120, nota:'Complemento' },
    { nombre:'Pulsera ajustable de acero', q:'pulsera acero ajustable', costoMin:1, costoMax:3, pesoG:20, nota:'Unisex' },
    { nombre:'Anillos apilables (set)', q:'anillos apilables set', costoMin:1, costoMax:3, pesoG:20, nota:'Pack rentable' },
    { nombre:'Cadena tobillera de acero', q:'tobillera acero', costoMin:1, costoMax:2.5, pesoG:15, nota:'Verano' },
    { nombre:'Piercings de acero falsos (sin perforar)', q:'piercing falso acero', costoMin:0.8, costoMax:2, pesoG:10, nota:'Sin perforar' },
    { nombre:'Reloj-pulsera fashion económico', q:'reloj pulsera fashion mujer', costoMin:2.5, costoMax:6, pesoG:60, nota:'Ticket medio' },
    { nombre:'Set de aros de perlas sintéticas', q:'aros perla sintetica set', costoMin:1, costoMax:3, pesoG:25, nota:'Elegante' },
    { nombre:'Colgante con inicial personalizable', q:'colgante inicial acero', costoMin:1.5, costoMax:4, pesoG:25, nota:'Regalo' },
    { nombre:'Limpiador de joyas ultrasónico mini', q:'limpiador joyas ultrasonico', costoMin:6, costoMax:12, pesoG:300, nota:'Ticket alto' },
    { nombre:'Exhibidor de joyas para venta', q:'exhibidor joyas display', costoMin:3, costoMax:7, pesoG:200, nota:'Para revendedores' },
  ]},
  relojes: { label: 'Relojes', icon: '⌚', productos: [
    { nombre:'Malla de silicona para smartwatch', q:'malla silicona smartwatch', costoMin:0.8, costoMax:2.5, pesoG:20, nota:'Recompra alta' },
    { nombre:'Reloj digital deportivo resistente', q:'reloj digital deportivo', costoMin:3, costoMax:7, pesoG:60, nota:'Clásico' },
    { nombre:'Correa de acero milanesa para reloj', q:'correa milanesa reloj', costoMin:2, costoMax:5, pesoG:50, nota:'Upgrade estético' },
    { nombre:'Reloj analógico minimalista unisex', q:'reloj analogico minimalista', costoMin:3, costoMax:8, pesoG:70, nota:'Tendencia' },
    { nombre:'Protector de pantalla para smartwatch (pack)', q:'protector smartwatch pack', costoMin:0.8, costoMax:2, pesoG:10, nota:'Complemento' },
    { nombre:'Estuche organizador para relojes', q:'estuche relojes organizador', costoMin:3, costoMax:7, pesoG:250, nota:'Ticket medio' },
    { nombre:'Reloj para niños con diseño', q:'reloj niños', costoMin:2, costoMax:5, pesoG:60, nota:'Regalo' },
    { nombre:'Smartwatch económico básico', q:'smartwatch economico', costoMin:6, costoMax:13, pesoG:80, nota:'Ticket alto' },
    { nombre:'Cargador magnético para smartwatch', q:'cargador smartwatch magnetico', costoMin:1.5, costoMax:4, pesoG:30, nota:'Recompra' },
    { nombre:'Reloj despertador digital LED', q:'reloj despertador led', costoMin:2, costoMax:6, pesoG:150, nota:'Deco escritorio' },
    { nombre:'Correa deportiva transpirable', q:'correa reloj deportiva transpirable', costoMin:1, costoMax:3, pesoG:25, nota:'Fitness' },
    { nombre:'Soporte de carga para reloj', q:'soporte carga reloj', costoMin:1.5, costoMax:4, pesoG:40, nota:'Complemento' },
  ]},
  iluminacion: { label: 'Iluminación / LED', icon: '💡', productos: [
    { nombre:'Lámpara LED de escritorio recargable', q:'lampara led escritorio recargable', costoMin:3, costoMax:7, pesoG:200, nota:'Home office' },
    { nombre:'Tira LED USB para TV/monitor', q:'tira led usb tv', costoMin:1.5, costoMax:4, pesoG:60, nota:'Ambiente' },
    { nombre:'Luz nocturna con sensor de movimiento', q:'luz nocturna sensor movimiento', costoMin:1.5, costoMax:4, pesoG:70, nota:'Pasillo/placar' },
    { nombre:'Proyector de luz galaxia/estrellas', q:'proyector galaxia estrellas', costoMin:4, costoMax:9, pesoG:250, nota:'Tendencia deco' },
    { nombre:'Panel LED hexagonal modular (set)', q:'panel led hexagonal', costoMin:6, costoMax:13, pesoG:300, nota:'Gamer/deco' },
    { nombre:'Aplique LED con panel solar exterior', q:'aplique led solar exterior', costoMin:3, costoMax:7, pesoG:200, nota:'Sin cableado' },
    { nombre:'Aro de luz de pie para selfies', q:'aro luz pie selfie', costoMin:6, costoMax:14, pesoG:400, nota:'Contenido/streaming' },
    { nombre:'Lámpara LED de ambiente', q:'lampara led ambiente', costoMin:3, costoMax:7, pesoG:250, nota:'Deco' },
    { nombre:'Cinta LED direccionable RGBIC', q:'tira led rgbic', costoMin:4, costoMax:9, pesoG:150, nota:'Efectos' },
    { nombre:'Foco LED inteligente de color', q:'foco led color', costoMin:2, costoMax:5, pesoG:90, nota:'Recompra' },
    { nombre:'Vela LED sin llama (pack)', q:'vela led sin llama pack', costoMin:1.5, costoMax:4, pesoG:120, nota:'Deco eventos' },
    { nombre:'Lámpara de lectura con clip', q:'lampara lectura clip', costoMin:1.5, costoMax:4, pesoG:80, nota:'Práctica' },
  ]},
  gaming: { label: 'Gaming / Consolas', icon: '🎮', productos: [
    { nombre:'Grips de silicona para joystick (pack)', q:'grips joystick silicona', costoMin:0.8, costoMax:2.5, pesoG:15, nota:'Recompra alta' },
    { nombre:'Soporte para auriculares gamer', q:'soporte auriculares gamer', costoMin:3, costoMax:7, pesoG:250, nota:'Setup' },
    { nombre:'Mouse pad gamer XL con RGB', q:'mousepad gamer rgb xl', costoMin:4, costoMax:9, pesoG:400, nota:'Ticket medio' },
    { nombre:'Gatillos/triggers para celular gamer', q:'gatillos celular gamer', costoMin:1, costoMax:3, pesoG:30, nota:'Mobile gaming' },
    { nombre:'Cooler ventilador para celular gamer', q:'cooler celular gamer', costoMin:3, costoMax:7, pesoG:120, nota:'Anti recalentamiento' },
    { nombre:'Skins/cubre-analógicos para joystick', q:'skin joystick control', costoMin:1, costoMax:3, pesoG:20, nota:'Personalización' },
    { nombre:'Base de carga para joysticks', q:'base carga joystick', costoMin:4, costoMax:9, pesoG:200, nota:'Complemento consola' },
    { nombre:'Auriculares gamer con micrófono', q:'auriculares gamer microfono', costoMin:5, costoMax:12, pesoG:300, nota:'Ticket alto' },
    { nombre:'Luz LED ambiental para setup', q:'luz led setup gamer', costoMin:2, costoMax:5, pesoG:90, nota:'Ambiente' },
    { nombre:'Organizador de juegos y controles', q:'organizador juegos consola', costoMin:3, costoMax:7, pesoG:250, nota:'Orden setup' },
    { nombre:'Adaptador de teclado y mouse para consola', q:'adaptador teclado mouse consola', costoMin:6, costoMax:14, pesoG:150, nota:'Nicho específico' },
    { nombre:'Dedales para mobile gaming (pack)', q:'dedales mobile gaming pack', costoMin:0.8, costoMax:2, pesoG:10, nota:'Recompra' },
  ]},
  ferreteria: { label: 'Ferretería / Construcción', icon: '🔩', productos: [
    { nombre:'Cinta métrica retráctil 5m', q:'cinta metrica 5m', costoMin:1.5, costoMax:4, pesoG:120, nota:'Uso universal' },
    { nombre:'Set de brocas para taladro', q:'set brocas taladro', costoMin:2.5, costoMax:6, pesoG:200, nota:'Recompra' },
    { nombre:'Nivel láser autonivelante mini', q:'nivel laser autonivelante', costoMin:6, costoMax:13, pesoG:250, nota:'Ticket alto' },
    { nombre:'Organizador de tornillos y herrajes', q:'organizador tornillos cajas', costoMin:3, costoMax:7, pesoG:300, nota:'Taller' },
    { nombre:'Juego de llaves Allen (set)', q:'juego llaves allen set', costoMin:1.5, costoMax:4, pesoG:150, nota:'Base' },
    { nombre:'Guantes de trabajo anticorte', q:'guantes trabajo anticorte', costoMin:1.5, costoMax:3.5, pesoG:90, nota:'Seguridad' },
    { nombre:'Cinta aisladora (pack)', q:'cinta aisladora pack', costoMin:1, costoMax:3, pesoG:150, nota:'Recompra alta' },
    { nombre:'Kit de destornilladores de precisión', q:'kit destornillador precision', costoMin:2.5, costoMax:6, pesoG:200, nota:'Electrónica' },
    { nombre:'Abrazaderas metálicas (set)', q:'abrazaderas metalicas set', costoMin:1, costoMax:3, pesoG:120, nota:'Complemento' },
    { nombre:'Cinta de teflón para plomería (pack)', q:'cinta teflon plomeria pack', costoMin:0.8, costoMax:2, pesoG:50, nota:'Recompra' },
    { nombre:'Pistola de silicona caliente', q:'pistola silicona caliente', costoMin:2.5, costoMax:6, pesoG:250, nota:'DIY' },
    { nombre:'Linterna de trabajo LED recargable', q:'linterna trabajo led recargable', costoMin:3, costoMax:7, pesoG:150, nota:'Ticket medio' },
  ]},
  musica: { label: 'Música / Instrumentos', icon: '🎸', productos: [
    { nombre:'Púas de guitarra (set variado)', q:'puas guitarra set', costoMin:0.5, costoMax:2, pesoG:10, nota:'Recompra alta' },
    { nombre:'Afinador digital con clip', q:'afinador clip guitarra', costoMin:1.5, costoMax:4, pesoG:30, nota:'Base músico' },
    { nombre:'Cejilla/capo para guitarra', q:'capo guitarra', costoMin:1, costoMax:3, pesoG:40, nota:'Complemento' },
    { nombre:'Soporte plegable para guitarra', q:'soporte guitarra plegable', costoMin:3, costoMax:7, pesoG:300, nota:'Ticket medio' },
    { nombre:'Cable plug 6.35mm para instrumento', q:'cable plug instrumento', costoMin:2, costoMax:5, pesoG:150, nota:'Recompra' },
    { nombre:'Metrónomo digital', q:'metronomo digital', costoMin:2, costoMax:5, pesoG:60, nota:'Estudio' },
    { nombre:'Micrófono condensador USB para PC', q:'microfono usb condensador', costoMin:6, costoMax:14, pesoG:250, nota:'Streaming/podcast' },
    { nombre:'Cuerdas de guitarra (set)', q:'cuerdas guitarra set', costoMin:1.5, costoMax:4, pesoG:60, nota:'Recompra alta' },
    { nombre:'Baquetas de batería (par)', q:'baquetas bateria par', costoMin:1.5, costoMax:4, pesoG:120, nota:'Recompra' },
    { nombre:'Soporte para micrófono de escritorio', q:'soporte microfono escritorio', costoMin:4, costoMax:9, pesoG:300, nota:'Setup' },
    { nombre:'Kalimba 17 teclas', q:'kalimba 17 teclas', costoMin:5, costoMax:11, pesoG:300, nota:'Novedad regalo' },
    { nombre:'Filtro antipop para micrófono', q:'filtro antipop microfono', costoMin:2, costoMax:5, pesoG:90, nota:'Complemento' },
  ]},
  arte: { label: 'Arte / Manualidades', icon: '🎨', productos: [
    { nombre:'Set de marcadores/rotuladores (pack)', q:'set marcadores dibujo pack', costoMin:3, costoMax:7, pesoG:300, nota:'Recompra' },
    { nombre:'Tabla de dibujo con clip A4', q:'tabla dibujo clip', costoMin:2, costoMax:5, pesoG:250, nota:'Base' },
    { nombre:'Set de pinceles para pintura', q:'set pinceles pintura', costoMin:2, costoMax:5, pesoG:120, nota:'Recompra' },
    { nombre:'Kit de caligrafía y lettering', q:'kit caligrafia lettering', costoMin:3, costoMax:7, pesoG:200, nota:'Tendencia' },
    { nombre:'Cuaderno de bocetos (sketchbook)', q:'sketchbook cuaderno dibujo', costoMin:2, costoMax:5, pesoG:250, nota:'Recompra' },
    { nombre:'Set de acuarelas portátil', q:'set acuarelas portatil', costoMin:3, costoMax:7, pesoG:200, nota:'Regalo' },
    { nombre:'Herramientas de modelado de arcilla (set)', q:'herramientas modelado arcilla set', costoMin:2, costoMax:5, pesoG:120, nota:'Manualidades' },
    { nombre:'Pistola de silicona para manualidades', q:'pistola silicona manualidades', costoMin:2.5, costoMax:6, pesoG:250, nota:'DIY' },
    { nombre:'Kit de resina epoxi con moldes', q:'kit resina epoxi moldes', costoMin:6, costoMax:13, pesoG:400, nota:'Ticket alto tendencia' },
    { nombre:'Lápices de colores profesionales (set)', q:'lapices colores profesional set', costoMin:3, costoMax:8, pesoG:300, nota:'Regalo' },
    { nombre:'Tabla de luz LED para calcar A4', q:'tabla luz calcar led', costoMin:6, costoMax:13, pesoG:400, nota:'Ticket alto' },
    { nombre:'Set de sellos para manualidades', q:'set sellos manualidades', costoMin:2, costoMax:5, pesoG:150, nota:'Scrapbooking' },
  ]},
  energiasolar: { label: 'Energía Solar / Portátil', icon: '☀️', productos: [
    { nombre:'Cargador solar USB portátil', q:'cargador solar usb portatil', costoMin:5, costoMax:11, pesoG:300, nota:'Camping/emergencia' },
    { nombre:'Luz solar de exterior con sensor', q:'luz solar exterior sensor', costoMin:3, costoMax:7, pesoG:250, nota:'Recompra por pack' },
    { nombre:'Panel solar plegable 20W', q:'panel solar plegable 20w', costoMin:12, costoMax:25, pesoG:600, nota:'Ticket alto' },
    { nombre:'Powerbank solar', q:'powerbank solar', costoMin:6, costoMax:14, pesoG:350, nota:'Outdoor' },
    { nombre:'Ventilador con panel solar', q:'ventilador solar', costoMin:5, costoMax:11, pesoG:300, nota:'Nicho verano' },
    { nombre:'Reflector LED solar exterior', q:'reflector led solar', costoMin:4, costoMax:9, pesoG:300, nota:'Seguridad' },
    { nombre:'Farol/lámpara solar recargable', q:'farol solar recargable', costoMin:4, costoMax:9, pesoG:300, nota:'Camping' },
    { nombre:'Guirnalda de luces solares', q:'guirnalda luces solares', costoMin:3, costoMax:7, pesoG:200, nota:'Deco exterior' },
    { nombre:'Regulador de carga solar PWM', q:'regulador carga solar', costoMin:5, costoMax:11, pesoG:150, nota:'Instaladores' },
    { nombre:'Bomba de agua solar para fuente', q:'bomba agua solar fuente', costoMin:4, costoMax:9, pesoG:250, nota:'Jardín' },
    { nombre:'Cargador solar mantenedor para auto', q:'cargador solar auto', costoMin:5, costoMax:11, pesoG:300, nota:'Automotor' },
    { nombre:'Kit de luz solar para interior', q:'kit luz solar interior', costoMin:6, costoMax:13, pesoG:400, nota:'Sin instalación' },
  ]},
  fotografia: { label: 'Fotografía / Drones', icon: '📷', productos: [
    { nombre:'Trípode flexible tipo pulpo para celular', q:'tripode flexible pulpo celular', costoMin:2, costoMax:5, pesoG:150, nota:'Recompra alta' },
    { nombre:'Estabilizador gimbal para celular', q:'gimbal celular', costoMin:15, costoMax:30, pesoG:400, nota:'Ticket alto' },
    { nombre:'Aro de luz con trípode', q:'aro luz tripode', costoMin:6, costoMax:14, pesoG:500, nota:'Contenido' },
    { nombre:'Lentes clip para celular (kit)', q:'lentes clip celular kit', costoMin:2.5, costoMax:6, pesoG:80, nota:'Complemento' },
    { nombre:'Micrófono lavalier para celular', q:'microfono lavalier celular', costoMin:3, costoMax:7, pesoG:60, nota:'Video/vlog' },
    { nombre:'Fondo croma verde plegable', q:'fondo croma verde', costoMin:6, costoMax:13, pesoG:400, nota:'Streaming' },
    { nombre:'Control bluetooth disparador para celular', q:'control bluetooth disparador celular', costoMin:1, costoMax:3, pesoG:20, nota:'Recompra' },
    { nombre:'Soporte de teléfono para trípode', q:'soporte celular tripode', costoMin:1.5, costoMax:4, pesoG:60, nota:'Complemento' },
    { nombre:'Softbox difusor de luz portátil', q:'softbox portatil', costoMin:6, costoMax:13, pesoG:400, nota:'Producto/foto' },
    { nombre:'Estuche organizador de tarjetas de memoria', q:'estuche tarjetas memoria', costoMin:1, costoMax:3, pesoG:40, nota:'Complemento' },
    { nombre:'Selfie stick con trípode y control', q:'selfie stick tripode', costoMin:3, costoMax:7, pesoG:200, nota:'Recompra' },
    { nombre:'Kit de limpieza de lentes', q:'kit limpieza lentes camara', costoMin:1.5, costoMax:4, pesoG:80, nota:'Recompra' },
  ]},
  viajes: { label: 'Viajes / Valijas', icon: '🧳', productos: [
    { nombre:'Organizadores de valija (packing cubes)', q:'packing cubes organizadores valija', costoMin:3, costoMax:7, pesoG:250, nota:'Recompra alta' },
    { nombre:'Almohada de viaje cervical', q:'almohada viaje cervical', costoMin:2, costoMax:5, pesoG:150, nota:'Recompra' },
    { nombre:'Adaptador universal de enchufe', q:'adaptador universal viaje', costoMin:3, costoMax:7, pesoG:120, nota:'Internacional' },
    { nombre:'Candado TSA para valija', q:'candado tsa valija', costoMin:1.5, costoMax:4, pesoG:60, nota:'Seguridad' },
    { nombre:'Botella plegable de silicona', q:'botella plegable silicona', costoMin:2, costoMax:5, pesoG:120, nota:'Eco' },
    { nombre:'Balanza digital para equipaje', q:'balanza digital equipaje', costoMin:2, costoMax:5, pesoG:90, nota:'Evita exceso' },
    { nombre:'Neceser organizador de higiene colgante', q:'neceser colgante viaje', costoMin:3, costoMax:7, pesoG:200, nota:'Regalo' },
    { nombre:'Funda protectora para valija', q:'funda valija', costoMin:3, costoMax:7, pesoG:250, nota:'Complemento' },
    { nombre:'Riñonera antirrobo de viaje', q:'riñonera antirrobo viaje', costoMin:3, costoMax:7, pesoG:150, nota:'Seguridad' },
    { nombre:'Etiquetas de equipaje (pack)', q:'etiquetas equipaje pack', costoMin:1, costoMax:3, pesoG:50, nota:'Recompra' },
    { nombre:'Powerbank/cargador portátil de viaje', q:'powerbank viaje', costoMin:6, costoMax:13, pesoG:300, nota:'Ticket alto' },
    { nombre:'Set de botellas de viaje para líquidos', q:'botellas viaje liquidos set', costoMin:1.5, costoMax:4, pesoG:90, nota:'Avión' },
  ]},
  libreria: { label: 'Librería / Libros', icon: '📚', productos: [
    { nombre:'Set de resaltadores pastel de doble punta', q:'resaltadores pastel doble punta set', costoMin:0.8, costoMax:2.2, pesoG:90, nota:'Recompra escolar' },
    { nombre:'Estuche organizador de lapices tipo rollo', q:'cartuchera rollo organizadora lapices', costoMin:1.2, costoMax:3.2, pesoG:120, nota:'Liviano, alto margen' },
    { nombre:'Set de plantillas de lettering y stencils', q:'plantillas lettering stencil set', costoMin:0.6, costoMax:1.8, pesoG:60, nota:'Muy liviano' },
    { nombre:'Separadores magneticos de pagina', q:'separadores magneticos libros', costoMin:0.5, costoMax:1.5, pesoG:30, nota:'Micro ticket, se vende en packs' },
    { nombre:'Sello personalizable autoentintable', q:'sello autoentintable personalizado', costoMin:1.5, costoMax:4, pesoG:70, nota:'Diferenciacion' },
    { nombre:'Cortadora de papel manual A4', q:'guillotina papel a4 manual', costoMin:5, costoMax:11, pesoG:900, nota:'Ticket alto, pesa' },
    { nombre:'Set de marcadores acrilicos para superficies', q:'marcadores acrilicos permanentes set', costoMin:2, costoMax:5, pesoG:180, nota:'Tendencia manualidades' },
    { nombre:'Agenda tipo bullet journal con elastico', q:'cuaderno bullet journal puntos', costoMin:1.5, costoMax:4, pesoG:280, nota:'Estacional enero-marzo' },
    { nombre:'Perforadora de figuras decorativas', q:'perforadora figuras scrapbook', costoMin:1, costoMax:3, pesoG:150, nota:'Nicho scrapbook' },
    { nombre:'Set de clips binder de colores', q:'clips binder colores set', costoMin:0.4, costoMax:1.2, pesoG:110, nota:'Recompra oficina' },
    { nombre:'Portanotas adhesivo para monitor', q:'soporte notas monitor acrilico', costoMin:0.8, costoMax:2.2, pesoG:70, nota:'Home office' },
    { nombre:'Set de sellos de goma para planificador', q:'sellos goma planner set', costoMin:1, costoMax:2.8, pesoG:90, nota:'Nicho planners' },
  ]},
  juguetes: { label: 'Juguetes / Juegos', icon: '🧸', productos: [
    { nombre:'Cubo magico de velocidad 3x3', q:'cubo magico 3x3 speed', costoMin:1, costoMax:3, pesoG:100, nota:'Demanda constante' },
    { nombre:'Set de bloques magneticos de construccion', q:'bloques magneticos construccion set', costoMin:5, costoMax:14, pesoG:600, nota:'Ticket alto, pesa' },
    { nombre:'Juguete antiestres tipo pop it', q:'pop it antiestres', costoMin:0.5, costoMax:1.8, pesoG:80, nota:'Modas, riesgo de saturacion' },
    { nombre:'Kit de slime para armar', q:'kit slime para hacer', costoMin:1.5, costoMax:4, pesoG:250, nota:'Contenido para redes' },
    { nombre:'Pista de autos flexible luminosa', q:'pista autos flexible luminosa', costoMin:4, costoMax:10, pesoG:500, nota:'Regalo, estacional' },
    { nombre:'Juego de cartas familiar tipo UNO', q:'juego cartas familiar mesa', costoMin:0.8, costoMax:2.5, pesoG:130, nota:'Liviano, recompra regalo' },
    { nombre:'Set de figuras de dinosaurios', q:'set figuras dinosaurios juguete', costoMin:2, costoMax:6, pesoG:400, nota:'Evergreen infantil' },
    { nombre:'Lanzador de burbujas automatico', q:'maquina burbujas automatica juguete', costoMin:3, costoMax:8, pesoG:300, nota:'Estacional verano' },
    { nombre:'Puzzle 3D de madera para armar', q:'puzzle 3d madera armar', costoMin:2, costoMax:6, pesoG:250, nota:'Regalo adulto y nino' },
    { nombre:'Set de masas moldeables con moldes', q:'masa moldear set moldes ninos', costoMin:2, costoMax:5, pesoG:450, nota:'Recompra' },
    { nombre:'Auto a friccion con luces', q:'auto friccion luces juguete', costoMin:1.5, costoMax:4, pesoG:200, nota:'Ticket bajo' },
    { nombre:'Kit de ciencia experimentos para chicos', q:'kit experimentos ciencia ninos', costoMin:4, costoMax:10, pesoG:500, nota:'Educativo, buen margen' },
  ]},
  audio: { label: 'Audio / Parlantes', icon: '🔊', productos: [
    { nombre:'Parlante bluetooth portatil mini', q:'parlante bluetooth portatil mini', costoMin:4, costoMax:11, pesoG:250, nota:'Muy saturado, validar' },
    { nombre:'Auriculares in-ear con cable tipo C', q:'auriculares in ear usb c', costoMin:1.5, costoMax:4, pesoG:40, nota:'Liviano, recompra' },
    { nombre:'Soporte de auriculares para escritorio', q:'soporte auriculares escritorio', costoMin:2, costoMax:5, pesoG:200, nota:'Complemento gamer' },
    { nombre:'Adaptador bluetooth para equipo de audio', q:'receptor bluetooth audio 3.5mm', costoMin:2, costoMax:5, pesoG:50, nota:'Nicho equipos viejos' },
    { nombre:'Microfono lavalier para celular', q:'microfono corbatero celular', costoMin:1.5, costoMax:4, pesoG:60, nota:'Creadores de contenido' },
    { nombre:'Espuma antipop para microfono', q:'antipop filtro microfono', costoMin:1, costoMax:3, pesoG:80, nota:'Accesorio, poco saturado' },
    { nombre:'Cable auxiliar reforzado 3.5mm', q:'cable auxiliar 3.5mm reforzado', costoMin:0.6, costoMax:1.8, pesoG:60, nota:'Micro ticket' },
    { nombre:'Almohadillas de repuesto para auriculares', q:'almohadillas repuesto auriculares', costoMin:1, costoMax:3, pesoG:50, nota:'Recompra pura' },
    { nombre:'Amplificador de auriculares portatil', q:'amplificador auriculares portatil', costoMin:6, costoMax:15, pesoG:150, nota:'Nicho audiofilo' },
    { nombre:'Splitter de audio para dos auriculares', q:'splitter audio dos auriculares', costoMin:0.6, costoMax:1.8, pesoG:25, nota:'Diminuto' },
    { nombre:'Estuche rigido para auriculares inalambricos', q:'estuche rigido auriculares', costoMin:1, costoMax:3, pesoG:90, nota:'Accesorio de accesorio' },
    { nombre:'Aislante acustico adhesivo en paneles', q:'paneles acusticos espuma adhesivos', costoMin:4, costoMax:10, pesoG:700, nota:'Streamers, pesa volumen' },
  ]},
  celulares: { label: 'Celulares / Accesorios', icon: '📱', productos: [
    { nombre:'Cargador rapido GaN de 30W', q:'cargador gan 30w usb c', costoMin:5, costoMax:12, pesoG:90, nota:'Ticket medio, buen margen' },
    { nombre:'Cable USB-C trenzado 100W', q:'cable usb c 100w trenzado', costoMin:1.2, costoMax:3.5, pesoG:70, nota:'Recompra alta' },
    { nombre:'Soporte de celular para auto magnetico', q:'soporte celular auto magnetico', costoMin:1.5, costoMax:4, pesoG:120, nota:'Evergreen' },
    { nombre:'Aro de luz clip para celular', q:'aro luz clip celular selfie', costoMin:1.5, costoMax:4, pesoG:90, nota:'Contenido, liviano' },
    { nombre:'Popsocket / anillo soporte adhesivo', q:'popsocket anillo soporte celular', costoMin:0.4, costoMax:1.2, pesoG:25, nota:'Micro ticket, packs' },
    { nombre:'Vidrio templado con marco de instalacion', q:'vidrio templado kit instalacion', costoMin:0.8, costoMax:2.5, pesoG:60, nota:'Alta recompra' },
    { nombre:'Estabilizador gimbal manual para celular', q:'gimbal estabilizador celular', costoMin:14, costoMax:30, pesoG:450, nota:'Ticket alto, mas riesgo' },
    { nombre:'Powerbank magnetico inalambrico', q:'powerbank magnetico inalambrico', costoMin:7, costoMax:16, pesoG:200, nota:'Bateria: revisar courier' },
    { nombre:'Lente macro clip para celular', q:'lente macro clip celular', costoMin:1.5, costoMax:4, pesoG:60, nota:'Nicho fotografia' },
    { nombre:'Soporte plegable de escritorio para celular', q:'soporte plegable escritorio celular aluminio', costoMin:1.5, costoMax:4, pesoG:130, nota:'Home office' },
    { nombre:'Funda impermeable para celular', q:'funda impermeable celular sumergible', costoMin:0.8, costoMax:2.2, pesoG:60, nota:'Estacional verano' },
    { nombre:'Kit de limpieza de puerto de carga', q:'kit limpieza puerto carga celular', costoMin:0.6, costoMax:2, pesoG:50, nota:'Poco saturado' },
  ]},
  informatica: { label: 'Informática / PC', icon: '🖥️', productos: [
    { nombre:'Hub USB-C 6 en 1 con HDMI', q:'hub usb c hdmi 6 en 1', costoMin:6, costoMax:14, pesoG:120, nota:'Ticket medio' },
    { nombre:'Soporte elevador de notebook de aluminio', q:'soporte notebook aluminio elevador', costoMin:4, costoMax:10, pesoG:450, nota:'Ergonomia, pesa' },
    { nombre:'Mouse pad extendido para escritorio', q:'mouse pad extendido escritorio xl', costoMin:2, costoMax:5, pesoG:400, nota:'Volumen, no peso' },
    { nombre:'Cooler base para notebook', q:'base cooler notebook', costoMin:5, costoMax:12, pesoG:600, nota:'Pesa, ticket medio' },
    { nombre:'Adaptador WiFi USB de banda dual', q:'adaptador wifi usb doble banda', costoMin:3, costoMax:8, pesoG:40, nota:'Liviano, buen margen' },
    { nombre:'Organizador de cables tipo canaleta adhesiva', q:'canaleta organizadora cables escritorio', costoMin:1.2, costoMax:3.5, pesoG:150, nota:'Complemento setup' },
    { nombre:'Keycaps de repuesto para teclado mecanico', q:'keycaps teclado mecanico set', costoMin:4, costoMax:12, pesoG:250, nota:'Nicho entusiasta' },
    { nombre:'Cepillo y kit de limpieza de teclado', q:'kit limpieza teclado pc', costoMin:1, costoMax:3, pesoG:100, nota:'Poco saturado' },
    { nombre:'Cable HDMI 2.1 de alta velocidad', q:'cable hdmi 2.1 8k', costoMin:2, costoMax:6, pesoG:180, nota:'Recompra' },
    { nombre:'Case externo para disco M.2 NVMe', q:'carry disk m2 nvme usb c', costoMin:5, costoMax:12, pesoG:90, nota:'Liviano, ticket medio' },
    { nombre:'Filtro de privacidad para monitor', q:'filtro privacidad monitor', costoMin:4, costoMax:11, pesoG:350, nota:'Nicho oficina' },
    { nombre:'Webcam cover deslizante adhesivo', q:'tapa webcam deslizante', costoMin:0.3, costoMax:1, pesoG:10, nota:'Micro ticket, solo packs' },
  ]},
  electrodomesticos: { label: 'Electrodomésticos', icon: '🔌', productos: [
    { nombre:'Mini pava electrica de viaje', q:'pava electrica viaje portatil', costoMin:6, costoMax:14, pesoG:600, nota:'Pesa, ticket alto' },
    { nombre:'Batidor de leche electrico manual', q:'espumador leche electrico', costoMin:1, costoMax:3, pesoG:90, nota:'Liviano, buen margen' },
    { nombre:'Mini picadora de alimentos manual', q:'picadora manual alimentos', costoMin:2, costoMax:6, pesoG:350, nota:'Cocina practica' },
    { nombre:'Balanza digital de cocina', q:'balanza digital cocina', costoMin:3, costoMax:8, pesoG:400, nota:'Evergreen' },
    { nombre:'Sellador de bolsas al vacio', q:'selladora bolsas vacio hogar', costoMin:8, costoMax:18, pesoG:800, nota:'Ticket alto, pesa' },
    { nombre:'Mini plancha de viaje plegable', q:'plancha viaje plegable portatil', costoMin:5, costoMax:12, pesoG:600, nota:'Nicho viajes' },
    { nombre:'Removedor de pelusas electrico', q:'quita pelusas electrico ropa', costoMin:2, costoMax:5, pesoG:200, nota:'Alta demanda, barato' },
    { nombre:'Timer digital de enchufe', q:'timer enchufe digital programable', costoMin:2, costoMax:6, pesoG:150, nota:'Ahorro energia' },
    { nombre:'Zapatilla con puertos USB y protector', q:'zapatilla usb protector picos', costoMin:4, costoMax:10, pesoG:400, nota:'Certificacion electrica: verificar' },
    { nombre:'Aspiradora de mano inalambrica mini', q:'aspiradora mano inalambrica mini', costoMin:8, costoMax:18, pesoG:700, nota:'Ticket alto' },
    { nombre:'Repuesto de filtro para purificador', q:'filtro repuesto purificador aire', costoMin:2, costoMax:6, pesoG:200, nota:'Recompra pura' },
    { nombre:'Calentador de tazas USB para escritorio', q:'calentador taza usb escritorio', costoMin:3, costoMax:8, pesoG:300, nota:'Estacional invierno' },
  ]},
  climatizacion: { label: 'Climatización / Ventilación', icon: '🌬️', productos: [
    { nombre:'Ventilador de cuello portatil recargable', q:'ventilador cuello portatil recargable', costoMin:3, costoMax:8, pesoG:250, nota:'Estacional verano fuerte' },
    { nombre:'Ventilador USB de escritorio silencioso', q:'ventilador usb escritorio', costoMin:2, costoMax:6, pesoG:250, nota:'Verano, ticket bajo' },
    { nombre:'Termometro higrometro digital de ambiente', q:'termometro higrometro digital ambiente', costoMin:1.5, costoMax:4, pesoG:80, nota:'Liviano, todo el ano' },
    { nombre:'Deshumidificador de ambiente recargable', q:'deshumidificador recargable placard', costoMin:6, costoMax:14, pesoG:500, nota:'Estacional invierno' },
    { nombre:'Filtro lavable universal para split', q:'filtro lavable aire acondicionado split', costoMin:2, costoMax:6, pesoG:200, nota:'Recompra estacional' },
    { nombre:'Kit de limpieza de aire acondicionado', q:'kit limpieza aire acondicionado split', costoMin:3, costoMax:9, pesoG:400, nota:'Nicho service' },
    { nombre:'Cortina de aire tipo burlete para puerta', q:'burlete puerta aislante termico', costoMin:1.2, costoMax:3.5, pesoG:200, nota:'Ahorro energia' },
    { nombre:'Extractor de aire de bano silencioso', q:'extractor aire bano silencioso', costoMin:6, costoMax:14, pesoG:600, nota:'Pesa, ticket medio' },
    { nombre:'Ventilador de techo portatil para carpa', q:'ventilador carpa camping colgante', costoMin:4, costoMax:10, pesoG:350, nota:'Cruza con camping' },
    { nombre:'Difusor humidificador ultrasonico', q:'humidificador ultrasonico difusor', costoMin:5, costoMax:12, pesoG:450, nota:'Muy saturado, validar' },
    { nombre:'Panel calefactor bajo escritorio', q:'calefactor panel escritorio bajo consumo', costoMin:8, costoMax:18, pesoG:800, nota:'Invierno, ticket alto' },
    { nombre:'Rejilla direccionadora de aire para split', q:'deflector aire acondicionado split', costoMin:1.5, costoMax:4, pesoG:250, nota:'Poco saturado' },
  ]},
  pesca: { label: 'Pesca / Náutica', icon: '🎣', productos: [
    { nombre:'Set de senuelos artificiales surtidos', q:'senuelos pesca set artificiales', costoMin:2, costoMax:6, pesoG:200, nota:'Recompra, se pierden' },
    { nombre:'Caja organizadora de aparejos', q:'caja organizadora aparejos pesca', costoMin:2.5, costoMax:7, pesoG:400, nota:'Volumen, no peso' },
    { nombre:'Pinza de pesca con corta linea', q:'pinza pesca corta linea', costoMin:1.5, costoMax:4, pesoG:120, nota:'Accesorio, buen margen' },
    { nombre:'Linterna frontal para pesca nocturna', q:'linterna frontal led recargable', costoMin:2, costoMax:6, pesoG:150, nota:'Cruza con camping' },
    { nombre:'Portacana de aluminio para bote', q:'portacana aluminio soporte bote', costoMin:4, costoMax:11, pesoG:400, nota:'Nautica, nicho' },
    { nombre:'Balanza digital con cinta para peces', q:'balanza digital pesca gancho', costoMin:2, costoMax:6, pesoG:180, nota:'Nicho especifico' },
    { nombre:'Guante de pesca antideslizante', q:'guante pesca antideslizante', costoMin:1.5, costoMax:4, pesoG:100, nota:'Recompra' },
    { nombre:'Copo / red de mano plegable', q:'copo pesca plegable red mano', costoMin:4, costoMax:10, pesoG:450, nota:'Volumen alto' },
    { nombre:'Alarma sonora de picada para cana', q:'alarma picada pesca electronica', costoMin:2, costoMax:6, pesoG:80, nota:'Poco saturado' },
    { nombre:'Bolso porta senuelos impermeable', q:'bolso pesca impermeable senuelos', costoMin:5, costoMax:12, pesoG:500, nota:'Ticket medio' },
    { nombre:'Set de plomadas y anzuelos surtidos', q:'set anzuelos plomadas pesca', costoMin:1.5, costoMax:4, pesoG:250, nota:'Recompra pura' },
    { nombre:'Chaleco salvavidas inflable manual', q:'chaleco salvavidas inflable', costoMin:10, costoMax:22, pesoG:600, nota:'Certificacion: verificar' },
  ]},
  bicicletas: { label: 'Bicicletas / Ciclismo', icon: '🚲', productos: [
    { nombre:'Luz trasera LED recargable USB', q:'luz trasera bicicleta led recargable', costoMin:1.5, costoMax:4, pesoG:60, nota:'Recompra, liviano' },
    { nombre:'Soporte de celular para manubrio', q:'soporte celular bicicleta manubrio', costoMin:1.5, costoMax:4, pesoG:100, nota:'Evergreen' },
    { nombre:'Inflador de mano compacto con manometro', q:'inflador bicicleta mano manometro', costoMin:3, costoMax:8, pesoG:200, nota:'Utilidad real' },
    { nombre:'Kit de parche y desarmadores de cubierta', q:'kit parche bicicleta cubierta', costoMin:1, costoMax:3, pesoG:120, nota:'Recompra' },
    { nombre:'Bolso de cuadro impermeable', q:'bolso cuadro bicicleta impermeable', costoMin:3, costoMax:8, pesoG:250, nota:'Buen margen' },
    { nombre:'Multiherramienta plegable para bici', q:'multiherramienta bicicleta plegable', costoMin:2.5, costoMax:7, pesoG:180, nota:'Compacto' },
    { nombre:'Guantes de ciclismo con gel', q:'guantes ciclismo gel', costoMin:2.5, costoMax:7, pesoG:120, nota:'Talles: cuidado stock' },
    { nombre:'Ciclocomputadora inalambrica', q:'ciclocomputadora inalambrica bicicleta', costoMin:4, costoMax:10, pesoG:100, nota:'Ticket medio' },
    { nombre:'Pedales de aluminio con pins', q:'pedales aluminio bicicleta mtb', costoMin:5, costoMax:12, pesoG:400, nota:'Pesa, ticket medio' },
    { nombre:'Candado plegable antirrobo', q:'candado bicicleta plegable antirrobo', costoMin:6, costoMax:15, pesoG:900, nota:'Pesa mucho' },
    { nombre:'Guardabarros rapido desmontable', q:'guardabarro bicicleta desmontable mtb', costoMin:2, costoMax:6, pesoG:200, nota:'Estacional lluvia' },
    { nombre:'Cinta de manubrio para ruta', q:'cinta manubrio bicicleta ruta', costoMin:2, costoMax:6, pesoG:120, nota:'Recompra nicho ruta' },
  ]},
  sexshop: { label: 'Sex Shop / Intimidad', icon: '💋', productos: [
    { nombre:'Aceite de masaje corporal con aroma', q:'aceite masaje corporal', costoMin:1.5, costoMax:4, pesoG:250, nota:'Liquido: revisar courier' },
    { nombre:'Vela de masaje aromatica', q:'vela masaje aromatica', costoMin:2, costoMax:5, pesoG:200, nota:'Regalo, buen margen' },
    { nombre:'Juego de cartas para parejas', q:'juego cartas parejas', costoMin:1, costoMax:3, pesoG:120, nota:'Liviano, alto margen' },
    { nombre:'Antifaz de seda para dormir', q:'antifaz seda dormir', costoMin:0.8, costoMax:2.5, pesoG:40, nota:'Cruza con descanso' },
    { nombre:'Set de lenceria en caja regalo', q:'lenceria set caja regalo', costoMin:3, costoMax:9, pesoG:200, nota:'Talles: complejo' },
    { nombre:'Ligas y accesorios de lenceria', q:'liga lenceria accesorio', costoMin:1, costoMax:3, pesoG:60, nota:'Liviano' },
    { nombre:'Kit de bienestar intimo en caja', q:'kit regalo parejas caja', costoMin:4, costoMax:10, pesoG:400, nota:'Ticket alto, San Valentin' },
    { nombre:'Almohada de posicionamiento para pareja', q:'almohada posicion pareja', costoMin:6, costoMax:14, pesoG:800, nota:'Volumen alto' },
    { nombre:'Esposas de tela con velcro', q:'esposas tela velcro', costoMin:1.5, costoMax:4, pesoG:120, nota:'Nicho, poco saturado' },
    { nombre:'Pluma y accesorios de juego sensorial', q:'pluma juego sensorial pareja', costoMin:1, costoMax:3, pesoG:60, nota:'Micro ticket' },
    { nombre:'Bolsa organizadora discreta con cierre', q:'bolsa organizadora discreta cierre', costoMin:1.5, costoMax:4, pesoG:100, nota:'Complemento' },
    { nombre:'Gel de masaje efecto calor', q:'gel masaje efecto calor', costoMin:1.5, costoMax:4, pesoG:200, nota:'Cosmetico: ANMAT, verificar' },
  ]},
  esoterismo: { label: 'Esoterismo / Velas', icon: '🔮', productos: [
    { nombre:'Set de velas de soja aromaticas chicas', q:'velas soja aromaticas set', costoMin:2, costoMax:6, pesoG:400, nota:'Recompra alta' },
    { nombre:'Quemador de sahumerios de ceramica', q:'porta sahumerios ceramica', costoMin:1.5, costoMax:4, pesoG:200, nota:'Fragil: embalaje' },
    { nombre:'Set de piedras y minerales naturales', q:'set piedras minerales naturales', costoMin:3, costoMax:9, pesoG:350, nota:'Alto margen percibido' },
    { nombre:'Mazo de cartas de tarot con guia', q:'cartas tarot mazo guia', costoMin:2, costoMax:6, pesoG:200, nota:'Nicho con comunidad' },
    { nombre:'Pendulo de cristal con cadena', q:'pendulo cristal radiestesia', costoMin:1.5, costoMax:4, pesoG:60, nota:'Liviano, buen margen' },
    { nombre:'Atrapasuenos decorativo', q:'atrapasuenos decorativo', costoMin:1.5, costoMax:5, pesoG:150, nota:'Volumen alto' },
    { nombre:'Cuenco tibetano chico con mazo', q:'cuenco tibetano chico', costoMin:5, costoMax:13, pesoG:500, nota:'Ticket alto, pesa' },
    { nombre:'Difusor de aceites esenciales de ceramica', q:'difusor aceites esenciales ceramica', costoMin:3, costoMax:8, pesoG:400, nota:'Fragil' },
    { nombre:'Mantel / pano de tarot bordado', q:'pano tarot mantel', costoMin:2, costoMax:6, pesoG:150, nota:'Complemento del mazo' },
    { nombre:'Pulsera de piedras energeticas', q:'pulsera piedras energeticas', costoMin:0.8, costoMax:2.5, pesoG:40, nota:'Micro ticket, packs' },
    { nombre:'Portavela de vidrio con tapa', q:'portavela vidrio con tapa', costoMin:1.5, costoMax:4, pesoG:300, nota:'Fragil, pesa' },
    { nombre:'Set de sahumerios importados surtidos', q:'sahumerios set surtido', costoMin:1, costoMax:3, pesoG:150, nota:'Recompra pura' },
  ]},
  seguridad: { label: 'Seguridad / Cámaras', icon: '🎥', productos: [
    { nombre:'Camara WiFi interior con vision nocturna', q:'camara wifi interior vision nocturna', costoMin:8, costoMax:18, pesoG:300, nota:'Ticket alto, competitivo' },
    { nombre:'Sensor de apertura de puerta WiFi', q:'sensor apertura puerta wifi alarma', costoMin:3, costoMax:8, pesoG:80, nota:'Liviano, poco saturado' },
    { nombre:'Alarma personal de bolsillo con sirena', q:'alarma personal bolsillo sirena', costoMin:1.5, costoMax:4, pesoG:60, nota:'Muy liviano, alto margen' },
    { nombre:'Mirilla digital para puerta', q:'mirilla digital puerta camara', costoMin:10, costoMax:22, pesoG:400, nota:'Ticket alto' },
    { nombre:'Detector de humo autonomo', q:'detector humo autonomo bateria', costoMin:3, costoMax:8, pesoG:200, nota:'Certificacion: verificar' },
    { nombre:'Caja fuerte chica con clave', q:'caja fuerte chica clave digital', costoMin:12, costoMax:28, pesoG:2500, nota:'Pesa mucho: flete caro' },
    { nombre:'Soporte de pared para camara de seguridad', q:'soporte pared camara seguridad', costoMin:2, costoMax:6, pesoG:200, nota:'Complemento' },
    { nombre:'Cartel disuasivo de alarma y camara', q:'cartel disuasivo alarma camara', costoMin:0.5, costoMax:1.8, pesoG:60, nota:'Micro ticket, packs' },
    { nombre:'Rastreador bluetooth tipo llavero', q:'rastreador bluetooth llavero localizador', costoMin:2, costoMax:6, pesoG:30, nota:'Diminuto, buen margen' },
    { nombre:'Cerradura inteligente para portamaletas', q:'candado huella digital', costoMin:5, costoMax:13, pesoG:150, nota:'Poco saturado' },
    { nombre:'Traba de seguridad para cajones y placard', q:'traba seguridad cajones bebes', costoMin:0.8, costoMax:2.5, pesoG:100, nota:'Cruza con bebes' },
    { nombre:'Detector de billetes falsos portatil', q:'detector billetes falsos portatil', costoMin:3, costoMax:9, pesoG:200, nota:'Nicho comercios' },
  ]},
  pintura: { label: 'Pinturería', icon: '🖌️', productos: [
    { nombre:'Set de rodillos y bandeja para pintar', q:'set rodillo bandeja pintura', costoMin:2.5, costoMax:7, pesoG:500, nota:'Volumen alto' },
    { nombre:'Cinta de enmascarar de precision', q:'cinta enmascarar pintura precision', costoMin:1, costoMax:3, pesoG:150, nota:'Recompra pura' },
    { nombre:'Pistola pulverizadora manual para pintura', q:'pistola pintura manual pulverizador', costoMin:8, costoMax:18, pesoG:900, nota:'Ticket alto, pesa' },
    { nombre:'Set de espatulas y llanas plasticas', q:'set espatulas plasticas pintura', costoMin:1.5, costoMax:4, pesoG:250, nota:'Ticket bajo' },
    { nombre:'Mezclador de pintura para taladro', q:'mezclador pintura taladro', costoMin:2, costoMax:6, pesoG:300, nota:'Complemento herramientas' },
    { nombre:'Guarda cantos y protector de zocalo', q:'protector zocalo pintura guia', costoMin:2, costoMax:6, pesoG:300, nota:'Poco saturado' },
    { nombre:'Set de pinceles de artista surtidos', q:'set pinceles artista surtidos', costoMin:1.5, costoMax:4, pesoG:120, nota:'Cruza con arte' },
    { nombre:'Rodillo de textura decorativa', q:'rodillo textura decorativa pared', costoMin:2, costoMax:6, pesoG:200, nota:'Nicho deco' },
    { nombre:'Mono descartable para pintar', q:'mameluco descartable pintor', costoMin:1.5, costoMax:4, pesoG:200, nota:'Recompra, talles simples' },
    { nombre:'Lija de esponja de grano surtido', q:'lija esponja grano surtido', costoMin:1, costoMax:3, pesoG:150, nota:'Recompra' },
    { nombre:'Extensor telescopico para rodillo', q:'extensor telescopico rodillo pintura', costoMin:4, costoMax:10, pesoG:500, nota:'Largo: flete' },
    { nombre:'Lampara de trabajo LED portatil', q:'lampara trabajo led portatil recargable', costoMin:4, costoMax:11, pesoG:350, nota:'Cruza con herramientas' },
  ]},
  textil: { label: 'Textil / Mercería', icon: '🧵', productos: [
    { nombre:'Set de agujas de coser surtidas con enhebrador', q:'set agujas coser enhebrador', costoMin:0.6, costoMax:2, pesoG:60, nota:'Micro ticket, packs' },
    { nombre:'Maquina de coser portatil manual', q:'maquina coser portatil manual', costoMin:5, costoMax:12, pesoG:600, nota:'Ticket alto, pesa' },
    { nombre:'Cortador rotativo con base de corte', q:'cortador rotativo tela base corte', costoMin:4, costoMax:11, pesoG:500, nota:'Nicho patchwork' },
    { nombre:'Set de hilos de colores surtidos', q:'set hilos coser colores', costoMin:1.5, costoMax:4, pesoG:250, nota:'Recompra pura' },
    { nombre:'Alfileres de cabeza de vidrio con alfiletero', q:'alfileres cabeza vidrio alfiletero', costoMin:0.8, costoMax:2.5, pesoG:120, nota:'Recompra' },
    { nombre:'Cinta metrica de modista retractil', q:'cinta metrica modista', costoMin:0.5, costoMax:1.5, pesoG:40, nota:'Micro ticket' },
    { nombre:'Prensatelas de repuesto surtidos', q:'prensatelas repuesto maquina coser', costoMin:3, costoMax:8, pesoG:200, nota:'Nicho, poco saturado' },
    { nombre:'Botones a presion con pinza colocadora', q:'broches presion pinza colocadora', costoMin:3, costoMax:8, pesoG:300, nota:'Alto margen percibido' },
    { nombre:'Aplicaciones y parches termoadhesivos', q:'parches termoadhesivos aplicaciones', costoMin:0.8, costoMax:2.5, pesoG:60, nota:'Liviano, tendencia' },
    { nombre:'Deshilachador y descosedor de costuras', q:'descosedor costuras', costoMin:0.4, costoMax:1.2, pesoG:25, nota:'Micro ticket' },
    { nombre:'Set de elasticos y cintas surtidas', q:'set elasticos cintas mercería', costoMin:1.5, costoMax:4, pesoG:200, nota:'Recompra' },
    { nombre:'Maniqui de mesa regulable chico', q:'maniqui mesa regulable costura', costoMin:12, costoMax:28, pesoG:2000, nota:'Pesa mucho: evaluar flete' },
  ]},
  calzado: { label: 'Calzado / Zapatillas', icon: '👟', productos: [
    { nombre:'Plantillas ortopedicas de gel', q:'plantillas gel ortopedicas', costoMin:1.5, costoMax:4, pesoG:120, nota:'Recompra, sin talle exacto' },
    { nombre:'Cordones elasticos sin atar con traba', q:'cordones elasticos sin atar', costoMin:0.6, costoMax:2, pesoG:50, nota:'Micro ticket, packs' },
    { nombre:'Kit de limpieza de zapatillas', q:'kit limpieza zapatillas', costoMin:2, costoMax:6, pesoG:300, nota:'Recompra, buen margen' },
    { nombre:'Protector de arrugas para puntera', q:'protector arrugas zapatillas', costoMin:1, costoMax:3, pesoG:80, nota:'Nicho sneakerhead' },
    { nombre:'Horma expandidora de calzado', q:'horma expandidora zapatos', costoMin:3, costoMax:8, pesoG:400, nota:'Poco saturado' },
    { nombre:'Taloneras antirozadura de silicona', q:'taloneras silicona antirozadura', costoMin:0.8, costoMax:2.5, pesoG:40, nota:'Recompra' },
    { nombre:'Organizador apilable de zapatillas', q:'organizador apilable zapatillas caja', costoMin:2.5, costoMax:7, pesoG:400, nota:'Volumen alto' },
    { nombre:'Cepillo de cerdas para gamuza', q:'cepillo gamuza calzado', costoMin:1, costoMax:3, pesoG:80, nota:'Complemento kit' },
    { nombre:'Secador de calzado electrico', q:'secador calzado electrico', costoMin:5, costoMax:12, pesoG:500, nota:'Estacional invierno' },
    { nombre:'Bolsa de viaje para zapatos', q:'bolsa viaje zapatos organizadora', costoMin:1, costoMax:3, pesoG:80, nota:'Cruza con viajes' },
    { nombre:'Impermeabilizante en spray para calzado', q:'impermeabilizante spray calzado', costoMin:1.5, costoMax:4, pesoG:250, nota:'Aerosol: revisar courier' },
    { nombre:'Media invisible antideslizante pack', q:'medias invisibles antideslizantes pack', costoMin:1, costoMax:3, pesoG:80, nota:'Recompra pura' },
  ]},
  reposteria: { label: 'Repostería / Panadería', icon: '🧁', productos: [
    { nombre:'Set de boquillas de decoracion con manga', q:'boquillas reposteria set manga', costoMin:2, costoMax:6, pesoG:250, nota:'Alto margen, liviano' },
    { nombre:'Molde de silicona para tortas y budines', q:'molde silicona torta budin', costoMin:1.5, costoMax:4, pesoG:200, nota:'Volumen, no peso' },
    { nombre:'Termometro digital de cocina con sonda', q:'termometro digital cocina sonda', costoMin:2, costoMax:6, pesoG:100, nota:'Liviano, utilidad real' },
    { nombre:'Base giratoria para decorar tortas', q:'base giratoria decorar tortas', costoMin:4, costoMax:11, pesoG:700, nota:'Pesa, ticket medio' },
    { nombre:'Set de cortantes de galletitas', q:'cortantes galletitas set', costoMin:1.5, costoMax:4, pesoG:200, nota:'Estacional fiestas' },
    { nombre:'Espatula y alisador de tortas', q:'espatula alisadora tortas', costoMin:1.5, costoMax:4, pesoG:150, nota:'Complemento' },
    { nombre:'Moldes de bombones de policarbonato', q:'molde bombones policarbonato', costoMin:4, costoMax:11, pesoG:400, nota:'Nicho pastelero, pascuas' },
    { nombre:'Set de capsulas y wrappers para cupcakes', q:'capsulas cupcakes wrappers set', costoMin:1, costoMax:3, pesoG:120, nota:'Recompra pura' },
    { nombre:'Balanza digital de precision para gramos', q:'balanza precision gramos reposteria', costoMin:2.5, costoMax:7, pesoG:200, nota:'Liviano, buen margen' },
    { nombre:'Sellos e impresores para fondant', q:'sellos fondant impresores', costoMin:2, costoMax:6, pesoG:150, nota:'Nicho, poco saturado' },
    { nombre:'Manga repostera reutilizable de silicona', q:'manga repostera silicona reutilizable', costoMin:1, costoMax:3, pesoG:100, nota:'Recompra' },
    { nombre:'Bandeja y cajas para transportar tortas', q:'caja transporte torta bandeja', costoMin:2, costoMax:6, pesoG:300, nota:'Volumen alto, revisar flete' },
  ]},
  vinos: { label: 'Vinos / Bebidas', icon: '🍷', productos: [
    { nombre:'Aireador de vino de pico', q:'aireador vino pico decantador', costoMin:1.5, costoMax:4, pesoG:100, nota:'Regalo, alto margen' },
    { nombre:'Sacacorchos de camarero profesional', q:'sacacorchos camarero profesional', costoMin:1.5, costoMax:4, pesoG:100, nota:'Evergreen' },
    { nombre:'Tapon al vacio para botella', q:'tapon vacio botella vino', costoMin:1, costoMax:3, pesoG:60, nota:'Micro ticket, packs' },
    { nombre:'Set de piedras de whisky con pinza', q:'piedras whisky set', costoMin:2, costoMax:6, pesoG:400, nota:'Regalo, pesa' },
    { nombre:'Coctelera de acero con set de barman', q:'coctelera acero set barman', costoMin:6, costoMax:15, pesoG:900, nota:'Ticket alto, pesa' },
    { nombre:'Termometro de collar para botella', q:'termometro collar botella vino', costoMin:1, costoMax:3, pesoG:50, nota:'Nicho, liviano' },
    { nombre:'Dispenser dosificador para botella', q:'dosificador pico vertedor botella', costoMin:0.6, costoMax:2, pesoG:40, nota:'Recompra bares' },
    { nombre:'Enfriador de botella en manga de gel', q:'enfriador botella manga gel', costoMin:1.5, costoMax:4, pesoG:200, nota:'Estacional verano' },
    { nombre:'Set de marcadores de copas', q:'marcadores copas set fiesta', costoMin:0.5, costoMax:1.8, pesoG:40, nota:'Micro ticket, cruza cotillon' },
    { nombre:'Bomba y tapon de conservacion al vacio', q:'bomba vacio vino conservador', costoMin:2, costoMax:6, pesoG:120, nota:'Utilidad real' },
    { nombre:'Porta botellas de pared decorativo', q:'porta botellas pared decorativo', costoMin:3, costoMax:9, pesoG:500, nota:'Deco, pesa' },
    { nombre:'Bolso termico para dos botellas', q:'bolso termico botellas vino', costoMin:3, costoMax:8, pesoG:300, nota:'Regalo, volumen' },
  ]},
  limpieza: { label: 'Limpieza / Hogar', icon: '🧽', productos: [
    { nombre:'Mopa giratoria con balde escurridor', q:'mopa giratoria balde escurridor', costoMin:8, costoMax:18, pesoG:2000, nota:'Pesa mucho: flete caro' },
    { nombre:'Cepillo electrico multiuso recargable', q:'cepillo electrico limpieza recargable', costoMin:5, costoMax:12, pesoG:400, nota:'Ticket medio' },
    { nombre:'Set de panos de microfibra', q:'panos microfibra set limpieza', costoMin:1.5, costoMax:4, pesoG:250, nota:'Recompra pura' },
    { nombre:'Limpiavidrios magnetico de doble cara', q:'limpiavidrios magnetico doble cara', costoMin:3, costoMax:9, pesoG:300, nota:'Nicho altura' },
    { nombre:'Cepillo de ranuras y juntas', q:'cepillo ranuras juntas limpieza', costoMin:1, costoMax:3, pesoG:100, nota:'Micro ticket viral' },
    { nombre:'Dispenser de jabon automatico con sensor', q:'dispenser jabon automatico sensor', costoMin:4, costoMax:11, pesoG:350, nota:'Ticket medio' },
    { nombre:'Escurridor de trapo de piso con mango', q:'escurridor trapo piso mango', costoMin:3, costoMax:8, pesoG:600, nota:'Pesa' },
    { nombre:'Recogedor de pelos para lavarropas', q:'atrapa pelos lavarropas', costoMin:0.5, costoMax:1.8, pesoG:40, nota:'Micro ticket, packs' },
    { nombre:'Organizador de ducha adhesivo sin taladro', q:'organizador ducha adhesivo sin taladro', costoMin:2.5, costoMax:7, pesoG:350, nota:'Volumen' },
    { nombre:'Guantes de limpieza reutilizables largos', q:'guantes limpieza largos reutilizables', costoMin:1, costoMax:3, pesoG:120, nota:'Recompra' },
    { nombre:'Cepillo de inodoro con base cerrada', q:'cepillo inodoro base cerrada', costoMin:2, costoMax:6, pesoG:400, nota:'Volumen alto' },
    { nombre:'Bolsas de residuos con aroma pack', q:'bolsas residuos aroma pack', costoMin:1.5, costoMax:4, pesoG:400, nota:'Recompra, margen bajo' },
  ]},
  organizacion: { label: 'Organización / Guardado', icon: '📦', productos: [
    { nombre:'Bolsas de vacio para ropa con bomba', q:'bolsas vacio ropa bomba', costoMin:3, costoMax:8, pesoG:400, nota:'Alta demanda estacional' },
    { nombre:'Cajas organizadoras plegables de tela', q:'cajas organizadoras plegables tela', costoMin:2, costoMax:6, pesoG:300, nota:'Volumen alto' },
    { nombre:'Divisores ajustables para cajones', q:'divisores cajones ajustables', costoMin:2, costoMax:6, pesoG:250, nota:'Poco saturado' },
    { nombre:'Organizador colgante de puerta multiuso', q:'organizador colgante puerta zapatos', costoMin:2.5, costoMax:7, pesoG:400, nota:'Volumen' },
    { nombre:'Ganchos adhesivos de alta carga', q:'ganchos adhesivos alta carga pack', costoMin:1, costoMax:3, pesoG:100, nota:'Recompra, packs' },
    { nombre:'Organizador de cables tipo velcro', q:'precintos velcro organizador cables', costoMin:0.6, costoMax:2, pesoG:60, nota:'Micro ticket' },
    { nombre:'Cesto plegable de ropa sucia', q:'cesto plegable ropa sucia', costoMin:3, costoMax:8, pesoG:500, nota:'Volumen alto' },
    { nombre:'Perchas antideslizantes de terciopelo pack', q:'perchas terciopelo antideslizantes pack', costoMin:2, costoMax:6, pesoG:500, nota:'Volumen, recompra' },
    { nombre:'Organizador giratorio de escritorio', q:'organizador giratorio escritorio', costoMin:3, costoMax:9, pesoG:450, nota:'Ticket medio' },
    { nombre:'Etiquetadora manual con cinta', q:'etiquetadora manual cinta rotuladora', costoMin:6, costoMax:14, pesoG:400, nota:'Ticket alto' },
    { nombre:'Fundas guardaropa con cierre', q:'fundas guardaropa cierre antipolvo', costoMin:1.5, costoMax:4, pesoG:200, nota:'Recompra estacional' },
    { nombre:'Organizador de bijou de viaje', q:'organizador bijou viaje joyero', costoMin:2, costoMax:6, pesoG:200, nota:'Regalo, buen margen' },
  ]},
  maquillaje: { label: 'Maquillaje / Uñas', icon: '💅', productos: [
    { nombre:'Set de brochas de maquillaje con estuche', q:'set brochas maquillaje estuche', costoMin:3, costoMax:9, pesoG:250, nota:'Buen margen, liviano' },
    { nombre:'Esponja de maquillaje con soporte', q:'esponja maquillaje beauty blender soporte', costoMin:0.8, costoMax:2.5, pesoG:60, nota:'Recompra pura' },
    { nombre:'Lampara UV/LED para unas portatil', q:'lampara uv led unas portatil', costoMin:6, costoMax:14, pesoG:400, nota:'Ticket alto, nicho nails' },
    { nombre:'Torno electrico para unas portatil', q:'torno unas electrico portatil', costoMin:8, costoMax:18, pesoG:400, nota:'Profesional, ticket alto' },
    { nombre:'Set de pinceles de nail art', q:'pinceles nail art set', costoMin:1.5, costoMax:4, pesoG:80, nota:'Liviano, alto margen' },
    { nombre:'Limpiador electrico de brochas', q:'limpiador brochas maquillaje electrico', costoMin:3, costoMax:9, pesoG:250, nota:'Poco saturado' },
    { nombre:'Organizador acrilico de maquillaje', q:'organizador acrilico maquillaje', costoMin:3, costoMax:9, pesoG:500, nota:'Fragil, volumen' },
    { nombre:'Espejo con luz LED y aumento', q:'espejo maquillaje luz led aumento', costoMin:4, costoMax:11, pesoG:400, nota:'Fragil, ticket medio' },
    { nombre:'Set de stickers y plantillas de unas', q:'stickers unas plantillas set', costoMin:0.6, costoMax:2, pesoG:40, nota:'Micro ticket, packs' },
    { nombre:'Rizador de pestanas con repuestos', q:'rizador pestanas repuestos', costoMin:1, costoMax:3, pesoG:80, nota:'Recompra' },
    { nombre:'Kit de manicura profesional en estuche', q:'kit manicura profesional estuche', costoMin:3, costoMax:9, pesoG:300, nota:'Regalo' },
    { nombre:'Banda / vincha para lavarse la cara', q:'vincha spa lavar cara', costoMin:0.6, costoMax:2, pesoG:40, nota:'Micro ticket, cruza skincare' },
  ]},
  cuidadopersonal: { label: 'Cuidado Personal', icon: '🧴', productos: [
    { nombre:'Cepillo de dientes electrico sonico', q:'cepillo dientes electrico sonico', costoMin:4, costoMax:11, pesoG:200, nota:'Recompra de cabezales' },
    { nombre:'Cabezales de repuesto para cepillo electrico', q:'cabezales repuesto cepillo electrico', costoMin:1.5, costoMax:4, pesoG:60, nota:'Recompra pura, alto margen' },
    { nombre:'Irrigador dental portatil', q:'irrigador dental portatil', costoMin:8, costoMax:18, pesoG:400, nota:'Ticket alto' },
    { nombre:'Rodillo facial de jade o cuarzo', q:'rodillo facial jade masajeador', costoMin:1.5, costoMax:4, pesoG:120, nota:'Fragil, alto margen' },
    { nombre:'Recortadora de nariz y orejas', q:'recortadora nariz orejas', costoMin:2.5, costoMax:7, pesoG:120, nota:'Regalo, poco saturado' },
    { nombre:'Set de peines y cepillos desenredantes', q:'cepillo desenredante set', costoMin:1.5, costoMax:4, pesoG:150, nota:'Recompra' },
    { nombre:'Depiladora facial electrica', q:'depiladora facial electrica', costoMin:3, costoMax:8, pesoG:100, nota:'Liviano, buen margen' },
    { nombre:'Set de limas y cortauna profesional', q:'set cortaunas profesional acero', costoMin:1.5, costoMax:4, pesoG:150, nota:'Regalo, evergreen' },
    { nombre:'Cepillo secador voluminizador', q:'cepillo secador voluminizador', costoMin:8, costoMax:18, pesoG:600, nota:'Ticket alto, pesa' },
    { nombre:'Limpiador facial por ultrasonido', q:'limpiador facial ultrasonico spatula', costoMin:5, costoMax:12, pesoG:150, nota:'Nicho skincare' },
    { nombre:'Neceser de viaje colgante', q:'neceser viaje colgante organizador', costoMin:2.5, costoMax:7, pesoG:250, nota:'Cruza con viajes' },
    { nombre:'Masajeador de cuero cabelludo', q:'masajeador cuero cabelludo', costoMin:0.8, costoMax:2.5, pesoG:80, nota:'Micro ticket, viral' },
  ]},
  suplementos: { label: 'Suplementos / Nutrición', icon: '💊', productos: [
    { nombre:'Shaker con compartimentos para suplementos', q:'shaker vaso proteina compartimentos', costoMin:2, costoMax:6, pesoG:250, nota:'Complemento, no es suplemento' },
    { nombre:'Pastillero semanal organizador', q:'pastillero semanal organizador', costoMin:1, costoMax:3, pesoG:120, nota:'Liviano, evergreen' },
    { nombre:'Dosificador de polvo portatil', q:'dosificador proteina portatil', costoMin:1.5, costoMax:4, pesoG:120, nota:'Nicho gym' },
    { nombre:'Botella con infusor de frutas', q:'botella infusor frutas', costoMin:2.5, costoMax:7, pesoG:350, nota:'Estacional verano' },
    { nombre:'Balanza de alimentos para dieta', q:'balanza alimentos digital dieta', costoMin:3, costoMax:8, pesoG:400, nota:'Cruza con cocina' },
    { nombre:'Set de viales para porciones diarias', q:'viales porciones suplementos set', costoMin:1, costoMax:3, pesoG:100, nota:'Micro ticket' },
    { nombre:'Cuchara medidora de acero con clip', q:'cucharas medidoras acero set', costoMin:1, costoMax:3, pesoG:120, nota:'Recompra baja' },
    { nombre:'Bolso termico para viandas fitness', q:'bolso termico viandas fitness', costoMin:4, costoMax:11, pesoG:400, nota:'Volumen' },
    { nombre:'Set de tuppers de vidrio con divisiones', q:'tupper vidrio divisiones set', costoMin:6, costoMax:14, pesoG:1500, nota:'Pesa y es fragil' },
    { nombre:'Aplicacion de bandas de test de hidratacion', q:'tiras test hidratacion', costoMin:2, costoMax:6, pesoG:60, nota:'Producto sanitario: verificar' },
    { nombre:'Botella deportiva con marcas de horario', q:'botella agua motivacional horarios', costoMin:2.5, costoMax:7, pesoG:300, nota:'Tendencia, buen margen' },
    { nombre:'Mortero y triturador de pastillas', q:'triturador pastillas cortador', costoMin:1, costoMax:3, pesoG:80, nota:'Nicho adulto mayor' },
  ]},
  tejido: { label: 'Tejido / Lana', icon: '🧶', productos: [
    { nombre:'Set de agujas de crochet ergonomicas', q:'set agujas crochet ergonomicas', costoMin:2.5, costoMax:7, pesoG:250, nota:'Alto margen, nicho fiel' },
    { nombre:'Agujas circulares intercambiables kit', q:'agujas circulares intercambiables kit tejer', costoMin:6, costoMax:15, pesoG:400, nota:'Ticket alto, nicho' },
    { nombre:'Contador de vueltas digital para tejer', q:'contador vueltas tejido digital', costoMin:0.8, costoMax:2.5, pesoG:30, nota:'Micro ticket, diminuto' },
    { nombre:'Devanadora manual de ovillos', q:'devanadora ovillos manual', costoMin:6, costoMax:15, pesoG:700, nota:'Pesa, ticket alto' },
    { nombre:'Set de marcadores de puntos', q:'marcadores puntos tejido set', costoMin:0.5, costoMax:1.8, pesoG:30, nota:'Micro ticket, packs' },
    { nombre:'Telar circular para gorros', q:'telar circular gorros tejido', costoMin:2.5, costoMax:7, pesoG:300, nota:'Volumen' },
    { nombre:'Bolso organizador de lanas', q:'bolso organizador lanas tejido', costoMin:4, costoMax:11, pesoG:400, nota:'Volumen alto' },
    { nombre:'Set de agujas de tapiceria romas', q:'agujas lana romas set', costoMin:0.5, costoMax:1.5, pesoG:30, nota:'Micro ticket' },
    { nombre:'Kit de amigurumi con relleno y ojos', q:'kit amigurumi ojos seguridad', costoMin:2, costoMax:6, pesoG:200, nota:'Tendencia fuerte' },
    { nombre:'Bloqueadores y alfileres para bloqueo', q:'alfileres bloqueo tejido set', costoMin:2, costoMax:6, pesoG:200, nota:'Nicho avanzado' },
    { nombre:'Regla y medidor de puntos', q:'medidor puntos regla tejido', costoMin:0.8, costoMax:2.5, pesoG:40, nota:'Micro ticket' },
    { nombre:'Maquina de tejer circular manual', q:'maquina tejer circular manual', costoMin:10, costoMax:24, pesoG:900, nota:'Ticket alto, pesa' },
  ]},
  agro: { label: 'Agro / Campo', icon: '🚜', productos: [
    { nombre:'Medidor de pH y humedad de suelo', q:'medidor ph humedad suelo', costoMin:2, costoMax:6, pesoG:150, nota:'Liviano, buen margen' },
    { nombre:'Pulverizador de presion previa 2L', q:'pulverizador presion previa 2 litros', costoMin:3, costoMax:9, pesoG:600, nota:'Volumen y peso' },
    { nombre:'Cinta y tutores para plantas pack', q:'tutores plantas cinta pack', costoMin:1.5, costoMax:4, pesoG:300, nota:'Recompra estacional' },
    { nombre:'Comedero automatico para aves de corral', q:'comedero automatico gallinas', costoMin:5, costoMax:13, pesoG:700, nota:'Nicho, pesa' },
    { nombre:'Cinta de alambrado electrico para ganado', q:'cinta alambrado electrico ganado', costoMin:6, costoMax:15, pesoG:900, nota:'Pesa, nicho campo' },
    { nombre:'Kit de injerto con navajas y cintas', q:'kit injerto navaja cinta', costoMin:2.5, costoMax:7, pesoG:250, nota:'Nicho fruticultura' },
    { nombre:'Trampa cromatica para insectos pack', q:'trampas cromaticas insectos pack', costoMin:1.5, costoMax:4, pesoG:150, nota:'Recompra pura' },
    { nombre:'Termometro maximo minimo de invernadero', q:'termometro maxima minima invernadero', costoMin:2, costoMax:6, pesoG:120, nota:'Poco saturado' },
    { nombre:'Malla antiheladas / media sombra', q:'media sombra malla antihelada', costoMin:5, costoMax:13, pesoG:1200, nota:'Pesa: evaluar flete' },
    { nombre:'Guantes de trabajo de nitrilo pack', q:'guantes trabajo nitrilo pack', costoMin:1.5, costoMax:4, pesoG:200, nota:'Recompra' },
    { nombre:'Bebedero automatico a flotante', q:'bebedero automatico flotante animales', costoMin:3, costoMax:9, pesoG:400, nota:'Nicho productivo' },
    { nombre:'Semillero con domo y bandeja', q:'semillero bandeja domo germinacion', costoMin:2, costoMax:6, pesoG:350, nota:'Volumen, estacional' },
  ]},
  motos: { label: 'Motos / Repuestos', icon: '🏍️', productos: [
    { nombre:'Soporte de celular para moto con carga USB', q:'soporte celular moto cargador usb', costoMin:4, costoMax:11, pesoG:200, nota:'Buen margen' },
    { nombre:'Cubre pierna termico impermeable', q:'cubre pierna moto impermeable', costoMin:5, costoMax:13, pesoG:700, nota:'Estacional invierno, volumen' },
    { nombre:'Guantes de moto con proteccion', q:'guantes moto proteccion nudillos', costoMin:4, costoMax:11, pesoG:250, nota:'Talles: cuidado stock' },
    { nombre:'Red elastica porta equipaje', q:'red elastica porta equipaje moto', costoMin:1, costoMax:3, pesoG:150, nota:'Micro ticket, recompra' },
    { nombre:'Camara y kit de reparacion de pinchaduras', q:'kit reparacion pinchadura moto tubeless', costoMin:2.5, costoMax:7, pesoG:300, nota:'Recompra, utilidad real' },
    { nombre:'Antirrobo de disco con alarma', q:'traba disco moto alarma', costoMin:6, costoMax:15, pesoG:600, nota:'Ticket alto, pesa' },
    { nombre:'Funda cubre moto impermeable', q:'funda cubre moto impermeable', costoMin:5, costoMax:13, pesoG:800, nota:'Volumen y peso' },
    { nombre:'Espejos retrovisores de aluminio', q:'espejos retrovisores moto aluminio', costoMin:5, costoMax:13, pesoG:500, nota:'Compatibilidad: cuidado' },
    { nombre:'Puños de goma antivibracion', q:'punos moto goma antivibracion', costoMin:2, costoMax:6, pesoG:200, nota:'Recompra' },
    { nombre:'Intercomunicador bluetooth para casco', q:'intercomunicador bluetooth casco moto', costoMin:14, costoMax:32, pesoG:250, nota:'Ticket alto, mas riesgo' },
    { nombre:'Manoplas cubre manos para invierno', q:'manoplas moto cubre manos', costoMin:4, costoMax:11, pesoG:400, nota:'Estacional fuerte' },
    { nombre:'Kit de tornillos y grampas de carenado', q:'tornillos carenado moto kit', costoMin:2, costoMax:6, pesoG:250, nota:'Recompra taller' },
  ]},
  ferrmanuales: { label: 'Herramientas Manuales', icon: '🪛', productos: [
    { nombre:'Set de destornilladores de precision 25 en 1', q:'set destornilladores precision 25 en 1', costoMin:2.5, costoMax:7, pesoG:250, nota:'Evergreen, buen margen' },
    { nombre:'Pinza multiuso plegable tipo multitool', q:'multiherramienta pinza plegable', costoMin:4, costoMax:11, pesoG:250, nota:'Regalo, ticket medio' },
    { nombre:'Nivel laser de linea cruzada', q:'nivel laser lineas cruzadas', costoMin:8, costoMax:20, pesoG:400, nota:'Ticket alto' },
    { nombre:'Cinta metrica de 5m con traba', q:'cinta metrica 5 metros', costoMin:1.5, costoMax:4, pesoG:250, nota:'Ticket bajo, saturado' },
    { nombre:'Set de llaves allen con soporte', q:'set llaves allen soporte', costoMin:2, costoMax:6, pesoG:300, nota:'Evergreen' },
    { nombre:'Detector de cables y metal en pared', q:'detector cables metal pared', costoMin:4, costoMax:11, pesoG:250, nota:'Poco saturado' },
    { nombre:'Alicate pelacables automatico', q:'pelacables automatico alicate', costoMin:3, costoMax:9, pesoG:250, nota:'Nicho electricista' },
    { nombre:'Set de puntas de atornillador con adaptador', q:'set puntas atornillador magnetico', costoMin:2, costoMax:6, pesoG:250, nota:'Recompra' },
    { nombre:'Sargento / prensa rapida en F', q:'sargento prensa rapida carpinteria', costoMin:3, costoMax:9, pesoG:600, nota:'Pesa' },
    { nombre:'Calibre digital de precision', q:'calibre digital precision', costoMin:4, costoMax:11, pesoG:200, nota:'Nicho taller, buen margen' },
    { nombre:'Cinturon portaherramientas de lona', q:'cinturon portaherramientas lona', costoMin:4, costoMax:11, pesoG:500, nota:'Volumen' },
    { nombre:'Escuadra magnetica para soldar', q:'escuadra magnetica soldadura', costoMin:2.5, costoMax:7, pesoG:400, nota:'Nicho, pesa' },
  ]},
  maternidad: { label: 'Maternidad / Embarazo', icon: '🤰', productos: [
    { nombre:'Faja de sosten abdominal para embarazo', q:'faja soporte abdominal embarazo', costoMin:3, costoMax:9, pesoG:250, nota:'Talles: cuidado' },
    { nombre:'Almohada de lactancia y descanso', q:'almohada lactancia embarazo', costoMin:6, costoMax:15, pesoG:800, nota:'Volumen muy alto' },
    { nombre:'Sacaleche manual de silicona', q:'sacaleche manual silicona', costoMin:2, costoMax:6, pesoG:150, nota:'Producto sanitario: verificar' },
    { nombre:'Bolsas de conservacion de leche materna', q:'bolsas leche materna conservacion', costoMin:1.5, costoMax:4, pesoG:120, nota:'Recompra pura' },
    { nombre:'Discos absorbentes lavables pack', q:'discos absorbentes lactancia lavables', costoMin:1.5, costoMax:4, pesoG:100, nota:'Recompra, ecologico' },
    { nombre:'Doppler fetal domestico', q:'doppler fetal casero', costoMin:8, costoMax:20, pesoG:250, nota:'Producto sanitario: verificar ANMAT' },
    { nombre:'Cinturon adaptador de cinturon de seguridad', q:'adaptador cinturon seguridad embarazo', costoMin:2.5, costoMax:7, pesoG:200, nota:'Nicho, poco saturado' },
    { nombre:'Set de cremas antiestrias envase de viaje', q:'envases viaje cremas set', costoMin:1, costoMax:3, pesoG:100, nota:'Envases, no cosmetico' },
    { nombre:'Cubre asiento de auto para lactancia', q:'poncho lactancia cubre', costoMin:2.5, costoMax:7, pesoG:200, nota:'Buen margen' },
    { nombre:'Rueda / calendario de seguimiento de embarazo', q:'libro registro embarazo album', costoMin:2, costoMax:6, pesoG:250, nota:'Regalo' },
    { nombre:'Medias de compresion graduada', q:'medias compresion graduada', costoMin:3, costoMax:9, pesoG:120, nota:'Talles, producto sanitario' },
    { nombre:'Organizador de bolso de maternidad', q:'organizador bolso maternidad panalera', costoMin:3, costoMax:9, pesoG:300, nota:'Volumen' },
  ]},
  pilates: { label: 'Yoga / Pilates', icon: '🧘', productos: [
    { nombre:'Bandas elasticas de resistencia set', q:'bandas elasticas resistencia set', costoMin:2, costoMax:6, pesoG:250, nota:'Evergreen, liviano' },
    { nombre:'Rueda de yoga para estiramiento', q:'rueda yoga estiramiento', costoMin:5, costoMax:13, pesoG:900, nota:'Volumen muy alto' },
    { nombre:'Ladrillos de yoga de EVA par', q:'ladrillos yoga eva par', costoMin:2.5, costoMax:7, pesoG:400, nota:'Volumen alto' },
    { nombre:'Aro de pilates de resistencia', q:'aro pilates anillo resistencia', costoMin:3, costoMax:9, pesoG:400, nota:'Volumen' },
    { nombre:'Correa de yoga con hebillas', q:'correa yoga cinta estiramiento', costoMin:1.5, costoMax:4, pesoG:180, nota:'Liviano, buen margen' },
    { nombre:'Pelota de pilates chica antiestallido', q:'pelota pilates chica 25cm', costoMin:2, costoMax:6, pesoG:200, nota:'Se envia desinflada' },
    { nombre:'Rodillo de espuma para masaje muscular', q:'rodillo espuma foam roller', costoMin:4, costoMax:11, pesoG:600, nota:'Volumen muy alto' },
    { nombre:'Bandas circulares de gluteos de tela', q:'bandas gluteos tela set', costoMin:2, costoMax:6, pesoG:200, nota:'Tendencia fuerte' },
    { nombre:'Bolso de transporte para mat de yoga', q:'bolso transporte mat yoga', costoMin:2.5, costoMax:7, pesoG:250, nota:'Complemento' },
    { nombre:'Pelota de masaje miofascial', q:'pelota masaje miofascial', costoMin:1, costoMax:3, pesoG:150, nota:'Micro ticket' },
    { nombre:'Deslizadores para entrenamiento core', q:'deslizadores core sliders', costoMin:1.5, costoMax:4, pesoG:150, nota:'Liviano, poco saturado' },
    { nombre:'Toalla antideslizante para mat', q:'toalla antideslizante yoga mat', costoMin:3, costoMax:9, pesoG:350, nota:'Buen margen' },
  ]},
  coleccionables: { label: 'Coleccionables / Figuras', icon: '🏆', productos: [
    { nombre:'Vitrina acrilica para figuras', q:'vitrina acrilica figuras exhibidor', costoMin:3, costoMax:9, pesoG:400, nota:'Fragil, volumen' },
    { nombre:'Base giratoria de exhibicion con luz', q:'base giratoria exhibidor luz led', costoMin:4, costoMax:11, pesoG:300, nota:'Complemento' },
    { nombre:'Fundas protectoras para cartas coleccionables', q:'fundas cartas coleccionables protectores', costoMin:1, costoMax:3, pesoG:100, nota:'Recompra pura' },
    { nombre:'Album de carpeta para cartas', q:'album carpeta cartas coleccion', costoMin:3, costoMax:9, pesoG:500, nota:'Pesa' },
    { nombre:'Soporte de pared para figuras', q:'soporte pared figuras coleccion', costoMin:2, costoMax:6, pesoG:200, nota:'Poco saturado' },
    { nombre:'Caja de almacenamiento para cartas', q:'caja almacenamiento cartas deck box', costoMin:1.5, costoMax:4, pesoG:150, nota:'Recompra' },
    { nombre:'Monedas y capsulas protectoras', q:'capsulas protectoras monedas coleccion', costoMin:1.5, costoMax:4, pesoG:120, nota:'Nicho numismatica' },
    { nombre:'Lupa con luz para inspeccion', q:'lupa con luz coleccionista', costoMin:2, costoMax:6, pesoG:150, nota:'Cruza con varios nichos' },
    { nombre:'Set de placas y etiquetas para exhibicion', q:'placas identificacion exhibicion coleccion', costoMin:1.5, costoMax:4, pesoG:100, nota:'Nicho' },
    { nombre:'Maletin rigido para miniaturas', q:'maletin transporte miniaturas espuma', costoMin:8, costoMax:20, pesoG:900, nota:'Ticket alto, pesa' },
    { nombre:'Set de pinceles y pinturas para miniaturas', q:'pinceles miniaturas pintura set', costoMin:3, costoMax:9, pesoG:200, nota:'Nicho wargaming' },
    { nombre:'Bandeja de dados con superficie de fieltro', q:'bandeja dados rol fieltro', costoMin:3, costoMax:9, pesoG:300, nota:'Nicho rol' },
  ]},
  drones: { label: 'Drones / RC', icon: '🚁', productos: [
    { nombre:'Mini dron de entrenamiento con camara', q:'mini dron camara principiante', costoMin:14, costoMax:32, pesoG:250, nota:'Ticket alto, riesgo aduana' },
    { nombre:'Bateria de repuesto para dron', q:'bateria repuesto dron lipo', costoMin:6, costoMax:15, pesoG:120, nota:'Lipo: restringido en courier' },
    { nombre:'Helices de repuesto set con protectores', q:'helices repuesto dron set protectores', costoMin:2, costoMax:6, pesoG:80, nota:'Recompra pura, liviano' },
    { nombre:'Auto RC todo terreno escala chica', q:'auto rc todo terreno control remoto', costoMin:10, costoMax:24, pesoG:700, nota:'Ticket alto, pesa' },
    { nombre:'Maletin de transporte para dron', q:'maletin transporte dron espuma', costoMin:6, costoMax:15, pesoG:600, nota:'Volumen' },
    { nombre:'Filtros ND para camara de dron', q:'filtros nd dron set', costoMin:5, costoMax:13, pesoG:50, nota:'Diminuto, alto margen' },
    { nombre:'Plataforma plegable de aterrizaje', q:'plataforma aterrizaje dron plegable', costoMin:3, costoMax:9, pesoG:250, nota:'Complemento' },
    { nombre:'Motor brushless de repuesto', q:'motor brushless repuesto dron', costoMin:4, costoMax:11, pesoG:80, nota:'Recompra tecnica' },
    { nombre:'Antena extensora de senal para control', q:'antena extensor senal control dron', costoMin:2.5, costoMax:7, pesoG:60, nota:'Liviano, nicho' },
    { nombre:'Cargador multiple de baterias LiPo', q:'cargador baterias lipo multiple', costoMin:8, costoMax:20, pesoG:350, nota:'Ticket alto' },
    { nombre:'Simulador y cable de entrenamiento RC', q:'simulador rc cable entrenamiento', costoMin:3, costoMax:9, pesoG:80, nota:'Nicho, poco saturado' },
    { nombre:'Luces LED de senalizacion para dron', q:'luces led dron senalizacion', costoMin:2, costoMax:6, pesoG:40, nota:'Diminuto' },
  ]},
  smartwatch: { label: 'Smartwatch / Wearables', icon: '📲', productos: [
    { nombre:'Malla de silicona de repuesto universal', q:'malla silicona smartwatch repuesto', costoMin:0.8, costoMax:2.5, pesoG:40, nota:'Recompra pura, diminuto' },
    { nombre:'Malla metalica milanesa magnetica', q:'malla milanesa metalica smartwatch', costoMin:2, costoMax:6, pesoG:80, nota:'Buen margen percibido' },
    { nombre:'Vidrio protector para smartwatch pack', q:'vidrio protector smartwatch pack', costoMin:0.8, costoMax:2.5, pesoG:30, nota:'Recompra, packs' },
    { nombre:'Case protector con bumper para reloj', q:'case protector smartwatch bumper', costoMin:1, costoMax:3, pesoG:40, nota:'Micro ticket' },
    { nombre:'Cable de carga magnetico de repuesto', q:'cable carga magnetico smartwatch', costoMin:1.5, costoMax:4, pesoG:40, nota:'Recompra: se pierden' },
    { nombre:'Base de carga con soporte de exhibicion', q:'soporte carga smartwatch base', costoMin:2, costoMax:6, pesoG:150, nota:'Complemento' },
    { nombre:'Banda deportiva perforada transpirable', q:'malla deportiva perforada smartwatch', costoMin:1, costoMax:3, pesoG:40, nota:'Recompra' },
    { nombre:'Anillo inteligente contador de pasos', q:'anillo inteligente smart ring', costoMin:12, costoMax:28, pesoG:30, nota:'Tendencia, ticket alto' },
    { nombre:'Adaptadores de malla para relojes clasicos', q:'adaptador malla reloj smartwatch', costoMin:1, costoMax:3, pesoG:30, nota:'Nicho compatibilidad' },
    { nombre:'Banda para banda cardiaca de pecho', q:'banda cardiaca pecho bluetooth', costoMin:6, costoMax:15, pesoG:100, nota:'Nicho running' },
    { nombre:'Organizador de mallas intercambiables', q:'organizador mallas smartwatch caja', costoMin:2, costoMax:6, pesoG:150, nota:'Poco saturado' },
    { nombre:'Kit de herramientas para cambiar mallas', q:'kit herramientas cambiar malla reloj', costoMin:1.5, costoMax:4, pesoG:100, nota:'Complemento' },
  ]},
  bazar: { label: 'Bazar / Vajilla', icon: '🍽️', productos: [
    { nombre:'Set de cubiertos de acero para viaje', q:'set cubiertos viaje acero estuche', costoMin:2, costoMax:6, pesoG:200, nota:'Ecologico, tendencia' },
    { nombre:'Tabla de corte plegable de silicona', q:'tabla corte plegable silicona', costoMin:2.5, costoMax:7, pesoG:300, nota:'Volumen' },
    { nombre:'Set de bowls de acero apilables', q:'bowls acero apilables set', costoMin:5, costoMax:13, pesoG:900, nota:'Pesa, evaluar flete' },
    { nombre:'Vasos de vidrio con tapa y sorbete', q:'vaso vidrio tapa sorbete', costoMin:2.5, costoMax:7, pesoG:450, nota:'Fragil, pesa' },
    { nombre:'Escurridor de platos plegable', q:'escurridor platos plegable', costoMin:3, costoMax:9, pesoG:500, nota:'Volumen alto' },
    { nombre:'Set de sorbetes de acero con cepillo', q:'sorbetes acero set cepillo', costoMin:1, costoMax:3, pesoG:120, nota:'Micro ticket, packs' },
    { nombre:'Tapas de silicona ajustables universales', q:'tapas silicona ajustables set', costoMin:1.5, costoMax:4, pesoG:150, nota:'Tendencia, liviano' },
    { nombre:'Bandeja giratoria organizadora de mesa', q:'bandeja giratoria mesa organizadora', costoMin:3, costoMax:9, pesoG:600, nota:'Pesa' },
    { nombre:'Set de saleros y especieros de vidrio', q:'especiero set vidrio frascos', costoMin:3, costoMax:9, pesoG:700, nota:'Fragil, pesa' },
    { nombre:'Jarra medidora con escala doble', q:'jarra medidora escala cocina', costoMin:1.5, costoMax:4, pesoG:200, nota:'Ticket bajo' },
    { nombre:'Set de posavasos absorbentes', q:'posavasos absorbentes set', costoMin:1.5, costoMax:4, pesoG:200, nota:'Regalo, buen margen' },
    { nombre:'Mantel individual de PVC tejido', q:'mantel individual pvc tejido set', costoMin:2, costoMax:6, pesoG:300, nota:'Deco mesa' },
  ]},
  muebles: { label: 'Muebles', icon: '🪑', productos: [
    { nombre:'Mesa auxiliar plegable de notebook', q:'mesa plegable notebook cama', costoMin:6, costoMax:15, pesoG:1200, nota:'Pesa: flete puede matar el margen' },
    { nombre:'Banqueta plegable portatil', q:'banqueta plegable portatil', costoMin:5, costoMax:13, pesoG:1000, nota:'Pesa y ocupa' },
    { nombre:'Patas de mueble de repuesto set', q:'patas muebles repuesto set', costoMin:3, costoMax:9, pesoG:600, nota:'Nicho repuesto' },
    { nombre:'Estante flotante invisible set', q:'estante flotante invisible soporte', costoMin:3, costoMax:9, pesoG:500, nota:'Volumen' },
    { nombre:'Ruedas giratorias de repuesto para sillas', q:'ruedas silla oficina repuesto set', costoMin:3, costoMax:9, pesoG:400, nota:'Recompra, poco saturado' },
    { nombre:'Protectores de patas de silla de silicona', q:'protectores patas sillas silicona', costoMin:0.8, costoMax:2.5, pesoG:100, nota:'Micro ticket, packs' },
    { nombre:'Kit de anclaje antivuelco para muebles', q:'anclaje antivuelco muebles seguridad', costoMin:1.5, costoMax:4, pesoG:200, nota:'Seguridad infantil' },
    { nombre:'Perchero de pie plegable', q:'perchero pie plegable', costoMin:6, costoMax:15, pesoG:1500, nota:'Pesa mucho' },
    { nombre:'Soporte elevador de muebles set', q:'elevadores muebles patas set', costoMin:2.5, costoMax:7, pesoG:400, nota:'Nicho espacio' },
    { nombre:'Cojin de asiento ergonomico de gel', q:'almohadon ergonomico gel silla', costoMin:5, costoMax:13, pesoG:700, nota:'Volumen alto' },
    { nombre:'Bisagras de cierre suave para alacena', q:'bisagras cierre suave alacena', costoMin:2, costoMax:6, pesoG:300, nota:'Nicho carpinteria' },
    { nombre:'Manijas y tiradores de mueble set', q:'tiradores manijas muebles set', costoMin:2.5, costoMax:7, pesoG:400, nota:'Renovacion, buen margen' },
  ]},
  decoracion: { label: 'Decoración / Cuadros', icon: '🖼️', productos: [
    { nombre:'Tira LED con control y adhesivo', q:'tira led control adhesiva rgb', costoMin:2.5, costoMax:7, pesoG:250, nota:'Muy vendido, validar saturacion' },
    { nombre:'Marcos de foto colgantes set', q:'marcos fotos set colgante', costoMin:3, costoMax:9, pesoG:500, nota:'Fragil, volumen' },
    { nombre:'Vinilos decorativos de pared', q:'vinilo decorativo pared', costoMin:1.5, costoMax:4, pesoG:150, nota:'Liviano, alto margen' },
    { nombre:'Espejo decorativo hexagonal acrilico set', q:'espejos hexagonales acrilicos pared', costoMin:3, costoMax:9, pesoG:400, nota:'Volumen' },
    { nombre:'Cortina de luces LED tipo cascada', q:'cortina luces led cascada', costoMin:3, costoMax:9, pesoG:400, nota:'Estacional fiestas' },
    { nombre:'Reloj de pared silencioso minimalista', q:'reloj pared silencioso minimalista', costoMin:3, costoMax:9, pesoG:500, nota:'Fragil, volumen' },
    { nombre:'Macetas colgantes de macrame', q:'macetero colgante macrame', costoMin:1.5, costoMax:4, pesoG:150, nota:'Cruza con plantas' },
    { nombre:'Lampara de mesa de sal o silicona LED', q:'lampara mesa led decorativa recargable', costoMin:4, costoMax:11, pesoG:400, nota:'Ticket medio' },
    { nombre:'Set de canvas / laminas decorativas', q:'laminas decorativas cuadros set', costoMin:2, costoMax:6, pesoG:200, nota:'Se envia enrollado' },
    { nombre:'Proyector de luz de ambiente galaxia', q:'proyector luz galaxia ambiente', costoMin:6, costoMax:15, pesoG:500, nota:'Tendencia, ticket medio' },
    { nombre:'Guirnalda de fotos con clips y luces', q:'guirnalda fotos clips luces', costoMin:1.5, costoMax:4, pesoG:150, nota:'Regalo, liviano' },
    { nombre:'Panel decorativo hexagonal de pared', q:'paneles hexagonales decorativos pared', costoMin:4, costoMax:11, pesoG:600, nota:'Volumen alto' },
  ]},
  plantas: { label: 'Plantas / Suculentas', icon: '🪴', productos: [
    { nombre:'Set de herramientas de jardineria mini', q:'herramientas mini suculentas set', costoMin:1.5, costoMax:4, pesoG:200, nota:'Alto margen, liviano' },
    { nombre:'Macetas de ceramica chicas para suculentas', q:'macetas ceramica suculentas set', costoMin:3, costoMax:9, pesoG:700, nota:'Fragil y pesa' },
    { nombre:'Riego automatico por goteo con temporizador', q:'riego automatico goteo temporizador', costoMin:6, costoMax:15, pesoG:500, nota:'Ticket alto' },
    { nombre:'Medidor 3 en 1 de luz, pH y humedad', q:'medidor 3 en 1 plantas', costoMin:2, costoMax:6, pesoG:150, nota:'Liviano, buen margen' },
    { nombre:'Bulbos de riego autoregulable de vidrio', q:'bulbos riego plantas vidrio', costoMin:1.5, costoMax:4, pesoG:200, nota:'Fragil' },
    { nombre:'Soporte de pared para macetas', q:'soporte pared macetas colgante', costoMin:3, costoMax:9, pesoG:500, nota:'Volumen' },
    { nombre:'Lampara LED de crecimiento full spectrum', q:'lampara led crecimiento plantas', costoMin:5, costoMax:13, pesoG:350, nota:'Nicho indoor' },
    { nombre:'Tutores de musgo para plantas trepadoras', q:'tutor musgo planta trepadora', costoMin:2.5, costoMax:7, pesoG:400, nota:'Tendencia monstera' },
    { nombre:'Etiquetas plasticas para plantas pack', q:'etiquetas plantas plastico pack', costoMin:0.5, costoMax:1.8, pesoG:80, nota:'Micro ticket' },
    { nombre:'Pulverizador de niebla fina decorativo', q:'pulverizador plantas niebla decorativo', costoMin:2, costoMax:6, pesoG:250, nota:'Buen margen percibido' },
    { nombre:'Bandeja de propagacion con vasos de vidrio', q:'propagador plantas vidrio bandeja', costoMin:3, costoMax:9, pesoG:600, nota:'Fragil, pesa' },
    { nombre:'Tijera de podar de precision', q:'tijera podar precision bonsai', costoMin:2, costoMax:6, pesoG:150, nota:'Nicho bonsai' },
  ]},
  mate: { label: 'Mate / Termos', icon: '🧉', productos: [
    { nombre:'Bombilla de acero desarmable', q:'bombilla acero desarmable mate', costoMin:1.5, costoMax:4, pesoG:60, nota:'Recompra, liviano' },
    { nombre:'Matera / bolso porta equipo de mate', q:'matera bolso porta termo', costoMin:5, costoMax:13, pesoG:500, nota:'Volumen, muy argentino' },
    { nombre:'Yerbera y azucarera set', q:'yerbera azucarera set', costoMin:2.5, costoMax:7, pesoG:300, nota:'Regalo' },
    { nombre:'Termo de acero inoxidable 1L', q:'termo acero inoxidable 1 litro', costoMin:8, costoMax:20, pesoG:800, nota:'Pesa: evaluar flete' },
    { nombre:'Mate de acero con recubrimiento', q:'mate acero inoxidable', costoMin:3, costoMax:9, pesoG:250, nota:'Alta demanda local' },
    { nombre:'Base y posamate antideslizante', q:'posa mate base antideslizante', costoMin:1, costoMax:3, pesoG:100, nota:'Micro ticket' },
    { nombre:'Cepillo limpiador de bombilla', q:'cepillo limpiar bombilla mate', costoMin:0.5, costoMax:1.5, pesoG:30, nota:'Micro ticket, packs' },
    { nombre:'Funda termica para termo', q:'funda termica termo neoprene', costoMin:2, costoMax:6, pesoG:200, nota:'Complemento' },
    { nombre:'Tapa cebadora para termo', q:'tapa cebadora termo pico', costoMin:1.5, costoMax:4, pesoG:100, nota:'Repuesto, poco saturado' },
    { nombre:'Mate de vidrio con funda de silicona', q:'mate vidrio funda silicona', costoMin:2.5, costoMax:7, pesoG:300, nota:'Fragil' },
    { nombre:'Set de mate completo en caja regalo', q:'set mate completo caja regalo', costoMin:8, costoMax:20, pesoG:900, nota:'Ticket alto, pesa' },
    { nombre:'Filtro de bombilla de repuesto', q:'filtro bombilla mate repuesto', costoMin:0.4, costoMax:1.5, pesoG:20, nota:'Micro ticket, recompra' },
  ]},
  fitness: { label: 'Running / Fitness', icon: '🏃', productos: [
    { nombre:'Rinonera deportiva ajustable para correr', q:'rinonera deportiva correr ajustable', costoMin:2, costoMax:6, pesoG:150, nota:'Liviano, buen margen' },
    { nombre:'Brazalete porta celular para correr', q:'brazalete celular correr deportivo', costoMin:1.5, costoMax:4, pesoG:80, nota:'Recompra' },
    { nombre:'Soga de saltar con rulemanes y contador', q:'soga saltar rulemanes contador', costoMin:2, costoMax:6, pesoG:250, nota:'Evergreen' },
    { nombre:'Guantes de gym con muneca reforzada', q:'guantes gym muneca reforzada', costoMin:2.5, costoMax:7, pesoG:150, nota:'Talles simples' },
    { nombre:'Muneequeras y tobilleras con peso', q:'tobilleras con peso ajustables', costoMin:5, costoMax:13, pesoG:1200, nota:'Pesa mucho: flete' },
    { nombre:'Banda de resistencia con anclaje de puerta', q:'banda resistencia anclaje puerta', costoMin:3, costoMax:9, pesoG:300, nota:'Entrenamiento en casa' },
    { nombre:'Chaleco reflectivo para correr de noche', q:'chaleco reflectivo correr noche', costoMin:1.5, costoMax:4, pesoG:120, nota:'Seguridad, liviano' },
    { nombre:'Cinturon de hidratacion con botellas', q:'cinturon hidratacion running botellas', costoMin:4, costoMax:11, pesoG:300, nota:'Nicho running' },
    { nombre:'Pesas de mano de neoprene par', q:'mancuernas neoprene par', costoMin:6, costoMax:15, pesoG:2000, nota:'Pesa mucho: flete mata margen' },
    { nombre:'Rodillera deportiva de compresion', q:'rodillera compresion deportiva', costoMin:2, costoMax:6, pesoG:120, nota:'Talles, recompra' },
    { nombre:'Cronometro deportivo digital', q:'cronometro deportivo digital', costoMin:2.5, costoMax:7, pesoG:80, nota:'Nicho entrenadores' },
    { nombre:'Toalla deportiva de secado rapido', q:'toalla deportiva secado rapido microfibra', costoMin:2, costoMax:6, pesoG:200, nota:'Recompra' },
  ]},
  natacion: { label: 'Natación / Pileta', icon: '🏊', productos: [
    { nombre:'Antiparras de natacion antiempanante', q:'antiparras natacion antiempanante', costoMin:2, costoMax:6, pesoG:100, nota:'Estacional fuerte, liviano' },
    { nombre:'Gorra de silicona para natacion', q:'gorra natacion silicona', costoMin:1, costoMax:3, pesoG:70, nota:'Recompra' },
    { nombre:'Tapones de oido y nariz set', q:'tapones oidos nariz natacion set', costoMin:0.6, costoMax:2, pesoG:40, nota:'Micro ticket, packs' },
    { nombre:'Tabla de flotacion de entrenamiento', q:'tabla natacion entrenamiento flotacion', costoMin:3, costoMax:9, pesoG:400, nota:'Volumen alto' },
    { nombre:'Bolso impermeable seco para pileta', q:'bolso seco impermeable playa', costoMin:3, costoMax:9, pesoG:250, nota:'Estacional verano' },
    { nombre:'Manoplas de entrenamiento (paddles)', q:'paletas natacion entrenamiento paddles', costoMin:3, costoMax:9, pesoG:250, nota:'Nicho nadadores' },
    { nombre:'Termometro flotante para pileta', q:'termometro flotante pileta', costoMin:1.5, costoMax:4, pesoG:120, nota:'Estacional' },
    { nombre:'Set de juguetes de buceo para pileta', q:'juguetes buceo pileta set', costoMin:2, costoMax:6, pesoG:250, nota:'Cruza con juguetes' },
    { nombre:'Red recogedora de hojas para pileta', q:'red recogedora hojas pileta', costoMin:3, costoMax:9, pesoG:400, nota:'Largo: revisar flete' },
    { nombre:'Test de cloro y pH en tiras', q:'tiras test cloro ph pileta', costoMin:2, costoMax:6, pesoG:80, nota:'Recompra estacional' },
    { nombre:'Inflador electrico para inflables', q:'inflador electrico inflables pileta', costoMin:5, costoMax:13, pesoG:500, nota:'Estacional, ticket medio' },
    { nombre:'Reposera / flotador inflable individual', q:'flotador inflable individual pileta', costoMin:4, costoMax:11, pesoG:600, nota:'Volumen muy alto' },
  ]},
  golf: { label: 'Golf', icon: '⛳', productos: [
    { nombre:'Set de tees de golf de bambu', q:'tees golf set bambu', costoMin:1, costoMax:3, pesoG:120, nota:'Recompra pura' },
    { nombre:'Marcador de bola magnetico con clip', q:'marcador bola golf magnetico clip', costoMin:1, costoMax:3, pesoG:40, nota:'Micro ticket, regalo' },
    { nombre:'Alfombra de practica de putting', q:'alfombra practica putting golf', costoMin:8, costoMax:20, pesoG:1500, nota:'Pesa: evaluar flete' },
    { nombre:'Red plegable de practica de swing', q:'red practica golf plegable', costoMin:10, costoMax:24, pesoG:1800, nota:'Volumen y peso altos' },
    { nombre:'Fundas de palos de golf set', q:'fundas palos golf set', costoMin:4, costoMax:11, pesoG:300, nota:'Buen margen' },
    { nombre:'Toalla de golf con mosqueton', q:'toalla golf mosqueton microfibra', costoMin:2, costoMax:6, pesoG:150, nota:'Complemento' },
    { nombre:'Telemetro laser de golf', q:'telemetro laser golf', costoMin:35, costoMax:80, pesoG:300, nota:'Ticket muy alto, riesgo' },
    { nombre:'Contador de golpes de muneca', q:'contador golpes golf muneca', costoMin:1.5, costoMax:4, pesoG:50, nota:'Nicho, liviano' },
    { nombre:'Limpiador de ranuras de palos', q:'limpiador ranuras palos golf', costoMin:1.5, costoMax:4, pesoG:80, nota:'Micro ticket' },
    { nombre:'Guante de golf sintetico', q:'guante golf sintetico', costoMin:2.5, costoMax:7, pesoG:60, nota:'Talles, recompra' },
    { nombre:'Bolsa de bolas de practica', q:'bolsa bolas practica golf', costoMin:3, costoMax:9, pesoG:400, nota:'Complemento' },
    { nombre:'Grips de repuesto para palos', q:'grips repuesto palos golf', costoMin:3, costoMax:9, pesoG:250, nota:'Recompra tecnica' },
  ]},
  festejos: { label: 'Cotillón / Fiestas', icon: '🎉', productos: [
    { nombre:'Arco de globos kit con cinta', q:'kit arco globos cinta', costoMin:2, costoMax:6, pesoG:250, nota:'Liviano, alto margen' },
    { nombre:'Velas numericas de cumpleanos', q:'velas numero cumpleanos', costoMin:0.5, costoMax:1.8, pesoG:50, nota:'Micro ticket, recompra' },
    { nombre:'Maquina de burbujas para fiestas', q:'maquina burbujas fiesta', costoMin:6, costoMax:15, pesoG:700, nota:'Ticket alto, pesa' },
    { nombre:'Set de accesorios para photobooth', q:'accesorios photobooth set fiesta', costoMin:1.5, costoMax:4, pesoG:150, nota:'Liviano, alto margen' },
    { nombre:'Globos de latex metalizados pack', q:'globos latex metalizados pack', costoMin:1, costoMax:3, pesoG:150, nota:'Recompra pura' },
    { nombre:'Banderin personalizable de cumpleanos', q:'banderin cumpleanos personalizable', costoMin:1, costoMax:3, pesoG:80, nota:'Liviano' },
    { nombre:'Luces LED de fiesta con control', q:'luz led fiesta control rgb', costoMin:5, costoMax:13, pesoG:500, nota:'Ticket medio' },
    { nombre:'Cotillon de anteojos y vinchas pack', q:'cotillon anteojos vinchas pack', costoMin:2, costoMax:6, pesoG:250, nota:'Volumen' },
    { nombre:'Pinata para armar con relleno', q:'pinata cumpleanos armar', costoMin:3, costoMax:9, pesoG:400, nota:'Volumen muy alto' },
    { nombre:'Canon de papel picado y serpentina', q:'canon papel picado serpentina', costoMin:1.5, costoMax:4, pesoG:200, nota:'Presurizado: revisar courier' },
    { nombre:'Globos de aluminio con forma de numero', q:'globo numero aluminio grande', costoMin:1, costoMax:3, pesoG:60, nota:'Se envia desinflado, liviano' },
    { nombre:'Mantel y set descartable tematico', q:'set descartable tematico cumpleanos', costoMin:2.5, costoMax:7, pesoG:300, nota:'Recompra estacional' },
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

async function meliSearch(query, token, costoTope){
  if(!token) return null;
  try{
    // Misma cadena que usa el analizador: catalogo -> destacados -> listado
    // publico + /items?ids=. Antes esto tenia su propia copia contra
    // /products/{id}/items, que hoy devuelve 404, asi que el recomendador
    // mostraba todo como estimado aun con la cuenta conectada.
    const r = await buscarPublicaciones(query, token, { budgetMs: 5000, maxIds: 25 });
    if(!r || !r.results || !r.results.length) return null;

    const precios = r.results.map(function(x){ return x.price; })
      .filter(function(p){ return typeof p === 'number' && p > 0; });
    if(!precios.length) return null;

    const vendedores = new Set(r.results.map(function(x){ return x.seller && x.seller.id; }).filter(Boolean));
    const total = (typeof r.total === 'number' && r.total > 0) ? r.total : null;

    // Tope objetivo por producto: descartar precios que superen 5x el costo puesto
    // (un margen bruto > 400% casi siempre indica que el precio no corresponde al producto real)
    let preciosAcotados = precios;
    if(costoTope && costoTope > 0){
      const max = costoTope * 5;
      const min = costoTope * 1.3;
      // Si tras aplicar tope+piso no queda ningun precio valido, devolvemos vacio a proposito:
      // la muestra no es confiable y el caller usara el precio estimado en vez de un precio real por debajo del costo.
      preciosAcotados = precios.filter(function(p){ return p <= max && p >= min; });
    }
    // Filtrar outliers (packs/premium) sobre el conjunto acotado
    const preciosFiltrados = _filtrarOutliers(preciosAcotados);
    return { precios: preciosFiltrados, sellers: vendedores.size || r.results.length, total: total };
  }catch(e){ return null; }
}

// Filtro de outliers por rango intercuartil (IQR): recorta precios atipicos altos y bajos
function _filtrarOutliers(arr){
  const nums = (arr||[]).filter(function(x){ return typeof x === 'number' && isFinite(x) && x > 0; }).sort(function(a,b){ return a-b; });
  if(nums.length < 4) return nums;
  function pct(p){ const idx=(nums.length-1)*p, lo=Math.floor(idx), hi=Math.ceil(idx); return lo===hi ? nums[lo] : nums[lo]+(nums[hi]-nums[lo])*(idx-lo); }
  const q1 = pct(0.25), q3 = pct(0.75), iqr = q3 - q1;
  const min = Math.max(0, q1 - 1.5*iqr), max = q3 + 1.5*iqr;
  const filt = nums.filter(function(x){ return x >= min && x <= max; });
  return filt.length ? filt : nums;
}

function _median(arr){ if(!arr.length) return null; const s=[...arr].sort((a,b)=>a-b), m=Math.floor(s.length/2); return s.length%2 ? s[m] : Math.round((s[m-1]+s[m])/2); }
// Mediana robusta: descarta outliers (kits/packs) antes de promediar. Usa mediana + MAD.
function _medianRobusto(arr){
  const nums = (arr||[]).filter(function(x){ return typeof x==='number' && isFinite(x) && x>0; });
  if(!nums.length) return null;
  if(nums.length < 4) return _median(nums);
  const s = [...nums].sort(function(a,b){ return a-b; });
  const med = _median(s);
  // desviacion absoluta mediana (MAD)
  const desv = s.map(function(x){ return Math.abs(x-med); }).sort(function(a,b){ return a-b; });
  const mad = _median(desv) || 0;
  let filtrados;
  if(mad > 0){
    // conservar valores dentro de ~3.5 MAD de la mediana
    filtrados = s.filter(function(x){ return Math.abs(x-med) <= 3.5 * mad; });
  } else {
    // si MAD=0 (muchos precios iguales), descartar los que superan 3x la mediana
    filtrados = s.filter(function(x){ return x <= med * 3; });
  }
  if(!filtrados.length) filtrados = s;
  return _median(filtrados);
}
function _nivel(v){ return v>=70?'Alta':v>=45?'Media':'Baja'; }
function _score(o){
  var precioVenta=o.precioVenta, total=o.total, costoPuestoARS=o.costoPuestoARS, pesoG=o.pesoG;
  const margenPct = costoPuestoARS>0 ? Math.round(((precioVenta - costoPuestoARS)/costoPuestoARS)*100) : null;
  let satScore, satLabel;
  if(total < 2000){ satScore=90; satLabel='Baja'; } else if(total < 5000){ satScore=65; satLabel='Media'; }
  else if(total < 9000){ satScore=38; satLabel='Alta'; } else { satScore=8; satLabel='Muy alta'; }
  const demScore = total>3000?55 : total>800?70 : total>150?55 : 35;
  let margScore = 40;
  if(margenPct!==null){ margScore = margenPct>=250?95 : margenPct>=150?85 : margenPct>=100?72 : margenPct>=60?55 : margenPct>=30?40 : 20; }
  const pesoScore = pesoG<=150?95 : pesoG<=300?80 : pesoG<=500?60 : 40;
  const score = Math.round(margScore*0.35 + satScore*0.40 + demScore*0.15 + pesoScore*0.10); let _satAdj=score; if(total>=6000)_satAdj=score-25; else if(total>=1500)_satAdj=score-10; else if(total<150)_satAdj=score+8; const scoreFinal=Math.max(0,Math.min(100,_satAdj));
  const riesgo = (satScore>=65 && margScore>=72) ? 'Bajo' : (satScore>=40 && margScore>=55) ? 'Medio' : 'Alto';
  return { margenPct: margenPct, satLabel: satLabel, demScore: demScore, score: scoreFinal, riesgo: riesgo };
}

// ProductFinder IA - API Handler
// Handles /api/auth, /api/analyze, /api/chat

export default async function handler(req, res) {
  const url = req.url || '';
  const path = url.split('?')[0];

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // AUTH ENDPOINT
  if (path.endsWith('/auth')) {
    if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});
    const { username, password } = req.body;
    const validUser = process.env.APP_USER;
    const validPass = process.env.APP_PASS;
    if (!validUser || !validPass) return res.status(500).json({success:false,error:'Servidor mal configurado'});
  if (username === validUser && password === validPass) {
      return res.status(200).json({success: true, user: username});
    }
    return res.status(401).json({success: false, error: 'Credenciales incorrectas'});
  }

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
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    const nichos = listarNichos();
    return res.status(200).json({ nichos: nichos, total: nichos.length, porDefecto: NICHO_POR_DEFECTO });
  }

  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});
  try {
    const { nicho, capital, experiencia, canal, riesgo, user_id } = req.body || {};
    const resuelto = resolverNicho(nicho);
    const nichoKey = resuelto.key;
    const niche = CATALOGO[nichoKey];

    let usdArs = parseFloat(process.env.USD_ARS) || USD_ARS_FALLBACK;
    try {
      const _dr = await fetch('https://dolarapi.com/v1/dolares/tarjeta');
      if (_dr.ok) { const _dj = await _dr.json(); if (_dj && _dj.venta) usdArs = _dj.venta; }
    } catch (_e) { /* si falla la API de dolar, se usa el fallback */ }
    const tk = await getMeliToken(user_id);
    const token = tk && tk.token ? tk.token : null;
    const tokenExpired = tk && tk.expired ? true : false;

    const productos = [];
    const lista = niche.productos;
    for (let i=0; i<lista.length; i+=5) {
      const batch = lista.slice(i, i+5);
      const evals = await Promise.all(batch.map(async (prod) => {
        const costoUnitUSD = (prod.costoMin + prod.costoMax)/2;
        const costoUnitARS = Math.round(costoUnitUSD * usdArs);
        const costoPuestoARS = Math.round(costoUnitARS * 2.75); // x2.5-3.0: estimado gastos de envio/importacion (varia segun producto, impuestos, peso y volumen)
        const data = await meliSearch(prod.q, token, costoPuestoARS);
        function _satFromTotal(t){ if(t==null) return null; if(t < 2000) return 'Baja'; if(t < 5000) return 'Media'; if(t < 9000) return 'Alta'; return 'Muy alta'; }
        if (data && data.precios.length && data.total == null) {
          // Precio real pero sin total de publicaciones: MercadoLibre no lo
          // expone por todas las vias. Antes se caia en data.precios.length y
          // una muestra de 12 precios se reportaba como "saturacion Baja".
          const precioVenta = _medianRobusto(data.precios);
          const margen = costoPuestoARS > 0 ? Math.round(((precioVenta - costoPuestoARS)/costoPuestoARS)*100) : null;
          return { nombre: prod.nombre, query: prod.q, nota: prod.nota, pesoG: prod.pesoG,
            fuente: 'MercadoLibre (precio real, sin competencia)', precioVentaARS: precioVenta, sellers: data.sellers,
            totalResultados: null, competencia: null, costoEstimadoUSD: [prod.costoMin, prod.costoMax], costoPuestoARS: costoPuestoARS,
            margen: margen, demanda: 'A validar', saturacion: 'A validar', riesgo: 'A validar', score: null };
        }
        if (data && data.precios.length) {
          const precioVenta = _medianRobusto(data.precios);
          const total = data.total;
          const s = _score({ precioVenta: precioVenta, total: total, costoPuestoARS: costoPuestoARS, pesoG: prod.pesoG });
          return { nombre: prod.nombre, query: prod.q, nota: prod.nota, pesoG: prod.pesoG,
            fuente: 'MercadoLibre (real)', precioVentaARS: precioVenta, sellers: data.sellers,
            totalResultados: total, competencia: total, costoEstimadoUSD: [prod.costoMin, prod.costoMax], costoPuestoARS: costoPuestoARS,
            margen: s.margenPct, demanda: _nivel(s.demScore), saturacion: _satFromTotal(total) || s.satLabel, riesgo: s.riesgo, score: s.score };
        }
        if (data && data.total != null) {
          const total = data.total;
          const sat = _satFromTotal(total);
          const riesgo = total >= 6000 ? 'Alto' : (total >= 1500 ? 'Medio' : 'Bajo');
          let sc = 0; if(total < 300) sc += 45; else if(total < 1500) sc += 30; else if(total < 6000) sc += 12;
          if(prod.pesoG && prod.pesoG <= 100) sc += 25; else if(prod.pesoG && prod.pesoG <= 300) sc += 12;
          sc += 20;
          const precioEstimado = Math.round(costoPuestoARS * 2.2);
          const sEst = _score({ precioVenta: precioEstimado, total: total, costoPuestoARS: costoPuestoARS, pesoG: prod.pesoG });
          return { nombre: prod.nombre, query: prod.q, nota: prod.nota, pesoG: prod.pesoG,
            fuente: 'MercadoLibre (precio estimado)', precioVentaARS: precioEstimado, sellers: data.sellers,
            totalResultados: total, competencia: total, costoEstimadoUSD: [prod.costoMin, prod.costoMax], costoPuestoARS: costoPuestoARS,
            margen: sEst.margenPct, demanda: _nivel(sEst.demScore), saturacion: sat, riesgo: riesgo, score: sc };
        }
        return { nombre: prod.nombre, query: prod.q, nota: prod.nota, pesoG: prod.pesoG,
          fuente: 'Estimado', precioVentaARS: null, sellers: null, totalResultados: null, competencia: null,
          costoEstimadoUSD: [prod.costoMin, prod.costoMax], costoPuestoARS: costoPuestoARS,
          margen: null, demanda: 'A validar', saturacion: 'A validar', riesgo: 'A validar', score: null };
      }));
      productos.push.apply(productos, evals);
    }

    let filtrados = productos;
    filtrados = productos.slice();
    filtrados.sort(function(a,b){ const ad=a.score!=null, bd=b.score!=null; if(ad!==bd) return ad?-1:1; return (b.score||0)-(a.score||0); });
    if (filtrados.length && filtrados[0].score!=null) filtrados[0].topPick = true;

    const conDato = productos.filter(function(p){ return p.score!=null; }).length;
    return res.status(200).json({
      nicho: nichoKey, nichoLabel: niche.label, icon: niche.icon, usdArs: usdArs,
      nichoSolicitado: nicho || null, nichoAproximado: !resuelto.exacto,
      totalEvaluados: productos.length, conDatoReal: conDato,
      meliConectado: !!token, meliTokenExpirado: tokenExpired,
      products: filtrados,
      disclaimer: 'Precios y competencia: datos REALES de la API de MercadoLibre (requiere tu cuenta de ML conectada). Los gastos de envio/importacion son ESTIMADOS (dolar en vivo x2,75) y pueden variar segun el producto, los impuestos, el peso y el volumen. El costo puesto es aproximado, no un valor cerrado.'
    });
  } catch(err) {
    return res.status(500).json({error: 'Error interno del servidor', detail: err.message});
  }
}
