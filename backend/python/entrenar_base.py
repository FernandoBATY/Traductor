# -*- coding: utf-8 -*-
"""Entrena el modelo BASE compartido a partir del dataset de Roboflow.

Lee las imágenes recortadas de backend/usuarios-entrenamientos/base/{LETRA}/*.jpg,
extrae landmarks de MediaPipe, aplica aumento de datos (espejo + ruido) y
entrena un MLP robusto con división estratificada y parada temprana.

Uso:
    python entrenar_base.py
"""
import os
import glob
import random

import cv2
import mediapipe as mp
import numpy as np
import tensorflow as tf
from tensorflow import keras
from keras.models import Sequential
from keras.layers import Dense, Dropout, BatchNormalization
from keras.optimizers import Adam
from gestos_utils import area_mano, vector_normalizado_coords, espejar_coords

random.seed(42)
np.random.seed(42)
tf.random.set_seed(42)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
ORIGEN = os.path.join(BACKEND_DIR, "usuarios-entrenamientos", "base")
MODELO_DIR = os.path.join(BACKEND_DIR, "modelos", "base")
MODELO_PATH = os.path.join(MODELO_DIR, "base_modelo_gestos.h5")
MAPA_PATH = os.path.join(MODELO_DIR, "base_mapa_etiquetas.npy")

ROZAMIENTO_LISTA = [0.0, 0.01, 0.02]  # ruido gaussiano (sigma) adicional
USAR_ESPEJO = True
EPOCHS = 300
PATIENCE = 40
VALIDACION = 0.15
BATCH = 32


def extraer_muestras_usuario_grande(imagen_rgb, hands):
    """Devuelve (coords, n_manos) de la mano más grande, o (None, 0)."""
    resultados = hands.process(imagen_rgb)
    if not resultados.multi_hand_landmarks:
        return None, 0
    mejor = max(resultados.multi_hand_landmarks, key=area_mano)
    coords = np.array([(p.x, p.y, p.z) for p in mejor.landmark], dtype=np.float32)
    return coords, len(resultados.multi_hand_landmarks)


def construir_muestras():
    """Devuelve (letras, lista de vectores de 63) con aumento de datos."""
    letras = []
    vectores = []
    estadisticas = {}
    mp_hands = mp.solutions.hands

    with mp_hands.Hands(
        static_image_mode=True, max_num_hands=2, min_detection_confidence=0.5
    ) as hands:
        for letra in sorted(os.listdir(ORIGEN)):
            carpeta = os.path.join(ORIGEN, letra)
            if not os.path.isdir(carpeta):
                continue
            elegidas = 0
            total_imagenes = 0
            for imagen_path in sorted(glob.glob(os.path.join(carpeta, "*.jpg"))):
                total_imagenes += 1
                imagen = cv2.imread(imagen_path)
                if imagen is None:
                    continue
                coords, _ = extraer_muestras_usuario_grande(
                    cv2.cvtColor(imagen, cv2.COLOR_BGR2RGB), hands
                )
                if coords is None:
                    continue
                elegidas += 1

                variantes = []
                variantes.append(vector_normalizado_coords(coords))
                if USAR_ESPEJO:
                    variantes.append(vector_normalizado_coords(espejar_coords(coords)))
                for sigma in ROZAMIENTO_LISTA:
                    if sigma == 0.0:
                        continue
                    ruido_o = np.random.normal(0, sigma, size=(21, 3))
                    variantes.append(vector_normalizado_coords(coords + ruido_o))
                    if USAR_ESPEJO:
                        espejo_r = np.array(espejar_coords(coords)) + np.random.normal(0, sigma, size=(21, 3))
                        variantes.append(vector_normalizado_coords(espejo_r))

                for v in variantes:
                    letras.append(letra)
                    vectores.append(v)

            estadisticas[letra] = (elegidas, total_imagenes)
            print(f"  {letra}: {elegidas}/{total_imagenes} imágenes -> muestras con aumento")

    return letras, vectores, estadisticas


def main():
    print("=== Entrenando MODELO BASE compartido ===")
    print(f"Origen de imágenes: {ORIGEN}\n")

    os.makedirs(MODELO_DIR, exist_ok=True)
    letras, vectores, estadisticas = construir_muestras()

    if not letras:
        raise ValueError("No se generaron muestras. Verifica la carpeta base.")

    datos = np.array(vectores, dtype=np.float32)
    etiquetas = np.array(letras)
    clases = sorted(set(letras))
    mapa_etiquetas = {c: i for i, c in enumerate(clases)}
    y = np.array([mapa_etiquetas[l] for l in letras])

    # División estratificada por letra
    train_idx, val_idx = [], []
    for clase in clases:
        idxs = np.where(y == mapa_etiquetas[clase])[0]
        rng = np.random.default_rng(42)
        perm = rng.permutation(len(idxs))
        corte = int(len(idxs) * (1 - VALIDACION))
        train_idx.extend(idxs[perm[:corte]])
        val_idx.extend(idxs[perm[corte:]])
    train_idx = np.array(train_idx)
    val_idx = np.array(val_idx)

    conteo_clase = {c: int(np.sum(y[train_idx] == mapa_etiquetas[c])) for c in clases}
    total_train = len(train_idx)
    class_weight = {
        mapa_etiquetas[c]: total_train / (len(clases) * conteo_clase[c])
        for c in clases
    }

    print(f"\nMuestras totales: {len(datos)} | Entrenamiento: {len(train_idx)} | Validación: {len(val_idx)}")
    print(f"Clases ({len(clases)}): {', '.join(clases)}")

    modelo = Sequential([
        Dense(256, activation="relu", input_shape=(63,)),
        BatchNormalization(),
        Dropout(0.3),
        Dense(128, activation="relu"),
        BatchNormalization(),
        Dropout(0.2),
        Dense(64, activation="relu"),
        Dropout(0.1),
        Dense(len(clases), activation="softmax")
    ])
    modelo.compile(
        optimizer=Adam(learning_rate=0.001),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )

    early = keras.callbacks.EarlyStopping(
        monitor="val_accuracy", patience=PATIENCE, restore_best_weights=True, mode="max"
    )
    reduccion = keras.callbacks.ReduceLROnPlateau(
        monitor="val_accuracy", factor=0.5, patience=10, min_lr=1e-5, verbose=1
    )

    modelo.fit(
        datos[train_idx],
        y[train_idx],
        validation_data=(datos[val_idx], y[val_idx]),
        epochs=EPOCHS,
        batch_size=BATCH,
        class_weight=class_weight,
        callbacks=[early, reduccion],
        verbose=2,
    )

    _, acc = modelo.evaluate(datos[val_idx], y[val_idx], verbose=0)
    print(f"\nPrecisión en validación (datos no vistos): {acc * 100:.1f}%")

    modelo.save(MODELO_PATH)
    np.save(MAPA_PATH, mapa_etiquetas)
    # Copias con nombres genéricos por si otra ruta los busca
    for nombre_modelo, nombre_mapa in (
        ("modelo_gestos.h5", "mapa_etiquetas.npy"),
        ("base_modelo_gestos.h5", "base_mapa_etiquetas.npy"),
    ):
        if not os.path.exists(os.path.join(MODELO_DIR, nombre_modelo)):
            import shutil
            shutil.copy(MODELO_PATH, os.path.join(MODELO_DIR, nombre_modelo))
            shutil.copy(MAPA_PATH, os.path.join(MODELO_DIR, nombre_mapa))

    print(f"Modelo base guardado en: {MODELO_PATH}")
    print(f"Mapa de etiquetas guardado en: {MAPA_PATH}")

    # Convertir el modelo base a TensorFlow Lite para el reconocimiento ligero
    try:
        import tensorflow as tf
        tflite_base = os.path.join(MODELO_DIR, "base_modelo_gestos.tflite")
        converter = tf.lite.TFLiteConverter.from_keras_model(modelo)
        with open(tflite_base, "wb") as f:
            f.write(converter.convert())
        # Copia con nombre genérico por si otra ruta lo busca
        tflite_gen = os.path.join(MODELO_DIR, "modelo_gestos.tflite")
        if not os.path.exists(tflite_gen):
            import shutil
            shutil.copy(tflite_base, tflite_gen)
        print(f"Modelo base convertido a TFLite: {tflite_base}")
    except Exception as e:
        print(f"AVISO: no se pudo convertir el modelo base a TFLite: {e}")


if __name__ == "__main__":
    main()