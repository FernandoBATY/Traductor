# -*- coding: utf-8 -*-
from flask import Flask, render_template, Response, redirect, url_for, flash
import cv2
import mediapipe as mp
import numpy as np
from keras.models import load_model
import os
import subprocess
import sys

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

# Update paths to be user-specific
user_id = os.getenv("USER_ID", "default_user")  # Provide a default value if USER_ID is not set
if user_id == "default_user":
    print("Warning: USER_ID environment variable is not set. Using default user ID 'default_user'.")
    # Optionally, you can exit here if a default user is not acceptable:
    # sys.exit(1)

model_dir = os.path.join(os.path.dirname(__file__), "modelos", user_id)
model_path = os.path.join(model_dir, "modelo_gestos.h5")
label_map_path = os.path.join(model_dir, "mapa_etiquetas.npy")

# Check if model files exist
if not os.path.exists(model_path) or not os.path.exists(label_map_path):
    print(f"Error: Modelo o mapa de etiquetas no encontrado en {model_dir}.")
    print("Por favor, entrena el modelo antes de ejecutar reconocimiento.py.")
    sys.exit(1)  # Exit the script if the model files are missing

# Load model and labels with error handling
modelo = load_model(model_path)
mapa_etiquetas = np.load(label_map_path, allow_pickle=True).item()
mapa_inverso = {v: k for k, v in mapa_etiquetas.items()}

# Inicializar MediaPipe
mp_hands = mp.solutions.hands
mp_dibujo = mp.solutions.drawing_utils
hands = mp_hands.Hands(static_image_mode=False, max_num_hands=1, 
                       min_detection_confidence=0.8, min_tracking_confidence=0.8)

cap = cv2.VideoCapture(0)
if not cap.isOpened():
    print("Error: Unable to access the camera. Ensure it is connected and not in use by another application.")
    sys.exit(1)  # Exit the script if the camera cannot be accessed

def generate_frames():
    global previous_landmarks, movement_counter
    while True:
        ret, frame = cap.read()
        if not ret or frame is None:
            print("Error: Unable to read frame from camera.")
            break

        frame = cv2.flip(frame, 1)  # Invertir la imagen para una experiencia más intuitiva
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        resultados = hands.process(frame_rgb)

        if resultados.multi_hand_landmarks:
            for hand_landmarks in resultados.multi_hand_landmarks:
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
                                    cv2.putText(frame, f"Gesto: {etiqueta}", (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
                    except Exception as e:
                        continue

                mp_dibujo.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)

        ret, buffer = cv2.imencode('.jpg', frame)
        frame = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    print("Received request for /video_feed")
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

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
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/health')
def health():
    print("Health check requested.")
    return "Flask server is running.", 200

if __name__ == "__main__":
    print("Starting reconocimiento.py...")
    from waitress import serve
    try:
        print("Starting Flask server on port 5000...")  # Ensure the server runs on port 5000
        serve(app, host='0.0.0.0', port=5000)
    except Exception as e:
        print(f"Error starting Flask server: {e}")
