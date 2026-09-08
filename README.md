# Traductor de Lengua de Señas Mexicana (LSM)

Sistema web para traducción de letras del alfabeto en Lengua de Señas Mexicana usando
reconocimiento por gestos con Machine Learning (MediaPipe + TensorFlow Lite).

🌐 **Proyecto en línea:** https://traductor-backend-hrdf.onrender.com/

El proyecto incluye un **modelo base compartido** que reconoce las **26 letras (A–Z)** sin
necesidad de que el usuario entrene su propio modelo, además de permitir entrenar un
**modelo personalizado** por usuario si se desea. La cámara es la del **navegador**
(`getUserMedia` + MediaPipe client-side), por lo que funciona en la nube y en móviles.

## Requisitos del sistema

- **Node.js** 18 o superior
- **Python 3.9** (compatibilidad con TensorFlow 2.12; rango válido 3.8–3.11)
- **MySQL / MariaDB**
- Cámara web (del navegador del usuario, no del servidor)

## Arquitectura

| Componente | Puerto | Rol |
|---|---|---|
| **Node.js + Express** | `$PORT` (3000 local) | API REST, autenticación, páginas web, orquesta los servicios Python |
| **Flask (reconocimiento)** | `FLASK_REC_PORT` (5000) | `backend/python/reconocimiento.py` — carga el modelo TFLite y predice gestos |
| **Flask (captura)** | `FLASK_CAPTURE_PORT` (5001) | `backend/python/captura_imagenes.py` — guarda imágenes para entrenamiento |
| **MySQL (Aiven en la nube)** | `$DB_PORT` | Base de datos `usuarios` (usuarios) |
| **MediaPipe (navegador)** | — | Detecta los 21 landmarks de la mano en el cliente, espejado en canvas |

**Flujo de reconocimiento real (cloud):**

1. El navegador abre la cámara con `getUserMedia` y detecta los **21 landmarks** de la mano
   con MediaPipe (`tasks-vision@0.10.0`).
2. Los landmarks se normalizan y se envían a `POST /api/python/predecir`.
3. Node hace de proxy a `reconocimiento.py` (Flask), que carga un modelo TFLite (propio del
   usuario si existe, si no el **modelo base compartido** `base_modelo_gestos.tflite`) y devuelve
   la letra detectada.
4. El frontend muestra la letra en el panel "Traducción" en tiempo real.

## Inicio rápido (Windows)

```batch
run_system.bat
```

El script activa el entorno virtual `venv`, comprueba dependencias y lanza `npm run dev`
(= `node backend/server.js`). Abrir `http://localhost:3000`.

### Manual

```bash
# 1. Crear y activar entorno virtual (Python 3.9)
python -m venv venv
venv\Scripts\activate            # Windows
source venv/bin/activate         # Linux/macOS

# 2. Dependencias de Python
pip install -r requirements.txt

# 3. Dependencias de Node
npm install

# 4. Levantar el sistema (arranca Node + Flask 5000/5001)
npm run dev
```

> En local, el servidor de Node **arranca automáticamente** los dos servicios Flask al iniciar
> (`spawn('python', ...)`) con `FLASK_REC_PORT=5000` y `FLASK_CAPTURE_PORT=5001`. Si configuras
> `FLASK_REC_URL` / `FLASK_CAPTURE_URL` (servicios externos), Node **no** propaga procesos Python
> y apunta a esas URLs.

## Configuración de la base de datos

```sql
CREATE DATABASE usuarios;
```

```bash
mysql -u root -p usuarios < database_setup.sql
```

## Variables de entorno

El código lee las variables del entorno del proceso (no usa `dotenv`). Para desarrollo, copia
`.env.example` a `.env` y expórtalas, o configúralas en el panel de tu proveedor:

| Variable | Default | Descripción |
|---|---|---|
| `DB_HOST` | `localhost` | Host de MySQL |
| `DB_USER` | `root` | Usuario de MySQL |
| `DB_PASS` | `21617` | Contraseña de MySQL |
| `DB_PORT` | `3306` | Puerto de MySQL (con `parseInt` para evitar errores) |
| `DB_NAME` | `usuarios` | Nombre de la base de datos |
| `PORT` | `3000` | Puerto del servidor Node (Render lo asigna) |
| `JWT_SECRET` | `secret` | Secreto para firmar tokens (en producción: obligatorio, ≥32 caracteres, el server aborta si no) |
| `JWT_EXPIRES` | `24h` | Duración del token (renovable con `/api/auth/refresh`) |
| `USER_ID` | `1` | Usuario por defecto para el reconocimiento |
| `FLASK_REC_URL` | `http://localhost:5000` | URL del servicio Flask de reconocimiento |
| `FLASK_CAPTURE_URL` | `http://localhost:5001` | URL del servicio Flask de captura |
| `FLASK_REC_PORT` | `5000` | Puerto interno de `reconocimiento.py` (no usar `PORT` de Render) |
| `FLASK_CAPTURE_PORT` | `5001` | Puerto interno de `captura_imagenes.py` |
| `APP_URL` | `http://localhost:3000` | URL pública de la app (se usa en los enlaces de recuperación de contraseña) |
| `SMTP_HOST` | *(vacío)* | Host SMTP para enviar correos de recuperación. Si no se configura, en desarrollo el backend devuelve el enlace de reset en la respuesta y en producción solo lo registra en logs |
| `SMTP_PORT` | `587` | Puerto SMTP |
| `SMTP_SECURE` | `false` | Usar TLS (`true` para 465) |
| `SMTP_USER` / `SMTP_PASS` | *(vacío)* | Credenciales SMTP (opcionales si el relay no requiere auth) |
| `SMTP_FROM` | *(vacío)* | Remitente de los correos (default: `SMTP_USER`) |
| `RESEND_API_KEY` | *(vacío)* | API key de **Resend** (alternativa al SMTP, API HTTP; si está definida tiene prioridad). Plan free: 100 correos/día |
| `RESEND_FROM` | *(vacío)* | Remitente en Resend, debe usar un dominio verificado (ej: `"Traductor <envios@tudominio.com>"`) |
| `SUPPORT_EMAIL` | *(vacío)* | Destinatario de los mensajes del formulario "Contactar" (default: `SMTP_USER` o `soporte@traductor.local`) |

## Funcionalidades

- **Registro / inicio de sesión** con JWT y contraseñas cifradas (bcrypt).
- **Gestión de cuenta** (`cuenta.html`): editar nombre/correo, cambiar contraseña y eliminar cuenta
  (borra perfil, imágenes capturadas y modelos del usuario).
- **Recuperación de contraseña** por correo (token de un solo uso, 30 min): `recuperar-contrasena.html`
  solicita el enlace y `restablecer-contrasena.html` lo canjea. Requiere SMTP configurado para entregar el correo.
- **Contacto / soporte** desde el botón "Contactar": envía un correo de ayuda (Resend o SMTP)
  por `POST /api/contact`; si no hay ninguno configurado, abre el cliente de correo del usuario (mailto).
- **Sesiones revocables y renovables**: cada JWT incluye una versión de token; cerrar sesión o cambiar
  contraseña revoca todas las sesiones, y `/api/auth/refresh` renueva el token antes de expirar sin pedir
  credenciales (el front lo hace solo cada 5 minutos).
- **Seguridad**: rutas de `/api/python` protegidas con middleware JWT (el `userId` se toma del
  token) y **rate-limit** en `login`/`register`/`forgot`/`reset`.
- **Observabilidad**: logs JSON estructurados a stdout, registro de cada petición con duración y
  estado, alerta en logs por picos de 5xx, monitor de salud de los servicios Flask (avisa cuando caen
  o se recuperan) y endpoints `/healthz` y `/api/ops/stats`.
- **Cámara en espejo** (modo espejo): reconocimiento, captura y feeds Flask se muestran invertidos
  horizontalmente para una experiencia natural al hacer señas.
- **Diccionario** de gestos del alfabeto.
- **Captura de imágenes** para entrenar un modelo propio.
- **Entrenamiento de modelo personalizado** por usuario.
- **Reconocimiento en tiempo real** con letras **A–Z estáticas** (landmarks del navegador).
- **Modelo base compartido**: cualquier usuario sin modelo propio usa automáticamente el modelo
  base; en la página de reconocimiento se puede elegir **Mi modelo / Modelo base**.
- **Diseño responsivo**: menú hamburguesa en móvil y layout adaptado a pantallas pequeñas.

## Estructura del proyecto

```
.
├── package.json                # Dependencias de Node y scripts (npm start / dev)
├── requirements.txt            # Dependencias de Python (TensorFlow, MediaPipe, OpenCV)
├── database_setup.sql          # Script de creación de tablas MySQL
├── .env.example                # Plantilla de variables de entorno
├── run_system.bat              # Arranque local en Windows
├── backend/
│   ├── server.js               # Express: API, estáticos, spawn de Flask, proxy y observabilidad
│   ├── config/db.js            # Pool MySQL (mysql2) + auto-esquema (token_version, password_resets)
│   ├── models/                 # User.js, PasswordReset.js
│   ├── middleware/             # auth.js (JWT + revocación), rateLimit.js, requestLogger.js
│   ├── routes/                 # auth.js (auth/cuenta/reset), python-scripts.js (orquestación IA)
│   ├── utils/                  # logger.js, healthMonitor.js (Flask), mailer.js (nodemailer)
│   ├── scripts/postinstall.js  # Instala dependencias de Python tras npm install
│   ├── python/                 # Scripts ML
│   │   ├── reconocimiento.py   # Flask ($FLASK_REC_PORT) — API pura de predicción
│   │   ├── captura_imagenes.py # Flask ($FLASK_CAPTURE_PORT) — API de guardado de imágenes
│   │   ├── entrenamiento.py    # Entrenamiento de modelo por usuario
│   │   ├── entrenar_base.py    # Entrenamiento del modelo base (A–Z) con aumento de datos
│   │   ├── evaluar_base.py     # Evaluación del modelo base
│   │   ├── inferencia_tflite.py# Cargador TFLite ligero (carga .tflite, convierte .h5 si hace falta)
│   │   ├── gestos_utils.py     # Features normalizadas compartidas (invariantes a posición/escala)
│   │   ├── roboflow_dataset.py # Conversor del dataset VOC (Roboflow) a carpetas por letra
│   │   └── requirements.txt
│   ├── modelos/base/           # Modelo base compartido (solo este se sube al repo)
│   └── usuarios-entrenamientos/ # Imágenes de entrenamiento por usuario (ignorado en git)
└── frontend/
    ├── templates/              # Páginas HTML (index, diccionario, visualización, captura, login,
    │                           # cuenta.html, recuperar-contrasena.html, restablecer-contrasena.html)
    ├── js/                     # JavaScript del frontend (incl. auth.js, mobile-nav.js, scripts.js, custom-alert.js)
    ├── css/                    # Estilos
    └── static/                 # Recursos estáticos
```

## Despliegue en Render (estado actual)

El proyecto está en GitHub (`main`) y **desplegado en Render**: https://traductor-backend-hrdf.onrender.com/
(Web Service único, rama `main`).

Ya resuelto:

1. **Cámara del navegador** — se usa `getUserMedia` + MediaPipe client-side; ya no depende de
   cámara del servidor. `reconocimiento.py` solo predice a partir de los landmarks que envía el
   navegador (`/api/predecir`).
2. **Puertos** — los Flask NO usan `$PORT` (port 10000 de Render) sino variables dedicadas
   (`FLASK_REC_PORT=5000`, `FLASK_CAPTURE_PORT=5001`), evitando el clásico "Address already in use".
3. **Base de datos** — MySQL en **Aiven** (plan gratuito), credenciales vía variables de entorno;
   `DB_PORT` se parsea como entero.
4. **Material de la app** — el modelo base y sus metadatos están en el repo (`backend/modelos/base/`),
   por lo que siempre existen en el despliegue.
5. **Frontend responsivo** y sin dependencia de cámara del servidor.

6. **Seguridad aplicada** — todas las rutas de `/api/python` exigen un **token JWT**
   (`Authorization: Bearer <token>`); el `userId` se toma del token, nunca del query/body
   (no se puede manipular). `login`/`register` tienen **rate-limit** (10 y 5 por minuto por IP).
7. **Cámara en espejo** — el video del navegador se muestra en modo espejo (`-scale-x-100`),
   más cómodo al hacer señas. La predicción usa los landmarks crudos (sin espejo), igual que el
   entrenamiento.
8. **Flask son solo API** — se eliminaron los flujos legado de cámara del servidor
   (`video_feed`, control de cámara, páginas Flask) y la ruta RCE `script.js`. La cámara vive
   exclusivamente en el navegador (`getUserMedia`) y los Flask solo reciben imágenes/landmarks.

Pendientes / limitaciones a tener en cuenta:

1. **Disco efímero de Render** — los modelos que entrenen los usuarios (`usuarios-entrenamientos/`)
   se pierden al redeployar. El modelo base (en el repo) siempre sobrevive. Para persistir modelos
   habría que usar un volumen o un bucket (S3 / R2).
2. **SMTP** — para que el correo de recuperación llegue al usuario hay que configurar `SMTP_*` en el
   panel de Render. Sin SMTP, en producción el enlace solo queda registrado en los logs.
3. **Los servicios duermen tras ~15 min** sin uso en el plan gratuito — la primera carga puede
   tardar ~50 s.
4. **Al iniciar sesión, antes de usar esta versión** — si tenías una sesión vieja en el navegador
   (sin token), vuelve a iniciar sesión para obtener el token JWT; las llamadas a `/api/python`
   devuelven `401` sin él.
5. **Tailwind por CDN** — funcional para el proyecto, pero en producción conviene compilarlo.
6. **postinstall de Python** en `npm install` — pensado para Windows; en Render se instalan los
   paquetes con el propio `requirements.txt`.
7. **Rate-limit en memoria** — por proceso; con una sola instancia de Render es correcto, pero si se
   escala a varias instancias habría que usar un almacén compartido (Redis).
8. **Cambiar contraseña / eliminar cuenta revocan la sesión en curso** — el front recibe un token
   nuevo (cambio de contraseña) o vuelve a login (eliminar cuenta).

## Solución de problemas

- **TensorFlow tarda en cargar**: la primera importación puede tardar 30–60 s; no es un cuelgue.
- **Versión de Python**: usar exactamente 3.9 (`python --version`).
- **Fallo de dependencias**: `pip install "numpy==1.23.5"` y `"protobuf==4.25.3"` con TF 2.12.
- **No se conecta a MySQL**: verificar que el servicio esté corriendo y las credenciales de entorno.
- **Puerto ocupado**: cambiar `PORT` en las variables de entorno.
- **Flask no arranca en Render**: comprobar que las variables de puerto (`FLASK_REC_PORT` /
  `FLASK_CAPTURE_PORT`) no coincidan con el `PORT` global de Render, o verás `[Errno 98] Address
  already in use` en los logs.
- **"No se pudo cargar el modelo" / `load-model`**: ese proxy devuelve `success:true` con
  `modelLoaded:false` cuando el usuario no tiene modelo propio (comportamiento esperado: se usa el
  base). Si Flask está caído de verdad, revisa los logs de Render.

## Licencia

MIT — ver [LICENSE](LICENSE).