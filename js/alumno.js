import { obtenerBackend } from './backend.js';
import { Lienzo } from './lienzo.js';

const $ = (s) => document.querySelector(s);
const CLAVE = 'trazos-alumno';
const COLORES = ['#222222', '#e63946', '#ff8c1a', '#ffd23f', '#38b000', '#1e88e5', '#8e44ad', '#ff70a6', '#8b5a2b'];
const GROSORES = [5, 12, 26];
const MENSAJES = {
  CODIGO_NO_VALIDO: 'Ese código no existe o la clase ya ha terminado.',
  NOMBRE_VACIO: 'Escribe tu nombre.',
};

const be = await obtenerBackend();
if (be.modo === 'demo') $('#aviso-demo').hidden = false;
// En demo cada pestaña es un alumno distinto; en clase, cada dispositivo recuerda a su alumno
const almacen = be.modo === 'demo' ? sessionStorage : localStorage;

const lienzo = new Lienzo($('#lienzo'));
let cred = leerCred();
let ronda = null;
let enviado = false;
let editando = false; // ha pulsado "Quiero cambiarlo"
let versionEnviada = -1;
let enviando = false;
let desfase = 0;
let desuscribir = null;
let temporizadores = [];

// ── Utilidades ────────────────────────────────────────────────
function mostrar(id) {
  for (const v of document.querySelectorAll('.vista')) v.hidden = v.id !== id;
  if (id === 'v-dibujar') ajustarLienzo();
}
let tToast;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(tToast);
  tToast = setTimeout(() => (t.hidden = true), 2600);
}
function leerCred() {
  try { return JSON.parse(almacen.getItem(CLAVE)); } catch { return null; }
}
const claveTrazos = () => `trazos-dibujo-${ronda?.id}`;

// ── Lienzo y herramientas ─────────────────────────────────────
const zona = $('#zona-lienzo');
function ajustarLienzo() {
  const r = zona.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const s = Math.min(r.width / 1200, r.height / 900);
  $('#lienzo').style.width = Math.floor(1200 * s) + 'px';
  $('#lienzo').style.height = Math.floor(900 * s) + 'px';
}
new ResizeObserver(ajustarLienzo).observe(zona);

function seleccionar(grupo, boton) {
  for (const b of grupo.querySelectorAll('button')) b.classList.toggle('activo', b === boton);
}
for (const c of COLORES) {
  const b = document.createElement('button');
  b.className = 'color' + (c === lienzo.color ? ' activo' : '');
  b.style.background = c;
  b.setAttribute('aria-label', 'Color ' + c);
  b.onclick = () => {
    lienzo.color = c;
    lienzo.goma = false;
    $('#b-goma').classList.remove('activo');
    seleccionar($('#colores'), b);
  };
  $('#colores').append(b);
}
for (const g of GROSORES) {
  const b = document.createElement('button');
  b.className = 'herr' + (g === lienzo.grosor ? ' activo' : '');
  b.setAttribute('aria-label', 'Grosor ' + g);
  const p = document.createElement('span');
  p.className = 'punto';
  const d = Math.max(6, Math.round(g * 0.9));
  p.style.width = p.style.height = d + 'px';
  b.append(p);
  b.onclick = () => {
    lienzo.grosor = g;
    seleccionar($('#grosores'), b);
  };
  $('#grosores').append(b);
}
$('#b-goma').onclick = () => {
  lienzo.goma = !lienzo.goma;
  $('#b-goma').classList.toggle('activo', lienzo.goma);
};
$('#b-deshacer').onclick = () => lienzo.deshacer();
$('#b-borrar').onclick = () => { if (!lienzo.vacio()) $('#m-borrar').hidden = false; };
$('#b-borrar-no').onclick = () => ($('#m-borrar').hidden = true);
$('#b-borrar-si').onclick = () => {
  $('#m-borrar').hidden = true;
  lienzo.limpiar();
};
lienzo.onCambio = () => {
  if (ronda) try { almacen.setItem(claveTrazos(), lienzo.exportar()); } catch {}
};

// ── Entrar ────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
if (params.get('c')) $('#i-codigo').value = params.get('c').replace(/\D/g, '').slice(0, 4);
if (params.get('n')) $('#i-nombre').value = params.get('n');
$('#i-codigo').addEventListener('input', (e) => (e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4)));

$('#f-unirse').addEventListener('submit', async (e) => {
  e.preventDefault();
  const codigo = $('#i-codigo').value.trim();
  const nombre = $('#i-nombre').value.trim();
  if (codigo.length !== 4) return ($('#e-unirse').textContent = 'El código tiene 4 números.');
  if (!nombre) return ($('#e-unirse').textContent = MENSAJES.NOMBRE_VACIO);
  $('#e-unirse').textContent = '';
  $('#b-entrar').disabled = true;
  try {
    cred = await be.unirse(codigo, nombre);
    almacen.setItem(CLAVE, JSON.stringify(cred));
    history.replaceState(null, '', location.pathname);
    arrancar();
  } catch (err) {
    const k = Object.keys(MENSAJES).find((k) => String(err.message).includes(k));
    $('#e-unirse').textContent = k ? MENSAJES[k] : 'No se ha podido entrar. Revisa la conexión.';
  } finally {
    $('#b-entrar').disabled = false;
  }
});

// ── Ciclo de vida ─────────────────────────────────────────────
function arrancar() {
  for (const el of document.querySelectorAll('.t-nombre')) el.textContent = cred.nombre;
  mostrar('v-espera');
  desuscribir = be.escucharCambios(cred.sesion_id, refrescar);
  temporizadores.push(setInterval(refrescar, 4000), setInterval(tic, 250));
  refrescar();
}

let refrescando = false, pendiente = false;
async function refrescar() {
  if (refrescando) return void (pendiente = true);
  refrescando = true;
  try {
    aplicar(await be.estado(cred));
  } catch (e) {
    console.warn('Sin conexión', e);
  } finally {
    refrescando = false;
    if (pendiente) { pendiente = false; refrescar(); }
  }
}

function aplicar(s) {
  if (!s || s.estado === 'no_existe' || s.estado === 'cerrada') return fin();
  if (s.ahora) desfase = Date.parse(s.ahora) - Date.now();
  const r = s.ronda;
  if (!r) { ronda = null; return mostrar('v-espera'); }

  if (!ronda || ronda.id !== r.id) {
    // Ronda nueva: lienzo limpio (o lo que tuviera guardado si ha recargado)
    const anterior = ronda;
    ronda = r;
    editando = false;
    versionEnviada = -1;
    if (anterior) try { almacen.removeItem(`trazos-dibujo-${anterior.id}`); } catch {}
    const guardado = almacen.getItem(claveTrazos());
    guardado ? lienzo.importar(guardado) : lienzo.limpiar();
    $('#img-enviado').hidden = true;
  }
  ronda = r;
  enviado = s.enviado;

  $('#t-ronda').textContent = 'Ronda ' + r.numero;
  const c = $('#t-consigna');
  c.textContent = r.consigna || '👂 Escucha a la profe';
  c.classList.toggle('escucha', !r.consigna);

  if (!r.abierta) {
    if (enviado) {
      $('#b-cambiar').hidden = true;
      $('#t-enviado-espera').textContent = 'Espera a la siguiente ronda…';
      return mostrar('v-enviado');
    }
    return mostrar('v-cerrada');
  }
  if (enviado && !editando) {
    $('#b-cambiar').hidden = false;
    return mostrar('v-enviado');
  }
  if ($('#v-dibujar').hidden) mostrar('v-dibujar');
}

function tic() {
  const el = $('#t-cuenta');
  if (!ronda?.abierta || !ronda.termina_en) return void (el.hidden = true);
  const resto = Date.parse(ronda.termina_en) - (Date.now() + desfase);
  const seg = Math.max(0, Math.ceil(resto / 1000));
  el.hidden = false;
  el.textContent = `⏱ ${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
  el.classList.toggle('urgente', seg <= 5);
  // Se acabó el tiempo: se envía solo lo que haya dibujado
  if (resto <= 0 && !enviando && !lienzo.vacio()) {
    const pendienteDeEnviar = !enviado || (editando && lienzo.version !== versionEnviada);
    if (pendienteDeEnviar) enviar(true);
  }
}

async function enviar(automatico = false) {
  if (!ronda) return;
  if (lienzo.vacio()) return automatico || toast('¡Dibuja algo primero!');
  enviando = true;
  const b = $('#b-enviar');
  b.disabled = true;
  b.textContent = 'Enviando…';
  try {
    const blob = await lienzo.aBlob();
    await be.enviar(cred, ronda.id, blob);
    enviado = true;
    editando = false;
    versionEnviada = lienzo.version;
    const img = $('#img-enviado');
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(blob);
    img.hidden = false;
    $('#b-cambiar').hidden = !!automatico;
    mostrar('v-enviado');
  } catch (e) {
    if (String(e.message).includes('RONDA_CERRADA')) {
      refrescar();
    } else {
      console.error(e);
      toast('No se ha podido enviar. Prueba otra vez.');
    }
  } finally {
    enviando = false;
    b.disabled = false;
    b.textContent = 'Enviar ✓';
  }
}
$('#b-enviar').onclick = () => enviar(false);
$('#b-cambiar').onclick = () => {
  editando = true;
  mostrar('v-dibujar');
};

function fin() {
  desuscribir?.();
  temporizadores.forEach(clearInterval);
  temporizadores = [];
  if (ronda) try { almacen.removeItem(claveTrazos()); } catch {}
  almacen.removeItem(CLAVE);
  cred = null;
  ronda = null;
  mostrar('v-fin');
}
$('#b-otra').onclick = () => {
  lienzo.limpiar();
  mostrar('v-unirse');
};

// ── Inicio ────────────────────────────────────────────────────
if (cred) {
  arrancar();
} else {
  mostrar('v-unirse');
  if (params.get('auto') && params.get('c') && params.get('n')) $('#f-unirse').requestSubmit();
}
