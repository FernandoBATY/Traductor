# -*- coding: utf-8 -*-
"""Utilidades compartidas para extraer características de las manos de MediaPipe.

Tanto el entrenamiento (entrenamiento.py / entrenar_base.py) como el
reconocimiento (reconocimiento.py) usan estas funciones para que los modelos
se entrenen y predigan con exactamente las mismas características.
"""
import math


def _coord(punto):
    if hasattr(punto, "x"):
        return (punto.x, punto.y, punto.z)
    return tuple(punto)


def _normalizar_puntos(puntos):
    """Devuelve 63 valores normalizados (anclados en muñeca y a escala constante)
    a partir de una secuencia de 21 puntos {x,y,z} o tuplas (x,y,z)."""
    ref_puntos = [_coord(p) for p in puntos]
    muneca = ref_puntos[0]
    base_medio = ref_puntos[9]
    dx = base_medio[0] - muneca[0]
    dy = base_medio[1] - muneca[1]
    dz = base_medio[2] - muneca[2]
    ref = math.sqrt(dx * dx + dy * dy + dz * dz)
    if ref < 1e-6:
        ref = 1e-6
    gesto = []
    for p in ref_puntos:
        gesto.extend(
            [
                (p[0] - muneca[0]) / ref,
                (p[1] - muneca[1]) / ref,
                (p[2] - muneca[2]) / ref,
            ]
        )
    return gesto


def vector_crudo(landmarks):
    """Devuelve los 63 valores crudos [x,y,z] de los 21 landmarks."""
    return [c for p in landmarks.landmark for c in _coord(p)]


def vector_normalizado(landmarks):
    """Características invariantes a posición y escala: 63 valores."""
    return _normalizar_puntos(landmarks.landmark)


def vector_normalizado_coords(coords):
    """Igual que vector_normalizado pero a partir de una lista de tuplas (x,y,z)."""
    return _normalizar_puntos(coords)


def espejar_coords(coords):
    """Devuelve coordenadas espejadas en X para aumento de datos (simula mano derecha/izquierda)."""
    return [(1.0 - p[0], p[1], p[2]) for p in coords]


def area_mano(landmarks):
    """Área aproximada de la mano (para elegir la más grande si hay varias)."""
    pts = [_coord(p) for p in landmarks.landmark]
    idx = [0, 9]
    dx = pts[9][0] - pts[0][0]
    dy = pts[9][1] - pts[0][1]
    dz = pts[9][2] - pts[0][2]
    return dx * dx + dy * dy + dz * dz