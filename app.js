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
    var navMap={menuScreen:'mcNavInicio',marketScreen:'mcNavBuscador',appScreen:'mcNavRecomendador'};
    document.querySelectorAll('#mcNavInicio,#mcNavBuscador,#mcNavRecomendador').forEach(function(a){a.classList.remove('active');});
    var activeNavId=navMap[id];
    if(activeNavId){var navEl=document.getElementById(activeNavId); if(navEl) navEl.classList.add('active');}
  }
  var reduced=false;
  try{ reduced=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}
  if(!reduced && document.startViewTransition){ document.startViewTransition(apply); }
  else { apply(); }
}
function setHash(h){try{history.replaceState(null,'','#'+h);}catch(e){}}
function routeFromHash(){
  var h=(location.hash||'').replace('#','').toLowerCase();
  if(h==='market'||h==='mercado'){showMarket();return true;}
  if(h==='productfinder'||h==='app'||h==='recomendador'){showApp();return true;}
  if(h==='menu'||h==='inicio'||h==='hub'){showMenu();return true;}
  return false;
}
window.addEventListener('hashchange',function(){routeFromHash();});
function showApp(){showScreen('appScreen');setHash('productfinder');try{window.scrollTo({top:0,behavior:'smooth'});}catch(e){window.scrollTo(0,0);}}
function showMenu(){showScreen('menuScreen');setHash('menu');try{window.scrollTo({top:0,behavior:'smooth'});}catch(e){window.scrollTo(0,0);}}
function showMarket(){showScreen('marketScreen');setHash('market');try{window.scrollTo({top:0,behavior:'smooth'});}catch(e){window.scrollTo(0,0);}}

function doGuest(){currentRole='guest';sessionExpiry=null;localStorage.setItem('pf_user','Invitado');localStorage.setItem('pf_role','guest');localStorage.removeItem('pf_premium');localStorage.removeItem('pf_expiry');showScreen('menuScreen');setupTopbar('Invitado');var ab=document.getElementById('btnAdminPanel');if(ab)ab.style.display='none';var ex=document.getElementById('topbarExpiry');if(ex)ex.style.display='none';} function doLogout(){
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
  if(tag){ tag.textContent='Sin datos'; tag.classList.add('is-error'); tag.classList.remove('is-example'); }
  if(el) el.innerHTML =
    '<div class="hhd-errstate">'+
      '<svg class="ic" aria-hidden="true"><use href="#i-warn"></use></svg>'+
      '<p class="hhd-errtitle">No pudimos consultar MercadoLibre reci&eacute;n</p>'+
      '<p class="hhd-errtext">'+hhdEscape(motivo||'La consulta no lleg&oacute; a destino.')+' No muestro n&uacute;meros estimados: o son datos reales de MercadoLibre, o no son nada.</p>'+
      '<button type="button" class="hhd-retry" onclick="runHeroDemo()">Reintentar</button>'+
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
    var res=await fetch('/api/market',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({step:'competencia',product:product})});
    var data=await res.json();
    if(!res.ok) throw new Error('El servidor respondió con un error.');
    if(!data || data.fuente!=='mercadolibre-search'){
      throw new Error((data && data.aviso) || 'MercadoLibre no devolvió datos para esa búsqueda.');
    }
    var now=Date.now();
    if(tag){ tag.textContent='En vivo'; tag.classList.remove('is-example'); tag.classList.remove('is-error'); }
    var nf=new Intl.NumberFormat('es-AR');
    var envioTxt=data.envioGratisTotal?(data.envioGratisPct+'%'):'—';
    if(resEl) resEl.innerHTML=
      '<div class="hhd-head"><div><div class="hhd-name">'+hhdEscape(product)+'</div><div class="hhd-meta">'+hhdEscape(data.categoryName||'MercadoLibre Argentina')+'</div></div></div>'+
      '<div class="hhd-grid">'+
        '<div class="hhd-kpi is-good"><b>$'+nf.format(data.precioPromedioARS||0)+'</b><span>Precio prom.</span></div>'+
        '<div class="hhd-kpi"><b>$'+nf.format(data.precioMinARS||0)+'</b><span>M&iacute;nimo</span></div>'+
        '<div class="hhd-kpi"><b>$'+nf.format(data.precioMaxARS||0)+'</b><span>M&aacute;ximo</span></div>'+
        '<div class="hhd-kpi is-accent"><b>'+nf.format(data.sellersEstimados||0)+'</b><span>Vendedores</span></div>'+
      '</div>'+
      '<div class="hhd-foot">'+nf.format(data.totalResults||0)+' publicaciones compitiendo &middot; '+envioTxt+' de las top con env&iacute;o gratis.</div>';
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
      const res = await fetch('/api/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(params) });
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
  if(!data.meliConectado){
    const motivo = data.meliTokenExpirado ? 'tu conexi&#243;n con MercadoLibre expir&#243;' : 'no ten&#233;s MercadoLibre conectado';
    banner = '<div class="ml-banner" style="grid-column:1/-1;background:rgba(255,230,0,.12);border:1px solid var(--gold);border-radius:10px;padding:14px 16px;margin-bottom:8px;color:var(--text)"><strong><svg class="ic" aria-hidden="true"><use href="#i-warn"></use></svg> Precios estimados:</strong> como '+motivo+', muestro los productos ordenados por su potencial (peso, margen esperado y estacionalidad), pero <strong>sin precios de venta reales</strong>. Conecta tu cuenta para ver precio, competencia y saturaci&#243;n reales de cada producto. <a href="/meli-connect.html" style="color:var(--gold);font-weight:700">Conectar MercadoLibre \u2192</a></div>';
  } else {
    banner = '<div class="ml-banner" style="grid-column:1/-1;background:rgba(39,174,96,.12);border:1px solid var(--green);border-radius:10px;padding:12px 16px;margin-bottom:8px;color:var(--text)"><svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg> Datos reales de MercadoLibre. Analizamos <strong>'+data.totalEvaluados+'</strong> productos, <strong>'+data.conDatoReal+'</strong> con datos de mercado en vivo. Cotizacion usada: 1 USD \u2248 $'+nf.format(data.usdArs)+'.</div>';
  }
  const cards = products.map(function(p){
    const real = p.score != null;
    const scorePct = real ? p.score : 0;
    const precio = p.precioVentaARS != null ? ('$'+nf.format(p.precioVentaARS)) : 'A validar';
    const costo = '$'+nf.format(Math.round(p.costoPuestoARS)) + ' aprox.';
    const margen = p.margen != null ? (p.margen+'%') : '\u2014';
        const sellers = (p.competencia != null ? nf.format(p.competencia) + ' pub.' : (p.sellers != null ? nf.format(p.sellers) + ' pub.' : '\u2014'));
    const fuenteTag = real ? '<span class="tag-real" title="Precio y competencia obtenidos en vivo de MercadoLibre"><svg class="ic" aria-hidden="true"><use href="#i-dot"></use></svg> Dato real ML</span>' : '<span class="tag-est" title="Sin precio real: conecta MercadoLibre para activarlo"><svg class="ic" aria-hidden="true"><use href="#i-dot"></use></svg> Estimado</span>';
    return '<div class="product-card '+(p.topPick?'top-pick':'')+'">'+(p.topPick ? '<span class="top-badge"><svg class="ic" aria-hidden="true"><use href="#i-star"></use></svg> TOP PICK</span>' : '')+'<div class="product-name">'+p.nombre+'</div><div style="margin-bottom:10px">'+fuenteTag+' <span class="tag-info" title="Por que es apto para regimen de importacion">'+p.nota+'</span></div>'+(real ? '<div class="score-row"><span>Score</span><strong>'+p.score+'/100</strong></div><div class="score-bar"><div class="score-fill" style="width:'+scorePct+'%"></div></div>' : '')+'<div class="product-stats"><div class="stat"><span class="stat-l" title="Precio promedio de venta en MercadoLibre">Precio venta</span><span class="stat-v">'+precio+'</span></div><div class="stat"><span class="stat-l" title="Costo estimado del producto puesto en Argentina (FOB China + logistica + impuestos)">Costo est.</span><span class="stat-v">'+costo+'</span></div><div class="stat"><span class="stat-l" title="Ganancia sobre el costo estimado">Margen</span><span class="stat-v">'+margen+'</span></div><div class="stat"><span class="stat-l" title="Publicaciones activas compitiendo en MercadoLibre (dato real)">Competencia</span><span class="stat-v">'+sellers+'</span></div><div class="stat"><span class="stat-l" title="Nivel de demanda del producto">Demanda</span><span class="stat-v">'+p.demanda+'</span></div><div class="stat"><span class="stat-l" title="Cuan saturado esta el mercado. Baja = mejor oportunidad">Saturacion</span><span class="stat-v">'+p.saturacion+'</span></div></div><div class="risk-line risk-'+String(p.riesgo).toLowerCase().replace(/[^a-z]/g,'')+'">Riesgo: '+p.riesgo+'</div></div>';
  }).join('');
  grid.innerHTML = banner + cards;
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
    thinking.textContent=data.reply||'No pude procesar tu consulta.';
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
        {data:tc.trendData,borderColor:'#FFE600',borderWidth:2.5,backgroundColor:'rgba(255,230,0,0.12)',fill:true,tension:0.4,pointRadius:3,pointBackgroundColor:'#FFE600'},
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
        const res=await fetch('/api/market',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({step:'productUrl',url})});
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
      const realBadge=r.realData?'<span style="background:#1d4d1d;color:#9fe89f;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600"><svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg> Dato real</span>':'<span style="background:#4d3d1d;color:#e8c89f;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600"><svg class="ic" aria-hidden="true"><use href="#i-warn"></use></svg> Datos parciales</span>';
      const fuenteNombre=r.fuente==='mercadolibre'?'MercadoLibre Argentina':(r.fuente==='alibaba'?'Alibaba':'Otra fuente');
      const img=r.imagen?`<img src="${r.imagen}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:8px;background:#1a1a1a"/>`:'<div style="width:120px;height:120px;background:#1a1a1a;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#555">sin foto</div>';
      let precioHtml='';
      if(r.fuente==='mercadolibre'&&r.precio!=null){
        precioHtml=`<div style="font-size:1.3rem;color:#FFE600;font-weight:700;margin-top:4px">${r.moneda||'ARS'} ${Number(r.precio).toLocaleString('es-AR')}</div>`;
      }
      let metaHtml='';
      if(r.fuente==='mercadolibre'){
        const cond=r.condicion==='new'?'Nuevo':(r.condicion==='used'?'Usado':r.condicion||'');
        const envio=r.envioGratis?' &#8226; <svg class="ic" aria-hidden="true"><use href="#i-truck"></use></svg> Env&#237;o gratis':'';
        metaHtml=`<div style="font-size:0.85rem;color:#9a9a9a;margin-top:6px">${cond}${envio}${r.vendidos!=null?' &#8226; '+r.vendidos+' vendidos':''}${r.disponibles!=null?' &#8226; '+r.disponibles+' disponibles':''}</div>`;
        if(r.categoria)metaHtml+=`<div style="font-size:0.8rem;color:#777;margin-top:2px">Categor&#237;a: ${r.categoria}</div>`;
      }
      let alibabaForm='';
      if(r.fuente==='alibaba'){
        alibabaForm=`<div style="margin-top:14px;padding:12px;border:1px dashed #4a3d1d;border-radius:8px;background:#1a1606">
          <div style="font-weight:600;color:#FFE600;margin-bottom:6px"><svg class="ic" aria-hidden="true"><use href="#i-build"></use></svg> Complet&#225; los datos de Alibaba</div>
          <div style="font-size:0.82rem;color:#9a9a9a;margin-bottom:10px">${r.aviso||''}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
            <div><label style="font-size:0.82rem;color:#bbb">Precio FOB (USD/unidad) <span title="${r.explicacion?.FOB||''}" style="cursor:help;color:#FFE600"><svg class="ic" aria-hidden="true"><use href="#i-info"></use></svg></span></label><input type="number" step="0.01" min="0" id="mrLinkFOB" placeholder="Ej: 2.50" style="width:100%;margin-top:4px"/></div>
            <div><label style="font-size:0.82rem;color:#bbb">MOQ (unidades) <span title="${r.explicacion?.MOQ||''}" style="cursor:help;color:#FFE600"><svg class="ic" aria-hidden="true"><use href="#i-info"></use></svg></span></label><input type="number" step="1" min="1" id="mrLinkMOQ" placeholder="Ej: 100" style="width:100%;margin-top:4px"/></div>
            <div><label style="font-size:0.82rem;color:#bbb">Peso/unidad (kg) <span title="Sirve para estimar el flete" style="cursor:help;color:#FFE600"><svg class="ic" aria-hidden="true"><use href="#i-info"></use></svg></span></label><input type="number" step="0.01" min="0" id="mrLinkPeso" placeholder="Ej: 0.25" style="width:100%;margin-top:4px"/></div>
          </div>
          <div style="font-size:0.78rem;color:#777;margin-top:8px"><svg class="ic" aria-hidden="true"><use href="#i-bulb"></use></svg> ${r.explicacion?.por_que_manual||''}</div>
        </div>`;
      }
      const desc=r.descripcion?`<div style="margin-top:10px;padding:10px;background:#0a0a0a;border-radius:6px;font-size:0.85rem;color:#bbb;max-height:120px;overflow:auto">${(r.descripcion||'').substring(0,500)}${r.descripcion.length>500?'...':''}</div>`:'';
      card.innerHTML=`
        <div style="display:flex;gap:14px;align-items:flex-start;padding:12px;border:1px solid #2a2a2a;border-radius:10px;background:#0a0a0a">
          ${img}
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px"><span style="font-size:0.78rem;color:#888">${fuenteNombre}</span>${realBadge}</div>
            <div style="font-weight:600;color:#fff;font-size:1rem;line-height:1.3">${r.titulo||'(sin t&#237;tulo)'}</div>
            ${precioHtml}
            ${metaHtml}
            <div style="margin-top:8px"><a href="${r.permalink||'#'}" target="_blank" rel="noopener" style="font-size:0.8rem;color:#FFE600">Ver publicaci&#243;n original &#8599;</a></div>
          </div>
        </div>
        ${desc}
        ${alibabaForm}
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-mr-analyze" onclick="useProductForMarketRead()"><svg class="ic" aria-hidden="true"><use href="#i-chart"></use></svg> Hacer lectura de mercado de este producto</button>
          <button class="btn-outline-dim" style="padding:8px 14px" onclick="clearProductCard()">Limpiar</button>
        </div>
      `;
    }

    function clearProductCard(){
      document.getElementById('mrProductCard').style.display='none';
      document.getElementById('mrProductCard').innerHTML='';
      document.getElementById('mrUrlInput').value='';
      mrLastProductData=null;
    }

    function useProductForMarketRead(){
      if(!mrLastProductData)return;
      const r=mrLastProductData;
      // Volcar el t&#237;tulo al campo principal
      const titleInput=document.getElementById('mrProductInput');
      if(titleInput&&r.titulo)titleInput.value=r.titulo;
      // Si es Alibaba y el usuario carg&#243; FOB/MOQ/Peso, pasarlos al c&#225;lculo
      if(r.fuente==='alibaba'){
        const fob=document.getElementById('mrLinkFOB');
        const moq=document.getElementById('mrLinkMOQ');
        const peso=document.getElementById('mrLinkPeso');
        if(fob&&fob.value){const f=document.getElementById('mrFOB');if(f)f.value=fob.value;}
        if(peso&&peso.value){const p=document.getElementById('mrPesoKg');if(p)p.value=peso.value;}
        if(moq&&moq.value){window.mrMOQ=parseInt(moq.value,10);}
      }
      // Si es MercadoLibre y hay precio, lo guardamos como referencia de precio de venta
      if(r.fuente==='mercadolibre'&&r.precio!=null){
        window.mrPrecioReferenciaARS=r.precio;
      }
      // Arrancar el an&#225;lisis existente
      startMRAnalysis();
      // Scrollear al resultado
      setTimeout(()=>{const el=document.getElementById('mrStep1');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});},300);
    }

    
function mrLoadingHTML(txt){return `<div class="mr-loading"><div class="dot-anim"><span></span><span></span><span></span></div><span>${txt}</span></div>`;}

async function startMRAnalysis(){
  const product=document.getElementById('mrProductInput').value.trim();
  if(!product){alert('Ingres&#225; un producto para analizar');return;}
  mrCurrentProduct=product;
  mrData={product,capital:document.getElementById('mrCapital').value,canal:document.getElementById('mrCanal').value,tc:parseFloat(document.getElementById('mrTipoCambio').value)||1250};
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
    const res=await fetch('/api/market',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({step:'demanda',product})});
    const r=await res.json();
    if(!res.ok) throw new Error(r.error||'Error en step demanda');
    mrData.step1=r;
    const tendColor=r.tendencia==='subiendo'?'tag-ok':r.tendencia==='bajando'?'tag-bad':'tag-warn';
    const tendIcon=r.tendencia==='subiendo'?'\u2191':r.tendencia==='bajando'?'\u2193':'\u2192';
    const tags=(r.tags||[]).map(t=>`<span class="mr-tag tag-info">${t}</span>`).join('');
    const monthlyRows=r.monthlyData?(r.monthlyData.map(m=>`<div class="mr-row"><span class="mr-row-label">${m.label}</span><span class="mr-row-value" style="color:var(--gold)">${m.valor}/100</span></div>`).join('')):'';
    document.getElementById('mrStep1Body').innerHTML=`<div class="mr-row"><span class="mr-row-label">Tendencia en Argentina</span><span class="mr-row-value"><span class="mr-tag ${tendColor}">${tendIcon} ${r.tendencia}</span></span></div><div class="mr-row"><span class="mr-row-label">Nivel de demanda</span><span class="mr-row-value" style="color:var(--gold);font-weight:700">${r.nivelDemanda||'--'}</span></div><div class="mr-row"><span class="mr-row-label">Temporalidad</span><span class="mr-row-value">${r.temporalidad||'--'}</span></div><div class="mr-row"><span class="mr-row-label">Score de demanda</span><span class="mr-row-value">${r.demandaScore||'--'}/100</span></div><div style="margin-top:8px;font-size:.82rem;color:var(--text-dim)">${r.descripcion||''}</div><div style="margin-top:8px">${tags}</div><div style="margin-top:12px"><span class="mr-tag tag-info"><svg class="ic" aria-hidden="true"><use href="#i-trend"></use></svg> Datos de demanda basados en categor&#237;a y estacionalidad AR</span></div>${monthlyRows}`;
  }catch(e){
    document.getElementById('mrStep1Body').innerHTML='<span style="color:var(--red);font-size:.82rem">Error al obtener datos. Continu&#225; con los pasos guiados.</span>';
    mrData.step1={tendencia:'estable',demandaScore:50,temporalidad:'todo el a&#241;o',tags:[],nivelDemanda:'medio'};
  }
}

async function runMRStep2(product){
  try{
    const res=await fetch('/api/market',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({step:'competencia',product})});
    const r=await res.json();
    if(!res.ok) throw new Error(r.error||'Error en step competencia');
    mrData.step2=r;
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
    const extraInfo=r.totalResults?`<div class="mr-row"><span class="mr-row-label">Total publicaciones activas</span><span class="mr-row-value">${r.totalResults.toLocaleString('es-AR')}</span></div>`:'';
    const catInfo=r.categoryName?`<div class="mr-row"><span class="mr-row-label">Categor&#237;a principal</span><span class="mr-row-value">${r.categoryName}</span></div>`:'';
    document.getElementById('mrStep2Body').innerHTML=`<div class="mr-row"><span class="mr-row-label">Sellers &#250;nicos reales</span><span class="mr-row-value">${r.sellersEstimados}</span></div><div class="mr-row"><span class="mr-row-label">Rango de precios reales</span><span class="mr-row-value">ARS ${fmt(r.precioMinARS)} \u2013 ${fmt(r.precioMaxARS)}</span></div><div class="mr-row"><span class="mr-row-label">Precio promedio real</span><span class="mr-row-value" style="color:var(--gold);font-weight:700">ARS ${fmt(r.precioPromedioARS)}</span></div>${catInfo}${extraInfo}<div class="mr-row"><span class="mr-row-label">Nivel de saturaci&#243;n</span><span class="mr-row-value"><span class="mr-tag ${satColor}">${r.saturacion||'--'}</span></span></div><div style="margin-top:8px;font-size:.82rem;color:var(--text-dim)">${r.descripcion||''}</div>${r.oportunidad?`<div style="margin-top:4px;font-size:.82rem;color:var(--green)"><svg class="ic" aria-hidden="true"><use href="#i-bulb"></use></svg> Oportunidad: ${r.oportunidad}</div>`:''}<div style="margin-top:12px"><span class="mr-tag tag-info"><svg class="ic" aria-hidden="true"><use href="#i-chart"></use></svg> ${r.fuente==='meli-html'?'Datos de Mercado Libre (HTML p&#250;blico)':r.fuente==='meli-api'?'Datos reales de Mercado Libre Argentina (API)':'Datos de Mercado Libre Argentina'}</span></div><table class="mr-comp-table"><thead><tr><th>#</th><th>Producto / Seller</th><th>Precio</th><th>Vendidos</th><th>Reputaci&#243;n</th></tr></thead><tbody>${compRows}</tbody></table>`;
  }catch(e){
    document.getElementById('mrStep2Body').innerHTML='<span style="color:var(--red);font-size:.82rem">Error al analizar MeLi. Continu&#225; con los pasos guiados.</span>';
    mrData.step2={sellersEstimados:0,precioMinARS:0,precioMaxARS:0,precioPromedioARS:0,competenciaScore:50,saturacion:'moderado'};
  }
}

function confirmMRStep3(){
  const views=parseFloat(document.getElementById('mrTiktokViews').value)||0;
  const arg=document.getElementById('mrTiktokArg').value;
  mrData.step3={views,arg};
  const argLabel=arg==='si'?'S&#237;, hay varios':arg==='pocos'?'Pocos (1-2)':'No';
  document.getElementById('mrStep3Body').innerHTML=`<div class="mr-row"><span class="mr-row-label">Vistas promedio top 3</span><span class="mr-row-value">${views.toLocaleString('es-AR')}</span></div><div class="mr-row"><span class="mr-row-label">Contenido en Argentina</span><span class="mr-row-value">${argLabel}</span></div><div style="margin-top:8px"><span class="mr-tag tag-ok"><svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg> Datos TikTok registrados</span></div>`;
}

// El paso de TikTok es opcional: si lo saltean, el score se calcula igual y
// se deja registrado que la demanda se midio con menos precision.
function skipMRStep3(){
  mrData.step3={views:0,arg:'no-informado',omitido:true};
  document.getElementById('mrStep3Body').innerHTML=
    '<div class="mr-row"><span class="mr-row-label">Tracci&#243;n en TikTok</span>'+
    '<span class="mr-row-value">Sin medir</span></div>'+
    '<div style="margin-top:8px"><span class="mr-tag tag-info">'+
    '<svg class="ic" aria-hidden="true"><use href="#i-info"></use></svg> '+
    'Paso salteado: calculo el score igual, con menos precisi&#243;n en demanda.</span></div>';
  if(window.mcTrack) window.mcTrack('tiktok_salteado',{producto:mrCurrentProduct||''});
}

function confirmMRStep4(){
  const fob=parseFloat(document.getElementById('mrFOB').value)||0;
  const ventas=parseFloat(document.getElementById('mrVentas').value)||0;
  const venta=parseFloat(document.getElementById('mrPrecioVenta').value)||0;
  if(!fob||!venta){alert('Complet&#225; al menos el precio FOB y el precio de venta');return;}
  const tc=mrData.tc;
  const s2=mrData.step2||{};
  const modalidad=(document.getElementById('mrModalidad')||{}).value||'flex';
  const posicion=(document.getElementById('mrPosicion')||{}).value||'estandar';
  mrData.modalidad=modalidad;mrData.posicion=posicion;
  const factorPos=posicion==='premium'?1.25:posicion==='multifuncion'?1.45:1.00;
  let medianoARS=0;
  if(s2.competitors&&s2.competitors.length){
    const arr=s2.competitors.map(c=>c.price).filter(p=>p>0).sort((a,b)=>a-b);
    if(arr.length){const m=Math.floor(arr.length/2);medianoARS=arr.length%2?arr[m]:Math.round((arr[m-1]+arr[m])/2);}
  }
  if(!medianoARS&&s2.precioPromedioARS){medianoARS=Math.round(s2.precioPromedioARS*0.92);}
  medianoARS=Math.round(medianoARS*factorPos);
  const usaMediano=medianoARS>0&&Math.abs(venta-medianoARS)/medianoARS>0.25;
  const catName=(s2.categoryName||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  let comisionPct=0.15;
  if(/electron|tecnolog|celular|computa/.test(catName))comisionPct=0.165;
  else if(/hogar|deco|mueble/.test(catName))comisionPct=0.14;
  else if(/deport|fitness/.test(catName))comisionPct=0.13;
  else if(/moda|indumen|ropa|calzado/.test(catName))comisionPct=0.16;
  else if(/mascot|bebe|ni&#241;/.test(catName))comisionPct=0.13;
  else if(/herramienta|industri/.test(catName))comisionPct=0.12;
  const ivaPct=0.21;const iibbPct=0.03;const ivaImportPct=0.21;
  function tarifaLogisticaARS(precio,mod){
    if(mod==='retiro')return 0;
    const envioGratis=precio>=35000;
    if(mod==='full'){const fija=precio<15000?2800:precio<30000?3600:4500;const almacen=precio*0.015;return fija+almacen;}
    if(mod==='flex')return 1200;
    if(mod==='estandar'){const tarifaBase=precio<15000?2500:3500;return envioGratis?tarifaBase*0.5:0;}
    return 0;
  }
  const recargoFull=modalidad==='full'?0.05:0;
  const comisionFinalPct=comisionPct+recargoFull;
  const logisticaARS=mrData.canal==='mercadolibre'?tarifaLogisticaARS(venta,modalidad):0;
  const empaqueUSD=0.50;
  const fleteUSD=(window.__getFleteUSDPerUnit?window.__getFleteUSDPerUnit(fob):fob*0.15);
  const seguroUSD=(fob+fleteUSD)*0.015;
  const cifUSD=fob+fleteUSD+seguroUSD;
  const arancelesUSD=cifUSD*(window.__getArancelRate?window.__getArancelRate():0.35);
  const despachoUSD=cifUSD*0.08;
  const costoLandedUSD=fob+fleteUSD+seguroUSD+arancelesUSD+despachoUSD+empaqueUSD;
  const fobARS=fob*tc;
  const fleteARS=fleteUSD*tc;
  const seguroARS=seguroUSD*tc;
  const arancelesARS=arancelesUSD*tc;
  const despachoARS=despachoUSD*tc;
  const empaqueARS=empaqueUSD*tc;
  const costoLandedARS=costoLandedUSD*tc;
  const comisionMeLiARS=venta*comisionFinalPct;
  const ivaDebitoARS=venta-(venta/(1+ivaPct));const ivaCreditoARS=(costoLandedARS+logisticaARS)-((costoLandedARS+logisticaARS)/(1+ivaImportPct));const ivaARS=Math.max(0,ivaDebitoARS-ivaCreditoARS);
  const iibbARS=venta*iibbPct;
  const fullARS=modalidad==='full'?logisticaARS:0;
  const costoTotalARS=costoLandedARS+comisionMeLiARS+ivaARS+iibbARS+logisticaARS;
  const margenARS=venta-costoTotalARS;
  const margenPct=venta>0?Math.round((margenARS/venta)*100):0;
  const ventasMes=ventas||0;
  const ventasDia=ventasMes/30;
  const capitalUSD=parseFloat(mrData.capital)||10000;
  const unidadesPosibles=Math.floor(capitalUSD/Math.max(0.01,costoLandedUSD));
  const ingresoMensualARS=margenARS*ventasMes;
  const inversionARS=costoLandedARS*Math.min(unidadesPosibles,Math.max(1,ventasMes));
  const roiMensualPct=inversionARS>0?(ingresoMensualARS/inversionARS)*100:0;
  const roiAnualPct=Math.round(roiMensualPct*12);
  const breakevenUds=margenARS>0?Math.ceil(inversionARS/margenARS):0;
  const breakevenDias=ventasDia>0&&breakevenUds>0?Math.ceil(breakevenUds/ventasDia):0;
  const scD=Math.min(100,(mrData.step1&&mrData.step1.demandaScore)||50);
  const scC=100-Math.min(100,(mrData.step2&&mrData.step2.competenciaScore)||50);
  const scM=Math.max(0,Math.min(100,margenPct*2.5));
  const scR=Math.max(0,Math.min(100,roiAnualPct/3));
  const scDef=mrData.step3&&mrData.step3.arg==='si'?70:mrData.step3&&mrData.step3.arg==='pocos'?50:30;
  const scoreReponderado=Math.round(scD*0.25+scC*0.20+scM*0.30+scR*0.15+scDef*0.10);
  mrData.step4={fob,ventas,venta,tc,modalidad,posicion,factorPos,costoLanded:costoLandedUSD,costoLandedARS,fobARS,fleteARS,seguroARS,arancelesARS,despachoARS,empaqueARS,comisionMeLiARS,ivaARS,iibbARS,logisticaARS,fullARS,margenARS,margenPct,medianoARS,comisionPct:comisionFinalPct,usaFull:modalidad==='full',roiMensualPct,roiAnualPct,breakevenUds,breakevenDias,unidadesPosibles,ingresoMensualARS,scoreReponderado,scD,scC,scM,scR,scDef};
  const mColor=margenPct>=40?'var(--green)':margenPct>=20?'var(--gold)':'var(--red)';
  const fmtA=n=>'ARS '+Math.round(n).toLocaleString('es-AR');
  const modLabel=modalidadLabel(modalidad);
  const advMediano=usaMediano?`<div class="mr-row"><span class="mr-row-label"><svg class="ic" aria-hidden="true"><use href="#i-warn"></use></svg> Sugerencia</span><span class="mr-row-value" style="color:var(--gold)">Mediano ${fmtA(medianoARS)} (tu venta difiere ${Math.round((venta-medianoARS)/medianoARS*100)}%)</span></div>`:'';
  const logRow=mrData.canal==='mercadolibre'?`<div class="mr-row"><span class="mr-row-label">Log&#237;stica (${modLabel})</span><span class="mr-row-value">${logisticaARS>0?fmtA(logisticaARS):'gratis (paga comprador)'}</span></div>`:'';
  document.getElementById('mrStep4Body').innerHTML=`<div class="mr-row"><span class="mr-row-label">Precio FOB</span><span class="mr-row-value">USD ${fob.toFixed(2)}</span></div><div class="mr-row"><span class="mr-row-label">Costo CIF (FOB+flete+seguro)</span><span class="mr-row-value">USD ${cifUSD.toFixed(2)}</span></div><div class="mr-row"><span class="mr-row-label">Costo landed total</span><span class="mr-row-value">USD ${costoLandedUSD.toFixed(2)} / ${fmtA(costoLandedARS)}</span></div><div class="mr-row"><span class="mr-row-label">Comisi&#243;n MeLi (${Math.round(comisionFinalPct*100)}%)</span><span class="mr-row-value">${fmtA(comisionMeLiARS)}</span></div><div class="mr-row"><span class="mr-row-label">IVA (21%)</span><span class="mr-row-value">${fmtA(ivaARS)}</span></div><div class="mr-row"><span class="mr-row-label">IIBB (3%)</span><span class="mr-row-value">${fmtA(iibbARS)}</span></div>${logRow}<div class="mr-row"><span class="mr-row-label">Margen neto estimado</span><span class="mr-row-value" style="color:${mColor};font-size:1.1rem">${margenPct}% (${fmtA(margenARS)})</span></div><div class="mr-row"><span class="mr-row-label">ROI anualizado</span><span class="mr-row-value" style="color:var(--gold)">${roiAnualPct}%</span></div>${breakevenUds?`<div class="mr-row"><span class="mr-row-label">Breakeven</span><span class="mr-row-value">${breakevenUds} uds${breakevenDias?` (~${breakevenDias} d&#237;as)`:''}</span></div>`:''}<div class="mr-row"><span class="mr-row-label">Score reponderado</span><span class="mr-row-value" style="color:var(--gold);font-weight:700">${mrData.step4.scoreReponderado}/100</span></div><div class="mr-row"><span class="mr-row-label">Modalidad / Posicionamiento</span><span class="mr-row-value">${modLabel} &#183; ${posicion}</span></div>${advMediano}${ventas?`<div class="mr-row"><span class="mr-row-label">Ventas/mes top sellers MeLi</span><span class="mr-row-value">${ventas} uds</span></div>`:''}<div style="margin-top:8px"><span class="mr-tag tag-ok"><svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg> C&#225;lculo registrado</span></div>`;
  runMRFinalAnalysis();
}

async function runMRFinalAnalysis(){
  document.getElementById('mrResult').classList.add('visible');
  document.getElementById('gaugeScore').textContent='...';
  document.getElementById('mrResultProduct').textContent=mrCurrentProduct;
  const {step1,step2,step3,step4}=mrData;
  try{
    const prompt=`Sos un analista experto en importaciones China-Argentina. Hac&#233; un an&#225;lisis completo de viabilidad para: "${mrCurrentProduct}". Datos recopilados: - DEMANDA: tendencia=${step1?.tendencia}, demandaScore=${step1?.demandaScore}/100, temporalidad=${step1?.temporalidad}, nivelDemanda=${step1?.nivelDemanda} - COMPETENCIA MELI: sellers\u2248${step2?.sellersEstimados}, saturacion=${step2?.saturacion}, competenciaScore=${step2?.competenciaScore}/100, precio promedio ARS ${step2?.precioPromedioARS}, precio mediano ARS ${step4?.medianoARS||'n/d'}, categoria=${step2?.categoryName||'n/d'} - TIKTOK: vistas promedio top3=${step3?.views||'no informado'}, contenido Argentina=${step3?.arg||'no informado'} - RENTABILIDAD: FOB USD ${step4?.fob}, costo landed USD ${step4?.costoLanded?.toFixed(2)}, comisi&#243;n MeLi ${Math.round((step4?.comisionPct||0.15)*100)}%, IVA 21% + IIBB 3%${step4?.usaFull?' + Full 10%':''}, precio venta ARS ${step4?.venta}, margen NETO ${step4?.margenPct}% (ARS ${Math.round(step4?.margenARS||0).toLocaleString('es-AR')}), ROI anualizado ${step4?.roiAnualPct}%, breakeven ${step4?.breakevenUds} uds, score reponderado ${step4?.scoreReponderado}/100, ventas/mes top sellers=${step4?.ventas||'no informado'} - Canal: ${mrData.canal}, Capital disponible: USD ${mrData.capital} Respond&#233; SOLO con JSON v&#225;lido sin markdown: {"scoreTotal":number 0-100,"scoresDemanda":number 0-100,"scoresCompetencia":number 0-100,"scoresMargen":number 0-100,"scoresRegulatorio":number 0-100,"labelDemanda":"string corto","labelCompetencia":"string corto","labelMargen":"string corto","labelRegulatorio":"string corto","veredicto":"VIABLE|VIABLE CON CONDICIONES|NO RECOMENDADO","veredictoTexto":"2-3 oraciones directas en espa&#241;ol rioplatense","analisisCompleto":"an&#225;lisis detallado de los 4 factores, riesgos principales y pr&#243;ximos pasos. Consider&#225; el ROI anualizado y el breakeven. M&#225;x 350 palabras. Rioplatense, directo."}`;
    const res=await fetch('/api/market',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({step:'final',prompt})});
    const r=await res.json();
    if(!res.ok) throw new Error(r.error||'Error en an&#225;lisis final');
    renderMRResult(r);
  }catch(e){
        try{ if(typeof window.__v9fallback==='function'){ window.__v9fallback(); } }catch(_e){}
        var _at=document.getElementById('mrAnalysisText');
        if(_at){ _at.innerHTML='<div class="v9-note"><b><svg class="ic" aria-hidden="true"><use href="#i-bulb"></use></svg> An\u00e1lisis inteligente no disponible ahora.</b> Igual calculo tu veredicto con los n\u00fameros reales que cargaste (arriba). El detalle ampliado con IA no carg\u00f3 esta vez \u2014 prob\u00e1 de nuevo en un momento si quer\u00e9s el texto extendido.</div>'; }
        var _b=document.getElementById('btnMRAnalyze'); if(_b) _b.disabled=false;
      }
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
    {data:trendData,borderColor:'#FFE600',borderWidth:2.5,backgroundColor:'rgba(255,230,0,0.12)',fill:true,tension:0.4,pointRadius:3,pointBackgroundColor:'#FFE600',pointHoverRadius:5,order:1},
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
  ],chartData:{trendData,meliData:[pMin,pProm,pMax],waterfallData:mrData.step4?{fob:mrData.step4.fob,flete:(window.__getFleteUSDPerUnit?window.__getFleteUSDPerUnit(mrData.step4.fob):mrData.step4.fob*0.15),aranceles:mrData.step4.fob*(window.__getArancelRate?window.__getArancelRate():0.35),despacho:mrData.step4.fob*0.08,comision:mrData.step4.venta*0.15}:null}});
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
  const arancelesARS=step4.arancelesARS!=null?step4.arancelesARS:(step4.fob*(window.__getArancelRate?window.__getArancelRate():0.35)*tc);
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
    {label:'  Aranceles '+(((window.__getArancelRate?window.__getArancelRate():0.35)*100).toFixed(0))+'% s/CIF',val:-arancelesARS,type:'sub',show:true},
    {label:'  Despacho 8% s/CIF',val:-despachoARS,type:'sub',show:true},
    {label:'  Empaque',val:-empaqueARS,type:'sub',show:empaqueARS>0},
    {label:'Comisi&#243;n MeLi',val:-comisionARS,type:'neg',show:true},
    {label:'IVA 21%',val:-ivaARS,type:'neg',show:ivaARS>0},
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
  var NICHO_TO_RATE = {tecnologia:0.16, hogar:0.20, deportes:0.20, moda:0.35, mascotas:0.18, bebe:0.20};
  window.__getArancelRate = function(){
    try {
      var sel = document.getElementById('mrNCM');
      if (sel && sel.value && sel.value !== 'auto') return parseFloat(sel.value);
      try { var s = localStorage.getItem('pf_nicho'); if (s && NICHO_TO_RATE[s] != null) return NICHO_TO_RATE[s]; } catch(e){}
      return 0.35;
    } catch(e){ return 0.35; }
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
      badge.textContent=icon+' '+v.txt;
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
/* ===== v5 Freemium gate (additive) ===== */
(function(){
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
    var score=Math.max(0,Math.min(100,s4.scoreReponderado||0));
    try{
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
      var s=Math.max(0,Math.min(100,sc||0));
      var tier=s>=65?'verde':s>=40?'amarillo':'rojo';
      var col=tier==='verde'?'#27ae60':tier==='amarillo'?'#FFE600':'#c0392b';
      var fc=document.getElementById('fc'+n); if(fc) fc.className='mfc '+tier;
      var fcs=document.getElementById('fcs'+n); if(fcs){ fcs.textContent=s+'/100'; fcs.className='mfc-score '+tier; }
      var fcb=document.getElementById('fcb'+n); if(fcb){ fcb.style.width=s+'%'; fcb.style.background=col; }
      var fcl=document.getElementById('fcl'+n); if(fcl&&label) fcl.textContent=label;
      if(fcl&&!fcl.parentElement.querySelector('.v9-factor-why')){ var w=document.createElement('div'); w.className='v9-factor-why'; w.textContent=why; fcl.parentElement.appendChild(w); }
    }
    setF(1,s4.scD,'Score de demanda','Mide si la gente busca y compra este producto en Argentina.');
    setF(2,s4.scC,'Competencia estimada','Mide cu\u00e1nta competencia hay vendiendo lo mismo. Menos competencia, mejor.');
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
    var s4=md.step4, margenPct=s4.margenPct, prod=md.product||'Producto', score=s4.scoreReponderado||0;
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
    var entry={ prod: md.product||'Producto', score: s4.scoreReponderado||0, margenPct: s4.margenPct, margenARS: Math.round(s4.margenARS||0), venta: s4.venta, ts: Date.now() };
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
    var bal=document.getElementById('mcBalloon'), tab=document.getElementById('mcBlTab'), cb=document.getElementById('mcBlClose'), dm=false;
    try{ dm = localStorage.getItem('mc_promo_closed')==='1'; }catch(e){}
    function op(){ if(tab) tab.style.display='none'; if(bal){ bal.style.display='block'; setTimeout(function(){ bal.classList.add('show'); },30);} }
    function cl(){ if(bal) bal.classList.remove('show'); setTimeout(function(){ if(bal) bal.style.display='none'; if(tab) tab.style.display='flex'; },400); try{ localStorage.setItem('mc_promo_closed','1'); }catch(e){} }
    if(cb) cb.addEventListener('click', cl);
    if(tab) tab.addEventListener('click', function(){ try{ localStorage.removeItem('mc_promo_closed'); }catch(e){} op(); });
    if(dm){ if(bal) bal.style.display='none'; if(tab) tab.style.display='flex'; } else { setTimeout(op, 1400); }
  })();

/* ---- bloque 20 ---- */
function goHome(){
  try{ if(typeof showMenu==='function'){ showMenu(); } else { showScreen('menuScreen'); } }catch(e){}
  try{ window.scrollTo({top:0,behavior:'smooth'}); }catch(e){ window.scrollTo(0,0); }
}
(function(){ if(location.hash==='#menu'){ setTimeout(function(){ try{ var m=document.querySelector('.mc-menu'); if(m) m.classList.add('show'); }catch(e){} }, 300); } })();
