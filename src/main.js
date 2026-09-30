import { initializeApp, deleteApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, inMemoryPersistence,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  onAuthStateChanged, sendPasswordResetEmail
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit, getDoc
} from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Network } from '@capacitor/network';
import { App as CapApp } from '@capacitor/app';
import { jsPDF } from 'jspdf';
import { firebaseConfig, CORREO_DUENO } from './firebase-config.js';

/* ================= Catálogos ================= */
const SUCURSALES = [
  { c: 'CHV', n: 'Chavinda', dir: 'Allende #73', tel: '351 128 5940' },
  { c: 'STG', n: 'Santiago Tangamandapio', dir: 'Matamoros #212', tel: '351 225 2220' },
  { c: 'CNT', n: 'La Cantera', dir: 'Juárez esq. Matamoros #415', tel: '351 122 0733' },
  { c: 'TRC', n: 'Tarecuato', dir: 'Emiliano Zapata y Juárez #9', tel: '315 110 29882' },
  { c: 'ZAM', n: 'Zamora', dir: 'Juárez #22 Ote.', tel: '351 404 0605' }
];
const PROVEEDORES = [
  { c: 'VEN', n: 'Vento' }, { c: 'ITK', n: 'Itálica' }, { c: 'VEL', n: 'Veloci' }, { c: 'BDS', n: 'BDS' },
  { c: 'MBM', n: 'MB Motos' }, { c: 'SAY', n: 'Sayto' }, { c: 'MYE', n: 'Motos y Equipos' },
  { c: 'REF', n: 'Refacom' }, { c: 'MLI', n: 'Mercado Libre' }, { c: 'OTR', n: 'Otro' }
];
const MARCAS = ['Vento', 'Itálica', 'Veloci', 'BDS', 'Honda', 'Yamaha', 'Suzuki', 'Bajaj', 'Dinamo', 'Carabela', 'TVS'];
const ESTATUS = [
  { k: 'por_encargar', n: 'Por encargar' },
  { k: 'transito', n: 'En tránsito' },
  { k: 'retrasado', n: 'Retrasado' },
  { k: 'no_hubo', n: 'No lo hubo' },
  { k: 'llego', n: 'Llegó a sucursal' },
  { k: 'entregado', n: 'Entregado al cliente' }
];
const ROLES = [
  { k: 'sucursal', n: 'Colaborador de sucursal' },
  { k: 'coordinador', n: 'Coordinador (ve todo)' },
  { k: 'admin', n: 'Administrador' }
];
const ACTIVOS = ['por_encargar', 'transito', 'retrasado', 'llego'];
const DIAS_ALERTA = 7;
const NATIVO = Capacitor.isNativePlatform();

/* ================= Utilidades ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sucN = c => SUCURSALES.find(s => s.c === c)?.n || c || '';
const provN = c => PROVEEDORES.find(p => p.c === c)?.n || c || '';
const estN = k => ESTATUS.find(e => e.k === k)?.n || k;
const rolN = k => ROLES.find(r => r.k === k)?.n || k;
const hayTotal = o => o.total !== null && o.total !== undefined && o.total !== '';
const money = n => (n === null || n === undefined || n === '') ? '—' : '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 });
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtFecha = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${+d} ${MESES[+m - 1]} ${y}`; };
const fmtTs = t => { const d = new Date(t); return `${d.getDate()} ${MESES[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const dias = o => Math.max(0, Math.floor((Date.now() - (o.creado || Date.now())) / 86400000));
const telDigits = t => String(t || '').replace(/\D/g, '');
const fmtTel = d => d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d;
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3000); }

/* ================= Firebase ================= */
const configurado = !!(firebaseConfig.apiKey && firebaseConfig.projectId);
let app, auth, db;
if (configurado) {
  app = initializeApp(firebaseConfig);
  auth = initializeAuth(app, { persistence: indexedDBLocalPersistence });
  // Caché local: la app funciona sin señal y sube los cambios sola cuando regresa el internet.
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }) });
}

/* ================= Estado ================= */
let me = null;          // usuario de Firebase Auth
let perfil = null;      // documento usuarios/{uid}
let usuarios = {};      // uid -> perfil (para nombres)
let orders = [];
let loaded = false;
let online = true;
let pendientesPedidos = 0;
const fotosSubiendo = new Set();
const fotoCache = {};
const unsubs = [];
let mainMontado = false;
let abrirAlLlegar = null;
let detailId = null;
const F = { suc: 'ALL', est: 'activos', q: '' };

const esAdmin = () => !!perfil && (perfil.rol === 'admin' || me?.email?.toLowerCase() === CORREO_DUENO);
const veTodo = () => esAdmin() || perfil?.rol === 'coordinador';

/* ================= Red y sincronización ================= */
async function initRed() {
  try {
    const s = await Network.getStatus(); online = s.connected;
    Network.addListener('networkStatusChange', st => {
      const antes = online; online = st.connected; renderSync();
      if (!antes && online) toast('Regresó la señal. Subiendo pedidos…');
    });
  } catch (e) {
    online = navigator.onLine;
    window.addEventListener('online', () => { online = true; renderSync(); });
    window.addEventListener('offline', () => { online = false; renderSync(); });
  }
}
function renderSync() {
  const el = $('#sync'); if (!el) return;
  const n = pendientesPedidos + fotosSubiendo.size;
  el.className = 'sync' + (!online ? ' off' : n ? ' pend' : '');
  el.innerHTML = `<i></i>${!online ? 'Sin señal' + (n ? ` · ${n} por subir` : '') : n ? `Subiendo ${n}…` : 'Sincronizado'}`;
}
function guardar(promesa, que) {
  if (!online) toast(`${que} en el celular. Se sube cuando haya señal.`);
  return promesa.catch(e => {
    console.error(e);
    toast(e?.code === 'permission-denied' ? 'Tu cuenta no tiene permiso para eso.' : `No se pudo subir: ${que}. Intenta otra vez.`);
  });
}

/* ================= Pantallas de acceso ================= */
function pantallaConfig() {
  $('#app').innerHTML = `<div class="login"><div class="login-top"><b>Salceda Motors</b><span>Pedidos especiales</span></div>
  <div class="login-card"><h1>Falta conectar la base de datos</h1><p class="hint">Esta versión de la app todavía no tiene los datos del proyecto de Firebase. Pide la versión actualizada.</p></div></div>`;
}
function pantallaLogin(msg) {
  mainMontado = false;
  $('#app').innerHTML = `<div class="login">
    <div class="login-top"><b>Salceda Motors</b><span>Pedidos especiales</span></div>
    <form class="login-card" id="lf" novalidate>
      <h1>Entrar</h1>
      <div class="f"><label for="l_mail">Correo</label><input id="l_mail" type="email" autocomplete="username" inputmode="email" value="${esc(store.get('ps_ultimo_correo') || '')}"></div>
      <div class="f"><label for="l_pass">Contraseña</label><input id="l_pass" type="password" autocomplete="current-password"></div>
      <div class="err" id="l_err">${esc(msg || '')}</div>
      <button class="btn btn-accent btn-block" type="submit" id="l_go">Entrar</button>
      <button class="linkbtn" type="button" id="l_olvide">Olvidé mi contraseña</button>
      <button class="linkbtn" type="button" id="l_dueno" hidden>Crear la cuenta del dueño con esta contraseña</button>
      <p class="hint">Tu usuario lo da de alta el administrador. Si no tienes, pídeselo a Maca.</p>
    </form></div>`;
  const mail = $('#l_mail'), pass = $('#l_pass'), err = $('#l_err');
  const esDueno = () => mail.value.trim().toLowerCase() === CORREO_DUENO;
  $('#lf').addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    if (!mail.value.trim() || !pass.value) { err.textContent = 'Escribe tu correo y contraseña.'; return; }
    const b = $('#l_go'); b.disabled = true; b.textContent = 'Entrando…';
    try {
      store.set('ps_ultimo_correo', mail.value.trim());
      await signInWithEmailAndPassword(auth, mail.value.trim(), pass.value);
    } catch (x) {
      b.disabled = false; b.textContent = 'Entrar';
      if (x.code === 'auth/network-request-failed') err.textContent = 'Sin internet. La primera vez que entras necesitas señal.';
      else if (x.code === 'auth/too-many-requests') err.textContent = 'Demasiados intentos. Espera unos minutos.';
      else {
        err.textContent = 'Correo o contraseña incorrectos.';
        if (esDueno()) $('#l_dueno').hidden = false;
      }
    }
  });
  $('#l_olvide').addEventListener('click', async () => {
    const m = mail.value.trim(); if (!m) { err.textContent = 'Escribe tu correo arriba y vuelve a tocar "Olvidé mi contraseña".'; return; }
    try { await sendPasswordResetEmail(auth, m); err.textContent = ''; toast('Te mandamos un correo para cambiar tu contraseña.'); }
    catch (x) { err.textContent = 'No se pudo mandar el correo. Revisa que esté bien escrito.'; }
  });
  $('#l_dueno').addEventListener('click', async () => {
    if (!esDueno()) return;
    if (pass.value.length < 6) { err.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
    try { await createUserWithEmailAndPassword(auth, CORREO_DUENO, pass.value); }
    catch (x) { err.textContent = x.code === 'auth/email-already-in-use' ? 'La cuenta del dueño ya existe. Usa "Olvidé mi contraseña".' : 'No se pudo crear la cuenta.'; }
  });
}
function pantallaSinAcceso(txt) {
  mainMontado = false;
  $('#app').innerHTML = `<div class="login"><div class="login-top"><b>Salceda Motors</b><span>Pedidos especiales</span></div>
  <div class="login-card"><h1>Sin acceso</h1><p>${esc(txt)}</p><p class="hint">${esc(me?.email || '')}</p>
  <button class="btn btn-line" id="sa_out" type="button">Cerrar sesión</button></div></div>`;
  $('#sa_out').onclick = () => salir();
}
function limpiarSesion() { while (unsubs.length) { try { unsubs.pop()(); } catch (e) { } } orders = []; usuarios = {}; perfil = null; loaded = false; }
async function salir() { limpiarSesion(); closeSheet(); await signOut(auth); }

/* ================= Sesión ================= */
function iniciarSesion(u) {
  limpiarSesion();
  me = u;
  let creandoDueno = false;
  unsubs.push(onSnapshot(doc(db, 'usuarios', u.uid), snap => {
    if (!snap.exists()) {
      if (u.email?.toLowerCase() === CORREO_DUENO && !creandoDueno) {
        creandoDueno = true;
        setDoc(doc(db, 'usuarios', u.uid), { nombre: 'Maca', correo: u.email, rol: 'admin', sucursal: 'CHV', activo: true, creado: Date.now() })
          .catch(() => pantallaSinAcceso('No se pudo crear tu perfil. Revisa que las reglas de Firebase estén publicadas.'));
        return;
      }
      if (snap.metadata.fromCache) return; // esperar respuesta del servidor
      pantallaSinAcceso('Tu cuenta todavía no está dada de alta en la app. Pídele al administrador que te agregue.');
      return;
    }
    perfil = snap.data();
    if (perfil.activo === false) { pantallaSinAcceso('Tu acceso está desactivado. Habla con el administrador.'); return; }
    if (!mainMontado) montarMain(); else render();
  }, err => pantallaSinAcceso('No se pudo leer tu perfil. Revisa tu internet e intenta de nuevo.')));
}

function montarMain() {
  mainMontado = true;
  if (!veTodo() && perfil.sucursal) F.suc = store.get('ps_filtro_suc') || perfil.sucursal; else F.suc = store.get('ps_filtro_suc') || 'ALL';
  $('#app').innerHTML = `
  <header class="top"><div class="top-in">
    <div class="brand"><b>Salceda Motors</b><span>Pedidos especiales</span></div>
    <span class="sync" id="sync"></span>
    <button class="menu-btn" id="btnMenu" type="button">${esc((perfil.nombre || 'Menú').split(' ')[0])} ▾</button>
  </div></header>
  <main class="wrap">
    <div class="row-scroll" id="fSuc" role="group" aria-label="Sucursal"></div>
    <div class="summary" id="summary"></div>
    <div class="search"><input id="q" type="search" placeholder="Buscar cliente, folio, pieza o número de parte" autocomplete="off"></div>
    <p class="section-t" id="listTitle"></p>
    <section id="list" class="list"></section>
  </main>
  <button class="btn btn-accent fab" id="btnNuevo" type="button">+ Nuevo pedido</button>`;
  $('#q').addEventListener('input', e => { F.q = e.target.value; render(); });
  $('#btnNuevo').addEventListener('click', () => openForm());
  $('#btnMenu').addEventListener('click', openMenu);
  renderSync();

  unsubs.push(onSnapshot(query(collection(db, 'pedidos'), orderBy('creado', 'desc'), limit(3000)), { includeMetadataChanges: true }, snap => {
    orders = snap.docs.map(d => Object.assign({ id: d.id, _pend: d.metadata.hasPendingWrites }, d.data()));
    pendientesPedidos = orders.filter(o => o._pend).length;
    loaded = true; render(); renderSync();
    if (abrirAlLlegar && orders.find(o => o.id === abrirAlLlegar)) { const id = abrirAlLlegar; abrirAlLlegar = null; openDetail(id); }
    else if (detailId && !$('#sheet').hidden && sheetEs('detalle') && !$('#d_delOk')) refrescarDetalle();
  }, err => { toast('No se pudieron leer los pedidos.'); console.error(err); }));

  unsubs.push(onSnapshot(collection(db, 'usuarios'), snap => {
    usuarios = {}; snap.docs.forEach(d => usuarios[d.id] = d.data());
    if (sheetEs('usuarios')) openUsuarios();
  }, () => { }));
}

/* ================= Lista ================= */
function countSuc(c) { return orders.filter(o => (c === 'ALL' || o.sucursal === c) && ACTIVOS.includes(o.estatus)).length; }
function render() {
  if (!mainMontado) return;
  const sucs = [{ c: 'ALL', n: 'Todas' }].concat(SUCURSALES);
  $('#fSuc').innerHTML = sucs.map(s => `<button type="button" class="chip" data-suc="${s.c}" aria-pressed="${F.suc === s.c}">${esc(s.n)}<span class="n">${countSuc(s.c)}</span></button>`).join('');
  const base = orders.filter(o => F.suc === 'ALL' || o.sucursal === F.suc);
  let html = `<button type="button" class="stat" data-est="activos" aria-pressed="${F.est === 'activos'}"><span class="k">Activos</span><span class="v">${base.filter(o => ACTIVOS.includes(o.estatus)).length}</span></button>`;
  html += ESTATUS.map(e => `<button type="button" class="stat" data-est="${e.k}" aria-pressed="${F.est === e.k}"><span class="k"><i class="dot d-${e.k}"></i>${e.n}</span><span class="v">${base.filter(o => o.estatus === e.k).length}</span></button>`).join('');
  html += `<button type="button" class="stat" data-est="todos" aria-pressed="${F.est === 'todos'}"><span class="k">Todos</span><span class="v">${base.length}</span></button>`;
  $('#summary').innerHTML = html;

  const q = F.q.trim().toLowerCase();
  let rows = base.filter(o => F.est === 'todos' ? true : F.est === 'activos' ? ACTIVOS.includes(o.estatus) : o.estatus === F.est);
  if (q) rows = rows.filter(o => [o.folio, o.nota, o.cliente, o.telefono, o.descripcion, o.parte, o.marca, provN(o.proveedor)].join(' ').toLowerCase().includes(q));
  const t = F.est === 'activos' ? 'Pedidos activos' : F.est === 'todos' ? 'Todos los pedidos' : estN(F.est);
  $('#listTitle').textContent = `${t}${F.suc !== 'ALL' ? ' · ' + sucN(F.suc) : ''} · ${rows.length}`;
  const list = $('#list');
  if (!loaded) list.innerHTML = emptyBox('Cargando pedidos…', 'Trayendo los pedidos de las cinco sucursales.');
  else if (!orders.length) list.innerHTML = emptyBox('Aún no hay pedidos', 'Cuando una sucursal levante un pedido especial aparecerá aquí con la foto de la nota y su estatus. Toca "Nuevo pedido" para capturar el primero.');
  else if (!rows.length) list.innerHTML = emptyBox('Nada por aquí', 'No hay pedidos con estos filtros. Cambia de sucursal o de estatus.');
  else list.innerHTML = rows.map(card).join('');
}
function emptyBox(t, p) { return `<div class="empty"><h2>${esc(t)}</h2><p>${esc(p)}</p></div>`; }
function card(o) {
  const d = dias(o); const warn = ACTIVOS.includes(o.estatus) && o.estatus !== 'llego' && d >= DIAS_ALERTA;
  return `<button type="button" class="card" data-id="${esc(o.id)}">
    <div class="card-h"><div><div class="folio">${esc(o.folio)}</div><div class="suc">${esc(sucN(o.sucursal))}</div></div>
    <span class="pill st-${esc(o.estatus)}"><i class="dot d-${esc(o.estatus)}"></i>${esc(estN(o.estatus))}</span></div>
    <div class="desc">${o.cantidad ? esc(o.cantidad) + ' × ' : ''}${esc(o.descripcion)}</div>
    <div class="meta"><span><b>${esc(o.cliente)}</b></span><span>${esc(provN(o.proveedor))}${o.marca ? ' · ' + esc(o.marca) : ''}</span>${o.parte ? `<span>No. parte ${esc(o.parte)}</span>` : ''}</div>
    <div class="meta" style="justify-content:space-between;width:100%"><span>Anticipo <b>${money(o.anticipo)}</b></span>
      <span>${o._pend ? '<span class="upl">Por subir · </span>' : ''}<span class="age${warn ? ' warn' : ''}">${d === 0 ? 'hoy' : d === 1 ? 'hace 1 día' : 'hace ' + d + ' días'}</span></span></div>
  </button>`;
}
document.addEventListener('click', e => {
  const s = e.target.closest('[data-suc]'); if (s) { F.suc = s.dataset.suc; store.set('ps_filtro_suc', F.suc); render(); return; }
  const st = e.target.closest('[data-est]'); if (st) { F.est = st.dataset.est; render(); return; }
  const c = e.target.closest('.card[data-id]'); if (c) { openDetail(c.dataset.id); return; }
});

/* ================= Hoja lateral ================= */
const sheet = () => $('#sheet');
function openSheet(tipo, html) {
  const s = sheet(); s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" data-tipo="${tipo}">${html}</div>`; s.hidden = false; document.body.style.overflow = 'hidden';
}
function sheetEs(tipo) { return !sheet().hidden && sheet().querySelector('.sheet')?.dataset.tipo === tipo; }
function closeSheet() { const s = sheet(); s.hidden = true; s.innerHTML = ''; document.body.style.overflow = ''; detailId = null; }
document.addEventListener('click', e => { if (e.target === sheet() || e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet().hidden) closeSheet(); });
// Botón "atrás" de Android: cierra la hoja abierta; en la lista, sale de la app
if (NATIVO) CapApp.addListener('backButton', () => { if (!sheet().hidden) closeSheet(); else CapApp.minimizeApp().catch(() => CapApp.exitApp()); });

/* ================= Menú ================= */
function openMenu() {
  openSheet('menu', `
  <div class="sheet-h"><h2>${esc(perfil.nombre || 'Mi cuenta')}</h2><button class="x" type="button" data-close aria-label="Cerrar">×</button></div>
  <div class="sheet-b">
    <dl class="kv"><dt>Correo</dt><dd>${esc(me.email)}</dd><dt>Sucursal</dt><dd>${esc(sucN(perfil.sucursal))}</dd><dt>Rol</dt><dd>${esc(rolN(perfil.rol))}</dd></dl>
    ${esAdmin() ? '<button class="btn btn-ghost btn-block" type="button" id="m_users">Colaboradores y accesos</button>' : ''}
    <button class="btn btn-line btn-block" type="button" id="m_pass">Cambiar mi contraseña</button>
    <button class="btn btn-line btn-block danger" type="button" id="m_out">Cerrar sesión</button>
    <p class="hint">Los pedidos se guardan en el celular aunque no haya señal y se suben solos cuando regresa el internet. Si cierras sesión con pedidos sin subir, se pueden perder.</p>
  </div>`);
  $('#m_users')?.addEventListener('click', openUsuarios);
  $('#m_pass').addEventListener('click', async () => { try { await sendPasswordResetEmail(auth, me.email); toast('Te mandamos un correo para cambiar la contraseña.'); } catch (e) { toast('Necesitas señal para esto.'); } });
  $('#m_out').addEventListener('click', () => {
    const n = pendientesPedidos + fotosSubiendo.size;
    if (n && !confirmarSalida) { confirmarSalida = true; toast(`Tienes ${n} cambios sin subir. Toca otra vez para salir de todos modos.`); setTimeout(() => confirmarSalida = false, 4000); return; }
    salir();
  });
}
let confirmarSalida = false;

/* ================= Colaboradores (solo admin) ================= */
function opt(list, val, ph, key = 'c', name = 'n') { return (ph ? `<option value="">${ph}</option>` : '') + list.map(x => `<option value="${x[key]}"${x[key] === val ? ' selected' : ''}>${esc(x[name])}</option>`).join(''); }
function openUsuarios() {
  const lista = Object.entries(usuarios).sort((a, b) => (a[1].nombre || '').localeCompare(b[1].nombre || ''));
  openSheet('usuarios', `
  <div class="sheet-h"><h2>Colaboradores</h2><button class="x" type="button" data-close aria-label="Cerrar">×</button></div>
  <div class="sheet-b">
    <button class="btn btn-accent" type="button" id="u_add">+ Agregar colaborador</button>
    <div class="box">${lista.map(([id, u]) => `<div class="urow"><div><b>${esc(u.nombre)}</b><small>${esc(u.correo)} · ${esc(sucN(u.sucursal))} · ${esc(rolN(u.rol))}</small></div>
      <div style="display:flex;gap:6px;align-items:center">${u.activo === false ? '<span class="tag off">Sin acceso</span>' : ''}<button class="btn btn-line" type="button" data-uedit="${esc(id)}" style="padding:6px 12px">Editar</button></div></div>`).join('') || '<p class="hint">Todavía no hay colaboradores.</p>'}</div>
  </div>`);
  $('#u_add').onclick = () => formUsuario();
  sheet().querySelectorAll('[data-uedit]').forEach(b => b.onclick = () => formUsuario(b.dataset.uedit));
}
function formUsuario(uid) {
  const u = uid ? usuarios[uid] : null;
  openSheet('usuario', `
  <div class="sheet-h"><h2>${u ? 'Editar colaborador' : 'Nuevo colaborador'}</h2><button class="x" type="button" data-close aria-label="Cerrar">×</button></div>
  <form class="sheet-b" id="uf" novalidate>
    <div class="f"><label for="u_nom">Nombre</label><input id="u_nom" value="${esc(u?.nombre || '')}"></div>
    ${u ? `<div class="f"><label>Correo</label><input value="${esc(u.correo)}" disabled></div>` : `
    <div class="f"><label for="u_mail">Correo</label><input id="u_mail" type="email" inputmode="email" autocomplete="off"></div>
    <div class="f"><label for="u_pass">Contraseña inicial <i>(mínimo 6, se la das al colaborador)</i></label><input id="u_pass" type="text" autocomplete="off"></div>`}
    <div class="grid2">
      <div class="f"><label for="u_suc">Sucursal</label><select id="u_suc">${opt(SUCURSALES, u?.sucursal || '', 'Elige sucursal')}</select></div>
      <div class="f"><label for="u_rol">Rol</label><select id="u_rol">${opt(ROLES, u?.rol || 'sucursal', '', 'k', 'n')}</select></div>
    </div>
    ${u ? `<label style="display:flex;gap:10px;align-items:center;font-weight:600"><input type="checkbox" id="u_act" ${u.activo !== false ? 'checked' : ''} style="width:20px;height:20px"> Tiene acceso a la app</label>` : ''}
    <p class="hint"><b>Colaborador de sucursal:</b> levanta pedidos de su tienda y cambia estatus. <b>Coordinador:</b> igual, pero para todas las sucursales (Marco). <b>Administrador:</b> además da de alta colaboradores y borra pedidos.</p>
    <div class="err" id="u_err"></div>
    <div class="form-foot"><button class="btn btn-line" type="button" id="u_back">Volver</button><button class="btn btn-accent" type="submit" id="u_save">${u ? 'Guardar' : 'Dar de alta'}</button></div>
  </form>`);
  $('#u_back').onclick = openUsuarios;
  $('#uf').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#u_err'); err.textContent = '';
    const nombre = $('#u_nom').value.trim(), sucursal = $('#u_suc').value, rol = $('#u_rol').value;
    if (!nombre) { err.textContent = 'Escribe el nombre.'; return; }
    if (!sucursal) { err.textContent = 'Elige la sucursal.'; return; }
    const b = $('#u_save'); b.disabled = true;
    if (u) {
      guardar(updateDoc(doc(db, 'usuarios', uid), { nombre, sucursal, rol, activo: $('#u_act').checked }), 'Colaborador');
      toast('Colaborador actualizado'); openUsuarios(); return;
    }
    const correo = $('#u_mail').value.trim().toLowerCase(), pass = $('#u_pass').value;
    if (!/^\S+@\S+\.\S+$/.test(correo)) { err.textContent = 'Escribe un correo válido.'; b.disabled = false; return; }
    if (pass.length < 6) { err.textContent = 'La contraseña debe tener al menos 6 caracteres.'; b.disabled = false; return; }
    if (!online) { err.textContent = 'Necesitas señal para dar de alta un colaborador.'; b.disabled = false; return; }
    b.textContent = 'Dando de alta…';
    // Se usa una conexión aparte para no cerrar la sesión del administrador.
    const app2 = initializeApp(firebaseConfig, 'alta-' + Date.now());
    try {
      const auth2 = initializeAuth(app2, { persistence: inMemoryPersistence });
      const cred = await createUserWithEmailAndPassword(auth2, correo, pass);
      await setDoc(doc(db, 'usuarios', cred.user.uid), { nombre, correo, sucursal, rol, activo: true, creado: Date.now(), creadoPor: me.uid });
      await signOut(auth2);
      toast(`${nombre} ya puede entrar con ${correo}`); openUsuarios();
    } catch (x) {
      b.disabled = false; b.textContent = 'Dar de alta';
      err.textContent = x.code === 'auth/email-already-in-use' ? 'Ese correo ya tiene cuenta. Si es de un colaborador dado de baja, edítalo desde la lista.'
        : x.code === 'auth/invalid-email' ? 'El correo no es válido.' : 'No se pudo dar de alta. Revisa tu internet.';
    } finally { deleteApp(app2).catch(() => { }); }
  });
}

/* ================= Fotos ================= */
async function blobDeRuta(webPath) { const r = await fetch(webPath); return await r.blob(); }
function compress(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob); const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let max = 1400, q = .72, out = '';
      for (let i = 0; i < 8; i++) {
        const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL('image/jpeg', q);
        if (out.length < 300000) break;
        if (q > .5) q -= .1; else max = Math.round(max * .8);
      }
      out.length < 700000 ? res(out) : rej(new Error('grande'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); };
    img.src = url;
  });
}
async function obtenerFoto(fuente) {
  if (NATIVO) {
    if (fuente === 'camara') {
      const r = await Camera.takePhoto({ quality: 75, targetWidth: 1600, targetHeight: 1600, correctOrientation: true });
      return compress(await blobDeRuta(r.webPath));
    }
    const r = await Camera.chooseFromGallery({ mediaType: 0, limit: 1, allowMultipleSelection: false, quality: 75 });
    const p = r.results?.[0]; if (!p) throw new Error('cancelado');
    return compress(await blobDeRuta(p.webPath));
  }
  // Navegador (pruebas): selector de archivo
  return new Promise((res, rej) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; if (fuente === 'camara') i.capture = 'environment';
    i.onchange = () => i.files[0] ? compress(i.files[0]).then(res, rej) : rej(new Error('cancelado'));
    i.click();
  });
}
async function loadFoto(id) {
  if (fotoCache[id]) return fotoCache[id];
  try { const s = await getDoc(doc(db, 'fotos', id)); if (s.exists()) { fotoCache[id] = s.data().img; return fotoCache[id]; } } catch (e) { }
  return null;
}
function subirFoto(id, img) {
  fotoCache[id] = img; fotosSubiendo.add(id); renderSync();
  return setDoc(doc(db, 'fotos', id), { img, actualizado: Date.now() })
    .then(() => { fotosSubiendo.delete(id); renderSync(); })
    .catch(e => { fotosSubiendo.delete(id); renderSync(); toast('No se pudo subir la foto de la nota.'); console.error(e); });
}

/* ================= Formulario de pedido ================= */
let fotoNueva = null;
function openForm(id) {
  const o = id ? orders.find(x => x.id === id) : null;
  fotoNueva = null;
  const fija = !veTodo();
  const suc = o?.sucursal || (fija ? perfil.sucursal : (store.get('ps_mi_sucursal') || perfil.sucursal || ''));
  openSheet('form', `
  <div class="sheet-h"><h2>${o ? 'Editar pedido' : 'Nuevo pedido'}</h2><button class="x" type="button" data-close aria-label="Cerrar">×</button></div>
  <form class="sheet-b" id="frm" novalidate>
    <fieldset><legend>Nota</legend>
      <div class="grid2">
        <div class="f"><label for="f_suc">Sucursal</label><select id="f_suc" ${fija ? 'disabled' : ''}>${opt(SUCURSALES, suc, 'Elige sucursal')}</select></div>
        <div class="f"><label for="f_nota">No. de nota</label><input id="f_nota" inputmode="numeric" placeholder="0202" value="${esc(o?.nota || '')}"></div>
      </div>
      <div class="f"><label for="f_fecha">Fecha</label><input id="f_fecha" type="date" value="${esc(o?.fecha || today())}"></div>
    </fieldset>
    <fieldset><legend>Foto de la nota</legend>
      <div class="photo-box">
        <img id="f_prev" alt="Foto de la nota" hidden>
        <div class="photo-actions">
          <button class="btn btn-ghost" type="button" id="f_cam">📷 Tomar foto</button>
          <button class="btn btn-line" type="button" id="f_gal">Elegir de galería</button>
        </div>
        <div class="hint" id="f_fotoHint">${o?.tieneFoto ? 'Ya tiene foto. Toma otra solo si quieres reemplazarla.' : 'Tómale foto a la nota escrita a mano; que se lea el número y la descripción.'}</div>
      </div>
    </fieldset>
    <fieldset><legend>Cliente</legend>
      <div class="f"><label for="f_cli">Nombre</label><input id="f_cli" autocomplete="off" autocapitalize="words" value="${esc(o?.cliente || '')}"></div>
      <div class="grid2">
        <div class="f"><label for="f_tel">Teléfono (WhatsApp)</label><input id="f_tel" type="tel" inputmode="tel" placeholder="10 dígitos" value="${esc(o?.telefono || '')}"></div>
        <div class="f"><label for="f_dom">Domicilio <i>(opcional)</i></label><input id="f_dom" value="${esc(o?.domicilio || '')}"></div>
      </div>
    </fieldset>
    <fieldset><legend>Pieza</legend>
      <div class="grid3">
        <div class="f"><label for="f_cant">Cant.</label><input id="f_cant" type="number" min="1" inputmode="numeric" value="${esc(o?.cantidad || 1)}"></div>
        <div class="f"><label for="f_desc">Descripción</label><input id="f_desc" placeholder="Posapié trasero derecho D150 2026" value="${esc(o?.descripcion || '')}"></div>
      </div>
      <div class="f"><label for="f_parte">Número de parte <i>(si lo tienen)</i></label><input id="f_parte" autocapitalize="characters" value="${esc(o?.parte || '')}" style="font-family:var(--f-mono)"></div>
      <div class="grid2">
        <div class="f"><label for="f_prov">Proveedor</label><select id="f_prov">${opt(PROVEEDORES, o?.proveedor || '', 'Elige proveedor')}</select></div>
        <div class="f"><label for="f_marca">Marca de la moto</label><input id="f_marca" list="marcas" value="${esc(o?.marca || '')}"><datalist id="marcas">${MARCAS.map(m => `<option value="${m}">`).join('')}</datalist></div>
      </div>
    </fieldset>
    <fieldset><legend>Dinero</legend>
      <div class="grid2">
        <div class="f"><label for="f_ant">Anticipo (deja)</label><div class="money"><span>$</span><input id="f_ant" type="number" min="0" step="0.01" inputmode="decimal" value="${o?.anticipo ?? ''}"></div></div>
        <div class="f"><label for="f_tot">Precio total <i>(si ya se sabe)</i></label><div class="money"><span>$</span><input id="f_tot" type="number" min="0" step="0.01" inputmode="decimal" value="${o?.total ?? ''}"></div></div>
      </div>
      <div class="f"><label for="f_notas">Notas para Marco <i>(opcional)</i></label><textarea id="f_notas">${esc(o?.notas || '')}</textarea></div>
    </fieldset>
    <div class="err" id="f_err"></div>
    <div class="form-foot"><button class="btn btn-line" type="button" data-close>Cancelar</button><button class="btn btn-accent" type="submit" id="f_save">${o ? 'Guardar cambios' : 'Levantar pedido'}</button></div>
  </form>`);
  if (o?.tieneFoto) loadFoto(o.id).then(src => { if (src && !fotoNueva) { const p = $('#f_prev'); if (p) { p.src = src; p.hidden = false; } } });
  const tomar = async fuente => {
    const h = $('#f_fotoHint');
    try { h.textContent = 'Procesando foto…'; fotoNueva = await obtenerFoto(fuente); const p = $('#f_prev'); p.src = fotoNueva; p.hidden = false; h.textContent = 'Foto lista. Revisa que se lea bien.'; }
    catch (x) { h.textContent = /cancel/i.test(String(x?.message || x)) ? (fotoNueva ? 'Foto lista.' : 'No se tomó la foto.') : 'No se pudo usar la foto. Intenta de nuevo.'; }
  };
  $('#f_cam').onclick = () => tomar('camara');
  $('#f_gal').onclick = () => tomar('galeria');
  $('#frm').addEventListener('submit', e => { e.preventDefault(); saveForm(o); });
}
function formErr(m) { const b = $('#f_err'); b.textContent = m; b.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
function saveForm(o) {
  const v = id => $(id).value.trim();
  const d = {
    sucursal: v('#f_suc'), nota: v('#f_nota').replace(/^no\.?\s*/i, ''), fecha: v('#f_fecha') || today(),
    cliente: v('#f_cli'), telefono: v('#f_tel'), domicilio: v('#f_dom'),
    cantidad: Math.max(1, parseInt(v('#f_cant')) || 1), descripcion: v('#f_desc'), parte: v('#f_parte').toUpperCase(),
    proveedor: v('#f_prov'), marca: v('#f_marca'),
    anticipo: v('#f_ant') === '' ? 0 : Number(v('#f_ant')), total: v('#f_tot') === '' ? null : Number(v('#f_tot')), notas: v('#f_notas')
  };
  if (!d.sucursal) return formErr('Elige la sucursal.');
  if (!d.nota) return formErr('Escribe el número de la nota (el rojo de arriba a la derecha).');
  if (!d.cliente) return formErr('Escribe el nombre del cliente.');
  if (telDigits(d.telefono).length < 10) return formErr('El teléfono debe tener 10 dígitos para poder mandarle WhatsApp.');
  if (!d.descripcion) return formErr('Escribe qué pieza se pide.');
  if (!d.proveedor) return formErr('Elige el proveedor.');
  if (!o && !fotoNueva) return formErr('Falta la foto de la nota. Toca "Tomar foto".');
  d.folio = `${d.sucursal}-${d.proveedor}-${d.nota}`;
  if (orders.find(x => x.folio === d.folio && x.id !== o?.id)) return formErr(`Ya existe un pedido con el folio ${d.folio}. Revisa el número de nota.`);
  store.set('ps_mi_sucursal', d.sucursal);
  d.actualizado = Date.now();
  if (o) {
    if (fotoNueva) { subirFoto(o.id, fotoNueva); d.tieneFoto = true; }
    guardar(updateDoc(doc(db, 'pedidos', o.id), d), 'Cambios guardados');
    if (online) toast('Cambios guardados');
    closeSheet(); openDetail(o.id);
  } else {
    const ref = doc(collection(db, 'pedidos'));
    subirFoto(ref.id, fotoNueva);
    Object.assign(d, { estatus: 'por_encargar', creado: Date.now(), creadoPor: me.uid, tieneFoto: true, historial: [{ e: 'por_encargar', t: Date.now(), u: me.uid }] });
    abrirAlLlegar = ref.id;
    guardar(setDoc(ref, d), 'Pedido guardado');
    if (online) toast('Pedido levantado · ' + d.folio);
    closeSheet();
  }
}

/* ================= Detalle ================= */
function nameOf(uid) { return uid ? (usuarios[uid]?.nombre || 'Colaborador') : '—'; }
function refrescarDetalle() {
  const sc = sheet().querySelector('.sheet')?.scrollTop || 0;
  openDetail(detailId, true);
  const nw = sheet().querySelector('.sheet'); if (nw) nw.scrollTop = sc;
}
function openDetail(id) {
  const o = orders.find(x => x.id === id); if (!o) { toast('Ese pedido ya no existe'); return; }
  detailId = id;
  const resta = hayTotal(o) ? Math.max(0, Number(o.total) - Number(o.anticipo || 0)) : null;
  const hist = (o.historial || []).slice().reverse();
  const tel = telDigits(o.telefono);
  openSheet('detalle', `
  <div class="sheet-h"><h2><span class="folio" style="font-size:17px">${esc(o.folio)}</span></h2>
    <button class="btn btn-line" type="button" id="d_edit">Editar</button>
    <button class="x" type="button" data-close aria-label="Cerrar">×</button></div>
  <div class="sheet-b">
    <div style="display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pill st-${esc(o.estatus)}"><i class="dot d-${esc(o.estatus)}"></i>${esc(estN(o.estatus))}</span>${o._pend ? '<span class="upl">Por subir</span>' : ''}</div>
      <div class="big-desc">${o.cantidad ? esc(o.cantidad) + ' × ' : ''}${esc(o.descripcion)}</div>
      <div class="meta">${esc(sucN(o.sucursal))} · Nota ${esc(o.nota)} · ${esc(fmtFecha(o.fecha))}</div>
    </div>
    <section style="display:flex;flex-direction:column;gap:8px">
      <p class="section-t">Cambiar estatus</p>
      <div class="status-grid">${ESTATUS.map(e => `<button type="button" class="status-btn st-${e.k}" data-set="${e.k}" aria-pressed="${o.estatus === e.k}"><i class="dot d-${e.k}"></i>${e.n}</button>`).join('')}</div>
    </section>
    <dl class="kv">
      <dt>Cliente</dt><dd>${esc(o.cliente)}</dd>
      <dt>Teléfono</dt><dd class="phone">${esc(fmtTel(tel))}</dd>
      ${o.domicilio ? `<dt>Domicilio</dt><dd>${esc(o.domicilio)}</dd>` : ''}
      <dt>Proveedor</dt><dd>${esc(provN(o.proveedor))}</dd>
      ${o.marca ? `<dt>Marca</dt><dd>${esc(o.marca)}</dd>` : ''}
      ${o.parte ? `<dt>No. parte</dt><dd class="phone">${esc(o.parte)}</dd>` : ''}
      ${o.notas ? `<dt>Notas</dt><dd>${esc(o.notas)}</dd>` : ''}
      <dt>Capturó</dt><dd>${esc(nameOf(o.creadoPor))}</dd>
    </dl>
    <div class="money-row">
      <div><small>Anticipo</small><b>${money(o.anticipo)}</b></div>
      <div><small>Total</small><b>${money(o.total)}</b></div>
      <div><small>Resta</small><b>${resta === null ? '—' : money(resta)}</b></div>
    </div>
    <section style="display:flex;flex-direction:column;gap:8px">
      <p class="section-t">Nota escrita</p>
      <div class="photo-box" id="d_foto"><span class="hint">${o.tieneFoto ? 'Cargando foto…' : 'Este pedido no tiene foto.'}</span></div>
    </section>
    <section class="box">
      <p class="section-t">Enviar al cliente por WhatsApp</p>
      <button class="btn btn-wa" type="button" id="d_pdf">Enviar comprobante PDF</button>
      <div class="hint" id="d_pdfHint">Se abre el menú para compartir: elige WhatsApp y el chat de ${esc(o.cliente)} (${esc(fmtTel(tel))}).</div>
      <a class="btn btn-line" href="${waLink(o, 'comprobante')}" target="_blank" rel="noopener">Abrir chat del cliente</a>
      ${o.estatus === 'llego' ? `<a class="btn btn-wa" href="${waLink(o, 'llego')}" target="_blank" rel="noopener">Avisar que ya llegó</a>` : ''}
    </section>
    <section style="display:flex;flex-direction:column;gap:8px">
      <p class="section-t">Historial</p>
      <ul class="hist">${hist.map(h => `<li><time>${esc(fmtTs(h.t))}</time><span><b>${esc(estN(h.e))}</b> · ${esc(nameOf(h.u))}</span></li>`).join('')}</ul>
    </section>
    ${esAdmin() ? '<section id="d_delBox"><button class="btn btn-line danger" type="button" id="d_del">Borrar pedido</button></section>' : ''}
  </div>`);
  const pintarFoto = src => { const b = $('#d_foto'); if (b && detailId === id) b.innerHTML = src ? `<img src="${src}" alt="Nota ${esc(o.nota)}">` : '<span class="hint">La foto todavía no baja. Se verá cuando haya señal.</span>'; };
  if (o.tieneFoto) { if (fotoCache[id]) pintarFoto(fotoCache[id]); else loadFoto(id).then(pintarFoto); }
  $('#d_edit').onclick = () => openForm(id);
  sheet().querySelectorAll('[data-set]').forEach(b => b.onclick = () => setEstatus(o, b.dataset.set));
  $('#d_pdf').onclick = () => enviarPdf(o);
  $('#d_del')?.addEventListener('click', () => {
    $('#d_delBox').innerHTML = `<div class="box"><b>¿Borrar ${esc(o.folio)} para siempre?</b><span class="hint">Se borra también la foto de la nota. Si solo no llegó la pieza, mejor márcalo como "No lo hubo".</span>
    <div class="form-foot" style="justify-content:flex-start"><button class="btn btn-accent" type="button" id="d_delOk">Sí, borrar</button><button class="btn btn-line" type="button" id="d_delNo">Cancelar</button></div></div>`;
    $('#d_delNo').onclick = () => openDetail(id);
    $('#d_delOk').onclick = () => { closeSheet(); guardar(deleteDoc(doc(db, 'pedidos', id)), 'Borrado'); guardar(deleteDoc(doc(db, 'fotos', id)), 'Borrado'); toast('Pedido borrado'); };
  });
}
function setEstatus(o, k) {
  if (o.estatus === k) return;
  const hist = (o.historial || []).concat([{ e: k, t: Date.now(), u: me.uid }]);
  guardar(updateDoc(doc(db, 'pedidos', o.id), { estatus: k, historial: hist, actualizado: Date.now() }), 'Estatus guardado');
  if (online) toast(`${o.folio}: ${estN(k)}`);
}

/* ================= WhatsApp ================= */
function waNum(t) { let d = telDigits(t); if (d.length === 10) d = '52' + d; else if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3); return d; }
function mensaje(o, tipo) {
  const s = sucN(o.sucursal); const pieza = `${o.cantidad || 1} × ${o.descripcion}`;
  if (tipo === 'llego') return `Hola ${o.cliente}, le avisamos de Salceda Motors ${s} que su pedido ${o.folio} (${pieza}) ya llegó a la sucursal. Puede pasar a recogerlo.${hayTotal(o) ? ` Resta por pagar: ${money(Math.max(0, o.total - (o.anticipo || 0)))}.` : ''} ¡Gracias!`;
  return `Hola ${o.cliente}, le compartimos el comprobante de su pedido especial ${o.folio} en Salceda Motors ${s}: ${pieza}. Anticipo: ${money(o.anticipo || 0)}. Le avisamos en cuanto llegue. ¡Gracias por su preferencia!`;
}
function waLink(o, tipo) { return `https://wa.me/${waNum(o.telefono)}?text=${encodeURIComponent(mensaje(o, tipo))}`; }

/* ================= PDF ================= */
async function buildPdf(o) {
  const pdf = new jsPDF({ unit: 'mm', format: 'letter' });
  const W = 215.9, M = 16; const suc = SUCURSALES.find(s => s.c === o.sucursal) || {};
  pdf.setFillColor(42, 49, 56); pdf.rect(0, 0, W, 30, 'F');
  pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20); pdf.text('SALCEDA MOTORS', M, 14);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.text(`Sucursal ${suc.n || ''} · ${suc.dir || ''} · Tel. ${suc.tel || ''}`, M, 21);
  pdf.setFontSize(10); pdf.text('COMPROBANTE DE PEDIDO ESPECIAL', W - M, 12, { align: 'right' });
  pdf.setFont('courier', 'bold'); pdf.setFontSize(15); pdf.setTextColor(239, 90, 68); pdf.text(o.folio || '', W - M, 21, { align: 'right' });
  let y = 42;
  const row = (k, v) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(91, 102, 112); pdf.text(k.toUpperCase(), M, y);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(26, 31, 36);
    const lines = pdf.splitTextToSize(String(v || '—'), W - M * 2 - 42); pdf.text(lines, M + 42, y); y += 6 * lines.length + 1;
  };
  row('Fecha', fmtFecha(o.fecha)); row('No. de nota', o.nota); row('Cliente', o.cliente); row('Teléfono', fmtTel(telDigits(o.telefono)));
  row('Pieza', `${o.cantidad || 1} × ${o.descripcion}`); if (o.parte) row('No. de parte', o.parte); if (o.marca) row('Marca', o.marca);
  row('Estatus', estN(o.estatus));
  y += 2; pdf.setDrawColor(211, 216, 221); pdf.line(M, y, W - M, y); y += 8;
  const bw = (W - M * 2 - 8) / 3;
  const tot = hayTotal(o) ? money(o.total) : 'Por confirmar';
  const resta = hayTotal(o) ? money(Math.max(0, o.total - (o.anticipo || 0))) : 'Por confirmar';
  [['Anticipo', money(o.anticipo || 0)], ['Total', tot], ['Resta', resta]].forEach((b, i) => {
    const x = M + i * (bw + 4); pdf.setFillColor(246, 247, 248); pdf.rect(x, y - 5, bw, 15, 'F');
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(91, 102, 112); pdf.text(b[0].toUpperCase(), x + 3, y);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(26, 31, 36); pdf.text(b[1], x + 3, y + 7);
  });
  y += 18;
  const img = o.tieneFoto ? await loadFoto(o.id) : null;
  if (img) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(91, 102, 112); pdf.text('NOTA DEL PEDIDO', M, y); y += 3;
    const dim = await new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.onerror = () => r([4, 3]); i.src = img; });
    const maxW = W - M * 2, maxH = 279.4 - y - 18; let w = maxW, h = maxW * dim[1] / dim[0]; if (h > maxH) { h = maxH; w = h * dim[0] / dim[1]; }
    pdf.addImage(img, 'JPEG', M + (maxW - w) / 2, y, w, h);
  }
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(91, 102, 112);
  pdf.text('Los tiempos de entrega dependen del proveedor. Le avisaremos por WhatsApp cuando su pedido llegue a sucursal.', W / 2, 272, { align: 'center' });
  return pdf;
}
async function enviarPdf(o) {
  const hint = $('#d_pdfHint'); const b = $('#d_pdf'); b.disabled = true; hint.textContent = 'Armando el PDF…';
  try {
    const pdf = await buildPdf(o);
    const nombre = `Pedido ${o.folio}.pdf`.replace(/[\\/:*?"<>|]/g, '');
    if (NATIVO) {
      const b64 = pdf.output('datauristring').split(',')[1];
      const w = await Filesystem.writeFile({ path: nombre, data: b64, directory: Directory.Cache });
      await Share.share({ title: `Pedido ${o.folio}`, text: mensaje(o, 'comprobante'), files: [w.uri], dialogTitle: 'Enviar comprobante' });
      hint.textContent = 'Listo. Si no lo mandaste, vuelve a tocar el botón.';
    } else { pdf.save(nombre); hint.textContent = 'PDF descargado.'; }
  } catch (e) {
    hint.textContent = /cancel/i.test(String(e?.message || e)) ? 'Envío cancelado.' : 'No se pudo generar el PDF. Revisa que la foto ya haya bajado.';
  } finally { b.disabled = false; }
}

/* ================= Arranque ================= */
(async () => {
  if (!configurado) { pantallaConfig(); return; }
  await initRed();
  $('#app').innerHTML = `<div class="login"><div class="login-top"><b>Salceda Motors</b><span>Pedidos especiales</span></div><div class="login-card"><p class="hint">Cargando…</p></div></div>`;
  onAuthStateChanged(auth, u => { if (u) iniciarSesion(u); else { limpiarSesion(); pantallaLogin(); } });
})();
