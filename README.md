# Lanzador de microfrontends

Interfaz web local para levantar `host`, `header-footer`, `home`, `plp` y `pdp` en
`stg`, `uat` o `prod` sin abrir cada consola a mano. Solo usa Node (sin
dependencias). Ejecuta los mismos scripts `yarn dev:<ambiente>` de cada
`package.json`; solo escribe archivos de los micros al guardar cambios explícitos
desde el editor de variables de entorno. El catálogo se guarda por separado en
`launcher/data/apps.json`.

El catálogo inicial está en `data/apps.json`, pero no está limitado a esos cinco
micros: se pueden administrar otros proyectos compatibles desde la interfaz.

## Requisitos

- **Node 20.12 o posterior** para ejecutar el launcher y los micros.
- **Yarn** debe estar disponible en el `PATH`, y las dependencias de cada micro
  deben estar instaladas. El launcher no ejecuta `yarn install`.
- Cada micro que se vaya a iniciar debe tener su carpeta, un `package.json` con
  `dev:stg`, `dev:uat` o `dev:prod`, según corresponda, y el archivo
  `.env.<ambiente>`. Las tarjetas inválidas quedan deshabilitadas e indican qué
  falta.
- El modo **Terminal nativa**, el selector de carpetas y `start.command` son
  funcionalidades de macOS. El modo **Web** funciona sin una aplicación de
  terminal.

El launcher no instala dependencias, no modifica la versión global de nvm y no
detiene procesos que no haya creado. Si ya hay otro proceso escuchando en el
puerto configurado, lo informa como **Puerto ocupado** y no intenta reemplazarlo.

## Uso

```bash
cd launcher
npm start               # equivale a node server.js
npm run open            # además abre el navegador (node server.js --open)
# o doble clic en start.command
```

No requiere `npm install`: el lanzador solo usa módulos nativos de Node (sin
dependencias). Necesita **Node ≥ 20.12** (declarado en `engines`).

Luego abre <http://localhost:4321>. El puerto se cambia con `LAUNCHER_PORT`, y la
app de terminal por defecto con `MICROFRONTENDS_TERMINAL=terminal|iterm` (la misma
variable que usa `scripts/run-microfrontends.zsh`).

La selección, ambiente, versión de Node, modo, terminal, vista activa y remotes
se conservan en el almacenamiento local del navegador. El catálogo efectivo se
guarda también en `data/apps.json`.

1. Elige el **ambiente** (STG / UAT / PROD). Los micros que no tienen
   `.env.<ambiente>` o el script `dev:<ambiente>` aparecen deshabilitados con el
   motivo.
2. Marca los **micros** a levantar.
3. Si el host está seleccionado, revisa los **remotes del host**.
4. Pulsa **Levantar seleccionados**. Los remotes se lanzan primero y el host al
   final.

`Ctrl+C` en la consola del lanzador detiene los micros levantados en modo Web. Las
ventanas creadas en **Terminal nativa** se mantienen abiertas: el launcher no las
posee ni las cierra al apagarse.

## Configuración del launcher

| Variable | Efecto |
| --- | --- |
| `LAUNCHER_PORT` | Puerto de la interfaz; el valor predeterminado es `4321`. El servidor escucha únicamente en `127.0.0.1`. |
| `LAUNCHER_NODE` | Preferencia para la versión inicial de nvm, por ejemplo `20.20` o `v20.20.0`. Si no está disponible, se usa la selección automática. |
| `NVM_DIR` | Directorio de nvm que se inspecciona; por omisión es `~/.nvm`. |
| `MICROFRONTENDS_TERMINAL` | Terminal predeterminada: `terminal` o `iterm`. La preferencia se usa solo si la aplicación está instalada. |
| `LAUNCHER_LOG_DIR` | Directorio alternativo para los logs por micro. Por omisión es `launcher/logs`. |
| `NEXT_PRIVATE_LOCAL_WEBPACK` | Si no está definida al iniciar el launcher, se exporta como `true` a los micros para compatibilidad con Module Federation. Un valor existente se respeta. |

## Versión de Node

Los micros requieren **Node ≥ 20.12**: `@module-federation/manifest` usa
`util.styleText`, y con una versión anterior `next dev` termina al instante con
`styleText is not a function`. El selector **Node** muestra la versión que está
ejecutando el launcher y las versiones de nvm (`$NVM_DIR/versions/node`).

Por defecto se usa la versión actual si es una Node 20 compatible; en caso
contrario, la 20.x compatible más reciente de nvm, luego cualquier versión
compatible y finalmente la actual. La versión elegida se antepone al `PATH` del
proceso del micro y no se cambia nada global de nvm. `LAUNCHER_NODE=20.20` puede
elegir una versión de nvm como valor inicial; si no encuentra una coincidencia,
se conserva la selección automática. El selector advierte si se escoge una
versión anterior a 20.12, pero permite usarla.

## Inicio, estados y reinicio

**Iniciar seleccionados** valida primero toda la selección: si uno de los micros
no cumple los requisitos del ambiente, no inicia ninguno. Inicia los remotes
antes que el host y continúa con los demás aunque uno falle, mostrando el
resultado por micro. El botón **Iniciar** de una tarjeta solo inicia ese micro y
no depende de la selección actual.

El estado de una tarjeta no se basa únicamente en que el puerto esté abierto:

| Estado | Significado |
| --- | --- |
| **Iniciando…** | El comando fue solicitado, pero todavía no respondió por HTTP. |
| **Listo** | El micro responde por HTTP en su puerto configurado. |
| **Puerto ocupado** | Otro proceso usa el puerto, o el puerto quedó ocupado fuera del launcher. |
| **Error** | El proceso terminó de forma inesperada o no se pudo crear. La causa queda en la consola. |
| **Finalizado / Detenido** | El proceso gestionado terminó o fue detenido desde la interfaz. |

**Detener** solo actúa sobre procesos iniciados desde el launcher. En modo Web
envía la señal al grupo de procesos completo (`yarn` y sus hijos), y fuerza el
cierre después de cinco segundos si fuera necesario. **Reiniciar** solo está
disponible para un micro que se hubiera iniciado desde el launcher: reutiliza su
ambiente, modo, terminal y Node; para el host vuelve a calcular los remotes
seleccionados en ese momento. **Abrir** lleva a `http://localhost:<puerto>` cuando
el micro responde o cuando se detecta un servicio ajeno en ese puerto.

Los botones **Seleccionar todos** y **Ninguno** solo afectan la selección de
arranque; no detienen ni alteran los micros que ya estén ejecutándose.

## Modos de consola

| Modo | Qué hace | Consola |
| --- | --- | --- |
| **Web** | El lanzador ejecuta `yarn dev:<env>` como proceso hijo. | Pestaña en vivo en la página, con colores, filtro y copia. El log queda en `launcher/logs/<app>.log` (o `LAUNCHER_LOG_DIR`), y con **Ver en Terminal** se abre un `tail -f` de ese log. |
| **Terminal nativa** | Abre una ventana de Terminal/iTerm por micro, como el script zsh. | Consola interactiva real en la ventana, grabada con `script(1)`. La pestaña web la refleja en solo lectura y no puede enviar entrada al proceso. |

Cada tarjeta tiene los botones **Iniciar** (levanta solo ese micro con el
ambiente, Node y modo elegidos, sin depender de la selección), **Detener**,
**Reiniciar**, **Consola**, **Abrir** y **Variables de entorno**. En ambos modos
el estado pasa a **Listo**
solo cuando el micro **responde por HTTP**, no apenas abre el puerto: así un
`next dev` que todavía compila, o un puerto tomado por otro proceso, no se marca
como listo de forma prematura.

La consola recibe la salida por SSE y conserva hasta 2.000 líneas por micro. El
filtro, **Copiar** y **Limpiar vista** actúan sobre la consola del navegador; al
limpiar la vista no se detiene el proceso ni se borra su archivo de log. Las
pestañas señalan salida nueva de otros micros y el control **Seguir salida**
permite volver al final después de hacer scroll. **Ver en Terminal** está
disponible solo para un proceso en modo Web.

Las tarjetas también muestran el puerto, el estado de ejecución y la rama Git
actual cuando la carpeta configurada es un repositorio Git.

## Variables de entorno por micro

Cada tarjeta tiene **Variables de entorno**. Abre un editor con el contenido de
`.env.stg`, `.env.uat` y `.env.prod` del micro seleccionado para ver y modificar
los tres ambientes sin salir del launcher. El contenido se edita en bruto, por lo
que se conservan comentarios, comillas y orden de las variables.

Los archivos inexistentes aparecen como **Se creará al guardar**. Al pulsar
**Guardar variables**, el launcher guarda los tres archivos y crea los que
faltaban, incluso si quedaron vacíos. Los cambios de validez se reflejan de
inmediato en las tarjetas; si el micro ya estaba ejecutándose, reinícialo para
que tome los nuevos valores.

Cada archivo admite hasta 160 KiB y no puede contener caracteres nulos. El
launcher escribe primero archivos temporales en la carpeta del micro y luego los
reemplaza, para evitar dejar un archivo parcialmente escrito ante un fallo.

## Limpiar caché por micro

Cada tarjeta tiene un botón **Limpiar caché** que hace, para ese micro, lo mismo
que `clean-home-host.sh` hace para todos: borra `.next`, borra la carpeta de build
propia (`distDir`: `host`, `header`, `home`, `plp` o `pdp`) y ejecuta
`yarn cache clean` (que, como en el script, es global de la máquina). El progreso
aparece en la consola del micro; en modo Web también se persiste en
`launcher/logs/<app>.log` (o `LAUNCHER_LOG_DIR`). Si `yarn cache clean` se cuelga,
se detiene a los 60 s para no dejar el botón atascado.

Si al limpiar el micro estaba corriendo, queda marcado con un aviso amarillo
**"reinicia para aplicar los cambios"**, y si el host estaba corriendo también se
marca (consume el remote reconstruido). El aviso es persistente: se mantiene hasta
que reinicias ese micro desde su botón **Reiniciar**. No se reinicia nada de forma
automática, para no cortar una sesión de debug en curso.

## Catálogo editable de micros

En una instalación nueva se abre este panel al cargar la interfaz, para que el
catálogo pueda revisarse antes del primer inicio.

La sección **Configurar microfrontends** permite agregar, editar o quitar micros
sin tocar sus repositorios. Allí se define el identificador, nombre visible,
carpeta, puerto, carpeta de build opcional y, si aplica, la variable
`NEXT_PUBLIC_*` con la que el host lo consume. El botón **Elegir…** abre el
selector nativo de carpetas; también se admiten rutas relativas al workspace o
rutas absolutas. Marca **Es host** en el micro que recibe los remotes.

Al guardar, la configuración queda en `launcher/data/apps.json`, por lo que se
conserva al cerrar y volver a abrir el lanzador. No se puede retirar ni cambiar
de puerto/carpeta un micro que esté ejecutándose. Los identificadores deben ser
únicos y usar minúsculas, números o guiones; los puertos también deben ser únicos
y estar entre 1 y 65535. Solo puede haber un host, un host no puede declarar una
variable remote, y la carpeta de build —si se indica— debe estar dentro de la
carpeta del micro.

## Remotes del host: local o remoto sin tocar `.env`

`host/next.config.js` obtiene la URL de cada remote de `NEXT_PUBLIC_HEADER_URI`,
`NEXT_PUBLIC_HOME_URI`, `NEXT_PUBLIC_PLP_URI` y `NEXT_PUBLIC_PDP_URI`. Al lanzar el
host, el lanzador puede definir esas variables en el entorno del proceso. `dotenv-cli`
(sin `-o`) y Next no pisan variables que ya existen, así que el valor elegido
prevalece sobre `host/.env.<ambiente>` **sin editarlo**.

| Opción | Valor inyectado |
| --- | --- |
| Automático | `http://localhost:<puerto>` si ese micro está seleccionado o corriendo; si no, lo que diga el `.env` |
| Valor del .env | No inyecta nada |
| Local | `http://localhost:<puerto>` |
| URL personalizada | La URL indicada |

También se pueden crear remotes adicionales desde **Agregar remote**. Indica un
nombre y una variable única con formato `NEXT_PUBLIC_*`; su valor puede venir del
entorno existente (sin inyección), de una URL local indicada manualmente o de una
URL remota. El lanzador valida las URL `http`/`https` y evita que la variable se
repita con un remote configurado. Los remotes adicionales viven solo en el
almacenamiento local del navegador y se inyectan únicamente al iniciar o
reiniciar el host, sin escribir en sus archivos `.env`.

La columna central muestra el valor actual del `.env` como referencia. Del `.env`
del host solo se leen las claves de los remotes configurados y nunca se exponen
otras. Los controles de remotes no bloquean el inicio de un remote aislado; se
validan cuando el host está seleccionado. Para aplicar cambios con el host ya
corriendo, usa **Reiniciar** en la tarjeta del host.

## Estructura del frontend

El frontend son **ES modules nativos** (sin build step) que sirve el propio
launcher desde `public/js/`, cargados con `<script type="module" src="/js/main.js">`:

| Módulo | Responsabilidad |
| --- | --- |
| `core.js` | Estado compartido, `persist`, helpers de DOM (`$`, `el`), cliente `api`, `feedback` y accesores (`apps`, `statusOf`, `isRunning`…). |
| `layout.js` | Barra lateral y cambio de vista (servicios / remotes / consola). |
| `selectors.js` | Controles de ambiente, versión de Node, modo de consola y terminal. |
| `cards.js` | Tarjetas de micros y sus acciones (Iniciar/Detener/Reiniciar/Consola/Abrir/Variables/Limpiar). |
| `environment-editor.js` | Modal para leer y guardar los tres archivos `.env` de un micro. |
| `remotes.js` | Tabla de remotes del host y remotes personalizados. |
| `console.js` | Consola en vivo, pestañas y streaming por SSE. |
| `registry.js` | Modal «Configurar micros». |
| `main.js` | Punto de entrada: `updateAll`, bucle de estado (`pollStatus`), acciones globales y `boot`. |

`ansi.js` sigue como script clásico (expone `window.Ansi`) y se carga antes del
módulo. El servidor sirve cualquier `.js`/`.css`/`.html`/`.svg` de `public/` con
protección contra path traversal, así que agregar un módulo no requiere tocar
`server.js`.

## Seguridad

El servidor escucha solo en `127.0.0.1`. El navegador no puede enviar comandos:
puede pedir iniciar, detener, reiniciar, limpiar, abrir un log o guardar el
catálogo, pero el servidor solo ejecuta `yarn dev:<ambiente>` para una app
registrada y valida los valores recibidos. Los archivos estáticos se resuelven
únicamente dentro de `public/`, con protección contra path traversal.

Además, el servidor rechaza peticiones con otro `Host` u `Origin`, lo que protege
contra CSRF y DNS rebinding. Los cuerpos JSON están limitados a 512 KiB. Al leer
el `.env` del host para la vista de remotes, devuelve solo las variables remote
configuradas, no secretos ni el resto del archivo.

## Problemas frecuentes

- **`styleText is not a function`**: selecciona Node 20.12 o superior y reinicia
  el micro.
- **Puerto ocupado**: detén el proceso que usa ese puerto o cambia el puerto del
  micro desde **Configurar micros** después de detenerlo.
- **Tarjeta deshabilitada**: crea el `.env` del ambiente o agrega el script
  `dev:<ambiente>` al `package.json`. El editor puede crear los tres `.env` al
  guardar.
- **No se puede reiniciar**: ese proceso no se inició desde el launcher. Usa
  **Iniciar** para que pueda gestionarlo.
- **No se abre Terminal/iTerm**: instala la app seleccionada o usa modo Web. Si
  el launcher ya se cerró, controla una Terminal nativa desde su propia ventana.
