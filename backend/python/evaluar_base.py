# -*- coding: utf-8 -*-
"""Evalúa el modelo base sobre el split test ORIGINAL del dataset de Roboflow.

Uso:
    python evaluar_base.py --voc <carpeta_voc_original>
"""
import os
import sys
import glob
import argparse
import xml.etree.ElementTree as ET

import cv2
import mediapipe as mp
import numpy as np
from keras.models import load_model
from gestos_utils import area_mano, vector_normalizado_coords

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
MODELO_PATH = os.path.join(BACKEND_DIR, "modelos", "base", "base_modelo_gestos.h5")
MAPA_PATH = os.path.join(BACKEND_DIR, "modelos", "base", "base_mapa_etiquetas.npy")
MARGEN = 0.35


def recortar(imagen, caja):
    h, w = imagen.shape[:2]
    xmin, ymin, xmax, ymax = caja
    m = max(int(MARGEN * max(xmax - xmin, ymax - ymin)), 5)
    xmin = max(0, xmin - m)
    ymin = max(0, ymin - m)
    xmax = min(w, xmax + m)
    ymax = min(h, ymax + m)
    return imagen[ymin:ymax, xmin:xmax]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--voc", default=r"C:\Users\bryan\Desktop\Traductor\Lengua de Senas Mexicana.v5i.voc")
    args = parser.parse_args()
    split = os.path.join(args.voc, "test")
    modelo = load_model(MODELO_PATH)
    mapa = np.load(MAPA_PATH, allow_pickle=True).item()
    inverso = {v: k for k, v in mapa.items()}

    mp_hands = mp.solutions.hands
    aciertos = 0
    total = 0
    por_letra = {}

    with mp_hands.Hands(static_image_mode=True, max_num_hands=2, min_detection_confidence=0.5) as hands:
        for xml_path in sorted(glob.glob(os.path.join(split, "*.xml"))):
            root = ET.parse(xml_path).getroot()
            fname = root.findtext("filename")
            imagen = cv2.imread(os.path.join(split, fname))
            if imagen is None:
                continue
            for obj in root.findall("object"):
                letra = (obj.findtext("name") or "").strip().upper()
                box = obj.find("bndbox")
                if box is None or letra not in mapa:
                    continue
                caja = tuple(int(round(float(box.findtext(e)))) for e in ("xmin", "ymin", "xmax", "ymax"))
                recorte = recortar(imagen, caja)
                r = hands.process(cv2.cvtColor(recorte, cv2.COLOR_BGR2RGB))
                if not r.multi_hand_landmarks:
                    por_letra.setdefault(letra, [0, 1])
                    por_letra[letra][1] += 1
                    total += 1
                    continue
                mejor = max(r.multi_hand_landmarks, key=area_mano)
                coords = np.array([(p.x, p.y, p.z) for p in mejor.landmark], dtype=np.float32)
                pred = np.argmax(modelo.predict(np.array([vector_normalizado_coords(coords)]), verbose=0))
                correcto = (letra == inverso[int(pred)])
                aciertos += int(correcto)
                total += 1
                e = por_letra.setdefault(letra, [0, 0])
                e[0] += int(correcto)
                e[1] += 1

    print(f"\nPrecisión en TEST real: {aciertos}/{total} = {100 * aciertos / total:.1f}%")
    for letra in sorted(por_letra):
        ok, n = por_letra[letra]
        print(f"  {letra}: {ok}/{n} ({100 * ok / n:.0f}%)")


if __name__ == "__main__":
    main()