# -*- coding: utf-8 -*-
"""Servicio de reconocimiento de gestos.

El estado se mantiene **por usuario**: cada sesión tiene su propio modelo asociado y
su propio antirrebote/último gesto. Antes existía un único modelo global, de modo que
si dos usuarios usaban la app a la vez el segundo reemplazaba el modelo del primero y
`/api/last-gesture` devolvía el gesto de otra persona.

Dos cachés acotadas evitan que ese aislamiento dispare la memoria (Render free, 512 MB):
  - `_modelos`: modelos cargados, indexados por la RUTA del archivo. Todos los usuarios
    que usan el modelo base comparten una sola entrada.
  - `_sesiones`: estado ligero por usuario (qué modelo usa y su último gesto).
"""
import os
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')
import glob
import sys
import threading
import time
from collections import OrderedDict

import numpy as np
from flask import Flask, request

from gestos_utils import vector_normalizado_coords
from rutas import dir_modelo, MODELO_BASE_DIR
from inferencia_tflite import cargar_modelo_tflite, predecir_tflite, convertir_h5_a_tflite

app = Flask(__name__)

# Antirrebote por movimiento (mismo criterio que el flujo clásico)
MOVEMENT_THRESHOLD = 0.02

# Usuario por defecto: solo para precargar un modelo al arrancar (warm-up)
DEFAULT_USER_ID = os.getenv("USER_ID", "1")

# ---------------------------------------------------------------------------
# Cachés acotadas
# ---------------------------------------------------------------------------

MODELOS_MAX = 3      # modelos distintos en memoria a la vez (el base suele bastar)
SESIONES_MAX = 500   # usuarios con estado de gestos recordado

_lock = threading.Lock()          # protege ambas cachés
_modelos = OrderedDict()          # ruta del modelo -> {"modelo", "mapa_inverso", "lock", "origen"}
_sesiones = OrderedDict()         # user_id -> {"model_key", "last_gesture", "last_time", "prev", "counter"}


def _resolver_rutas(model_user):
    """Devuelve (ruta_modelo, ruta_etiquetas, directorio_origen) para un usuario.

    Prueba primero el directorio del propio usuario y, si no tiene modelo, recurre al
    modelo base compartido.
    """
    dirs_a_probar = [dir_modelo(model_user)]
    if os.path.isdir(MODELO_BASE_DIR) and MODELO_BASE_DIR not in dirs_a_probar:
        dirs_a_probar.append(MODELO_BASE_DIR)

    for model_dir in dirs_a_probar:
        # El reconocimiento usa .tflite (ligero); si no existe, se convierte el .h5.
        tflite_candidates = [
            os.path.join(model_dir, "modelo_gestos.tflite"),
            os.path.join(model_dir, f"{model_user}_modelo_gestos.tflite"),
            os.path.join(model_dir, "base_modelo_gestos.tflite"),
        ]
        h5_candidates = [
            os.path.join(model_dir, "modelo_gestos.h5"),
            os.path.join(model_dir, f"{model_user}_modelo_gestos.h5"),
            os.path.join(model_dir, "base_modelo_gestos.h5"),
        ]
        label_candidates = [
            os.path.join(model_dir, "mapa_etiquetas.npy"),
            os.path.join(model_dir, f"{model_user}_mapa_etiquetas.npy"),
            os.path.join(model_dir, "base_mapa_etiquetas.npy"),
        ]

        tf_model_path = next((p for p in tflite_candidates if os.path.exists(p)), None)
        h5_path = next((p for p in h5_candidates if os.path.exists(p)), None)

        # Sin .tflite pero con .h5: convertir (best-effort, requiere Keras)
        if not tf_model_path and h5_path:
            target = os.path.join(model_dir, "modelo_gestos.tflite")
            if convertir_h5_a_tflite(h5_path, target):
                tf_model_path = target
            else:
                # Sin Keras en el runtime: se usa el .h5 directamente
                tf_model_path = h5_path

        label_path = next((p for p in label_candidates if os.path.exists(p)), None)

        if tf_model_path and label_path:
            return tf_model_path, label_path, model_dir

    # Respaldo: primer modelo + mapa de etiquetas que haya en los directorios
    for model_dir in dirs_a_probar:
        tflite_files = glob.glob(os.path.join(model_dir, "*.tflite"))
        h5_files = glob.glob(os.path.join(model_dir, "*.h5"))
        m = tflite_files[0] if tflite_files else (h5_files[0] if h5_files else None)
        npy_files = [f for f in glob.glob(os.path.join(model_dir, "*.npy"))
                     if "etiquetas" in os.path.basename(f)]
        label_path = npy_files[0] if npy_files else None
        if m and label_path:
            return m, label_path, model_dir

    raise FileNotFoundError(
        f"Modelo o mapa de etiquetas no encontrado para el usuario {model_user}. Entrena el modelo primero."
    )


def _cargar_entrada(model_path, label_map_path, origen):
    """Carga modelo + etiquetas desde disco (fuera del lock global: puede tardar)."""
    using_tflite = str(model_path).endswith(".tflite")
    if using_tflite:
        modelo = cargar_modelo_tflite(model_path)
    else:
        from keras.models import load_model
        modelo = load_model(model_path)

    mapa_etiquetas = np.load(label_map_path, allow_pickle=True).item()
    return {
        "modelo": modelo,
        "mapa_inverso": {v: k for k, v in mapa_etiquetas.items()},
        # El intérprete TFLite NO es thread-safe: waitress atiende en varios hilos,
        # así que cada modelo lleva su propio lock de inferencia.
        "lock": threading.Lock(),
        "origen": origen,
        "formato": "TFLite" if using_tflite else "Keras",
    }


def obtener_modelo(model_user):
    """Devuelve la entrada de caché del modelo de `model_user`, cargándolo si hace falta."""
    model_path, label_map_path, origen = _resolver_rutas(model_user)

    with _lock:
        entrada = _modelos.get(model_path)
        if entrada is not None:
            _modelos.move_to_end(model_path)
            return model_path, entrada

    entrada = _cargar_entrada(model_path, label_map_path, origen)

    with _lock:
        # Otro hilo pudo cargarlo mientras tanto: nos quedamos con el que ya está.
        existente = _modelos.get(model_path)
        if existente is not None:
            _modelos.move_to_end(model_path)
            return model_path, existente
        _modelos[model_path] = entrada
        while len(_modelos) > MODELOS_MAX:
            descartado, _ = _modelos.popitem(last=False)
            print(f"Modelo descargado de memoria por límite de caché: {descartado}")

    usando_base = os.path.basename(os.path.normpath(origen)) == "base"
    if usando_base:
        print(f"Usuario {model_user} sin modelo propio: usando el modelo base compartido ({model_path})")
    else:
        print(f"Modelo ({entrada['formato']}) cargado para user {model_user} desde {model_path}")
    return model_path, entrada


def _sesion(user_id, crear=True):
    """Estado de gestos del usuario. Devuelve None si no existe y `crear` es False."""
    with _lock:
        s = _sesiones.get(user_id)
        if s is not None:
            _sesiones.move_to_end(user_id)
            return s
        if not crear:
            return None
        s = {"model_key": None, "model_user": None, "last_gesture": None,
             "last_time": 0.0, "prev": None, "counter": 0}
        _sesiones[user_id] = s
        while len(_sesiones) > SESIONES_MAX:
            _sesiones.popitem(last=False)
        return s


def _entrada_de_sesion(s):
    """Modelo asociado a una sesión; None si fue expulsado de la caché."""
    if not s or not s["model_key"]:
        return None
    with _lock:
        entrada = _modelos.get(s["model_key"])
        if entrada is not None:
            _modelos.move_to_end(s["model_key"])
        return entrada


# Warm-up: deja el modelo por defecto listo en caché (no vincula sesión a nadie).
try:
    obtener_modelo(DEFAULT_USER_ID)
    print(f"Modelo precargado (warm-up) para user {DEFAULT_USER_ID}")
except Exception as e:
    print(f"Warning: no se pudo precargar el modelo por defecto: {e}")
    print("Se cargará bajo demanda vía /api/load-model")


@app.route('/api/load-model', methods=['POST'])
def load_model_endpoint():
    """Vincula la sesión de `userId` a un modelo (`modelUser`: su id o 'base')."""
    try:
        payload = request.get_json(silent=True) or {}
        user_id = request.args.get('userId') or payload.get('userId')
        if not user_id:
            return {"success": False, "message": "userId parameter required"}, 400

        # Qué modelo usar para esa sesión (por defecto, el del propio usuario)
        model_user = request.args.get('modelUser') or payload.get('modelUser') or user_id

        model_key, _ = obtener_modelo(model_user)
        s = _sesion(str(user_id))
        # Cambiar de modelo reinicia el antirrebote y el último gesto de esa sesión.
        s["model_key"] = model_key
        # Se recuerda la ELECCIÓN además de la ruta: si el modelo se expulsa de la caché
        # hay que recargar el que el usuario eligió, no el suyo propio por defecto.
        s["model_user"] = str(model_user)
        s["last_gesture"] = None
        s["last_time"] = 0.0
        s["prev"] = None
        s["counter"] = 0

        return {"success": True, "message": f"Model loaded for user {user_id}"}, 200
    except FileNotFoundError as e:
        return {"success": False, "message": str(e)}, 404
    except Exception as e:
        return {"success": False, "message": f"Error loading model: {str(e)}"}, 500


@app.route('/api/last-gesture', methods=['GET'])
def get_last_gesture():
    """Último gesto detectado por ESE usuario."""
    user_id = request.args.get('userId')
    if not user_id:
        return {"gesture": None}, 200

    s = _sesion(str(user_id), crear=False)
    if s and s["last_gesture"] and (time.time() - s["last_time"]) < 3:
        return {"gesture": s["last_gesture"], "timestamp": s["last_time"]}, 200
    return {"gesture": None}, 200


@app.route('/api/predecir', methods=['POST'])
def predecir():
    """Predice la letra a partir de los 21 landmarks {x,y,z} enviados desde el navegador.

    El navegador corre MediaPipe Hands (JS), calcula las mismas features normalizadas
    que el entrenamiento y aquí solo se hace la clasificación con el modelo de ESA sesión.
    """
    data = request.get_json(silent=True) or {}
    user_id = request.args.get('userId') or data.get('userId')
    if not user_id:
        return {"success": False, "message": "userId requerido."}, 400
    user_id = str(user_id)

    coords = data.get('coords')
    if not coords or len(coords) != 21:
        return {"success": False, "message": "Se requieren 21 landmarks."}, 400

    try:
        puntos = [(float(c[0]), float(c[1]), float(c[2])) for c in coords]
    except Exception:
        return {"success": False, "message": "Formato de landmarks inválido."}, 400

    s = _sesion(user_id)
    entrada = _entrada_de_sesion(s)
    if entrada is None:
        # Sin sesión previa, o el modelo fue expulsado de la caché: se recarga la
        # elección que hizo el usuario ('base' o su propio modelo). Sin sesión previa,
        # su modelo propio, con respaldo al base.
        eleccion = s["model_user"] or user_id
        try:
            model_key, entrada = obtener_modelo(eleccion)
        except FileNotFoundError as e:
            return {"success": False, "message": str(e)}, 404
        s["model_key"] = model_key
        s["model_user"] = str(eleccion)

    vector_modelo = vector_normalizado_coords(puntos)
    crudo = [v for p in puntos for v in p]

    if len(vector_modelo) != 63:
        return {"success": False, "message": "Modelo no cargado para predecir."}, 400

    modelo = entrada["modelo"]
    with entrada["lock"]:
        if isinstance(modelo, dict):  # wrapper TFLite
            prediccion = predecir_tflite(modelo, vector_modelo)
        else:  # modelo Keras
            prediccion = modelo.predict(np.array([vector_modelo]), verbose=0)

    mapa_inverso = entrada["mapa_inverso"]
    indice = int(np.argmax(prediccion))
    confianza = float(prediccion[0][indice])
    etiqueta = mapa_inverso.get(indice)

    # Antirrebote por movimiento, propio de esta sesión
    if s["prev"] is not None:
        movement = np.linalg.norm(np.array(crudo) - np.array(s["prev"]))
        s["counter"] = s["counter"] + 1 if movement > MOVEMENT_THRESHOLD else 0
    s["prev"] = crudo

    if s["counter"] == 0 and etiqueta is not None:
        s["last_gesture"] = etiqueta
        s["last_time"] = time.time()

    top3 = [(mapa_inverso[int(i)], round(float(prediccion[0][int(i)]), 3))
            for i in np.argsort(prediccion[0])[::-1][:3]]
    gesto_actual = s["last_gesture"] if (time.time() - s["last_time"]) < 3 else None

    return {"success": True, "gesture": gesto_actual, "top": top3, "confidence": confianza}, 200


@app.route('/api/health')
@app.route('/health')
def health():
    return "Flask server is running.", 200


if __name__ == "__main__":
    print("Starting reconocimiento.py...")
    PORT = int(os.getenv("FLASK_REC_PORT", "5000"))
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
