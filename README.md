# Traductor de Lenguaje de Señas

Sistema de traducción de lenguaje de señas usando reconocimiento por gestos con Machine Learning.

## Requisitos del Sistema

- Node.js (versión 14 o superior)
- Python 3.8-3.11 
- MySQL/MariaDB
- Git

## Inicio Rápido 🚀

### Windows
```batch
# 1. Activar entorno virtual
venv\Scripts\activate

# 2. Ejecutar el sistema
run_system.bat
```

### macOS/Linux
```bash
# 1. Activar entorno virtual  
source venv/bin/activate

# 2. Ejecutar el sistema
./run_system.sh
```

### Manual
```bash
# 1. Activar entorno virtual
# Windows: venv\Scripts\activate
# Linux/macOS: source venv/bin/activate

# 2. Iniciar servidor Node.js
node backend/server.js

# 3. Abrir navegador en: http://localhost:3000
```

---

## Configuración Completa

### 1. Clonar el Repositorio

```bash
git clone <repository-url>
cd Traductor
```

### 2. Configuración de Node.js

```bash
# Instalar dependencias de Node.js
npm install

# O si prefieres usar yarn
yarn install
```

### 3. Configuración de Python

#### ⚠️ IMPORTANTE: Usar Python 3.9.0

Este proyecto requiere **Python 3.9.0** específicamente para compatibilidad con TensorFlow 2.12.

#### Crear entorno virtual

```bash
# Verificar versión de Python
python --version  # Debe ser 3.9.0

# Crear entorno virtual
python -m venv venv

# Activar entorno virtual
# Windows:
venv\Scripts\activate

# macOS/Linux:
source venv/bin/activate
```

#### Instalar dependencias de Python

```bash
# Actualizar pip
python -m pip install --upgrade pip

# Instalar dependencias (puede tomar varios minutos)
pip install -r requirements.txt

# Si hay errores, instalar individualmente:
pip install tensorflow==2.12.0
pip install mediapipe==0.10.21
pip install flask==3.0.0 flask-cors==4.0.0
```

#### Verificar instalación

```bash
python -c "import numpy, cv2, flask; print('✅ Dependencias básicas instaladas')"
```

### 4. Configuración de Base de Datos

#### Crear base de datos MySQL

```sql
CREATE DATABASE usuarios;
```

#### Ejecutar script de configuración

```bash
# Ejecutar el script SQL incluido
mysql -u root -p usuarios < database_setup.sql

# O ejecutar manualmente cada comando del archivo database_setup.sql
```

#### Configurar variables de entorno

1. Copiar el archivo de ejemplo:
```bash
cp .env.example .env
```

2. Editar `.env` con tus credenciales:
```dotenv
DB_HOST=localhost
DB_USER=root
DB_PASS=tu_password_aquí
DB_NAME=usuarios
PORT=3000
```

## Estructura del Proyecto

```
├── package.json              # Dependencias de Node.js
├── server.js                 # Servidor principal  
├── requirements.txt          # Dependencias de Python
├── database_setup.sql        # Script de configuración de BD
├── .env.example             # Plantilla de variables de entorno
├── backend/
│   ├── server.js            # Servidor backend
│   ├── config/db.js         # Configuración de BD
│   ├── models/              # Modelos de datos
│   ├── routes/              # Rutas de la API
│   ├── python/              # Scripts de Python para ML
│   │   ├── captura_imagenes.py
│   │   ├── entrenamiento.py
│   │   └── reconocimiento.py
│   ├── modelos/             # Modelos entrenados (.h5)
│   └── usuarios-entrenamientos/ # Datos de entrenamiento
└── frontend/
    ├── css/                 # Estilos
    ├── js/                  # JavaScript del frontend
    ├── templates/           # Páginas HTML
    └── static/              # Recursos estáticos
```

## Base de Datos

El proyecto utiliza MySQL con las siguientes tablas:

- **users**: Gestión de usuarios y autenticación
- **modelos**: Información de modelos ML entrenados  
- **entrenamientos**: Sesiones de captura de gestos
- **diccionario**: Catálogo de gestos y traducciones
- **estadisticas_reconocimiento**: Métricas de uso del sistema

Para configurar la base de datos, ejecuta el archivo [database_setup.sql](database_setup.sql) después de crear la base de datos.

## Iniciar la Aplicación

### Desarrollo

1. **Iniciar el servidor backend:**
```bash
npm run dev
# o
node backend/server.js
```

2. **Para desarrollo con Python:**
```bash
# Asegúrate de que el entorno virtual esté activado
cd backend/python
python reconocimiento.py
```

### Producción

```bash
npm start
```

## Scripts Disponibles

- `npm install` - Instalar todas las dependencias
- `npm start` - Iniciar en modo producción
- `npm run dev` - Iniciar en modo desarrollo

## Funcionalidades

- **Captura de Imágenes**: Captura gestos para entrenamiento con **selector de cámara**
- **Entrenamiento de Modelo**: Entrena modelos de ML personalizados
- **Reconocimiento en Tiempo Real**: Reconoce gestos y los traduce con **selector de cámara**
- **Gestión de Usuarios**: Sistema de autenticación y perfiles
- **Diccionario**: Base de datos de gestos y traducciones
- **Selector de Cámara**: Permite elegir qué cámara usar en captura y reconocimiento

## Tecnologías Utilizadas

### Backend
- Node.js + Express.js
- MySQL con Sequelize ORM
- Python con Flask
- TensorFlow/Keras para ML

### Frontend  
- HTML5, CSS3, JavaScript vanilla
- Canvas API para captura de video
- WebRTC para acceso a cámara

### Machine Learning
- TensorFlow 2.12
- MediaPipe para procesamiento de gestos
- OpenCV para procesamiento de imágenes
- NumPy para manipulación de datos

## Solución de Problemas

### Errores Comunes de Python

**Error: TensorFlow no se carga o demora mucho:**
- La primera carga de TensorFlow puede tomar 30-60 segundos
- Reinicia el terminal si se queda colgado

**Error de versión de Python:**
```bash
# Verificar versión correcta
python --version  # Debe ser exactamente 3.9.0
```

**Error de dependencies de TensorFlow:**
```bash
pip install "numpy==1.23.5"  # Versión específica compatible
pip install "protobuf==4.25.3"
```

**Problemas con MediaPipe:**
```bash
pip uninstall mediapipe
pip install mediapipe==0.10.21
```

**Entorno virtual no activo:**
- Verifica que el prompt muestre `(venv)` al inicio
- Reactiva: `venv\Scripts\activate` (Windows) o `source venv/bin/activate` (Linux/macOS)

### Errores de Node.js

**Error de conexión a la BD:**
- Verificar que MySQL esté ejecutándose
- Comprobar credenciales en `.env`
- Asegurar que la base de datos `usuarios` existe y tiene la tabla `users`

**Error de puerto ocupado:**
```bash
# Cambiar puerto en .env
PORT=3001  # O cualquier otro puerto libre
```

### Errores de Base de Datos

**"No database selected":**
```sql
USE usuarios;  -- Ejecutar antes de crear tablas
```

**Tabla users no existe:**
```bash
# Ejecutar el script de configuración
mysql -u root -p usuarios < database_setup.sql
```

## Contribuir

1. Fork el proyecto
2. Crear una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir un Pull Request

## Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para más detalles.