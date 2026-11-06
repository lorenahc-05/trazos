// Lienzo de dibujo para dedo, lápiz de tablet o ratón.
// Guarda los trazos para poder deshacer y para recuperarlos si se recarga la página.

export class Lienzo {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.trazos = [];
    this.actual = null;
    this.punteroId = null;
    this.color = '#222222';
    this.grosor = 12;
    this.goma = false;
    this.version = 0;
    this.onCambio = () => {};

    this.redibujar();
    canvas.addEventListener('pointerdown', (e) => this.#bajar(e));
    canvas.addEventListener('pointermove', (e) => this.#mover(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(t, (e) => this.#subir(e));
    }
    // Evita menús y gestos raros en tablets
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  #punto(e) {
    const r = this.c.getBoundingClientRect();
    return [
      Math.round(((e.clientX - r.left) * this.c.width) / r.width),
      Math.round(((e.clientY - r.top) * this.c.height) / r.height),
    ];
  }

  #bajar(e) {
    if (this.punteroId !== null) return; // un solo dedo a la vez (ignora la palma)
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.punteroId = e.pointerId;
    try { this.c.setPointerCapture(e.pointerId); } catch {}
    this.actual = {
      c: this.goma ? '#ffffff' : this.color,
      g: this.goma ? Math.round(this.grosor * 2.5) : this.grosor,
      p: [this.#punto(e)],
    };
    this.trazos.push(this.actual);
    this.#dibujarPunto(this.actual);
  }

  #mover(e) {
    if (e.pointerId !== this.punteroId || !this.actual) return;
    const eventos = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of eventos.length ? eventos : [e]) {
      const p = this.#punto(ev);
      const ult = this.actual.p[this.actual.p.length - 1];
      if (p[0] === ult[0] && p[1] === ult[1]) continue;
      this.actual.p.push(p);
      this.#segmento(this.actual, ult, p);
    }
  }

  #subir(e) {
    if (e.pointerId !== this.punteroId) return;
    this.punteroId = null;
    if (this.actual) {
      this.actual = null;
      this.version++;
      this.onCambio();
    }
  }

  #estilo(t) {
    const x = this.ctx;
    x.strokeStyle = t.c;
    x.fillStyle = t.c;
    x.lineWidth = t.g;
    x.lineCap = 'round';
    x.lineJoin = 'round';
  }

  #dibujarPunto(t) {
    const [x, y] = t.p[0];
    this.#estilo(t);
    this.ctx.beginPath();
    this.ctx.arc(x, y, t.g / 2, 0, Math.PI * 2);
    this.ctx.fill();
  }

  #segmento(t, a, b) {
    this.#estilo(t);
    this.ctx.beginPath();
    this.ctx.moveTo(a[0], a[1]);
    this.ctx.lineTo(b[0], b[1]);
    this.ctx.stroke();
  }

  #trazo(t) {
    if (t.p.length === 1) return this.#dibujarPunto(t);
    this.#estilo(t);
    this.ctx.beginPath();
    this.ctx.moveTo(t.p[0][0], t.p[0][1]);
    for (let i = 1; i < t.p.length; i++) this.ctx.lineTo(t.p[i][0], t.p[i][1]);
    this.ctx.stroke();
  }

  redibujar() {
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.c.width, this.c.height);
    for (const t of this.trazos) this.#trazo(t);
  }

  deshacer() {
    if (!this.trazos.length) return;
    this.trazos.pop();
    this.redibujar();
    this.version++;
    this.onCambio();
  }

  limpiar() {
    this.trazos = [];
    this.actual = null;
    this.punteroId = null;
    this.redibujar();
    this.version++;
    this.onCambio();
  }

  vacio() {
    return this.trazos.length === 0;
  }

  aBlob() {
    return new Promise((ok, mal) =>
      this.c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo crear la imagen'))), 'image/png')
    );
  }

  exportar() {
    return JSON.stringify(this.trazos);
  }

  importar(json) {
    try { this.trazos = JSON.parse(json) || []; } catch { this.trazos = []; }
    this.redibujar();
  }
}
