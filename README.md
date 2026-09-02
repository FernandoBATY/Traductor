# Traductor de Lengua de Señas Mexicana (LSM)

Sistema web para traducción de letras del alfabeto en Lengua de Señas Mexicana usando
reconocimiento por gestos con Machine Learning (MediaPipe + TensorFlow/Keras).

El proyecto incluye un **modelo base compartido** que reconoce la mano y las **26 letras (A–Z)**
sin necesidad de que el usuario entrene su propio modelo, además de permitir entrenar un
**modelo personalizado** por usuario si se desea.

## Requisitos del sistema

- **Node.js** 18 o superior
- **Python 3.9** (compatibilidad con TensorFlow 2.12; rango válido 3.8–3.11)
- **MySQL / MariaDB**
- Cámara web (en el equipo donde corre el servicio, ver nota de despliegue)

## Arquitectura

| Componente | Puerto | Rol |
|---|---|---|
| **Node.js + Express** | 3000 | API REST, autenticación, páginas web, orquesta los servicios Python |
| **Flask (reconocimiento)** | 5000 | `backend/python/reconocimiento.py` — detección de mano y predicción en vivo |
| **Flask (captura)** | 5001 | `backend/python/captura_imagenes.py` — captura de imágenes para entrenamiento |
| **MySQL** | 3306 | Base de datos `usuarios` (usuarios, modelos, estadísticas) |
| **TensorFlow/Keras + MediaPipe + OpenCV** | — | Modelos `.h5` y landmarks de mano |

El servidor de Node **arranca automáticamente** los dos servicios Flask al iniciar (`spawn('python', ...)`)
y hace de proxy hacia ellos. La cámara se abre en el **servidor** (`cv2.VideoCapture`).

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
| `DB_NAME` | `usuarios` | Nombre de la base de datos |
| `PORT` | `3000` | Puerto del servidor Node |
| `JWT_SECRET` | `secret` | Secreto para firmar tokens (usar uno real en producción) |
| `USER_ID` | `1` | Usuario por defecto para el reconocimiento |
| `FLASK_REC_URL` / `FLASK_CAPTURE_URL` | *(pendiente)* | URLs de los servicios Flask para despliegue |

## Funcionalidades

- **Registro / inicio de sesión** con JWT y contraseñas cifradas (bcrypt).
- **Diccionario** de gestos del alfabeto.
- **Captura de imágenes** para entrenar un modelo propio.
- **Entrenamiento de modelo personalizado** por usuario.
- **Reconocimiento en tiempo real** con letras **A–Z estáticas**.
- **Modelo base compartido**: cualquier usuario sin modelo propio usa automáticamente el modelo
  base; en la página de reconocimiento se puede elegir **Mi modelo / Modelo base**.

## Estructura del proyecto

```
.
├── package.json                # Dependencias de Node y scripts (npm start / dev)
├── requirements.txt            # Dependencias de Python (TensorFlow, MediaPipe, OpenCV)
├── database_setup.sql          # Script de creación de tablas MySQL
├── .env.example                # Plantilla de variables de entorno
├── run_system.bat              # Arranque local en Windows
├── backend/
│   ├── server.js               # Express: API, estáticos, proxy y arranque de Flask
│   ├── config/db.js            # Conexión MySQL (mysql2)
│   ├── models/User.js          # Consultas de usuarios
│   ├── routes/                 # auth.js, script.js, python-scripts.js
│   ├── python/                 # Scripts ML
│   │   ├── reconocimiento.py   # Flask :5000 — predicción en vivo
│   │   ├── captura_imagenes.py # Flask :5001 — captura para entrenamiento
│   │   ├── entrenamiento.py    # Entrenamiento de modelo por usuario
│   │   ├── entrenar_base.py    # Entrenamiento del modelo base (A–Z) con aumento de datos
│   │   ├── evaluar_base.py     # Evaluación del modelo base
│   │   ├── gestos_utils.py     # Features normalizadas compartidas (invariantes a posición/escala)
│   │   ├── roboflow_dataset.py # Conversor del dataset VOC (Roboflow) a carpetas por letra
│   │   └── requirements.txt
│   ├── modelos/base/           # Modelo base compartido (solo este se sube al repo)
│   └── usuarios-entrenamientos/ # Imágenes de entrenamiento por usuario (ignorado en git)
└── frontend/
    ├── templates/              # Páginas HTML
    ├── js/                     # JavaScript del frontend
    ├── css/                    # Estilos
    └── static/                 # Recursos estáticos
```

## Despliegue en Render (estado y pendientes)

Estado actual: el proyecto está en GitHub (`main`). Ya están listos para la nube el código fuente,
el **modelo base** incluido en el repo, el uso de `process.env.PORT` en Node y la lectura de
variables de entorno en `db.js`.

Para que el despliegue **funcione de verdad**, falta resolver (en orden de prioridad):

1. **Cámara del navegador (getUserMedia)** — requisito indispensable. Hoy la cámara es la del
   *servidor* (`cv2.VideoCapture` en `reconocimiento.py:152` y `captura_imagenes.py:66`); Render
   no tiene webcam. Hay que capturar en el navegador y enviar landmarks (o frames) al backend,
   o usar inferencia client-side.
2. **Escuchar en `$PORT`** en los dos Flask — los puertos 5000/5001 están fijos
   (`reconocimiento.py:356`, `captura_imagenes.py:276`); Render entrega el puerto por la variable `PORT`.
3. **URLs de los servicios Python configurables** — hay 21 referencias fijas a `localhost:5000/5001`
   en `python-scripts.js`, `script.js` y `dashboard.js:27` que en la nube deben venir de variables
   de entorno (p. ej. `FLASK_REC_URL` / `FLASK_CAPTURE_URL`). El servidor Node debe dejar de
   espawnear Python y apuntar a servicios externos (o correr ambos en un solo contenedor con Docker).
4. **Base de datos** — Render no ofrece MySQL gratis. Opción recomendada: **MySQL gratis en Aiven**
   (zero cambios de código, solo credenciales por entorno); alternativa: migrar a **PostgreSQL free**
   de Render (el código usa poco SQL, es un cambio acotado).
5. **`JWT_SECRET` real** — hoy está hardcodeado `'secret'` en `auth.js`.
6. **Decidir el modelo de proceso** — dos Web Services (Node + Python) o un contenedor único
   (Dockerfile) que ejecute ambos; la build de TensorFlow es pesada (~varios GB, varios minutos).
7. **Quitar el postinstall de Python** en `npm install` (`backend/scripts/postinstall.js` ejecuta
   `pip install` con `py`/`python`, pensado para Windows).

Límites del plan gratuito a tener en cuenta: los servicios **duermen tras ~15 min** sin uso (la
primera carga tarda ~50 s), y el **disco es efímero** (los modelos que entrenen los usuarios se
pierden al redeployar; el modelo base, al estar en el repo, siempre existe).

## Solución de problemas

- **TensorFlow tarda en cargar**: la primera importación puede tardar 30–60 s; no es un cuelgue.
- **Versión de Python**: usar exactamente 3.9 (`python --version`).
- **Fallo de dependencias**: `pip install "numpy==1.23.5"` y `"protobuf==4.25.3"` con TF 2.12.
- **No se conecta a MySQL**: verificar que el servicio esté corriendo y las credenciales de entorno.
- **Puerto ocupado**: cambiar `PORT` en las variables de entorno.

## Licencia

MIT — ver [LICENSE](LICENSE).