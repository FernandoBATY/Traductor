# Traductor de Lenguaje de Señas

Sistema de traducción de lenguaje de señas usando reconocimiento por gestos con Machine Learning.

## Requisitos del Sistema

- Node.js (versión 14 o superior)
- Python 3.8-3.11 
- MySQL/MariaDB
- Git

## Configuración del Entorno

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

#### Crear entorno virtual (recomendado)

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

#### Instalar dependencias de Python

```bash
pip install -r requirements.txt
```

### 4. Configuración de Base de Datos

#### Crear base de datos MySQL

```sql
CREATE DATABASE usuarios;
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

- **Captura de Imágenes**: Captura gestos para entrenamiento
- **Entrenamiento de Modelo**: Entrena modelos de ML personalizados
- **Reconocimiento en Tiempo Real**: Reconoce gestos y los traduce
- **Gestión de Usuarios**: Sistema de autenticación y perfiles
- **Diccionario**: Base de datos de gestos y traducciones

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

### Errores Comunes

**Error de TensorFlow/NumPy:**
```bash
pip install "numpy==1.23.5"
pip install "tensorflow==2.12.0"
```

**Problemas con MediaPipe:**
```bash
pip install --upgrade mediapipe==0.10.21
```

**Error de conexión a la BD:**
- Verificar que MySQL esté ejecutándose
- Comprobar credenciales en `.env`
- Asegurar que la base de datos existe

## Contribuir

1. Fork el proyecto
2. Crear una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir un Pull Request

## Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para más detalles.