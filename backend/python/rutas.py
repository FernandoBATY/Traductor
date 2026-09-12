# -*- coding: utf-8 -*-
"""Rutas de datos compartidas por los scripts de Python.

Equivalente a backend/config/paths.js: los datos de usuario (imágenes capturadas y
modelos entrenados) salen de DATA_DIR, que puede apuntar a un disco persistente.
Sin DATA_DIR se usa el directorio del backend, que en Render es EFÍMERO y se borra
en cada reinicio.

El modelo BASE viaja siempre dentro de la imagen, así que se resuelve contra el
directorio del backend y nunca depende de DATA_DIR.
"""
import os

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PERSISTENTE = bool(os.getenv("DATA_DIR"))
DATA_DIR = os.getenv("DATA_DIR") or BACKEND_DIR

ENTRENAMIENTOS_DIR = os.path.join(DATA_DIR, "usuarios-entrenamientos")
MODELOS_DIR = os.path.join(DATA_DIR, "modelos")
MODELO_BASE_DIR = os.path.join(BACKEND_DIR, "modelos", "base")


def dir_entrenamiento(user_id):
    return os.path.join(ENTRENAMIENTOS_DIR, str(user_id))


def dir_modelo(user_id):
    """Directorio del modelo de un usuario. 'base' siempre sale de la imagen."""
    if str(user_id) == "base":
        return MODELO_BASE_DIR
    return os.path.join(MODELOS_DIR, str(user_id))


def asegurar_directorios():
    for d in (ENTRENAMIENTOS_DIR, MODELOS_DIR):
        os.makedirs(d, exist_ok=True)
