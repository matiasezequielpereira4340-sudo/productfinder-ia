/* ==========================================================================
   MeLi Connect - logica de la aplicacion
   Extraido de los 20 bloques <script> inline de index.html, en el MISMO
   orden en que se ejecutaban. Se carga con defer: no bloquea el pintado y
   corre con el DOM ya parseado.
   ========================================================================== */

/* ---- bloque 1 ---- */
let currentRole = null;
let sessionExpiry = null;
let analysisResults = null;
let analysisParams = null;
let mrData = {};
let mrCurrentProduct = '';
const HISTORY_KEY = 'pf_mr_history';
const MAX_HISTORY = 5;

function toggleEye(el){
  var wrap=el.closest?el.closest('.fld'):null;
  var inp=wrap?wrap.querySelector('input'):el.previousElementSibling;
  if(!inp)return;
  var use=el.querySelector('use');
  var ver=(inp.type==='password');
  inp.type=ver?'text':'password';
  if(use)use.setAttribute('href',ver?'#i-x':'#i-eye');
  el.setAttribute('aria-label',ver?'Ocultar contrase\u00f1a':'Mostrar contrase\u00f1a');
  el.classList.toggle('is-on',ver);
}

function showRegister(){ showScreen('registerScreen'); var e=document.getElementById('regError'); if(e)e.textContent=''; var o=document.getElementById('regOk'); if(o){o.style.display='none';o.textContent='';} }
function showLogin(){ showScreen('loginScreen'); var e=document.getElementById('loginError'); if(e)e.textContent=''; }
async function doRegister(){
  const email=(document.getElementById('regEmail').value||'').trim().toLowerCase();
  const pass=document.getElementById('regPass').value;
  const pass2=document.getElementById('regPass2').value;
  const errEl=document.getElementById('regError');
  const okEl=document.getElementById('regOk');
  errEl.textContent=''; if(okEl){okEl.style.display='none';}
  if(!email||!pass){ errEl.textContent='Completa email y contrasena'; return; }
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ errEl.textContent='Email invalido'; return; }
  if(pass.length<6){ errEl.textContent='La contrasena debe tener al menos 6 caracteres'; return; }
  if(pass!==pass2){ errEl.textContent='Las contrasenas no coinciden'; return; }
  try{
    const res=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,password:pass,action:'register'})});
    const data=await res.json();
    if(!res.ok||!data.success){ errEl.textContent=data.error||'No se pudo crear la cuenta'; return; }
    document.getElementById('regEmail').value=''; document.getElementById('regPass').value=''; document.getElementById('regPass2').value='';
    if(okEl){ okEl.style.display='block'; okEl.textContent='Cuenta creada. Queda pendiente de aprobacion del administrador. Te avisaremos cuando este habilitada.'; }
    if(window.mcTrack) window.mcTrack('registro_iniciado',{});
  }catch(e){ errEl.textContent='Error de conexion. Intenta de nuevo.'; }
}

async function doLogin(){
  const user=document.getElementById('loginUser').value.trim();
  const pass=document.getElementById('loginPass').value;
  const errEl=document.getElementById('loginError');
  errEl.textContent='';
  if(!user||!pass){errEl.textContent='Complet&#225; usuario y contrase&#241;a';return;}
  try{
    const res=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user,password:pass,action:'login'})});
    const data=await res.json();
    if(!res.ok||!data.success){errEl.textContent=data.error||'Usuario o contrase&#241;a incorrectos';return;}
    currentRole=data.role;
    sessionExpiry=data.expiresAt||null;
    localStorage.setItem('pf_user',user);
    localStorage.setItem('pf_role',currentRole);
            localStorage.setItem('pf_premium', (data.premium || data.role==='admin') ? '1' : '0');
            // El token lo firma el servidor. pf_premium queda solo para pintar la
            // interfaz: quien decide cuantos productos se entregan es el backend.
            if(data.token) localStorage.setItem('pf_token', data.token); else localStorage.removeItem('pf_token');
    if(sessionExpiry)localStorage.setItem('pf_expiry',sessionExpiry);
    showScreen('menuScreen');
    setupTopbar(user);
  }catch(e){errEl.textContent='Error de conexi&#243;n. Intent&#225; de nuevo.';}
}

function setupTopbar(user){
  // Escribe sobre los elementos que existen hoy en la barra (.mc-un / .mc-av).
  // Los IDs viejos (topbarUser, adminTopbarUser, ...) ya no estan en el DOM.
  try{
    document.querySelectorAll('.mc-un').forEach(function(el){ el.textContent=user||'invitado'; });
    document.querySelectorAll('.mc-av').forEach(function(el){
      el.textContent=(user&&user.trim())?user.trim().charAt(0).toUpperCase():'?';
    });
  }catch(e){}
  try{
    var loggedIn=!!localStorage.getItem('pf_user');
    var enterBtn=document.getElementById('mcEnterBtn');
    var userBox=document.getElementById('mcUserBox');
    var logoutBtn=document.getElementById('mcLogoutBtn');
    if(enterBtn) enterBtn.style.display=loggedIn?'none':'';
    if(userBox) userBox.style.display=loggedIn?'':'none';
    if(logoutBtn) logoutBtn.style.display=loggedIn?'':'none';
  }catch(e){}
  try{
    var esAdmin=(currentRole==='admin');
    document.querySelectorAll('.mc-admin-item').forEach(function(el){
      el.style.display=esAdmin?'':'none';
    });
  }catch(e){}
  ['topbarUser','adminTopbarUser','marketTopbarUser'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.textContent=user;
  });
  var expiryEl=document.getElementById('topbarExpiry');
  var adminBtn=document.getElementById('btnAdminPanel');
  if(currentRole==='admin'){
    if(expiryEl) expiryEl.style.display='none';
    if(adminBtn) adminBtn.style.display='block';
  } else if(sessionExpiry){
    var days=Math.ceil((new Date(sessionExpiry)-Date.now())/(1000*60*60*24));
    if(expiryEl){
      expiryEl.style.display='block';
      expiryEl.textContent=days>0?' '+days+'d restantes':'Sesion expirada';
      if(days<=7) expiryEl.classList.add('urgent');
    }
    if(adminBtn) adminBtn.style.display='none';
  }
}

function showScreen(id){
  function apply(){
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    var navWrap=document.getElementById('mcNavWrap');
    if(navWrap) navWrap.style.display=(id==='loginScreen'||id==='registerScreen')?'none':'';
    // Resaltado del item activo en el nav. Antes esto buscaba #mcNavInicio,
    // #mcNavBuscador y #mcNavRecomendador, que NO existen en ningun HTML: son
    // restos de un nav viejo. O sea que el resaltado nunca se movia y el menu
    // seguia marcando "Inicio" aunque estuvieras en el Buscador. El nav real lo
    // arma mc-ui.js y marca con data-mc-key + clase .active.
    var navMap={menuScreen:'inicio',marketScreen:'market',appScreen:'productfinder'};
    var claveActiva=navMap[id];
    document.querySelectorAll('#mcNav [data-mc-key]').forEach(function(a){
      a.classList.toggle('active', !!claveActiva && a.getAttribute('data-mc-key')===claveActiva);
    });
    // El desplegable padre ("Importación") tambien se marca si su hijo esta activo.
    document.querySelectorAll('#mcNav .mc-item > button.mc-link').forEach(function(b){
      var hijoActivo=!!b.parentNode.querySelector('[data-mc-key].active');
      b.classList.toggle('active', hijoActivo);
    });
  }
  var reduced=false;
  try{ reduced=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}
  if(!reduced && document.startViewTransition){ document.startViewTransition(apply); }
  else { apply(); }
}
// El hash se ESCRIBE con pushState, no con replaceState.
//
// Con replaceState el boton Atras no volvia entre pantallas: te sacaba del
// sitio, porque cada cambio de pantalla pisaba la misma entrada del historial
// en vez de agregar una. En el celular eso es peor todavia, porque Atras es el
// gesto principal de navegacion.
//
// Dos excepciones, las dos por la misma razon (no ensuciar el historial):
//   - Si el hash destino es IGUAL al actual, no se toca nada. Esto ademas es lo
//     que evita que routeFromHash(), al reaccionar a un popstate, empuje otra
//     entrada y multiplique el historial a cada Atras.
//   - Si la URL todavia no tiene hash, se usa replaceState. Ese es el caso de
//     "recien cargo la pagina": si se empujara, entrar al sitio ya te dejaria
//     una entrada basura antes de haber navegado a ningun lado.
function setHash(h){
  try{
    var actual=(location.hash||'').replace('#','').toLowerCase();
    if(actual===String(h).toLowerCase()) return;
    if(!actual) history.replaceState(null,'','#'+h);
    else history.pushState(null,'','#'+h);
  }catch(e){}
}

// Que pantalla corresponde a cada hash. Se usa tanto para rutear como para
// saber, desde el nav, a que funcion hay que llamar.
function pantallaDeHash(h){
  h=String(h||'').replace('#','').toLowerCase();
  if(h==='market'||h==='mercado') return 'marketScreen';
  if(h==='productfinder'||h==='app'||h==='recomendador') return 'appScreen';
  if(h==='menu'||h==='inicio'||h==='hub'||h==='') return 'menuScreen';
  return null;
}
window.pantallaDeHash=pantallaDeHash;

function routeFromHash(){
  var h=(location.hash||'').replace('#','').toLowerCase();
  var destino=pantallaDeHash(h);
  if(!destino || h==='') return false;
  // Si ya estamos ahi no se rehace nada. Atras dispara popstate Y hashchange
  // en el mismo gesto: sin esto la pantalla se pintaria dos veces.
  var actual=document.querySelector('.screen.active');
  if(actual && actual.id===destino) return true;
  if(destino==='marketScreen'){showMarket();return true;}
  if(destino==='appScreen'){showApp();return true;}
  if(destino==='menuScreen'){showMenu();return true;}
  return false;
}
window.addEventListener('hashchange',function(){routeFromHash();});
// pushState no dispara hashchange, asi que sin popstate el boton Atras cambiaba
// la URL y dejaba la pantalla anterior puesta.
window.addEventListener('popstate',function(){routeFromHash();});
function showApp(){showScreen('appScreen');setHash('productfinder');try{window.scrollTo({top:0,behavior:'smooth'});}catch(e){window.scrollTo(0,0);}}
function showMenu(){showScreen('menuScreen');setHash('menu');try{window.scrollTo({top:0,behavior:'smooth'});}catch(e){window.scrollTo(0,0);}}
function showMarket(){showScreen('marketScreen');setHash('market');try{window.scrollTo({top:0,behavior:'smooth'});}catch(e){window.scrollTo(0,0);}}

// La via paga de MercadoLibre (Apify) esta detras del login: sin este header,
// el server no la habilita y el Market Reader se queda en las vias gratuitas,
// que hoy estan todas bloqueadas por MeLi. O sea que faltando esto el paso de
// competencia no trae nada NI SIQUIERA para un usuario logueado.
function mrCabeceras(){
  var c = {'Content-Type':'application/json'};
  try{ var t = localStorage.getItem('pf_token'); if(t) c['Authorization'] = 'Bearer ' + t; }catch(e){}
  return c;
}
window.mrCabeceras = mrCabeceras;
function doGuest(){currentRole='guest';sessionExpiry=null;localStorage.setItem('pf_user','Invitado');localStorage.setItem('pf_role','guest');localStorage.removeItem('pf_premium');localStorage.removeItem('pf_expiry');localStorage.removeItem('pf_token');showScreen('menuScreen');setupTopbar('Invitado');var ab=document.getElementById('btnAdminPanel');if(ab)ab.style.display='none';var ex=document.getElementById('topbarExpiry');if(ex)ex.style.display='none';} function doLogout(){
  try{ localStorage.removeItem('pf_token'); }catch(e){}
  currentRole=null;sessionExpiry=null;analysisResults=null;mrData={};mrCurrentProduct='';
  localStorage.removeItem('pf_user');localStorage.removeItem('pf_role');localStorage.removeItem('pf_expiry');
  document.getElementById('loginUser').value='';
  document.getElementById('loginPass').value='';
  document.getElementById('loginError').textContent='';
  document.getElementById('emailGate').style.display='none';
  document.getElementById('resultsSection').style.display='none';
  document.getElementById('productsGrid').innerHTML='';
  showScreen('menuScreen');
  try{setupTopbar('');}catch(e){}
}
// ===== ANALISIS COMPARTIBLE POR URL =====
// El estado del analisis viaja en query params, para que un cliente pueda
// mandarle el link a un socio y que ese entre directo al mismo analisis.
var MR_URL_CAMPOS = [
  ['p','mrProductInput'], ['cap','mrCapital'], ['can','mrCanal'], ['tc','mrTipoCambio'],
  ['mod','mrModalidad'], ['pos','mrPosicion'], ['ncm','mrNCM'], ['ship','mrShipMode'],
  ['fob','mrFOB'], ['vts','mrVentas'], ['pv','mrPrecioVenta'], ['kg','mrPesoKg']
];

function buildMRShareUrl(){
  var params=new URLSearchParams();
  MR_URL_CAMPOS.forEach(function(par){
    var el=document.getElementById(par[1]);
    if(el && el.value!=null && String(el.value).trim()!=='') params.set(par[0], String(el.value).trim());
  });
  if(!params.get('p')) return null;
  return location.origin+location.pathname+'?'+params.toString()+'#market';
}

function syncMRUrl(){
  try{
    var url=buildMRShareUrl();
    if(url) history.replaceState(null,'',url);
  }catch(e){}
}

async function shareMRAnalysis(btn){
  var url=buildMRShareUrl();
  if(!url){ alert('Primero corré un análisis.'); return; }
  var original=btn?btn.innerHTML:'';
  function ok(){
    if(!btn) return;
    btn.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg> Link copiado';
    setTimeout(function(){ btn.innerHTML=original; },2200);
  }
  try{
    await navigator.clipboard.writeText(url);
    ok();
  }catch(e){
    // Fallback para navegadores sin permiso de portapapeles
    var ta=document.createElement('textarea');
    ta.value=url; ta.setAttribute('readonly','');
    ta.style.cssText='position:fixed;top:-1000px;left:-1000px';
    document.body.appendChild(ta); ta.select();
    var copiado=false;
    try{ copiado=document.execCommand('copy'); }catch(_){}
    document.body.removeChild(ta);
    if(copiado) ok();
    else prompt('Copiá el link del análisis:', url);
  }
  if(window.mcTrack) window.mcTrack('analisis_compartido',{producto:mrCurrentProduct||''});
}

// Hidrata los campos desde la URL al cargar y, si hay producto, corre el analisis.
function hydrateMRFromUrl(){
  var qs;
  try{ qs=new URLSearchParams(location.search); }catch(e){ return false; }
  if(!qs.get('p')) return false;
  MR_URL_CAMPOS.forEach(function(par){
    var v=qs.get(par[0]); if(v==null) return;
    var el=document.getElementById(par[1]); if(!el) return;
    el.value=v;
    try{ el.dispatchEvent(new Event('change',{bubbles:true})); }catch(_){}
  });
  return true;
}

// ===== Contador animado para el score de viabilidad (Task 5) =====
function mcCountUp(el, target, duration){
  if(!el) return;
  target = Math.round(target||0);
  var reduced=false;
  try{ reduced=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}
  if(reduced){ el.textContent=target; return; }
  duration = duration || 1100;
  var start = null;
  var from = parseInt(el.textContent,10); if(isNaN(from)) from = 0;
  function ease(t){ return 1 - Math.pow(1-t, 3); }
  function frame(ts){
    if(start===null) start = ts;
    var p = Math.min(1, (ts-start)/duration);
    el.textContent = Math.round(from + (target-from)*ease(p));
    if(p < 1) requestAnimationFrame(frame);
    else el.textContent = target;
  }
  requestAnimationFrame(frame);
}

// ===== DEMO EN VIVO DEL HERO (Task 3) =====
var HHD_STATE = { timerId: null };
function hhdEscape(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function hhdSkeleton(){
  return '<div class="hhd-skeleton"><div class="sk-line"></div><div class="sk-grid"><div class="sk-box"></div><div class="sk-box"></div><div class="sk-box"></div><div class="sk-box"></div></div></div>';
}
// Estado de error honesto. NUNCA mostramos numeros inventados: si no pudimos
// consultar MercadoLibre, lo decimos y ofrecemos reintentar.
function hhdError(product, motivo){
  var el=document.getElementById('hhdResult');
  var tag=document.getElementById('hhdModeTag');
  if(tag){ tag.textContent='Sin conexi\u00f3n a MeLi'; tag.classList.add('is-example'); tag.classList.remove('is-error'); }
  if(el) el.innerHTML =
    '<div class="hhd-offstate">'+
      '<p class="hhd-offtitle">Esto es lo que hace la herramienta</p>'+
      '<ol class="hhd-offlist">'+
        '<li>Toma el producto que escribiste y le pregunta a MercadoLibre en qu&eacute; categor&iacute;a lo ubica.</li>'+
        '<li>Fija si ese t&eacute;rmino aparece hoy entre las b&uacute;squedas m&aacute;s frecuentes de Argentina.</li>'+
        '<li>Te muestra qu&eacute; m&aacute;s est&aacute; buscando la gente alrededor de ese producto.</li>'+
      '</ol>'+
      '<p class="hhd-offnote">'+hhdEscape(motivo||'La consulta no lleg&oacute; a destino.')+' Por eso no hay n&uacute;meros ac&aacute; abajo: o son datos reales de MercadoLibre, o no son nada. Nunca vas a ver una estimaci&oacute;n disfrazada de dato.</p>'+
      '<button type="button" class="hhd-retry" onclick="runHeroDemo()">Probar de nuevo</button>'+
    '</div>';
  var tsWrap=document.getElementById('hhdTsWrap'); if(tsWrap) tsWrap.style.display='none';
  var cta=document.getElementById('hhdCta'); if(cta) cta.style.display='';
}
function hhdStartTimer(sinceMs){
  clearInterval(HHD_STATE.timerId);
  function tick(){
    var tsEl=document.getElementById('hhdTimestamp'); if(!tsEl) return;
    var secs=Math.max(0,Math.round((Date.now()-sinceMs)/1000));
    var txt;
    if(secs<5) txt='consultado recién';
    else if(secs<60) txt='consultado hace '+secs+' segundos';
    else txt='consultado hace '+Math.floor(secs/60)+' min';
    tsEl.textContent=txt;
  }
  tick();
  HHD_STATE.timerId=setInterval(tick,1000);
}
async function runHeroDemo(term){
  var input=document.getElementById('hhdInput');
  var product=(term||(input&&input.value)||'').trim();
  if(!product) product='auriculares bluetooth';
  if(input) input.value=product;
  var btn=document.getElementById('hhdBtn');
  var tag=document.getElementById('hhdModeTag');
  var resEl=document.getElementById('hhdResult');
  var ctaEl=document.getElementById('hhdCta');
  var tsWrap=document.getElementById('hhdTsWrap');
  if(btn) btn.disabled=true;
  if(ctaEl) ctaEl.style.display='none';
  if(tsWrap) tsWrap.style.display='none';
  if(tag){ tag.textContent='Consultando...'; tag.classList.remove('is-example'); tag.classList.remove('is-error'); }
  if(resEl) resEl.innerHTML=hhdSkeleton();
  clearInterval(HHD_STATE.timerId);

  if(typeof navigator!=='undefined' && navigator.onLine===false){
    if(btn) btn.disabled=false;
    hhdError(product,'Tu dispositivo está sin conexión.');
    return;
  }
  try{
    // GET /api/market?demo= consulta MercadoLibre en el servidor con el token de
    // la casa y devuelve SOLO dato real: la categoria que MeLi le asigna al
    // termino y su lugar en las busquedas del momento. Si falla, ok:false.
    var res=await fetch('/api/market?demo='+encodeURIComponent(product),{headers:{'Accept':'application/json'}});
    var data=await res.json();
    if(!res.ok) throw new Error('El servidor respondi\u00f3 con un error.');
    if(!data || data.ok!==true) throw new Error((data && data.error) || 'MercadoLibre no devolvi\u00f3 datos para esa b\u00fasqueda.');
    if(data.fuente!=='mercadolibre-trends+domain_discovery') throw new Error('La respuesta no vino de MercadoLibre.');

    var now=data.consultadoEn ? new Date(data.consultadoEn).getTime() : Date.now();
    if(!now || isNaN(now)) now=Date.now();
    if(tag){ tag.textContent='En vivo'; tag.classList.remove('is-example'); tag.classList.remove('is-error'); }
    var nf=new Intl.NumberFormat('es-AR');
    var total=data.totalTendencias||0;
    var pos=data.posicionEnTendencias;
    var kpiPos = pos
      ? '<div class="hhd-kpi is-accent"><b>#'+nf.format(pos)+'</b><span>En lo m&aacute;s buscado</span></div>'
      : '<div class="hhd-kpi"><b>No figura</b><span>En lo m&aacute;s buscado</span></div>';
    var lista=(data.relacionadas&&data.relacionadas.length)?data.relacionadas:(data.topTendencias||[]);
    var etiqueta=(data.relacionadas&&data.relacionadas.length)
      ? 'B&uacute;squedas relacionadas de hoy'
      : 'Lo m&aacute;s buscado hoy en MercadoLibre';
    var chips='';
    if(lista.length){
      chips='<div class="hhd-chips"><span class="hhd-chiplabel">'+etiqueta+'</span>'+
        lista.map(function(k){ return '<span class="hhd-chip">'+hhdEscape(k)+'</span>'; }).join('')+
      '</div>';
    }
    var pie = pos
      ? 'Tu producto est&aacute; en el puesto '+nf.format(pos)+' de las '+nf.format(total)+' b&uacute;squedas m&aacute;s frecuentes de MercadoLibre Argentina ahora mismo.'
      : 'No aparece entre las '+nf.format(total)+' b&uacute;squedas m&aacute;s frecuentes de ahora. Eso no lo descarta: puede ser un nicho chico con menos competencia.';
    if(resEl) resEl.innerHTML=
      '<div class="hhd-head"><div><div class="hhd-name">'+hhdEscape(product)+'</div><div class="hhd-meta">'+
        (data.categoria ? 'Categor&iacute;a en MercadoLibre: '+hhdEscape(data.categoria) : 'MercadoLibre Argentina')+
      '</div></div></div>'+
      '<div class="hhd-grid cols-2">'+
        kpiPos+
        '<div class="hhd-kpi"><b>'+nf.format(total)+'</b><span>B&uacute;squedas del ranking</span></div>'+
      '</div>'+
      chips+
      '<div class="hhd-foot">'+pie+'</div>';
    if(tsWrap) tsWrap.style.display='';
    hhdStartTimer(now);
    if(ctaEl) ctaEl.style.display='';
    if(window.mcTrack) window.mcTrack('demo_hero_ejecutada',{producto:product,resultado:'ok'});
  }catch(e){
    hhdError(product, e && e.message);
    if(window.mcTrack) window.mcTrack('demo_hero_ejecutada',{producto:product,resultado:'sin_datos'});
  }finally{
    if(btn) btn.disabled=false;
  }
}
(function(){
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',function(){ runHeroDemo('auriculares bluetooth'); }); }
  else { runHeroDemo('auriculares bluetooth'); }
})();

// ===== COMBOBOX DE NICHOS (Task 8) =====
(function(){
  var NICHOS = [
    {v:'tecnologia',l:'Tecnología / Gadgets'},
    {v:'hogar',l:'Hogar y Deco'},
    {v:'deportes',l:'Deportes / Fitness'},
    {v:'moda',l:'Moda / Indumentaria'},
    {v:'mascotas',l:'Mascotas'},
    {v:'bebes',l:'Bebés / Niños'},
    {v:'belleza',l:'Salud y Belleza'},
    {v:'cocina',l:'Cocina / Gastronomía'},
    {v:'automotor',l:'Automotor / Moto'},
    {v:'herramientas',l:'Herramientas / Bricolaje'},
    {v:'camping',l:'Camping / Outdoor'},
    {v:'oficina',l:'Papelería / Oficina'},
    {v:'domotica',l:'Domótica / Casa Inteligente'},
    {v:'jardineria',l:'Jardinería / Plantas'},
    {v:'joyeria',l:'Joyería / Bijouterie'},
    {v:'relojes',l:'Relojes'},
    {v:'iluminacion',l:'Iluminación / LED'},
    {v:'gaming',l:'Gaming / Consolas'},
    {v:'ferreteria',l:'Ferretería / Construcción'},
    {v:'musica',l:'Música / Instrumentos'},
    {v:'arte',l:'Arte / Manualidades'},
    {v:'energiasolar',l:'Energía Solar / Portátil'},
    {v:'fotografia',l:'Fotografía / Drones'},
    {v:'viajes',l:'Viajes / Valijas'},
    {v:'libreria',l:'Librería / Libros'},
    {v:'juguetes',l:'Juguetes / Juegos'},
    {v:'audio',l:'Audio / Parlantes'},
    {v:'celulares',l:'Celulares / Accesorios'},
    {v:'informatica',l:'Informática / PC'},
    {v:'electrodomesticos',l:'Electrodomésticos'},
    {v:'climatizacion',l:'Climatización / Ventilación'},
    {v:'pesca',l:'Pesca / Náutica'},
    {v:'bicicletas',l:'Bicicletas / Ciclismo'},
    {v:'sexshop',l:'Sex Shop / Intimidad'},
    {v:'esoterismo',l:'Esoterismo / Velas'},
    {v:'seguridad',l:'Seguridad / Cámaras'},
    {v:'pintura',l:'Pinturería'},
    {v:'textil',l:'Textil / Merceria'},
    {v:'calzado',l:'Calzado / Zapatillas'},
    {v:'reposteria',l:'Repostería / Panadería'},
    {v:'vinos',l:'Vinos / Bebidas'},
    {v:'limpieza',l:'Limpieza / Hogar'},
    {v:'organizacion',l:'Organización / Guardado'},
    {v:'maquillaje',l:'Maquillaje / Uñas'},
    {v:'cuidadopersonal',l:'Cuidado Personal'},
    {v:'suplementos',l:'Suplementos / Nutrición'},
    {v:'tejido',l:'Tejido / Lana'},
    {v:'agro',l:'Agro / Campo'},
    {v:'motos',l:'Motos / Repuestos'},
    {v:'ferrmanuales',l:'Herramientas Manuales'},
    {v:'maternidad',l:'Maternidad / Embarazo'},
    {v:'pilates',l:'Yoga / Pilates'},
    {v:'coleccionables',l:'Coleccionables / Figuras'},
    {v:'drones',l:'Drones / RC'},
    {v:'smartwatch',l:'Smartwatch / Wearables'},
    {v:'bazar',l:'Bazar / Vajilla'},
    {v:'muebles',l:'Muebles'},
    {v:'decoracion',l:'Decoración / Cuadros'},
    {v:'plantas',l:'Plantas / Suculentas'},
    {v:'mate',l:'Mate / Termos'},
    {v:'fitness',l:'Running / Fitness'},
    {v:'natacion',l:'Natación / Pileta'},
    {v:'golf',l:'Golf'},
    {v:'festejos',l:'Cotillón / Fiestas'}
  ];
  var TOP8 = ['tecnologia','hogar','celulares','deportes','moda','mascotas','bebes','gaming'];
  var byValue = {};
  NICHOS.forEach(function(n){ byValue[n.v] = n.l; });

  var sel = document.getElementById('selNicho');
  var input = document.getElementById('nichoCombo');
  var listbox = document.getElementById('nichoListbox');
  var chipsWrap = document.getElementById('nichoChips');
  if(!sel || !input || !listbox) return;

  // Poblar el <select> real (backwards-compatible con todo el codigo que ya lee su .value)
  sel.innerHTML = NICHOS.map(function(n){ return '<option value="'+n.v+'">'+n.l+'</option>'; }).join('');

  function selectNicho(v, skipInputSync){
    sel.value = v;
    try{ sel.dispatchEvent(new Event('change', {bubbles:true})); }catch(e){}
    if(!skipInputSync) input.value = byValue[v] || '';
    chipsWrap.querySelectorAll('.nicho-chip').forEach(function(c){ c.classList.toggle('is-active', c.dataset.v===v); });
    closeListbox();
  }

  function renderChips(){
    chipsWrap.innerHTML = TOP8.map(function(v){
      return '<button type="button" class="nicho-chip" data-v="'+v+'">'+byValue[v]+'</button>';
    }).join('');
    chipsWrap.querySelectorAll('.nicho-chip').forEach(function(c){
      c.addEventListener('click', function(){ selectNicho(c.dataset.v); });
    });
  }

  function openListbox(items){
    listbox.innerHTML = items.length ? items.map(function(n,i){
      return '<li class="combo-opt" role="option" id="nicho-opt-'+i+'" data-v="'+n.v+'">'+n.l+'</li>';
    }).join('') : '<li class="combo-empty">Sin resultados. Probá con otra palabra.</li>';
    listbox.hidden = false;
    input.setAttribute('aria-expanded','true');
    listbox.querySelectorAll('.combo-opt').forEach(function(li){
      li.addEventListener('mousedown', function(ev){
        ev.preventDefault();
        selectNicho(li.dataset.v);
      });
    });
  }
  function closeListbox(){
    listbox.hidden = true;
    input.setAttribute('aria-expanded','false');
    input.removeAttribute('aria-activedescendant');
  }
  function filterNichos(q){
    q = (q||'').toLowerCase().trim();
    if(!q) return [];
    return NICHOS.filter(function(n){ return n.l.toLowerCase().indexOf(q) > -1; }).slice(0,20);
  }

  input.addEventListener('input', function(){
    var q = input.value;
    if(!q.trim()){ closeListbox(); return; }
    openListbox(filterNichos(q));
  });
  input.addEventListener('focus', function(){
    if(input.value.trim()) openListbox(filterNichos(input.value));
  });
  input.addEventListener('keydown', function(ev){
    var opts = Array.prototype.slice.call(listbox.querySelectorAll('.combo-opt'));
    if(listbox.hidden || !opts.length){
      if(ev.key==='ArrowDown' && input.value.trim()){ openListbox(filterNichos(input.value)); }
      return;
    }
    var idx = opts.findIndex(function(o){ return o.classList.contains('is-active'); });
    if(ev.key==='ArrowDown'){
      ev.preventDefault();
      idx = (idx+1) % opts.length;
      opts.forEach(function(o){ o.classList.remove('is-active'); });
      opts[idx].classList.add('is-active');
      input.setAttribute('aria-activedescendant', opts[idx].id);
      opts[idx].scrollIntoView({block:'nearest'});
    } else if(ev.key==='ArrowUp'){
      ev.preventDefault();
      idx = idx<=0 ? opts.length-1 : idx-1;
      opts.forEach(function(o){ o.classList.remove('is-active'); });
      opts[idx].classList.add('is-active');
      input.setAttribute('aria-activedescendant', opts[idx].id);
      opts[idx].scrollIntoView({block:'nearest'});
    } else if(ev.key==='Enter'){
      ev.preventDefault();
      var chosen = idx>=0 ? opts[idx] : opts[0];
      if(chosen) selectNicho(chosen.dataset.v);
    } else if(ev.key==='Escape'){
      closeListbox();
    }
  });
  document.addEventListener('click', function(ev){
    if(!ev.target.closest('#nichoComboWrap') && ev.target!==input && !listbox.contains(ev.target)) closeListbox();
  });

  renderChips();
  var storedNicho = null;
  try{ storedNicho = localStorage.getItem('pf_nicho'); }catch(e){}
  selectNicho((storedNicho && byValue[storedNicho]) ? storedNicho : 'tecnologia', false);

  // La lista de arriba es solo el arranque offline. La lista REAL la define el
  // catalogo del backend: si el selector ofrece un nicho que /api/analyze no
  // tiene, el usuario elige y no recibe ningun producto. Apenas responde el
  // servidor, reemplazamos la lista local por la suya.
  (function sincronizarNichosConBackend(){
    var ctrl = null, corta = null;
    try{ ctrl = new AbortController(); corta = setTimeout(function(){ try{ ctrl.abort(); }catch(e){} }, 8000); }catch(e){}
    fetch('/api/analyze', ctrl ? { signal: ctrl.signal } : undefined)
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        if(corta) clearTimeout(corta);
        if(!d || !Array.isArray(d.nichos) || d.nichos.length < 5) return;
        var elegido = sel.value;
        NICHOS = d.nichos.map(function(n){ return { v:n.v, l:n.l }; });
        byValue = {};
        NICHOS.forEach(function(n){ byValue[n.v] = n.l; });
        sel.innerHTML = NICHOS.map(function(n){ return '<option value="'+n.v+'">'+n.l+'</option>'; }).join('');
        TOP8 = TOP8.filter(function(v){ return byValue[v]; });
        renderChips();
        selectNicho(byValue[elegido] ? elegido : NICHOS[0].v, false);
      })
      .catch(function(){ if(corta) clearTimeout(corta); /* sin red: queda la lista local */ });
  })();
})();

// ===== PRODUCTFINDER =====
async function doAnalyze(){
  const btn = document.getElementById('btnAnalyze');
  const params = {
    capital: document.getElementById('selCapital').value,
    experiencia: document.getElementById('selExperiencia').value,
    canal: document.getElementById('selCanal').value,
    nicho: document.getElementById('selNicho').value,
    riesgo: document.getElementById('selRiesgo').value,
    user_id: localStorage.getItem('pf_user') || ''
  };
  localStorage.setItem('pf_nicho', params.nicho);
  return (async function(){
    if(btn){ btn.disabled = true; btn.dataset.old = btn.innerHTML; btn.innerHTML = ' Analizando el mercado real...'; }
    const grid = document.getElementById('productsGrid');
    if(grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim)">Consultando precios y competencia en MercadoLibre...<br><small>Esto puede tardar unos segundos porque analizo 12 productos reales.</small></div>';
    const results = document.getElementById('resultsSection');
    if(results) results.style.display = 'block';
    try{
      var _cab = {'Content-Type':'application/json'};
      try{ var _tk = localStorage.getItem('pf_token'); if(_tk) _cab['Authorization'] = 'Bearer ' + _tk; }catch(e){}
      const res = await fetch('/api/analyze', { method:'POST', headers:_cab, body: JSON.stringify(params) });
      const data = await res.json();
      if(!res.ok){ throw new Error(data.error || 'Error al analizar'); }
      window.__lastAnalysis = data;
      renderResults(data);
    }catch(err){
        if (window.__v7showError) { window.__v7showError(err && err.message ? err.message : ''); }
        else if (grid) { grid.innerHTML = '<div class="v7-errcard"><span class="v7-ico"><svg class="ic" aria-hidden="true"><use href="#i-warn"></use></svg></span><h4>No pudimos completar el an\u00e1lisis</h4><div class="v7-what">Ocurri\u00f3 algo inesperado, pero tiene soluci\u00f3n. Prob\u00e1 de nuevo en unos segundos.</div></div>'; }
      }finally{
      if(btn){ btn.disabled = false; btn.innerHTML = btn.dataset.old || '<svg class="ic" aria-hidden="true"><use href="#i-rocket"></use></svg> Analizar Productos'; }
    }
  })();
}

function unlockResults(){
  const email=document.getElementById('emailInput').value.trim();
  if(!email||!email.includes('@')){alert('Ingres&#225; un email v&#225;lido');return;}
  document.getElementById('emailGate').style.display='none';
  renderResults(analysisResults);
}

function renderResults(data){
  const grid = document.getElementById('productsGrid');
  if(!grid) return;
  const products = (data && data.products) || [];
  const nf = new Intl.NumberFormat('es-AR');
  let banner = '';
  if(data.nichoAproximado && data.nichoSolicitado){
    banner += '<div class="ml-banner" style="grid-column:1/-1;background:rgba(255,255,255,.06);border:1px solid var(--border,#333);border-radius:10px;padding:10px 14px;margin-bottom:8px;color:var(--text)">No tengo un cat&#225;logo propio para <strong>'+String(data.nichoSolicitado).replace(/[<>&]/g,'')+'</strong>, as&#237; que te muestro <strong>'+data.nichoLabel+'</strong>, que es lo m&#225;s parecido que puedo analizar hoy.</div>';
  }
  if(!data.meliConectado){
    const motivo = data.meliTokenExpirado ? 'tu conexi&#243;n con MercadoLibre expir&#243;' : 'no ten&#233;s MercadoLibre conectado';
    banner += '<div class="ml-banner" style="grid-column:1/-1;background:rgba(255,230,0,.12);border:1px solid var(--gold);border-radius:10px;padding:14px 16px;margin-bottom:8px;color:var(--text)"><strong><svg class="ic" aria-hidden="true"><use href="#i-warn"></use></svg> Precios estimados:</strong> como '+motivo+', muestro los productos ordenados por su potencial (peso, margen esperado y estacionalidad), pero <strong>sin precios de venta reales</strong>. Conecta tu cuenta para ver precio, competencia y saturaci&#243;n reales de cada producto. <a href="/meli-connect.html" style="color:var(--gold);font-weight:700">Conectar MercadoLibre \u2192</a></div>';
  } else {
    banner += '<div class="ml-banner" style="grid-column:1/-1;background:rgba(39,174,96,.12);border:1px solid var(--green);border-radius:10px;padding:12px 16px;margin-bottom:8px;color:var(--text)"><svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg> Datos reales de MercadoLibre. Analizamos <strong>'+data.totalEvaluados+'</strong> productos, <strong>'+data.conDatoReal+'</strong> con datos de mercado en vivo. Cotizacion usada: 1 USD \u2248 $'+nf.format(data.usdArs)+'.</div>';
  }
  const cards = products.map(function(p){
    const real = p.score != null;
    const scorePct = real ? p.score : 0;
    const precio = p.precioVentaARS != null ? ('$'+nf.format(p.precioVentaARS)) : 'A validar';
    const costo = '$'+nf.format(Math.round(p.costoPuestoARS)) + ' aprox.';
    const margen = p.margen != null ? (p.margen+'%') : '\u2014';
        const sellers = (p.competencia != null ? nf.format(p.competencia) + ' pub.' : (p.sellers != null ? nf.format(p.sellers) + ' pub.' : '\u2014'));
    const fuenteTag = real ? '<span class="tag-real" title="Precio y competencia obtenidos en vivo de MercadoLibre"><svg class="ic" aria-hidden="true"><use href="#i-dot"></use></svg> Dato real ML</span>' : '<span class="tag-est" title="Sin precio real: conecta MercadoLibre para activarlo"><svg class="ic" aria-hidden="true"><use href="#i-dot"></use></svg> Estimado</span>';
    // El buscador de oportunidades es un barrido y NO paga por traer
    // publicaciones. Cuando las vias gratuitas no dan, se dice por que y se
    // manda al Market Reader, que es donde el dato real si se trae. Antes esto
    // salia como "A validar" pelado y se leia como si el sistema hubiera
    // mirado el mercado y no hubiera encontrado nada.
    const sinComp = p.competenciaSinDatos
      ? '<div class="pf-sin-comp" style="margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);font-size:.78rem;line-height:1.45;color:var(--text-dim)">'+
        '<strong style="color:var(--text)">Competencia sin datos:</strong> MercadoLibre no permite consultarla gratis. '+
        'Analiz&aacute; el producto en el <a href="#" class="pf-ir-mr" data-q="'+String(p.query||p.nombre||'').replace(/"/g,'&quot;')+'">Market Reader</a> para traer las publicaciones reales.'+
        '</div>'
      : '';
    return '<div class="product-card '+(p.topPick?'top-pick':'')+'">'+(p.topPick ? '<span class="top-badge"><svg class="ic" aria-hidden="true"><use href="#i-star"></use></svg> TOP PICK</span>' : '')+'<div class="product-name">'+p.nombre+'</div><div style="margin-bottom:10px">'+fuenteTag+' <span class="tag-info" title="Por que es apto para regimen de importacion">'+p.nota+'</span></div>'+(real ? '<div class="score-row"><span>Score</span><strong>'+p.score+'/100</strong></div><div class="score-bar"><div class="score-fill" style="width:'+scorePct+'%"></div></div>' : '')+'<div class="product-stats"><div class="stat"><span class="stat-l" title="Precio promedio de venta en MercadoLibre">Precio venta</span><span class="stat-v">'+precio+'</span></div><div class="stat"><span class="stat-l" title="Costo estimado del producto puesto en Argentina (FOB China + logistica + impuestos)">Costo est.</span><span class="stat-v">'+costo+'</span></div><div class="stat"><span class="stat-l" title="Ganancia sobre el costo estimado">Margen</span><span class="stat-v">'+margen+'</span></div><div class="stat"><span class="stat-l" title="Publicaciones activas compitiendo en MercadoLibre (dato real)">Competencia</span><span class="stat-v">'+sellers+'</span></div><div class="stat"><span class="stat-l" title="Nivel de demanda del producto">Demanda</span><span class="stat-v">'+p.demanda+'</span></div><div class="stat"><span class="stat-l" title="Cuan saturado esta el mercado. Baja = mejor oportunidad">Saturacion</span><span class="stat-v">'+p.saturacion+'</span></div></div><div class="risk-line risk-'+String(p.riesgo).toLowerCase().replace(/[^a-z]/g,'')+'">Riesgo: '+p.riesgo+'</div>'+sinComp+'</div>';
  }).join('');
  // El servidor manda solo los productos que corresponden. Si sobran, dibujamos
  // el candado con tarjetas vacias: ya no hay datos reales escondidos en el DOM.
  var bloqueados = 0;
  if(data && data.esCliente === false && data.productosTotales > products.length){
    bloqueados = data.productosTotales - products.length;
  }
  var candado = '';
  if(bloqueados > 0){
    var lista = '';
    for(var _b=0; _b<bloqueados; _b++){
      lista += '<div class="product-card pf-bloqueada" aria-hidden="true"><div class="pf-bl-linea"></div><div class="pf-bl-linea corta"></div><div class="pf-bl-grid"><span></span><span></span><span></span><span></span></div></div>';
    }
    candado = lista +
      '<div class="pf-candado" role="note">' +
        '<div class="pf-candado-ico"><svg class="ic" aria-hidden="true"><use href="#i-lock"></use></svg></div>' +
        '<h4>Te faltan ' + bloqueados + ' productos de este rubro</h4>' +
        '<p>Est&aacute;s viendo los ' + products.length + ' primeros de ' + data.productosTotales + '. Los clientes de asesor&iacute;a ven la lista completa, con el margen detallado y la validaci&oacute;n del proveedor.</p>' +
        '<button class="pf-candado-btn" type="button" id="pfCandadoBtn"><svg class="ic" aria-hidden="true"><use href="#i-rocket"></use></svg> Ver c&oacute;mo trabajamos</button>' +
      '</div>';
  }
  grid.innerHTML = banner + cards + candado;
  // El link "Market Reader" arranca el flujo con ese producto ya escrito, para
  // que el usuario no tenga que volver a tipearlo.
  Array.prototype.forEach.call(grid.querySelectorAll('.pf-ir-mr'), function(a){
    a.style.color = 'var(--gold)'; a.style.fontWeight = '700';
    a.onclick = function(ev){
      ev.preventDefault();
      var q = this.getAttribute('data-q') || '';
      try{
        if(typeof showMarket === 'function') showMarket();
        var inp = document.getElementById('mrProductInput');
        if(inp){ inp.value = q; inp.focus(); }
      }catch(e){}
    };
  });
  var _cb = document.getElementById('pfCandadoBtn');
  if(_cb) _cb.addEventListener('click', function(){
    var cs = document.querySelector('.contact-section');
    if(cs) cs.scrollIntoView({behavior:'smooth', block:'center'});
  });
}

function exportPDF(){
  if(!analysisResults)return;
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF();
  doc.setFontSize(18);doc.text('Lectura de Mercado - An&#225;lisis de Importaci&#243;n',14,20);
  doc.setFontSize(11);doc.text('Generado: '+new Date().toLocaleDateString('es-AR'),14,30);
  let y=45;
  analysisResults.forEach((p,i)=>{
    doc.setFontSize(13);doc.text((i+1)+'. '+p.nombre+(p.topPick?' (TOP PICK)':''),14,y);y+=7;
    doc.setFontSize(10);
    doc.text('Score: '+p.score+'/100 | Margen: '+p.margen+'% | Demanda: '+p.demanda+' | Riesgo: '+p.riesgo,14,y);y+=6;
    const lines=doc.splitTextToSize(p.justificacion,180);
    doc.text(lines,14,y);y+=lines.length*5+8;
  });
  doc.save('productfinder-analisis.pdf');
}

async function sendChat(){
  const inp=document.getElementById('chatInput');
  const msg=inp.value.trim();
  if(!msg)return;
  inp.value='';
  const box=document.getElementById('chatBox');
  const userDiv=document.createElement('div');
  userDiv.className='msg user';userDiv.textContent=msg;box.appendChild(userDiv);
  box.scrollTop=box.scrollHeight;
  const thinking=document.createElement('div');
  thinking.className='msg bot';thinking.textContent='...';box.appendChild(thinking);
  try{
    const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,context:analysisResults?JSON.stringify(analysisResults):null})});
    const data=await res.json();
    // La API devuelve {response}, no {reply}: con la clave equivocada el chat
    // mostraba siempre "No pude procesar tu consulta.", aunque la respuesta
    // hubiera llegado bien.
    if(data && data.requiereSesion){
      thinking.textContent = data.error || 'Para usar el asesor IA hace falta iniciar sesion.';
    } else {
      thinking.textContent = data.response || data.reply || data.error || 'No pude procesar tu consulta.';
    }
  }catch(e){thinking.textContent='Error de conexi&#243;n.';}
  box.scrollTop=box.scrollHeight;
}
// ===== ANALYSIS HISTORY =====
// (Se elimino generateCompetitors(): fabricaba nombres, precios y ventas de
//  competidores con Math.random(). Estaba sin usar, pero la regla del producto
//  es que los competidores salen de MercadoLibre o no se muestran.)

function getHistory(){
  try{return JSON.parse(localStorage.getItem(HISTORY_KEY))||[];}catch(e){return[];}
}

function saveToHistory(entry){
  const hist=getHistory();
  const existing=hist.findIndex(h=>h.product===entry.product&&h.date===entry.date);
  if(existing>=0)hist.splice(existing,1);
  hist.unshift(entry);
  if(hist.length>MAX_HISTORY)hist.splice(MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY,JSON.stringify(hist));
}

function renderHistory(){
  const hist=getHistory();
  const container=document.getElementById('historyList');
  if(!hist.length){
    container.innerHTML='<div class="history-empty">No hay an&#225;lisis guardados a&#250;n.<br>Hac&#233; tu primer an&#225;lisis para verlo aqu&#237;.</div>';
    return;
  }
  container.innerHTML=hist.map((h,i)=>`<div class="history-item" onclick="loadHistoryItem(${i})"><div class="history-item-top"><span class="history-item-name">${h.product}</span><span class="history-item-date">${new Date(h.date).toLocaleDateString('es-AR')}</span></div><div class="history-item-stats"><span class="history-stat">Score: <strong>${h.score}/100</strong></span><span class="history-stat">Margen: <strong>${h.margenPct}%</strong></span><span class="history-stat">Veredicto: <strong>${h.veredicto}</strong></span><button class="history-redo" onclick="event.stopPropagation(); window.__redoAnalysis && window.__redoAnalysis(${i})" style="margin-left:auto;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,215,128,.4);background:rgba(255,215,128,.08);color:inherit;cursor:pointer;font-size:11px;font-weight:600;"><svg class="ic" aria-hidden="true"><use href="#i-refresh"></use></svg> Rehacer</button></div></div>`).join('');
}

function clearHistory(){
  if(!confirm('&#191;Eliminar todo el historial de an&#225;lisis?'))return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function loadHistoryItem(idx){
  const hist=getHistory();
  const item=hist[idx];
  if(!item)return;
  document.getElementById('mrProductInput').value=item.product;
  document.getElementById('mrTipoCambio').value=item.tc||1250;
  toggleHistory();
  mrData=item.mrData||{};
  document.getElementById('mrResult').classList.add('visible');
  document.getElementById('mrResultProduct').textContent=item.product;
  mcCountUp(document.getElementById('gaugeScore'), item.score);
  document.getElementById('gaugeLabel').textContent=item.score>=65?'Viabilidad alta':item.score>=40?'Viabilidad media':'Viabilidad baja';
  document.getElementById('mrVeredictoTitle').textContent=item.veredicto;
  document.getElementById('mrVeredictoText').textContent=item.analisisTexto||'';
  const vBox=document.getElementById('mrVeredictoBox');
  vBox.className='mr-veredicto';
  if(item.veredicto==='<svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg> VIABLE'){vBox.classList.add('mv-si');document.getElementById('mrVeredictoTitle').style.color='var(--green)';}
  else if(item.veredicto==='<svg class="ic" aria-hidden="true"><use href="#i-x"></use></svg> NO RECOMENDADO'){vBox.classList.add('mv-no');document.getElementById('mrVeredictoTitle').style.color='var(--red)';}
  else{vBox.classList.add('mv-cond');document.getElementById('mrVeredictoTitle').style.color='var(--gold)';}
  if(item.scores){const icons=['<svg class="ic" aria-hidden="true"><use href="#i-trend"></use></svg>','<svg class="ic" aria-hidden="true"><use href="#i-store"></use></svg>','<svg class="ic" aria-hidden="true"><use href="#i-money"></use></svg>','<svg class="ic" aria-hidden="true"><use href="#i-scale"></use></svg>'];item.scores.forEach((s,i)=>renderFactorCard(i+1,s.score,s.label,icons[i]||'&#8226;'));}
  if(item.mrData&&item.mrData.step4){renderWaterfall(item.mrData.step4,item.tc||1250);}
  document.getElementById('mrAnalysisText').textContent=item.analisisCompleto||'';
  drawSavedCharts(item);
}

function drawSavedCharts(item){
  if(item.chartData){
    const tc=item.chartData;
    if(tc.trendData&&window.Chart){
      const trendCtx=document.getElementById('trendsChart');
      if(window._trendsChart)window._trendsChart.destroy();
      const months=['Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic','Ene','Feb','Mar'];
      const bandUpper=tc.trendData.map(v=>Math.min(100,v+12));
      const bandLower=tc.trendData.map(v=>Math.max(5,v-12));
      window._trendsChart=new Chart(trendCtx,{type:'line',data:{labels:months,datasets:[
        {data:bandUpper,borderColor:'rgba(255,230,0,0.08)',borderWidth:1,fill:'-1',backgroundColor:'rgba(255,230,0,0.06)',tension:0.4,pointRadius:0},
        // Punteada cuando la demanda es estimacion de IA: la linea solida se
        // reserva para lo que se midio de verdad (Google Trends).
        {data:tc.trendData,borderColor:'#FFE600',borderWidth:2.5,borderDash:(typeof mrData!=='undefined'&&mrData&&mrData.step1&&mrData.step1.fuenteDemanda==='google-trends')?[]:[6,4],backgroundColor:'rgba(255,230,0,0.12)',fill:true,tension:0.4,pointRadius:3,pointBackgroundColor:'#FFE600'},
        {data:bandLower,borderColor:'rgba(255,230,0,0.08)',borderWidth:1,fill:'-1',backgroundColor:'rgba(255,230,0,0.06)',tension:0.4,pointRadius:0}
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false,backgroundColor:'rgba(0,0,0,0.85)',titleColor:'#FFE600',bodyColor:'#F6F6F4',borderColor:'#FFE600',borderWidth:1}},scales:{x:{ticks:{color:'#92929A',font:{size:9}},grid:{color:'rgba(255,255,255,0.04)'}},y:{min:0,max:100,ticks:{color:'#92929A',font:{size:9}},grid:{color:'rgba(255,255,255,0.04)'}}}}});
    }
    if(tc.meliData){
      const meliCtx=document.getElementById('meliChart');
      if(window._meliChart)window._meliChart.destroy();
      window._meliChart=new Chart(meliCtx,{type:'bar',data:{labels:['Precio m&#237;n','Precio prom','Precio m&#225;x'],datasets:[{data:tc.meliData,backgroundColor:['rgba(41,128,185,0.7)','rgba(255,230,0,0.7)','rgba(39,174,96,0.7)'],borderColor:['#2980b9','#FFE600','#27ae60'],borderWidth:1.5,borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>'ARS '+ctx.parsed.x.toLocaleString('es-AR')}}},scales:{x:{ticks:{color:'#92929A',font:{size:9},callback:v=>v>=1000?'$'+(v/1000).toFixed(0)+'k':'$'+v},grid:{color:'rgba(255,255,255,0.04)'}},y:{ticks:{color:'#92929A',font:{size:10}},grid:{display:false}}}}});
    }
    if(tc.waterfallData){
      const wfCtx=document.getElementById('waterfallChart');
      if(window._waterfallChart)window._waterfallChart.destroy();
      const wd=tc.waterfallData;
      const labels=['FOB','Flete','Aranceles','Despacho','Comisi&#243;n'];
      const vals=[wd.fob,-wd.flete,-wd.aranceles,-wd.despacho,-wd.comision];
      const colors=vals.map(v=>v>=0?'rgba(39,174,96,0.7)':'rgba(192,57,43,0.7)');
      window._waterfallChart=new Chart(wfCtx,{type:'bar',data:{labels, datasets:[{label:'Costos e ingreso (ARS)',data:vals,backgroundColor:colors,borderColor:colors.map(c=>c.replace('0.7','1')),borderWidth:1.5,borderRadius:4,barThickness:28}],options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>{const v=ctx.parsed.y;return(v>=0?'+':'')+'USD '+Math.abs(v).toFixed(2);}}},annotation:{}}},scales:{x:{ticks:{color:'#92929A',font:{size:9}},grid:{display:false}},y:{ticks:{color:'#92929A',font:{size:9},callback:v=>'$'+v},grid:{color:'rgba(255,255,255,0.04)'}}}}});
    }
  }
}

function toggleHistory(){
  const panel=document.getElementById('historyPanel');
  const btn=document.getElementById('btnHistory');
  panel.classList.toggle('visible');
  btn.classList.toggle('active',panel.classList.contains('visible'));
  if(panel.classList.contains('visible'))renderHistory();
}
// ===== MARKET READER =====
    // ===== Lectura por LINK de producto =====
    let mrLastProductData=null;
    async function analyzeProductUrl(){
      const input=document.getElementById('mrUrlInput');
      const url=(input.value||'').trim();
      const card=document.getElementById('mrProductCard');
      const errBox=document.getElementById('mrUrlError');
      const btn=document.getElementById('btnUrlAnalyze');
      errBox.style.display='none';errBox.textContent='';
      if(!url){errBox.textContent='Peg&#225; un link de producto primero.';errBox.style.display='block';return;}
      btn.disabled=true;btn.textContent='Leyendo...';
      card.style.display='block';
      card.innerHTML='<div style="color:#9a9a9a;padding:14px;text-align:center"> Leyendo el producto desde la fuente original...</div>';
      try{
        const res=await fetch('/api/market',{method:'POST',headers:mrCabeceras(),body:JSON.stringify({step:'productUrl',url})});
        const r=await res.json();
        if(!res.ok||r.error){
          card.style.display='none';
          errBox.textContent=(r.error||'Error desconocido')+(r.hint?(' '+r.hint):'');
          errBox.style.display='block';
          return;
        }
        mrLastProductData=r;
        renderProductCard(r);
      }catch(e){
        card.style.display='none';
        errBox.textContent='Error de red al leer el link: '+e.message;
        errBox.style.display='block';
      }finally{
        btn.disabled=false;btn.textContent='Leer link';
      }
    }

    function renderProductCard(r){
      const card=document.getElementById('mrProductCard');

      // 7.b) Cuando la lectura fallo se dice, en vez de mostrar los campos
      //      vacios como si se hubiera leido algo. Alibaba bloquea la lectura
      //      automatica desde el servidor y eso no se puede arreglar desde
      //      Vercel: lo que si se puede es avisarlo y dejar cargar a mano.
      if(r.lecturaFallida){
        const esAli=r.fuente==='alibaba';
        card.innerHTML=`
          <div style="padding:14px;border:1px solid #e0a020;border-radius:10px;background:rgba(224,160,32,.10)">
            <div style="font-weight:700;color:#f0c877;margin-bottom:6px">No pude leer esta p&#225;gina${esAli?' de Alibaba':''}</div>
            <div style="font-size:.88rem;color:#e8c89f;line-height:1.5">${esAli?'Alibaba bloquea la lectura autom&#225;tica desde el servidor. Carg&#225; el producto a mano: peg&#225; el t&#237;tulo y el precio FOB que veas en la p&#225;gina.':(r.motivo||'La p&#225;gina no dej&#243; leerla desde el servidor.')+' Carg&#225; el producto a mano.'}</div>
            ${r.detalle?`<div style="font-size:.76rem;color:#b89a6f;margin-top:6px">Detalle t&#233;cnico: ${r.detalle}</div>`:''}
          </div>
          <div style="margin-top:12px;padding:12px;border:1px dashed #4a3d1d;border-radius:8px;background:#1a1606">
            <div style="font-weight:600;color:#FFE600;margin-bottom:10px">Carg&#225; el producto a mano</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
              <div style="grid-column:1/-1"><label style="font-size:.82rem;color:#bbb">T&#237;tulo del producto (como figura en la p&#225;gina)</label><input type="text" id="mrLinkTitulo" placeholder="Ej: Mini projector 1080p Android" style="width:100%;margin-top:4px"/></div>
              <div><label style="font-size:.82rem;color:#bbb">Precio FOB (USD/unidad)</label><input type="number" step="0.01" min="0" id="mrLinkFOB" placeholder="Ej: 12.50" style="width:100%;margin-top:4px"/></div>
              <div><label style="font-size:.82rem;color:#bbb">MOQ (unidades)</label><input type="number" step="1" min="1" id="mrLinkMOQ" placeholder="Ej: 100" style="width:100%;margin-top:4px"/></div>
              <div><label style="font-size:.82rem;color:#bbb">Peso/unidad (kg)</label><input type="number" step="0.01" min="0" id="mrLinkPeso" placeholder="Ej: 0.25" style="width:100%;margin-top:4px"/></div>
            </div>
            <div style="font-size:.78rem;color:#b89a6f;margin-top:8px">Sin el peso no puedo evaluar si el flete se come el producto.</div>
          </div>
          <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-mr-analyze" onclick="useProductForMarketRead()">Hacer lectura de mercado de este producto</button>
            <button class="btn-outline-dim" style="padding:8px 14px" onclick="clearProductCard()">Limpiar</button>
          </div>`;
        return;
      }

      const fuenteNombre=r.fuente&&r.fuente.indexOf('mercadolibre')===0?'MercadoLibre Argentina':(r.fuente==='alibaba'?'Alibaba':'Otra fuente');
      const realBadge=r.realData
        ?'<span style="background:#1d4d1d;color:#9fe89f;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600">Dato real (API oficial)</span>'
        :'<span style="background:#4d3d1d;color:#e8c89f;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600">Datos parciales</span>';
      const titulo=r.titulo||r['título']||'';
      const descripcion=r.descripcion||r['descripción']||'';
      const img=r.imagen?`<img src="${r.imagen}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:8px;background:#1a1a1a"/>`:'<div style="width:120px;height:120px;background:#1a1a1a;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#555">sin foto</div>';
      let precioHtml='';
      if(r.fuente&&r.fuente.indexOf('mercadolibre')===0&&r.precio!=null){
        precioHtml=`<div style="font-size:1.3rem;color:#FFE600;font-weight:700;margin-top:4px">${r.moneda||'ARS'} ${Number(r.precio).toLocaleString('es-AR')}</div>`;
      }
      let metaHtml='';
      if(r.fuente&&r.fuente.indexOf('mercadolibre')===0){
        const cond=r.condicion==='new'?'Nuevo':(r.condicion==='used'?'Usado':r.condicion||'');
        metaHtml=`<div style="font-size:0.85rem;color:#9a9a9a;margin-top:6px">${cond}${r.vendidos!=null?' &#183; '+r.vendidos+' vendidos':''}${r.disponibles!=null?' &#183; '+r.disponibles+' disponibles':''}</div>`;
      }

      // 7.d) El termino de busqueda castellano es lo que va al buscador de
      //      MeLi, no el titulo crudo en ingles. Se muestran los dos y el
      //      termino queda editable.
      const term=r.terminoBusqueda||titulo;
      const termFuente=r.terminoBusquedaFuente==='ia-nombrarProductos'
        ? 'traducido al t&#233;rmino con el que se busca en MeLi'
        : 'no pude traducirlo: es el t&#237;tulo original recortado';
      const terminoHtml=`
        <div style="margin-top:12px;padding:12px;border:1px solid #2a2a2a;border-radius:8px;background:#0f0f0f">
          <div style="font-size:.82rem;color:#9a9a9a;margin-bottom:6px">Producto: <span style="color:#ddd">${titulo||'(sin t&#237;tulo)'}</span></div>
          <label style="font-size:.82rem;color:#bbb;display:block;margin-bottom:4px">Busco en MeLi como <span style="opacity:.7">(${termFuente} &#183; editable)</span></label>
          <input type="text" id="mrTerminoBusqueda" value="${String(term).replace(/"/g,'&quot;')}" style="width:100%"/>
        </div>`;

      // 7.c) El rango de precio leido del HTML no se autocompleta nunca: es
      //      el primer "$X - $Y" del documento, sin saber a que tramo de
      //      cantidad corresponde. Va como sugerencia con boton de aceptar.
      let sugerenciaFOB='';
      if(r.precioSugeridoMin!=null){
        sugerenciaFOB=`
          <div style="margin-top:12px;padding:12px;border:1px dashed #e0a020;border-radius:8px;background:rgba(224,160,32,.08)">
            <div style="font-size:.86rem;color:#f0c877;line-height:1.5">En la p&#225;gina vi un rango <b>USD ${r.precioSugeridoMin} &#8211; ${r.precioSugeridoMax}</b>. &#191;Es el precio de tu tramo de cantidad?</div>
            <div style="font-size:.76rem;color:#b89a6f;margin:6px 0 8px">No lo cargo solo: el rango sale del primer precio que aparece en el HTML y puede ser de otro producto o de otro tramo.</div>
            <button class="btn-outline-dim" style="padding:6px 12px;font-size:.82rem" onclick="aceptarFOBSugerido(${r.precioSugeridoMin})">S&#237;, usar USD ${r.precioSugeridoMin} como FOB</button>
          </div>`;
      }

      const manualAli=r.fuente==='alibaba'?`
        <div style="margin-top:12px;padding:12px;border:1px dashed #4a3d1d;border-radius:8px;background:#1a1606">
          <div style="font-weight:600;color:#FFE600;margin-bottom:10px">Complet&#225; los datos de Alibaba</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
            <div><label style="font-size:.82rem;color:#bbb">Precio FOB (USD/unidad)</label><input type="number" step="0.01" min="0" id="mrLinkFOB" placeholder="Ej: 12.50" style="width:100%;margin-top:4px"/></div>
            <div><label style="font-size:.82rem;color:#bbb">MOQ (unidades)</label><input type="number" step="1" min="1" id="mrLinkMOQ" placeholder="Ej: 100" style="width:100%;margin-top:4px"/></div>
            <div><label style="font-size:.82rem;color:#bbb">Peso/unidad (kg)</label><input type="number" step="0.01" min="0" id="mrLinkPeso" placeholder="Ej: 0.25" style="width:100%;margin-top:4px"/></div>
          </div>
          <div style="font-size:.78rem;color:#b89a6f;margin-top:8px">Sin el peso no puedo evaluar si el flete se come el producto.</div>
        </div>`:'';

      const desc=descripcion?`<div style="margin-top:10px;padding:10px;background:#0a0a0a;border-radius:6px;font-size:0.85rem;color:#bbb;max-height:120px;overflow:auto">${descripcion.substring(0,500)}${descripcion.length>500?'...':''}</div>`:'';
      card.innerHTML=`
        <div style="display:flex;gap:14px;align-items:flex-start;padding:12px;border:1px solid #2a2a2a;border-radius:10px;background:#0a0a0a">
          ${img}
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px"><span style="font-size:0.78rem;color:#888">${fuenteNombre}</span>${realBadge}</div>
            <div style="font-weight:600;color:#fff;font-size:1rem;line-height:1.3">${titulo||'(sin t&#237;tulo)'}</div>
            ${precioHtml}
            ${metaHtml}
            ${r.permalink?`<div style="margin-top:8px"><a href="${r.permalink}" target="_blank" rel="noopener" style="font-size:0.8rem;color:#FFE600">Ver publicaci&#243;n original &#8599;</a></div>`:''}
          </div>
        </div>
        ${desc}
        ${terminoHtml}
        ${sugerenciaFOB}
        ${manualAli}
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-mr-analyze" onclick="useProductForMarketRead()">Hacer lectura de mercado de este producto</button>
          <button class="btn-outline-dim" style="padding:8px 14px" onclick="clearProductCard()">Limpiar</button>
        </div>`;
    }

    // El FOB nunca se autocompleta solo: entra por aca, con el usuario
    // confirmando que el rango leido corresponde a su tramo de cantidad.
    function aceptarFOBSugerido(v){
      const f=document.getElementById('mrFOB');
      if(f){ f.value=String(v); f.dispatchEvent(new Event('input',{bubbles:true})); }
      const lf=document.getElementById('mrLinkFOB');
      if(lf) lf.value=String(v);
      alert('Listo: FOB USD '+v+' cargado. Revisalo contra el tramo de cantidad que vas a comprar.');
    }
    window.aceptarFOBSugerido=aceptarFOBSugerido;

    function clearProductCard(){
      document.getElementById('mrProductCard').style.display='none';
      document.getElementById('mrProductCard').innerHTML='';
      document.getElementById('mrUrlInput').value='';
      mrLastProductData=null;
    }

    function useProductForMarketRead(){
      if(!mrLastProductData)return;
      const r=mrLastProductData;
      const titleInput=document.getElementById('mrProductInput');
      // Lo que va al buscador de MeLi es el termino castellano (editable por
      // el usuario), no el titulo crudo en ingles.
      const termEl=document.getElementById('mrTerminoBusqueda');
      const tituloManual=document.getElementById('mrLinkTitulo');
      let termino='';
      if(termEl&&termEl.value.trim()) termino=termEl.value.trim();
      else if(tituloManual&&tituloManual.value.trim()) termino=tituloManual.value.trim();
      else termino=r.terminoBusqueda||r.titulo||r['título']||'';
      if(titleInput&&termino)titleInput.value=termino;

      const fob=document.getElementById('mrLinkFOB');
      const moq=document.getElementById('mrLinkMOQ');
      const peso=document.getElementById('mrLinkPeso');
      if(fob&&fob.value){const f=document.getElementById('mrFOB');if(f)f.value=fob.value;}
      if(peso&&peso.value){const p=document.getElementById('mrPesoKg');if(p){p.value=peso.value;p.dispatchEvent(new Event('input',{bubbles:true}));}}
      if(moq&&moq.value){window.mrMOQ=parseInt(moq.value,10);}
      if(r.fuente&&r.fuente.indexOf('mercadolibre')===0&&r.precio!=null){
        window.mrPrecioReferenciaARS=r.precio;
        const pv=document.getElementById('mrPrecioVenta');
        if(pv&&!pv.value)pv.value=String(Math.round(r.precio));
      }
      if(!termino){alert('Cargá el título o el término de búsqueda antes de seguir.');return;}
      startMRAnalysis();
      setTimeout(()=>{const el=document.getElementById('mrStep1');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});},300);
    }

    function mrLoadingHTML(txt){return `<div class="mr-loading"><div class="dot-anim"><span></span><span></span><span></span></div><span>${txt}</span></div>`;}

async function startMRAnalysis(){
  const product=document.getElementById('mrProductInput').value.trim();
  if(!product){alert('Ingres&#225; un producto para analizar');return;}
  mrCurrentProduct=product;
  // Sin tipo de cambio no se calcula nada: antes caia en 1250 hardcodeado y
  // el margen salia inflado sin que nadie se enterara.
  const tcInput=parseFloat(document.getElementById('mrTipoCambio').value);
  if(!isFinite(tcInput)||tcInput<=0){
    alert('Falta el tipo de cambio. Eleg\u00ed un tipo de d\u00f3lar o cargalo a mano: sin \u00e9l el margen no significa nada.');
    if(window.__mrCargarDolar) window.__mrCargarDolar();
    return;
  }
  mrData={product,capital:document.getElementById('mrCapital').value,canal:document.getElementById('mrCanal').value,tc:tcInput};
  mrData.sinComparable=false; mrData.exploracion=null; mrData.step5=null;
  mrData.testBusqueda=null; mrData.antiguedad=null;
  const _p5=document.getElementById('mrStep5'); if(_p5) _p5.style.display='none';
  document.getElementById('btnMRAnalyze').disabled=true;
  document.getElementById('mrSteps').classList.add('visible');
  document.getElementById('mrResult').classList.remove('visible');
  document.getElementById('mrStep1Body').innerHTML=mrLoadingHTML('Analizando tendencia de demanda en Argentina...');
  document.getElementById('mrStep2Body').innerHTML=mrLoadingHTML('Analizando competencia en Mercado Libre...');
  resetMRGuidedStep(3);resetMRGuidedStep(4);
  await Promise.all([runMRStep1(product),runMRStep2(product)]);
}

function resetMRGuidedStep(n){
  if(n===3){
    document.getElementById('mrStep3Body').innerHTML=`<div class="mr-instruction"><strong><svg class="ic" aria-hidden="true"><use href="#i-phone"></use></svg> Opcional. Te lleva 2 o 3 minutos.</strong>Este paso afina la lectura de demanda, pero <b>no es obligatorio</b>: si lo salte&aacute;s calculo el score igual, con menos precisi&oacute;n en la parte de demanda.<br><br>Si quer&eacute;s hacerlo: busc&aacute; el producto en TikTok, orden&aacute; por &quot;M&aacute;s vistos&quot; y anot&aacute; el promedio de vistas de los 3 primeros videos.</div><div class="mr-guided-grid"><div class="mr-field"><label>Promedio de vistas top 3 videos (aproximado)</label><input type="text" inputmode="numeric" id="mrTiktokViews" placeholder="Ej: 250k, 1.2M, 300mil" data-mr-smart-num="1"/></div><div class="mr-field"><label>&#191;Hay contenido en espa&#241;ol/Argentina?</label><select id="mrTiktokArg"><option value="si">S&#237;, hay varios videos</option><option value="pocos">Pocos (1-2)</option><option value="no">No, solo ingl&#233;s u otros</option></select></div></div><button class="btn-confirm" onclick="confirmMRStep3()">Confirmar datos TikTok &#8594;</button><button class="btn-skip" onclick="skipMRStep3()">Saltear este paso</button>`;
  }
  if(n===4){
    document.getElementById('mrStep4Body').innerHTML=`<div class="mr-instruction"><strong><svg class="ic" aria-hidden="true"><use href="#i-cart"></use></svg> Dos cosas para buscar:</strong><strong style="color:var(--text);margin-top:8px;display:block">Ventas MeLi:</strong>Entr&#225; a los 3 primeros listings del producto. Abajo del precio dice "X vendidos". Estim&#225; el promedio mensual de los top 3.<br><br><strong style="color:var(--text)">FOB en Alibaba:</strong>Busc&#225; el producto en alibaba.com o 1688.com. Us&#225; el precio unitario para la cantidad que te interesa.</div><div class="mr-guided-grid"><div class="mr-field"><label>Precio FOB estimado (USD por unidad)</label><input type="number" id="mrFOB" placeholder="Ej: 12.50" step="0.01" min="0"/></div><div class="mr-field"><label>Ventas/mes promedio top 3 listings MeLi</label><input type="number" id="mrVentas" placeholder="Ej: 150" min="0"/></div><div class="mr-field"><label>Precio de venta promedio en MeLi (ARS)</label><input type="number" id="mrPrecioVenta" placeholder="Ej: 45000" min="0"/></div></div><button class="btn-confirm" onclick="confirmMRStep4()">Calcular viabilidad completa &#8594;</button>
<div class="mr-target-margin" style="margin-top:14px;padding:12px;border:1px dashed rgba(255,215,128,.25);border-radius:8px;display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:13px;">
  <strong style="opacity:.85;">&#191;Qu&#233; precio m&#237;nimo necesito para tener</strong>
  <input type="number" id="mrTargetMargin" min="1" max="95" step="1" value="30" style="width:64px;padding:4px 6px;border-radius:6px;border:1px solid rgba(255,215,128,.4);background:rgba(0,0,0,.25);color:inherit;font-weight:600;text-align:right;"/>
  <strong style="opacity:.85;">% de margen?</strong>
  <button type="button" onclick="window.__solveMinPrice && window.__solveMinPrice()" style="padding:6px 12px;border-radius:6px;border:1px solid rgba(255,215,128,.5);background:rgba(255,215,128,.1);color:inherit;cursor:pointer;font-weight:600;">Calcular precio m&#237;nimo</button>
  <span id="mrTargetMarginOut" style="margin-left:auto;opacity:.85;font-variant-numeric:tabular-nums;"></span>
</div>`;
  }
}
async function runMRStep1(product){
  try{
    const res=await fetch('/api/market',{method:'POST',headers:mrCabeceras(),body:JSON.stringify({step:'demanda',product})});
    const r=await res.json();
    if(!res.ok) throw new Error(r.error||'Error en step demanda');
    mrData.step1=r;
    const tendColor=r.tendencia==='subiendo'?'tag-ok':r.tendencia==='bajando'?'tag-bad':'tag-warn';
    const tendIcon=r.tendencia==='subiendo'?'\u2191':r.tendencia==='bajando'?'\u2193':'\u2192';
    const tags=(r.tags||[]).map(t=>`<span class="mr-tag tag-info">${t}</span>`).join('');
    const monthlyRows=r.monthlyData?(r.monthlyData.map(m=>`<div class="mr-row"><span class="mr-row-label">${m.label}</span><span class="mr-row-value" style="color:var(--gold)">${m.valor}/100</span></div>`).join('')):'';
    // 5) De donde salio la curva. Si Google Trends no respondio, el score y los
    //    12 meses los estimo el modelo: se dice, con un badge visible, en vez
    //    de mostrarlos como dato medido.
    const esEstimacion=r.fuenteDemanda!=='google-trends';
    // "Google Trends no disponible" no explicaba nada: el usuario podia pensar
    // que era una falla nuestra pasajera. La causa es concreta y no va a
    // cambiar sola, asi que se dice en criollo y en una linea.
    const badgeFuente=esEstimacion
      ? `<div class="mr-badge-estimacion">Google bloquea las consultas autom&#225;ticas. Este n&#250;mero es una estimaci&#243;n de IA, no un dato medido.${r.trendsMotivo?`<div style="font-weight:400;font-size:.78rem;margin-top:4px;opacity:.85">Detalle t&#233;cnico: ${r.trendsMotivo}</div>`:''}</div>`
      : `<div style="margin:10px 0"><span class="mr-tag tag-ok"><svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg> Google Trends Argentina, 12 meses medidos</span></div>`;
    document.getElementById('mrStep1Body').innerHTML=`<div class="mr-row"><span class="mr-row-label">Tendencia en Argentina</span><span class="mr-row-value"><span class="mr-tag ${tendColor}">${tendIcon} ${r.tendencia}</span></span></div><div class="mr-row"><span class="mr-row-label">Nivel de demanda</span><span class="mr-row-value" style="color:var(--gold);font-weight:700">${r.nivelDemanda||'--'}</span></div><div class="mr-row"><span class="mr-row-label">Temporalidad</span><span class="mr-row-value">${r.temporalidad||'--'}</span></div><div class="mr-row"><span class="mr-row-label">Score de demanda</span><span class="mr-row-value">${r.demandaScore||'--'}/100</span></div><div style="margin-top:8px;font-size:.82rem;color:var(--text-dim)">${r.aviso?r.aviso+' ':''}${r.descripcion||''}</div><div style="margin-top:8px">${tags}</div>${badgeFuente}${monthlyRows}`;
  }catch(e){
    document.getElementById('mrStep1Body').innerHTML='<span style="color:var(--red);font-size:.82rem">Error al obtener datos. Continu&#225; con los pasos guiados.</span>';
    mrData.step1={tendencia:'estable',demandaScore:50,temporalidad:'todo el a&#241;o',tags:[],nivelDemanda:'medio',fuenteDemanda:'estimacion-ia',trendsMotivo:'el paso de demanda fall\u00f3'};
  }
}

// Estado del reintento automatico mientras la busqueda se prepara.
var MR_PREPARANDO = { producto:null, intentos:0, timer:null };

// De donde salieron los datos que se muestran. Cada via de MercadoLibre trae
// distinto nivel de detalle y el usuario tiene que poder verlo.
function mrFuenteLabel(f){
  const mapa={
    'meli-api':'Datos reales de Mercado Libre Argentina (API)',
    'meli-api-oauth':'Datos reales de Mercado Libre Argentina (API)',
    'meli-catalogo':'Datos reales del cat\u00e1logo de Mercado Libre',
    'meli-destacados':'Publicaciones reales de Mercado Libre (m\u00e1s vendidas)',
    'meli-destacados-parcial':'Publicaciones reales de Mercado Libre (coincidencia parcial)',
    'meli-html':'Datos de Mercado Libre (HTML p\u00fablico)',
    'proveedor-apify':'Publicaciones reales de Mercado Libre'
  };
  return mapa[f]||'Datos de Mercado Libre Argentina';
}

async function runMRStep2(product){
  try{
    const res=await fetch('/api/market',{method:'POST',headers:mrCabeceras(),body:JSON.stringify({step:'competencia',product})});
    const r=await res.json();
    if(!res.ok) throw new Error(r.error||'Error en step competencia');
    mrData.step2=r;
    if(r && r.fuente==='preparando'){
      // La busqueda tarda dos o tres minutos la primera vez. En vez de dejar al
      // usuario apretando un boton, reintenta solo cada 20 s. Reintentar no
      // cuesta plata: la corrida ya se pago al arrancarla, esto solo pregunta
      // si termino.
      MR_PREPARANDO.intentos = (MR_PREPARANDO.producto===product ? MR_PREPARANDO.intentos+1 : 0);
      MR_PREPARANDO.producto = product;
      const quedan = 12 - MR_PREPARANDO.intentos;
      const cuerpo = document.getElementById('mrStep2Body');
      if(cuerpo){
        cuerpo.innerHTML =
          '<div class="mr-row"><span class="mr-row-label">'+(r.aviso||'Estoy trayendo los datos de MercadoLibre.')+'</span></div>'+
          (quedan>0
            ? '<div style="margin-top:8px;font-size:.82rem;color:var(--text-dim)">Reviso solo cada 20 segundos. No hace falta que hagas nada.</div>'
            : '<div style="margin-top:10px"><button class="btn-secondary" onclick="runMRStep2('+JSON.stringify(product)+')">Reintentar</button></div>');
      }
      clearTimeout(MR_PREPARANDO.timer);
      if(quedan>0) MR_PREPARANDO.timer = setTimeout(function(){ runMRStep2(product); }, 20000);
      return;
    }
    MR_PREPARANDO.producto=null; MR_PREPARANDO.intentos=0; clearTimeout(MR_PREPARANDO.timer);
    // Frenos de gasto. Se separan de 'no-disponible' porque no son lo mismo:
    // ahi MercadoLibre no respondio; aca no se lo consulto, y el usuario puede
    // hacer algo al respecto. Decirle "no disponible" seria echarle la culpa a
    // MeLi de una decision nuestra.
    if(r && r.fuente==='requiere-sesion'){
      document.getElementById('mrStep2Body').innerHTML=
        '<div class="mr-row"><span class="mr-row-label">'+(r.aviso||'Para traer publicaciones reales de MercadoLibre necesitas iniciar sesion.')+'</span></div>'+
        '<div style="margin-top:8px;font-size:.82rem;color:var(--text-dim)">Traer publicaciones reales de MercadoLibre tiene un costo por busqueda, asi que esa parte queda detras del login. El resto del Market Reader sigue funcionando igual.</div>'+
        '<div style="margin-top:10px"><a class="btn-secondary" href="login.html">Iniciar sesion</a></div>';
      return;
    }
    if(r && r.fuente==='tope-diario'){
      const g = r.gasto||{};
      let cuando='';
      if(g.reinicio){ try{ cuando=' Se habilita de nuevo el '+new Date(g.reinicio).toLocaleString('es-AR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'.'; }catch(_){} }
      document.getElementById('mrStep2Body').innerHTML=
        '<div class="mr-row"><span class="mr-row-label">'+(r.aviso||'Se alcanzo el tope diario de busquedas pagas.')+cuando+'</span></div>'+
        '<div style="margin-top:8px;font-size:.82rem;opacity:.75">No es un error: es un freno puesto a proposito para que la cuenta no se gaste sola. Los productos ya consultados antes siguen saliendo al instante.</div>';
      return;
    }
    if(r && r.fuente==='no-disponible'){
      document.getElementById('mrStep2Body').innerHTML='<div class="mr-row"><span class="mr-row-label" style="color:var(--text-dim)">'+(r.aviso||'Datos de Mercado Libre no disponibles ahora.')+'</span></div><div style="margin-top:8px;font-size:.82rem;opacity:.75">No muestro datos estimados para no inventar numeros. Prob&#225; nuevamente m&#225;s tarde o peg&#225; un link de un listado de MeLi para leer datos reales del producto.</div>';
      return;
    }
    const satMap={'libre':'tag-ok','moderado':'tag-warn','saturado':'tag-bad','muy saturado':'tag-bad'};
    const satColor=satMap[r.saturacion]||'tag-info';
    const fmt=n=>n?n.toLocaleString('es-AR'):'--';
    const compData=Array.isArray(r.competitors)?r.competitors:[];
    mrData.competitors=compData;
    const compRows=compData.map((c,i)=>`<tr><td class="comp-rank">#${c.rank||(i+1)}</td><td class="comp-name" title="${c.name}">${c.name}</td><td class="comp-price">ARS ${c.price.toLocaleString('es-AR')}</td><td class="comp-sales">${c.soldQty||0} vendidos</td><td><span class="comp-rep ${c.repClass}">${c.reputation||c.rep||'N/A'}</span></td></tr>`).join('');
    // El total del catalogo NO son publicaciones activas: son productos de
    // catalogo. El backend manda el rotulo correcto y aca se usa ese.
    const totalNum=r.totalResults!=null?r.totalResults:(r.totalCatalogo!=null?r.totalCatalogo:null);
    const totalLbl=r.totalLabel||'Total publicaciones activas';
    const extraInfo=totalNum?`<div class="mr-row"><span class="mr-row-label">${totalLbl}</span><span class="mr-row-value">${totalNum.toLocaleString('es-AR')}</span></div>`:'';
    const catInfo=r.categoryName?`<div class="mr-row"><span class="mr-row-label">Categor&#237;a principal</span><span class="mr-row-value">${r.categoryName}</span></div>`:'';
    const satInfo=r.saturacion?`<div class="mr-row"><span class="mr-row-label">Nivel de saturaci&#243;n</span><span class="mr-row-value"><span class="mr-tag ${satColor}">${r.saturacion}</span></span></div>`:`<div class="mr-row"><span class="mr-row-label">Nivel de saturaci&#243;n</span><span class="mr-row-value" style="color:var(--text-dim)">no calculable con esta fuente</span></div>`;
    const tablaComp=compRows?`<table class="mr-comp-table"><thead><tr><th>#</th><th>Producto / Seller</th><th>Precio</th><th>Vendidos</th><th>Reputaci&#243;n</th></tr></thead><tbody>${compRows}</tbody></table>`:'';
    const pieFuente=`<div style="margin-top:12px"><span class="mr-tag tag-info"><svg class="ic" aria-hidden="true"><use href="#i-chart"></use></svg> ${mrFuenteLabel(r.fuente)}</span></div>`;

    // MercadoLibre casi nunca devuelve cero: ante una busqueda sin
    // coincidencias sirve resultados DE RESCATE y los presenta como normales.
    // Por eso se muestra cuantas de las devueltas son de verdad del producto:
    // el conteo bruto de MeLi no significa nada para un termino de nicho.
    // El ratio se muestra SIEMPRE, no solo cuando es malo. Si el usuario ve un
    // numero raro contra un producto que el sabe que existe, esa es la senal de
    // calibracion que ningun fixture puede dar.
    let relInfo='';
    if(r.ratioRelevancia!=null&&r.muestraDevuelta!=null){
      const pct=Math.round(r.ratioRelevancia*100);
      const est=r.estadoRelevancia||'existe';
      const color=est==='existe'?'var(--green)':(est==='dudoso'?'#e0a020':'var(--red)');
      relInfo=`<div class="mr-row"><span class="mr-row-label">Relevancia de la muestra</span><span class="mr-row-value" style="color:${color};font-weight:700">${r.ratioRelevancia.toFixed(2)}</span></div>`+
        `<div style="margin-top:4px;font-size:.82rem;color:var(--text-dim)">De ${r.muestraDevuelta} publicaciones devueltas, el promedio coincide en un ${pct}% con tu b&#250;squeda (${r.relevantes} tienen al menos una palabra).${r.totalCrudoMeli?` MeLi informa ${r.totalCrudoMeli.toLocaleString('es-AR')} resultados, pero ese n&#250;mero es posterior al rescate y no dice cu&#225;ntos son tu producto.`:''}</div>`;
      if(est==='dudoso') relInfo+=`<div class="mr-badge-estimacion" style="margin-top:8px">MercadoLibre devolvi&#243; resultados <b>parcialmente relacionados</b>: no puedo confirmar si tu producto exacto se vende ac&#225;. No calculo precio de referencia con esto.</div>`;
      else if(est==='noExiste') relInfo+=`<div class="mr-badge-estimacion" style="margin-top:8px">MercadoLibre te devolvi&#243; resultados, pero no son tu producto.</div>`;
      else if(r.ratioRelevancia<0.5) relInfo+=`<div style="margin-top:8px;font-size:.82rem;color:#e0a020">Coincidencia parcial: los precios se calculan <b>solo</b> sobre las ${r.relevantes} publicaciones que coinciden.</div>`;
    }

    // 8.a) Sin comparable: no es "poca competencia", es que el producto no se
    //      vende aca. Se dispara el modo aparte, que evalua otra cosa.
    if(r.sinComparable && typeof window.activarModoSinComparable==='function'){
      window.activarModoSinComparable(product);
    } else if(typeof mrData!=='undefined'&&mrData){
      mrData.sinComparable=false;
      const p5=document.getElementById('mrStep5'); if(p5) p5.style.display='none';
    }

    // 3) Con menos de 8 publicaciones no hay rango, ni promedio, ni mediana:
    //    un precio "de mercado" sacado de una publicacion es un invento.
    if(r.muestraInsuficiente){
      document.getElementById('mrStep2Body').innerHTML=
        `<div class="mr-badge-estimacion">Muestra insuficiente (${r.muestra||0} ${r.muestra===1?'publicaci&#243;n':'publicaciones'}). No calculo precio de referencia con esto.</div>`+
        `<div class="mr-row"><span class="mr-row-label">Publicaciones encontradas</span><span class="mr-row-value">${r.muestra||0}</span></div>`+
        (r.sellersEstimados!=null?`<div class="mr-row"><span class="mr-row-label">Sellers &#250;nicos en la muestra</span><span class="mr-row-value">${r.sellersEstimados}</span></div>`:'')+
        relInfo+catInfo+extraInfo+
        `<div style="margin-top:8px;font-size:.82rem;color:var(--text-dim)">Busc&#225; el producto en MercadoLibre y anot&#225; precio y vendidos de las primeras 10 publicaciones: con eso s&#237; se puede fijar un precio de referencia.</div>`+
        pieFuente+tablaComp;
      return;
    }

    document.getElementById('mrStep2Body').innerHTML=`<div class="mr-row"><span class="mr-row-label">Sellers &#250;nicos reales</span><span class="mr-row-value">${r.sellersEstimados}</span></div><div class="mr-row"><span class="mr-row-label">Publicaciones en la muestra</span><span class="mr-row-value">${r.muestra||compData.length}</span></div><div class="mr-row"><span class="mr-row-label">Rango de precios reales</span><span class="mr-row-value">ARS ${fmt(r.precioMinARS)} \u2013 ${fmt(r.precioMaxARS)}</span></div><div class="mr-row"><span class="mr-row-label">Precio promedio real</span><span class="mr-row-value" style="color:var(--gold);font-weight:700">ARS ${fmt(r.precioPromedioARS)}</span></div>${relInfo}${r.envioGratisPct!=null?`<div class="mr-row"><span class="mr-row-label">Ofrecen env&#237;o gratis</span><span class="mr-row-value">${r.envioGratisPct}% (${r.envioGratisCount||0} de ${r.envioGratisTotal||0})</span></div>`:''}${catInfo}${extraInfo}${satInfo}<div style="margin-top:8px;font-size:.82rem;color:var(--text-dim)">${r.aviso?r.aviso+' ':''}${r.descripcion||''}</div>${r.oportunidad?`<div style="margin-top:4px;font-size:.82rem;color:var(--green)"><svg class="ic" aria-hidden="true"><use href="#i-bulb"></use></svg> Oportunidad: ${r.oportunidad}</div>`:''}${pieFuente}${tablaComp}`;
  }catch(e){
    document.getElementById('mrStep2Body').innerHTML='<span style="color:var(--red);font-size:.82rem">Error al analizar MeLi. Continu&#225; con los pasos guiados.</span>';
    mrData.step2={fuente:'no-disponible',muestraInsuficiente:true,muestra:0,sellersEstimados:null,precioMinARS:null,precioMaxARS:null,precioPromedioARS:null,competenciaScore:null,saturacion:null,envioGratisPct:null,competitors:[]};
  }
}

// Score de traccion de contenido. Antes salia solo del dropdown
// (si=70 / pocos=50 / no=30) y el numero de vistas se descartaba: un producto
// con 12 videos de 2 mil vistas puntuaba igual que uno con 12 videos de 3
// millones. Ahora la base sale de las vistas, en escala logaritmica (los
// saltos que importan son de orden de magnitud, no lineales), y el dropdown
// solo la multiplica.
function mrScoreTikTok(step3){
  if(!step3||step3.omitido) return {score:30,base:30,mult:1,vistas:0,motivo:'Paso salteado: sin dato de vistas ni de contenido en Argentina.'};
  const v=Number(step3.views)||0;
  let base,tramo;
  if(!v){ base=35; tramo='sin dato de vistas'; }
  else if(v<10000){ base=20; tramo='menos de 10k vistas'; }
  else if(v<100000){ base=45; tramo='entre 10k y 100k vistas'; }
  else if(v<1000000){ base=70; tramo='entre 100k y 1M de vistas'; }
  else { base=90; tramo='mas de 1M de vistas'; }
  const mult=step3.arg==='si'?1.0:step3.arg==='pocos'?0.85:0.7;
  const multLabel=step3.arg==='si'?'contenido en Argentina (x1.0)':step3.arg==='pocos'?'poco contenido en Argentina (x0.85)':'sin contenido en Argentina (x0.7)';
  return {
    score: Math.round(base*mult), base, mult, vistas:v, tramo, multLabel,
    motivo: 'Base '+base+' por '+tramo+', por '+multLabel+'.'
  };
}

function confirmMRStep3(){
  // El input acepta "250k", "1.2M", "300mil": se parsea con el mismo lector
  // que muestra el hint debajo del campo, no con parseFloat.
  const rawEl=document.getElementById('mrTiktokViews');
  const raw=rawEl?rawEl.value:'';
  let views=window.__parseSmartNumber?window.__parseSmartNumber(raw):parseFloat(raw);
  if(!isFinite(views)||views<0) views=0;
  const arg=document.getElementById('mrTiktokArg').value;
  mrData.step3={views,arg};
  const sc=mrScoreTikTok(mrData.step3);
  mrData.step3.score=sc.score;
  mrData.step3.scoreMotivo=sc.motivo;
  const argLabel=arg==='si'?'S&#237;, hay varios':arg==='pocos'?'Pocos (1-2)':'No';
  const scColor=sc.score>=70?'var(--green)':sc.score>=45?'var(--gold)':'var(--red)';
  document.getElementById('mrStep3Body').innerHTML=
    `<div class="mr-row"><span class="mr-row-label">Vistas promedio top 3</span><span class="mr-row-value">${views?views.toLocaleString('es-AR'):'sin dato'}</span></div>`+
    `<div class="mr-row"><span class="mr-row-label">Contenido en Argentina</span><span class="mr-row-value">${argLabel}</span></div>`+
    `<div class="mr-row"><span class="mr-row-label">Score de tracci&#243;n</span><span class="mr-row-value" style="color:${scColor};font-weight:700">${sc.score}/100</span></div>`+
    `<div style="margin-top:6px;font-size:.82rem;color:var(--text-dim)">De d&#243;nde sale: ${sc.motivo}</div>`+
    `<div style="margin-top:8px"><span class="mr-tag tag-ok"><svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg> Datos TikTok registrados</span></div>`;
}

// El paso de TikTok es opcional: si lo saltean, el score se calcula igual y
// se deja registrado que la demanda se midio con menos precision.
function skipMRStep3(){
  mrData.step3={views:0,arg:'no-informado',omitido:true};
  const sc=mrScoreTikTok(mrData.step3);
  mrData.step3.score=sc.score;
  mrData.step3.scoreMotivo=sc.motivo;
  document.getElementById('mrStep3Body').innerHTML=
    '<div class="mr-row"><span class="mr-row-label">Tracci&#243;n en TikTok</span>'+
    '<span class="mr-row-value">Sin medir</span></div>'+
    '<div class="mr-row"><span class="mr-row-label">Score de tracci&#243;n</span>'+
    '<span class="mr-row-value">'+sc.score+'/100 (por defecto)</span></div>'+
    '<div style="margin-top:8px"><span class="mr-tag tag-info">'+
    '<svg class="ic" aria-hidden="true"><use href="#i-info"></use></svg> '+
    'Paso salteado: calculo el score igual, con menos precisi&#243;n en demanda.</span></div>';
  if(window.mcTrack) window.mcTrack('tiktok_salteado',{producto:mrCurrentProduct||''});
}

// Tarifa de logistica de MeLi por modalidad. Vive afuera del paso 4 porque los
// escenarios de quiebre la vuelven a evaluar a otros precios de venta: la
// formula tiene que ser una sola.
function mrTarifaLogisticaARS(precio,mod){
  if(mod==='retiro')return 0;
  const envioGratis=precio>=35000;
  if(mod==='full'){const fija=precio<15000?2800:precio<30000?3600:4500;const almacen=precio*0.015;return fija+almacen;}
  if(mod==='flex')return 1200;
  if(mod==='estandar'){const tarifaBase=precio<15000?2500:3500;return envioGratis?tarifaBase*0.5:0;}
  return 0;
}

function confirmMRStep4(){
  const fob=parseFloat(document.getElementById('mrFOB').value)||0;
  const ventas=parseFloat(document.getElementById('mrVentas').value)||0;
  const venta=parseFloat(document.getElementById('mrPrecioVenta').value)||0;
  if(!fob||!venta){alert('Completá al menos el precio FOB y el precio de venta');return;}
  const tc=mrData.tc;
  const s2=mrData.step2||{};
  const modalidad=(document.getElementById('mrModalidad')||{}).value||'flex';
  const posicion=(document.getElementById('mrPosicion')||{}).value||'estandar';
  mrData.modalidad=modalidad;mrData.posicion=posicion;
  const factorPos=posicion==='premium'?1.25:posicion==='multifuncion'?1.45:1.00;
  let medianoARS=0;
  // Con muestra insuficiente no hay precio de referencia: no se calcula mediana
  // sobre 1 o 2 publicaciones ni se la muestra como si fuera el mercado.
  if(!s2.muestraInsuficiente&&s2.competitors&&s2.competitors.length>=3){
    const arr=s2.competitors.map(c=>c.price).filter(p=>p>0).sort((a,b)=>a-b);
    if(arr.length){const m=Math.floor(arr.length/2);medianoARS=arr.length%2?arr[m]:Math.round((arr[m-1]+arr[m])/2);}
  }
  if(!medianoARS&&!s2.muestraInsuficiente&&s2.precioPromedioARS){medianoARS=Math.round(s2.precioPromedioARS*0.92);}
  medianoARS=Math.round(medianoARS*factorPos);
  const usaMediano=medianoARS>0&&Math.abs(venta-medianoARS)/medianoARS>0.25;
  const catName=(s2.categoryName||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  let comisionPct=0.15;
  if(/electron|tecnolog|celular|computa|inform|audio|video|proyector|imagen|sonido/.test(catName))comisionPct=0.165;
  else if(/hogar|deco|mueble/.test(catName))comisionPct=0.14;
  else if(/deport|fitness/.test(catName))comisionPct=0.13;
  else if(/moda|indumen|ropa|calzado/.test(catName))comisionPct=0.16;
  else if(/mascot|bebe|niñ|nin/.test(catName))comisionPct=0.13;
  else if(/herramienta|industri|construc/.test(catName))comisionPct=0.12;
  const ivaPct=0.21;const iibbPct=0.03;
  const tarifaLogisticaARS=mrTarifaLogisticaARS;
  const recargoFull=modalidad==='full'?0.05:0;
  const comisionFinalPct=comisionPct+recargoFull;
  const logisticaARS=mrData.canal==='mercadolibre'?tarifaLogisticaARS(venta,modalidad):0;
  const empaqueUSD=0.50;
  const fleteUSD=(window.__getFleteUSDPerUnit?window.__getFleteUSDPerUnit(fob):fob*0.15);
  const seguroUSD=(fob+fleteUSD)*0.015;
  const cifUSD=fob+fleteUSD+seguroUSD;
  const arancelRate=(window.__getArancelRate?window.__getArancelRate():0.20);
  const arancelesUSD=cifUSD*arancelRate;
  // Tasa de estadistica: 3% sobre CIF. No estaba en el calculo y se paga
  // siempre (salvo exenciones por posicion), asi que subvaluaba el landed.
  const tasaEstadisticaPct=0.03;
  const tasaEstadisticaUSD=cifUSD*tasaEstadisticaPct;
  const despachoUSD=cifUSD*0.08;
  const costoLandedUSD=fob+fleteUSD+seguroUSD+arancelesUSD+tasaEstadisticaUSD+despachoUSD+empaqueUSD;

  // IVA de importacion. La base imponible NO es el costo landed: es
  // CIF + aranceles + tasa de estadistica.
  //   ivaImportacion = base * 21%  -> credito fiscal del periodo
  //   ivaAdicional   = base * 20%  -> percepcion, es pago a cuenta:
  //                                    sale de la caja pero NO es credito
  //                                    del periodo.
  // Antes se hacia landed - landed/1.21, que asume que el landed YA incluye
  // IVA. No lo incluye (es FOB+flete+seguro+aranceles+despacho+empaque), asi
  // que ese "credito" era un numero inventado que inflaba el margen.
  const ivaImportPct=0.21;
  const ivaAdicionalPct=0.20;
  const baseImponibleUSD=cifUSD+arancelesUSD+tasaEstadisticaUSD;
  const ivaImportacionUSD=baseImponibleUSD*ivaImportPct;
  const ivaAdicionalUSD=baseImponibleUSD*ivaAdicionalPct;

  const fobARS=fob*tc;
  const fleteARS=fleteUSD*tc;
  const seguroARS=seguroUSD*tc;
  const arancelesARS=arancelesUSD*tc;
  const tasaEstadisticaARS=tasaEstadisticaUSD*tc;
  const despachoARS=despachoUSD*tc;
  const empaqueARS=empaqueUSD*tc;
  const costoLandedARS=costoLandedUSD*tc;
  const baseImponibleARS=baseImponibleUSD*tc;
  const ivaImportacionARS=ivaImportacionUSD*tc;
  const ivaAdicionalARS=ivaAdicionalUSD*tc;

  const comisionMeLiARS=venta*comisionFinalPct;
  const ivaDebitoARS=venta-(venta/(1+ivaPct));
  const ivaCreditoARS=ivaImportacionARS;          // el adicional es a cuenta, no credito del periodo
  const ivaARS=Math.max(0,ivaDebitoARS-ivaCreditoARS);
  const iibbARS=venta*iibbPct;
  const fullARS=modalidad==='full'?logisticaARS:0;
  const costoTotalARS=costoLandedARS+comisionMeLiARS+ivaARS+iibbARS+logisticaARS;
  const margenARS=venta-costoTotalARS;
  const margenPct=venta>0?Math.round((margenARS/venta)*100):0;

  // Capital inmovilizado por unidad: el landed MAS el IVA de importacion y la
  // percepcion. Los dos salen de la caja al nacionalizar aunque despues se
  // recuperen, y hasta ahora no figuraban en ningun lado.
  const capitalUnitarioARS=costoLandedARS+ivaImportacionARS+ivaAdicionalARS;
  const capitalUnitarioUSD=capitalUnitarioARS/tc;

  const ventasMes=ventas||0;
  const ventasDia=ventasMes/30;
  const capitalUSD=parseFloat(mrData.capital)||10000;
  const unidadesPosibles=Math.floor(capitalUSD/Math.max(0.01,capitalUnitarioUSD));
  const ingresoMensualARS=margenARS*ventasMes;
  const inversionARS=capitalUnitarioARS*Math.min(unidadesPosibles,Math.max(1,ventasMes));
  const roiMensualPct=inversionARS>0?(ingresoMensualARS/inversionARS)*100:0;
  const roiAnualPct=Math.round(roiMensualPct*12);
  const breakevenUds=margenARS>0?Math.ceil(inversionARS/margenARS):0;
  const breakevenDias=ventasDia>0&&breakevenUds>0?Math.ceil(breakevenUds/ventasDia):0;
  const scD=Math.min(100,(mrData.step1&&mrData.step1.demandaScore)||50);
  // Sin comparable NO hay score de competencia. El "||50" de antes convertia
  // un null en un 50, o sea que un producto que no se vende en Argentina
  // puntuaba mejor en competencia que uno saturado: el sistema premiaba la
  // ausencia. Con sinComparable el score entero queda en null y el gauge se
  // oculta; no se inventa un numero para llenar el hueco.
  const compScore=(mrData.step2&&mrData.step2.competenciaScore);
  const scC=(compScore==null)?null:(100-Math.min(100,compScore));
  const scM=Math.max(0,Math.min(100,margenPct*2.5));
  const scR=Math.max(0,Math.min(100,roiAnualPct/3));
  const scDef=mrScoreTikTok(mrData.step3).score;
  const sinComp=!!mrData.sinComparable;
  const scoreReponderado=(sinComp||scC==null)
    ? null
    : Math.round(scD*0.25+scC*0.20+scM*0.30+scR*0.15+scDef*0.10);

  mrData.step4={fob,ventas,venta,tc,modalidad,posicion,factorPos,
    costoLanded:costoLandedUSD,costoLandedARS,cifUSD,fobARS,fleteARS,seguroARS,
    arancelesARS,arancelRate,tasaEstadisticaARS,tasaEstadisticaPct,despachoARS,empaqueARS,
    baseImponibleARS,ivaImportacionARS,ivaAdicionalARS,ivaImportPct,ivaAdicionalPct,
    capitalUnitarioARS,capitalUnitarioUSD,
    comisionMeLiARS,ivaARS,ivaDebitoARS,ivaCreditoARS,iibbARS,logisticaARS,fullARS,
    margenARS,margenPct,medianoARS,comisionPct:comisionFinalPct,usaFull:modalidad==='full',
    roiMensualPct,roiAnualPct,breakevenUds,breakevenDias,unidadesPosibles,inversionARS,
    ingresoMensualARS,scoreReponderado,scD,scC,scM,scR,scDef};

  const mColor=margenPct>=40?'var(--green)':margenPct>=20?'var(--gold)':'var(--red)';
  const fmtA=n=>'ARS '+Math.round(n).toLocaleString('es-AR');
  const modLabel=modalidadLabel(modalidad);
  const advMediano=usaMediano?`<div class="mr-row"><span class="mr-row-label"><svg class="ic" aria-hidden="true"><use href="#i-warn"></use></svg> Sugerencia</span><span class="mr-row-value" style="color:var(--gold)">Mediano ${fmtA(medianoARS)} (tu venta difiere ${Math.round((venta-medianoARS)/medianoARS*100)}%)</span></div>`:'';
  const logRow=mrData.canal==='mercadolibre'?`<div class="mr-row"><span class="mr-row-label">Log&#237;stica (${modLabel})</span><span class="mr-row-value">${logisticaARS>0?fmtA(logisticaARS):'gratis (paga comprador)'}</span></div>`:'';
  document.getElementById('mrStep4Body').innerHTML=`<div class="mr-row"><span class="mr-row-label">Precio FOB</span><span class="mr-row-value">USD ${fob.toFixed(2)}</span></div><div class="mr-row"><span class="mr-row-label">Costo CIF (FOB+flete+seguro)</span><span class="mr-row-value">USD ${cifUSD.toFixed(2)}</span></div><div class="mr-row"><span class="mr-row-label">Aranceles (${Math.round(arancelRate*100)}% s/CIF)</span><span class="mr-row-value">${fmtA(arancelesARS)}</span></div><div class="mr-row"><span class="mr-row-label">Tasa de estad&#237;stica (3% s/CIF)</span><span class="mr-row-value">${fmtA(tasaEstadisticaARS)}</span></div><div class="mr-row"><span class="mr-row-label">Costo landed total</span><span class="mr-row-value">USD ${costoLandedUSD.toFixed(2)} / ${fmtA(costoLandedARS)}</span></div><div class="mr-row"><span class="mr-row-label">Base imponible de importaci&#243;n (CIF+aranceles+tasa)</span><span class="mr-row-value">${fmtA(baseImponibleARS)}</span></div><div class="mr-row"><span class="mr-row-label">IVA de importaci&#243;n (21% s/base) &#8212; cr&#233;dito fiscal</span><span class="mr-row-value">${fmtA(ivaImportacionARS)}</span></div><div class="mr-row"><span class="mr-row-label">Percepci&#243;n IVA adicional (20% s/base) &#8212; pago a cuenta</span><span class="mr-row-value">${fmtA(ivaAdicionalARS)}</span></div><div class="mr-row"><span class="mr-row-label">Capital inmovilizado por unidad</span><span class="mr-row-value" style="color:var(--gold)">${fmtA(capitalUnitarioARS)}</span></div><div class="mr-row"><span class="mr-row-label">Comisi&#243;n MeLi (${Math.round(comisionFinalPct*100)}%)</span><span class="mr-row-value">${fmtA(comisionMeLiARS)}</span></div><div class="mr-row"><span class="mr-row-label">IVA a pagar (d&#233;bito ${fmtA(ivaDebitoARS)} &#8722; cr&#233;dito ${fmtA(ivaCreditoARS)})</span><span class="mr-row-value">${fmtA(ivaARS)}</span></div><div class="mr-row"><span class="mr-row-label">IIBB (3%)</span><span class="mr-row-value">${fmtA(iibbARS)}</span></div>${logRow}<div class="mr-row"><span class="mr-row-label">Margen neto estimado</span><span class="mr-row-value" style="color:${mColor};font-size:1.1rem">${margenPct}% (${fmtA(margenARS)})</span></div><div class="mr-row"><span class="mr-row-label">ROI anualizado</span><span class="mr-row-value" style="color:var(--gold)">${roiAnualPct}%</span></div>${breakevenUds?`<div class="mr-row"><span class="mr-row-label">Breakeven</span><span class="mr-row-value">${breakevenUds} uds${breakevenDias?` (~${breakevenDias} d&#237;as)`:''}</span></div>`:''}<div class="mr-row"><span class="mr-row-label">Score reponderado</span><span class="mr-row-value" style="color:var(--gold);font-weight:700">${mrData.step4.scoreReponderado==null?'no aplica (sin comparable en MeLi)':mrData.step4.scoreReponderado+'/100'}</span></div><div class="mr-row"><span class="mr-row-label">Modalidad / Posicionamiento</span><span class="mr-row-value">${modLabel} &#183; ${posicion}</span></div>${advMediano}${ventas?`<div class="mr-row"><span class="mr-row-label">Ventas/mes top sellers MeLi</span><span class="mr-row-value">${ventas} uds</span></div>`:''}<div style="margin-top:8px"><span class="mr-tag tag-ok"><svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg> C&#225;lculo registrado</span></div>`;
  runMRFinalAnalysis();
}

async function runMRFinalAnalysis(){
  document.getElementById('mrResult').classList.add('visible');
  document.getElementById('mrResultProduct').textContent=mrCurrentProduct;

  // 1) La decision se calcula y se dibuja ACA, en JavaScript, con reglas
  //    deterministas. No depende de que la IA responda.
  const decision=window.renderMRDecision?window.renderMRDecision(mrData):null;

  // 2) El gauge, las tarjetas de factores y los graficos se dibujan con los
  //    numeros locales (scD/scC/scM/scR del paso 4). El gauge quedo abajo del
  //    bloque de decision y es orientativo.
  try{ if(typeof window.__v9fallback==='function') window.__v9fallback(); }catch(_e){}

  const at=document.getElementById('mrAnalysisText');
  if(at) at.innerHTML='<div class="v9-note">Redactando el an&#225;lisis...</div>';

  // 3) La IA solo redacta. Se le pasa el objeto de senales ya calculado, los
  //    escenarios de quiebre y la calidad de datos, y tiene prohibido inventar
  //    cifras o agregar factores que no esten ahi.
  if(!decision){ if(at) at.innerHTML=''; document.getElementById('btnMRAnalyze').disabled=false; return; }
  const paquete={
    producto:mrCurrentProduct,
    veredicto:decision.veredicto.titulo,
    porQueDelVeredicto:decision.veredicto.sub,
    condicionesParaDarloVuelta:decision.veredicto.condiciones||[],
    senalesAFavor:decision.senales.aFavor.map(x=>({senal:x.texto,dato:x.dato,peso:x.peso})),
    senalesEnContra:decision.senales.enContra.map(x=>({senal:x.texto,dato:x.dato,peso:x.peso})),
    senalesCriticas:decision.senales.criticos.map(x=>({senal:x.texto,dato:x.dato,peso:'critico'})),
    escenariosDeQuiebre:decision.quiebre,
    calidadDeDatos:decision.chips.map(c=>({dimension:c.t,estado:c.c==='verde'?'dato medido':(c.c==='ambar'?'estimado':'sin dato'),detalle:c.d})),
    riesgosSinVerificar:decision.veredicto.riesgosSinTildar||[]
  };
  // Modo sin comparable: cambia de que se habla. No hay precio de mercado, asi
  // que no hay margen proyectado ni escenarios de quiebre; hay presupuesto de
  // test. Se le pasa eso y se le prohibe hablar de proyeccion de ventas.
  if(mrData.sinComparable){
    const pres=window.presupuestoDeTest?window.presupuestoDeTest(mrData):null;
    paquete.modo='sin-comparable-en-mercadolibre-argentina';
    paquete.advertenciaObligatoria=window.__modoSinComparable.lineaFija;
    paquete.escenariosDeQuiebre=null;
    paquete.presupuestoDeTest=pres?{
      unidadesTest:pres.unidadesTest, moqCargado:!pres.faltaMOQ,
      costoTestARS:Math.round(pres.costoTestARS),
      porcentajeDelCapital:pres.pctCapital!=null?Math.round(pres.pctCapital):null,
      precioQueCreeElUsuarioARS:pres.precioCreo||null,
      unidadesParaRecuperarElTest:pres.udsParaRecuperar
    }:null;
    paquete.presenciaRegional=mrData.exploracion?{
      conteos:mrData.exploracion.conteos, existeEn:mrData.exploracion.existeEn,
      categoriaMadre:mrData.exploracion.categoriaMadre
    }:null;
    paquete.antiguedadDemanda=mrData.antiguedad||null;
    paquete.testDeBusqueda=mrData.testBusqueda||null;
  }
  try{
    const prompt='Sos analista de importaciones China-Argentina. Te paso un analisis YA RESUELTO: el veredicto, las senales con sus numeros, los escenarios de quiebre y la calidad de los datos. Todo eso lo calculo un motor de reglas, no vos.\n\n'+
      'REGLAS QUE NO PODES ROMPER:\n'+
      '1. NO decidis el veredicto: ya esta decidido, tu trabajo es explicarlo.\n'+
      '2. NO inventes ninguna cifra, porcentaje, precio ni plazo. Solo podes usar los numeros que estan en el JSON de abajo, tal cual estan.\n'+
      '3. NO agregues factores, riesgos ni ventajas que no esten en las senales que te paso.\n'+
      '4. Si te falta un dato para decir algo, deci que ese dato falta. No lo completes.\n'+
      '5. Escribi en espanol rioplatense, directo, sin relleno y sin vender nada.\n\n'+
      'DATOS:\n'+JSON.stringify(paquete)+'\n\n'+
      'Responde SOLO JSON valido sin markdown: {"parrafos":["parrafo 1","parrafo 2","parrafo 3"],"proximosPasos":["paso 1","paso 2","paso 3"]}\n'+
      (mrData.sinComparable
        ? 'ATENCION: este producto NO tiene comparable en MercadoLibre Argentina. No existe precio de mercado, asi que NO hay margen proyectado ni proyeccion de ventas. No inventes ninguna de las dos cosas. Lo que se evalua es si vale la pena PAGAR POR AVERIGUARLO: hablá del presupuesto de test, de lo que se aprende y de lo que se arriesga. Empeza el primer parrafo reconociendo la advertencia obligatoria.\n'
        : '') +
      'Los 3 parrafos tienen que desarrollar el POR QUE del veredicto: que riesgo concreto corre la plata, que tendria que pasar para que salga bien y que para que salga mal. Mencionando UNICAMENTE las senales que te pase.\n'+
      'Los 3 proximos pasos son concretos y acordes al veredicto (por ejemplo, si es CONVIENE SOLO SI: que hay que verificar antes de pagar el FOB, como MOQ real, muestra fisica, certificacion, posicion NCM).';
    const res=await fetch('/api/market',{method:'POST',headers:mrCabeceras(),body:JSON.stringify({step:'final',customPrompt:prompt,prompt})});
    const r=await res.json();
    if(!res.ok) throw new Error(r.error||'Error en analisis final');
    renderAnalisisIA(r,decision);
  }catch(e){
    if(at) at.innerHTML='<div class="v9-note"><b>El texto ampliado con IA no carg&#243; esta vez.</b> El veredicto, las se&#241;ales y los escenarios de quiebre de arriba est&#225;n calculados con tus n&#250;meros y no dependen de la IA.</div>';
  }
  document.getElementById('btnMRAnalyze').disabled=false;
  try{ guardarAnalisisMR(decision); }catch(_e){}
}

// El texto de la IA se muestra aparte del bloque de decision, y rotulado como
// lo que es: una redaccion de senales que ya estaban calculadas.
function renderAnalisisIA(r,decision){
  const at=document.getElementById('mrAnalysisText');
  if(!at) return;
  const parrafos=Array.isArray(r.parrafos)?r.parrafos:[];
  const pasos=Array.isArray(r.proximosPasos)?r.proximosPasos:[];
  at.innerHTML=
    '<h4 style="margin:0 0 8px;font-size:.95rem;letter-spacing:.03em;text-transform:uppercase;color:var(--gold)">Lectura del veredicto</h4>'+
    parrafos.map(p=>'<p style="margin:0 0 10px;line-height:1.55">'+p+'</p>').join('')+
    (pasos.length?'<h4 style="margin:14px 0 8px;font-size:.95rem;letter-spacing:.03em;text-transform:uppercase;color:var(--gold)">Pr&#243;ximos 3 pasos</h4><ol style="margin:0;padding-left:20px">'+
      pasos.map(x=>'<li style="margin-bottom:6px;line-height:1.5">'+x+'</li>').join('')+'</ol>':'')+
    '<div style="margin-top:12px;font-size:.76rem;color:var(--text-dim)">Texto redactado por IA a partir de las se&#241;ales calculadas arriba. No agrega n&#250;meros ni factores propios.</div>';
}

function guardarAnalisisMR(decision){
  const s2=mrData.step2||{},s4=mrData.step4||{};
  const score=Math.max(0,Math.min(100,s4.scoreReponderado||0));
  const monthly=(mrData.step1&&mrData.step1.monthlyData)||[];
  saveToHistory({product:mrCurrentProduct,date:Date.now(),score,tc:mrData.tc,
    margenPct:s4.margenPct||0,
    veredicto:decision&&decision.veredicto?decision.veredicto.titulo:'',
    analisisTexto:decision&&decision.veredicto?decision.veredicto.sub:'',
    analisisCompleto:(document.getElementById('mrAnalysisText')||{}).textContent||'',
    mrData,
    scores:[{score:s4.scD,label:'Demanda'},{score:s4.scC,label:'Competencia'},{score:s4.scM,label:'Margen'},{score:s4.scR,label:'ROI'}],
    chartData:{trendData:monthly.map(d=>d.valor),
      meliData:[s2.precioMinARS||0,s2.precioPromedioARS||0,s2.precioMaxARS||0],
      waterfallData:s4.fob?{fob:s4.fobARS,flete:s4.fleteARS,aranceles:s4.arancelesARS,despacho:s4.despachoARS,comision:s4.comisionMeLiARS}:null}});
}

function renderMRResult(r){
  const score=Math.max(0,Math.min(100,(mrData.step4&&mrData.step4.scoreReponderado)||r.scoreTotal||0));
  if(window.mcTrack) window.mcTrack('analisis_completado',{producto:mrCurrentProduct,score:score,veredicto:r.veredicto||''});
  syncMRUrl();
  const gaugeArc=251;
  const gOffset=gaugeArc-(score/100)*gaugeArc;
  document.getElementById('gaugeFill').style.strokeDashoffset=gOffset;
  const needleRot=-90+(score/100)*180;
  document.getElementById('gaugeNeedle').style.transform=`rotate(${needleRot}deg)`;
  const scoreColor=score>=65?'#27ae60':score>=40?'#FFE600':'#c0392b';
  mcCountUp(document.getElementById('gaugeScore'), score);
  document.getElementById('gaugeScore').setAttribute('fill',scoreColor);
  document.getElementById('gaugeLabel').textContent=score>=65?'Viabilidad alta':score>=40?'Viabilidad media':'Viabilidad baja';
  const vBox=document.getElementById('mrVeredictoBox');
  vBox.className='mr-veredicto';
  const vTitle=document.getElementById('mrVeredictoTitle');
  if(r.veredicto==='VIABLE'){vBox.classList.add('mv-si');vTitle.textContent='VIABLE';vTitle.style.color='var(--green)';}
  else if(r.veredicto==='NO RECOMENDADO'){vBox.classList.add('mv-no');vTitle.textContent='NO RECOMENDADO';vTitle.style.color='var(--red)';}
  else{vBox.classList.add('mv-cond');vTitle.textContent='VIABLE CON CONDICIONES';vTitle.style.color='var(--gold)';}
  document.getElementById('mrVeredictoText').textContent=r.veredictoTexto||'';
  const sD=Math.max(0,Math.min(100,r.scoresDemanda||50));
  const sC=Math.max(0,Math.min(100,100-(r.scoresCompetencia||50)));
  const sM=Math.max(0,Math.min(100,r.scoresMargen||50));
  const sR=Math.max(0,Math.min(100,100-(r.scoresRegulatorio||30)));
  renderFactorCard(1,sD,r.labelDemanda,'<svg class="ic" aria-hidden="true"><use href="#i-trend"></use></svg>');
  renderFactorCard(2,sC,r.labelCompetencia,'<svg class="ic" aria-hidden="true"><use href="#i-store"></use></svg>');
  renderFactorCard(3,sM,r.labelMargen,'<svg class="ic" aria-hidden="true"><use href="#i-money"></use></svg>');
  renderFactorCard(4,sR,r.labelRegulatorio,'<svg class="ic" aria-hidden="true"><use href="#i-scale"></use></svg>');
  const radarCtx=document.getElementById('radarChart');
  if(window._radarChart)window._radarChart.destroy();
  window._radarChart=new Chart(radarCtx,{type:'radar',data:{labels:['Demanda','Competencia','Margen','Regulaci&#243;n'],datasets:[{data:[sD,sC,sM,sR],backgroundColor:'rgba(255,230,0,0.15)',borderColor:'#FFE600',borderWidth:2,pointBackgroundColor:'#FFE600',pointRadius:4,pointHoverRadius:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{r:{min:0,max:100,ticks:{display:false},grid:{color:'rgba(255,255,255,0.06)'},angleLines:{color:'rgba(255,255,255,0.06)'},pointLabels:{color:'#92929A',font:{size:11}}}}}});
  const trend=mrData.step1?.tendencia||'estable';
  const monthlyData=mrData.step1?.monthlyData||null;
  const months=['Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic','Ene','Feb','Mar'];
  let trendData;
  if(monthlyData&&monthlyData.length>0){
    trendData=monthlyData.map(d=>d.valor);
  } else {
    const baseDemand=sD;
    trendData=months.map((m,i)=>{
      const noise=(Math.random()-0.5)*10;
      const drift=trend==='subiendo'?(i*2.5):trend==='bajando'?(-i*2):0;
      return Math.max(5,Math.min(100,baseDemand+drift+noise));
    });
  }
  const bandUpper=trendData.map(v=>Math.min(100,v+12));
  const bandLower=trendData.map(v=>Math.max(5,v-12));
  const trendsCtx=document.getElementById('trendsChart');
  if(window._trendsChart)window._trendsChart.destroy();
  const trendLabels=monthlyData&&monthlyData.length>0?monthlyData.map(d=>d.mes):months;
  window._trendsChart=new Chart(trendsCtx,{type:'line',data:{labels:trendLabels,datasets:[
    {data:bandUpper,borderColor:'rgba(255,230,0,0.08)',borderWidth:1,fill:'-1',backgroundColor:'rgba(255,230,0,0.05)',tension:0.4,pointRadius:0,order:2},
    {data:trendData,borderColor:'#FFE600',borderWidth:2.5,borderDash:(mrData.step1&&mrData.step1.fuenteDemanda==='google-trends')?[]:[6,4],backgroundColor:'rgba(255,230,0,0.12)',fill:true,tension:0.4,pointRadius:3,pointBackgroundColor:'#FFE600',pointHoverRadius:5,order:1},
    {data:bandLower,borderColor:'rgba(255,230,0,0.08)',borderWidth:1,fill:'-1',backgroundColor:'rgba(255,230,0,0.05)',tension:0.4,pointRadius:0,order:3}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false,backgroundColor:'rgba(0,0,0,0.85)',titleColor:'#FFE600',bodyColor:'#F6F6F4',borderColor:'#FFE600',borderWidth:1,callbacks:{title:ctx=>monthlyData&&monthlyData[ctx[0].dataIndex]?(monthlyData[ctx[0].dataIndex].mes+' 2025'):(ctx[0].label+' 2025'),label:ctx=>'Inter&#233;s: '+ctx.parsed.y.toFixed(0)+'/100'}}},scales:{x:{ticks:{color:'#92929A',font:{size:9}},grid:{color:'rgba(255,255,255,0.04)'}},y:{min:0,max:100,ticks:{color:'#92929A',font:{size:9}},grid:{color:'rgba(255,255,255,0.04)'}}}}});
  const s2=mrData.step2||{};
  const pMin=s2.precioMinARS||0;
  const pProm=s2.precioPromedioARS||0;
  const pMax=s2.precioMaxARS||0;
  const meliCtx=document.getElementById('meliChart');
  if(window._meliChart)window._meliChart.destroy();
  window._meliChart=new Chart(meliCtx,{type:'bar',data:{labels:['Precio m&#237;n','Precio prom','Precio m&#225;x'],datasets:[{data:[pMin,pProm,pMax],backgroundColor:['rgba(41,128,185,0.7)','rgba(255,230,0,0.7)','rgba(39,174,96,0.7)'],borderColor:['#2980b9','#FFE600','#27ae60'],borderWidth:1.5,borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>'ARS '+ctx.parsed.x.toLocaleString('es-AR')}}},scales:{x:{ticks:{color:'#92929A',font:{size:9},callback:v=>v>=1000?'$'+(v/1000).toFixed(0)+'k':'$'+v},grid:{color:'rgba(255,255,255,0.04)'}},y:{ticks:{color:'#92929A',font:{size:10}},grid:{display:false}}}}});
  if(mrData.step4)renderWaterfall(mrData.step4,mrData.tc);
  const wfEl=document.getElementById('waterfallWrap');
  if(mrData.step4)wfEl.style.display='block';
  document.getElementById('mrAnalysisText').textContent=r.analisisCompleto||'';
  document.getElementById('btnMRAnalyze').disabled=false;
  const veredictoMap={'VIABLE':'VIABLE','NO RECOMENDADO':'NO RECOMENDADO','VIABLE CON CONDICIONES':'VIABLE CON CONDICIONES'};
  saveToHistory({product:mrCurrentProduct,date:Date.now(),score,tc:mrData.tc,margenPct:mrData.step4?.margenPct||0,veredicto:veredictoMap[r.veredicto]||r.veredicto,analisisTexto:r.veredictoTexto,analisisCompleto:r.analisisCompleto,mrData,scores:[
    {score:sD,label:r.labelDemanda},{score:sC,label:r.labelCompetencia},{score:sM,label:r.labelMargen},{score:sR,label:r.labelRegulatorio}
  ],chartData:{trendData,meliData:[pMin,pProm,pMax],waterfallData:mrData.step4?{fob:mrData.step4.fob,flete:(window.__getFleteUSDPerUnit?window.__getFleteUSDPerUnit(mrData.step4.fob):mrData.step4.fob*0.15),aranceles:mrData.step4.fob*(window.__getArancelRate?window.__getArancelRate():0.20),despacho:mrData.step4.fob*0.08,comision:mrData.step4.venta*0.15}:null}});
}
function renderFactorCard(n,score,label,icon){
  const s=Math.max(0,Math.min(100,score||0));
  const tier=s>=65?'verde':s>=40?'amarillo':'rojo';
  const colors={verde:'#27ae60',amarillo:'#FFE600',rojo:'#c0392b'};
  const col=colors[tier];
  document.getElementById('fc'+n).className='mfc '+tier;
  document.getElementById('fci'+n).className='mfc-icon '+tier;
  document.getElementById('fci'+n).textContent=icon;
  document.getElementById('fcs'+n).textContent=s+'/100';
  document.getElementById('fcs'+n).className='mfc-score '+tier;
  document.getElementById('fcb'+n).style.width=s+'%';
  document.getElementById('fcb'+n).style.background=col;
  document.getElementById('fcl'+n).textContent=label||'';
  ['r','a','v'].forEach(c=>{document.getElementById('sd'+n+c).className='sem-dot';});
  if(tier==='verde'){document.getElementById('sd'+n+'v').className='sem-dot on-verde';}
  else if(tier==='amarillo'){document.getElementById('sd'+n+'a').className='sem-dot on-amarillo';}
  else{document.getElementById('sd'+n+'r').className='sem-dot on-rojo';}
}

function modalidadLabel(m){
  return ({full:'Full',flex:'Flex',estandar:'Mercado Env&#237;os est.',retiro:'Retiro / Acordar'})[m]||'Env&#237;o';
}
function renderWaterfall(step4,tc){
  const venta=step4.venta;
  const fobARS=step4.fobARS!=null?step4.fobARS:(step4.fob*tc);
  const fleteARS=step4.fleteARS!=null?step4.fleteARS:((window.__getFleteUSDPerUnit?window.__getFleteUSDPerUnit(step4.fob):step4.fob*0.15)*tc);
  const seguroARS=step4.seguroARS||0;
  const arancelesARS=step4.arancelesARS!=null?step4.arancelesARS:(step4.fob*(window.__getArancelRate?window.__getArancelRate():0.20)*tc);
  const tasaEstadisticaARS=step4.tasaEstadisticaARS||0;
  const ivaImportacionARS=step4.ivaImportacionARS||0;
  const ivaAdicionalARS=step4.ivaAdicionalARS||0;
  const despachoARS=step4.despachoARS!=null?step4.despachoARS:(step4.fob*0.08*tc);
  const empaqueARS=step4.empaqueARS||0;
  const comisionARS=step4.comisionMeLiARS!=null?step4.comisionMeLiARS:(venta*0.15);
  const ivaARS=step4.ivaARS||0;
  const iibbARS=step4.iibbARS||0;
  const logisticaARS=step4.logisticaARS||0;
  const margenARS=step4.margenARS!=null?step4.margenARS:(venta-fobARS-fleteARS-arancelesARS-despachoARS-comisionARS);
  const fmt=n=>'ARS '+Math.abs(Math.round(n)).toLocaleString('es-AR');
  const modLabel=modalidadLabel(step4.modalidad||'flex');
  const items=[
    {label:'Precio venta',val:venta,type:'total',show:true},
    {label:'FOB (USD '+step4.fob.toFixed(2)+')',val:-fobARS,type:'neg',show:true},
    {label:'  Flete '+(window.__getFleteLabel?window.__getFleteLabel():'15%'),val:-fleteARS,type:'sub',show:true},
    {label:'  Seguro 1.5%',val:-seguroARS,type:'sub',show:seguroARS>0},
    {label:'  Aranceles '+(((window.__getArancelRate?window.__getArancelRate():0.20)*100).toFixed(0))+'% s/CIF',val:-arancelesARS,type:'sub',show:true},
    {label:'  Tasa estad&#237;stica 3% s/CIF',val:-tasaEstadisticaARS,type:'sub',show:tasaEstadisticaARS>0},
    {label:'  Despacho 8% s/CIF',val:-despachoARS,type:'sub',show:true},
    {label:'  Empaque',val:-empaqueARS,type:'sub',show:empaqueARS>0},
    {label:'Comisi&#243;n MeLi',val:-comisionARS,type:'neg',show:true},
    {label:'IVA importaci&#243;n 21% s/base (cr&#233;dito fiscal)',val:-ivaImportacionARS,type:'sub',show:ivaImportacionARS>0},
    {label:'Percepci&#243;n IVA 20% s/base (pago a cuenta)',val:-ivaAdicionalARS,type:'sub',show:ivaAdicionalARS>0},
    {label:'IVA a pagar (d&#233;bito &#8722; cr&#233;dito)',val:-ivaARS,type:'neg',show:ivaARS>0},
    {label:'IIBB 3%',val:-iibbARS,type:'neg',show:iibbARS>0},
    {label:'Log&#237;stica ('+modLabel+')',val:-logisticaARS,type:'neg',show:logisticaARS>0},
    {label:'Costo financiero ('+(window.__getCostoFinDays?window.__getCostoFinDays():0)+'d &#215; '+((window.__getCostoFinMonthlyPct?window.__getCostoFinMonthlyPct():0)*100).toFixed(1)+'%/mes)',val:-(window.__computeCostoFinARS?window.__computeCostoFinARS(fobARS+fleteARS+seguroARS+arancelesARS+despachoARS+empaqueARS):0),type:'neg',show:(window.__computeCostoFinARS?window.__computeCostoFinARS(fobARS+fleteARS+seguroARS+arancelesARS+despachoARS+empaqueARS):0)>0}
  ];
  const visibles=items.filter(i=>i.show);
  const maxAbs=Math.max(...visibles.map(i=>Math.abs(i.val)));
  const barsEl=document.getElementById('waterfallBars');
  barsEl.innerHTML=visibles.map(item=>{
    const pct=Math.max(2,(Math.abs(item.val)/maxAbs)*100);
    const isPos=item.val>=0;
    const displayVal=(isPos?'+':'-')+fmt(item.val);
    return `<div class="wf-row"><span class="wf-label">${item.label}</span><div class="wf-bar-bg"><div class="wf-bar-fill ${item.type}" style="width:${pct}%"></div></div><span class="wf-val ${isPos?'pos':'neg'}">${displayVal}</span></div>`;
  }).join('');
  // El IVA de importacion y la percepcion se muestran como lineas propias
  // porque salen de la caja al nacionalizar, pero NO restan del margen: el
  // primero es credito fiscal y el segundo es pago a cuenta. Lo que si hacen
  // es inmovilizar capital, y eso se dice explicitamente.
  const capUnit=step4.capitalUnitarioARS||0;
  if(capUnit>0){
    barsEl.insertAdjacentHTML('beforeend',
      '<div class="wf-row" style="margin-top:10px;padding-top:10px;border-top:1px dashed #333">'+
      '<span class="wf-label" style="opacity:.85">Capital inmovilizado por unidad (landed + IVA imp. + percepci&#243;n)</span>'+
      '<div class="wf-bar-bg"></div>'+
      '<span class="wf-val" style="color:var(--gold)">'+fmt(capUnit)+'</span></div>'+
      '<div style="font-size:.74rem;color:var(--text-dim);margin-top:6px;line-height:1.4">'+
      'El IVA de importaci&#243;n y la percepci&#243;n figuran arriba porque salen de tu caja al nacionalizar, '+
      'pero no restan del margen: el primero es cr&#233;dito fiscal del per&#237;odo y el segundo es pago a cuenta. '+
      'Lo que s&#237; hacen es inmovilizar capital.</div>');
  }
  const sumEl=document.getElementById('wfSummaryVal');
  const margenPct=step4.margenPct||0;
  const signo=margenARS>=0?'+':'-';
  sumEl.textContent=signo+fmt(margenARS)+' ('+margenPct+'%)';
  sumEl.className='wf-summary-val '+(margenPct>=40?'ok':margenPct>=20?'warn':'bad');
}

function exportMRPDF(){
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF();
  const {step1,step2,step3,step4}=mrData;
  doc.setFillColor(10,10,10);
  doc.rect(0,0,220,35,'F');
  doc.setTextColor(201,168,76);
  doc.setFontSize(18);
  doc.text('Market Reader IA',14,18);
  doc.setTextColor(200,200,200);
  doc.setFontSize(11);
  doc.text('An&#225;lisis de Viabilidad &#8212; '+mrCurrentProduct,14,28);
  doc.setTextColor(150,150,150);
  doc.setFontSize(9);
  doc.text('Generado: '+new Date().toLocaleDateString('es-AR'),14,34);
  doc.setTextColor(0,0,0);
  let y=42;
  const addChart=async(canvasId,title)=>{
    const canvas=document.getElementById(canvasId);
    if(!canvas)return;
    try{
      const img=canvas.toDataURL('image/png',1.0);
      const pw=doc.internal.pageSize.getWidth()-28;
      doc.setDrawColor(201,168,76);
      doc.setLineWidth(0.3);
      doc.rect(14,y-4,pw,38);
      doc.setTextColor(201,168,76);
      doc.setFontSize(8);
      doc.text(title.toUpperCase(),16,y);
      doc.addImage(img,'PNG',14,y+2,pw,32);
      y+=46;
      if(y>250){doc.addPage();y=20;}
    }catch(e){}
  };
  const addText=(title,content,fntSize=12)=>{
    if(y>240){doc.addPage();y=20;}
    doc.setTextColor(201,168,76);
    doc.setFontSize(fntSize);
    doc.text(title,14,y);y+=6;
    doc.setTextColor(80,80,80);
    doc.setFontSize(9);
    const lines=doc.splitTextToSize(content,190);
    doc.text(lines,14,y);y+=lines.length*4+4;
  };
  doc.setTextColor(60,60,60);
  addText('Factor 1 &#8212; Demanda',step1?`Tendencia: ${step1.tendencia} | Score: ${step1.demandaScore}/100 | Temporalidad: ${step1.temporalidad||'N/A'}`:'Sin datos');
  addText('Factor 2 &#8212; Competencia MeLi',step2?`Sellers: ~${step2.sellersEstimados} | Saturaci&#243;n: ${step2.saturacion} | Precio prom: ARS ${(step2.precioPromedioARS||0).toLocaleString('es-AR')}`:'Sin datos');
  if(mrData.competitors&&mrData.competitors.length){
    addText('Top Competidores',mrData.competitors.map((c,i)=>`#${i+1} ${c.name} &#8212; ARS ${c.price.toLocaleString('es-AR')} | ${c.sales}+ ventas/mes | ${c.rep}`).join('\n'),9);
  }
  addText('Factor 3 &#8212; TikTok',step3?`Vistas promedio: ${(step3.views||0).toLocaleString('es-AR')} | Contenido ARG: ${step3.arg||'N/A'}`:'Sin datos');
  if(step4){
    const tc=mrData.tc||1250;
    const cifUSD=step4.fob+(step4.fleteARS||0)/tc+(step4.seguroARS||0)/tc;
    const costoLandedARS=step4.costoLandedARS||((step4.costoLanded||0)*tc);
    const comisionARS=step4.comisionMeLiARS||(step4.venta*0.15);
    const ivaARS=step4.ivaARS||0;
    const iibbARS=step4.iibbARS||0;
    const fullARS=step4.fullARS||0;
    const margenARS=step4.margenARS||0;
    const roiAnualPct=step4.roiAnualPct||0;
    const breakevenUds=step4.breakevenUds||0;
    const comisionPct=Math.round((step4.comisionPct||0.15)*100);
    addText('Factor 4 &#8212; Rentabilidad',`FOB: USD ${step4.fob.toFixed(2)} | CIF: USD ${cifUSD.toFixed(2)} | Costo landed: USD ${(step4.costoLanded||0).toFixed(2)} (ARS ${costoLandedARS.toLocaleString('es-AR',{maximumFractionDigits:0})})\nComisi&#243;n MeLi ${comisionPct}%: ARS ${Math.round(comisionARS).toLocaleString('es-AR')} | IVA 21%: ARS ${Math.round(ivaARS).toLocaleString('es-AR')} | IIBB 3%: ARS ${Math.round(iibbARS).toLocaleString('es-AR')}${fullARS?' | Full 10%: ARS '+Math.round(fullARS).toLocaleString('es-AR'):''}\nPrecio venta: ARS ${step4.venta.toLocaleString('es-AR')} | Margen neto: ARS ${Math.round(margenARS).toLocaleString('es-AR')} (${step4.margenPct}%)\nROI anualizado: ${roiAnualPct}% | Breakeven: ${breakevenUds} uds | Score reponderado: ${step4.scoreReponderado||'-'}/100`);
  }
  if(y>230){doc.addPage();y=20;}
  doc.setTextColor(201,168,76);
  doc.setFontSize(12);
  doc.text('An&#225;lisis completo',14,y);y+=7;
  doc.setTextColor(80,80,80);
  doc.setFontSize(9);
  const analysis=document.getElementById('mrAnalysisText').textContent;
  if(analysis){
    const lines=doc.splitTextToSize(analysis,190);
    doc.text(lines,14,y);
  }
  (async()=>{
    doc.setTextColor(60,60,60);
    if(y>200){doc.addPage();y=15;}
    await addChart('trendsChart','Tendencia de b&#250;squeda &#8212; Argentina (12m)');
    await addChart('meliChart','Precios en Mercado Libre');
    await addChart('waterfallChart','Composici&#243;n de costos');
    doc.save('market-reader-'+mrCurrentProduct.replace(/\s+/g,'-')+'.pdf');
  })();
}

function resetMR(){
  document.getElementById('mrProductInput').value='';
  document.getElementById('mrSteps').classList.remove('visible');
  document.getElementById('mrResult').classList.remove('visible');
  document.getElementById('waterfallWrap').style.display='none';
  // El bloque de decision tambien se limpia: si queda visible con las senales
  // del analisis anterior, el proximo producto arranca con un veredicto ajeno.
  const dec=document.getElementById('mrvDecision');
  if(dec){
    dec.style.display='none';
    const c1=document.getElementById('mrvChkCert'); if(c1) c1.checked=false;
    const c2=document.getElementById('mrvChkMarca'); if(c2) c2.checked=false;
  }
  const viejoV=document.getElementById('mrVeredictoBox'); if(viejoV) viejoV.style.display='';
  // Modo sin comparable: se apaga y se devuelve el gauge, si no el proximo
  // producto arranca con el paso 5 abierto y el score escondido.
  const p5=document.getElementById('mrStep5'); if(p5) p5.style.display='none';
  ['mrvNoComp','mrvTest'].forEach(function(id){ const e=document.getElementById(id); if(e) e.style.display='none'; });
  const q=document.getElementById('mrvQuiebre'); if(q) q.style.display='';
  if(typeof window.__mostrarGauge==='function') window.__mostrarGauge(true);
  const at=document.getElementById('mrAnalysisText'); if(at) at.innerHTML='';
  document.getElementById('btnMRAnalyze').disabled=false;
  if(window._radarChart){window._radarChart.destroy();window._radarChart=null;}
  if(window._trendsChart){window._trendsChart.destroy();window._trendsChart=null;}
  if(window._meliChart){window._meliChart.destroy();window._meliChart=null;}
  if(window._waterfallChart){window._waterfallChart.destroy();window._waterfallChart=null;}
  mrData={};mrCurrentProduct='';
}
// ===== INIT =====
window.addEventListener('DOMContentLoaded',()=>{
  const savedUser=localStorage.getItem('pf_user');
  const savedRole=localStorage.getItem('pf_role');
  const savedExpiry=localStorage.getItem('pf_expiry');
  if(savedUser&&savedRole){
    if(savedExpiry&&savedRole!=='admin'){
      const exp=new Date(savedExpiry);
      if(exp<=new Date()){doLogout();return;}
    }
    currentRole=savedRole;sessionExpiry=savedExpiry||null;
    if(!routeFromHash()) showScreen('menuScreen');
    try{setupTopbar(savedUser);}catch(e){}
  } else {
    // Visitante anonimo: la landing publica (menuScreen) ya esta activa por defecto.
    routeFromHash();
    try{setupTopbar('');}catch(e){}
  }
  // Analisis compartido por link: hidratamos los campos y abrimos el buscador.
  try{
    if(hydrateMRFromUrl()){
      showMarket();
      if(window.mcTrack) window.mcTrack('analisis_abierto_por_link',{});
    }
  }catch(e){}
});

/* ---- bloque 2 ---- */
/* ===== ProductFinder v2 patch: live recalc + NCM tariffs + 4-modality comparison ===== */
(function(){
  // El arancel del Market Reader sale UNICAMENTE de su propio selector de NCM.
  // Antes, con el selector en "Auto", se leia localStorage.pf_nicho, que es el
  // nicho elegido en OTRA pantalla (el analizador): un usuario que habia
  // tocado el analizador se llevaba 16% sin enterarse, aunque aca dijera
  // "Auto". Ahora Auto es 20% y punto.
  //
  // 20% y no 35%: el 35% es el TECHO del AEC, no el arancel normal. Usarlo de
  // default sobrevaluaba el costo de casi cualquier producto. El real depende
  // de la posicion NCM y el selector lo deja elegir.
  window.__getArancelRate = function(){
    try {
      var sel = document.getElementById('mrNCM');
      if (sel && sel.value && sel.value !== 'auto') return parseFloat(sel.value);
      return 0.20;
    } catch(e){ return 0.20; }
  };
  var liveDebounce = null;
  function scheduleLiveRecalc(){
    if (liveDebounce) clearTimeout(liveDebounce);
    liveDebounce = setTimeout(function(){
      try {
        var res = document.getElementById('mrResult');
        if (!res || res.offsetParent === null) return;
        if (typeof window.confirmMRStep4 === 'function') window.confirmMRStep4();
      } catch(e){ console.warn('live recalc fail', e); }
    }, 250);
  }
  function attachLiveListeners(){
    ['mrModalidad','mrPosicion','mrTipoCambio','mrFOB','mrVentas','mrPrecioVenta','mrNCM'].forEach(function(id){
      var el = document.getElementById(id);
      if (!el || el.__liveBound) return;
      el.__liveBound = true;
      el.addEventListener('change', scheduleLiveRecalc);
      el.addEventListener('input', scheduleLiveRecalc);
    });
  }
  function readMargin(){
    var rb = document.getElementById('mrAnalysisText');
    if (rb){ var m = rb.textContent.match(/(-?\d+[.,]?\d*)\s*%/); if (m) return m[1] + '%'; }
    var any = document.querySelectorAll('#mrResult *');
    for (var i=0;i<any.length;i++){
      var t = any[i].textContent || '';
      var mm = t.match(/Margen[^%]*?(-?\d+[.,]?\d*)\s*%/i);
      if (mm) return mm[1] + '%';
    }
    return '&#8212;';
  }
  function buildModalityComparison(){
    try {
      var modSel = document.getElementById('mrModalidad');
      if (!modSel) return;
      var current = modSel.value;
      var modalities = [
        {value:'full', label:'Full'},
        {value:'flex', label:'Flex'},
        {value:'estandar', label:'Est&#225;ndar'},
        {value:'retiro', label:'Retiro'}
      ];
      ['mrModalidad','mrPosicion','mrTipoCambio','mrFOB','mrVentas','mrPrecioVenta','mrNCM'].forEach(function(id){
        var el = document.getElementById(id); if(el) el.__liveBound = false;
      });
      var rows = [];
      modalities.forEach(function(m){
        modSel.value = m.value;
        try { window.__origConfirmMRStep4 && window.__origConfirmMRStep4(); } catch(e){}
        rows.push({label:m.label, value:m.value, margen: readMargin()});
      });
      modSel.value = current;
      try { window.__origConfirmMRStep4 && window.__origConfirmMRStep4(); } catch(e){}
      setTimeout(attachLiveListeners, 0);

      var holder = document.getElementById('mrModalityCompare');
      if (!holder) {
        holder = document.createElement('div');
        holder.id = 'mrModalityCompare';
        holder.style.cssText = 'margin-top:18px;padding:14px;border:1px solid rgba(255,215,128,.2);border-radius:10px;background:rgba(0,0,0,.25);';
        var res = document.getElementById('mrResult');
        if (res) res.appendChild(holder);
      }
      holder.innerHTML = '<h3 style="margin:0 0 8px 0;font-size:14px;letter-spacing:.04em;"><svg class="ic" aria-hidden="true"><use href="#i-chart"></use></svg> Comparativo de modalidades</h3>'+
        '<table style="width:100%;border-collapse:collapse;font-size:13px;">'+
        '<thead><tr><th style="text-align:left;padding:6px 4px;opacity:.7;">Modalidad</th>'+
        '<th style="text-align:right;padding:6px 4px;opacity:.7;">Margen</th></tr></thead>'+
        '<tbody>'+ rows.map(function(r){
          var hl = (r.value===current) ? 'background:rgba(255,215,128,.08);' : '';
          return '<tr style="'+hl+'"><td style="padding:6px 4px;">'+r.label+'</td>'+
                 '<td style="padding:6px 4px;text-align:right;font-variant-numeric:tabular-nums;">'+(r.margen||'&#8212;')+'</td></tr>';
        }).join('') + '</tbody></table>'+
        '<div style="opacity:.6;font-size:11px;margin-top:6px;">Tip: cambi&#225; NCM, modalidad o TC y los n&#250;meros se actualizan al instante.</div>';
    } catch(e){ console.warn('modality compare fail', e); }
  }
  function init(){
    attachLiveListeners();
    if (typeof window.confirmMRStep4 === 'function' && !window.confirmMRStep4.__wrapped){
      var orig = window.confirmMRStep4;
      window.__origConfirmMRStep4 = orig;
      window.confirmMRStep4 = function(){
        var r = orig.apply(this, arguments);
        setTimeout(attachLiveListeners, 0);
        if (!window.__inModComp){
          window.__inModComp = true;
          setTimeout(function(){ try { buildModalityComparison(); } finally { window.__inModComp = false; } }, 50);
        }
        return r;
      };
      window.confirmMRStep4.__wrapped = true;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  try {
    document.addEventListener('change', function(ev){
      var t = ev.target;
      if (!t || !t.id) return;
      if (/nicho/i.test(t.id)) { try { localStorage.setItem('pf_nicho', t.value); } catch(e){} }
    }, true);
  } catch(e){}
})();

/* ---- bloque 3 ---- */
/* ===== ProductFinder v3 patch: flete by mode + cost of capital ===== */
(function(){
  var SHIP_RATES = { courier: 8.0, aereo: 4.5, lcl: 1.2, fcl: 0.3 };
  var SHIP_LABELS = {
    courier: 'Courier USD '+SHIP_RATES.courier+'/kg',
    aereo:   'A&#233;reo USD '+SHIP_RATES.aereo+'/kg',
    lcl:     'LCL USD '+SHIP_RATES.lcl+'/kg',
    fcl:     'FCL USD '+SHIP_RATES.fcl+'/kg'
  };
  function getMode(){ var s = document.getElementById('mrShipMode'); return s ? s.value : 'auto'; }
  function getPesoKg(){
    var el = document.getElementById('mrPesoKg');
    if (!el) return 0;
    var v = parseFloat(el.value);
    return (isFinite(v) && v > 0) ? v : 0;
  }
  window.__getFleteUSDPerUnit = function(fobUSD){
    try {
      var mode = getMode();
      var kg = getPesoKg();
      if (mode === 'auto' || !SHIP_RATES[mode] || kg <= 0) return (parseFloat(fobUSD)||0) * 0.15;
      return kg * SHIP_RATES[mode];
    } catch(e){ return (parseFloat(fobUSD)||0) * 0.15; }
  };
  window.__getFleteLabel = function(){
    var mode = getMode(); var kg = getPesoKg();
    if (mode === 'auto' || !SHIP_RATES[mode] || kg <= 0) return '15% s/FOB';
    return SHIP_LABELS[mode] + ' &#215; ' + kg.toFixed(2) + 'kg';
  };
  window.__getCostoFinDays = function(){
    var el = document.getElementById('mrDiasCap');
    var v = el ? parseFloat(el.value) : 0;
    return (isFinite(v) && v >= 0) ? v : 0;
  };
  window.__getCostoFinMonthlyPct = function(){
    var el = document.getElementById('mrTasaCap');
    var v = el ? parseFloat(el.value) : 0;
    return (isFinite(v) && v >= 0) ? v/100 : 0;
  };
  window.__computeCostoFinARS = function(landedARS){
    try {
      var d = window.__getCostoFinDays();
      var r = window.__getCostoFinMonthlyPct();
      if (!d || !r) return 0;
      return (parseFloat(landedARS)||0) * (d/30) * r;
    } catch(e){ return 0; }
  };
  function attachV3(){
    ['mrShipMode','mrPesoKg','mrDiasCap','mrTasaCap'].forEach(function(id){
      var el = document.getElementById(id);
      if (!el || el.__v3Bound) return;
      el.__v3Bound = true;
      var fire = function(){
        try {
          var res = document.getElementById('mrResult');
          if (!res || res.offsetParent === null) return;
          if (typeof window.confirmMRStep4 === 'function') window.confirmMRStep4();
        } catch(e){}
      };
      el.addEventListener('change', fire);
      el.addEventListener('input', fire);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachV3);
  else attachV3();
  setInterval(attachV3, 1500);
})();

/* ---- bloque 4 ---- */
/* ===== ProductFinder v4 patch: precio m&#237;nimo + TikTok smart parse + Rehacer historial ===== */
(function(){
  function parseSmartNumber(raw){
    if (raw == null) return NaN;
    var s = String(raw).trim().toLowerCase();
    if (!s) return NaN;
    var multiplier = 1;
    if (/m(illones)?$/.test(s) || s.endsWith('m')) {
      if (/mil$/.test(s) && !/mill/.test(s)) {
        multiplier = 1000; s = s.replace(/mil$/, '');
      } else {
        multiplier = 1e6; s = s.replace(/m(illones|ill)?$/,'');
      }
    } else if (s.endsWith('k')) {
      multiplier = 1000; s = s.slice(0, -1);
    } else if (/mil$/.test(s)) {
      multiplier = 1000; s = s.replace(/mil$/, '');
    }
    s = s.trim();
    var lastDot = s.lastIndexOf('.');
    var lastCom = s.lastIndexOf(',');
    if (lastDot > -1 && lastCom > -1) {
      if (lastDot > lastCom) { s = s.replace(/,/g, ''); }
      else { s = s.replace(/\./g, '').replace(',', '.'); }
    } else if (lastCom > -1) {
      var afterCom = s.length - lastCom - 1;
      if ((s.match(/,/g)||[]).length === 1 && afterCom > 0 && afterCom <= 2) s = s.replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastDot > -1) {
      var afterDot = s.length - lastDot - 1;
      if ((s.match(/\./g)||[]).length === 1 && afterDot > 0 && afterDot <= 2) {
      } else s = s.replace(/\./g, '');
    }
    var n = parseFloat(s);
    if (!isFinite(n)) return NaN;
    return n * multiplier;
  }
  window.__parseSmartNumber = parseSmartNumber;

  function attachSmartNumInputs(){
    var nodes = document.querySelectorAll('[data-mr-smart-num]');
    nodes.forEach(function(el){
      if (el.__smartBound) return;
      el.__smartBound = true;
      var hint = document.createElement('span');
      hint.className = 'mr-smart-hint';
      hint.style.cssText = 'display:block;margin-top:4px;font-size:11px;opacity:.7;';
      el.parentNode.insertBefore(hint, el.nextSibling);
      function update(){
        var raw = el.value;
        var n = parseSmartNumber(raw);
        if (!isFinite(n) || n === 0) { hint.textContent = ''; el.dataset.parsed = ''; return; }
        el.dataset.parsed = String(Math.round(n));
        hint.textContent = '='+ Math.round(n).toLocaleString('es-AR') + ' vistas';
      }
      el.addEventListener('input', update);
      el.addEventListener('blur', function(){
        var n = parseSmartNumber(el.value);
        if (isFinite(n) && n > 0) { el.value = String(Math.round(n)); update(); }
      });
      update();
    });
  }

  function readMarginPctNum(){
    var rb = document.getElementById('mrAnalysisText');
    if (rb){
      var m = rb.textContent.match(/(-?\d+[.,]?\d*)\s*%/);
      if (m) return parseFloat(m[1].replace(',','.'));
    }
    var any = document.querySelectorAll('#mrResult *');
    for (var i=0;i<any.length;i++){
      var t = any[i].textContent || '';
      var mm = t.match(/Margen[^%]*?(-?\d+[.,]?\d*)\s*%/i);
      if (mm) return parseFloat(mm[1].replace(',','.'));
    }
    return NaN;
  }

  window.__solveMinPrice = function(){
    var out = document.getElementById('mrTargetMarginOut');
    var tgtEl = document.getElementById('mrTargetMargin');
    var precioEl = document.getElementById('mrPrecioVenta');
    if (!tgtEl || !precioEl) { if(out) out.textContent ='Faltan inputs'; return; }
    var target = parseFloat(tgtEl.value);
    if (!isFinite(target) || target <= 0 || target >= 95) { if(out) out.textContent ='Margen objetivo inv&#225;lido (1&#8211;94%)'; return; }
    var origPrice = parseFloat(precioEl.value) || 0;
    if (origPrice <= 0) { if(out) out.textContent ='Carg&#225; primero un precio de venta para calibrar'; return; }
    var calcFn = window.__origConfirmMRStep4 || window.confirmMRStep4;
    if (typeof calcFn !== 'function') { if(out) out.textContent ='Calculadora no inicializada'; return; }

    var ids = ['mrModalidad','mrPosicion','mrTipoCambio','mrFOB','mrVentas','mrPrecioVenta','mrNCM','mrShipMode','mrPesoKg','mrDiasCap','mrTasaCap'];
    var prevBound = {};
    ids.forEach(function(id){ var el = document.getElementById(id); if(el){ prevBound[id] = el.__liveBound; el.__liveBound = false; } });
    function restoreBound(){
      ids.forEach(function(id){ var el = document.getElementById(id); if(el){ el.__liveBound = prevBound[id] || false; } });
    }

    function evalAt(price){
      precioEl.value = String(Math.round(price));
      try { calcFn(); } catch(e){}
      return readMarginPctNum();
    }

    var lo = Math.max(1, origPrice * 0.05);
    var hi = origPrice * 10;
    var loM = evalAt(lo);
    var hiM = evalAt(hi);
    if (!isFinite(loM) || !isFinite(hiM)) { precioEl.value = String(origPrice); try{calcFn();}catch(e){} if(out) out.textContent='No pude leer el margen'; restoreBound(); return; }
    if (loM > target) {
      precioEl.value = String(origPrice); try{calcFn();}catch(e){}
      if (out) out.textContent = 'Ya alcanz&#225;s ese margen al precio actual o menor'; restoreBound(); return;
    }
    if (hiM < target) {
      precioEl.value = String(origPrice); try{calcFn();}catch(e){}
      if (out) out.textContent = 'No alcanzable: incluso al ' + Math.round(hi).toLocaleString('es-AR') + ' ARS el margen es ' + hiM.toFixed(1) + '%';
      restoreBound(); return;
    }
    var iter = 0;
    while (iter++ < 28 && (hi - lo) > 1) {
      var mid = (lo + hi) / 2;
      var midM = evalAt(mid);
      if (!isFinite(midM)) break;
      if (midM < target) lo = mid; else hi = mid;
    }
    var found = Math.round(hi);
    precioEl.value = String(found);
    try { calcFn(); } catch(e){}
    if (out) out.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg> Precio m&#237;nimo p/ '+target+'%: <strong>ARS '+found.toLocaleString('es-AR')+'</strong> (actual ARS '+Math.round(origPrice).toLocaleString('es-AR')+')';
    restoreBound();
  };

  window.__redoAnalysis = function(idx){
    try {
      if (typeof window.loadHistoryItem === 'function') window.loadHistoryItem(idx);
      var closeBtn = document.querySelector('.mr-history-modal .close, [onclick*="closeHistory"]');
      if (closeBtn) closeBtn.click();
      setTimeout(function(){
        try { if (typeof window.confirmMRStep4 === 'function') window.confirmMRStep4(); } catch(e){}
      }, 200);
    } catch(e){ console.warn('redo fail', e); }
  };

  function attachPosicionamientoSync(){
    var sel = document.getElementById('mrPosicion');
    var inp = document.getElementById('mrPrecioVenta');
    if(!sel || !inp) return;
    var factor = function(v){ return v==='premium'?1.25:(v==='multifuncion'?1.45:1.00); };
    if(inp.__basePrice === undefined){
      var cur = parseFloat(inp.value)||0;
      inp.__basePrice = cur>0 ? cur/factor(sel.value) : 0;
    }
    if(!inp.__posSyncAttached){
      inp.addEventListener('input', function(){
        var v = parseFloat(inp.value)||0;
        var f = factor(sel.value);
        inp.__basePrice = v>0 ? v/f : 0;
      });
      inp.__posSyncAttached = true;
    }
    if(!sel.__posSyncAttached){
      sel.addEventListener('change', function(){
        var f = factor(sel.value);
        if(inp.__basePrice && inp.__basePrice>0){
          inp.value = Math.round(inp.__basePrice * f);
          inp.dispatchEvent(new Event('change', {bubbles:true}));
        }
      });
      sel.__posSyncAttached = true;
    }
  }
  function init(){ attachSmartNumInputs(); attachPosicionamientoSync(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  setInterval(function(){ attachSmartNumInputs(); attachPosicionamientoSync(); }, 1500);
})();

/* ---- bloque 5 ---- */
/* ===== v4 UI enhancer (additive, non-invasive) ===== */
(function(){
  function verdictFromCard(card){
    // read score from .score-row strong (e.g. "57/100")
    var st=card.querySelector('.score-row strong');
    var score=0; if(st){var m=(st.textContent||'').match(/(\d+)/); if(m)score=parseInt(m[1],10);}
    // read saturation from stats (label Saturacion)
    var sat=''; card.querySelectorAll('.stat').forEach(function(s){
      var l=s.querySelector('.stat-l'); if(l&&/satur/i.test(l.textContent)){var v=s.querySelector('.stat-v'); if(v)sat=(v.textContent||'').toLowerCase();}
    });
    var cls='media',txt='Oportunidad media';
    var satPenal=/muy alta|alta/.test(sat);
    if(score>=62&&!satPenal){cls='alta';txt='Oportunidad alta';}
    else if(score<45||/muy alta/.test(sat)){cls='baja';txt='Requiere validacion';}
    else {cls='media';txt='Oportunidad media';}
    return {cls:cls,txt:txt};
  }
  function enhance(){
    document.querySelectorAll('.product-card').forEach(function(card){
      if(card.querySelector('.v4-verdict'))return;
      var v=verdictFromCard(card);
      var badge=document.createElement('div');
      badge.className='v4-verdict '+v.cls;
      var icon=v.cls==='alta'?'<svg class="ic" aria-hidden="true"><use href="#i-fire"></use></svg>':(v.cls==='baja'?'<svg class="ic" aria-hidden="true"><use href="#i-warn"></use></svg>':'<svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg>');
      // textContent escapaba el <svg> y el usuario veia el markup crudo en cada tarjeta
      badge.innerHTML=icon+' '+v.txt;
      var bar=card.querySelector('.score-bar');
      if(bar&&bar.parentNode){bar.parentNode.insertBefore(badge,bar.nextSibling);}
      else{card.appendChild(badge);}
    });
  }
  var grid=null;
  function watch(){
    grid=document.querySelector('.products-grid');
    if(grid){
      new MutationObserver(function(){enhance();}).observe(grid,{childList:true});
      enhance();
    }
  }
  // live badge in hero
  function heroBadge(){
    var t=document.querySelector('.app-title');
    if(t&&!document.querySelector('.v4-live')){
      var b=document.createElement('div');
      b.className='v4-live';
      b.innerHTML='<span class="dot"></span> Datos reales de MercadoLibre en vivo';
      t.parentNode.insertBefore(b,t);
    }
    var cfg=document.querySelector('.config-card');
    if(cfg&&!document.querySelector('.v4-hint')){
      var h=document.createElement('div');
      h.className='v4-hint';
      h.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-bulb"></use></svg> <span><b>Como se usa:</b> eleg\u00ed tu capital y nicho, y la app analiza el mercado real de MercadoLibre para mostrarte los productos con mejor potencial para importar.</span>';
      cfg.parentNode.insertBefore(h,cfg);
    }
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){watch();heroBadge();});}
  else{watch();heroBadge();}
})();

/* ---- bloque 6 ---- */
/* ===== v5 Freemium gate — DESACTIVADO =====
   El recorte se hace en el servidor (api/analyze.js + api/_sesion.js).
   Este bloque tapaba tarjetas que igual viajaban al navegador, asi que
   el candado se salteaba desde la consola. Se deja apagado a proposito. */
(function(){
  if(true) return;
  var FREE_LIMIT = 3;
  function isPremium(){ if(localStorage.getItem('pf_role')==='admin') return true;
    try{ return localStorage.getItem('pf_premium')==='1'; }catch(e){ return false; }
  }
  function applyGate(){
    if(isPremium()) return;
    var grid = document.querySelector('.products-grid');
    if(!grid) return;
    var cards = grid.querySelectorAll('.product-card');
    if(cards.length <= FREE_LIMIT) return;
    /* idempotente: re-aplica en cada render */
    // free-tier banner above the grid
    var hdr = document.querySelector('.results-header');
    if(hdr && !document.querySelector('.v5-freebar')){
      var bar=document.createElement('div');
      bar.className='v5-freebar';
      bar.innerHTML=' Est\u00e1s viendo la <b style="margin:0 4px">versi\u00f3n gratuita</b> \u2014 muestro '+FREE_LIMIT+' de '+cards.length+' productos. Los clientes de asesor\u00eda acceden a todos.';
      hdr.parentNode.insertBefore(bar, hdr.nextSibling);
    }
    // wrap locked cards
    for(var i=FREE_LIMIT;i<cards.length;i++){
      (function(card){
        card.classList.add('v5-locked');
        if(card.querySelector('.v5-lock-overlay')) return;
        var ov=document.createElement('div');
        ov.className='v5-lock-overlay';
        ov.innerHTML='<div class="v5-lock-icon"><svg class="ic" aria-hidden="true"><use href="#i-lock"></use></svg></div>'+
          '<div class="v5-lock-title">Producto reservado para clientes</div>'+
          '<div class="v5-lock-sub">Desbloque\u00e1 los '+cards.length+' productos, la rentabilidad detallada y el acompa\u00f1amiento contratando la asesor\u00eda.</div>'+
          '<button class="v5-lock-btn" type="button"><svg class="ic" aria-hidden="true"><use href="#i-rocket"></use></svg> Reserv\u00e1 tu asesor\u00eda</button>';
        card.appendChild(ov);
        ov.querySelector('.v5-lock-btn').addEventListener('click',function(){
          var cs=document.querySelector('.contact-section');
          if(cs) cs.scrollIntoView({behavior:'smooth',block:'center'});
        });
      })(cards[i]);
    }
  }
  var g=document.querySelector('.products-grid');
  function watchGate(){
    var grid=document.querySelector('.products-grid');
    if(grid){ new MutationObserver(function(){ setTimeout(applyGate,60); }).observe(grid,{childList:true}); applyGate(); }
    else setTimeout(watchGate,400);
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',watchGate);}else{watchGate();}
})();

/* ---- bloque 7 ---- */
/* ===== v6 Ganancia estimada (additive) ===== */
(function(){
  function parseMoney(txt){ if(!txt) return null; var m=txt.replace(/\./g,'').replace(/[^0-9,]/g,'').replace(',','.'); var n=parseFloat(m); return isNaN(n)?null:n; }
  function fmt(n){ return '$'+Math.round(n).toLocaleString('es-AR'); }
  function statByLabel(card,rx){ var out=null; card.querySelectorAll('.stat').forEach(function(s){var l=s.querySelector('.stat-l'); if(l&&rx.test(l.textContent)){var v=s.querySelector('.stat-v'); if(v)out=v.textContent.trim();}}); return out; }
  function enhance(){
    document.querySelectorAll('.product-card').forEach(function(card){
      if(card.querySelector('.v6-profit')) return;
      var costo=parseMoney(statByLabel(card,/costo/i));
      if(!costo) return;
      var precioTxt=statByLabel(card,/precio/i);
      var precio=(precioTxt&&/[0-9]/.test(precioTxt))?parseMoney(precioTxt):null;
      var el=document.createElement('div'); el.className='v6-profit';
      if(precio&&precio>costo){
        el.innerHTML='<div class="v6-h">Ganancia por unidad (dato real)</div><div class="v6-v">'+fmt(precio-costo)+'</div><div class="v6-note">Precio de venta real de MercadoLibre menos costo puesto estimado.</div>';
      } else {
        el.innerHTML='<div class="v6-h">Ganancia estimada por unidad</div><div class="v6-v">'+fmt(costo)+' a '+fmt(costo*1.5)+'</div><div class="v6-note">Proyecci\u00f3n con markup t\u00edpico de 2x\u20132,5x sobre el costo puesto. Valid&#225; el precio real en MercadoLibre.</div>';
      }
      card.appendChild(el);
    });
  }
  function watch(){
    var grid=document.querySelector('.products-grid');
    if(grid){ new MutationObserver(function(){ setTimeout(enhance,80); }).observe(grid,{childList:true}); enhance(); }
    else setTimeout(watch,400);
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',watch);}else{watch();}
})();

/* ---- bloque 8 ---- */
/* ===== v7 enhancer: form hints + friendly errors ===== */
(function(){
  function enhanceForm(){
    var hints={selCapital:'Cu\u00e1nto pod\u00e9s invertir hoy. No hace falta ser exacto, eleg\u00ed el rango m\u00e1s cercano.',selExperiencia:'S\u00e9 honesto: si es tu primera vez, eleg\u00ed "Sin experiencia". Ajustamos las sugerencias a tu nivel.',selCanal:'D\u00f3nde vas a vender. Si a\u00fan no sab\u00e9s, dej\u00e1 MercadoLibre.',selNicho:'El rubro que te interesa explorar. Pod\u00e9s cambiarlo y volver a analizar cuando quieras.',selRiesgo:'Cu\u00e1nto riesgo toler\u00e1s. "Bajo" = productos m\u00e1s seguros y probados.'};
    var sels=document.querySelectorAll('.config-card select, .selects-grid select');
    sels.forEach(function(sel){ var g=sel.closest('.select-group'); if(g && !g.querySelector('.v7-hint')){ var h=document.createElement('small'); h.className='v7-hint'; h.textContent=hints[sel.id]||'Eleg\u00ed la opci\u00f3n que mejor te represente.'; g.appendChild(h); } });
    var grid=document.querySelector('.selects-grid');
    if(grid && !document.querySelector('.v7-formhead')){ var head=document.createElement('div'); head.className='v7-formhead'; head.innerHTML='<span class="v7-dot"><svg class="ic" aria-hidden="true"><use href="#i-dot"></use></svg></span><span>S\u00f3lo 5 opciones r\u00e1pidas \u2014 <strong>listo en 30 segundos</strong>. No pedimos datos personales para analizar.</span>'; grid.parentNode.insertBefore(head,grid); }
  }
  window.__v7showError=function(errMsg){
    var grid=document.getElementById('productsGrid'); if(!grid) return;
    var raw=(errMsg||'').toString().toLowerCase(); var cfg;
    if(/nicho|seccion|secci\u00f3n|falta elegir/.test(raw)){ cfg={ico:'<svg class="ic" aria-hidden="true"><use href="#i-target"></use></svg>',title:'Falta elegir un rubro',what:'Para analizar el mercado necesitamos saber qu\u00e9 categor\u00eda de productos te interesa.',sols:['Eleg\u00ed un rubro en el men\u00fa "Nicho de mercado".','Despu\u00e9s toc\u00e1 "Analizar Productos" de nuevo.']}; }
    else if(/failed to fetch|networkerror|network|conexion|conexi\u00f3n|timeout|load failed/.test(raw)){ cfg={ico:'<svg class="ic" aria-hidden="true"><use href="#i-chart"></use></svg>',title:'Se cort\u00f3 la conexi\u00f3n',what:'No pudimos comunicarnos con el servidor. Casi siempre es un tema moment&#225;neo de internet.',sols:['Revis\u00e1 tu conexi\u00f3n a internet.','Esper\u00e1 unos segundos y volv\u00e9 a intentar.','Si sigue igual, record\u00e1 recargar la p\u00e1gina.']}; }
    else if(/405|method|500|servidor|server|api key/.test(raw)){ cfg={ico:'<svg class="ic" aria-hidden="true"><use href="#i-build"></use></svg>',title:'El servidor est\u00e1 ocupado',what:'Tuvimos un problema t\u00e9cnico procesando tu an\u00e1lisis. No es nada que hayas hecho mal.',sols:['Esper\u00e1 un momento y volv\u00e9 a intentar.','Si persiste, prob\u00e1 m\u00e1s tarde: lo estamos revisando.']}; }
    else { cfg={ico:'<svg class="ic" aria-hidden="true"><use href="#i-warn"></use></svg>',title:'No pudimos completar el an\u00e1lisis',what:'Ocurri\u00f3 algo inesperado, pero tiene soluci\u00f3n. Probemos de nuevo.',sols:['Volv\u00e9 a tocar "Analizar Productos".','Si el problema sigue, record\u00e1 recargar la p\u00e1gina.']}; }
    grid.innerHTML='<div class="v7-errcard"><span class="v7-ico">'+cfg.ico+'</span><h4>'+cfg.title+'</h4><div class="v7-what">'+cfg.what+'</div><div class="v7-sol-title">C\u00f3mo solucionarlo</div><ul>'+cfg.sols.map(function(s){return '<li>'+s+'</li>';}).join('')+'</ul><button class="v7-retry" onclick="var b=document.getElementById(\'analyzeBtn\')||document.querySelector(\'.btn-analyze\'); if(b) b.click();"><svg class="ic" aria-hidden="true"><use href="#i-refresh"></use></svg> Reintentar an\u00e1lisis</button></div>';
    var rs=document.getElementById('resultsSection'); if(rs) rs.style.display='block';
  };
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',enhanceForm); } else { enhanceForm(); }
  setTimeout(enhanceForm,600); setTimeout(enhanceForm,1500);
})();

/* ---- bloque 9 ---- */
/* ===== v8: onboarding 1a vez + resumen post-analisis ===== */
(function(){
  function showOnboarding(){
    try{ if(localStorage.getItem('pf_onboarded')==='1') return; }catch(e){}
    if(document.querySelector('.v8-ob-overlay')) return;
    // Este onboarding es del Recomendador por perfil (appScreen): no interrumpir
    // la landing publica ni ninguna otra pantalla.
    var appEl=document.getElementById('appScreen');
    if(!appEl || !appEl.classList.contains('active')) return;
    var ov=document.createElement('div'); ov.className='v8-ob-overlay';
    ov.innerHTML='<div class="v8-ob">'+
      '<span class="v8-ob-badge">Bienvenido</span>'+
      '<h2>Tu lectura de mercado en 3 pasos</h2>'+
      '<div class="v8-ob-lead">No necesit\u00e1s experiencia previa. Te guiamos para que encuentres qu\u00e9 conviene importar, con datos reales de MercadoLibre.</div>'+
      '<div class="v8-ob-steps">'+
        '<div class="v8-ob-step"><div class="v8-ob-num">1</div><div class="v8-ob-txt">Defin\u00ed tu perfil<small>Eleg\u00ed capital, experiencia y rubro. Son 5 opciones r\u00e1pidas.</small></div></div>'+
        '<div class="v8-ob-step"><div class="v8-ob-num">2</div><div class="v8-ob-txt">Analizamos el mercado real<small>Consultamos precios, competencia y saturaci\u00f3n en MercadoLibre.</small></div></div>'+
        '<div class="v8-ob-step"><div class="v8-ob-num">3</div><div class="v8-ob-txt">Recib\u00eds las oportunidades<small>Productos ordenados por potencial, con el mejor destacado como TOP PICK.</small></div></div>'+
      '</div>'+
      '<button class="v8-ob-btn">Empezar \u2192</button>'+
      '<button class="v8-ob-skip">Ya conozco la app, saltar</button>'+
    '</div>';
    function close(){ try{localStorage.setItem('pf_onboarded','1')}catch(e){} ov.remove(); }
    ov.addEventListener('click',function(e){ if(e.target===ov) close(); });
    document.body.appendChild(ov);
    ov.querySelector('.v8-ob-btn').addEventListener('click',close);
    ov.querySelector('.v8-ob-skip').addEventListener('click',close);
  }
  function renderSummary(){
    var grid=document.getElementById('productsGrid');
    var d=window.__lastAnalysis; if(!grid||!d) return;
    var prods=d.products||[]; if(!prods.length) return;
    var total=prods.length;
    var withData=prods.filter(function(p){return p.score!=null;}).length;
    var top=prods.filter(function(p){return p.topPick;})[0]||prods[0];
    var ex=grid.querySelector('.v8-summary'); if(ex) ex.remove();
    var el=document.createElement('div'); el.className='v8-summary';
    el.innerHTML='<h3><svg class="ic" aria-hidden="true"><use href="#i-star"></use></svg> Encontramos '+total+' oportunidades para tu perfil</h3>'+
      '<div class="v8-sub">Analizamos productos aptos para tu capital, experiencia y tolerancia al riesgo. Estos son los n\u00fameros reales de este an\u00e1lisis:</div>'+
      '<div class="v8-stats">'+
      '<div class="v8-stat"><div class="v8-n">'+total+'</div><div class="v8-l">Productos analizados</div></div>'+
      '<div class="v8-stat"><div class="v8-n">'+withData+'</div><div class="v8-l">Con datos reales de mercado</div></div>'+
      '</div>'+
      (top?'<div class="v8-top"><svg class="ic" aria-hidden="true"><use href="#i-star"></use></svg> Tu mejor oportunidad ahora: <strong>'+top.nombre+'</strong>'+(top.riesgo?' \u00b7 riesgo '+String(top.riesgo).toLowerCase():'')+'. Est\u00e1 primera en la lista de abajo.</div>':'');
    grid.insertBefore(el, grid.firstChild);
  }
  // Observe the products grid: when cards get rendered, add the summary
  function watchGrid(){
    var grid=document.getElementById('productsGrid'); if(!grid) return;
    var mo=new MutationObserver(function(){
      if(window.__lastAnalysis && grid.querySelector('.product-card') && !grid.querySelector('.v8-summary')){
        renderSummary();
      }
    });
    mo.observe(grid,{childList:true});
  }
  function init(){ showOnboarding(); watchGrid(); }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',init); } else { init(); }
  setTimeout(init,800);
})();

/* ---- bloque 10 ---- */
/* ===== v9: Analizador &#8212; veredicto local honesto + explicaciones ===== */
(function(){
  window.__v9render=function(md){
    md = md || (typeof mrData!=='undefined'? mrData : null);
    if(!md || !md.step4) return;
    var s4=md.step4, nf=new Intl.NumberFormat('es-AR');
    var venta=s4.venta||0, margenARS=Math.round(s4.margenARS||0), margenPct=s4.margenPct;
    var variable=(s4.comisionMeLiARS||0)+(s4.ivaARS||0)+(s4.iibbARS||0);
    var fixed=(s4.fobARS||0)+(s4.fleteARS||0)+(s4.seguroARS||0)+(s4.arancelesARS||0)+(s4.despachoARS||0)+(s4.empaqueARS||0)+(s4.logisticaARS||0)+(s4.fullARS||0);
    var varRate=venta>0?variable/venta:0.39;
    function priceFor(t){ return (1-varRate-t)>0? Math.round(fixed/(1-varRate-t)/100)*100 : null; }
    var p25=priceFor(0.25), be=priceFor(0), tc=s4.tc||1250, fobUSD=s4.fob;
    var targetFixed=venta*(1-varRate-0.25), fobDeltaARS=fixed-targetFixed, fobNewARS=Math.max(0,(s4.fobARS||0)-fobDeltaARS), fobNewUSD=(fobNewARS/tc).toFixed(2);
    var cls,icon,title,lead,fixes=[];
    if(margenPct<0){
      cls='v9-no'; icon='<svg class="ic" aria-hidden="true"><use href="#i-x"></use></svg>'; title='Tal como est\u00e1, NO conviene';
      lead='Con los n\u00fameros que cargaste, <b>perd\u00e9s $'+nf.format(Math.abs(margenARS))+' por unidad</b> ('+margenPct+'% de margen). Vendiendo a $'+nf.format(venta)+' no cubr\u00eds los costos de importar y vender.';
      fixes=[{i:'<svg class="ic" aria-hidden="true"><use href="#i-money"></use></svg>',t:'Vender m\u00e1s caro: a partir de <b>$'+nf.format(be)+'</b> dej\u00e1s de perder, y con <b>$'+nf.format(p25)+'</b> lograr\u00edas un margen sano del 25%.'},{i:'<svg class="ic" aria-hidden="true"><use href="#i-build"></use></svg>',t:'Comprar m\u00e1s barato en origen: si consegu\u00eds el FOB a <b>~USD '+fobNewUSD+'</b> (hoy USD '+fobUSD+'), pasar\u00eda a ser rentable al precio actual.'},{i:'<svg class="ic" aria-hidden="true"><use href="#i-box"></use></svg>',t:'Bajar costos de env\u00edo/despacho: negociar flete o elegir otra modalidad reduce el costo por unidad.'}];
    } else if(margenPct<15){
      cls='v9-cond'; icon='<svg class="ic" aria-hidden="true"><use href="#i-warn"></use></svg>'; title='Conviene con condiciones';
      lead='Deja margen ($'+nf.format(margenARS)+' por unidad, '+margenPct+'%), pero es ajustado. Con poco margen, cualquier imprevisto (d\u00f3lar, flete) te puede dejar en cero.';
      fixes=[{i:'<svg class="ic" aria-hidden="true"><use href="#i-money"></use></svg>',t:'Apuntar a <b>$'+nf.format(p25)+'</b> de precio de venta para un margen del 25%, m\u00e1s seguro.'},{i:'<svg class="ic" aria-hidden="true"><use href="#i-build"></use></svg>',t:'Mejorar el FOB o el volumen de compra para bajar el costo por unidad.'}];
    } else {
      cls='v9-si'; icon='<svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg>'; title='Conviene traerlo';
      lead='Los n\u00fameros cierran: <b>$'+nf.format(margenARS)+' de margen por unidad ('+margenPct+'%)</b>. Es un buen candidato para importar.';
      fixes=[{i:'<svg class="ic" aria-hidden="true"><use href="#i-trend"></use></svg>',t:'Valid\u00e1 la demanda real revisando ventas de los primeros listings antes de comprar volumen.'},{i:'<svg class="ic" aria-hidden="true"><use href="#i-refresh"></use></svg>',t:'Empez\u00e1 con una compra chica para confirmar calidad y tiempos antes de escalar.'}];
    }
    var h='<div class="v9-reco '+cls+'"><h4>'+icon+' '+title+'</h4><div class="v9-lead">'+lead+'</div><div class="v9-fix-title">C\u00f3mo hacerlo viable</div><div class="v9-fixes">'+fixes.map(function(f){return '<div class="v9-fix"><span class="v9-fi">'+f.i+'</span><span class="v9-ft">'+f.t+'</span></div>';}).join('')+'</div></div>';
    var at=document.getElementById('mrAnalysisText');
    if(at){ var ex=document.querySelector('.v9-reco'); if(ex) ex.remove(); at.insertAdjacentHTML('afterend', h); }
  };
  window.__v9fallback=function(){
    var md=(typeof mrData!=='undefined')? mrData : null;
    if(!md||!md.step4) return;
    var s4=md.step4, nf=new Intl.NumberFormat('es-AR');
    // Sin comparable no hay score: el gauge no se dibuja (y ademas se oculta).
    // Dibujarlo con "||0" mostraba una aguja en cero, que se lee como
    // "puntuo psimo" cuando en realidad no se puede puntuar.
    var hayScore = s4.scoreReponderado != null;
    var score=hayScore?Math.max(0,Math.min(100,s4.scoreReponderado)):0;
    if(hayScore) try{
      var gaugeArc=251, gOffset=gaugeArc-(score/100)*gaugeArc;
      var gf=document.getElementById('gaugeFill'); if(gf) gf.style.strokeDashoffset=gOffset;
      var gn=document.getElementById('gaugeNeedle'); if(gn) gn.style.transform='rotate('+(-90+(score/100)*180)+'deg)';
      var col=score>=65?'#27ae60':score>=40?'#FFE600':'#c0392b';
      var gs=document.getElementById('gaugeScore'); if(gs){ mcCountUp(gs, score); gs.setAttribute('fill',col); }
      var gl=document.getElementById('gaugeLabel'); if(gl) gl.textContent=score>=65?'Viabilidad alta':score>=40?'Viabilidad media':'Viabilidad baja';
    }catch(e){}
    var margenPct=s4.margenPct;
    var verd=margenPct<0?'NO RECOMENDADO':(margenPct<15?'VIABLE CON CONDICIONES':'VIABLE');
    var vBox=document.getElementById('mrVeredictoBox'), vTitle=document.getElementById('mrVeredictoTitle');
    if(vBox){ vBox.className='mr-veredicto'; vBox.classList.add(verd==='VIABLE'?'mv-si':verd==='NO RECOMENDADO'?'mv-no':'mv-cond'); }
    if(vTitle){ vTitle.textContent=(verd==='VIABLE'?'<svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg> VIABLE':verd==='NO RECOMENDADO'?'<svg class="ic" aria-hidden="true"><use href="#i-x"></use></svg> NO RECOMENDADO':'<svg class="ic" aria-hidden="true"><use href="#i-warn"></use></svg> VIABLE CON CONDICIONES'); }
    function setF(n,sc,label,why){
      // sc null = no hay score, que NO es lo mismo que un score de 0. Antes el
      // "||0" pintaba la tarjeta de Competencia en rojo con 0/100 cuando en
      // realidad no se puede puntuar: se lee como pesimo en vez de "sin dato".
      var sinDato = (sc == null);
      var s=sinDato?0:Math.max(0,Math.min(100,sc));
      var tier=sinDato?'gris':(s>=65?'verde':s>=40?'amarillo':'rojo');
      var col=tier==='verde'?'#27ae60':tier==='amarillo'?'#FFE600':tier==='rojo'?'#c0392b':'#4a4a52';
      var fc=document.getElementById('fc'+n); if(fc) fc.className='mfc '+tier;
      var fcs=document.getElementById('fcs'+n); if(fcs){ fcs.textContent=sinDato?'sin dato':(s+'/100'); fcs.className='mfc-score '+tier; }
      var fcb=document.getElementById('fcb'+n); if(fcb){ fcb.style.width=(sinDato?0:s)+'%'; fcb.style.background=col; }
      var fcl=document.getElementById('fcl'+n); if(fcl&&label) fcl.textContent=label;
      if(fcl&&!fcl.parentElement.querySelector('.v9-factor-why')){ var w=document.createElement('div'); w.className='v9-factor-why'; w.textContent=why; fcl.parentElement.appendChild(w); }
    }
    setF(1,s4.scD,'Score de demanda','Mide si la gente busca y compra este producto en Argentina.');
    setF(2,s4.scC,(s4.scC==null?'Sin comparable en MeLi':'Competencia estimada'),
      (s4.scC==null
        ? 'No hay publicaciones con que comparar. La ausencia de competencia NO puntua a favor.'
        : 'Mide cu\u00e1nta competencia hay vendiendo lo mismo. Menos competencia, mejor.'));
    setF(3,s4.scM,(margenPct<0?('Perd\u00e9s $'+nf.format(Math.abs(Math.round(s4.margenARS)))+'/u'):('Margen '+margenPct+'%')),'Mide cu\u00e1nta ganancia queda despu\u00e9s de todos los costos. Es el factor m\u00e1s decisivo.');
    setF(4,s4.scR,'Regulaci\u00f3n','Mide restricciones aduaneras o permisos que compliquen la importaci\u00f3n.');
    if(window.__v9render) window.__v9render(md);
  };
  // Also enrich the result when the AI DID work: add factor whys + recommendation after render
  var _origRMR = null;
  function hookRender(){
    if(typeof renderMRResult==='function' && !renderMRResult.__v9hooked){
      _origRMR = renderMRResult;if(renderMRResult.__mrw){return;}
      window.renderMRResult = function(r){ var out=_origRMR.apply(this,arguments); try{
        var md=(typeof mrData!=='undefined')?mrData:null;
        if(md&&md.step4){
          // add whys to factor cards if missing
          [['fcl1','Mide si la gente busca y compra este producto en Argentina.'],['fcl2','Mide cu\u00e1nta competencia hay vendiendo lo mismo. Menos competencia, mejor.'],['fcl3','Mide cu\u00e1nta ganancia queda despu\u00e9s de todos los costos. Es el factor m\u00e1s decisivo.'],['fcl4','Mide restricciones aduaneras o permisos que compliquen la importaci\u00f3n.']].forEach(function(p){ var fcl=document.getElementById(p[0]); if(fcl&&!fcl.parentElement.querySelector('.v9-factor-why')){ var w=document.createElement('div'); w.className='v9-factor-why'; w.textContent=p[1]; fcl.parentElement.appendChild(w); } });
          if(window.__v9render) window.__v9render(md);
        }
      }catch(e){} return out; };
      window.renderMRResult.__v9hooked=true;try{renderMRResult.__mrw=1}catch(e){}
    }
  }
  setTimeout(hookRender,800); setTimeout(hookRender,2000);
})();

/* ---- bloque 11 ---- */
/* ===== v10 TANDA1: Analizador &#8212; modo r&#225;pido + ayudas ===== */
(function(){
  window.__quickRun=async function(product,fob,precio,ventas){
    document.getElementById('mrProductInput').value=product;
    if(typeof startMRAnalysis==='function') startMRAnalysis();
    var tries=0;
    while(tries<40){ await new Promise(function(r){setTimeout(r,400);}); if(typeof mrData!=='undefined'&&mrData.step1&&mrData.step2) break; tries++; }
    if(typeof mrData==='undefined'||!mrData.step1) return {ok:false};
    if(typeof resetMRGuidedStep==='function') resetMRGuidedStep(3);
    await new Promise(function(r){setTimeout(r,150);});
    var tv=document.getElementById('mrTiktokViews'); if(tv) tv.value='';
    var ta=document.getElementById('mrTiktokArg'); if(ta) ta.value='pocos';
    if(typeof confirmMRStep3==='function') confirmMRStep3();
    if(typeof resetMRGuidedStep==='function') resetMRGuidedStep(4);
    await new Promise(function(r){setTimeout(r,150);});
    var f=document.getElementById('mrFOB'); if(f) f.value=fob;
    var vs=document.getElementById('mrVentas'); if(vs) vs.value=ventas;
    var pv=document.getElementById('mrPrecioVenta'); if(pv) pv.value=precio;
    if(typeof confirmMRStep4==='function') confirmMRStep4();
    await new Promise(function(r){setTimeout(r,200);});
    if(typeof runMRFinalAnalysis==='function') runMRFinalAnalysis();
    return {ok:true};
  };
  function buildTanda1(){
    var box=document.querySelector('.mr-search-box'); if(!box) return;
    if(document.querySelector('.v10-modebar')) return;
    var bar=document.createElement('div'); bar.className='v10-modebar';
    bar.innerHTML='<button class="v10-modebtn active" id="v10ModeQuick"><svg class="ic" aria-hidden="true"><use href="#i-rocket"></use></svg> Modo r\u00e1pido</button><button class="v10-modebtn" id="v10ModeFull"><svg class="ic" aria-hidden="true"><use href="#i-search"></use></svg> An\u00e1lisis completo</button>';
    box.parentNode.insertBefore(bar,box);
    var q=document.createElement('div'); q.className='v10-quick';
    q.innerHTML='<h3><svg class="ic" aria-hidden="true"><use href="#i-rocket"></use></svg> An\u00e1lisis r\u00e1pido en 3 datos</h3>'+
      '<div class="v10-q-sub">Solo lo esencial. Estimamos el resto y lo marcamos como <b>estimado</b> para que despu\u00e9s lo ajustes si quer\u00e9s.</div>'+
      '<div class="v10-q-grid">'+
      '<div class="v10-q-field v10-q-full"><label>\u00bfQu\u00e9 producto quer\u00e9s analizar?</label><input id="v10qProd" placeholder="Ej: soporte plegable para celular"><small>Escrib\u00ed el nombre como lo buscar\u00edas en MercadoLibre.</small></div>'+
      '<div class="v10-q-field"><label>Costo FOB (USD por unidad)</label><input id="v10qFob" type="number" placeholder="Ej: 3.5"><small>Lo que te cuesta en China, por unidad.</small></div>'+
      '<div class="v10-q-field"><label>Precio de venta en ML (ARS)</label><input id="v10qPrecio" type="number" placeholder="Ej: 12000"><small>A cu\u00e1nto se vende hoy en MercadoLibre.</small></div>'+
      '<div class="v10-q-field v10-q-full"><label>Ventas por mes (aprox.)</label><input id="v10qVentas" type="number" placeholder="Ej: 120"><small>Cu\u00e1ntas unidades venden por mes los primeros listings. Si no sab\u00e9s, pon\u00e9 un estimado.</small></div>'+
      '</div>'+
      '<button class="v10-q-btn" id="v10qGo">Analizar ahora \u2192</button>'+
      '<div class="v10-q-note"><svg class="ic" aria-hidden="true"><use href="#i-bulb"></use></svg> El resto de par\u00e1metros (tipo de cambio, arancel, env\u00edo) usan valores por defecto razonables. Para m\u00e1xima precisi\u00f3n, us\u00e1 <b>An\u00e1lisis completo</b>.</div>';
    box.parentNode.insertBefore(q,box);
    box.style.display='none';
    var params=document.querySelector('.mr-params'); if(params) params.style.display='none';
    var qm=document.getElementById('v10ModeQuick'), fm=document.getElementById('v10ModeFull');
    qm.onclick=function(){ qm.classList.add('active'); fm.classList.remove('active'); q.style.display='block'; box.style.display='none'; if(params) params.style.display='none'; };
    fm.onclick=function(){ fm.classList.add('active'); qm.classList.remove('active'); q.style.display='none'; box.style.display=''; if(params) params.style.display=''; };
    document.getElementById('v10qGo').onclick=async function(){
      var prod=document.getElementById('v10qProd').value.trim();
      var fob=document.getElementById('v10qFob').value;
      var precio=document.getElementById('v10qPrecio').value;
      var ventas=document.getElementById('v10qVentas').value||'100';
      if(!prod){ alert('Escrib\u00ed qu\u00e9 producto quer\u00e9s analizar'); return; }
      if(!fob||!precio){ alert('Complet\u00e1 el costo FOB y el precio de venta'); return; }
      this.textContent='Analizando...'; this.disabled=true;
      await window.__quickRun(prod,fob,precio,ventas);
      var b=this; setTimeout(function(){ b.textContent='Analizar ahora \u2192'; b.disabled=false; },4000);
    };
    var helps={mrCapital:'Cu\u00e1nto pod\u00e9s invertir. Ajusta las recomendaciones a tu bolsillo.',mrCanal:'D\u00f3nde vender\u00e1s. Cambia comisiones y costos.',mrModalidad:'C\u00f3mo entreg\u00e1s al comprador. Full = ML almacena y env\u00eda; Flex = envi\u00e1s vos.',mrPosicion:'Estrategia de precio frente a la competencia.',mrTipoCambio:'D\u00f3lar que us\u00e1s para tus costos. Actualiz\u00e1 si cambi\u00f3 mucho.',mrNCM:'C\u00f3digo aduanero del producto. "Auto" lo estima seg\u00fan el rubro \u2014 dej\u00e1lo as\u00ed si no lo sab\u00e9s.',mrShipMode:'C\u00f3mo traes desde China. "Auto" usa un 15% sobre FOB como estimaci\u00f3n t\u00edpica.',mrPesoKg:'Peso por unidad. Impacta el flete. Opcional.',mrDiasCap:'Cu\u00e1ntos d\u00edas tu plata queda inmovilizada hasta cobrar. Opcional.',mrTasaCap:'Costo de oportunidad de tu capital por mes. Opcional.'};
    Object.keys(helps).forEach(function(id){ var el=document.getElementById(id); if(!el) return; var wrap=el.closest('.mr-param'); if(wrap&&!wrap.querySelector('.v10-help')){ var h=document.createElement('small'); h.className='v10-help'; h.textContent=helps[id]; wrap.appendChild(h); } });
  }
  var _origShowMarket = typeof showMarket==='function'? showMarket : null;
  if(_origShowMarket){ window.showMarket=function(){ var o=_origShowMarket.apply(this,arguments); setTimeout(buildTanda1,100); return o; }; }
  setTimeout(buildTanda1,900); setTimeout(buildTanda1,2000);
})();

/* ---- bloque 12 ---- */
/* ===== v11 TANDA2: simulador de precio + desglose de costos ===== */
(function(){
  window.__v11build=function(){
    var md=(typeof mrData!=='undefined')?mrData:null;
    if(!md||!md.step4) return;
    var s4=md.step4, nf=new Intl.NumberFormat('es-AR');
    var venta0=s4.venta||0;
    var variable=(s4.comisionMeLiARS||0)+(s4.ivaARS||0)+(s4.iibbARS||0);
    var fixed=(s4.fobARS||0)+(s4.fleteARS||0)+(s4.seguroARS||0)+(s4.arancelesARS||0)+(s4.despachoARS||0)+(s4.empaqueARS||0)+(s4.logisticaARS||0)+(s4.fullARS||0);
    var varRate=venta0>0?variable/venta0:0.39;
    var ventasMes=s4.ventas||0;
    function calc(p){ var m=p-fixed-p*varRate; return {marginARS:Math.round(m), marginPct:Math.round(m/p*100), mesARS:Math.round(m*ventasMes)}; }
    var at=document.getElementById('mrAnalysisText'); if(!at) return;
    var exS=document.querySelector('.v11-sim'); if(exS) exS.remove();
    var exC=document.querySelector('.v11-costs'); if(exC) exC.remove();
    var min=Math.max(Math.round(fixed/(1-varRate)/100)*100,100);
    var max=Math.round(venta0*2.2/100)*100; if(max<=min) max=min+ (venta0||1000);
    var sim=document.createElement('div'); sim.className='v11-sim';
    sim.innerHTML='<h4><svg class="ic" aria-hidden="true"><use href="#i-scale"></use></svg> Simulador de precio</h4><div class="v11-sub">Mov\u00e9 el precio de venta y mir\u00e1 c\u00f3mo cambia tu ganancia en tiempo real.</div>'+
      '<div class="v11-sim-row"><span class="v11-price" id="v11price">$'+nf.format(venta0)+'</span><span class="v11-badge" id="v11badge">\u2014</span></div>'+
      '<input type="range" class="v11-slider" id="v11slider" min="'+min+'" max="'+max+'" step="100" value="'+venta0+'">'+
      '<div class="v11-metrics"><div class="v11-metric"><div class="v11-mn" id="v11mUnit">\u2014</div><div class="v11-ml">Ganancia por unidad</div></div><div class="v11-metric"><div class="v11-mn" id="v11mPct">\u2014</div><div class="v11-ml">Margen</div></div><div class="v11-metric"><div class="v11-mn" id="v11mMes">\u2014</div><div class="v11-ml">Ganancia mensual estimada</div></div></div>'+
      '<div class="v11-hint" id="v11hint"></div>';
    at.insertAdjacentElement('afterend', sim);
    function update(p){
      var c=calc(p);
      document.getElementById('v11price').textContent='$'+nf.format(p);
      var mu=document.getElementById('v11mUnit'); mu.textContent=(c.marginARS<0?'-':'')+'$'+nf.format(Math.abs(c.marginARS)); mu.style.color=c.marginARS<0?'#e74c3c':(c.marginPct<15?'var(--gold)':'#2ecc71');
      document.getElementById('v11mPct').textContent=c.marginPct+'%';
      document.getElementById('v11mMes').textContent=(c.mesARS<0?'-':'')+'$'+nf.format(Math.abs(c.mesARS));
      var b=document.getElementById('v11badge');
      if(c.marginPct<0){ b.className='v11-badge b-no'; b.textContent=' No conviene'; document.getElementById('v11hint').textContent='A este precio perd\u00e9s plata en cada venta.'; }
      else if(c.marginPct<15){ b.className='v11-badge b-cond'; b.textContent=' Ajustado'; document.getElementById('v11hint').textContent='Deja ganancia pero es poca. Un margen del 25% o m\u00e1s es m\u00e1s seguro.'; }
      else { b.className='v11-badge b-si'; b.textContent=' Conviene'; document.getElementById('v11hint').textContent='Buen margen. A este precio el producto es rentable.'; }
    }
    var sl=document.getElementById('v11slider');
    sl.oninput=function(){ update(parseFloat(this.value)); };
    sl.style.background='linear-gradient(90deg,#c0392b,#FFE600,#27ae60)';
    update(venta0);
    var items=[{k:'Producto (FOB)',v:s4.fobARS||0,c:'#FFE600'},{k:'Flete + seguro',v:(s4.fleteARS||0)+(s4.seguroARS||0),c:'#b8860b'},{k:'Aranceles + despacho',v:(s4.arancelesARS||0)+(s4.despachoARS||0),c:'#8e6f2e'},{k:'Comisi\u00f3n ML',v:s4.comisionMeLiARS||0,c:'#5a9bd4'},{k:'IVA + IIBB',v:(s4.ivaARS||0)+(s4.iibbARS||0),c:'#c0392b'},{k:'Log\u00edstica + empaque',v:(s4.logisticaARS||0)+(s4.empaqueARS||0)+(s4.fullARS||0),c:'#7f8c8d'}].filter(function(x){return x.v>0;});
    var totalCost=items.reduce(function(a,x){return a+x.v;},0)||1;
    var costs=document.createElement('div'); costs.className='v11-costs';
    costs.innerHTML='<h4><svg class="ic" aria-hidden="true"><use href="#i-money"></use></svg> A d\u00f3nde va cada peso</h4><div class="v11-cost-bar">'+items.map(function(it){return '<div class="v11-cost-seg" style="width:'+(it.v/totalCost*100)+'%;background:'+it.c+'"></div>';}).join('')+'</div><div class="v11-cost-legend">'+items.map(function(it){return '<div class="v11-cl"><span class="v11-dot" style="background:'+it.c+'"></span>'+it.k+'<b>$'+nf.format(Math.round(it.v))+'</b></div>';}).join('')+'</div>';
    sim.insertAdjacentElement('afterend', costs);
  };
  // hook into v9 render + fallback so it always appears after a result
  function wrap(name){
    if(typeof window[name]==='function' && !window[name].__v11){
      var orig=window[name];if(orig&&orig.__mrw){return;}
      window[name]=function(){ var o=orig.apply(this,arguments); setTimeout(window.__v11build,120); return o; };
      window[name].__v11=true;try{window[name].__mrw=1}catch(e){};
    }
  }
  function hook(){ wrap('__v9render'); wrap('__v9fallback'); if(typeof renderMRResult==='function'){ wrap('renderMRResult'); } }
  setTimeout(hook,1000); setTimeout(hook,2500);
})();

/* ---- bloque 13 ---- */
/* ===== v12 TANDA3: CTA contextual a asesor&#237;a + compartir imagen ===== */
(function(){
  window.__v12build=function(){
    var md=(typeof mrData!=='undefined')?mrData:null;
    if(!md||!md.step4) return;
    var s4=md.step4, margenPct=s4.margenPct, prod=md.product||'tu producto';
    var container=document.querySelector('.v9-reco')||document.getElementById('mrAnalysisText');
    if(!container) return;
    var ex=document.querySelector('.v12-cta'); if(ex) ex.remove();
    var head,sub;
    if(margenPct<0){ head='\u00bfQuer\u00e9s que lo hagamos rentable juntos?'; sub='Este producto hoy no cierra, pero muchas veces se arregla con el proveedor correcto o ajustando la estrategia. En una asesor\u00eda lo vemos en detalle.'; }
    else if(margenPct<15){ head='\u00bfLo afinamos para asegurar el margen?'; sub='Est\u00e1s cerca. Con la estrategia de precio y proveedor correctos, este producto puede rendir mucho m\u00e1s. Te ayudo en una asesor\u00eda.'; }
    else { head='\u00bfListo para importarlo bien?'; sub='Buen candidato. En una asesor\u00eda te acompa\u00f1o en el proceso completo: proveedor, log\u00edstica y publicaci\u00f3n para que no falles en el primer intento.'; }
    var waMsg=encodeURIComponent('Hola Mati! Analic\u00e9 "'+prod+'" en la app y quiero una asesor\u00eda para avanzar.');
    var cta=document.createElement('div'); cta.className='v12-cta';
    cta.innerHTML='<h4>'+head+'</h4><p>'+sub+'</p><div class="v12-cta-btns"><a class="v12-btn v12-btn-wa" href="https://wa.me/541160374306?text='+waMsg+'" target="_blank" rel="noopener"><svg class="ic" aria-hidden="true"><use href="#i-chat"></use></svg> Pedir asesor\u00eda</a><button class="v12-btn v12-btn-share" id="v12share"><svg class="ic" aria-hidden="true"><use href="#i-camera"></use></svg> Compartir resultado</button></div>';
    container.insertAdjacentElement('afterend', cta);
    var sb=document.getElementById('v12share'); if(sb) sb.onclick=function(){ window.__v12shareImg(); };
  };
  window.__v12shareImg=function(){
    var md=(typeof mrData!=='undefined')?mrData:null; if(!md||!md.step4) return;
    var s4=md.step4, margenPct=s4.margenPct, prod=md.product||'Producto', score=s4.scoreReponderado;
    var verd=margenPct<0?'NO CONVIENE':(margenPct<15?'CONVIENE CON CONDICIONES':'CONVIENE');
    var vcol=margenPct<0?'#e74c3c':(margenPct<15?'#FFE600':'#2ecc71');
    var W=1080,H=1080, c=document.createElement('canvas'); c.width=W; c.height=H; var x=c.getContext('2d');
    x.fillStyle='#0a0a0a'; x.fillRect(0,0,W,H);
    x.strokeStyle='#FFE600'; x.lineWidth=6; x.strokeRect(30,30,W-60,H-60);
    x.textAlign='center';
    x.fillStyle='#FFE600'; x.font='bold 52px Segoe UI, sans-serif'; x.fillText('LECTURA DE MERCADO',W/2,130);
    x.fillStyle='#9a9a9a'; x.font='28px Segoe UI, sans-serif'; x.fillText('An\u00e1lisis de viabilidad para importar',W/2,175);
    x.fillStyle='#F6F6F4'; x.font='bold 40px Segoe UI, sans-serif';
    var words=prod.split(' '), line='', ly=290;
    words.forEach(function(w){ if((line+w).length>26){ x.fillText(line,W/2,ly); line=w+' '; ly+=52; } else line+=w+' '; });
    x.fillText(line.trim(),W/2,ly);
    x.fillStyle=vcol; x.font='bold 64px Segoe UI, sans-serif'; x.fillText(verd,W/2,500);
    x.beginPath(); x.arc(W/2,700,120,Math.PI*0.75,Math.PI*0.75+(score/100)*Math.PI*1.5); x.strokeStyle=vcol; x.lineWidth=20; x.stroke();
    x.beginPath(); x.arc(W/2,700,120,Math.PI*0.75+(score/100)*Math.PI*1.5,Math.PI*0.25); x.strokeStyle='#2a2a2a'; x.lineWidth=20; x.stroke();
    x.fillStyle='#F6F6F4'; x.font='bold 70px Segoe UI, sans-serif'; x.fillText(score,W/2,715);
    x.fillStyle='#9a9a9a'; x.font='24px Segoe UI, sans-serif'; x.fillText('de 100',W/2,755);
    x.fillStyle=margenPct<0?'#e74c3c':'#2ecc71'; x.font='bold 44px Segoe UI, sans-serif'; x.fillText('Margen: '+margenPct+'%',W/2,900);
    x.fillStyle='#FFE600'; x.font='26px Segoe UI, sans-serif'; x.fillText('Analiz\u00e1 tu pr\u00f3ximo producto \u00b7 asesor\u00edas disponibles',W/2,990);
    var url=c.toDataURL('image/png');
    var a=document.createElement('a'); a.href=url; a.download='analisis-'+prod.replace(/[^a-z0-9]/gi,'-').toLowerCase().substring(0,30)+'.png';
    document.body.appendChild(a); a.click(); a.remove();
  };
  function wrap(name){ if(typeof window[name]==='function' && !window[name].__v12){ var orig=window[name];if(orig&&orig.__mrw){return;} window[name]=function(){ var o=orig.apply(this,arguments); setTimeout(window.__v12build,160); return o; }; window[name].__v12=true;try{window[name].__mrw=1}catch(e){}; } }
  function hook(){ wrap('__v9render'); wrap('__v9fallback'); }
  setTimeout(hook,1200); setTimeout(hook,2800);
})();

/* ---- bloque 14 ---- */
/* ===== v13 TANDA4: comparador + historial + c&#243;mo leemos ===== */
(function(){
  window.__v13add=function(){
    var md=(typeof mrData!=='undefined')?mrData:null; if(!md||!md.step4) return;
    var s4=md.step4, list=[]; try{ list=JSON.parse(localStorage.getItem('pf_compare')||'[]'); }catch(e){}
    var entry={ prod: md.product||'Producto', score: s4.scoreReponderado, margenPct: s4.margenPct, margenARS: Math.round(s4.margenARS||0), venta: s4.venta, ts: Date.now() };
    if(!list.some(function(x){return x.prod===entry.prod;})){ list.push(entry); if(list.length>4) list.shift(); localStorage.setItem('pf_compare', JSON.stringify(list)); }
    window.__v13render();
  };
  window.__v13render=function(){
    var list=[]; try{ list=JSON.parse(localStorage.getItem('pf_compare')||'[]'); }catch(e){}
    var ex=document.querySelector('.v13-cmp'); if(ex) ex.remove();
    if(list.length<1) return;
    var nf=new Intl.NumberFormat('es-AR');
    var anchor=document.querySelector('.v12-cta')||document.querySelector('.v9-reco'); if(!anchor) return;
    var el=document.createElement('div'); el.className='v13-cmp';
    el.innerHTML='<h4><svg class="ic" aria-hidden="true"><use href="#i-scale"></use></svg> Comparaci\u00f3n de productos <button class="v13-clear" id="v13clear">Limpiar</button></h4><div class="v13-csub">Guard\u00e1 varios an\u00e1lisis y compar\u00e1 cu\u00e1l conviene m\u00e1s.</div><table class="v13-cmp-table"><thead><tr><th>Producto</th><th>Score</th><th>Margen</th><th>Ganancia/u</th></tr></thead><tbody>'+
      list.map(function(x,i){ var col=x.margenPct<0?'#e74c3c':(x.margenPct<15?'#FFE600':'#2ecc71'); return '<tr><td class="v13-cmp-prod">'+x.prod+' <span class="v13-cmp-x" data-i="'+i+'"><svg class="ic" aria-hidden="true"><use href="#i-x"></use></svg></span></td><td class="v13-cmp-v" style="color:'+col+'">'+x.score+'</td><td class="v13-cmp-v" style="color:'+col+'">'+x.margenPct+'%</td><td>'+(x.margenARS<0?'-':'')+'$'+nf.format(Math.abs(x.margenARS))+'</td></tr>'; }).join('')+'</tbody></table>';
    anchor.insertAdjacentElement('afterend', el);
    var cb=document.getElementById('v13clear'); if(cb) cb.onclick=function(){ localStorage.removeItem('pf_compare'); window.__v13render(); };
    el.querySelectorAll('.v13-cmp-x').forEach(function(b){ b.onclick=function(){ var l=[]; try{l=JSON.parse(localStorage.getItem('pf_compare')||'[]');}catch(e){} l.splice(parseInt(this.dataset.i),1); localStorage.setItem('pf_compare',JSON.stringify(l)); window.__v13render(); }; });
  };
  window.__v13button=function(){
    var cta=document.querySelector('.v12-cta'); if(!cta) return;
    if(cta.querySelector('.v13-btn-add')) return;
    var wrap=document.createElement('div'); wrap.className='v13-addcmp';
    wrap.innerHTML='<button class="v13-btn-add" id="v13addbtn"><svg class="ic" aria-hidden="true"><use href="#i-plus"></use></svg> Agregar a comparaci\u00f3n</button>';
    cta.appendChild(wrap);
    document.getElementById('v13addbtn').onclick=function(){ window.__v13add(); this.textContent='\u2713 Agregado a comparaci\u00f3n'; };
  };
  window.__v13method=function(){
    if(document.querySelector('.v13-method')) return;
    var screen=document.getElementById('marketScreen'); if(!screen) return;
    var el=document.createElement('div'); el.className='v13-method';
    el.innerHTML='<h3><svg class="ic" aria-hidden="true"><use href="#i-search"></use></svg> C\u00f3mo leo el mercado</h3><div class="v13-m-sub">No invento n\u00fameros. Cada veredicto sale de datos reales y c\u00e1lculos transparentes.</div><div class="v13-m-grid"><div class="v13-m-item"><div class="v13-mi-h"><svg class="ic" aria-hidden="true"><use href="#i-trend"></use></svg> Demanda real</div><div class="v13-mi-t">Miramos tendencia y estacionalidad del rubro en Argentina, no corazonadas.</div></div><div class="v13-m-item"><div class="v13-mi-h"><svg class="ic" aria-hidden="true"><use href="#i-store"></use></svg> Competencia</div><div class="v13-mi-t">Evaluamos cu\u00e1ntos venden lo mismo. Cuando ML no da datos, lo digo \u2014 no estimamos a ciegas.</div></div><div class="v13-m-item"><div class="v13-mi-h"><svg class="ic" aria-hidden="true"><use href="#i-money"></use></svg> Margen con TODOS los costos</div><div class="v13-mi-t">FOB, flete, aranceles, IVA, IIBB, comisi\u00f3n ML y log\u00edstica. El margen que ves es el real.</div></div><div class="v13-m-item"><div class="v13-mi-h"><svg class="ic" aria-hidden="true"><use href="#i-scale"></use></svg> Regulaci\u00f3n</div><div class="v13-mi-t">Consideramos restricciones e intervenciones que puedan complicar la importaci\u00f3n.</div></div></div>';
    screen.appendChild(el);
  };
  function wrap(name){ if(typeof window[name]==='function' && !window[name].__v13){ var orig=window[name];if(orig&&orig.__mrw){return;} window[name]=function(){ var o=orig.apply(this,arguments); setTimeout(function(){ window.__v13button(); window.__v13render(); },200); return o; }; window[name].__v13=true;try{window[name].__mrw=1}catch(e){}; } }
  function hook(){ wrap('__v12build'); wrap('__v9render'); wrap('__v9fallback'); window.__v13method(); window.__v13render(); }
  var _sm = typeof showMarket==='function'? showMarket : null;
  if(_sm && !showMarket.__v13m){ window.showMarket=function(){ var o=_sm.apply(this,arguments); setTimeout(function(){ window.__v13method(); },150); return o; }; window.showMarket.__v13m=true; }
  setTimeout(hook,1400); setTimeout(hook,3000);
})();

/* ---- bloque 15 ---- */
/* === v14 &#8212; Refresh visual moderno (contador animado, reveal, glow dinamico) === */
(function(){
  if(window.__v14done) return; window.__v14done = true;

  // easing
  function easeOut(t){ return 1 - Math.pow(1-t, 3); }

  // Anima un numero desde 0 hasta su valor final (solo numeros reales que ya estan en pantalla)
  function animateNumber(el, to, suffix, dur){
    suffix = suffix || '';
    dur = dur || 1100;
    var start = null;
    var from = 0;
    function step(ts){
      if(!start) start = ts;
      var p = Math.min((ts-start)/dur, 1);
      var val = Math.round(from + (to-from)*easeOut(p));
      el.textContent = val + suffix;
      if(p < 1) requestAnimationFrame(step);
      else el.textContent = to + suffix;
    }
    requestAnimationFrame(step);
  }

  // Detecta el numero grande del score (gauge) y lo anima al aparecer
  function enhanceScore(root){
    try{
      var candidates = root.querySelectorAll('[class*="gauge"], .mr-score, svg text, div');
      // buscamos el texto que sea "NN" solo, dentro del bloque de score de viabilidad
      var heads = root.querySelectorAll('*');
      heads.forEach(function(h){
        if(h.__v14seen) return;
        var t = (h.textContent||'').trim();
        // numero puro 0-100, elemento hoja, tama&#241;o grande
        if(/^\d{1,3}$/.test(t) && h.children.length===0){
          var n = parseInt(t,10);
          if(n>=0 && n<=100){
            var fs = parseFloat(getComputedStyle(h).fontSize)||0;
            if(fs >= 28){
              h.__v14seen = true;
              animateNumber(h, n, '', 1200);
            }
          }
        }
      });
    }catch(e){}
  }

  // A&#241;ade clase de aparicion escalonada a las cards del resultado
  function revealCards(root){
    var cards = root.querySelectorAll('div');
    var i = 0;
    cards.forEach(function(c){
      if(c.__v14rev) return;
      var st = getComputedStyle(c);
      var bg = st.backgroundColor;
      var border = st.borderLeftWidth;
      // solo cards con fondo/borde (las tarjetas de factores y secciones)
      var looksCard = (border && parseFloat(border) >= 3) || (c.style && c.style.borderRadius);
      if(looksCard && c.offsetHeight > 60 && c.offsetHeight < 700){
        c.__v14rev = true;
        c.classList.add('v14-reveal');
        c.style.animationDelay = Math.min(i*70, 500) + 'ms';
        i++;
      }
    });
  }

  function run(){
    var market = document.getElementById('marketScreen') || document.body;
    enhanceScore(market);
    revealCards(market);
  }

  // Observa cambios en la pantalla de analisis para animar cuando aparece el resultado
  var target = document.getElementById('marketScreen') || document.body;
  var mo = new MutationObserver(function(){
    clearTimeout(window.__v14t);
    window.__v14t = setTimeout(run, 250);
  });
  mo.observe(target, {childList:true, subtree:true});

  // Reveal on scroll para elementos con clase v14-reveal
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(en.isIntersecting){ en.target.classList.add('v14-in'); io.unobserve(en.target); }
    });
  }, {threshold:0.12});

  // reconecta el observer a nuevas cards
  var mo2 = new MutationObserver(function(){
    document.querySelectorAll('.v14-reveal:not(.v14-io)').forEach(function(el){
      el.classList.add('v14-io'); io.observe(el);
    });
  });
  mo2.observe(document.body, {childList:true, subtree:true});

  setTimeout(run, 600);
})();

/* ---- bloque 16 ---- */
/* === v15 &#8212; Dibuja los graficos tambien cuando corre el fallback (Tendencia/Precios/Rentabilidad) === */
(function(){
  if(window.__v15done) return; window.__v15done=true;

  function buildChartData(){
    try{
      if(typeof mrData==='undefined' || !mrData) return null;
      var s1=mrData.step1||{}, s2=mrData.step2||{}, s4=mrData.step4||null;
      var monthly=(s1.monthlyData&&s1.monthlyData.length)? s1.monthlyData.map(function(d){return d.valor;}) : null;
      var meli=[ (s2.precioMinARS||0), (s2.precioPromedioARS||0), (s2.precioMaxARS||0) ];
      var wf = s4 ? {
        fob:s4.fobARS, flete:s4.fleteARS, seguro:s4.seguroARS, aranceles:s4.arancelesARS,
        despacho:s4.despachoARS, empaque:s4.empaqueARS, logistica:s4.logisticaARS, full:s4.fullARS,
        comision:s4.comisionMeLiARS, iva:s4.ivaARS, iibb:s4.iibbARS, margen:s4.margenARS
      } : null;
      return { trendData: monthly, meliData: meli, waterfallData: wf };
    }catch(e){ return null; }
  }

  function drawRadar(){
    try{
      if(typeof mrData==='undefined' || !mrData || !mrData.step4) return;
      var s4=mrData.step4;
      var el=document.getElementById('radarChart');
      if(!el || typeof Chart==='undefined') return;
      function cl(v){ v=Number(v)||0; return Math.max(0,Math.min(100,v)); }
      var vals=[ cl(s4.scD), cl(s4.scC), cl(s4.scM), cl(s4.scR) ];
      if(window._radarChart){ try{window._radarChart.destroy();}catch(e){} }
      window._radarChart=new Chart(el,{type:'radar',data:{labels:['Demanda','Competencia','Margen','Regulaci&#243;n'],datasets:[{data:vals,backgroundColor:'rgba(255,230,0,0.15)',borderColor:'#FFE600',borderWidth:2,pointBackgroundColor:'#FFE600',pointRadius:4,pointHoverRadius:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{r:{min:0,max:100,ticks:{display:false},grid:{color:'rgba(255,255,255,0.06)'},angleLines:{color:'rgba(255,255,255,0.06)'},pointLabels:{color:'#92929A',font:{size:11}}}}}});
    }catch(e){}
  }

  function drawCharts(){
    try{
      if(typeof window.drawSavedCharts!=='function') return;
      var cd=buildChartData();
      if(!cd) return;
      window.drawSavedCharts({ chartData: cd });
      drawRadar();
    }catch(e){}
  }

  // Envolver __v9fallback para dibujar los graficos despues de que arme el resultado
  function hookFallback(){
    if(typeof window.__v9fallback==='function' && !window.__v9fallback.__v15){
      var orig=window.__v9fallback;
      if(orig.__v15){ return; }
      window.__v9fallback=function(){
        var r=orig.apply(this,arguments);
        setTimeout(drawCharts, 60);
        setTimeout(drawCharts, 400);
        return r;
      };
      try{ window.__v9fallback.__v15=true; window.__v9fallback.__mrw=1; }catch(e){}
    }
  }
  hookFallback();
  setTimeout(hookFallback, 1500);

  // Red de seguridad: si tras un analisis quedan canvas vacios, dibujar
  var t=null;
  var mo=new MutationObserver(function(){
    clearTimeout(t);
    t=setTimeout(function(){
      try{
        var cvs=document.querySelectorAll('#marketScreen canvas');
        if(!cvs.length) return;
        var trend=document.getElementById('trendsChart');
        if(trend && (typeof Chart==='undefined' || !Chart.getChart || !Chart.getChart(trend))){
          drawCharts();
        }
      }catch(e){}
    }, 500);
  });
  var target=document.getElementById('marketScreen')||document.body;
  mo.observe(target,{childList:true,subtree:true});
})();

/* ---- bloque 17 ---- */
/* v18: pulido visual + estimados honestos en tarjetas de la home */
(function(){
  if(window.__v18done) return; window.__v18done=true;
  function nota(card){ var n=card.querySelector('.product-nota')||card.querySelector('.nota'); if(n) return (n.textContent||'').toLowerCase(); var t=card.textContent||''; return t.toLowerCase(); }
  function estDemanda(txt){
    if(/alta demanda|alta rotaci|tendencia|viral|en alza|home office|recompra alta/.test(txt)) return 'Alta';
    if(/consumible|recompra|barato|masivo/.test(txt)) return 'Media-Alta';
    if(/nicho|especi|gamer|premium/.test(txt)) return 'Media';
    return 'Media';
  }
  function estSat(txt){
    if(/saturad|much[ao] compet|clasico|cl\u00e1sico/.test(txt)) return 'Alta';
    if(/diminuto|alto margen|nuevo|innovador|poco vist/.test(txt)) return 'Baja-Media';
    return 'Media';
  }
  function fillEstimates(card){
    var txt=nota(card);
    var stats=card.querySelectorAll('.stat');
    stats.forEach(function(st){
      var l=st.querySelector('.stat-l'); var v=st.querySelector('.stat-v');
      if(!l||!v) return; var ln=(l.textContent||'').toLowerCase(); var vv=(v.textContent||'').trim();
      if(vv!=='A validar' && vv!=='\u2014') return;
      if(v.getAttribute('data-v18')) return;
      if(/demanda/.test(ln)){ v.innerHTML='<span class=\'v18-est\'>'+estDemanda(txt)+'</span><span class=\'v18-estbadge\'>est.</span>'; v.setAttribute('data-v18','1'); }
      else if(/satura/.test(ln)){ v.innerHTML='<span class=\'v18-est\'>'+estSat(txt)+'</span><span class=\'v18-estbadge\'>est.</span>'; v.setAttribute('data-v18','1'); }
    });
  }
  var io=new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('v18-in'); io.unobserve(e.target); } }); }, {threshold:.12});
  function enhance(){
    var cards=document.querySelectorAll('.product-card');
    cards.forEach(function(c){
      if(!c.__v18){ c.__v18=true; c.classList.add('v18-reveal'); io.observe(c); fillEstimates(c); }
    });
  }
  var grid=document.getElementById('productsGrid');
  if(grid){ var mo=new MutationObserver(function(){ setTimeout(enhance,30); }); mo.observe(grid,{childList:true,subtree:true}); }
  setTimeout(enhance,300); setTimeout(enhance,1200);
})();

/* ---- bloque 18 ---- */
/* v19: margen neto real + semaforo. Descuenta comision ML (14%) e IIBB (3%) del precio de venta. */
(function(){
  var ML_FEE = 0.14;
  var IIBB = 0.03;
  function fmtPct(n){ return (n>=0?"":"-") + Math.abs(Math.round(n)) + "%"; }
  function classify(pct){
    if(pct >= 50) return {cls:"green", label:"Margen sano para importar"};
    if(pct >= 25) return {cls:"yellow", label:"Margen ajustado, validar bien"};
    return {cls:"red", label:"Margen bajo, no conviene"};
  }
  function computeNet(precio, costo){
    if(!precio || precio<=0 || costo==null) return null;
    var ivaDebito = precio - (precio/1.21);
    var ivaCredito = costo - (costo/1.21);
    var ivaNeto = Math.max(0, ivaDebito - ivaCredito);
    var neto = precio - costo - (precio*ML_FEE) - (precio*IIBB) - ivaNeto;
    var atipico = (costo>0 && (neto/costo)*100 > 500);
    return { netoARS: neto, pct: (neto/precio)*100, atipico: atipico };
  }
  function enhance(){
    var data = (window.__lastAnalysis && window.__lastAnalysis.products) ? window.__lastAnalysis.products : null;
    if(!data) return;
    var cards = document.querySelectorAll(".product-card");
    cards.forEach(function(card, i){
      var p = data[i];
      if(!p) return;
      if(card.querySelector(".v19-mn")) return;
      var r = computeNet(p.precioVentaARS, p.costoPuestoARS);
      var anchor = card.querySelector(".v6-profit") || card;
      var box = document.createElement("div");
      if(!r){
        box.className = "v19-mn yellow";
        box.innerHTML = "<div class=\"v19-mn-top\"><span class=\"v19-dot\"></span>Margen neto: a validar<span class=\"v19-mn-pct\">\u2014</span></div><div class=\"v19-mn-note\">Sin precio de venta real disponible para calcular el margen neto.</div>";
      } else {
        var c = classify(r.pct);
        box.className = "v19-mn " + c.cls;
        box.innerHTML = "<div class=\"v19-mn-top\"><span class=\"v19-dot\"></span>" + c.label + "<span class=\"v19-mn-pct\">" + fmtPct(r.pct) + "</span></div><div class=\"v19-mn-note\">Margen neto real: precio de venta menos costo, menos comision ML (segun categoria, ~12-16,5%), IVA neto e IIBB (~3%). Deja aprox. $" + Math.round(r.netoARS).toLocaleString("es-AR") + " por unidad." + (r.atipico ? "<br><span style='color:#e0a000'><svg class='ic' aria-hidden='true'><use href='#i-warn'></use></svg> Precio de referencia de MercadoLibre atipico (margen muy alto): revisa el precio real antes de decidir.</span>" : "") + "</div>";
      }
      anchor.appendChild(box);
    });
    addLegend();
  }
  function addLegend(){
    var grid = document.getElementById("productsGrid");
    if(!grid || document.getElementById("v19-legend")) return;
    var lg = document.createElement("div");
    lg.id = "v19-legend"; lg.className = "v19-legend";
    lg.innerHTML = "<b>\u00bfComo leer el margen neto?</b> Es lo que realmente te queda despues de descontar la comision de MercadoLibre (segun categoria), el IVA neto (debito de venta menos credito de la importacion) y IIBB del precio de venta. El IIBB varia segun la provincia; usamos un 3% como promedio estimativo entre jurisdicciones. <span class=\"v19-chip v19-mn green\"><span class=\"v19-dot\"></span>Verde \u2265 50%</span><span class=\"v19-chip v19-mn yellow\"><span class=\"v19-dot\"></span>Amarillo 25-50%</span><span class=\"v19-chip v19-mn red\"><span class=\"v19-dot\"></span>Rojo < 25%</span> Para importar desde China conviene apuntar a verde. El markup bruto (%) que figura arriba no descuenta comisiones, por eso es mucho mas alto.";
    grid.parentNode.insertBefore(lg, grid.nextSibling);
  }
  var obs = new MutationObserver(function(){ setTimeout(enhance, 60); });
  function boot(){
    var grid = document.getElementById("productsGrid");
    if(grid){ obs.observe(grid, {childList:true, subtree:true}); }
    setTimeout(enhance, 300);
  }
  if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded", boot); } else { boot(); }
})();

/* ---- bloque 19 ---- */
(function(){
    try{
      var u = localStorage.getItem('pf_user') || 'invitado';
      var role = localStorage.getItem('pf_role') || 'guest';
      document.querySelectorAll('.mc-un').forEach(function(e){ e.textContent = u; });
      document.querySelectorAll('.mc-av').forEach(function(e){ e.textContent = (u.charAt(0)||'?').toUpperCase(); });
      if(role === 'admin'){ document.querySelectorAll('.mc-admin-item').forEach(function(e){ e.style.display=''; }); }
    }catch(e){}
    // El globo de asesoria ahora lo maneja mc-ui.js (una sola copia para
    // toda la app). Aca habia una segunda que se enganchaba en paralelo.
  })();

/* ---- bloque 20 ---- */
function goHome(){
  try{ if(typeof showMenu==='function'){ showMenu(); } else { showScreen('menuScreen'); } }catch(e){}
  try{ window.scrollTo({top:0,behavior:'smooth'}); }catch(e){ window.scrollTo(0,0); }
}
// QUITADO: un IIFE que, si la URL tenia #menu, abria SOLO el menu del nav a los
// 300 ms de cargar. Como showMenu() deja la home en #menu apenas entra, en
// celular eso significaba que entrar al sitio te abria el menu desplegado
// encima de todo: medido en 360x800, el menu ocupaba 734 px de 800 y el hub
// quedaba tapado. El usuario nunca veia la portada, tocaba cosas sobre un
// overlay que se habia abierto solo, y de ahi la sensacion de que "no me
// redirecciona a la herramienta". El menu se abre cuando el usuario lo pide,
// no al entrar.

/* ---- bloque 21 ---- */
/* ===== Bloque de decision: por que SI / por que NO =====
   Todo lo que sigue se calcula en JavaScript con reglas deterministas. La IA
   no decide, no inventa numeros y no agrega factores: solo redacta el texto a
   partir de las senales que este codigo le pasa. Si falta un dato, la senal se
   omite; nunca se rellena con una estimacion.
   ===================================================================== */
(function(){

  // ------------------------------------------------------------------
  // Recalculo del margen con la MISMA formula del paso 4, variando una
  // sola variable por vez. Los escenarios de quiebre iteran sobre esto:
  // no se estiman, se resuelven.
  // ------------------------------------------------------------------
  function mrMargenCon(s4, over){
    over = over || {};
    const tc    = over.tc    != null ? over.tc    : s4.tc;
    const venta = over.venta != null ? over.venta : s4.venta;
    const fob = s4.fob;
    // El flete y el empaque estan fijados en USD: no dependen del tipo de
    // cambio ni del precio de venta.
    const fleteUSD   = s4.tc ? (s4.fleteARS / s4.tc) : fob*0.15;
    const empaqueUSD = s4.tc ? (s4.empaqueARS / s4.tc) : 0.5;
    const seguroUSD  = (fob + fleteUSD) * 0.015;
    const cifUSD     = fob + fleteUSD + seguroUSD;
    const arancelesUSD = cifUSD * (s4.arancelRate != null ? s4.arancelRate : 0.20);
    const tasaUSD      = cifUSD * (s4.tasaEstadisticaPct != null ? s4.tasaEstadisticaPct : 0.03);
    const despachoUSD  = cifUSD * 0.08;
    const landedUSD = fob + fleteUSD + seguroUSD + arancelesUSD + tasaUSD + despachoUSD + empaqueUSD;
    const landedARS = landedUSD * tc;
    const baseARS   = (cifUSD + arancelesUSD + tasaUSD) * tc;
    const ivaImpARS   = baseARS * (s4.ivaImportPct != null ? s4.ivaImportPct : 0.21);
    const ivaAdicARS  = baseARS * (s4.ivaAdicionalPct != null ? s4.ivaAdicionalPct : 0.20);
    const comisionARS = venta * (s4.comisionPct != null ? s4.comisionPct : 0.15);
    const ivaDebito   = venta - (venta / 1.21);
    const ivaARS      = Math.max(0, ivaDebito - ivaImpARS);
    const iibbARS     = venta * 0.03;
    const canalML = (typeof mrData !== 'undefined' && mrData && mrData.canal === 'mercadolibre');
    const logisticaARS = canalML ? mrTarifaLogisticaARS(venta, s4.modalidad || 'flex') : 0;
    const margenARS = venta - landedARS - comisionARS - ivaARS - iibbARS - logisticaARS;
    return {
      margenARS,
      margenPct: venta > 0 ? (margenARS / venta) * 100 : 0,
      landedARS, ivaImpARS, ivaAdicARS,
      capitalUnitarioARS: landedARS + ivaImpARS + ivaAdicARS
    };
  }
  window.mrMargenCon = mrMargenCon;

  // Biseccion sobre una variable monotona. Devuelve null si el quiebre no
  // existe dentro del rango: preferimos no mostrar el numero antes que
  // mostrar uno inventado.
  function bisecar(f, lo, hi, iter){
    const fLo = f(lo), fHi = f(hi);
    if (!isFinite(fLo) || !isFinite(fHi)) return null;
    if ((fLo > 0) === (fHi > 0)) return null;   // no hay cruce por cero
    let a = lo, b = hi;
    for (let k = 0; k < (iter || 60); k++){
      const m = (a + b) / 2;
      const fm = f(m);
      if ((fm > 0) === (f(a) > 0)) a = m; else b = m;
    }
    return (a + b) / 2;
  }

  // ------------------------------------------------------------------
  // 6.b ESCENARIOS DE QUIEBRE
  // ------------------------------------------------------------------
  function escenariosDeQuiebre(md){
    const s4 = md && md.step4;
    if (!s4) return null;
    const s2 = md.step2 || {};
    const out = { dolar:null, precio:null, ventas:null };

    // --- Dolar de quiebre: a que tc el margen llega a 0 ---
    if (s4.margenARS > 0){
      const tcQ = bisecar(t => mrMargenCon(s4, {tc:t}).margenARS, s4.tc, s4.tc * 12);
      if (tcQ){
        out.dolar = {
          valor: Math.round(tcQ),
          hoy: Math.round(s4.tc),
          aguantePct: Math.round(((tcQ - s4.tc) / s4.tc) * 100)
        };
      }
    } else {
      out.dolar = { valor:null, hoy: Math.round(s4.tc), aguantePct: null,
        nota: 'Ya perdes plata al dolar de hoy: no hay margen de aguante que calcular.' };
    }

    // --- Precio de quiebre: a que precio de venta el margen llega a 0 ---
    if (s4.venta > 0){
      const pQ = bisecar(v => mrMargenCon(s4, {venta:v}).margenARS, Math.max(1, s4.venta*0.02), s4.venta * 6);
      if (pQ){
        // Referencia de competencia: solo si la muestra alcanza. Con muestra
        // insuficiente no hay precio de mercado con el cual comparar.
        const refComp = (!s2.muestraInsuficiente && s2.precioPromedioARS) ? s2.precioPromedioARS : null;
        out.precio = {
          valor: Math.round(pQ),
          tuyo: Math.round(s4.venta),
          competencia: refComp ? Math.round(refComp) : null,
          bajoCompetenciaPct: refComp ? Math.round(((refComp - pQ) / refComp) * 100) : null
        };
      }
    }

    // --- Ventas minimas para cubrir el costo de oportunidad del capital ---
    const diasCap = window.__getCostoFinDays ? window.__getCostoFinDays() : 0;
    const tasaMes = window.__getCostoFinMonthlyPct ? window.__getCostoFinMonthlyPct() : 0;
    const inversionARS = s4.inversionARS || 0;
    if (tasaMes > 0 && inversionARS > 0){
      const costoMensualARS = inversionARS * tasaMes;
      const costoCicloARS   = inversionARS * (diasCap/30) * tasaMes;
      if (s4.margenARS > 0){
        out.ventas = {
          uds: Math.ceil(costoMensualARS / s4.margenARS),
          costoMensualARS: Math.round(costoMensualARS),
          costoCicloARS: Math.round(costoCicloARS),
          diasCap, tasaMesPct: +(tasaMes*100).toFixed(1),
          inversionARS: Math.round(inversionARS),
          actuales: s4.ventas || 0
        };
      } else {
        out.ventas = { uds:null, costoMensualARS: Math.round(costoMensualARS),
          costoCicloARS: Math.round(costoCicloARS), diasCap, tasaMesPct:+(tasaMes*100).toFixed(1),
          inversionARS: Math.round(inversionARS), actuales: s4.ventas || 0,
          nota: 'Con margen negativo no hay volumen que lo arregle: vender mas unidades pierde mas plata.' };
      }
    }
    return out;
  }
  window.escenariosDeQuiebre = escenariosDeQuiebre;

  // ------------------------------------------------------------------
  // 6.a EVALUACION DE VIABILIDAD
  // Cada senal lleva el numero real que la disparo. Si el dato no esta, la
  // senal no se emite.
  // ------------------------------------------------------------------
  function evaluarViabilidad(md){
    const aFavor = [], enContra = [], criticos = [];
    const s1 = (md && md.step1) || {};
    const s2 = (md && md.step2) || {};
    const s3 = (md && md.step3) || null;
    const s4 = (md && md.step4) || null;
    if (!s4) return { aFavor, enContra, criticos };

    const nf = new Intl.NumberFormat('es-AR');
    const ars = n => 'ARS ' + nf.format(Math.round(n));
    const F = (texto, dato) => ({ texto, dato, peso:'fuerte' });
    const M = (texto, dato) => ({ texto, dato, peso:'medio' });
    const C = (texto, dato) => ({ texto, dato, peso:'critico' });

    const margenPct = s4.margenPct;
    const margenARS = s4.margenARS;

    // ---------- MARGEN ----------
    if (margenPct >= 40) aFavor.push(F('Margen neto de '+margenPct+'%, comodo para absorber desvios', margenPct+'% ('+ars(margenARS)+' por unidad)'));
    else if (margenPct >= 30) aFavor.push(M('Margen de '+margenPct+'%, trabajable pero sin colchon', margenPct+'% ('+ars(margenARS)+' por unidad)'));

    if (margenPct < 0){
      // Con margen negativo la regla del <25% es redundante: se emite la que
      // dice el numero exacto que se pierde.
      criticos.push(C('Perdes '+ars(Math.abs(margenARS))+' por unidad al precio de venta que cargaste', margenPct+'% de margen'));
    } else if (margenPct < 25){
      criticos.push(C('Margen de '+margenPct+'%: un desvio del dolar del 10% te lo come entero', margenPct+'% ('+ars(margenARS)+' por unidad)'));
    }

    // ---------- VALOR / PESO ----------
    // Sin peso cargado esta senal NO se emite: no se infiere el peso.
    const pesoEl = document.getElementById('mrPesoKg');
    const pesoKg = pesoEl ? parseFloat(pesoEl.value) : NaN;
    if (isFinite(pesoKg) && pesoKg > 0 && s4.fob > 0){
      const valorPorKg = s4.fob / pesoKg;
      const fletePctFob = s4.tc ? ((s4.fleteARS / s4.tc) / s4.fob) * 100 : null;
      // Con el modo de envio en "auto" el flete es un 15% plano sobre FOB: no
      // depende del peso, asi que hay que decir que ese porcentaje es una
      // estimacion y no el flete real de este producto.
      const modoEnvio = (document.getElementById('mrShipMode')||{}).value || 'auto';
      const fleteEstimado = modoEnvio === 'auto';
      const fletePctTxt = fletePctFob != null ? Math.round(fletePctFob)+'%' : 'n/d';
      const fleteNota = fleteEstimado
        ? ' El flete es la estimacion plana del 15% s/FOB: eleg&#237; el modo de env&#237;o para calcularlo por kilo.' : '';
      if (valorPorKg >= 40){
        aFavor.push(F('Buena relacion valor/peso: el flete pesa solo '+fletePctTxt+' del FOB.'+fleteNota,
          valorPorKg.toFixed(1)+' USD/kg (FOB USD '+s4.fob.toFixed(2)+' / '+pesoKg+' kg)'));
      } else if (valorPorKg < 15){
        criticos.push(C('El flete se come el '+fletePctTxt+' del FOB. Producto barato y pesado: no aguanta el costo logistico.'+fleteNota,
          valorPorKg.toFixed(1)+' USD/kg (FOB USD '+s4.fob.toFixed(2)+' / '+pesoKg+' kg)'));
      }
    }

    // ---------- ROTACION ----------
    const ventasMes = s4.ventas || 0;
    if (ventasMes > 0){
      if (ventasMes >= 100) aFavor.push(F('Rotacion alta: los top venden '+ventasMes+' uds/mes', ventasMes+' uds/mes'));
      else if (ventasMes < 20) enContra.push(F('Los top venden '+ventasMes+' uds/mes: el volumen no justifica inmovilizar capital', ventasMes+' uds/mes'));
    }

    // ---------- RECUPERO DEL CAPITAL ----------
    const inversionARS = s4.inversionARS || 0;
    if (inversionARS > 0 && s4.ingresoMensualARS > 0){
      const ratio = s4.ingresoMensualARS / inversionARS;
      if (ratio >= 0.15){
        const meses = Math.max(1, Math.round(inversionARS / s4.ingresoMensualARS));
        aFavor.push(F('Recuperas el capital en ~'+meses+' '+(meses===1?'mes':'meses'),
          ars(s4.ingresoMensualARS)+'/mes sobre '+ars(inversionARS)+' invertidos ('+Math.round(ratio*100)+'%/mes)'));
      }
    }

    // ---------- COMPETENCIA (solo con muestra suficiente) ----------
    if (!s2.muestraInsuficiente && s2.precioMinARS > 0 && s2.precioMaxARS > 0){
      const dispersionPct = ((s2.precioMaxARS - s2.precioMinARS) / s2.precioMinARS) * 100;
      const datoDisp = Math.round(dispersionPct)+'% ('+ars(s2.precioMinARS)+' a '+ars(s2.precioMaxARS)+', '+(s2.muestra||0)+' publicaciones)';
      if (dispersionPct > 40){
        aFavor.push(M('Precios dispersos: hay lugar para posicionarse sin pelear por precio', datoDisp));
      } else if (dispersionPct < 15){
        criticos.push(C('Todos los precios pegados dentro del '+Math.round(dispersionPct)+'%. Es guerra de precios: el unico diferencial que queda es bajar el margen', datoDisp));
      }
    }
    if (!s2.muestraInsuficiente && s2.envioGratisPct != null){
      if (s2.envioGratisPct < 50) aFavor.push(M('Menos de la mitad ofrece envio gratis: el envio todavia no es tabla rasa', s2.envioGratisPct+'% de '+(s2.envioGratisTotal||0)+' publicaciones'));
      else if (s2.envioGratisPct > 80) enContra.push(F('El '+s2.envioGratisPct+'% ofrece envio gratis: ese costo ya esta adentro del precio de todos', s2.envioGratisPct+'% de '+(s2.envioGratisTotal||0)+' publicaciones'));
    }
    if (!s2.muestraInsuficiente && Array.isArray(s2.competitors) && s2.competitors.length){
      const conVentas = s2.competitors.filter(c => (c.soldQty||0) > 0).length;
      if (conVentas > 0 && conVentas <= 5) aFavor.push(F('Pocos vendedores reales compitiendo', conVentas+' vendedores con ventas > 0'));
    }
    if (s2.saturacion === 'muy saturado' || (s2.sellersEstimados != null && s2.sellersEstimados > 30)){
      const d = s2.sellersEstimados != null ? s2.sellersEstimados+' vendedores' : 'saturacion: '+s2.saturacion;
      enContra.push(F((s2.sellersEstimados!=null?s2.sellersEstimados:'Muchos')+' vendedores activos: se decide por precio, no por producto', d));
    }

    // ---------- TIKTOK ----------
    const scDef = s4.scDef;
    if (s3 && !s3.omitido && scDef >= 70){
      aFavor.push(M('Traccion de contenido: '+nf.format(s3.views||0)+' vistas promedio y contenido en Argentina',
        scDef+'/100 &#8212; '+(s3.scoreMotivo||'')));
    }
    if (!s3 || s3.omitido){
      enContra.push(M('No mediste traccion de contenido', 'paso de TikTok salteado'));
    }

    // ---------- DEMANDA ----------
    const fuenteDemanda = s1.fuenteDemanda || 'estimacion-ia';
    if (s1.tendencia === 'subiendo' && fuenteDemanda === 'google-trends'){
      aFavor.push(F('Demanda creciente medida', 'Google Trends 12m, score '+(s1.demandaScore||'n/d')+'/100'));
    }
    if (fuenteDemanda !== 'google-trends'){
      const cd = C('No tenes dato de demanda medido. Estas decidiendo sobre una estimacion',
        'Google bloquea las consultas automaticas, asi que la curva la estimo la IA' +
        (s1.trendsMotivo ? ' (' + s1.trendsMotivo + ')' : ''));
      cd.clave = 'sin-demanda-medida';   // no se sabe, no es que este mal
      criticos.push(cd);
    }

    // ---------- MUESTRA DE COMPETENCIA ----------
    // Con sinComparable esta critica la subsume la de "sin comparable en MeLi",
    // que dice lo mismo con mas contexto: no se emiten las dos.
    if (s2.muestraInsuficiente && !(md && md.sinComparable)){
      const nM = s2.muestra || 0;
      const cm = C('Solo '+nM+' '+(nM===1?'publicacion':'publicaciones')+' de referencia. No sabes a que precio se vende de verdad',
        nM+' de un minimo de 8');
      cm.clave = 'muestra-insuficiente';  // no se sabe, no es que este mal
      criticos.push(cm);
    }

    // ---------- CAPITAL ----------
    const capitalUSD = parseFloat(md.capital) || 0;
    if (capitalUSD > 0 && inversionARS > 0 && s4.tc){
      const capitalARS = capitalUSD * s4.tc;
      const pct = (inversionARS / capitalARS) * 100;
      if (inversionARS > capitalARS * 0.5){
        criticos.push(C('Este SKU te consume el '+Math.round(pct)+'% de tu capital. Un solo producto no deberia pasar del 30-40%',
          ars(inversionARS)+' de '+ars(capitalARS)+' disponibles'));
      }
    }

    // ---------- BREAKEVEN ----------
    if (s4.breakevenDias > 120){
      enContra.push(F('Tardas '+s4.breakevenDias+' dias en recuperar la inversion, y el ciclo China&#8594;gondola ya son 60-90 dias. Estas poniendo plata a 6 meses',
        s4.breakevenDias+' dias ('+(s4.breakevenUds||0)+' uds a '+(s4.ventas||0)+' uds/mes)'));
    }

    const senales = { aFavor, enContra, criticos };
    // 8) Modo sin comparable: se agregan las senales propias (categoria madre,
    // region, antiguedad, test de busqueda, presupuesto de test).
    if (md && md.sinComparable && window.__modoSinComparable){
      return window.__modoSinComparable.senales(md, senales);
    }
    return senales;
  }
  window.evaluarViabilidad = evaluarViabilidad;

  // ------------------------------------------------------------------
  // 6.d Calidad de datos: 4 chips. Verde = medido, ambar = estimado,
  // rojo = sin dato.
  // ------------------------------------------------------------------
  function calidadDeDatos(md){
    const s1 = (md && md.step1) || {};
    const s2 = (md && md.step2) || {};
    const s3 = (md && md.step3) || null;
    const s4 = (md && md.step4) || {};
    const chips = [];
    chips.push(s1.fuenteDemanda === 'google-trends'
      ? { t:'Demanda', c:'verde', d:'Google Trends, 12 meses medidos' }
      : { t:'Demanda', c:'ambar', d:'Estimacion de IA, no es un dato medido' });
    // Un cero confirmado ES un dato medido. "Sin datos" se reserva para cuando
    // MercadoLibre no dejo consultar: son cosas distintas.
    if (s2.fuente === 'requiere-sesion') chips.push({ t:'Competencia', c:'rojo', d:'Sin medir: hace falta iniciar sesion' });
    else if (s2.fuente === 'tope-diario') chips.push({ t:'Competencia', c:'rojo', d:'Sin medir: tope diario de busquedas pagas' });
    else if (s2.consultaFallida || s2.fuente === 'no-disponible') chips.push({ t:'Competencia', c:'rojo', d:'No pude consultar MercadoLibre' });
    else if (s2.sinComparable && s2.muestra === 0) chips.push({ t:'Competencia', c:'verde', d:'Medido: 0 publicaciones en MeLi Argentina' });
    else if (s2.sinComparable) chips.push({ t:'Competencia', c:'ambar', d:'Sin comparable: solo '+(s2.muestra||0)+' publicaci'+((s2.muestra===1)?'on':'ones')+' en MeLi' });
    else if (s2.muestraInsuficiente) chips.push({ t:'Competencia', c:'ambar', d:'Muestra de '+(s2.muestra||0)+' de un minimo de 8' });
    else chips.push({ t:'Competencia', c:'verde', d:(s2.muestra||0)+' publicaciones reales de MeLi' });
    if (!s3 || s3.omitido) chips.push({ t:'TikTok', c:'rojo', d:'Paso salteado, sin medir' });
    else if (!s3.views) chips.push({ t:'TikTok', c:'ambar', d:'Sin numero de vistas cargado' });
    else chips.push({ t:'TikTok', c:'verde', d:new Intl.NumberFormat('es-AR').format(s3.views)+' vistas cargadas' });
    const dol = window.__mrDolar || null;
    if (dol && dol.ok && !dol.manual) chips.push({ t:'Tipo de cambio', c:'verde', d:(dol.tipoLabel||'')+' de dolarapi.com' });
    else if (dol && dol.manual) chips.push({ t:'Tipo de cambio', c:'ambar', d:'Cargado a mano: $'+new Intl.NumberFormat('es-AR').format(Math.round(s4.tc||0)) });
    else chips.push({ t:'Tipo de cambio', c:'rojo', d:'No pude traer la cotizacion' });
    // 8.h) Dos chips propios del modo sin comparable.
    if (md && md.sinComparable){
      const ex = md.exploracion;
      const e = (ex && ex.existeEn) || {};
      // Tres estados distintos, y no se pueden confundir:
      //   ausente  -> la consulta todavia no volvio
      //   null     -> volvio y no se pudo consultar
      //   true/false -> dato real
      const pendientes = ['MLB','MLM'].filter(k => !Object.prototype.hasOwnProperty.call(e, k)).length;
      const sinDato = ['MLB','MLM'].filter(k => e[k] === null).length;
      if (!ex) chips.push({ t:'Brasil/México', c:'ambar', d:'Consultando...' });
      else if (pendientes) chips.push({ t:'Brasil/México', c:'ambar', d:'Consultando ' + (pendientes === 2 ? 'los dos países' : 'el país que falta') + '...' });
      else if (sinDato === 2) chips.push({ t:'Brasil/México', c:'rojo', d:'Ninguno de los dos se pudo consultar' });
      else if (sinDato === 1) chips.push({ t:'Brasil/México', c:'ambar', d:'Solo uno de los dos respondió' });
      else {
        const rel = ex.relevancia || {};
        const NOM = { MLB:'BR', MLM:'MX' };
        const desc = k => {
          const n = ex.conteos[k];
          const r = rel[k];
          if (n === 0 && r && r.devueltas > 0) return NOM[k] + ' 0 de ' + r.devueltas + ' (rescate)';
          return NOM[k] + ' ' + n;
        };
        chips.push({ t:'Brasil/México', c:'verde', d:'Medido: ' + desc('MLB') + ' · ' + desc('MLM') });
      }
      const a = md.antiguedad || { valor:'sin-dato' };
      if (a.valor === 'sin-dato') chips.push({ t:'Antigüedad demanda', c:'rojo', d:'Sin medir: completá el paso 5' });
      else if (a.valor === 'mixta') chips.push({ t:'Antigüedad demanda', c:'ambar', d:'Señales mezcladas' });
      else chips.push({ t:'Antigüedad demanda', c:'verde', d:'Medido: demanda ' + a.valor + (a.reviews ? ' · ' + new Intl.NumberFormat('es-AR').format(a.reviews) + ' reviews' : '') });
    }
    return chips;
  }
  window.calidadDeDatos = calidadDeDatos;

  // ------------------------------------------------------------------
  // 6.c VEREDICTO. La regla la decide este codigo, no la IA.
  // ------------------------------------------------------------------
  function veredictoDe(md, senales){
    // 8.g) Sin comparable el flujo CONVIENE / NO CONVIENE no corre: se
    // reemplaza por los cuatro estados, que evaluan si vale la pena pagar por
    // averiguarlo en vez de proyectar una venta que no se puede proyectar.
    if (md && md.sinComparable && window.__modoSinComparable){
      const v = window.__modoSinComparable.veredicto(md, senales);
      const cert  = document.getElementById('mrvChkCert');
      const marca = document.getElementById('mrvChkMarca');
      const riesgosSinTildar = [];
      if (!cert  || !cert.checked)  riesgosSinTildar.push('verificar si necesita certificacion (seguridad electrica, ENACOM, ANMAT, juguetes)');
      if (!marca || !marca.checked) riesgosSinTildar.push('verificar que no sea marca registrada ni replica');
      // El verde tampoco sale con los riesgos sin tildar en este modo.
      if (v.clave === 'si' && riesgosSinTildar.length){
        v.clave = 'cond';
        // El titulo tiene que decir que esta frenado: si no, queda el nombre
        // del estado verde pintado de ambar y no se entiende por que.
        v.titulo = v.titulo + ' — FALTA VERIFICAR';
        v.sub = v.sub + ' Antes de pagar el FOB quedan riesgos sin verificar:';
        v.condiciones = (v.condiciones || []).concat(riesgosSinTildar);
      }
      v.riesgosSinTildar = riesgosSinTildar;
      v.fuertesContra = senales.enContra.filter(x => x.peso === 'fuerte').length;
      v.aFavorTotal = senales.aFavor.length;
      return v;
    }
    const s1 = (md && md.step1) || {};
    const s2 = (md && md.step2) || {};
    const sinDemanda = (s1.fuenteDemanda || 'estimacion-ia') !== 'google-trends';
    const sinMuestra = !!s2.muestraInsuficiente;

    // Los dos criticos que son "no se sabe" y no "esta mal". Si los unicos
    // criticos son esos dos, no se puede emitir veredicto: falta el dato.
    const CLAVES_DE_DATO = ['sin-demanda-medida','muestra-insuficiente'];
    const criticosDeDato = senales.criticos.filter(c => CLAVES_DE_DATO.indexOf(c.clave) !== -1).length;
    const criticosReales = senales.criticos.length - criticosDeDato;

    const fuertesContra = senales.enContra.filter(x => x.peso === 'fuerte').length;
    const aFavorTotal   = senales.aFavor.length;

    // 6.f Los dos riesgos que se tildan a mano bloquean el verde.
    const cert  = document.getElementById('mrvChkCert');
    const marca = document.getElementById('mrvChkMarca');
    const riesgosSinTildar = [];
    if (!cert  || !cert.checked)  riesgosSinTildar.push('verificar si necesita certificacion (seguridad electrica, ENACOM, ANMAT, juguetes)');
    if (!marca || !marca.checked) riesgosSinTildar.push('verificar que no sea marca registrada ni replica');

    let clave, titulo, sub, condiciones = [];

    if (sinDemanda && sinMuestra && criticosReales === 0){
      clave = 'gris'; titulo = 'DATOS INSUFICIENTES';
      sub = 'No emito veredicto: no tengo ni demanda medida ni muestra de competencia. Lo que falta y como conseguirlo esta abajo.';
      condiciones = [
        'Demanda: Google Trends no responde desde el servidor. Consultala vos en trends.google.com filtrando Argentina, ultimos 12 meses, y compara contra un producto que ya vendas.',
        'Competencia: entra al listado de MercadoLibre del producto y anota precio y vendidos de las primeras 10 publicaciones. Con menos de 8 no hay precio de referencia.'
      ];
    } else if (senales.criticos.length >= 1){
      clave = 'no'; titulo = 'NO CONVIENE';
      sub = senales.criticos.length + (senales.criticos.length === 1 ? ' senal critica en contra.' : ' senales criticas en contra.') + ' Cualquiera de ellas alcanza para no poner la plata.';
    } else if (fuertesContra >= 2 && fuertesContra > aFavorTotal){
      clave = 'cond'; titulo = 'CONVIENE SOLO SI...';
      sub = fuertesContra + ' senales fuertes en contra contra ' + aFavorTotal + ' a favor. Para darlo vuelta tendria que pasar esto:';
      condiciones = condicionesParaDarloVuelta(md, senales);
    } else if (riesgosSinTildar.length){
      clave = 'cond'; titulo = 'CONVIENE SOLO SI...';
      sub = 'Los numeros dan, pero quedan riesgos regulatorios sin verificar. Antes de pagar el FOB:';
      condiciones = riesgosSinTildar;
    } else {
      clave = 'si'; titulo = 'CONVIENE';
      sub = aFavorTotal + ' senales a favor' + (senales.enContra.length ? ', con ' + senales.enContra.length + ' en contra que igual tenes que mirar.' : '.');
    }

    // El verde nunca sale con riesgos sin tildar (6.f).
    if (clave === 'si' && riesgosSinTildar.length){
      clave = 'cond'; titulo = 'CONVIENE SOLO SI...';
      sub = 'Los numeros dan, pero quedan riesgos regulatorios sin verificar. Antes de pagar el FOB:';
      condiciones = riesgosSinTildar;
    }
    return { clave, titulo, sub, condiciones, riesgosSinTildar, fuertesContra, aFavorTotal };
  }
  window.veredictoDe = veredictoDe;

  // Que tendria que cambiar, en numeros, para dar vuelta un "conviene solo si".
  function condicionesParaDarloVuelta(md, senales){
    const out = [];
    const s4 = md.step4 || {};
    senales.enContra.filter(x => x.peso === 'fuerte').forEach(function(x){
      if (/uds\/mes: el volumen/.test(x.texto)) out.push('Que la rotacion real llegue a 20+ uds/mes (hoy ' + (s4.ventas||0) + '). Verificalo mirando "vendidos" de los top listings dos semanas seguidas.');
      else if (/envio gratis/.test(x.texto)) out.push('Que puedas absorber el envio gratis sin bajar del margen actual, o vender por un canal donde el envio lo pague el comprador.');
      else if (/vendedores activos/.test(x.texto)) out.push('Que tengas un diferencial que no sea precio (kit, garantia, variante que no esta): con esta cantidad de vendedores se compite por precio.');
      else if (/dias en recuperar/.test(x.texto)) out.push('Que bajes el ciclo de recupero abajo de 120 dias: menos unidades por compra, o mas rotacion.');
      else if (/traccion de contenido/.test(x.texto)) out.push('Que midas TikTok: busca el producto, ordena por mas vistos y anota el promedio de vistas de los 3 primeros.');
      else out.push('Que se revierta: ' + x.texto);
    });
    return out;
  }

  // ------------------------------------------------------------------
  // 6.d RENDER
  // ------------------------------------------------------------------
  function itemHTML(x, esCritico){
    const cls = esCritico ? 'mrv-item mrv-item-critico'
              : (x.peso === 'fuerte' ? 'mrv-item mrv-item-fuerte' : 'mrv-item mrv-item-medio');
    const tag = esCritico ? '<span class="mrv-crit-tag">CR&#205;TICO</span>' : '';
    return '<div class="'+cls+'">'+tag+x.texto+
           '<span class="mrv-dato"><b>'+x.dato+'</b></span></div>';
  }

  function renderDecision(md){
    md = md || (typeof mrData !== 'undefined' ? mrData : null);
    const box = document.getElementById('mrvDecision');
    if (!box || !md || !md.step4) return null;

    const senales = evaluarViabilidad(md);
    const quiebre = escenariosDeQuiebre(md);
    const chips   = calidadDeDatos(md);
    const ver     = veredictoDe(md, senales);
    md.decision = { senales, quiebre, chips, veredicto: ver };

    box.style.display = 'block';
    // El veredicto viejo (dos oraciones de la IA arriba del gauge) queda
    // reemplazado por este bloque.
    const viejo = document.getElementById('mrVeredictoBox');
    if (viejo) viejo.style.display = 'none';

    const vBox = document.getElementById('mrvVeredicto');
    vBox.className = 'mrv-veredicto mrv-v-' + ver.clave;
    document.getElementById('mrvVeredictoTitle').textContent = ver.titulo;
    let subHTML = ver.sub;
    if (ver.condiciones && ver.condiciones.length){
      subHTML += '<ul style="text-align:left;margin:10px auto 0;max-width:640px;padding-left:18px">' +
        ver.condiciones.map(c => '<li style="margin-bottom:6px">'+c+'</li>').join('') + '</ul>';
    }
    document.getElementById('mrvVeredictoSub').innerHTML = subHTML;

    // Las criticas van primero y con borde rojo.
    const contraHTML = senales.criticos.map(x => itemHTML(x, true)).join('') +
                       senales.enContra.map(x => itemHTML(x, false)).join('');
    document.getElementById('mrvEnContra').innerHTML = contraHTML ||
      '<div class="mrv-vacio">Ninguna senal en contra con los datos que hay.</div>';
    document.getElementById('mrvAFavor').innerHTML =
      senales.aFavor.map(x => itemHTML(x, false)).join('') ||
      '<div class="mrv-vacio">Ninguna senal a favor con los datos que hay.</div>';

    // 8) Bloques propios del modo sin comparable (paises, categoria madre,
    // presupuesto de test) y ocultado del gauge.
    if (typeof window.__pintarSinComparable === 'function') window.__pintarSinComparable(md);

    // --- Escenarios de quiebre ---
    const nf = new Intl.NumberFormat('es-AR');
    const grid = document.getElementById('mrvQuiebreGrid');
    const cajas = [];
    if (quiebre && quiebre.dolar){
      const d = quiebre.dolar;
      cajas.push(d.valor
        ? '<div class="mrv-qbox"><div class="mrv-qlabel">D&#243;lar de quiebre</div><div class="mrv-qval">$'+nf.format(d.valor)+'</div>'+
          '<div class="mrv-qtext">Dej&#225;s de ganar plata si el d&#243;lar llega a <b>$'+nf.format(d.valor)+'</b> (hoy $'+nf.format(d.hoy)+', son <b>'+d.aguantePct+'%</b> de margen de aguante).</div></div>'
        : '<div class="mrv-qbox"><div class="mrv-qlabel">D&#243;lar de quiebre</div><div class="mrv-qval mrv-q-bad">&#8212;</div><div class="mrv-qtext">'+(d.nota||'')+'</div></div>');
    }
    if (quiebre && quiebre.precio){
      const p = quiebre.precio;
      const comp = p.competencia
        ? ' Hoy la competencia est&#225; en <b>ARS '+nf.format(p.competencia)+'</b>'+(p.bajoCompetenciaPct!=null?' ('+p.bajoCompetenciaPct+'% por encima de tu piso)':'')+'.'
        : ' No tengo precio de competencia confiable con el que comparar (muestra insuficiente).';
      cajas.push('<div class="mrv-qbox"><div class="mrv-qlabel">Precio de quiebre</div><div class="mrv-qval">ARS '+nf.format(p.valor)+'</div>'+
        '<div class="mrv-qtext">Si la competencia baja a <b>ARS '+nf.format(p.valor)+'</b> ya no te da. Vos cargaste ARS '+nf.format(p.tuyo)+'.'+comp+'</div></div>');
    }
    if (quiebre && quiebre.ventas){
      const v = quiebre.ventas;
      cajas.push(v.uds
        ? '<div class="mrv-qbox"><div class="mrv-qlabel">Ventas m&#237;nimas</div><div class="mrv-qval">'+nf.format(v.uds)+' uds/mes</div>'+
          '<div class="mrv-qtext">Necesit&#225;s vender al menos <b>'+nf.format(v.uds)+' uds/mes</b> para que valga la pena vs dejar la plata quieta. El capital inmovilizado ('+ 'ARS '+nf.format(v.inversionARS)+', '+v.diasCap+' d&#237;as al '+v.tasaMesPct+'%/mes) cuesta ARS '+nf.format(v.costoMensualARS)+' por mes.'+
          (v.actuales?' Hoy estim&#225;s '+nf.format(v.actuales)+' uds/mes.':'')+'</div></div>'
        : '<div class="mrv-qbox"><div class="mrv-qlabel">Ventas m&#237;nimas</div><div class="mrv-qval mrv-q-bad">&#8212;</div><div class="mrv-qtext">'+(v.nota||'')+'</div></div>');
    }
    grid.innerHTML = cajas.join('') || '<div class="mrv-vacio">Faltan datos para calcular los escenarios de quiebre.</div>';

    // --- Nota de los riesgos tildables ---
    const nota = document.getElementById('mrvRiesgosNota');
    if (nota){
      // En el modo sin comparable los estados son otros: el tope no se llama
      // "CONVIENE SOLO SI" sino "TEST DE VALIDACION".
      const tope = (md.sinComparable) ? '"TEST DE VALIDACI&#211;N"' : '"CONVIENE SOLO SI"';
      nota.innerHTML = ver.riesgosSinTildar.length
        ? '<b>'+ver.riesgosSinTildar.length+'</b> sin verificar: mientras queden sin tildar, el veredicto no puede pasar de '+tope+'.'
        : '<span style="color:#27ae60">Los dos verificados.</span>';
    }

    // --- Chips de calidad de datos ---
    document.getElementById('mrvChips').innerHTML = chips.map(c =>
      '<div class="mrv-chip mrv-chip-'+c.c+'"><span class="mrv-chip-t">'+c.t+'</span><span class="mrv-chip-d">'+c.d+'</span></div>'
    ).join('');

    return md.decision;
  }
  window.renderMRDecision = renderDecision;

  // Tildar un riesgo recalcula el veredicto en el acto.
  document.addEventListener('change', function(ev){
    const t = ev.target;
    if (!t || (t.id !== 'mrvChkCert' && t.id !== 'mrvChkMarca')) return;
    if (typeof mrData !== 'undefined' && mrData && mrData.step4) renderDecision(mrData);
  }, true);

  // El veredicto viejo de v9 (una recomendacion basada solo en el margen)
  // contradecia al bloque nuevo. Se neutraliza: la decision es una sola.
  window.__v9render = function(){ try{ const e=document.querySelector('.v9-reco'); if(e) e.remove(); }catch(_){} };
})();

/* ---- bloque 22 ---- */
/* ===== Tipo de cambio real =====
   El input arrancaba con value="1250" hardcodeado en el HTML. Con el oficial
   arriba de 1500 eso subvaluaba el costo en ARS y devolvia un margen inflado.
   Ahora la cotizacion se pide a /api/market?dolar=1 (el server consulta
   dolarapi, asi no hay CORS) y se completa con el tipo elegido, MEP por
   defecto. Si el usuario lo pisa a mano, no se vuelve a tocar.
   ===================================================================== */
(function(){
  var TIPO_LABEL = { mayorista:'Mayorista', oficial:'Oficial', mep:'MEP', ccl:'CCL', tarjeta:'Tarjeta' };
  var estado = { cotizaciones:null, manual:false, tipo:'mep', ok:false };
  window.__mrDolar = { ok:false, manual:false, tipoLabel:'' };

  function nf(n){ return new Intl.NumberFormat('es-AR').format(n); }

  function fechaCorta(iso){
    if (!iso) return null;
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      var dd = String(d.getDate()).padStart(2,'0');
      var mm = String(d.getMonth()+1).padStart(2,'0');
      var hh = String(d.getHours()).padStart(2,'0');
      var mi = String(d.getMinutes()).padStart(2,'0');
      return dd+'/'+mm+' '+hh+':'+mi;
    } catch(e){ return null; }
  }

  function pintarHint(){
    var hint = document.getElementById('mrDolarHint');
    if (!hint) return;
    var c = estado.cotizaciones;
    if (estado.manual){
      var inp = document.getElementById('mrTipoCambio');
      var v = inp ? parseFloat(inp.value) : NaN;
      hint.innerHTML = '<b style="color:#e0a020">Valor cargado a mano</b>' + (isFinite(v) ? ': $'+nf(Math.round(v)) : '') +
        ' &#183; no lo vuelvo a sobrescribir';
      window.__mrDolar = { ok:true, manual:true, tipoLabel:'manual' };
      return;
    }
    if (!c || !c.ok){
      hint.innerHTML = '<b style="color:#e05a4a">No pude traer la cotizaci&#243;n</b>' +
        (c && c.error ? ' ('+c.error+')' : '') + ' &#183; carg&#225; el tipo de cambio a mano';
      window.__mrDolar = { ok:false, manual:false, tipoLabel:'' };
      return;
    }
    var val = c[estado.tipo];
    var f = fechaCorta(c.fecha);
    hint.innerHTML = (val != null)
      ? '<b>'+TIPO_LABEL[estado.tipo]+' $'+nf(val)+'</b> &#183; actualizado '+(f||'sin fecha')+' &#183; editable'
        + (c.vencido ? ' &#183; <span style="color:#e0a020">cotizaci&#243;n vieja, dolarapi no responde</span>' : '')
      : '<b style="color:#e0a020">Sin cotizaci&#243;n para '+TIPO_LABEL[estado.tipo]+'</b> &#183; eleg&#237; otro tipo o cargalo a mano';
    window.__mrDolar = { ok: val != null, manual:false, tipoLabel: TIPO_LABEL[estado.tipo] };
  }

  function aplicar(){
    if (estado.manual) { pintarHint(); return; }
    var inp = document.getElementById('mrTipoCambio');
    var c = estado.cotizaciones;
    if (inp && c && c.ok && c[estado.tipo] != null){
      inp.dataset.auto = '1';               // marca: lo escribio el sistema
      inp.value = String(c[estado.tipo]);
      if (typeof mrData !== 'undefined' && mrData) mrData.tc = c[estado.tipo];
      delete inp.dataset.auto;
    }
    pintarHint();
  }

  async function cargar(){
    var hint = document.getElementById('mrDolarHint');
    if (hint && !estado.manual) hint.textContent = 'Consultando cotización...';
    try {
      var res = await fetch('/api/market?dolar=1');
      var c = await res.json();
      estado.cotizaciones = c;
      estado.ok = !!(c && c.ok);
      if (c && c.porDefecto && TIPO_LABEL[c.porDefecto]) {
        var sel = document.getElementById('mrDolarTipo');
        if (sel && !sel.dataset.tocado) { sel.value = c.porDefecto; estado.tipo = c.porDefecto; }
      }
    } catch(e){
      estado.cotizaciones = { ok:false, error:'no pude consultar /api/market?dolar=1' };
      estado.ok = false;
    }
    aplicar();
  }
  window.__mrCargarDolar = cargar;

  function init(){
    var sel = document.getElementById('mrDolarTipo');
    var inp = document.getElementById('mrTipoCambio');
    if (!sel || !inp || sel.__dolarBound) return;
    sel.__dolarBound = true;
    estado.tipo = sel.value || 'mep';

    sel.addEventListener('change', function(){
      sel.dataset.tocado = '1';
      estado.tipo = sel.value;
      // Elegir un tipo distinto es pedir ese valor: vuelve a tomar el
      // automatico aunque antes lo hubiera pisado a mano.
      estado.manual = false;
      aplicar();
    });

    // Si el usuario escribe el valor, manda el suyo y no se sobrescribe mas.
    inp.addEventListener('input', function(){
      if (inp.dataset.auto) return;
      estado.manual = true;
      pintarHint();
    });

    cargar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  setTimeout(init, 500);
})();

/* ---- bloque 23 ---- */
/* ===== MODO "PRODUCTO SIN COMPARABLE EN MERCADO LIBRE ARGENTINA" =====

   El bug de fondo que esto arregla: si un producto no estaba en MeLi, el paso
   2 devolvia pocos resultados, la saturacion salia baja, el competenciaScore
   salia ALTO y sumaba al veredicto. El sistema premiaba la ausencia de
   competencia. En importacion es al reves: la falta de competencia casi nunca
   significa "nadie lo descubrio", significa "alguien ya lo probo y no
   funciono" o "no se puede traer".

   Con sinComparable el score se anula (no se sube), el gauge se oculta y el
   veredicto de CONVIENE / NO CONVIENE se reemplaza por cuatro estados que
   evaluan otra cosa: si vale la pena pagar por averiguarlo.
   ===================================================================== */
(function(){

  var LINEA_FIJA = 'Este producto no tiene comparable en MercadoLibre Argentina. ' +
    'Nada de lo que sigue es una proyección de ventas: es una evaluación de si vale la pena pagar por averiguarlo.';

  function nf(n){ return new Intl.NumberFormat('es-AR').format(n); }
  function ars(n){ return 'ARS ' + nf(Math.round(n)); }

  // ---------------------------------------------------------------
  // 8.d) Antiguedad de la demanda. Es la distincion que decide todo y no se
  // puede scrapear: sale de lo que contesta el usuario.
  // ---------------------------------------------------------------
  function derivarAntiguedad(s5){
    if (!s5) return { valor:'sin-dato', motivo:'El paso de antiguedad no se completo.' };
    var edad = s5.tiktokEdad || '';
    var mes = s5.aliMes, anio = s5.aliAnio;
    var reviews = s5.aliReviews;

    // Que tan fresca es la ultima review, en meses.
    var mesesDesdeReview = null;
    if (mes && anio){
      var hoy = new Date();
      mesesDesdeReview = (hoy.getFullYear() - anio) * 12 + (hoy.getMonth() + 1 - mes);
      if (mesesDesdeReview < 0) mesesDesdeReview = 0;
    }
    var activaUltimoTrimestre = mesesDesdeReview != null && mesesDesdeReview <= 3;
    var reviewsViejas = mesesDesdeReview != null && mesesDesdeReview > 12;

    if (!edad && mesesDesdeReview == null) return { valor:'sin-dato', mesesDesdeReview:null, reviews:reviews,
      motivo:'No cargaste ni la antiguedad de los videos ni la fecha de las reviews.' };

    if (edad === 'recientes' && activaUltimoTrimestre){
      return { valor:'nueva', mesesDesdeReview:mesesDesdeReview, reviews:reviews,
        motivo:'Videos de los ultimos 6 meses y reviews del ultimo trimestre' +
               (reviews ? ' (' + nf(reviews) + ' reviews)' : '') + '.' };
    }
    if (edad === 'viejos' && reviewsViejas){
      return { valor:'vieja', mesesDesdeReview:mesesDesdeReview, reviews:reviews,
        motivo:'Videos de 2 anos o mas y ultima review hace ' + mesesDesdeReview + ' meses.' };
    }
    if (edad === 'sin-videos' && reviewsViejas){
      return { valor:'vieja', mesesDesdeReview:mesesDesdeReview, reviews:reviews,
        motivo:'Sin videos en TikTok y ultima review hace ' + mesesDesdeReview + ' meses.' };
    }
    if (edad === 'mezclados' || edad === 'recientes' || edad === 'viejos' || edad === 'sin-videos'){
      return { valor:'mixta', mesesDesdeReview:mesesDesdeReview, reviews:reviews,
        motivo:'Senales mezcladas: videos "' + edad + '"' +
               (mesesDesdeReview != null ? ', ultima review hace ' + mesesDesdeReview + ' meses' : ', sin fecha de reviews') + '.' };
    }
    return { valor:'sin-dato', mesesDesdeReview:mesesDesdeReview, reviews:reviews,
      motivo:'Falta la antiguedad de los videos de TikTok.' };
  }
  window.derivarAntiguedad = derivarAntiguedad;

  // ---------------------------------------------------------------
  // 8.f) Presupuesto de test. Sin comparable no hay precio de venta de
  // referencia, asi que el margen proyectado es ficcion: se reemplaza por
  // cuanto cuesta averiguarlo.
  // ---------------------------------------------------------------
  function presupuestoDeTest(md){
    var s4 = md && md.step4;
    var s5 = (md && md.step5) || {};
    if (!s4) return null;

    var moqEl = document.getElementById('mrMOQ');
    var moq = moqEl ? parseInt(moqEl.value, 10) : NaN;
    if (!isFinite(moq) || moq <= 0) moq = window.mrMOQ || 0;
    var faltaMOQ = !moq;

    var unidadesTest = Math.max(moq || 0, 50);
    // Mismo costo corregido del fix 2: landed + IVA de importacion +
    // percepcion. Los tres salen de la caja para traer el test.
    var costoUnitARS = s4.capitalUnitarioARS || 0;
    var costoTestARS = unidadesTest * costoUnitARS;

    var capitalUSD = parseFloat(md.capital) || 0;
    var capitalARS = capitalUSD * (s4.tc || 0);
    var pctCapital = capitalARS > 0 ? (costoTestARS / capitalARS) * 100 : null;
    var excede = capitalARS > 0 && costoTestARS > capitalARS * 0.15;

    // A cuanto CREE que lo vende: se calcula al reves, no como margen.
    var precioCreo = s5.precioCreo || 0;
    var udsParaRecuperar = null, margenUnitARS = null;
    if (precioCreo > 0 && typeof window.mrMargenCon === 'function'){
      var m = window.mrMargenCon(s4, { venta: precioCreo });
      margenUnitARS = m.margenARS;
      if (margenUnitARS > 0) udsParaRecuperar = Math.ceil(costoTestARS / margenUnitARS);
    }

    var modoEnvio = (document.getElementById('mrShipMode') || {}).value || 'auto';
    var esMaritimo = modoEnvio === 'lcl' || modoEnvio === 'fcl';

    return {
      moq: moq, faltaMOQ: faltaMOQ, unidadesTest: unidadesTest,
      costoUnitARS: costoUnitARS, costoTestARS: costoTestARS,
      capitalARS: capitalARS, pctCapital: pctCapital, excede: excede,
      precioCreo: precioCreo, margenUnitARS: margenUnitARS,
      udsParaRecuperar: udsParaRecuperar,
      modoEnvio: modoEnvio, esMaritimo: esMaritimo
    };
  }
  window.presupuestoDeTest = presupuestoDeTest;

  // ---------------------------------------------------------------
  // Señales propias del modo. Se suman a las del fix 6.
  // Regla que no se rompe: si un dato no se pudo consultar, la señal NO se
  // emite. "No pude preguntar" nunca se convierte en "no existe".
  // ---------------------------------------------------------------
  function senalesSinComparable(md, senales){
    var expl = (md && md.exploracion) || null;
    var s5 = (md && md.step5) || null;
    var test = (md && md.testBusqueda) || null;
    var ant = (md && md.antiguedad) || { valor:'sin-dato' };
    var s2 = (md && md.step2) || {};

    var F = function(t,d){ return { texto:t, dato:d, peso:'fuerte' }; };
    var M = function(t,d){ return { texto:t, dato:d, peso:'medio' }; };
    var C = function(t,d,clave){ var o = { texto:t, dato:d, peso:'critico' }; if(clave) o.clave=clave; return o; };

    // --- La critica de base: no hay comparable ---
    let datoBase;
    if (s2.muestraDevuelta != null && s2.muestraDevuelta > 0 && s2.relevantes === 0){
      // El caso que de verdad se da: MeLi devolvio publicaciones de rescate.
      datoBase = 'MeLi devolvio ' + s2.muestraDevuelta + ' publicaciones y NINGUNA es de este producto';
    } else if (s2.muestraDevuelta != null && s2.ratioRelevancia != null){
      datoBase = s2.relevantes + ' de ' + s2.muestraDevuelta + ' publicaciones coinciden (' + Math.round(s2.ratioRelevancia * 100) + '%)';
    } else {
      datoBase = (s2.muestra || 0) + ((s2.muestra === 1) ? ' publicacion encontrada' : ' publicaciones encontradas') + ' en MercadoLibre Argentina';
    }
    senales.criticos.push(C(
      'Sin comparable en MeLi Argentina. No hay evidencia de que este producto se venda aca.',
      datoBase,
      'sin-comparable'));

    // --- 8.b) Categoria madre ---
    if (expl){
      if (expl.categoriaMadre){
        var cm = expl.categoriaMadre;
        senales.aFavor.push(M(
          'La categoria madre existe y rota: hay demanda para el tipo de producto, aunque no para este modelo.',
          '"' + cm.termino + '": ' + (cm.publicaciones != null ? nf(cm.publicaciones) + ' publicaciones' : cm.muestra + ' en la muestra') +
          (cm.precioMediano ? ', mediana ' + ars(cm.precioMediano) : '')));
      } else if (Array.isArray(expl.terminosProgresivos) && expl.terminosProgresivos.length){
        // Solo se afirma que no existe cuando TODOS los escalones se
        // consultaron bien y TODOS dieron cero. Con "alguno consultado"
        // alcanzaba para que un escalon bloqueado disparara un SIN MERCADO
        // falso.
        if (expl.categoriaMadreAusenteConfirmada){
          senales.criticos.push(C(
            'Ni siquiera la categoria generica existe en MeLi.',
            'probados sin resultado: ' + expl.terminosProgresivos.join(' / '),
            'sin-categoria-madre'));
        }
      }
    }

    // --- 8.c) Brasil y Mexico ---
    if (expl && expl.existeEn){
      var e = expl.existeEn, c = expl.conteos || {};
      var brN = c.MLB, mxN = c.MLM, arN = c.MLA;
      // La señal mas informativa de todo el punto 8.
      // "No llego aca" no es solamente cero: estamos en modo sin comparable,
      // o sea que Argentina tiene 2 publicaciones o menos. Una publicacion
      // suelta no es "ya esta aca".
      const noLlegoAca = e.MLA === false || (arN != null && arN <= 2);
      // El umbral de 15 se compara contra las publicaciones RELEVANTES
      // estimadas (ratio x total de MeLi), no contra el conteo bruto ni contra
      // las relevantes de la muestra: la muestra esta topeada en 30-40 ids, asi
      // que ese numero satura y un mercado grande se veria igual que uno chico.
      var relBR = (expl.relevancia && expl.relevancia.MLB) || null;
      var brEstimadas = relBR && relBR.estimadas != null ? relBR.estimadas : brN;
      if (e.MLB === true && brEstimadas != null && brEstimadas >= 15 && noLlegoAca){
        senales.aFavor.push(F(
          'Se vende en Brasil y todavia no llego aca. Es la senal mas fuerte de ventana real que puedo darte.',
          'Brasil ~' + nf(brEstimadas) + ' publicaciones del producto (' + (relBR ? relBR.relevantes + ' de ' + relBR.devueltas + ' de la muestra coinciden' : 'estimado') +
          ') vs Argentina ' + (arN != null ? nf(arN) : 'sin dato')));
      }
      if (e.MLA === false && e.MLB === false && e.MLM === false){
        senales.criticos.push(C(
          'No se vende en ningun MercadoLibre de la region.',
          'Argentina 0 / Brasil 0 / Mexico 0',
          'sin-region'));
      }
      // Si alguno no se pudo consultar, se dice, pero no se concluye.
      var sinDato = Object.keys(e).filter(function(k){ return e[k] === null; });
      if (sinDato.length){
        senales.enContra.push(M(
          'No pude consultar ' + sinDato.map(function(k){ return (expl.paises[k] || {}).pais || k; }).join(' y ') +
          ': ese dato falta, no es un cero.',
          sinDato.map(function(k){ return k + ': ' + ((expl.paises[k] || {}).motivo || 'sin motivo'); }).join(' | ')));
      }
    }

    // --- Relevancia dudosa en algun sitio ---
    if (expl && expl.estados){
      var dudosos = Object.keys(expl.estados).filter(function(k){ return expl.estados[k] === 'dudoso'; });
      if (dudosos.length){
        senales.enContra.push(M(
          'En ' + dudosos.map(function(k){ return (expl.paises[k] || {}).pais || k; }).join(' y ') +
          ' MeLi devolvio resultados parcialmente relacionados: no se puede confirmar si tu producto exacto se vende ahi.',
          dudosos.map(function(k){ var r = (expl.relevancia || {})[k]; return k + ' relevancia ' + (r && r.ratio != null ? r.ratio.toFixed(2) : '?'); }).join(' | ')));
      }
    }

    // --- 8.d) Antiguedad de la demanda ---
    if (ant.valor === 'nueva'){
      senales.aFavor.push(F('Demanda nueva: el producto esta apareciendo ahora, no es un descarte viejo.', ant.motivo));
    } else if (ant.valor === 'vieja'){
      senales.enContra.push(F('Demanda vieja: el producto ya tiene recorrido afuera y aca no esta.', ant.motivo));
    } else if (ant.valor === 'sin-dato'){
      senales.enContra.push(M('No mediste la antiguedad de la demanda: sin eso no se distingue una ventana de un fracaso ajeno.', ant.motivo));
    }

    // --- 8.e) Test de busqueda ---
    if (test && test.suficiente === true){
      senales.aFavor.push(F(
        'Hay categoria y la gente sabe como nombrarla: tu producto se puede encontrar.',
        '"' + test.termino + '" devuelve ' + (test.encontradas != null ? nf(test.encontradas) : test.muestra) + ' publicaciones'));
    } else if (test && test.suficiente === false && test.encontradas === 0){
      senales.criticos.push(C(
        'Nadie busca eso en MeLi. Aunque el producto sea bueno, no te lo van a encontrar: crear la categoria requiere contenido y pauta, que es un negocio distinto al de importar.',
        '"' + test.termino + '" devuelve 0 publicaciones',
        'test-busqueda-cero'));
    } else if (test && test.suficiente === false){
      senales.enContra.push(F(
        'La busqueda que propusiste devuelve muy poco: cuesta que te encuentren.',
        '"' + test.termino + '" devuelve ' + (test.encontradas != null ? nf(test.encontradas) : test.muestra) + ' publicaciones'));
    }

    // --- 8.f) Presupuesto de test contra el capital ---
    var pres = presupuestoDeTest(md);
    if (pres && pres.excede){
      senales.criticos.push(C(
        'El test cuesta el ' + Math.round(pres.pctCapital) + '% de tu capital. Para un producto sin validar eso no es un test, es una apuesta.',
        ars(pres.costoTestARS) + ' de ' + ars(pres.capitalARS) + ' (' + pres.unidadesTest + ' uds)',
        'test-caro'));
    }
    return senales;
  }

  // ---------------------------------------------------------------
  // 8.g) Veredicto de cuatro estados. Lo decide este codigo, en este orden.
  // ---------------------------------------------------------------
  function veredictoSinComparable(md, senales){
    var expl = (md && md.exploracion) || {};
    var test = (md && md.testBusqueda) || null;
    var ant = (md && md.antiguedad) || { valor:'sin-dato' };
    var e = expl.existeEn || {};
    var c = expl.conteos || {};

    // Mismo criterio que la senal: hace falta que TODOS los escalones se hayan
    // consultado bien y hayan dado cero. Un escalon bloqueado no prueba
    // ausencia de categoria.
    var sinCategoriaMadre = expl.categoriaMadreAusenteConfirmada === true;
    // MercadoLibre casi nunca devuelve cero: para una busqueda sin
    // coincidencias sirve resultados de rescate. Por eso "no existe" NO es un
    // conteo en cero sino relevancia por debajo del minimo, y existeEn ya
    // viene resuelto asi desde el backend (estado 'noExiste' -> false).
    var noExisteRegion = e.MLA === false && e.MLB === false && e.MLM === false;
    var testCero = test && test.encontradas === 0;

    // Mientras Brasil/Mexico no volvieron, no se cierra el veredicto: los dos
    // paises son parte de la evidencia y adelantarse seria decidir con menos
    // datos de los que van a estar en un rato.
    var regionPendiente = !expl.existeEn ||
      !Object.prototype.hasOwnProperty.call(expl.existeEn, 'MLB') ||
      !Object.prototype.hasOwnProperty.call(expl.existeEn, 'MLM');
    if (regionPendiente){
      return { clave:'gris', titulo:'CONSULTANDO LA REGIÓN',
        sub:'Todavía estoy mirando si este producto se vende en Brasil o México. Es la evidencia más informativa que tengo cuando no hay comparable local, así que espero a tenerla antes de darte un veredicto.',
        condiciones:[], bloqueado:true };
    }

    // El test de busqueda es obligatorio: sin el, no se emite veredicto.
    if (!test){
      return { clave:'gris', titulo:'FALTA EL TEST DE BÚSQUEDA',
        sub:'No se puede evaluar un producto que no sabés cómo se busca. Completá las 3 palabras del paso 5.',
        condiciones:[], bloqueado:true };
    }

    if ((sinCategoriaMadre && noExisteRegion) || noExisteRegion || testCero || sinCategoriaMadre){
      return { clave:'no', titulo:'SIN MERCADO',
        sub:'No hay evidencia de que exista mercado para esto en la región.',
        condiciones: [
          sinCategoriaMadre ? 'Ni la categoría genérica tiene publicaciones en MercadoLibre Argentina.' : null,
          noExisteRegion ? 'No aparece en Argentina, ni en Brasil, ni en México.' : null,
          testCero ? 'La búsqueda que propusiste ("' + test.termino + '") no devuelve nada.' : null
        ].filter(Boolean) };
    }

    var categoriaRota = !!(expl.categoriaMadre &&
      (expl.categoriaMadre.ventasTop3 == null || expl.categoriaMadre.ventasTop3 > 0));
    if (ant.valor === 'vieja' && expl.categoriaMadre && categoriaRota){
      return { clave:'no', titulo:'PROBABLEMENTE YA FRACASÓ',
        sub:'El producto es viejo afuera, la categoría se vende acá, y sin embargo nadie lo trae. Lo más probable es que alguien ya lo probó. Averiguá por qué antes de repetirlo.',
        condiciones: [
          'Buscá el producto en MeLi con publicaciones pausadas o finalizadas: si hubo, alguien lo trajo y lo dejó.',
          'Preguntale al proveedor si le compró alguien de Argentina antes y qué volumen.',
          'Revisá si hay traba de importación o certificación que explique la ausencia.'
        ] };
    }

    // Mismo criterio que la senal de ventana: publicaciones relevantes
    // ESTIMADAS (ratio x total), no el conteo de la muestra, que esta topeada
    // en 30-40 ids y satura.
    var relBR = (expl.relevancia && expl.relevancia.MLB) || null;
    var brN = (relBR && relBR.estimadas != null) ? relBR.estimadas : c.MLB;
    if (ant.valor === 'nueva' && e.MLB === true && brN != null && brN >= 15 && test.suficiente === true){
      return { clave:'si', titulo:'VENTANA REAL — TEST CHICO',
        sub:'Es la mejor configuración posible sin comparable local. Igual entrá con el test mínimo, no con volumen.',
        condiciones: [] };
    }

    return { clave:'cond', titulo:'TEST DE VALIDACIÓN',
      sub:'No hay datos para decidir. Se puede probar, pero el tamaño de la compra lo define lo que estás dispuesto a perder entero, no el margen.',
      condiciones: [] };
  }

  window.__modoSinComparable = {
    senales: senalesSinComparable,
    veredicto: veredictoSinComparable,
    lineaFija: LINEA_FIJA,
    presupuesto: presupuestoDeTest,
    antiguedad: derivarAntiguedad
  };
})();

/* ---- bloque 24 ---- */
/* ===== Modo sin comparable: paso 5, exploracion y render ===== */
(function(){
  function nf(n){ return new Intl.NumberFormat('es-AR').format(n); }
  function ars(n){ return 'ARS ' + nf(Math.round(n)); }

  // Cuando el paso 2 detecta que no hay comparable, se dispara la exploracion
  // (categoria madre + Brasil/Mexico) y se muestra el paso 5.
  window.activarModoSinComparable = async function(product){
    if (typeof mrData === 'undefined' || !mrData) return;
    mrData.sinComparable = true;
    var paso5 = document.getElementById('mrStep5');
    if (paso5) paso5.style.display = '';

    var cuerpo = document.getElementById('mrStep2Body');
    if (cuerpo){
      cuerpo.insertAdjacentHTML('beforeend',
        '<div class="mr-badge-estimacion" id="mrNoCompAviso" style="margin-top:12px">' +
        'Sin comparable en MercadoLibre Argentina. Buscando la categoría madre y mirando si se vende en Brasil o México...' +
        '</div><div id="mrExploracionOut"></div>');
    }

    // Dos pedidos EN PARALELO, cada uno con su propia invocacion de 60 s en
    // Vercel. Se pinta lo que va llegando en vez de esperar a los dos: el
    // usuario ve la categoria madre y Argentina mucho antes de que vuelvan
    // Brasil y Mexico.
    mrData.exploracion = null;
    mrData.regionPendiente = true;

    var pedir = function(step){
      return fetch('/api/market', { method:'POST', headers: mrCabeceras(),
        body: JSON.stringify({ step: step, product: product }) })
        .then(function(res){ return res.json().then(function(j){ if(!res.ok) throw new Error(j.error||('Error en '+step)); return j; }); });
    };

    var pExpl = pedir('exploracion').then(function(r){
      // Se conserva lo que ya hubiera llegado de la region.
      var previo = mrData.exploracion || {};
      // Todos los mapas indexados por pais se mergean. Antes faltaban
      // relevancia y estados, y sin relevancia la senal de ventana de Brasil
      // no se podia emitir nunca: leia un objeto que solo tenia Argentina.
      mrData.exploracion = Object.assign({}, r, {
        terminos:   Object.assign({}, r.terminos,   previo.terminos),
        paises:     Object.assign({}, r.paises,     previo.paises),
        conteos:    Object.assign({}, r.conteos,    previo.conteos),
        existeEn:   Object.assign({}, r.existeEn,   previo.existeEn),
        estados:    Object.assign({}, r.estados,    previo.estados),
        relevancia: Object.assign({}, r.relevancia, previo.relevancia)
      });
      pintarExploracion(mrData.exploracion);
      refrescarDecision();
    }).catch(function(e){
      var out = document.getElementById('mrExploracionOut');
      if (out) out.innerHTML = '<div style="margin-top:8px;font-size:.82rem;color:var(--red)">No pude explorar la categoría madre: ' + e.message + '</div>';
    });

    var pReg = pedir('region').then(function(r){
      var base = mrData.exploracion || { terminos:{}, paises:{}, conteos:{}, existeEn:{}, estados:{}, relevancia:{} };
      mrData.exploracion = Object.assign({}, base, {
        terminos:   Object.assign({}, base.terminos,   r.terminos),
        paises:     Object.assign({}, base.paises,     r.paises),
        conteos:    Object.assign({}, base.conteos,    r.conteos),
        existeEn:   Object.assign({}, base.existeEn,   r.existeEn),
        estados:    Object.assign({}, base.estados,    r.estados),
        relevancia: Object.assign({}, base.relevancia, r.relevancia),
        regionConsultadaEn: r.consultadoEn
      });
      mrData.regionPendiente = false;
      pintarExploracion(mrData.exploracion);
      refrescarDecision();
    }).catch(function(e){
      mrData.regionPendiente = false;
      // Un fallo de red NO es un cero: los paises quedan sin dato.
      var base = mrData.exploracion || { terminos:{}, paises:{}, conteos:{}, existeEn:{}, estados:{}, relevancia:{} };
      base.paises = Object.assign({}, base.paises, {
        MLB: { site:'MLB', pais:'Brasil', ok:false, publicaciones:null, muestra:0, motivo:'no pude consultar Brasil: ' + e.message },
        MLM: { site:'MLM', pais:'Mexico', ok:false, publicaciones:null, muestra:0, motivo:'no pude consultar Mexico: ' + e.message }
      });
      base.conteos  = Object.assign({}, base.conteos,  { MLB:null, MLM:null });
      base.existeEn = Object.assign({}, base.existeEn, { MLB:null, MLM:null });
      mrData.exploracion = base;
      pintarExploracion(base);
      refrescarDecision();
    });

    await Promise.all([pExpl, pReg]);
    var aviso = document.getElementById('mrNoCompAviso');
    if (aviso) aviso.textContent = 'Sin comparable en MercadoLibre Argentina. No es poca competencia: no hay comparable.';
  };

  // Si el paso 4 ya corrio, se vuelve a evaluar con los datos nuevos.
  function refrescarDecision(){
    if (typeof mrData !== 'undefined' && mrData && mrData.step4 &&
        typeof window.renderMRDecision === 'function') {
      window.renderMRDecision(mrData);
    }
  }

  // Se llama dos veces (cuando llega Argentina y cuando llega la region), asi
  // que reemplaza su propio contenido en vez de acumular.
  function pintarExploracion(r){
    var out = document.getElementById('mrExploracionOut');
    if (!out) return;
    var NOMBRE = { MLA:'Argentina', MLB:'Brasil', MLM:'Mexico' };
    var filas = ['MLA','MLB','MLM'].map(function(k){
      var tieneDato = r.paises && Object.prototype.hasOwnProperty.call(r.paises, k);
      if (!tieneDato){
        // Todavia no volvio: no es cero ni "sin dato", es "consultando".
        return '<div class="mrv-pais"><div class="mrv-pais-n">' + NOMBRE[k] + '</div>' +
               '<div class="mrv-pais-v nd">consultando...</div>' +
               '<div class="mrv-pais-d">esperando respuesta de MercadoLibre</div></div>';
      }
      var p = r.paises[k] || {};
      var n = r.conteos ? r.conteos[k] : null;
      var existe = r.existeEn ? r.existeEn[k] : null;
      var cls = existe === true ? 'si' : (existe === false ? 'no' : 'nd');
      var val = (existe === null || existe === undefined) ? 'sin dato' : (n != null ? nf(n) : (p.muestra || 0));
      var det;
      if (existe === null || existe === undefined) det = (p.motivo || 'no se pudo consultar');
      else if (p.estado === 'dudoso') det = 'resultados parcialmente relacionados (relevancia ' + (p.ratio != null ? p.ratio.toFixed(2) : '?') + ')';
      else if (existe) det = (p.relevantes != null ? (p.relevantes + ' de ' + p.muestraDevuelta + ' coinciden') : ((p.muestra||0) + ' en la muestra')) +
                             (p.precioMediano ? ' · mediana ' + nf(p.precioMediano) + ' ' + (p.moneda||'') : '');
      // "sin publicaciones" era enganoso: casi siempre MeLi devuelve algo, solo
      // que de otra cosa. Se dice lo que realmente paso.
      else det = (p.muestraDevuelta > 0)
        ? ('MeLi devolvio ' + p.muestraDevuelta + ', ninguna de este producto')
        : 'sin publicaciones';
      return '<div class="mrv-pais"><div class="mrv-pais-n">' + (p.pais || NOMBRE[k]) + '</div>' +
             '<div class="mrv-pais-v ' + cls + '">' + val + '</div>' +
             '<div class="mrv-pais-d">' + det + (r.terminos && r.terminos[k] ? '<br>buscado como: "' + r.terminos[k] + '"' : '') + '</div></div>';
    }).join('');

    var madre = '';
    if (r.categoriaMadre){
      var cm = r.categoriaMadre;
      madre = '<div class="mrv-madre">Tu producto exacto no está en MeLi. La categoría madre <b>"' + cm.termino + '"</b> tiene ' +
        (cm.publicaciones != null ? '<b>' + nf(cm.publicaciones) + '</b> publicaciones activas' : '<b>' + cm.muestra + '</b> publicaciones en la muestra') +
        (cm.precioMediano ? ', mediana <b>' + ars(cm.precioMediano) + '</b>' : '') + '.' +
        '<span class="mrv-ref">Esa mediana es una referencia DE LA CATEGORÍA, no el precio de tu producto. No la cargo en el precio de venta.</span></div>';
    } else if (r.categoriaMadreAusenteConfirmada){
      madre = '<div class="mrv-madre">Ni siquiera la categoría genérica existe en MeLi. Probé: <b>' +
        (r.terminosProgresivos || []).join('</b> · <b>') + '</b>.</div>';
    } else if (Array.isArray(r.terminosProgresivos) && r.terminosProgresivos.length){
      madre = '<div class="mrv-madre">No encontré una categoría madre con muestra suficiente. Probé: <b>' +
        r.terminosProgresivos.join('</b> · <b>') + '</b>. Algún término no se pudo consultar, así que <b>no afirmo que la categoría no exista</b>.</div>';
    } else if (r.terminosProgresivos) {
      madre = '<div class="mrv-madre">No pude derivar términos de categoría madre para este producto.</div>';
    } else {
      madre = '<div class="mrv-madre" style="opacity:.7">Buscando la categoría madre...</div>';
    }

    out.innerHTML =
      '<div class="mrv-nocomp" style="margin-top:12px">' +
      '<div class="mrv-nocomp-linea">Publicaciones por país</div>' +
      '<div class="mrv-paises">' + filas + '</div>' + madre + '</div>';
  }

  // --- Paso 5 ---
  window.confirmMRStep5 = async function(){
    var g = function(id){ var e = document.getElementById(id); return e ? e.value : ''; };
    var termino = (g('mrTestBusqueda') || '').trim();
    if (!termino || termino.split(/\s+/).length < 2){
      alert('Escribí las palabras con las que un comprador buscaría este producto. Sin eso no puedo evaluarlo: el veredicto queda bloqueado.');
      return;
    }
    var revEl = document.getElementById('mrAliReviews');
    var reviews = window.__parseSmartNumber ? window.__parseSmartNumber(revEl ? revEl.value : '') : parseFloat(revEl ? revEl.value : '');
    if (!isFinite(reviews) || reviews < 0) reviews = 0;

    mrData.step5 = {
      tiktokEdad: g('mrTiktokEdad'),
      aliReviews: reviews,
      aliMes: parseInt(g('mrAliMes'), 10) || null,
      aliAnio: parseInt(g('mrAliAnio'), 10) || null,
      testTermino: termino,
      precioCreo: parseFloat(g('mrPrecioCreo')) || 0
    };
    mrData.antiguedad = window.derivarAntiguedad(mrData.step5);

    var out = document.getElementById('mrTestBusquedaOut');
    if (out) out.innerHTML = '<span style="color:var(--text-dim)">Buscando "' + termino + '" en MercadoLibre...</span>';
    try{
      var res = await fetch('/api/market', { method:'POST', headers: mrCabeceras(),
        body: JSON.stringify({ step:'testBusqueda', product: termino }) });
      var r = await res.json();
      if (!res.ok) throw new Error(r.error || 'Error en el test de busqueda');
      mrData.testBusqueda = r;
      if (out){
        if (r.suficiente === true) out.innerHTML = '<span style="color:var(--green)">Devuelve ' + nf(r.encontradas != null ? r.encontradas : r.muestra) + ' publicaciones. Hay categoría y la gente sabe cómo nombrarla.</span>';
        else if (r.encontradas === 0) out.innerHTML = '<span style="color:var(--red)">Devuelve 0 publicaciones. Nadie busca eso en MeLi.</span>';
        else if (r.suficiente === false) out.innerHTML = '<span style="color:#e0a020">Devuelve ' + nf(r.encontradas != null ? r.encontradas : r.muestra) + ' publicaciones: muy poco.</span>';
        else out.innerHTML = '<span style="color:#e0a020">No pude consultar MercadoLibre (' + (r.motivo || 'sin motivo') + '). Falta el dato; no lo cuento como cero.</span>';
      }
    }catch(e){
      mrData.testBusqueda = null;
      if (out) out.innerHTML = '<span style="color:var(--red)">No pude correr el test: ' + e.message + '</span>';
    }

    var a = mrData.antiguedad;
    var cuerpo = document.getElementById('mrStep5Body');
    if (cuerpo){
      var colorA = a.valor === 'nueva' ? 'var(--green)' : (a.valor === 'vieja' ? 'var(--red)' : '#e0a020');
      cuerpo.insertAdjacentHTML('beforeend',
        '<div style="margin-top:12px;padding:10px;border-top:1px solid #2a2a2a">' +
        '<div class="mr-row"><span class="mr-row-label">Antigüedad de la demanda</span>' +
        '<span class="mr-row-value" style="color:' + colorA + ';font-weight:700">' + a.valor + '</span></div>' +
        '<div style="font-size:.82rem;color:var(--text-dim);margin-top:4px">De dónde sale: ' + a.motivo + '</div></div>');
    }
    if (mrData.step4 && typeof window.renderMRDecision === 'function') window.renderMRDecision(mrData);
    else if (mrData.step4) runMRFinalAnalysis();
  };

  // --- Render del modo dentro del bloque de decision ---
  window.__pintarSinComparable = function(md){
    var caja = document.getElementById('mrvNoComp');
    var quiebre = document.getElementById('mrvQuiebre');
    var test = document.getElementById('mrvTest');
    if (!caja) return;

    if (!md || !md.sinComparable){
      caja.style.display = 'none';
      if (test) test.style.display = 'none';
      if (quiebre) quiebre.style.display = '';
      mostrarGauge(true);
      return;
    }

    caja.style.display = 'block';
    document.getElementById('mrvNoCompLinea').textContent = window.__modoSinComparable.lineaFija;

    // 8.h) Los escenarios de quiebre NO van en este modo: se calculan sobre un
    // precio de venta que no existe. En su lugar, el presupuesto de test.
    if (quiebre) quiebre.style.display = 'none';

    var r = md.exploracion;
    var paisesEl = document.getElementById('mrvPaises');
    var madreEl = document.getElementById('mrvMadre');
    if (r && paisesEl){
      paisesEl.innerHTML = ['MLA','MLB','MLM'].map(function(k){
        var p = (r.paises && r.paises[k]) || {};
        var n = r.conteos ? r.conteos[k] : null;
        var existe = r.existeEn ? r.existeEn[k] : null;
        var cls = existe === true ? 'si' : (existe === false ? 'no' : 'nd');
        var val = existe === null ? 'sin dato' : (n != null ? nf(n) : (p.muestra || 0));
        var det;
        if (existe === null) det = (p.motivo || 'no se pudo consultar');
        else if (existe) det = 'publicaciones del producto' +
          (p.muestraDevuelta ? ' (' + p.relevantes + ' de ' + p.muestraDevuelta + ' de la muestra coinciden)' : '');
        // Casi nunca es literalmente "sin publicaciones": MeLi devuelve
        // resultados de rescate. Se dice lo que paso de verdad.
        else det = (p.muestraDevuelta > 0)
          ? ('MeLi devolvio ' + p.muestraDevuelta + ', ninguna de este producto')
          : 'sin publicaciones';
        return '<div class="mrv-pais"><div class="mrv-pais-n">' + (p.pais || k) + '</div>' +
               '<div class="mrv-pais-v ' + cls + '">' + val + '</div>' +
               '<div class="mrv-pais-d">' + det + '</div></div>';
      }).join('');
    } else if (paisesEl){
      paisesEl.innerHTML = '<div class="mrv-vacio">No pude consultar la región.</div>';
    }
    if (madreEl){
      if (r && r.categoriaMadre){
        var cm = r.categoriaMadre;
        madreEl.innerHTML = 'Categoría madre <b>"' + cm.termino + '"</b>: ' +
          (cm.publicaciones != null ? '<b>' + nf(cm.publicaciones) + '</b> publicaciones' : '<b>' + cm.muestra + '</b> en la muestra') +
          (cm.precioMediano ? ', mediana <b>' + ars(cm.precioMediano) + '</b>' : '') +
          '<span class="mrv-ref">Referencia DE LA CATEGORÍA, no el precio de tu producto.</span>';
      } else if (r){
        madreEl.innerHTML = 'Ni la categoría genérica tiene publicaciones en MeLi Argentina.';
      } else {
        madreEl.innerHTML = '';
      }
    }

    // Presupuesto de test
    var pres = window.presupuestoDeTest(md);
    var grid = document.getElementById('mrvTestGrid');
    var nota = document.getElementById('mrvTestNota');
    if (test && grid && pres){
      test.style.display = 'block';
      var cajas = [];
      cajas.push('<div class="mrv-qbox"><div class="mrv-qlabel">Unidades del test</div>' +
        '<div class="mrv-qval">' + nf(pres.unidadesTest) + ' uds</div>' +
        '<div class="mrv-qtext">' + (pres.faltaMOQ
          ? 'No cargaste el MOQ del proveedor: uso el mínimo de 50. <b>Cargá el MOQ real</b> para dimensionarlo bien.'
          : 'El mayor entre tu MOQ (' + nf(pres.moq) + ') y 50 unidades.') + '</div></div>');
      cajas.push('<div class="mrv-qbox"><div class="mrv-qlabel">Costo del test</div>' +
        '<div class="mrv-qval' + (pres.excede ? ' mrv-q-bad' : '') + '">' + ars(pres.costoTestARS) + '</div>' +
        '<div class="mrv-qtext">' + nf(pres.unidadesTest) + ' unidades a ' + ars(pres.costoUnitARS) + ' cada una (landed + IVA de importación + percepción)' +
        (pres.pctCapital != null ? '. Es el <b>' + Math.round(pres.pctCapital) + '%</b> de tu capital declarado.' : '.') + '</div></div>');
      if (pres.precioCreo > 0){
        cajas.push('<div class="mrv-qbox"><div class="mrv-qlabel">Para recuperar el test</div>' +
          '<div class="mrv-qval">' + (pres.udsParaRecuperar ? nf(pres.udsParaRecuperar) + ' uds' : '—') + '</div>' +
          '<div class="mrv-qtext">' + (pres.udsParaRecuperar
            ? 'A ' + ars(pres.precioCreo) + ' necesitás vender <b>' + nf(pres.udsParaRecuperar) + ' unidades</b> para recuperar el test. <b>¿Te parece alcanzable en 90 días?</b> Esa es la pregunta que tenés que contestar vos: no es una proyección mía.'
            : 'Al precio que cargaste (' + ars(pres.precioCreo) + ') el margen unitario es negativo: no se recupera vendiendo más.') + '</div></div>');
      } else {
        cajas.push('<div class="mrv-qbox"><div class="mrv-qlabel">Para recuperar el test</div>' +
          '<div class="mrv-qval">—</div><div class="mrv-qtext">Cargá en el paso 5 a qué precio creés que lo venderías y te digo cuántas unidades hacen falta.</div></div>');
      }
      grid.innerHTML = cajas.join('');

      if (nota){
        var html = '<b>Modo de envío:</b> en un producto sin validar estás comprando velocidad de aprendizaje, no costo unitario bajo. ' +
          'Marítimo son 60-90 días para enterarte de algo que el aéreo te dice en 20. Elegí <b>aéreo o courier</b> aunque el unitario salga peor.';
        if (pres.esMaritimo) html += ' <b style="color:#e0a020">Hoy tenés marítimo seleccionado.</b>';
        if (pres.excede) html += '<span class="mrv-alerta"><b>El test cuesta el ' + Math.round(pres.pctCapital) + '% de tu capital.</b> Para un producto sin validar eso no es un test, es una apuesta.</span>';
        nota.innerHTML = html;
      }
    } else if (test){
      test.style.display = 'none';
    }

    // 8.a / 8.h) El gauge se oculta: sin comparable no hay score posible.
    mostrarGauge(false);
  };

  function mostrarGauge(visible){
    var box = document.querySelector('#mrResult .mr-charts-top .mr-chart-box');
    if (!box) return;
    var wrap = box.querySelector('.gauge-wrap');
    var label = box.querySelector('.gauge-label');
    var leg = box.querySelector('.gauge-legend');
    var off = box.querySelector('.mrv-gauge-off');
    if (visible){
      if (wrap) wrap.style.display = '';
      if (label) label.style.display = '';
      if (leg) leg.style.display = '';
      if (off) off.remove();
    } else {
      if (wrap) wrap.style.display = 'none';
      if (label) label.style.display = 'none';
      if (leg) leg.style.display = 'none';
      if (!off){
        box.insertAdjacentHTML('beforeend',
          '<div class="mrv-gauge-off">Sin comparable local no hay score posible. Mirá las señales.</div>');
      }
    }
  }
  window.__mostrarGauge = mostrarGauge;
})();
