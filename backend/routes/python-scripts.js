const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FLASK_REC_URL = process.env.FLASK_REC_URL || 'http://127.0.0.1:5000'; // 127.0.0.1 evita que Node use IPv6 (::1) y no encuentre a Flask
const FLASK_CAPTURE_URL = process.env.FLASK_CAPTURE_URL || 'http://127.0.0.1:5001';
const auth = require('../middleware/auth');
const paths = require('../config/paths');
const rateLimit = require('../middleware/rateLimit');

// Todas las rutas de este router exigen un token JWT válido.
// El userId siempre se toma del token (nunca del query/body), evitando manipular datos ajenos.
router.use(auth);

// Tocho por IP en todo /api/python (autenticado) para acotar abusos/DoS.
router.use(rateLimit({ windowMs: 60000, max: 600 }));

// El id del token es numérico; path.join y las URLs necesitan cadena.
const uidDe = (req) => String(req.userId);

// ============ Diagnostic Routes ============

// Check status of all services
router.get('/status', async (req, res) => {
    const capturaHealthy = await checkCapturaHealth().catch(() => false);
    const reconocimientoHealthy = await checkReconocimientoHealth().catch(() => false);

    res.json({
        captura: capturaHealthy ? 'healthy' : 'unavailable',
        reconocimiento: reconocimientoHealthy ? 'healthy' : 'unavailable',
        timestamp: new Date().toISOString()
    });
});

// ============ Captura de Imágenes Routes ============

// Count images captured for a given userId
router.get('/count-images', (req, res) => {
    const userId = uidDe(req);

    try {
        const usuarioDir = paths.userTrainingDir(userId);

        let totalImages = 0;

        if (fs.existsSync(usuarioDir)) {
            // Count all .jpg files in all subdirectories
            const countFilesInDir = (dir) => {
                let count = 0;
                try {
                    const files = fs.readdirSync(dir);
                    files.forEach(file => {
                        const filePath = path.join(dir, file);
                        const stat = fs.statSync(filePath);
                        if (stat.isDirectory()) {
                            count += countFilesInDir(filePath);
                        } else if (file.endsWith('.jpg')) {
                            count++;
                        }
                    });
                } catch (e) {
                    console.error(`Error reading directory ${dir}:`, e.message);
                }
                return count;
            };

            totalImages = countFilesInDir(usuarioDir);
        }

        // `persistente:false` avisa al frontend de que el disco es efímero y de que
        // estas imágenes se perderán en el próximo reinicio del contenedor.
        res.json({ success: true, total: totalImages, persistente: paths.persistent });
    } catch (error) {
        console.error('Error counting images:', error.message);
        res.status(500).json({ success: false, message: 'Failed to count images.' });
    }
});

// Capture a single image for a given letter and userId.
// El navegador envía la imagen (JPEG binario) en el cuerpo de la petición.
router.post('/capture-image', (req, res) => {
    const userId = uidDe(req);
    const letter = req.query.letter;

    if (!letter) {
        return res.status(400).json({ success: false, message: 'letter is required.' });
    }

    // Validación estricta de la letra (A-Z) + normalización
    const normalizedLetter = String(letter).trim().toUpperCase();
    if (!/^[A-Z]$/.test(normalizedLetter)) {
        return res.status(400).json({ success: false, message: 'letter debe ser una letra de A a Z.' });
    }

    const MAX_BYTES = 2 * 1024 * 1024; // 2 MB (un JPEG de webcam ronda los 30–100 KB)
    const chunks = [];
    let total = 0;
    let tooBig = false;

    req.on('data', (chunk) => {
        if (tooBig) return;
        total += chunk.length;
        if (total > MAX_BYTES) {
            tooBig = true;
            if (!res.headersSent) {
                res.status(413).json({ success: false, message: 'Imagen demasiado grande.' });
            }
            chunks.length = 0;
            // Descartar el resto del cuerpo sin quedarse a medias: `req.pause()` dejaba
            // el socket colgado. Drenar (unpipe + resume) libera la conexión y permite
            // que la respuesta 413 llegue completa al navegador.
            req.unpipe();
            req.resume();
            return;
        }
        chunks.push(chunk);
    });

    req.on('end', () => {
        if (tooBig) return;
        const body = Buffer.concat(chunks);
        const url = `${FLASK_CAPTURE_URL}/capture_image?userId=${encodeURIComponent(userId)}&letter=${normalizedLetter}`;
        axios.post(url, body, {
            headers: { 'Content-Type': (req.headers['content-type'] || 'image/jpeg') }
        })
            .then(response => {
                res.json({ success: true, message: response.data });
            })
            .catch(error => {
                console.error('Error capturing image:', error.message);
                res.status(500).json({ success: false, message: 'Failed to capture image.' });
            });
    });
});

// Health check for captura service (port 5001)
async function checkCapturaHealth() {
    try {
        await axios.get(`${FLASK_CAPTURE_URL}/health`, { timeout: 2000 });
        return true;
    } catch (e) {
        return false;
    }
}

// Estado del servicio de captura.
// Los servicios Python los arranca el proceso servidor (backend/server.js) y son
// COMPARTIDOS por todos los usuarios: esta ruta solo informa, nunca los mata ni los
// relanza. Antes cualquier usuario autenticado podía ejecutar un pkill/taskkill que
// tumbaba la captura y el reconocimiento de todos los demás.
router.get('/start-capture', async (req, res) => {
    if (await checkCapturaHealth()) {
        return res.json({ success: true, message: 'captura_imagenes.py already running.' });
    }
    return res.status(503).json({
        success: false,
        message: 'El servicio de captura no está disponible. Inténtalo de nuevo en unos segundos.'
    });
});

// ============ Entrenamiento Routes ============

// El entrenamiento carga TensorFlow completo (cientos de MB) y satura la instancia.
// Se admite UN entrenamiento a la vez en todo el proceso y con tiempo máximo, para que
// una ráfaga de peticiones no provoque un OOM que se lleve por delante al servidor Node.
const TRAIN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos
let trainingUserId = null;

router.post('/train-model', (req, res) => {
    const userId = uidDe(req);

    if (trainingUserId !== null) {
        const propio = trainingUserId === userId;
        return res.status(429).json({
            success: false,
            message: propio
                ? 'Ya hay un entrenamiento tuyo en curso. Espera a que termine.'
                : 'Hay otro entrenamiento en curso. Vuelve a intentarlo en unos minutos.'
        });
    }
    trainingUserId = userId;

    const scriptPath = path.join(__dirname, '../python/entrenamiento.py');
    const pythonProcess = spawn('python', [scriptPath, userId]);

    let output = '';
    let errorOutput = '';
    let finished = false;
    let timedOut = false;

    const timer = setTimeout(() => {
        timedOut = true;
        pythonProcess.kill('SIGKILL');
    }, TRAIN_TIMEOUT_MS);

    // Libera el turno pase lo que pase (éxito, error, timeout o fallo al lanzar python).
    const release = () => {
        if (finished) return false;
        finished = true;
        clearTimeout(timer);
        trainingUserId = null;
        return true;
    };

    pythonProcess.stdout.on('data', (data) => {
        const msg = data.toString().trim();
        console.log(`entrenamiento.py: ${msg}`);
        output += msg + '\n';
    });

    pythonProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        console.error(`entrenamiento.py Error: ${msg}`);
        errorOutput += msg + '\n';
    });

    pythonProcess.on('error', (err) => {
        console.error('Failed to start entrenamiento.py:', err.message);
        if (!release()) return;
        res.status(500).json({ success: false, message: 'No se pudo iniciar el entrenamiento.' });
    });

    pythonProcess.on('close', (code) => {
        if (!release()) return;
        if (timedOut) {
            return res.status(504).json({
                success: false,
                message: 'El entrenamiento tardó demasiado y se canceló. Prueba con menos imágenes.'
            });
        }
        if (code === 0) {
            return res.json({ success: true, message: 'Model trained successfully.', output });
        }
        // Solo la última línea del error: el traceback completo de Python filtraba
        // rutas absolutas del servidor a cualquier usuario autenticado.
        const ultimaLinea = errorOutput.trim().split('\n').pop() || '';
        return res.status(500).json({
            success: false,
            message: 'No se pudo entrenar el modelo.',
            error: ultimaLinea.slice(0, 300)
        });
    });
});

// ============ Reconocimiento/Visualización Routes ============

// Health check for reconocimiento service (port 5000)
async function checkReconocimientoHealth() {
    try {
        await axios.get(`${FLASK_REC_URL}/api/health`, { timeout: 2000 });
        return true;
    } catch (e) {
        return false;
    }
}

// Estado del servicio de reconocimiento (compartido; ver nota en /start-capture).
router.get('/start-recognition', async (req, res) => {
    if (await checkReconocimientoHealth()) {
        return res.json({ success: true, message: 'reconocimiento.py already running.' });
    }
    return res.status(503).json({
        success: false,
        message: 'El servicio de reconocimiento no está disponible. Inténtalo de nuevo en unos segundos.'
    });
});

// Cargar modelo sin tocar cámara (modo navegador con getUserMedia).
// La sesión de reconocimiento es POR USUARIO: se envía el userId del token como dueño
// de la sesión y, aparte, qué modelo debe usar (el suyo o el base).
router.post('/load-model', async (req, res) => {
    try {
        const userId = uidDe(req);
        const model = (req.query.model || req.body.model || 'user').toString().toLowerCase();
        const modelUser = model === 'base' ? 'base' : userId;

        try {
            await axios.post(
                `${FLASK_REC_URL}/api/load-model?userId=${encodeURIComponent(userId)}&modelUser=${encodeURIComponent(modelUser)}`
            );
            console.log(`Model loaded for user ${userId} (seleccion: ${model})`);
            return res.json({ success: true, modelLoaded: true, message: `Modelo listo (${model === 'base' ? 'base' : 'personalizado'}).` });
        } catch (loadError) {
            if (loadError.response && loadError.response.status === 404) {
                // No hay modelo de ese usuario: se usará el base al detectar (comportamiento normal)
                return res.json({
                    success: true,
                    modelLoaded: false,
                    message: 'No hay modelo entrenado para este usuario. Se usará el modelo base al detectar.'
                });
            }
            // Error real (servicio caído o fallo interno): se reporta para que el front muestre el problema
            console.error(`Error cargando modelo para ${userId}:`, loadError.response?.data || loadError.message);
            return res.status(503).json({
                success: false,
                message: 'El servicio de reconocimiento no pudo cargar el modelo.'
            });
        }
    } catch (e) {
        console.error('Error loading model:', e.message);
        res.status(500).json({ success: false, message: 'Failed to load model.' });
    }
});

// Predict a letter from 21 landmarks {x,y,z} sent by the browser
router.post('/predecir', async (req, res) => {
    try {
        const userId = uidDe(req);
        const body = req.body;
        if (!body || !Array.isArray(body.coords) || body.coords.length !== 21) {
            return res.status(400).json({ success: false, message: 'coords inválidas' });
        }
        const r = await axios.post(
            `${FLASK_REC_URL}/api/predecir?userId=${encodeURIComponent(userId)}`,
            { coords: body.coords },
            { timeout: 10000 }
        );
        res.json(r.data);
    } catch (e) {
        console.error('Error predicting:', e.message);
        res.status(503).json({ success: false, message: 'Servicio de reconocimiento no disponible.' });
    }
});

// Get last detected gesture (el del usuario del token, no el del último que pasara por aquí)
router.get('/last-gesture', async (req, res) => {
    try {
        const userId = uidDe(req);
        const r = await axios.get(
            `${FLASK_REC_URL}/api/last-gesture?userId=${encodeURIComponent(userId)}`,
            { timeout: 5000 }
        );
        res.json(r.data);
    } catch (e) {
        console.error('Error getting last gesture:', e.message);
        res.status(500).json({ gesture: null });
    }
});

// Health check for Flask services
router.get('/health', async (req, res) => {
    try {
        await axios.get(`${FLASK_REC_URL}/health`, { timeout: 2000 });
        res.json({ status: 'healthy', service: 'reconocimiento' });
    } catch (e) {
        res.status(503).json({ status: 'unhealthy', service: 'reconocimiento' });
    }
});

// Diagnostic endpoint: resumen de imágenes capturadas por el usuario.
// No devuelve rutas absolutas del servidor (evita filtrar la estructura del contenedor).
router.get('/debug/list-captured-images', (req, res) => {
    const userId = uidDe(req);

    const userDir = paths.userTrainingDir(userId);

    if (!fs.existsSync(userDir)) {
        return res.json({
            success: false,
            message: 'Todavía no has capturado imágenes.',
            exists: false
        });
    }

    try {
        const letters = fs.readdirSync(userDir);
        const result = {};

        letters.forEach(letter => {
            const letterDir = path.join(userDir, letter);
            if (fs.statSync(letterDir).isDirectory()) {
                const files = fs.readdirSync(letterDir).filter(f => f.endsWith('.jpg'));
                result[letter] = {
                    count: files.length,
                    files: files
                };
            }
        });

        res.json({
            success: true,
            userId: userId,
            data: result,
            totalImages: Object.values(result).reduce((sum, obj) => sum + obj.count, 0)
        });
    } catch (e) {
        console.error('Error listing captured images:', e.message);
        res.status(500).json({ success: false, message: 'No se pudieron listar las imágenes.' });
    }
});

module.exports = router;
