@echo off
REM Script para activar entorno virtual y ejecutar el sistema en Windows
REM Uso: run_system.bat

echo 🚀 Iniciando sistema Traductor de Lenguaje de Señas...

REM Activar entorno virtual
echo 📦 Activando entorno virtual...
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
) else (
    echo ❌ Entorno virtual no encontrado. Ejecuta: python -m venv venv
    pause
    exit /b 1
)

REM Verificar dependencias
echo 🔍 Verificando dependencias...
python -c "import sys; print('Python:', sys.version.split()[0]); import numpy, cv2, flask; print('✅ Dependencias básicas: OK')"

if %errorlevel% neq 0 (
    echo ❌ Faltan dependencias. Ejecuta: pip install -r requirements.txt
    pause
    exit /b 1
)

REM Iniciar servidor
echo 🌐 Iniciando servidor...
echo Servidor disponible en: http://localhost:3000
npm run dev