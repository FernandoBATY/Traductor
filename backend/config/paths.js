const path = require('path');
const fs = require('fs');

// Las imágenes capturadas y los modelos entrenados por cada usuario viven, por
// defecto, dentro del propio contenedor. En Render eso es disco EFÍMERO: cada
// reinicio o despliegue los borra sin avisar.
//
// Para conservarlos basta montar un disco y apuntar DATA_DIR a él (en render.yaml
// hay un bloque `disks` documentado). El modelo BASE viaja siempre en la imagen,
// así que se resuelve aparte y no depende de DATA_DIR.
const backendDir = path.join(__dirname, '..');

const persistent = !!process.env.DATA_DIR;
const dataDir = process.env.DATA_DIR || backendDir;

const paths = {
    dataDir,
    persistent,
    trainingDir: path.join(dataDir, 'usuarios-entrenamientos'),
    modelsDir: path.join(dataDir, 'modelos'),
    baseModelDir: path.join(backendDir, 'modelos', 'base'),
    userTrainingDir: (userId) => path.join(dataDir, 'usuarios-entrenamientos', String(userId)),
    userModelDir: (userId) => path.join(dataDir, 'modelos', String(userId))
};

// Crear los directorios al arrancar evita condiciones de carrera entre Node y Python.
for (const dir of [paths.trainingDir, paths.modelsDir]) {
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
        console.error(`[paths] no se pudo crear ${dir}:`, e.message);
    }
}

if (!persistent) {
    console.warn('[paths] DATA_DIR no configurado: las imágenes y modelos de usuario se '
        + 'perderán en cada reinicio del contenedor.');
}

module.exports = paths;
