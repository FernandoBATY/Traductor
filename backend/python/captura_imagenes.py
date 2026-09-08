# -*- coding: utf-8 -*-
import os
import sys

import cv2
import numpy as np
from flask import Flask, request
from flask_cors import CORS

# Suppress TensorFlow Lite and MediaPipe warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

# Initialize Flask app and enable CORS
app = Flask(__name__)
CORS(app)

# Base directory for storing user-specific training data
base_dir = os.path.dirname(__file__)
backend_dir = os.path.dirname(base_dir)
usuarios_entrenamientos_dir = os.path.join(backend_dir, "usuarios-entrenamientos")
os.makedirs(usuarios_entrenamientos_dir, exist_ok=True)


@app.route('/capture_image', methods=['POST'])
def capture_image():
    """Guarda una imagen capturada por el navegador (getUserMedia -> canvas -> POST binario)."""
    user_id = request.args.get('userId')
    letter = request.args.get('letter')

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

    datos_imagen = request.get_data(cache=False)
    if not datos_imagen:
        return {"success": False, "message": "No se recibió imagen."}, 400

    arr = np.frombuffer(datos_imagen, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        return {"success": False, "message": "Imagen recibida inválida."}, 400

    # Determine the next sequential filename
    existing_files = [f for f in os.listdir(letter_dir) if f.endswith(".jpg")]
    next_number = len(existing_files) + 1
    image_filename = f"{letter.upper()}_{next_number}.jpg"
    image_path = os.path.join(letter_dir, image_filename)

    frame_resized = cv2.resize(frame, (224, 224))  # Resize for compatibility with training
    success = cv2.imwrite(image_path, frame_resized)

    if not success:
        print(f"Error: Failed to write image at {image_path}")
        return {"success": False, "message": f"Failed to write image to disk"}, 500

    print(f"Image saved at {image_path}.")
    return {"success": True, "message": f"Image {image_filename} saved for letter {letter.upper()}", "path": image_path}, 200


@app.route('/health')
def health():
    return "OK", 200


if __name__ == "__main__":
    print("Starting captura_imagenes.py Flask server...")
    PORT = int(os.getenv("FLASK_CAPTURE_PORT", "5001"))
    try:
        from waitress import serve
        print(f"Using Waitress WSGI server on port {PORT}")
        serve(app, host='0.0.0.0', port=PORT, _quiet=False)
    except ImportError:
        print(f"Waitress not available, using Flask development server on port {PORT}")
        app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
    except Exception as e:
        print(f"Error starting Flask server: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)