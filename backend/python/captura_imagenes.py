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
import threading
import time

# Suppress TensorFlow Lite and MediaPipe warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
logging.getLogger('tensorflow').setLevel(logging.ERROR)
absl.logging.set_verbosity(absl.logging.ERROR)

# Initialize Flask app and enable CORS
app = Flask(__name__)
CORS(app)

# Base directory for storing user-specific training data
base_dir = os.path.dirname(__file__)
backend_dir = os.path.dirname(base_dir)
usuarios_entrenamientos_dir = os.path.join(backend_dir, "usuarios-entrenamientos")
os.makedirs(usuarios_entrenamientos_dir, exist_ok=True)

# Initialize MediaPipe
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(min_detection_confidence=0.8, min_tracking_confidence=0.8)

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
    print("Error: Could not open camera after {} attempts.".format(max_retries))
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

def validate_image(frame):
    if frame is None or frame.size == 0:
        return False
    if frame.shape[0] == 0 or frame.shape[1] == 0:
        return False
    return True

def generate_frames():
    while camera_active and cap is not None and cap.isOpened():
        ret, frame = cap.read()
        if not ret or not validate_image(frame):
            continue
        global last_frame_time
        last_frame_time = time.time()

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
    if not camera_active:
        return Response("Camera inactive", status=503)
    if cap is None or not cap.isOpened():
        # Try open once to recover
        if not open_camera():
            return Response("Camera open failed", status=503)
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/camera/open', methods=['POST'])
def camera_open():
    if open_camera():
        return "Camera opened", 200
    return "Failed to open camera", 500

@app.route('/camera/close', methods=['POST'])
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

    # Create user-specific directory structure in usuarios-entrenamientos
    user_dir = os.path.join(usuarios_entrenamientos_dir, user_id)
    letter_dir = os.path.join(user_dir, letter.upper())
    os.makedirs(letter_dir, exist_ok=True)

    # Ensure camera is active
    if not camera_active:
        if not open_camera():
            return "Camera not available", 500
    # Capture and save the image
    ret, frame = cap.read()
    if not ret:
        print("Error: Failed to capture image from the camera.")
        return "Failed to capture image.", 500

    # Determine the next sequential filename
    existing_files = [f for f in os.listdir(letter_dir) if f.endswith(".jpg")]
    next_number = len(existing_files) + 1
    image_filename = f"{letter.upper()}_{next_number}.jpg"
    image_path = os.path.join(letter_dir, image_filename)

    # Save the image - resize and save without color conversion
    # (imwrite expects BGR format, which is what we have from cap.read())
    frame_resized = cv2.resize(frame, (224, 224))  # Resize for compatibility with training
    success = cv2.imwrite(image_path, frame_resized)
    
    if not success:
        print(f"Error: Failed to write image at {image_path}")
        return {"success": False, "message": f"Failed to write image to disk"}, 500

    print(f"Image saved at {image_path}.")
    return {"success": True, "message": f"Image {image_filename} saved for letter {letter.upper()}", "path": image_path}, 200

@app.route('/train_model')
def train_model():
    try:
        # Get the user ID from the query parameters
        user_id = request.args.get('userId')
        if not user_id:
            return {"success": False, "message": "User ID is required."}, 400

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
        return {"success": True, "message": "Model trained successfully.", "output": result.stdout}, 200

    except subprocess.CalledProcessError as e:
        # Log the error output for debugging
        print("Error al entrenar el modelo:", e.stderr)
        return {"success": False, "message": "Error training model.", "error": e.stderr}, 500

    except Exception as e:
        # Catch any other exceptions and log them
        print("Unexpected error:", str(e))
        return {"success": False, "message": "Unexpected error.", "error": str(e)}, 500

if __name__ == "__main__":
    print("Starting captura_imagenes.py Flask server on port 5001...")
    try:
        from waitress import serve
        print("Using Waitress WSGI server")
        serve(app, host='0.0.0.0', port=5001, _quiet=False)
    except ImportError:
        print("Waitress not available, using Flask development server")
        app.run(host='0.0.0.0', port=5001, debug=False, threaded=True)
    except Exception as e:
        print(f"Error starting Flask server: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
