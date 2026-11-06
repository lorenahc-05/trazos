# ✏️ Trazos: dibujos en clase, en directo

Tú dices (o escribes) qué hay que dibujar, los niños dibujan en su tablet, móvil u ordenador y los dibujos te llegan al momento a tu pantalla. Puedes proyectarlos uno a uno y descargarlos todos en un ZIP.

- **Alumnos:** `index.html`. Entran con un código de 4 números y su nombre, sin cuenta.
- **Profe:** `profe.html`. Desde ahí creas la sesión, lanzas las rondas y ves los dibujos.

---

## 1. Probarla ya (modo demo, 2 minutos)

Si `js/config.js` está vacío, la web arranca en **modo demo**: todo se guarda en tu navegador y cada pestaña hace de alumno.

1. Abre una terminal en esta carpeta y arranca un servidor local (abriendo el `.html` con doble clic no funciona):
   ```bash
   npx serve .            # o:  python3 -m http.server 8000
   ```
   También vale la extensión **Live Server** de VS Code.
2. Entra en `http://localhost:3000/profe.html` (o en el puerto que te indique) → **Crear sesión nueva**.
3. Pulsa **+ Alumno de prueba** dos o tres veces. Cada uno se abre en una pestaña.
4. Escribe una consigna → **Lanzar ronda**, dibuja en las pestañas y envía.

## 2. Ponerla en marcha para clase (Supabase, gratis, unos 10 minutos)

1. Crea una cuenta en <https://supabase.com> → **New project**. En la región elige **Central EU (Frankfurt)**, para que los datos de los menores se queden en la UE.
2. **SQL Editor** → **New query** → pega todo el contenido de `supabase/schema.sql` → **Run**. Si lo vuelves a ejecutar no pasa nada.
3. **Authentication → Users → Add user → Create new user**: tu email y una contraseña. Marca *Auto Confirm User*.
4. **Authentication → Sign In / Providers**: desactiva **Allow new users to sign up**, para que nadie más pueda crearse una cuenta de profe.
5. **Project Settings → API** (o *API Keys*): copia la **Project URL** y la clave **anon public** (o *publishable*) en `js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';   // o sb_publishable_...
   ```
   Esta clave es pública. Está pensada para ir en la web, y la seguridad la ponen las reglas del SQL.

## 3. Publicarla en internet

Cualquier hosting de archivos estáticos sirve. La opción más rápida:

- **Netlify Drop:** entra en <https://app.netlify.com/drop> y arrastra la carpeta `trazos`. Te da una URL `https://algo.netlify.app`. Puedes cambiarle el nombre en *Site configuration*.
- También valen GitHub Pages, Vercel o Cloudflare Pages.

Los alumnos usan `https://tu-web/` y tú `https://tu-web/profe.html`. Se necesita **https** para que funcionen el micrófono y el portapapeles, y todos estos hostings ya lo dan.

---

## Cómo se usa en clase

1. **Crear sesión** → aparece el código en grande con un QR. Proyéctalo.
2. Los niños entran en la web (o escanean el QR), escriben el código y su nombre.
3. Escribe o **dicta con el micro 🎤** lo que tienen que dibujar (ES / VAL / EN / FR). Opciones:
   - **Mostrar la frase en sus pantallas.** Si la desmarcas, solo la ves tú y ellos ven "👂 Escucha a la profe". Es ideal para comprensión oral o para un dictado de dibujos en inglés o valenciano.
   - **Tiempo.** Ven una cuenta atrás y al llegar a cero su dibujo se envía solo.
4. **Lanzar ronda.** Ves quién ha enviado (✓ en verde) y quién no. Los dibujos van apareciendo en la cuadrícula.
5. **Recoger dibujos.** Cuenta atrás de 5 segundos y se envía lo que tenga cada uno.
6. Haz clic en un dibujo para verlo en grande. Con las flechas ← → pasas al siguiente, y tienes el botón de pantalla completa para proyectarlos.
7. **Descargar esta ronda / Descargar todo.** Se baja un ZIP con una carpeta por ronda, la consigna y un PNG por alumno.
8. **Terminar sesión.** Los niños salen y **se borran del servidor** todos los dibujos y los nombres. Te ofrece descargarlos antes.

Más cosas útiles:
- Si un niño recarga la página o se le cierra el navegador, vuelve a entrar solo y recupera lo que llevaba dibujado.
- Puede pulsar **"Quiero cambiarlo"** y reenviar el dibujo mientras la ronda siga abierta.
- Para que no se le cuele la palma de la mano, se dibuja con un solo dedo a la vez.

## Privacidad (útil para la defensa)

- Los alumnos no tienen cuenta y solo se les pide un nombre. Mejor el nombre de pila o el número de lista.
- Los dibujos se guardan en un almacenamiento **privado**. Solo los ve la profe, con enlaces temporales de una hora.
- Al terminar la sesión se borra todo. No queda ningún dato de los menores en el servidor.
- Un alumno solo puede enviar a la ronda que está abierta en su clase. No puede ver los dibujos de los demás ni lanzar rondas.
- Los servidores están en la UE (Frankfurt), conforme al RGPD y la LOPDGDD.

## Estructura

```
index.html          Vista del alumno (entrar, dibujar, enviar)
profe.html          Panel de la profe
css/estilos.css
js/config.js        ← aquí van tus claves de Supabase
js/lienzo.js        Lienzo de dibujo (dedo, lápiz o ratón; deshacer; goma)
js/alumno.js        Lógica del alumno
js/profe.js         Lógica de la profe
js/backend.js       Datos: Supabase (clase real) o demo (un navegador)
supabase/schema.sql Tablas, seguridad, funciones y almacenamiento
```

Sin dependencias ni compilación. Supabase JS, el QR y el ZIP se cargan desde esm.sh cuando hacen falta. Si no hay conexión al CDN, el QR no aparece (el código sí) y los dibujos se descargan uno a uno en vez de en ZIP.
