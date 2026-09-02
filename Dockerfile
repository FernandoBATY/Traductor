FROM python:3.9-slim

# System dependencies for OpenCV (cv2) and mediapipe
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgl1-mesa-glx \
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
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Node dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy project files
COPY . .

# Create directories for models and user data
RUN mkdir -p backend/modelos/base backend/usuarios-entrenamientos

EXPOSE 3000

CMD ["node", "backend/server.js"]
