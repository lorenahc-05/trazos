import { obtenerBackend } from './backend.js';

const $ = (s) => document.querySelector(s);
const CLAVE_SESION = 'trazos-profe-sesion';
const GRACIA_MS = 4000; // margen para que los envíos automáticos lleguen antes de cerrar
const SEGUNDOS_RECOGER = 5;

const be = await obtenerBackend();
const st = {
  sesion: null,
  rondas: [],
  participantes: new Map(),
  dibujos: new Map(),
  vista: null, // id de la ronda que se ve en la galería
  desfase: 0,
  desuscribir: null,
  cerrando: false,
  tarjetas: new Map(), // id dibujo → elemento
  nuevos: new Set(),
  pendienteInicio: null,
};
const urlAlumnos = () => new URL('index.html', location.href).href;
const urlEntrar = () => `${urlAlumnos()}?c=${st.sesion.codigo}`;

// ── Utilidades ────────────────────────────────────────────────
function mostrar(id) {
  for (const v of document.querySelectorAll('.vista')) v.hidden = v.id !== id;
}
let tToast;
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(tToast);
  tToast = setTimeout(() => (t.hidden = true), ms);
}
function confirmar(titulo, texto, botones) {
  return new Promise((ok) => {
    $('#t-confirmar-titulo').textContent = titulo;
    $('#t-confirmar-texto').textContent = texto;
    const c = $('#c-confirmar-botones');
    c.replaceChildren();
    for (const b of botones) {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.clase || 'btn-sec');
      el.textContent = b.texto;
      el.onclick = () => { $('#m-confirmar').hidden = true; ok(b.valor); };
      c.append(el);
    }
    $('#m-confirmar').hidden = false;
  });
}
const ultimaRonda = () => st.rondas.at(-1) || null;
const rondaAbierta = () => (ultimaRonda()?.abierta ? ultimaRonda() : null);
const dibujosDe = (rid) =>
  [...st.dibujos.values()].filter((d) => d.ronda_id === rid).sort((a, b) => a.creado_en.localeCompare(b.creado_en));
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const ahoraServidor = () => Date.now() + st.desfase;

// ── Arranque ──────────────────────────────────────────────────
if (be.modo === 'demo') {
  $('#aviso-demo').hidden = false;
  $('#b-alumno-prueba').hidden = false;
} else {
  $('#b-salir').hidden = false;
}
$('#t-url-inicio').textContent = urlAlumnos().replace(/index\.html$/, '');

if (await be.usuario()) inicio();
else mostrar('v-login');

$('#f-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#e-login').textContent = '';
  try {
    await be.entrar($('#i-email').value.trim(), $('#i-pass').value);
    inicio();
  } catch {
    $('#e-login').textContent = 'Email o contraseña incorrectos.';
  }
});
$('#b-salir').onclick = async () => { await be.salir(); mostrar('v-login'); };

async function inicio() {
  mostrar('v-inicio');
  $('#b-continuar').hidden = true;
  let s = null;
  const id = localStorage.getItem(CLAVE_SESION);
  if (id) s = await be.obtenerSesion(id).catch(() => null);
  if (!s || s.estado !== 'abierta') s = await be.sesionAbiertaReciente().catch(() => null);
  st.pendienteInicio = s;
  if (s) {
    $('#t-continuar').textContent = '(código ' + s.codigo + ')';
    $('#b-continuar').hidden = false;
  }
}
$('#b-crear').onclick = async () => {
  $('#b-crear').disabled = true;
  try {
    const s = await be.crearSesion();
    await abrirSesion(s);
    abrirCodigo();
  } catch (e) {
    console.error(e);
    toast('No se ha podido crear la sesión.');
  } finally {
    $('#b-crear').disabled = false;
  }
};
$('#b-continuar').onclick = () => st.pendienteInicio && abrirSesion(st.pendienteInicio);

async function abrirSesion(s) {
  st.sesion = s;
  localStorage.setItem(CLAVE_SESION, s.id);
  $('#t-codigo').textContent = s.codigo;
  st.desfase = await be.desfase().catch(() => 0);
  const [rondas, parts, dibs] = await Promise.all([
    be.listarRondas(s.id), be.listarParticipantes(s.id), be.listarDibujos(s.id),
  ]);
  st.rondas = rondas;
  st.participantes = new Map(parts.map((p) => [p.id, p]));
  st.dibujos = new Map(dibs.map((d) => [d.id, d]));
  st.tarjetas.forEach((el) => el.remove());
  st.tarjetas.clear();
  st.vista = ultimaRonda()?.id ?? null;
  st.desuscribir?.();
  st.desuscribir = be.suscribir(s.id, {
    dibujo: (d) => {
      const previo = st.dibujos.get(d.id);
      st.dibujos.set(d.id, d);
      if (!previo || previo.ruta !== d.ruta) st.nuevos.add(d.id);
      render();
    },
    participante: (p) => {
      st.participantes.set(p.id, p);
      render();
    },
  });
  mostrar('v-sesion');
  render();
}

// ── Pintar la pantalla ────────────────────────────────────────
function render() {
  if (!st.sesion) return;
  const abierta = rondaAbierta();
  const nPart = st.participantes.size;
  $('#t-num-part').textContent = nPart;

  // Panel de control
  $('#c-nueva').hidden = !!abierta;
  $('#c-abierta').hidden = !abierta;
  $('#b-lanzar').textContent = `Lanzar ronda ${(ultimaRonda()?.numero || 0) + 1}`;
  if (abierta) {
    const enviados = new Set(dibujosDe(abierta.id).map((d) => d.participante_id));
    $('#t-num-ronda').textContent = abierta.numero;
    $('#t-consigna-profe').textContent = abierta.consigna
      ? `“${abierta.consigna}”${abierta.mostrar_consigna ? '' : ' (solo la ves tú)'}`
      : '(consigna en voz alta)';
    $('#t-progreso').textContent = `${enviados.size} / ${nPart} enviados`;
    const lista = $('#l-estado-alumnos');
    lista.replaceChildren(
      ...[...st.participantes.values()]
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
        .map((p) => {
          const el = document.createElement('span');
          el.className = 'alumno-chip' + (enviados.has(p.id) ? ' ok' : '');
          el.textContent = (enviados.has(p.id) ? '✓ ' : '') + p.nombre;
          return el;
        })
    );
    const recogiendo = abierta.termina_en && Date.parse(abierta.termina_en) - ahoraServidor() <= SEGUNDOS_RECOGER * 1000 + 500;
    $('#b-recoger').disabled = !!recogiendo;
    $('#b-recoger').textContent = recogiendo ? 'Recogiendo…' : 'Recoger dibujos';
  }

  // Pestañas de rondas
  const pest = $('#pestanas');
  pest.replaceChildren(
    ...st.rondas.map((r) => {
      const b = document.createElement('button');
      b.className = 'pestana' + (r.id === st.vista ? ' activa' : '');
      b.textContent = `Ronda ${r.numero} · ${dibujosDe(r.id).length}`;
      b.title = r.consigna || '';
      b.onclick = () => { st.vista = r.id; render(); };
      return b;
    })
  );
  pest.hidden = st.rondas.length < 2;

  // Galería
  const r = st.rondas.find((x) => x.id === st.vista);
  $('#t-galeria').textContent = r ? `Ronda ${r.numero}${r.consigna ? ' · ' + r.consigna : ''}` : 'Dibujos';
  const lista = r ? dibujosDe(r.id) : [];
  const gal = $('#galeria');
  const visibles = new Set(lista.map((d) => d.id));
  for (const [id, el] of st.tarjetas) if (!visibles.has(id)) { el.remove(); st.tarjetas.delete(id); }
  lista.forEach((d, i) => {
    let el = st.tarjetas.get(d.id);
    if (!el) {
      el = document.createElement('button');
      el.className = 'dibujo';
      el.innerHTML = '<img alt=""><span class="nombre"></span>';
      st.tarjetas.set(d.id, el);
    }
    el.onclick = () => abrirVisor(lista, lista.indexOf(d));
    el.querySelector('.nombre').textContent = d.nombre;
    el.querySelector('img').alt = 'Dibujo de ' + d.nombre;
    if (el.dataset.ruta !== d.ruta) {
      el.dataset.ruta = d.ruta;
      be.urlDibujo(d).then((u) => { if (el.dataset.ruta === d.ruta) el.querySelector('img').src = u; });
    }
    if (st.nuevos.has(d.id)) {
      st.nuevos.delete(d.id);
      el.classList.remove('nuevo');
      void el.offsetWidth;
      el.classList.add('nuevo');
    }
    if (gal.children[i] !== el) gal.insertBefore(el, gal.children[i] || null);
  });
  $('#galeria-vacia').hidden = lista.length > 0;
  $('#galeria-vacia').textContent = r
    ? 'Todavía no ha llegado ningún dibujo a esta ronda.'
    : 'Lanza una ronda y aquí irán apareciendo los dibujos.';
  $('#b-zip-ronda').disabled = !lista.length;
  $('#b-zip-todo').disabled = !st.dibujos.size;
}

// ── Rondas ────────────────────────────────────────────────────
$('#b-lanzar').onclick = async () => {
  const b = $('#b-lanzar');
  b.disabled = true;
  try {
    const r = await be.lanzarRonda(st.sesion.id, {
      consigna: $('#i-consigna').value.trim(),
      mostrar: $('#i-mostrar').checked,
      segundos: Number($('#i-tiempo').value),
    });
    st.rondas.forEach((x) => (x.abierta = false));
    st.rondas.push(r);
    st.vista = r.id;
    $('#i-consigna').value = '';
    render();
  } catch (e) {
    console.error(e);
    toast('No se ha podido lanzar la ronda.');
  } finally {
    b.disabled = false;
  }
};
$('#i-consigna').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#b-lanzar').click(); });

$('#b-recoger').onclick = async () => {
  const r = rondaAbierta();
  if (!r) return;
  try {
    Object.assign(r, await be.programarCierre(st.sesion.id, r.id, SEGUNDOS_RECOGER));
    render();
  } catch (e) {
    console.error(e);
    toast('No se ha podido cerrar la ronda.');
  }
};

setInterval(() => {
  const r = rondaAbierta();
  const el = $('#t-cuenta');
  if (!r || !r.termina_en) return void (el.hidden = true);
  const resto = Date.parse(r.termina_en) - ahoraServidor();
  el.hidden = false;
  el.textContent = '⏱ ' + fmt(resto);
  el.classList.toggle('urgente', resto <= 5000);
  if (resto <= SEGUNDOS_RECOGER * 1000 + 500) render(); // actualiza el botón
  if (resto < -GRACIA_MS && !st.cerrando) {
    st.cerrando = true;
    be.cerrarRonda(st.sesion.id, r.id)
      .then(() => { r.abierta = false; render(); toast(`Ronda ${r.numero} cerrada: ${dibujosDe(r.id).length} dibujos.`); })
      .catch((e) => console.error(e))
      .finally(() => (st.cerrando = false));
  }
}, 250);

// ── Dictado por voz ───────────────────────────────────────────
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) {
  $('#b-micro').hidden = true;
  $('#i-idioma').hidden = true;
} else {
  let rec = null;
  $('#b-micro').onclick = () => {
    if (rec) return rec.stop();
    rec = new SR();
    rec.lang = $('#i-idioma').value;
    rec.interimResults = true;
    const base = $('#i-consigna').value ? $('#i-consigna').value.trim() + ' ' : '';
    rec.onresult = (e) => {
      let t = '';
      for (const r of e.results) t += r[0].transcript;
      $('#i-consigna').value = base + t;
    };
    rec.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('No se ha podido usar el micrófono.'); };
    rec.onend = () => { rec = null; $('#b-micro').classList.remove('activo'); };
    rec.start();
    $('#b-micro').classList.add('activo');
  };
}

// ── Código en grande + QR ─────────────────────────────────────
async function abrirCodigo() {
  $('#t-codigo-grande').textContent = st.sesion.codigo;
  $('#t-url').textContent = urlAlumnos().replace(/index\.html$/, '');
  $('#m-codigo').hidden = false;
  const img = $('#img-qr');
  img.hidden = true;
  try {
    const mod = await import('https://esm.sh/qrcode@1.5.4');
    const QR = mod.default || mod;
    img.src = await QR.toDataURL(urlEntrar(), { width: 460, margin: 1 });
    img.hidden = false;
  } catch {
    /* sin conexión al CDN: se queda solo el código */
  }
}
$('#b-codigo').onclick = abrirCodigo;
$('#b-codigo-cerrar').onclick = () => ($('#m-codigo').hidden = true);
$('#b-copiar').onclick = async () => {
  try { await navigator.clipboard.writeText(urlEntrar()); toast('Enlace copiado'); }
  catch { toast(urlEntrar(), 6000); }
};

let nPrueba = 0;
const NOMBRES = ['Lucía', 'Hugo', 'Martina', 'Leo', 'Sofía', 'Mateo', 'Valeria', 'Daniel', 'Julia', 'Álex'];
$('#b-alumno-prueba').onclick = () => {
  const n = NOMBRES[nPrueba++ % NOMBRES.length] + (nPrueba > NOMBRES.length ? ' ' + Math.ceil(nPrueba / NOMBRES.length) : '');
  window.open(`${urlEntrar()}&n=${encodeURIComponent(n)}&auto=1`, '_blank');
};

// ── Participantes ─────────────────────────────────────────────
$('#b-participantes').onclick = () => {
  const ul = $('#l-participantes');
  const ps = [...st.participantes.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  ul.replaceChildren(
    ...(ps.length
      ? ps.map((p) => {
          const li = document.createElement('li');
          const n = [...st.dibujos.values()].filter((d) => d.participante_id === p.id).length;
          li.innerHTML = '<span></span><span class="suave"></span>';
          li.children[0].textContent = p.nombre;
          li.children[1].textContent = `${n} dibujo${n === 1 ? '' : 's'}`;
          return li;
        })
      : [Object.assign(document.createElement('li'), { textContent: 'Todavía no ha entrado nadie.' })])
  );
  $('#m-participantes').hidden = false;
};
$('#b-part-cerrar').onclick = () => ($('#m-participantes').hidden = true);

// ── Visor (para proyectar los dibujos) ────────────────────────
const visor = { lista: [], i: 0 };
async function pintarVisor() {
  const d = visor.lista[visor.i];
  if (!d) return;
  $('#t-visor-nombre').textContent = d.nombre;
  $('#t-visor-contador').textContent = `${visor.i + 1} / ${visor.lista.length}`;
  $('#img-visor').src = await be.urlDibujo(d);
}
function abrirVisor(lista, i) {
  visor.lista = lista;
  visor.i = Math.max(0, i);
  $('#m-visor').hidden = false;
  pintarVisor();
}
function moverVisor(delta) {
  if (!visor.lista.length) return;
  visor.i = (visor.i + delta + visor.lista.length) % visor.lista.length;
  pintarVisor();
}
function cerrarVisor() {
  $('#m-visor').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen();
}
$('#b-visor-prev').onclick = () => moverVisor(-1);
$('#b-visor-next').onclick = () => moverVisor(1);
$('#b-visor-cerrar').onclick = cerrarVisor;
$('#b-visor-full').onclick = () =>
  document.fullscreenElement ? document.exitFullscreen() : $('#m-visor').requestFullscreen?.();
document.addEventListener('keydown', (e) => {
  if ($('#m-visor').hidden) {
    if (e.key === 'Escape') for (const m of document.querySelectorAll('.modal')) if (m.id !== 'm-confirmar') m.hidden = true;
    return;
  }
  if (e.key === 'ArrowLeft') moverVisor(-1);
  if (e.key === 'ArrowRight' || e.key === ' ') moverVisor(1);
  if (e.key === 'Escape') cerrarVisor();
});

// ── Descargas ─────────────────────────────────────────────────
const limpio = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'alumno';
const dos = (n) => String(n).padStart(2, '0');
function bajar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function descargar(dibujos, etiqueta) {
  if (!dibujos.length) return toast('No hay dibujos que descargar.');
  toast('Preparando la descarga…', 60000);
  const rondas = new Map(st.rondas.map((r) => [r.id, r]));
  const usados = new Set();
  const nombreDe = (d) => {
    const r = rondas.get(d.ronda_id);
    const base = `ronda-${dos(r?.numero ?? 0)}/${limpio(d.nombre)}`;
    let n = base, k = 2;
    while (usados.has(n)) n = `${base}-${k++}`;
    usados.add(n);
    return n + '.png';
  };
  try {
    let JSZip = null;
    try { JSZip = (await import('https://esm.sh/jszip@3.10.1')).default; } catch {}
    if (!JSZip) {
      // Sin ZIP disponible: descarga una a una
      for (const d of dibujos) {
        bajar(await be.blobDibujo(d), nombreDe(d).replace('/', '_'));
        await new Promise((r) => setTimeout(r, 350));
      }
      return toast('Descarga terminada.');
    }
    const zip = new JSZip();
    const vistas = new Set();
    for (const d of dibujos) {
      const r = rondas.get(d.ronda_id);
      if (r && !vistas.has(r.id)) {
        vistas.add(r.id);
        zip.file(`ronda-${dos(r.numero)}/consigna.txt`, r.consigna || '(consigna dicha en voz alta)');
      }
      zip.file(nombreDe(d), await be.blobDibujo(d));
    }
    const fecha = new Date().toISOString().slice(0, 10);
    bajar(await zip.generateAsync({ type: 'blob' }), `trazos-${fecha}-${st.sesion.codigo}-${etiqueta}.zip`);
    toast('Descarga terminada.');
  } catch (e) {
    console.error(e);
    toast('No se ha podido descargar.');
  }
}
$('#b-zip-ronda').onclick = () => {
  const r = st.rondas.find((x) => x.id === st.vista);
  if (r) descargar(dibujosDe(r.id), 'ronda-' + dos(r.numero));
};
$('#b-zip-todo').onclick = () =>
  descargar([...st.dibujos.values()].sort((a, b) => a.creado_en.localeCompare(b.creado_en)), 'todo');

// ── Terminar ──────────────────────────────────────────────────
$('#b-terminar').onclick = async () => {
  const hay = st.dibujos.size > 0;
  const op = await confirmar(
    '¿Terminar la sesión?',
    hay
      ? 'Los alumnos saldrán y los dibujos se borrarán del servidor. Descárgalos antes si quieres guardarlos.'
      : 'Los alumnos saldrán de la clase.',
    [
      { texto: 'Cancelar', valor: null },
      ...(hay ? [{ texto: '⬇ Descargar y terminar', valor: 'bajar', clase: 'btn-verde' }] : []),
      { texto: 'Terminar', valor: 'fin', clase: 'btn-peligro' },
    ]
  );
  if (!op) return;
  if (op === 'bajar') await descargar([...st.dibujos.values()], 'todo');
  try {
    st.desuscribir?.();
    await be.terminarSesion(st.sesion.id);
    localStorage.removeItem(CLAVE_SESION);
    st.sesion = null;
    st.tarjetas.forEach((el) => el.remove());
    st.tarjetas.clear();
    toast('Sesión terminada.');
    inicio();
  } catch (e) {
    console.error(e);
    toast('No se ha podido terminar la sesión.');
  }
};
