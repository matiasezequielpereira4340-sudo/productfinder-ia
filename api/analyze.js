// ============================================================
// ProductFinder IA - /api/analyze (v2 datos reales de MercadoLibre)
// AUTH y CHAT se mantienen intactos. El bloque ANALYZE ahora
// recomienda productos del catalogo curado y trae precios y
// competencia REALES desde la API oficial de MeLi (token OAuth
// del usuario en Supabase). Si no hay token vigente, marca los
// datos como estimados y nunca inventa precios reales.
// ============================================================

const USD_ARS_FALLBACK = 1350;
const SUPA_URL = process.env.SUPABASE_URL || 'https://qglieqpcmmffgxijbysb.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const CATALOGO = {
  tecnologia: { label: 'Tecnología / Gadgets', icon: '💻', productos: [
    { nombre:'Organizador de cables magnético para escritorio', q:'organizador cables escritorio', costoMin:0.3, costoMax:0.9, pesoG:40, nota:'Consumible, recompra alta' },
    { nombre:'Soporte plegable para celular de aluminio', q:'soporte celular aluminio plegable', costoMin:0.8, costoMax:2, pesoG:90, nota:'Liviano, no frágil' },
    { nombre:'Adaptador OTG USB-C a USB', q:'adaptador otg usb c', costoMin:0.4, costoMax:1, pesoG:15, nota:'Diminuto, alto margen' },
    { nombre:'Aro de luz para celular con clip (mini)', q:'aro luz celular clip', costoMin:1.2, costoMax:3, pesoG:60, nota:'Tendencia contenido' },
    { nombre:'Soporte de auriculares para escritorio', q:'soporte auriculares escritorio', costoMin:1.5, costoMax:3.5, pesoG:120, nota:'Gamer / oficina' },
    { nombre:'Grip anillo adhesivo para celular', q:'popsocket soporte anillo celular', costoMin:0.2, costoMax:0.7, pesoG:20, nota:'Barato, recompra' },
    { nombre:'Kit limpiador de pantalla reutilizable', q:'kit limpieza pantalla notebook', costoMin:0.6, costoMax:1.5, pesoG:80, nota:'Consumible' },
    { nombre:'Hub USB 3.0 4 puertos ultrafino', q:'hub usb 3.0 4 puertos', costoMin:2, costoMax:4.5, pesoG:60, nota:'Alta demanda home office' },
    { nombre:'Soporte notebook plegable de aluminio', q:'soporte notebook aluminio plegable', costoMin:3, costoMax:7, pesoG:300, nota:'Ergonomía' },
    { nombre:'Mouse pad XL antideslizante', q:'mousepad gamer xl', costoMin:1, costoMax:3, pesoG:250, nota:'Liviano' },
    { nombre:'Espiral organizador de cables (pack)', q:'espiral organizador cables', costoMin:0.3, costoMax:1, pesoG:50, nota:'Consumible' },
    { nombre:'Adaptador universal de viaje', q:'adaptador viaje universal enchufe', costoMin:1.5, costoMax:4, pesoG:120, nota:'Turismo en alza' },
  ]},
  hogar: { label: 'Hogar y Deco', icon: '🏠', productos: [
    { nombre:'Dispensador automático de pasta dental', q:'dispensador pasta dental automatico', costoMin:1, costoMax:2.5, pesoG:150, nota:'Novedad baño' },
    { nombre:'Organizador de cajones modular (set)', q:'organizador cajones modular set', costoMin:1.5, costoMax:4, pesoG:200, nota:'Recompra' },
    { nombre:'Ganchos adhesivos de pared (pack 10)', q:'ganchos adhesivos pared pack', costoMin:0.5, costoMax:1.5, pesoG:100, nota:'Consumible barato' },
    { nombre:'Tira LED USB para ambiente (2m)', q:'tira led usb ambiente', costoMin:0.8, costoMax:2.5, pesoG:80, nota:'Deco tendencia' },
    { nombre:'Rociador presurizado para plantas', q:'rociador presion plantas', costoMin:1.5, costoMax:3.5, pesoG:180, nota:'Jardín interior' },
    { nombre:'Bolsas al vacío para ropa (set)', q:'bolsas vacio ropa', costoMin:1, costoMax:3, pesoG:150, nota:'Ahorro espacio' },
    { nombre:'Organizador colgante de zapatos', q:'organizador zapatos colgante puerta', costoMin:2, costoMax:4.5, pesoG:300, nota:'Textil liviano' },
    { nombre:'Difusor de aromas mini USB', q:'difusor aromas usb mini', costoMin:1.5, costoMax:4, pesoG:150, nota:'Deco + bienestar' },
    { nombre:'Cortina separadora decorativa', q:'cortina separador ambiente decorativa', costoMin:2, costoMax:5, pesoG:350, nota:'Deco' },
    { nombre:'Set de utensilios de silicona', q:'utensilios silicona cocina set', costoMin:2, costoMax:5, pesoG:400, nota:'No frágil' },
    { nombre:'Reloj de pared digital LED', q:'reloj pared led digital', costoMin:2.5, costoMax:6, pesoG:300, nota:'Deco' },
    { nombre:'Organizador de cosméticos giratorio', q:'organizador cosmeticos giratorio', costoMin:2, costoMax:5, pesoG:350, nota:'Público femenino' },
  ]},
  deportes: { label: 'Deportes / Fitness', icon: '🏋️', productos: [
    { nombre:'Bandas elásticas de resistencia (set 5)', q:'bandas elasticas resistencia set', costoMin:1.5, costoMax:4, pesoG:250, nota:'Fitness casero' },
    { nombre:'Rueda abdominal doble', q:'rueda abdominal ejercicio', costoMin:1.5, costoMax:3.5, pesoG:300, nota:'No frágil' },
    { nombre:'Cuerda para saltar con contador', q:'soga saltar contador digital', costoMin:1, costoMax:3, pesoG:150, nota:'Liviano' },
    { nombre:'Guantes de gimnasio antideslizantes', q:'guantes gimnasio', costoMin:1, costoMax:3, pesoG:120, nota:'Recompra' },
    { nombre:'Botella deportiva motivacional 2L', q:'botella agua 2 litros motivacional', costoMin:1.5, costoMax:4, pesoG:200, nota:'Tendencia' },
    { nombre:'Rodillo masajeador muscular', q:'rodillo masajeador muscular', costoMin:2, costoMax:5, pesoG:350, nota:'Recuperación' },
    { nombre:'Tobilleras con peso ajustable', q:'tobilleras peso ejercicio', costoMin:2.5, costoMax:6, pesoG:500, nota:'Peso ok' },
    { nombre:'Fortalecedor de mano ajustable', q:'fortalecedor mano grip', costoMin:0.8, costoMax:2.5, pesoG:100, nota:'Chico' },
    { nombre:'Cinta kinesiológica deportiva', q:'cinta kinesiologica deportiva', costoMin:1, costoMax:3, pesoG:80, nota:'Consumible' },
    { nombre:'Riñonera deportiva para running', q:'riñonera running deportiva', costoMin:1.5, costoMax:4, pesoG:120, nota:'Textil liviano' },
    { nombre:'Discos deslizantes para core', q:'sliders discos ejercicio core', costoMin:1, costoMax:3, pesoG:150, nota:'Chico' },
    { nombre:'Toalla de microfibra deportiva', q:'toalla microfibra deportiva', costoMin:1.5, costoMax:4, pesoG:200, nota:'Recompra' },
  ]},
  moda: { label: 'Moda / Indumentaria', icon: '👕', productos: [
    { nombre:'Lentes de sol polarizados', q:'lentes sol polarizados', costoMin:1.5, costoMax:4, pesoG:60, nota:'Alto margen' },
    { nombre:'Riñonera urbana de tela', q:'riñonera urbana tela', costoMin:2, costoMax:5, pesoG:200, nota:'Tendencia' },
    { nombre:'Medias antideslizantes pilates (pack)', q:'medias antideslizantes pilates', costoMin:1, costoMax:3, pesoG:100, nota:'Recompra' },
    { nombre:'Cinturón elástico sin hebilla', q:'cinturon elastico sin hebilla', costoMin:1, costoMax:3, pesoG:120, nota:'Liviano' },
    { nombre:'Gorra trucker ajustable', q:'gorra trucker', costoMin:1.5, costoMax:4, pesoG:100, nota:'Alto margen' },
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
    { nombre:'Pelota de goma resistente', q:'pelota goma resistente perro', costoMin:1, costoMax:3, pesoG:150, nota:'No frágil' },
    { nombre:'Collar LED recargable de seguridad', q:'collar led perro recargable', costoMin:1.5, costoMax:4, pesoG:80, nota:'Seguridad' },
    { nombre:'Bolsas biodegradables para heces', q:'bolsas caca perro biodegradables', costoMin:0.5, costoMax:2, pesoG:100, nota:'Consumible' },
    { nombre:'Rascador de cartón para gatos', q:'rascador carton gato', costoMin:2, costoMax:5, pesoG:400, nota:'Recompra' },
    { nombre:'Bebedero plegable de viaje', q:'bebedero plegable perro viaje', costoMin:1, costoMax:3, pesoG:90, nota:'Liviano' },
    { nombre:'Arnés acolchado ajustable', q:'arnes perro acolchado', costoMin:2, costoMax:5, pesoG:200, nota:'Textil' },
    { nombre:'Guante de aseo para mascotas', q:'guante aseo mascotas', costoMin:1, costoMax:3, pesoG:100, nota:'Recompra' },
    { nombre:'Juguete de plumas para gato', q:'juguete gato plumas varita', costoMin:0.5, costoMax:2, pesoG:60, nota:'Barato' },
  ]},
  bebes: { label: 'Bebés / Niños', icon: '🍼', productos: [
    { nombre:'Babero de silicona impermeable', q:'babero silicona bebe', costoMin:1, costoMax:3, pesoG:80, nota:'Recompra' },
    { nombre:'Mordillo de silicona para dentición', q:'mordillo silicona bebe', costoMin:0.8, costoMax:2.5, pesoG:50, nota:'Grado alimenticio' },
    { nombre:'Organizador colgante de cuna', q:'organizador cuna colgante', costoMin:2, costoMax:5, pesoG:250, nota:'Textil' },
    { nombre:'Protectores de esquinas (pack)', q:'protector esquinas bebe seguridad', costoMin:0.5, costoMax:2, pesoG:100, nota:'Consumible' },
    { nombre:'Tapas antiderrame para vasos', q:'tapa antiderrame vaso niños', costoMin:1, costoMax:3, pesoG:80, nota:'Novedad' },
    { nombre:'Juguete apilable de silicona', q:'juguete apilable silicona bebe', costoMin:1.5, costoMax:4, pesoG:150, nota:'Didáctico' },
    { nombre:'Termómetro de baño para bebé', q:'termometro baño bebe', costoMin:1, costoMax:3, pesoG:80, nota:'Chico' },
    { nombre:'Organizador para cochecito', q:'organizador cochecito bebe', costoMin:2, costoMax:5, pesoG:200, nota:'Textil liviano' },
    { nombre:'Broches para chupete (set)', q:'broche chupete bebe', costoMin:0.5, costoMax:2, pesoG:40, nota:'Recompra' },
    { nombre:'Luz nocturna quitamiedos LED', q:'luz nocturna infantil led', costoMin:1.5, costoMax:4, pesoG:150, nota:'Deco infantil' },
    { nombre:'Bloques de encastre blandos (set)', q:'bloques encastre bebe set', costoMin:2, costoMax:5, pesoG:300, nota:'Didáctico' },
    { nombre:'Delantal de pintura para niños', q:'delantal pintura niños', costoMin:1, costoMax:3, pesoG:120, nota:'Textil' },
  ]},
  belleza: { label: 'Salud y Belleza', icon: '💄', productos: [
    { nombre:'Rodillo facial de cuarzo/jade', q:'rodillo facial jade cuarzo', costoMin:1, costoMax:3, pesoG:100, nota:'Tendencia skincare' },
    { nombre:'Set de brochas de maquillaje', q:'set brochas maquillaje', costoMin:1.5, costoMax:4, pesoG:120, nota:'Recompra' },
    { nombre:'Espejo LED de aumento portátil', q:'espejo led aumento portatil', costoMin:2, costoMax:5, pesoG:200, nota:'Chico' },
    { nombre:'Masajeador facial gua sha', q:'gua sha masajeador facial', costoMin:0.8, costoMax:2.5, pesoG:60, nota:'Tendencia' },
    { nombre:'Organizador de maquillaje acrílico', q:'organizador maquillaje acrilico', costoMin:2, costoMax:5, pesoG:300, nota:'Deco baño' },
    { nombre:'Rizador de pestañas', q:'rizador pestañas', costoMin:0.5, costoMax:2, pesoG:40, nota:'Recompra' },
    { nombre:'Cepillo alisador de cabello', q:'cepillo alisador cabello', costoMin:3, costoMax:7, pesoG:350, nota:'Alto ticket' },
    { nombre:'Kit de manicura (set)', q:'kit manicura set', costoMin:1, costoMax:3, pesoG:150, nota:'Recompra' },
    { nombre:'Vincha de spa skincare (pack)', q:'vincha spa skincare', costoMin:0.5, costoMax:2, pesoG:50, nota:'Barato' },
    { nombre:'Depilador facial eléctrico mini', q:'depilador facial electrico mini', costoMin:1.5, costoMax:4, pesoG:80, nota:'Chico' },
    { nombre:'Lámpara mini LED para uñas', q:'lampara uñas mini led', costoMin:2, costoMax:5, pesoG:200, nota:'Nicho nails' },
    { nombre:'Parches de hidrogel para ojeras', q:'parches ojeras hidrogel', costoMin:0.8, costoMax:2.5, pesoG:60, nota:'Consumible' },
  ]},
  cocina: { label: 'Cocina / Gastronomía', icon: '🍳', productos: [
    { nombre:'Cortador de verduras multifunción', q:'cortador verduras multifuncion', costoMin:2, costoMax:5, pesoG:400, nota:'Alta demanda' },
    { nombre:'Molinillo manual de sal y pimienta', q:'molinillo sal pimienta manual', costoMin:1.5, costoMax:4, pesoG:200, nota:'No frágil' },
    { nombre:'Moldes de silicona repostería (set)', q:'moldes silicona reposteria set', costoMin:1.5, costoMax:4, pesoG:250, nota:'Recompra' },
    { nombre:'Exprimidor manual de cítricos', q:'exprimidor citricos manual', costoMin:1, costoMax:3, pesoG:200, nota:'Chico' },
    { nombre:'Tabla de corte plegable', q:'tabla corte plegable cocina', costoMin:1.5, costoMax:4, pesoG:250, nota:'Novedad' },
    { nombre:'Rociador de aceite en spray', q:'rociador aceite spray cocina', costoMin:1.5, costoMax:4, pesoG:150, nota:'Fitness cook' },
    { nombre:'Pelador de cerámica (set)', q:'pelador ceramica set', costoMin:0.8, costoMax:2.5, pesoG:100, nota:'Recompra' },
    { nombre:'Termómetro digital de cocina', q:'termometro cocina digital', costoMin:1, costoMax:3, pesoG:80, nota:'Chico' },
    { nombre:'Batidor eléctrico mini de leche', q:'batidor leche electrico mini', costoMin:1, costoMax:3, pesoG:100, nota:'Barista casero' },
    { nombre:'Bolsas reutilizables de silicona', q:'bolsas reutilizables alimentos silicona', costoMin:1.5, costoMax:4, pesoG:150, nota:'Eco tendencia' },
    { nombre:'Abrelatas ergonómico', q:'abrelatas ergonomico', costoMin:1, costoMax:3, pesoG:120, nota:'No frágil' },
    { nombre:'Escurridor de pasta con clip', q:'escurridor pasta olla clip', costoMin:1, costoMax:3, pesoG:100, nota:'Novedad' },
  ]},
  automotor: { label: 'Automotor / Moto', icon: '🚗', productos: [
    { nombre:'Soporte magnético de celular para auto', q:'soporte celular auto magnetico', costoMin:1, costoMax:3, pesoG:80, nota:'Alta demanda' },
    { nombre:'Organizador de asiento para auto', q:'organizador asiento auto', costoMin:2, costoMax:5, pesoG:300, nota:'Textil' },
    { nombre:'Cargador USB dual para auto', q:'cargador auto usb dual', costoMin:0.8, costoMax:2.5, pesoG:40, nota:'Chico' },
    { nombre:'Kit de luces LED interior', q:'luces led interior auto', costoMin:1.5, costoMax:4, pesoG:120, nota:'Tuning' },
    { nombre:'Ganchos organizadores de baúl (par)', q:'gancho baul auto organizador', costoMin:1, costoMax:3, pesoG:100, nota:'Chico' },
    { nombre:'Cubre volante deportivo', q:'cubre volante auto', costoMin:1.5, costoMax:4, pesoG:200, nota:'Recompra' },
    { nombre:'Escobillas de silicona (par)', q:'escobilla limpiaparabrisas silicona', costoMin:1.5, costoMax:4, pesoG:200, nota:'Consumible' },
    { nombre:'Aromatizante clip de ventilación', q:'aromatizante auto clip', costoMin:0.5, costoMax:2, pesoG:40, nota:'Recompra' },
    { nombre:'Rejilla organizadora de baúl', q:'organizador baul auto malla', costoMin:1.5, costoMax:4, pesoG:200, nota:'Textil' },
    { nombre:'Plumero para tablero', q:'plumero limpieza auto tablero', costoMin:1, costoMax:3, pesoG:100, nota:'Recompra' },
    { nombre:'Gancho de casco para moto', q:'gancho casco moto', costoMin:1, costoMax:3, pesoG:100, nota:'Nicho moto' },
    { nombre:'Guantes de moto media estación', q:'guantes moto verano', costoMin:2, costoMax:5, pesoG:150, nota:'Textil' },
  ]},
  herramientas: { label: 'Herramientas / Bricolaje', icon: '🔧', productos: [
    { nombre:'Set de destornilladores de precisión', q:'set destornilladores precision', costoMin:1.5, costoMax:4, pesoG:200, nota:'Electrónica DIY' },
    { nombre:'Nivel láser mini autonivelante', q:'nivel laser mini', costoMin:3, costoMax:7, pesoG:250, nota:'Alto margen' },
    { nombre:'Medidor láser de distancia', q:'medidor laser distancia', costoMin:3, costoMax:8, pesoG:150, nota:'Alto ticket' },
    { nombre:'Organizador de tornillos apilable', q:'organizador tornillos cajas', costoMin:2, costoMax:5, pesoG:300, nota:'No frágil' },
    { nombre:'Set de brocas multiuso', q:'set brocas taladro', costoMin:2, costoMax:5, pesoG:250, nota:'Consumible' },
    { nombre:'Linterna LED recargable de mano', q:'linterna led recargable mano', costoMin:2, costoMax:5, pesoG:150, nota:'Recompra' },
    { nombre:'Cinta métrica retráctil 5m', q:'cinta metrica 5 metros', costoMin:1, costoMax:3, pesoG:150, nota:'Chico' },
    { nombre:'Pistola de silicona caliente mini', q:'pistola silicona caliente mini', costoMin:1.5, costoMax:4, pesoG:200, nota:'Manualidades' },
    { nombre:'Guantes de trabajo anticorte', q:'guantes trabajo anticorte', costoMin:1, costoMax:3, pesoG:120, nota:'Recompra' },
    { nombre:'Set de llaves allen plegable', q:'set llaves allen plegable', costoMin:1, costoMax:3, pesoG:150, nota:'Chico' },
    { nombre:'Cinta aisladora (pack colores)', q:'cinta aisladora pack colores', costoMin:0.5, costoMax:2, pesoG:120, nota:'Consumible' },
    { nombre:'Detector de cables de pared', q:'detector cables pared', costoMin:2, costoMax:5, pesoG:150, nota:'Novedad' },
  ]},
  camping: { label: 'Camping / Outdoor', icon: '🏕️', productos: [
    { nombre:'Linterna de camping recargable', q:'linterna camping recargable', costoMin:2, costoMax:5, pesoG:250, nota:'Recompra' },
    { nombre:'Cubiertos plegables de viaje', q:'cubiertos plegables camping', costoMin:1.5, costoMax:4, pesoG:150, nota:'Liviano' },
    { nombre:'Manta térmica de emergencia (pack)', q:'manta termica emergencia', costoMin:0.5, costoMax:2, pesoG:60, nota:'Consumible' },
    { nombre:'Filtro de agua portátil personal', q:'filtro agua portatil camping', costoMin:3, costoMax:8, pesoG:120, nota:'Alto margen' },
    { nombre:'Hamaca paracaídas liviana', q:'hamaca paracaidas camping', costoMin:3, costoMax:7, pesoG:400, nota:'Textil liviano' },
    { nombre:'Silbato de supervivencia multiuso', q:'silbato supervivencia', costoMin:0.3, costoMax:1.5, pesoG:30, nota:'Diminuto' },
    { nombre:'Bolsa seca impermeable (dry bag)', q:'bolsa seca impermeable dry bag', costoMin:1.5, costoMax:4, pesoG:150, nota:'Textil' },
    { nombre:'Estacas y cuerdas para carpa', q:'estacas carpa camping', costoMin:1, costoMax:3, pesoG:300, nota:'Consumible' },
    { nombre:'Lámpara solar inflable portátil', q:'lampara solar inflable camping', costoMin:2, costoMax:5, pesoG:120, nota:'Novedad eco' },
    { nombre:'Mochila plegable ultraliviana', q:'mochila plegable ultraliviana', costoMin:2, costoMax:5, pesoG:150, nota:'Textil liviano' },
    { nombre:'Pulsera repelente de mosquitos (pack)', q:'pulsera repelente mosquitos', costoMin:0.5, costoMax:2, pesoG:40, nota:'Estacional' },
    { nombre:'Brújula de supervivencia', q:'brujula supervivencia', costoMin:1, costoMax:3, pesoG:80, nota:'Chico' },
  ]},
  oficina: { label: 'Papelería / Oficina', icon: '📎', productos: [
    { nombre:'Resaltadores pastel (set)', q:'resaltadores pastel set', costoMin:0.8, costoMax:2.5, pesoG:120, nota:'Recompra estudiantes' },
    { nombre:'Organizador de escritorio', q:'organizador escritorio', costoMin:2, costoMax:5, pesoG:350, nota:'Oficina' },
    { nombre:'Notas adhesivas y separadores (set)', q:'notas adhesivas set separadores', costoMin:0.5, costoMax:2, pesoG:100, nota:'Consumible' },
    { nombre:'Lapiceras borrables (pack)', q:'lapicera borrable pack', costoMin:0.8, costoMax:2.5, pesoG:80, nota:'Recompra' },
    { nombre:'Planner semanal / agenda', q:'planner semanal agenda', costoMin:1.5, costoMax:4, pesoG:250, nota:'Estacional' },
    { nombre:'Marcadores de doble punta (set)', q:'marcadores doble punta set', costoMin:2, costoMax:5, pesoG:200, nota:'Lettering' },
    { nombre:'Organizador de cables para mochila', q:'organizador cables mochila electronica', costoMin:1.5, costoMax:4, pesoG:150, nota:'Textil' },
    { nombre:'Sello autoentintable', q:'sello autoentintable', costoMin:1, costoMax:3, pesoG:80, nota:'Chico' },
    { nombre:'Calculadora científica', q:'calculadora cientifica', costoMin:2, costoMax:5, pesoG:150, nota:'Escolar' },
    { nombre:'Stickers decorativos (packs)', q:'stickers decorativos pack', costoMin:0.3, costoMax:1.5, pesoG:40, nota:'Recompra' },
    { nombre:'Cinta correctora (pack)', q:'cinta correctora pack', costoMin:0.5, costoMax:2, pesoG:60, nota:'Consumible' },
    { nombre:'Atril soporte para libros/tablet', q:'atril soporte libros ajustable', costoMin:2, costoMax:5, pesoG:300, nota:'Estudio' },
  ]},
};

async function getMeliToken(userId){
  if(!SUPA_KEY || !userId) return null;
  try{
    const url = SUPA_URL + '/rest/v1/meli_tokens?user_id=eq.' + encodeURIComponent(userId) + '&select=access_token,expires_at';
    const r = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } });
    if(!r.ok) return null;
    const rows = await r.json();
    if(!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    if(row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return { token: null, expired: true };
    return { token: row.access_token, expired: false };
  }catch(e){ return null; }
}

async function meliSearch(query, token){
  if(!token) return null;
  try{
    const url = 'https://api.mercadolibre.com/sites/MLA/search?limit=50&q=' + encodeURIComponent(query);
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if(!r.ok){ try{ (globalThis.__MELI_DBG=globalThis.__MELI_DBG||[]).push({q:query, status:r.status}); }catch(_){}; return null; }
    const j = await r.json();
    if(!j.results){ try{ (globalThis.__MELI_DBG=globalThis.__MELI_DBG||[]).push({q:query, noResults:true, keys:Object.keys(j)}); }catch(_){}; return null; }
    const precios = j.results.map(x=>x.price).filter(p=>typeof p==='number' && p>0);
    const sellers = new Set(j.results.map(x=>x.seller && x.seller.id).filter(Boolean));
    return { precios, sellers: sellers.size, total: (j.paging && j.paging.total) || j.results.length };
  }catch(e){ return null; }
}

function _median(arr){ if(!arr.length) return null; const s=[...arr].sort((a,b)=>a-b), m=Math.floor(s.length/2); return s.length%2 ? s[m] : Math.round((s[m-1]+s[m])/2); }
function _nivel(v){ return v>=70?'Alta':v>=45?'Media':'Baja'; }
function _score(o){
  var precioVenta=o.precioVenta, total=o.total, costoPuestoARS=o.costoPuestoARS, pesoG=o.pesoG;
  const margenPct = costoPuestoARS>0 ? Math.round(((precioVenta - costoPuestoARS)/costoPuestoARS)*100) : null;
  let satScore, satLabel;
  if(total < 300){ satScore=90; satLabel='Baja'; } else if(total < 1500){ satScore=65; satLabel='Media'; }
  else if(total < 6000){ satScore=40; satLabel='Alta'; } else { satScore=20; satLabel='Muy alta'; }
  const demScore = total>3000?85 : total>800?70 : total>150?55 : 35;
  let margScore = 40;
  if(margenPct!==null){ margScore = margenPct>=250?95 : margenPct>=150?85 : margenPct>=100?72 : margenPct>=60?55 : margenPct>=30?40 : 20; }
  const pesoScore = pesoG<=150?95 : pesoG<=300?80 : pesoG<=500?60 : 40;
  const score = Math.round(margScore*0.35 + satScore*0.30 + demScore*0.25 + pesoScore*0.10);
  const riesgo = (satScore>=65 && margScore>=72) ? 'Bajo' : (satScore>=40 && margScore>=55) ? 'Medio' : 'Alto';
  return { margenPct: margenPct, satLabel: satLabel, demScore: demScore, score: score, riesgo: riesgo };
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
    globalThis.__MELI_DBG=[]; if (!nicho) return res.status(400).json({error: 'Falta elegir un nicho / seccion'});
    const niche = CATALOGO[nicho] || CATALOGO[String(nicho).toLowerCase()];
    if (!niche) return res.status(400).json({error: 'Nicho no encontrado', nichosDisponibles: Object.keys(CATALOGO)});

    const usdArs = parseFloat(process.env.USD_ARS) || USD_ARS_FALLBACK;
    const tk = await getMeliToken(user_id);
    const token = tk && tk.token ? tk.token : null;
    const tokenExpired = tk && tk.expired ? true : false;

  if (req.body && req.body.probe) {
    const endpoints = [
      ['sites_search', 'https://api.mercadolibre.com/sites/MLA/search?q=soporte%20celular&limit=5'],
      ['highlights_cat', 'https://api.mercadolibre.com/highlights/MLA/category/MLA1055'],
      ['products_search', 'https://api.mercadolibre.com/products/search?status=active&site_id=MLA&q=soporte%20celular&limit=5'],
      ['trends_cat', 'https://api.mercadolibre.com/trends/MLA/MLA1055'],
      ['users_me', 'https://api.mercadolibre.com/users/me'],
      ['category_MLA1055', 'https://api.mercadolibre.com/categories/MLA1055'],
      ['domain_search', 'https://api.mercadolibre.com/sites/MLA/domain_discovery/search?limit=5&q=soporte%20celular']
    ];
    const out = [];
    for (const [name, url] of endpoints) {
      try {
        const rr = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
        let sample = null;
        try { const jj = await rr.json(); sample = Array.isArray(jj) ? ('array:' + jj.length) : (jj.results ? ('results:' + jj.results.length) : (jj.content ? ('content:' + jj.content.length) : Object.keys(jj).slice(0,6).join(','))); } catch(_) { sample = 'nonjson'; }
        out.push({ name, status: rr.status, sample });
      } catch(e) { out.push({ name, error: String(e).slice(0,60) }); }
    }
    return res.status(200).json({ probe: true, hasToken: !!token, results: out });
  }


    const productos = [];
    const lista = niche.productos;
    for (let i=0; i<lista.length; i+=5) {
      const batch = lista.slice(i, i+5);
      const evals = await Promise.all(batch.map(async (prod) => {
        const costoUnitUSD = (prod.costoMin + prod.costoMax)/2;
        const costoUnitARS = Math.round(costoUnitUSD * usdArs);
        const costoPuestoARS = Math.round(costoUnitARS * 1.35);
        const data = await meliSearch(prod.q, token);
        if (data && data.precios.length) {
          const precioVenta = _median(data.precios);
          const total = data.total || data.precios.length;
          const s = _score({ precioVenta: precioVenta, total: total, costoPuestoARS: costoPuestoARS, pesoG: prod.pesoG });
          return { nombre: prod.nombre, query: prod.q, nota: prod.nota, pesoG: prod.pesoG,
            fuente: 'MercadoLibre (real)', precioVentaARS: precioVenta, sellers: data.sellers,
            totalResultados: total, costoEstimadoUSD: [prod.costoMin, prod.costoMax], costoPuestoARS: costoPuestoARS,
            margen: s.margenPct, demanda: _nivel(s.demScore), saturacion: s.satLabel, riesgo: s.riesgo, score: s.score };
        }
        return { nombre: prod.nombre, query: prod.q, nota: prod.nota, pesoG: prod.pesoG,
          fuente: 'Estimado', precioVentaARS: null, sellers: null, totalResultados: null,
          costoEstimadoUSD: [prod.costoMin, prod.costoMax], costoPuestoARS: costoPuestoARS,
          margen: null, demanda: 'A validar', saturacion: 'A validar', riesgo: 'A validar', score: null };
      }));
      productos.push.apply(productos, evals);
    }

    let filtrados = productos;
    if (riesgo && /bajo/i.test(riesgo)) filtrados = productos.filter(function(p){ return !p.score || p.riesgo==='Bajo' || p.riesgo==='Medio'; });
    filtrados.sort(function(a,b){ const ad=a.score!=null, bd=b.score!=null; if(ad!==bd) return ad?-1:1; return (b.score||0)-(a.score||0); });
    if (filtrados.length && filtrados[0].score!=null) filtrados[0].topPick = true;

    const conDato = productos.filter(function(p){ return p.score!=null; }).length;
    return res.status(200).json({
      nicho: nicho, nichoLabel: niche.label, icon: niche.icon, usdArs: usdArs,
      totalEvaluados: productos.length, conDatoReal: conDato,
      meliConectado: !!token, meliTokenExpirado: tokenExpired, __debug: (globalThis.__MELI_DBG||[]).slice(0,15), __tokenSample: token ? (String(token).slice(0,9)) : null,
      products: filtrados,
      disclaimer: 'Precios y competencia: datos reales de la API de MercadoLibre (requiere tu cuenta de ML conectada). Costos de importacion: rango ESTIMADO por categoria. Margen = (precio de venta menos costo estimado con +35% de logistica/impuestos) / costo.'
    });
  } catch(err) {
    return res.status(500).json({error: 'Error interno del servidor', detail: err.message});
  }
}
