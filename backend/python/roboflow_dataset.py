# -*- coding: utf-8 -*-
"""Convierte el dataset "Lengua de Señas Mexicana" de Roboflow (formato Pascal VOC)
en carpetas por letra dentro de backend/usuarios-entrenamientos/base/.

Uso:
    python roboflow_dataset.py --voc <ruta_al.zip_o_carpeta> [--out <destino>]

--voc puede ser:
  - un ZIP descargado de Roboflow (formato "Pascal VOC"),
  - o una carpeta ya descomprimida con splits train/valid/test.

Se recortan las manos con las cajas anotadas y se guarda una imagen .jpg por letra.
Las clases no alfabéticas (ñ, rr) se ignoran.
"""
import os
import sys
import glob
import zipfile
import argparse
import xml.etree.ElementTree as ET

import cv2

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
DEFAULT_OUT = os.path.join(BACKEND_DIR, "usuarios-entrenamientos", "base")
SOPORTADAS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
MARGEN = 0.35  # margen extra alrededor de la caja de la mano


def extraer_anotaciones(xml_path, base_dir):
    """Devuelve lista de dicts: {imagen, letra, caja}."""
    registros = []
    try:
        tree = ET.parse(xml_path)
    except Exception as e:
        print(f"  Error parseando {xml_path}: {e}")
        return registros
    root = tree.getroot()

    if root.tag != "annotation":
        print(f"  Estructura XML no reconocida en {xml_path}")
        return registros

    imagenes = root.findall("image")
    if imagenes:
        # Formato VOC de Roboflow (un _annotations.xml con muchos <image>)
        for img in imagenes:
            fname = img.get("name")
            for obj in img.findall("object"):
                nombre = (obj.findtext("name") or "").strip().upper()
                box = obj.find("bndbox")
                if box is None:
                    continue
                registros.append({
                    "imagen": os.path.join(base_dir, fname or ""),
                    "letra": nombre,
                    "caja": tuple(int(round(float(box.findtext(e)))) for e in ("xmin", "ymin", "xmax", "ymax")),
                })
    else:
        # Formato VOC por imagen (ruta relativa a base_dir)
        fname = root.findtext("filename")
        for obj in root.findall("object"):
            nombre = (obj.findtext("name") or "").strip().upper()
            box = obj.find("bndbox")
            if box is None:
                continue
            registros.append({
                "imagen": os.path.join(base_dir, fname or ""),
                "letra": nombre,
                "caja": tuple(int(round(float(box.findtext(e)))) for e in ("xmin", "ymin", "xmax", "ymax")),
            })
    return registros


def procesar_split(split_dir, out_dir, conteo):
    """Procesa un split (train/valid/test) de Roboflow."""
    if not os.path.isdir(split_dir):
        return
    xmls = glob.glob(os.path.join(split_dir, "*.xml"))
    if not xmls:
        return

    registros = []
    for xml_path in xmls:
        registros.extend(extraer_anotaciones(xml_path, split_dir))
    if not registros:
        return

    print(f"Split '{os.path.basename(split_dir)}': {len(registros)} cajas anotadas")

    for r in registros:
        letra = r["letra"]
        if letra not in SOPORTADAS:
            continue
        img_path = r["imagen"]
        if not os.path.exists(img_path):
            continue
        imagen = cv2.imread(img_path)
        if imagen is None:
            continue
        h, w = imagen.shape[:2]
        xmin, ymin, xmax, ymax = r["caja"]
        ancho = xmax - xmin
        alto = ymax - ymin
        m = max(int(MARGEN * max(ancho, alto)), 5)
        xmin = max(0, xmin - m)
        ymin = max(0, ymin - m)
        xmax = min(w, xmax + m)
        ymax = min(h, ymax + m)
        recorte = imagen[ymin:ymax, xmin:xmax]
        if recorte.size == 0:
            continue
        carpeta = os.path.join(out_dir, letra)
        os.makedirs(carpeta, exist_ok=True)
        nombre = os.path.basename(img_path)
        guardado = os.path.join(carpeta, nombre)
        n = 1
        while os.path.exists(guardado):
            guardado = os.path.join(carpeta, f"{os.path.splitext(nombre)[0]}_{n}.jpg")
            n += 1
        cv2.imwrite(guardado, recorte)
        conteo[letra] = conteo.get(letra, 0) + 1


def main():
    parser = argparse.ArgumentParser(description="Convierte el dataset LSM de Roboflow (VOC) a carpetas por letra")
    parser.add_argument("--voc", required=True, help="Ruta al .zip VOC o carpeta descomprimida")
    parser.add_argument("--out", default=DEFAULT_OUT, help="Carpeta destino (por defecto usuarios-entrenamientos/base)")
    args = parser.parse_args()

    origen = args.voc
    tmp_extraida = None
    if os.path.isfile(origen) and origen.lower().endswith(".zip"):
        tmp_extraida = os.path.join(os.path.dirname(os.path.abspath(origen)), ".voc_extraido")
        os.makedirs(tmp_extraida, exist_ok=True)
        with zipfile.ZipFile(origen) as z:
            z.extractall(tmp_extraida)
        origen = tmp_extraida

    if not os.path.isdir(origen):
        print(f"Error: no se encontró la carpeta/ZIP: {args.voc}")
        sys.exit(1)

    out_dir = args.out
    os.makedirs(out_dir, exist_ok=True)
    conteo = {}

    # Roboflow genera splits llamados train, valid, test
    for split in ("train", "valid", "test"):
        procesar_split(os.path.join(origen, split), out_dir, conteo)

    # Si el zip no tenía estructura de splits, intentar procesar la raíz
    if sum(conteo.values()) == 0:
        procesar_split(origen, out_dir, conteo)

    if tmp_extraida:
        _rmtree(tmp_extraida)

    if sum(conteo.values()) == 0:
        print("No se generó ninguna imagen. Revisa que sea el export VOC del dataset.")
        sys.exit(1)

    print("\n=== Resumen de imágenes generadas en " + out_dir + " ===")
    total = 0
    for letra in sorted(conteo):
        print(f"  {letra}: {conteo[letra]}")
        total += conteo[letra]
    print(f"TOTAL: {total} imágenes, {len(conteo)} letras")
    print("\nSiguiente paso: python entrenamiento.py base")


def _rmtree(path):
    import shutil
    shutil.rmtree(path, ignore_errors=True)


if __name__ == "__main__":
    main()