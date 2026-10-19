# ◈ GEOINTEL

**Generador de Informes de Inteligencia Geopolítica con IA (Google Gemini)** — aplicación de escritorio para macOS.

Escribes un conflicto, región o acontecimiento mundial y GEOINTEL construye automáticamente un informe estructurado de análisis geopolítico (7, 6 o 5 apartados) usando la API de Google Gemini.

![GEOINTEL](assets/icon.png)

![Interfaz de GEOINTEL](docs/screenshot.png)

---

## ✨ Características

- **Interfaz de escritorio nativa** para macOS (Electron), instalable como `.app` / `.dmg`.
- **Motor de IA: Google Gemini** (streaming en tiempo real).
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
git clone https://github.com/TU_USUARIO/geointel.git
cd geointel

# 2. Instala las dependencias
npm install

# 3. Arranca la aplicación
npm start
```

Al abrirse la app:

1. Pulsa **⚙ Configuración**.
2. Pega tu **API Key de Gemini** y elige un modelo (por defecto `gemini-2.5-flash`).
3. Pulsa **Guardar**.
4. Escribe un conflicto o región y pulsa **▶ Generar informe**.

> 💡 Si no introduces ninguna API key, la app funciona igualmente en **modo plantilla**: genera el esqueleto completo del informe con tu tema insertado.

---

## 📦 Crear la aplicación instalable (.dmg / .app)

Para generar un instalador de macOS:

```bash
npm run dist
```

Esto crea en la carpeta `dist/`:

- `GEOINTEL-1.0.0.dmg` → instalador arrastrable a *Aplicaciones*.
- `GEOINTEL-1.0.0-mac.zip` → versión comprimida de la app.

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

1. Escribes el tema y eliges plantilla, profundidad e idioma.
2. La app construye un **prompt maestro** (persona de analista senior + condiciones de rigor + apartados).
3. El proceso principal de Electron envía el prompt a la API de **Gemini** (`streamGenerateContent`) y transmite la respuesta en streaming.
4. El texto se renderiza en Markdown y puede exportarse a PDF o Markdown.

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
