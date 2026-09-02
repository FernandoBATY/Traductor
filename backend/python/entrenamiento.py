# -*- coding: utf-8 -*-
import cv2
import os
import mediapipe as mp
import numpy as np
import tensorflow as tf
from tensorflow import keras
from keras.models import Sequential
from keras.layers import Dense, Dropout
from keras.optimizers import Adam
from gestos_utils import area_mano, vector_normalizado
import sys

# Enable eager execution
tf.config.run_functions_eagerly(True)

# Get the user ID from the command-line arguments
if len(sys.argv) < 2:
    raise ValueError("User ID is required as a command-line argument.")
user_id = sys.argv[1]

# Directory for gesture images and user-specific model paths
base_dir = os.path.dirname(__file__)
backend_dir = os.path.dirname(base_dir)
usuarios_entrenamientos_dir = os.path.join(backend_dir, "usuarios-entrenamientos")
user_training_dir = os.path.join(usuarios_entrenamientos_dir, user_id)
modelo_dir = os.path.join(backend_dir, "modelos", user_id)
modelo_path = os.path.join(modelo_dir, f"{user_id}_modelo_gestos.h5")
mapa_etiquetas_path = os.path.join(modelo_dir, f"{user_id}_mapa_etiquetas.npy")

# Ensure the model directory exists
os.makedirs(modelo_dir, exist_ok=True)

print(f"\n=== Entrenamiento del Modelo para Usuario {user_id} ===")
print(f"Leyendo datos de: {user_training_dir}")
print(f"Guardando modelo en: {modelo_dir}\n")

# Initialize MediaPipe
mp_hands = mp.solutions.hands
hands = mp_hands.Hands()

# Validate directories and files
if not os.path.exists(user_training_dir):
    raise FileNotFoundError(f"El directorio de gestos para el usuario {user_id} no existe: {user_training_dir}")

if len(os.listdir(user_training_dir)) == 0:
    raise FileNotFoundError(f"No se encontraron imágenes en el directorio: {user_training_dir}")

# Collect data and labels
datos = []
etiquetas = []

for letter in os.listdir(user_training_dir):
    letter_dir = os.path.join(user_training_dir, letter)
    if not os.path.isdir(letter_dir):
        continue

    for archivo in os.listdir(letter_dir):
        if not archivo.endswith(".jpg"):
            continue

        image_path = os.path.join(letter_dir, archivo)
        imagen = cv2.imread(image_path)
        if imagen is None:
            print(f"Error al leer la imagen: {archivo}")
            continue

        imagen_rgb = cv2.cvtColor(imagen, cv2.COLOR_BGR2RGB)
        resultados = hands.process(imagen_rgb)

        if resultados.multi_hand_landmarks:
            # Si hay varias manos, tomamos la más grande (la del gesto principal)
            mejor = max(resultados.multi_hand_landmarks, key=area_mano)
            gesto = vector_normalizado(mejor)
            datos.append(gesto)
            etiquetas.append(letter)
        else:
            print(f"No se detectaron manos en la imagen: {archivo}")

# Validate data
if len(datos) == 0:
    raise ValueError("No se encontraron datos de gestos. Asegúrate de que las imágenes estén correctamente capturadas.")
if len(datos) != len(etiquetas):
    raise ValueError("El número de datos y etiquetas no coincide. Verifica las imágenes y sus etiquetas.")

# Convert data and labels to numpy arrays
datos = np.array(datos)
etiquetas = np.array(etiquetas)

# Check if existing model and label map exist
if os.path.exists(modelo_path) and os.path.exists(mapa_etiquetas_path):
    # Load existing model and label map
    modelo = keras.models.load_model(modelo_path)
    mapa_etiquetas = np.load(mapa_etiquetas_path, allow_pickle=True).item()
    print("Modelo y mapa de etiquetas existente cargado.")
    
    # Check if new labels are compatible with existing model
    unicos_actuales = np.unique(etiquetas)
    nuevas_etiquetas = set(unicos_actuales) - set(mapa_etiquetas.keys())
    
    if nuevas_etiquetas:
        print(f"Nuevas etiquetas detectadas: {nuevas_etiquetas}")
        # Add new labels to existing map
        for etiqueta in nuevas_etiquetas:
            mapa_etiquetas[etiqueta] = len(mapa_etiquetas)
        
        # Rebuild model with updated number of classes
        input_shape = modelo.layers[0].input_shape[1:]
        modelo = Sequential([
            Dense(256, activation="relu", input_shape=input_shape),
            Dropout(0.4),
            Dense(128, activation="relu"),
            Dropout(0.3),
            Dense(64, activation="relu"),
            Dropout(0.2),
            Dense(len(mapa_etiquetas), activation="softmax")
        ])
        modelo.compile(optimizer=Adam(learning_rate=0.001), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
        print(f"Modelo reconstruido para {len(mapa_etiquetas)} clases.")
    
    # Map current labels using existing/updated map
    etiquetas_numericas = np.array([mapa_etiquetas[e] for e in etiquetas])
    
else:
    # Create new model and label map
    unicos = np.unique(etiquetas)
    if len(unicos) == 0:
        raise ValueError("No se encontraron etiquetas únicas. Asegúrate de que las imágenes estén etiquetadas correctamente.")
    
    mapa_etiquetas = {etiqueta: i for i, etiqueta in enumerate(unicos)}
    etiquetas_numericas = np.array([mapa_etiquetas[e] for e in etiquetas])
    
    modelo = Sequential([
        Dense(256, activation="relu", input_shape=(len(datos[0]),)),
        Dropout(0.4),
        Dense(128, activation="relu"),
        Dropout(0.3),
        Dense(64, activation="relu"),
        Dropout(0.2),
        Dense(len(unicos), activation="softmax")
    ])
    modelo.compile(optimizer=Adam(learning_rate=0.001), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    print(f"Nuevo modelo creado para {len(unicos)} clases: {list(mapa_etiquetas.keys())}")

print(f"Entrenamiento con {len(etiquetas)} muestras, {len(mapa_etiquetas)} clases: {list(mapa_etiquetas.keys())}")
print(f"Rango de etiquetas numéricas: {min(etiquetas_numericas)} - {max(etiquetas_numericas)}")
print(f"Número de neuronas de salida del modelo: {modelo.output_shape[-1]}")

# Train the model
try:
    modelo.fit(datos, etiquetas_numericas, epochs=50, batch_size=32, validation_split=0.2, shuffle=True)
except Exception as e:
    raise RuntimeError(f"Error durante el entrenamiento del modelo: {e}")

# Save the model and label map
modelo.save(modelo_path)
np.save(mapa_etiquetas_path, mapa_etiquetas)
print(f"Entrenamiento completo. Modelo guardado en {modelo_path}.")

# Convertir a TensorFlow Lite para el reconocimiento ligero (arranque rápido y poca RAM)
try:
    import tensorflow as tf
    tflite_path = os.path.join(modelo_dir, f"{user_id}_modelo_gestos.tflite")
    converter = tf.lite.TFLiteConverter.from_keras_model(modelo)
    tflite_model = converter.convert()
    with open(tflite_path, "wb") as f:
        f.write(tflite_model)
    print(f"Modelo convertido a TFLite: {tflite_path}")
except Exception as e:
    print(f"AVISO: no se pudo convertir a TFLite (se mantiene .h5): {e}")