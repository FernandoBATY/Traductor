FROM python:3.9-slim-bookworm

# System dependencies for OpenCV (cv2) and mediapipe
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 18
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
# Incluye TensorFlow (necesario para el entrenamiento) - PERO el reconocimiento usa
# tflite-runtime y no carga TF en memoria salvo cuando se entrena bajo demanda.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Runtime TFLite ligero para el reconocimiento (evita importar tensorflow completo en memória).
# En Python 3.9 tflite-runtime está disponible como wheel propio.
RUN pip install --no-cache-dir tflite-runtime || true

# Install Node dependencies
COPY package.json package-lock.json* ./
# El postinstall (<backend/scripts/postinstall.js) se ejecuta al instalar dependencias;
# en Linux/Docker solo imprime y sale (la instalacion de Python la hace el Dockerfile),
# pero el archivo debe existir ya en esta capa.
COPY backend/scripts/postinstall.js ./backend/scripts/postinstall.js
RUN npm install --production

# Copy project files
COPY . .

# Create directories for models and user data
RUN mkdir -p backend/modelos/base backend/usuarios-entrenamientos

EXPOSE 3000

CMD ["node", "backend/server.js"]
