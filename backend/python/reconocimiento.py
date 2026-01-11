# -*- coding: utf-8 -*-
from flask import Flask, render_template, Response, redirect, url_for, flash, request
import cv2
import mediapipe as mp
import numpy as np
from keras.models import load_model
import os
import glob
import subprocess
import sys
import threading
import time

app = Flask(__name__)
app.secret_key = 'supersecretkey'  # Necesario para usar flash messages

# Define static and dynamic gestures
static_gestures = set("ABCDEFGHILMNOPRSTUVWY")
dynamic_gestures = set("JKQXZ")

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
    """Load model for a specific user"""
    global modelo, mapa_etiquetas, mapa_inverso, current_user_id
    
    model_dir = os.path.join(backend_dir, "modelos", str(user_id))
    
    # Resolve model and label file names supporting both with/without user prefix
    model_candidates = [
        os.path.join(model_dir, "modelo_gestos.h5"),
        os.path.join(model_dir, f"{user_id}_modelo_gestos.h5")
    ]
    label_candidates = [
        os.path.join(model_dir, "mapa_etiquetas.npy"),
        os.path.join(model_dir, f"{user_id}_mapa_etiquetas.npy")
    ]
    
    model_path = next((p for p in model_candidates if os.path.exists(p)), None)
    label_map_path = next((p for p in label_candidates if os.path.exists(p)), None)
    
    # Fallback: pick first matching files if above failed
    if not model_path:
        h5_files = glob.glob(os.path.join(model_dir, "*.h5"))
        model_path = h5_files[0] if h5_files else None
    if not label_map_path:
        npy_files = [f for f in glob.glob(os.path.join(model_dir, "*.npy")) if "etiquetas" in os.path.basename(f)]
        label_map_path = npy_files[0] if npy_files else None
    
    # Check if model files exist
    if not model_path or not label_map_path:
        raise FileNotFoundError(f"Modelo o mapa de etiquetas no encontrado en {model_dir}. Entrena el modelo primero.")
    
    # Load model and labels
    print(f"Loading model for user {user_id} from {model_path}")
    modelo = load_model(model_path)
    mapa_etiquetas = np.load(label_map_path, allow_pickle=True).item()
    mapa_inverso = {v: k for k, v in mapa_etiquetas.items()}
    current_user_id = str(user_id)
    print(f"Model loaded successfully for user {user_id}")
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

def open_camera():
    global cap, camera_active
    if camera_active and cap is not None and cap.isOpened():
        return True
    max_retries = 5
    for attempt in range(max_retries):
        cap = cv2.VideoCapture(0)
        if cap.isOpened():
            camera_active = True
            print(f"Camera opened successfully on attempt {attempt + 1}")
            return True
        if attempt < max_retries - 1:
            print(f"Failed to open camera on attempt {attempt + 1}, retrying...")
            import time
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
                
                gesto = []
                for punto in hand_landmarks.landmark:
                    gesto.extend([punto.x, punto.y, punto.z])

                if len(gesto) == 63:  # Validate gesture vector length
                    try:
                        prediccion = modelo.predict(np.array([gesto]), verbose=0)
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

                                # Determine if the gesture should be recognized
                                if (etiqueta in static_gestures and movement_counter == 0) or \
                                   (etiqueta in dynamic_gestures and movement_counter >= movement_frames):
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
    if modelo is None:
        return Response("Model not loaded. Call /api/load-model first.", status=503)
    if not camera_active:
        return Response("Camera inactive", status=503)
    if cap is None or not cap.isOpened():
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
    # Check if model is loaded
    if modelo is None:
        return "Model not loaded. Call /api/load-model first.", 503
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

@app.route('/api/health')
def health():
    print("Health check requested.")
    return "Flask server is running.", 200

if __name__ == "__main__":
    print("Starting reconocimiento.py...")
    try:
        from waitress import serve
        print("Using Waitress WSGI server on port 5000...")
        serve(app, host='0.0.0.0', port=5000, _quiet=False)
    except ImportError:
        print("Waitress not available, using Flask development server on port 5000...")
        app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
    except Exception as e:
        print(f"Error starting Flask server: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
