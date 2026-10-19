# ◈ GEOINTEL

**Generador de Informes de Inteligencia Geopolítica con IA (Google Gemini)** — aplicación de escritorio para macOS.

Escribes un conflicto, región o acontecimiento mundial y GEOINTEL construye automáticamente un informe estructurado de análisis geopolítico (7, 6 o 5 apartados) usando la API de Google Gemini.

![GEOINTEL](assets/icon.png)

![Interfaz de GEOINTEL](docs/screenshot.png)

---

## ✨ Características

- **Interfaz de escritorio nativa** para macOS (Electron), instalable como `.app` / `.dmg`.
- **Motor de IA: Google Gemini** (streaming en tiempo real) con los **modelos más recientes** (Gemini 4 Argon, 3.8 Flash, 3.6 Flash, 3.5 Flash-Lite…).
- **Informes anclados a HOY** 📅: la app inyecta la **fecha actual del sistema** en cada consulta y prohíbe expresamente presentar como «actuales» hechos de años anteriores (2023, 2024, 2025…). Los informes describen la situación tal como está hoy.
- **Búsqueda en Google en tiempo real** 🌐: activa la herramienta *Grounding with Google Search* para que el informe se base en **noticias y hechos actuales**, con las **fuentes citadas** visibles en el panel «Fuentes y búsquedas en vivo».
- **Lectura de una noticia por enlace** 🔗: pega el **enlace de una noticia** y GEOINTEL **lee su contenido** (herramienta *URL context*) y además **busca otras noticias relacionadas** en Google para construir el informe.
- **Conmutación automática (fallback)**: si el modelo elegido falla o no está disponible, la app reintenta sola con el siguiente modelo de la cadena.
- **Nivel de razonamiento ajustable** (thinking level): auto, bajo, medio o alto.
- **3 plantillas de informe**: completa (7 apartados), ampliada (6) y ejecutiva (5).
- **Profundidad ajustable**: dossier extenso (2.500–4.000 palabras) o informe ejecutivo (900–1.400).
- **4 idiomas de salida**: español, inglés, portugués y francés.
- **Modo plantilla sin API key**: genera el esqueleto del informe aunque no tengas clave.
- **Exportación**: copiar al portapapeles, descargar en Markdown y PDF/Imprimir.
- **Privado**: tu API key se guarda solo en tu equipo, nunca se envía a terceros.

---

## 📋 Requisitos

- **macOS** 11 (Big Sur) o superior.
- **Node.js 18+** (recomendado 20 o 22) y **npm**. Descárgalo en <https://nodejs.org>.
- Una **API key de Google Gemini** (gratuita) → <https://aistudio.google.com/app/apikey>.

Para comprobar que tienes Node instalado, abre **Terminal** y ejecuta:

```bash
node -v
npm -v
```

---

## 🚀 Instalación y uso (modo desarrollo)

```bash
# 1. Clona el repositorio
git clone https://github.com/angelsinger1976-arch/geointel.git
cd geointel

# 2. Instala las dependencias
npm install

# 3. Arranca la aplicación
npm start
```

Al abrirse la app:

1. Pulsa **⚙ Configuración**.
2. Pega tu **API Key de Gemini**, elige un **modelo principal** (por defecto `gemini-3.8-flash`) y, si quieres, un **nivel de razonamiento**. Deja marcada la casilla **«Buscar en Google en tiempo real»** para que el informe use noticias actuales.
3. Pulsa **Guardar**.
4. Escribe un conflicto o región. *(Opcional)* Pega el **enlace de una noticia** en el campo «Enlace de una noticia».
5. Pulsa **▶ Generar informe**.

> 🔁 **Fallback automático:** si el modelo principal falla (no disponible, saturado o error), GEOINTEL reintenta automáticamente con los siguientes modelos de la cadena, sin que tengas que hacer nada. La barra de estado muestra el modelo que está usando en cada momento.

> 💡 Si no introduces ninguna API key, la app funciona igualmente en **modo plantilla**: genera el esqueleto completo del informe con tu tema insertado.

---

## 📅🌐 Informes actuales: fecha de hoy + búsqueda en vivo

GEOINTEL está diseñado para que **nunca** te devuelva un informe «congelado» en el pasado:

- **Fecha dinámica:** cada vez que generas un informe, la app calcula la **fecha actual del sistema** y la inyecta tanto en el *system prompt* como en la consulta. El informe se titula con la fecha real (p. ej. *«Fecha del informe: lunes, 19 de octubre de 2026»*) y el modelo tiene **prohibido** presentar como vigentes hechos de años anteriores.
- **Grounding con Google Search:** con la casilla **«Buscar en Google en tiempo real»** activada, Gemini consulta Google antes de redactar. El informe se apoya en **noticias y hechos del momento** y la app muestra un panel con las **consultas realizadas**, los **enlaces leídos** y las **fuentes web citadas**.
- **Enlace de noticia (URL context):** si pegas el enlace de una noticia, GEOINTEL **lee su contenido** y, además, **busca en Google otras noticias y hechos recientes** relacionados, los contrasta con la noticia de partida y construye el informe con todo ello.

### 🔗 Cómo usar el enlace de una noticia

1. Copia la URL de una noticia (por ejemplo de Reuters, AP, El País, Al Jazeera…).
2. Pégala en el campo **«Enlace de una noticia (opcional)»**.
3. *(Recomendado)* Deja marcada la casilla **«Buscar en Google en tiempo real»**.
4. Pulsa **▶ Generar informe**.

La app pedirá al modelo que, en este orden: **1)** lea el contenido del enlace, **2)** busque en Google noticias **más recientes** sobre el mismo tema, **3)** contraste la información y **4)** integre todo en el informe. Al terminar verás el panel **«Fuentes y búsquedas en vivo»** con las consultas, los enlaces leídos (con etiqueta *LEÍDO*) y las fuentes citadas.

> ⚠️ La herramienta de lectura de enlaces no funciona con **muros de pago**, vídeos de YouTube ni archivos de Google Workspace. Si un enlace no se puede leer, la app lo indica y continúa con la búsqueda en Google.

---

## 📦 Crear la aplicación instalable (.dmg / .app)

Para generar un instalador de macOS:

```bash
npm run dist
```

Esto crea en la carpeta `dist/`:

- `GEOINTEL-1.2.0.dmg` → instalador arrastrable a *Aplicaciones*.
- `GEOINTEL-1.2.0-mac.zip` → versión comprimida de la app.

También puedes usar:

```bash
npm run pack        # empaqueta sin generar el .dmg (más rápido)
npm run dist:dmg    # genera solo el .dmg
```

### ⚠️ Primera apertura (app sin firmar)

La app **no está firmada** con un certificado de Apple, así que macOS mostrará un aviso la primera vez. Para abrirla:

1. Abre el `.dmg` y arrastra **GEOINTEL** a la carpeta **Aplicaciones**.
2. En *Aplicaciones*, haz **clic derecho → Abrir** sobre GEOINTEL y confirma **Abrir**.
   - (Solo hace falta la primera vez.)

Si macOS sigue bloqueándola, ejecuta en Terminal:

```bash
xattr -cr /Applications/GEOINTEL.app
```

---

## 🔑 Obtener la API key de Gemini

1. Entra en <https://aistudio.google.com/app/apikey> con tu cuenta de Google.
2. Pulsa **Create API key**.
3. Copia la clave (empieza por `AIza…`) y pégala en ⚙ Configuración de la app.

El nivel gratuito de Gemini es suficiente para uso personal.

---

## 🗂️ Estructura del proyecto

```
geointel/
├── main.js              # Proceso principal de Electron + integración con Gemini (streaming)
├── preload.js           # Puente seguro (contextBridge) hacia el renderer
├── package.json         # Dependencias y configuración de empaquetado
├── renderer/
│   ├── index.html       # Interfaz de usuario
│   ├── styles.css       # Diseño (tema "centro de mando")
│   ├── app.js           # Lógica de la interfaz y plantillas de prompt
│   └── vendor/
│       └── marked.min.js # Parser Markdown (local, funciona sin conexión)
├── assets/
│   └── icon.png         # Icono de la aplicación
├── LICENSE              # MIT
└── README.md
```

---

## 🧠 Cómo funciona

1. Escribes el tema (y, opcionalmente, el enlace de una noticia) y eliges plantilla, profundidad e idioma.
2. La app construye un **prompt maestro** (persona de analista senior + condiciones de rigor + apartados) e **inyecta la fecha actual del sistema** con instrucciones explícitas de frescura.
3. El proceso principal de Electron envía el prompt a la API de **Gemini** (`streamGenerateContent`) y transmite la respuesta en streaming. Cuando está activada la búsqueda, adjunta las herramientas **`googleSearch`** (grounding en Google) y **`urlContext`** (lectura del enlace de noticia).
4. Gemini consulta Google y/o lee el enlace, y devuelve la respuesta junto con su **metadata de grounding** (consultas, enlaces leídos y fuentes citadas), que la app muestra en el panel lateral.
5. Si el modelo principal devuelve un error antes de emitir texto, la app **reintenta con el siguiente modelo de la cadena** (fallback) y, como red de seguridad, vuelve a intentarlo sin herramientas si estas provocaran un fallo.
6. El texto se renderiza en Markdown y puede exportarse a PDF o Markdown.

---

## 🤖 Modelos soportados (2026)

La app usa los modelos vigentes de la familia Gemini 3.x / 4.x:

| Modelo | Endpoint | Notas |
| --- | --- | --- |
| Gemini 4 Argon | `gemini-4-argon` | Máxima capacidad de razonamiento (1M de contexto). |
| Gemini 3.8 Flash | `gemini-3.8-flash` | **Recomendado.** El Flash más inteligente. |
| Gemini 3.6 Flash | `gemini-3.6-flash` | Flash de generación anterior, estable. |
| Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite` | El más rápido y económico. |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | Rendimiento alto a bajo coste. |
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` | Preview de la serie Pro. |
| Gemini 3 Flash | `gemini-3-flash-preview` | Preview. |

**Cadena de fallback:** `gemini-4-argon → gemini-3.8-flash → gemini-3.6-flash → gemini-3.5-flash-lite → gemini-3.1-flash-lite → gemini-3.1-pro-preview → gemini-3-flash-preview`.

> ℹ️ Los modelos Gemini 2.0 y 1.5 están **apagados**, y los 2.5 tienen **acceso limitado**; por eso GEOINTEL ya no los usa. Además, los parámetros `temperature`, `top_p` y `top_k` están **deprecados** en los modelos nuevos (provocan error 400), así que la app no los envía: el control de creatividad se sustituye por el **nivel de razonamiento** (`thinkingLevel`).

---

## 🔒 Privacidad

- La API key se almacena localmente en la carpeta de datos de la app (`userData/config.json`) y **nunca** se envía a servidores distintos de la propia API de Google Gemini.
- La app no recopila telemetría ni datos de uso.

---

## 📄 Licencia

Distribuido bajo licencia **MIT**. Consulta [LICENSE](LICENSE).

---

## ⚖️ Aviso

GEOINTEL es una herramienta de apoyo analítico. Los informes generados por IA pueden contener imprecisiones; verifica siempre los datos con fuentes primarias antes de tomar decisiones.
