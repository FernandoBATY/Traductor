# -*- coding: utf-8 -*-
from flask import Flask, render_template, Response, redirect, url_for, flash, request
import cv2
import mediapipe as mp
import numpy as np
from gestos_utils import vector_crudo, vector_normalizado, vector_normalizado_coords
from inferencia_tflite import cargar_modelo_tflite, predecir_tflite, convertir_h5_a_tflite
import os
import glob
import subprocess
import sys
import threading
import time

app = Flask(__name__)
app.secret_key = 'supersecretkey'  # Necesario para usar flash messages

# Define static and dynamic gestures
static_gestures = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
dynamic_gestures = set("")

# Initialize variables to track hand movement
previous_landmarks = None
movement_threshold = 0.02  # Adjust this threshold as needed
movement_frames = 5
movement_counter = 0

# Variable to store the last detected gesture
last_detected_gesture = None
last_gesture_time = 0

# Update paths to be user-specific
current_user_id = os.getenv("USER_ID", "1")  # Default to user 1 for out-of-the-box run

# Model directory is now in backend/modelos/{user_id}
base_dir = os.path.dirname(__file__)
backend_dir = os.path.dirname(base_dir)

# Global variables for model and labels (will be loaded dynamically)
modelo = None
mapa_etiquetas = None
mapa_inverso = None

def load_user_model(user_id):
    """Load model for a specific user, with fallback to the shared base model."""
    global modelo, mapa_etiquetas, mapa_inverso, current_user_id
    
    # Directorios a probar: primero el del usuario, luego el modelo base compartido
    dirs_a_probar = [os.path.join(backend_dir, "modelos", str(user_id))]
    modelo_base_dir = os.path.join(backend_dir, "modelos", "base")
    if os.path.isdir(modelo_base_dir):
        dirs_a_probar.append(modelo_base_dir)
    
    model_path = None
    label_map_path = None
    modelo_origen = None

    for model_dir in dirs_a_probar:
        # Resolve model and label file names supporting both with/without user prefix.
        # El reconocimiento usa .tflite (ligero); si no existe, convierte el .h5.
        tflite_candidates = [
            os.path.join(model_dir, "modelo_gestos.tflite"),
            os.path.join(model_dir, f"{user_id}_modelo_gestos.tflite"),
            os.path.join(model_dir, "base_modelo_gestos.tflite"),
        ]
        h5_candidates = [
            os.path.join(model_dir, "modelo_gestos.h5"),
            os.path.join(model_dir, f"{user_id}_modelo_gestos.h5"),
            os.path.join(model_dir, "base_modelo_gestos.h5"),
        ]
        label_candidates = [
            os.path.join(model_dir, "mapa_etiquetas.npy"),
            os.path.join(model_dir, f"{user_id}_mapa_etiquetas.npy"),
            os.path.join(model_dir, "base_mapa_etiquetas.npy"),
        ]
        
        tf_model_path = next((p for p in tflite_candidates if os.path.exists(p)), None)
        h5_path = next((p for p in h5_candidates if os.path.exists(p)), None)

        # Si no hay .tflite pero sí .h5, intentar convertir (best-effort, requiere Keras)
        if not tf_model_path and h5_path:
            target = os.path.join(model_dir, "modelo_gestos.tflite")
            if convertir_h5_a_tflite(h5_path, target):
                tf_model_path = target
            else:
                # Si no se pudo convertir (sin Keras en el runtime), usamos el .h5 con Keras
                tf_model_path = h5_path

        l = next((p for p in label_candidates if os.path.exists(p)), None)

        if tf_model_path and l:
            model_path, label_map_path, modelo_origen = tf_model_path, l, model_dir
            break
    
    # Fallback: pick first matching files (tflite o h5) + label in the directory
    if not model_path:
        for model_dir in dirs_a_probar:
            tflite_files = glob.glob(os.path.join(model_dir, "*.tflite"))
            h5_files = glob.glob(os.path.join(model_dir, "*.h5"))
            m = tflite_files[0] if tflite_files else (h5_files[0] if h5_files else None)
            npy_files = [f for f in glob.glob(os.path.join(model_dir, "*.npy")) if "etiquetas" in os.path.basename(f)]
            l = npy_files[0] if npy_files else None
            if m and l:
                model_path, label_map_path, modelo_origen = m, l, model_dir
                break

    # Check if model files exist
    if not model_path or not label_map_path:
        raise FileNotFoundError(
            f"Modelo o mapa de etiquetas no encontrado para el usuario {user_id}. Entrena el modelo primero."
        )

    # Carga: TFLite si el archivo es .tflite, Keras si es .h5 (fallback bien documentado)
    global modelo
    using_tflite = str(model_path).endswith(".tflite")
    if using_tflite:
        modelo = cargar_modelo_tflite(model_path)
    else:
        from keras.models import load_model
        modelo = load_model(model_path)
    modelo_formato = "TFLite" if using_tflite else "Keras"

    # Cargar mapa de etiquetas y fijar usuario actual
    global mapa_etiquetas, mapa_inverso, current_user_id
    mapa_etiquetas = np.load(label_map_path, allow_pickle=True).item()
    mapa_inverso = {v: k for k, v in mapa_etiquetas.items()}
    current_user_id = str(user_id)
    usando_base = os.path.basename(os.path.normpath(modelo_origen)) == "base"
    if usando_base:
        print(f"Usuario {user_id} sin modelo propio: usando el modelo base compartido ({model_path})")
    else:
        print(f"Cargando modelo del usuario {user_id} desde {model_path}")
    print(f"Modelo ({modelo_formato}) cargado para user {user_id}")
    return True

# Try to load default model on startup
try:
    load_user_model(current_user_id)
    print(f"Default model loaded for user {current_user_id}")
except Exception as e:
    print(f"Warning: Could not load default model: {e}")
    print("Model will need to be loaded via /api/load-model endpoint")

# Inicializar MediaPipe
mp_hands = mp.solutions.hands
mp_dibujo = mp.solutions.drawing_utils
hands = mp_hands.Hands(static_image_mode=False, max_num_hands=1, 
                       min_detection_confidence=0.8, min_tracking_confidence=0.8)

# Lazy camera control
cap = None
camera_active = False
last_frame_time = 0
camera_index = 0

def get_available_cameras():
    """Get list of available cameras"""
    cameras = []
    for i in range(10):  # Check first 10 camera indices
        test_cap = cv2.VideoCapture(i)
        if test_cap.isOpened():
            cameras.append({
                'index': i,
                'name': f'Cámara {i}'
            })
            test_cap.release()
    return cameras

def set_camera_index(index):
    """Set the camera index to use"""
    global camera_index
    camera_index = index
    print(f"Recognition camera index set to: {index}")

def open_camera():
    global cap, camera_active, camera_index, last_frame_time
    camera_index = 0  # Siempre usar la cámara predeterminada
    last_frame_time = time.time()
    if camera_active and cap is not None and cap.isOpened():
        return True
    max_retries = 5
    for attempt in range(max_retries):
        cap = cv2.VideoCapture(camera_index)
        if cap.isOpened():
            camera_active = True
            print(f"Recognition camera {camera_index} opened successfully on attempt {attempt + 1}")
            return True
        if attempt < max_retries - 1:
            print(f"Failed to open recognition camera {camera_index} on attempt {attempt + 1}, retrying...")
            time.sleep(0.5)
    print("Error: Unable to access the camera after {} attempts.".format(max_retries))
    return False

def close_camera():
    global cap, camera_active
    camera_active = False
    try:
        if cap is not None:
            cap.release()
            cap = None
            print("Camera released")
    except Exception:
        pass

def generate_frames():
    global previous_landmarks, movement_counter, last_detected_gesture, last_gesture_time
    while camera_active and cap is not None and cap.isOpened():
        ret, frame = cap.read()
        if not ret or frame is None:
            print("Error: Unable to read frame from camera.")
            break
        global last_frame_time
        last_frame_time = time.time()

        frame = cv2.flip(frame, 1)  # Invertir la imagen para una experiencia más intuitiva
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        resultados = hands.process(frame_rgb)

        if resultados.multi_hand_landmarks:
            for hand_landmarks in resultados.multi_hand_landmarks:
                # Draw hand landmarks on frame
                mp_dibujo.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)
                
                # Características: crudas para detectar movimiento, normalizadas para clasificar
                gesto = vector_crudo(hand_landmarks)
                vector_modelo = vector_normalizado(hand_landmarks)

                if modelo is not None and len(vector_modelo) == 63:  # Validate gesture vector length
                    try:
                        if isinstance(modelo, dict):  # wrapper TFLite
                            prediccion = predecir_tflite(modelo, vector_modelo)
                        else:  # Keras model
                            prediccion = modelo.predict(np.array([vector_modelo]), verbose=0)
                        if prediccion.any():  # Validate prediction
                            indice = np.argmax(prediccion)
                            if indice in mapa_inverso:
                                etiqueta = mapa_inverso[indice]

                                # Check for hand movement
                                if previous_landmarks is not None:
                                    movement = np.linalg.norm(np.array(gesto) - np.array(previous_landmarks))
                                    if movement > movement_threshold:
                                        movement_counter += 1
                                    else:
                                        movement_counter = 0
                                previous_landmarks = gesto

                                # Determinar si el gesto debe reconocerse (todas las letras son estáticas;
# el contador de movimiento actúa como antirrebote: se reconoce al pausar)
                                if movement_counter == 0:
                                    # Store the detected gesture instead of drawing it on frame
                                    last_detected_gesture = etiqueta
                                    last_gesture_time = time.time()
                    except Exception as e:
                        continue

        ret, buffer = cv2.imencode('.jpg', frame)
        frame = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/train_model')
def train_model():
    try:
        # Usar el intérprete de Python del entorno virtual
        python_executable = sys.executable
        result = subprocess.run([python_executable, "entrenamiento.py"], check=True, capture_output=True, text=True)
        flash("Modelo entrenado exitosamente.")
        return redirect(url_for('index'))
    except subprocess.CalledProcessError as e:
        flash(f"Error al entrenar el modelo: {e.stderr}")
        return redirect(url_for('index'))

@app.route('/run-reconocimiento')
def run_reconocimiento():
    return "Reconocimiento iniciado.", 200

@app.route('/visualize-model')
def start_reconocimiento():
    # Render the visualize-model.html template
    return render_template('visualize-model.html')

@app.route('/api/video_feed')
def video_feed():
    print("Received request for /api/video_feed")
    # El feed se transmite aunque no haya modelo; la predicción se omite hasta cargarlo
    if not camera_active:
        return Response("Camera inactive", status=503)
    if cap is None or not cap.isOpened():
        # Try open once to recover
        if not open_camera():
            return Response("Camera open failed", status=503)
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/load-model', methods=['POST'])
def load_model_endpoint():
    """Load or reload model for a specific user"""
    try:
        # Accept userId from query params or JSON body
        user_id = request.args.get('userId')
        if not user_id and request.is_json:
            user_id = request.json.get('userId')
        
        if not user_id:
            return {"success": False, "message": "userId parameter required"}, 400
        
        load_user_model(user_id)
        return {"success": True, "message": f"Model loaded for user {user_id}"}, 200
    except FileNotFoundError as e:
        return {"success": False, "message": str(e)}, 404
    except Exception as e:
        return {"success": False, "message": f"Error loading model: {str(e)}"}, 500

@app.route('/api/camera/open', methods=['POST'])
def camera_open():
    # La cámara se abre aunque no haya modelo; el reconocimiento se habilita al cargar el modelo
    if open_camera():
        return "Camera opened", 200
    return "Failed to open camera", 500

@app.route('/api/last-gesture', methods=['GET'])
def get_last_gesture():
    """Get the last detected gesture"""
    global last_detected_gesture, last_gesture_time
    if last_detected_gesture and (time.time() - last_gesture_time) < 3:
        return {"gesture": last_detected_gesture, "timestamp": last_gesture_time}, 200
    return {"gesture": None}, 200

@app.route('/api/camera/close', methods=['POST'])
def camera_close():
    close_camera()
    return "Camera closed", 200

@app.route('/api/cameras', methods=['GET'])
def get_cameras():
    """Get list of available cameras"""
    try:
        cameras = get_available_cameras()
        return {'cameras': cameras, 'current': camera_index}
    except Exception as e:
        return {'error': str(e)}, 500

@app.route('/api/camera/set/<int:index>', methods=['POST'])
def set_camera(index):
    """Set camera index to use"""
    try:
        set_camera_index(index)
        # Close current camera and reopen with new index
        if camera_active:
            close_camera()
            if open_camera():
                return {'success': True, 'camera_index': index}
            else:
                return {'error': 'Failed to open new camera'}, 500
        return {'success': True, 'camera_index': index}
    except Exception as e:
        return {'error': str(e)}, 500

def inactivity_worker(threshold=10):
    global last_frame_time
    while True:
        time.sleep(5)
        try:
            if camera_active and (time.time() - last_frame_time) > threshold:
                print("No stream activity; closing camera.")
                close_camera()
        except Exception:
            pass

threading.Thread(target=inactivity_worker, args=(10,), daemon=True).start()

import atexit
atexit.register(close_camera)

@app.route('/api/predecir', methods=['POST'])
def predecir():
    """Predice la letra a partir de los 21 landmarks {x,y,z} enviados desde el navegador.

    El navegador corre MediaPipe Hands (JS), calcula las mismas features normalizadas
    que el entrenamiento y aquí solo se hace la clasificación con el modelo cargado.
    """
    global previous_landmarks, movement_counter, last_detected_gesture, last_gesture_time

    data = request.get_json(silent=True) or {}
    coords = data.get('coords')
    if not coords or len(coords) != 21:
        return {"success": False, "message": "Se requieren 21 landmarks."}, 400

    try:
        puntos = [(float(c[0]), float(c[1]), float(c[2])) for c in coords]
    except Exception:
        return {"success": False, "message": "Formato de landmarks inválido."}, 400

    vector_modelo = vector_normalizado_coords(puntos)
    crudo = [v for p in puntos for v in p]

    if modelo is None or len(vector_modelo) != 63:
        return {"success": False, "message": "Modelo no cargado para predecir."}, 400

    if isinstance(modelo, dict):  # wrapper TFLite
        prediccion = predecir_tflite(modelo, vector_modelo)
    else:  # Keras model
        prediccion = modelo.predict(np.array([vector_modelo]), verbose=0)
    indice = int(np.argmax(prediccion))
    confianza = float(prediccion[0][indice])
    etiqueta = mapa_inverso.get(indice)

    # Antirrebote por movimiento (misma lógica que generate_frames)
    if previous_landmarks is not None:
        movement = np.linalg.norm(np.array(crudo) - np.array(previous_landmarks))
        movement_counter = movement_counter + 1 if movement > movement_threshold else 0
    previous_landmarks = crudo

    if movement_counter == 0 and etiqueta is not None:
        last_detected_gesture = etiqueta
        last_gesture_time = time.time()

    top3 = [(mapa_inverso[int(i)], round(float(prediccion[0][int(i)]), 3))
            for i in np.argsort(prediccion[0])[::-1][:3]]
    gesto_actual = last_detected_gesture if (time.time() - last_gesture_time) < 3 else None

    return {"success": True, "gesture": gesto_actual, "top": top3, "confidence": confianza}, 200

@app.route('/api/health')
@app.route('/health')
def health():
    print("Health check requested.")
    return "Flask server is running.", 200

if __name__ == "__main__":
    print("Starting reconocimiento.py...")
    PORT = int(os.getenv("PORT", "5000"))
    try:
        from waitress import serve
        print(f"Using Waitress WSGI server on port {PORT}...")
        serve(app, host='0.0.0.0', port=PORT, _quiet=False)
    except ImportError:
        print(f"Waitress not available, using Flask development server on port {PORT}...")
        app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
    except Exception as e:
        print(f"Error starting Flask server: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
