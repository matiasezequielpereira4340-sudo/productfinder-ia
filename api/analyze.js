// ============================================================
// ProductFinder IA - /api/analyze (v2 datos reales de MercadoLibre)
// AUTH y CHAT se mantienen intactos. El bloque ANALYZE ahora
// recomienda productos del catalogo curado y trae precios y
// competencia REALES desde la API oficial de MeLi (token OAuth
// del usuario en Supabase). Si no hay token vigente, marca los
// datos como estimados y nunca inventa precios reales.
// ============================================================

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
};

async function getMeliToken(userId){
  if(!SUPA_KEY || !userId) return null;
  try{
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
      const appId = process.env.MELI_APP_ID;
      const secret = process.env.MELI_SECRET_KEY;
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
    // Catalogo de MercadoLibre (endpoint que funciona con el token OAuth estandar)
    const url = 'https://api.mercadolibre.com/products/search?status=active&site_id=MLA&limit=10&q=' + encodeURIComponent(query);
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if(!r.ok) return null;
    const j = await r.json();
    if(!j.results || !j.results.length) return null;
    const total = (j.paging && j.paging.total) || j.results.length;
    const precios = [];
    // Tomar hasta 10 productos del catalogo para tener mas muestra
    const ids = j.results.slice(0, 10).map(function(x){
      return (typeof x === 'string') ? x : (x && (x.id || x.catalog_product_id || x.product_id));
    }).filter(Boolean);
    for(const id of ids){
      try{
        // 1) buy_box_winner del producto de catalogo
        const pr = await fetch('https://api.mercadolibre.com/products/' + id, { headers: { Authorization: 'Bearer ' + token } });
        let p = null;
        if(pr.ok){
          const pj = await pr.json();
          if(pj && pj.buy_box_winner && typeof pj.buy_box_winner.price === 'number' && pj.buy_box_winner.price > 0) p = pj.buy_box_winner.price;
        }
        // 2) si no hay buy box, tomar precios de los items reales de ese producto
        if(!p){
          const ir = await fetch('https://api.mercadolibre.com/products/' + id + '/items', { headers: { Authorization: 'Bearer ' + token } });
          if(ir.ok){
            const ij = await ir.json();
            const items = (ij && Array.isArray(ij.results)) ? ij.results : [];
            const itemPrices = items.map(function(it){ return (it && typeof it.price === 'number' && it.price > 0) ? it.price : null; }).filter(Boolean);
            if(itemPrices.length) p = _medianRobusto(itemPrices);
          }
        }
        if(p && p > 0) precios.push(p);
      }catch(_){/* seguir */}
    }
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
    return { precios: preciosFiltrados, sellers: j.results.length, total: total };
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // AUTH ENDPOINT
  if (path.endsWith('/auth')) {
    if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});
    const { username, password } = req.body;
    const validUser = process.env.APP_USER || 'matypereira';
    const validPass = process.env.APP_PASS || 'maty123';
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
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
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
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});
  try {
    const { nicho, capital, experiencia, canal, riesgo, user_id } = req.body || {};
    if (!nicho) return res.status(400).json({error: 'Falta elegir un nicho / seccion'});
    const niche = CATALOGO[nicho] || CATALOGO[String(nicho).toLowerCase()];
    if (!niche) return res.status(400).json({error: 'Nicho no encontrado', nichosDisponibles: Object.keys(CATALOGO)});

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
        if (data && data.precios.length) {
          const precioVenta = _medianRobusto(data.precios);
          const total = data.total || data.precios.length;
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
      nicho: nicho, nichoLabel: niche.label, icon: niche.icon, usdArs: usdArs,
      totalEvaluados: productos.length, conDatoReal: conDato,
      meliConectado: !!token, meliTokenExpirado: tokenExpired,
      products: filtrados,
      disclaimer: 'Precios y competencia: datos REALES de la API de MercadoLibre (requiere tu cuenta de ML conectada). Los gastos de envio/importacion son ESTIMADOS (dolar en vivo x2,75) y pueden variar segun el producto, los impuestos, el peso y el volumen. El costo puesto es aproximado, no un valor cerrado.'
    });
  } catch(err) {
    return res.status(500).json({error: 'Error interno del servidor', detail: err.message});
  }
}
