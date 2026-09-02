# -*- coding: utf-8 -*-
"""Inferencia ligera vía TensorFlow Lite para el reconocimiento en tiempo real.

En producción (Render, plan gratuito) la RAM es limitada, así que NO se importa el
TensorFlow completo; se usa `tflite-runtime` (~30-50 MB). Si no está disponible
(por ejemplo en el entorno local), se usa `tensorflow.lite` como respaldo.

El entrenamiento (entrenamiento.py / entrenar_base.py) sigue usando Keras/TensorFlow
completo; aquí solo se ejecuta la clasificación.
"""
import os
import numpy as np

_interp_cls = None

def _get_interpreter():
    global _interp_cls
    if _interp_cls is not None:
        return _interp_cls
    try:
        from tflite_runtime.interpreter import Interpreter
        _interp_cls = Interpreter
    except ImportError:
        import tensorflow as tf
        _interp_cls = tf.lite.Interpreter
    return _interp_cls


def cargar_modelo_tflite(model_path):
    """Carga un modelo TFLite y devuelve un 'wrapper' listo para predecir."""
    Interpreter = _get_interpreter()
    interp = Interpreter(model_path=model_path)
    interp.allocate_tensors()
    inp = interp.get_input_details()[0]
    out = interp.get_output_details()[0]
    return {
        "interp": interp,
        "inp": inp,
        "out": out,
        "path": model_path,
    }


def predecir_tflite(modelo, vector):
    """Ejecuta la inferencia. `modelo` es lo devuelto por `cargar_modelo_tflite`.

    `vector` debe ser una secuencia de 63 floats (o (1,63)). Devuelve un np.array
    (1, N) con las probabilidades por cada clase.
    """
    x = np.asarray(vector, dtype=np.float32).reshape(1, -1)
    interp = modelo["interp"]
    inp = modelo["inp"]
    out = modelo["out"]
    interp.set_tensor(inp["index"], x)
    interp.invoke()
    res = interp.get_tensor(out["index"])
    if res.ndim == 1:
        res = res[None, :]
    return res


def convertir_h5_a_tflite(h5_path, tflite_path):
    """Convierte un modelo Keras (.h5) a TFLite (.tflite), usando el mejor backend disponible."""
    try:
        import tensorflow as tf
    except ImportError:
        return False
    try:
        from keras.models import load_model
        modelo_keras = load_model(h5_path, compile=False)
        converter = tf.lite.TFLiteConverter.from_keras_model(modelo_keras)
        tflite_model = converter.convert()
        with open(tflite_path, "wb") as f:
            f.write(tflite_model)
        return True
    except Exception as e:
        print(f"Error convirtiendo {h5_path} a TFLite: {e}")
        return False
