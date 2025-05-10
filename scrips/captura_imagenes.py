# -*- coding: utf-8 -*-
import subprocess
from flask import Flask, render_template, Response, request, send_from_directory
import os
import cv2
import mediapipe as mp
import sys
from flask_cors import CORS
import logging
import absl.logging

# Suppress TensorFlow Lite and MediaPipe warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
logging.getLogger('tensorflow').setLevel(logging.ERROR)
absl.logging.set_verbosity(absl.logging.ERROR)

# Initialize Flask app and enable CORS
app = Flask(__name__)
CORS(app)

# Base directory for storing user-specific data
base_dir = os.path.dirname(__file__)
imagenes_dir = os.path.join(base_dir, "imagenes")

# Initialize MediaPipe
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(min_detection_confidence=0.8, min_tracking_confidence=0.8)

# Initialize video capture
cap = cv2.VideoCapture(0)
if not cap.isOpened():
    raise RuntimeError("Error al abrir la cámara. Asegúrate de que la cámara está conectada y no está siendo utilizada por otra aplicación.")

def validate_image(frame):
    if frame is None or frame.size == 0:
        return False
    if frame.shape[0] == 0 or frame.shape[1] == 0:
        return False
    return True

def generate_frames():
    while True:
        ret, frame = cap.read()
        if not ret or not validate_image(frame):
            continue

        frame = cv2.flip(frame, 1)  # Flip the image horizontally
        h, w, _ = frame.shape  # Get the height and width of the frame

        # Ensure the frame is square by cropping it
        if h != w:
            size = min(h, w)
            frame = frame[:size, :size]

        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)  # Convert to RGB for MediaPipe

        # Process the image and detect hands
        results = hands.process(frame_rgb)

        if results.multi_hand_landmarks:
            for landmarks in results.multi_hand_landmarks:
                mp.solutions.drawing_utils.draw_landmarks(frame, landmarks, mp_hands.HAND_CONNECTIONS)

        ret, buffer = cv2.imencode('.jpg', frame)
        frame = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')

@app.route('/')
def index():
    return render_template('capture.html')

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/capture_image', methods=['POST'])
def capture_image():
    user_id = request.args.get('userId')
    letter = request.args.get('letter')

    # Validate parameters
    if not user_id:
        print("Error: Missing userId parameter.")
        return "User ID is required.", 400
    if not letter:
        print("Error: Missing letter parameter.")
        return "Letter is required.", 400

    # Create user-specific directory for images
    user_dir = os.path.join(imagenes_dir, user_id)
    letter_dir = os.path.join(user_dir, letter)
    os.makedirs(letter_dir, exist_ok=True)

    # Capture and save the image
    ret, frame = cap.read()
    if not ret:
        print("Error: Failed to capture image from the camera.")
        return "Failed to capture image.", 500

    # Determine the next sequential filename
    existing_files = [f for f in os.listdir(letter_dir) if f.endswith(".jpg")]
    next_number = len(existing_files) + 1
    image_filename = f"{letter}_{next_number}.jpg"
    image_path = os.path.join(letter_dir, image_filename)

    # Save the image
    frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    frame = cv2.resize(frame, (224, 224))  # Resize for compatibility with training
    cv2.imwrite(image_path, frame)

    print(f"Image saved at {image_path}.")
    return f"Image saved at {image_path}.", 200

@app.route('/train_model')
def train_model():
    try:
        # Get the user ID from the query parameters
        user_id = request.args.get('userId')
        if not user_id:
            return "User ID is required.", 400

        # Use the Python interpreter from the current environment
        python_executable = sys.executable
        script_path = os.path.join(os.path.dirname(__file__), "entrenamiento.py")

        # Run the entrenamiento.py script with the user ID
        result = subprocess.run(
            [python_executable, script_path, user_id],
            check=True,
            capture_output=True,
            text=True
        )

        # Log the output for debugging
        print("Entrenamiento output:", result.stdout)
        return "Modelo entrenado exitosamente.", 200

    except subprocess.CalledProcessError as e:
        # Log the error output for debugging
        print("Error al entrenar el modelo:", e.stderr)
        return f"Error al entrenar el modelo: {e.stderr}", 500

    except Exception as e:
        # Catch any other exceptions and log them
        print("Unexpected error:", str(e))
        return f"Unexpected error: {str(e)}", 500

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static'), 'favicon.ico', mimetype='image/vnd.microsoft.icon')

if __name__ == "__main__":
    from waitress import serve
    serve(app, host='0.0.0.0', port=5001)
