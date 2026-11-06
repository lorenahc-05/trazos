// Capa de datos. Dos implementaciones con la misma interfaz:
//  · BackendSupabase → uso real en clase (varios dispositivos)
//  · BackendDemo     → pruebas en un solo navegador (pestañas), sin configurar nada

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export async function obtenerBackend() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    return new BackendSupabase(createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  }
  return new BackendDemo();
}

const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
const ahoraISO = (ms = 0) => new Date(Date.now() + ms).toISOString();
const codigoAleatorio = () => String(Math.floor(1000 + Math.random() * 9000));

// ═════════════════════════════════════════════════════════════
//  SUPABASE
// ═════════════════════════════════════════════════════════════
class BackendSupabase {
  modo = 'supabase';

  constructor(sb) {
    this.sb = sb;
    this.urls = new Map(); // ruta → { url, caduca }
    this.canales = new Map(); // sesion → canal realtime de la profe
  }

  #ok({ data, error }) {
    if (error) throw new Error(error.message || String(error));
    return data;
  }

  // ── Profe: cuenta ───────────────────────────────────────────
  async usuario() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user ?? null;
  }
  async entrar(email, password) {
    this.#ok(await this.sb.auth.signInWithPassword({ email, password }));
  }
  async salir() {
    await this.sb.auth.signOut();
  }
  async desfase() {
    const t0 = Date.now();
    const ahora = this.#ok(await this.sb.rpc('hora_servidor'));
    const t1 = Date.now();
    return Date.parse(ahora) - (t0 + t1) / 2;
  }

  // ── Profe: sesiones y rondas ────────────────────────────────
  async crearSesion() {
    for (let i = 0; i < 10; i++) {
      const { data, error } = await this.sb
        .from('sesiones')
        .insert({ codigo: codigoAleatorio() })
        .select()
        .single();
      if (!error) return data;
      if (error.code !== '23505') throw new Error(error.message); // 23505 = código repetido
    }
    throw new Error('No se ha podido generar un código libre');
  }
  async obtenerSesion(id) {
    return this.#ok(await this.sb.from('sesiones').select().eq('id', id).maybeSingle());
  }
  async sesionAbiertaReciente() {
    const d = this.#ok(
      await this.sb.from('sesiones').select().eq('estado', 'abierta')
        .order('creada_en', { ascending: false }).limit(1)
    );
    return d[0] || null;
  }
  async listarRondas(sid) {
    return this.#ok(await this.sb.from('rondas').select().eq('sesion_id', sid).order('numero'));
  }
  async listarParticipantes(sid) {
    return this.#ok(
      await this.sb.from('participantes').select('id,sesion_id,nombre,creado_en')
        .eq('sesion_id', sid).order('creado_en')
    );
  }
  async listarDibujos(sid) {
    return this.#ok(await this.sb.from('dibujos').select().eq('sesion_id', sid).order('creado_en'));
  }
  async lanzarRonda(sid, { consigna, mostrar, segundos }) {
    const r = this.#ok(
      await this.sb.rpc('lanzar_ronda', {
        p_sesion: sid,
        p_consigna: consigna || '',
        p_mostrar: !!mostrar,
        p_segundos: segundos || null,
      })
    );
    this.#avisar(sid);
    return r;
  }
  async programarCierre(sid, rid, segundos) {
    const r = this.#ok(await this.sb.rpc('programar_cierre', { p_ronda: rid, p_segundos: segundos }));
    this.#avisar(sid);
    return r;
  }
  async cerrarRonda(sid, rid) {
    this.#ok(await this.sb.from('rondas').update({ abierta: false }).eq('id', rid));
    this.#avisar(sid);
  }
  async terminarSesion(sid) {
    this.#ok(await this.sb.from('sesiones').update({ estado: 'cerrada' }).eq('id', sid));
    this.#avisar(sid);
    // Borra todas las imágenes de la sesión
    const bucket = this.sb.storage.from('dibujos');
    const rutas = [];
    const carpetas = this.#ok(await bucket.list(sid, { limit: 1000 }));
    for (const c of carpetas) {
      const archivos = this.#ok(await bucket.list(`${sid}/${c.name}`, { limit: 1000 }));
      for (const a of archivos) rutas.push(`${sid}/${c.name}/${a.name}`);
    }
    for (let i = 0; i < rutas.length; i += 100) this.#ok(await bucket.remove(rutas.slice(i, i + 100)));
    // Borra la sesión (en cascada: rondas, participantes, dibujos)
    this.#ok(await this.sb.from('sesiones').delete().eq('id', sid));
    this.#quitarCanal(sid);
  }

  // ── Profe: tiempo real ──────────────────────────────────────
  suscribir(sid, { dibujo, participante }) {
    this.#quitarCanal(sid);
    const filtro = `sesion_id=eq.${sid}`;
    const canal = this.sb
      .channel('sala-' + sid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dibujos', filter: filtro }, (x) => dibujo(x.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dibujos', filter: filtro }, (x) => dibujo(x.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'participantes', filter: filtro }, (x) => {
        const { token, ...p } = x.new;
        participante(p);
      })
      .subscribe();
    this.canales.set(sid, canal);
    return () => this.#quitarCanal(sid);
  }
  #quitarCanal(sid) {
    const c = this.canales.get(sid);
    if (c) this.sb.removeChannel(c);
    this.canales.delete(sid);
  }
  // Aviso a los alumnos de "algo ha cambiado". Ellos consultan el estado real al servidor,
  // así que nadie puede colar una ronda falsa enviando mensajes al canal.
  #avisar(sid) {
    const c = this.canales.get(sid) ?? this.sb.channel('sala-' + sid);
    c.send({ type: 'broadcast', event: 'cambio', payload: {} }).catch(() => {});
  }

  async urlDibujo(d) {
    const cache = this.urls.get(d.ruta);
    if (cache && cache.caduca > Date.now()) return cache.url;
    const { signedUrl } = this.#ok(await this.sb.storage.from('dibujos').createSignedUrl(d.ruta, 3600));
    this.urls.set(d.ruta, { url: signedUrl, caduca: Date.now() + 50 * 60 * 1000 });
    return signedUrl;
  }
  async blobDibujo(d) {
    return this.#ok(await this.sb.storage.from('dibujos').download(d.ruta));
  }

  // ── Alumno ──────────────────────────────────────────────────
  async unirse(codigo, nombre) {
    const d = this.#ok(await this.sb.rpc('unirse_sesion', { p_codigo: codigo, p_nombre: nombre }));
    const f = Array.isArray(d) ? d[0] : d;
    return { sesion_id: f.o_sesion, participante_id: f.o_participante, token: f.o_token, nombre };
  }
  async estado(cred) {
    return this.#ok(
      await this.sb.rpc('estado_sesion', { p_participante: cred.participante_id, p_token: cred.token })
    );
  }
  escucharCambios(sid, cb) {
    const c = this.sb.channel('sala-' + sid).on('broadcast', { event: 'cambio' }, () => cb()).subscribe();
    return () => this.sb.removeChannel(c);
  }
  async enviar(cred, rid, blob) {
    const ruta = `${cred.sesion_id}/${rid}/${cred.participante_id}-${Date.now()}.png`;
    const subida = await this.sb.storage.from('dibujos').upload(ruta, blob, { contentType: 'image/png', upsert: false });
    if (subida.error) {
      const m = subida.error.message || '';
      throw new Error(/row-level security|unauthorized|403/i.test(m) ? 'RONDA_CERRADA' : m);
    }
    this.#ok(
      await this.sb.rpc('enviar_dibujo', {
        p_participante: cred.participante_id,
        p_token: cred.token,
        p_ronda: rid,
        p_ruta: ruta,
      })
    );
  }
}

// ═════════════════════════════════════════════════════════════
//  DEMO (IndexedDB + BroadcastChannel, solo este navegador)
// ═════════════════════════════════════════════════════════════
const TABLAS = ['sesiones', 'rondas', 'participantes', 'dibujos'];
let _db;
function bd() {
  _db ??= new Promise((ok, mal) => {
    const r = indexedDB.open('trazos-demo', 1);
    r.onupgradeneeded = () => {
      for (const t of TABLAS) r.result.createObjectStore(t, { keyPath: 'id' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
  return _db;
}
async function op(tabla, modo, fn) {
  const d = await bd();
  return new Promise((ok, mal) => {
    const t = d.transaction(tabla, modo);
    const req = fn(t.objectStore(tabla));
    t.oncomplete = () => ok(req?.result);
    t.onerror = () => mal(t.error);
  });
}
const todos = (t) => op(t, 'readonly', (s) => s.getAll());
const uno = (t, id) => op(t, 'readonly', (s) => s.get(id));
const guardar = (t, o) => op(t, 'readwrite', (s) => s.put(o)).then(() => o);
const borrar = (t, id) => op(t, 'readwrite', (s) => s.delete(id));

class BackendDemo {
  modo = 'demo';

  constructor() {
    this.bc = new BroadcastChannel('trazos-demo');
    this.oyentes = new Set();
    this.bc.onmessage = (e) => {
      for (const f of this.oyentes) f(e.data);
    };
    this.urls = new Map();
  }
  #emitir(msg) {
    this.bc.postMessage(msg);
  }

  async usuario() { return { email: 'demo' }; }
  async entrar() {}
  async salir() {}
  async desfase() { return 0; }

  async crearSesion() {
    const usados = new Set((await todos('sesiones')).filter((s) => s.estado === 'abierta').map((s) => s.codigo));
    let codigo;
    do codigo = codigoAleatorio(); while (usados.has(codigo));
    return guardar('sesiones', { id: uuid(), codigo, estado: 'abierta', creada_en: ahoraISO() });
  }
  async obtenerSesion(id) { return (await uno('sesiones', id)) ?? null; }
  async sesionAbiertaReciente() {
    const s = (await todos('sesiones')).filter((x) => x.estado === 'abierta');
    s.sort((a, b) => b.creada_en.localeCompare(a.creada_en));
    return s[0] || null;
  }
  async listarRondas(sid) {
    return (await todos('rondas')).filter((r) => r.sesion_id === sid).sort((a, b) => a.numero - b.numero);
  }
  async listarParticipantes(sid) {
    return (await todos('participantes'))
      .filter((p) => p.sesion_id === sid)
      .map(({ token, ...p }) => p)
      .sort((a, b) => a.creado_en.localeCompare(b.creado_en));
  }
  async listarDibujos(sid) {
    return (await todos('dibujos'))
      .filter((d) => d.sesion_id === sid)
      .map(({ blob, ...d }) => d)
      .sort((a, b) => a.creado_en.localeCompare(b.creado_en));
  }
  async lanzarRonda(sid, { consigna, mostrar, segundos }) {
    const rondas = await this.listarRondas(sid);
    for (const r of rondas.filter((r) => r.abierta)) await guardar('rondas', { ...r, abierta: false });
    const r = await guardar('rondas', {
      id: uuid(),
      sesion_id: sid,
      numero: (rondas.at(-1)?.numero || 0) + 1,
      consigna: (consigna || '').slice(0, 300),
      mostrar_consigna: !!mostrar,
      abierta: true,
      creada_en: ahoraISO(),
      termina_en: segundos ? ahoraISO(segundos * 1000) : null,
    });
    this.#emitir({ tipo: 'cambio', sid });
    return r;
  }
  async programarCierre(sid, rid, segundos) {
    const r = await uno('rondas', rid);
    if (!r?.abierta) throw new Error('RONDA_CERRADA');
    const limite = Date.now() + segundos * 1000;
    if (!r.termina_en || Date.parse(r.termina_en) > limite) r.termina_en = new Date(limite).toISOString();
    await guardar('rondas', r);
    this.#emitir({ tipo: 'cambio', sid });
    return r;
  }
  async cerrarRonda(sid, rid) {
    const r = await uno('rondas', rid);
    if (r) await guardar('rondas', { ...r, abierta: false });
    this.#emitir({ tipo: 'cambio', sid });
  }
  async terminarSesion(sid) {
    for (const t of ['dibujos', 'participantes', 'rondas']) {
      for (const x of (await todos(t)).filter((x) => x.sesion_id === sid)) await borrar(t, x.id);
    }
    await borrar('sesiones', sid);
    this.#emitir({ tipo: 'cambio', sid });
  }
  suscribir(sid, { dibujo, participante }) {
    const f = (m) => {
      if (m.sid !== sid) return;
      if (m.tipo === 'dibujo') dibujo(m.dato);
      if (m.tipo === 'participante') participante(m.dato);
    };
    this.oyentes.add(f);
    return () => this.oyentes.delete(f);
  }
  async urlDibujo(d) {
    const k = d.id + d.ruta;
    if (!this.urls.has(k)) this.urls.set(k, URL.createObjectURL(await this.blobDibujo(d)));
    return this.urls.get(k);
  }
  async blobDibujo(d) {
    return (await uno('dibujos', d.id)).blob;
  }

  // ── Alumno ──
  async unirse(codigo, nombre) {
    nombre = (nombre || '').trim().slice(0, 30);
    if (!nombre) throw new Error('NOMBRE_VACIO');
    const s = (await todos('sesiones')).find((x) => x.codigo === codigo.trim() && x.estado === 'abierta');
    if (!s) throw new Error('CODIGO_NO_VALIDO');
    const p = await guardar('participantes', { id: uuid(), sesion_id: s.id, nombre, token: uuid(), creado_en: ahoraISO() });
    const { token, ...pub } = p;
    this.#emitir({ tipo: 'participante', sid: s.id, dato: pub });
    return { sesion_id: s.id, participante_id: p.id, token: p.token, nombre };
  }
  async estado(cred) {
    const p = await uno('participantes', cred.participante_id);
    if (!p || p.token !== cred.token) return { estado: 'no_existe' };
    const s = await uno('sesiones', p.sesion_id);
    if (!s) return { estado: 'no_existe' };
    const r = (await this.listarRondas(s.id)).at(-1);
    const enviado = !!r && (await todos('dibujos')).some((d) => d.ronda_id === r.id && d.participante_id === p.id);
    return {
      estado: s.estado,
      ahora: ahoraISO(),
      enviado,
      ronda: r
        ? { id: r.id, numero: r.numero, consigna: r.mostrar_consigna ? r.consigna : '', abierta: r.abierta, termina_en: r.termina_en }
        : null,
    };
  }
  escucharCambios(sid, cb) {
    const f = (m) => m.tipo === 'cambio' && m.sid === sid && cb();
    this.oyentes.add(f);
    return () => this.oyentes.delete(f);
  }
  async enviar(cred, rid, blob) {
    const p = await uno('participantes', cred.participante_id);
    if (!p || p.token !== cred.token) throw new Error('NO_AUTORIZADO');
    const r = await uno('rondas', rid);
    const s = await uno('sesiones', p.sesion_id);
    if (!r || !r.abierta || r.sesion_id !== p.sesion_id || s?.estado !== 'abierta') throw new Error('RONDA_CERRADA');
    const previo = (await todos('dibujos')).find((d) => d.ronda_id === rid && d.participante_id === p.id);
    const d = {
      id: previo?.id || uuid(),
      sesion_id: p.sesion_id,
      ronda_id: rid,
      participante_id: p.id,
      nombre: p.nombre,
      ruta: `${p.sesion_id}/${rid}/${p.id}-${Date.now()}.png`,
      creado_en: ahoraISO(),
      blob,
    };
    await guardar('dibujos', d);
    const { blob: _, ...pub } = d;
    this.#emitir({ tipo: 'dibujo', sid: p.sesion_id, dato: pub });
  }
}
