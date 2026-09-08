const express = require('express');
const router = express.Router();
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FLASK_REC_URL = process.env.FLASK_REC_URL || 'http://127.0.0.1:5000'; // 127.0.0.1 evita que Node use IPv6 (::1) y no encuentre a Flask
const FLASK_CAPTURE_URL = process.env.FLASK_CAPTURE_URL || 'http://127.0.0.1:5001';
const auth = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

// Todas las rutas de este router exigen un token JWT válido.
// El userId siempre se toma del token (nunca del query/body), evitando manipular datos ajenos.
router.use(auth);

// Tocho por IP en todo /api/python (autenticado) para acotar abusos/DoS.
router.use(rateLimit({ windowMs: 60000, max: 600 }));

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

// Stop a Flask service (captura or reconocimiento)
router.post('/stop-service', (req, res) => {
    const service = req.query.service; // 'captura' or 'reconocimiento'
    
    if (!service || !['captura', 'reconocimiento'].includes(service)) {
        return res.status(400).json({ success: false, message: 'service parameter must be "captura" or "reconocimiento".' });
    }

    const processName = service === 'captura' ? 'captura_imagenes' : 'reconocimiento';
    const cmd = process.platform === 'win32'
        ? `taskkill /FI "COMMANDLINE eq *${processName}*" /IM python.exe /T /F`
        : `pkill -f ${processName}`;

    exec(cmd, (err, stdout) => {
        if (err && !err.message.includes('not found')) {
            console.log(`${service} service stop command executed.`);
        }
        res.json({ success: true, message: `${service} service stopped.` });
    });
});

// ============ Captura de Imágenes Routes ============

// Count images captured for a given userId
router.get('/count-images', (req, res) => {
    const userId = req.userId;
    if (!userId) {
        return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    try {
        const backendDir = path.join(__dirname, '..');
        const usuarioDir = path.join(backendDir, 'usuarios-entrenamientos', userId);
        
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
        
        res.json({ success: true, total: totalImages });
    } catch (error) {
        console.error('Error counting images:', error.message);
        res.status(500).json({ success: false, message: 'Failed to count images.' });
    }
});

// Capture a single image for a given letter and userId.
// El navegador envía la imagen (JPEG binario) en el cuerpo de la petición.
router.post('/capture-image', (req, res) => {
    const userId = req.userId;
    const letter = req.query.letter;

    if (!userId || !letter) {
        return res.status(400).json({ success: false, message: 'userId and letter are required.' });
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
            req.pause();
            return;
        }
        chunks.push(chunk);
    });

    req.on('end', () => {
        if (tooBig) return;
        const body = Buffer.concat(chunks);
        axios.post(`${FLASK_CAPTURE_URL}/capture_image?userId=${userId}&letter=${normalizedLetter}`, body, {
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

// Start captura_imagenes.py Flask server
router.get('/start-capture', async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        return res.status(400).send('userId query parameter is required.');
    }

    // First, check if service is already healthy
    if (await checkCapturaHealth()) {
        console.log('captura_imagenes.py already running and responding.');
        return res.json({ success: true, message: 'captura_imagenes.py already running.' });
    }

    // If not healthy, kill any existing processes and start fresh
    const killCmd = process.platform === 'win32'
        ? `taskkill /FI "COMMANDLINE eq *captura_imagenes*" /IM python.exe /T /F`
        : `pkill -9 -f captura_imagenes`;

    exec(killCmd, (killErr) => {
        // Delay to ensure processes are killed
        setTimeout(() => {
            const scriptPath = path.join(__dirname, '../python/captura_imagenes.py');
            
            let hasResponded = false; // Track if response was sent
            
            const pythonProcess = spawn('python', [scriptPath], {
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, USER_ID: userId }
            });

            pythonProcess.stdout.on('data', (data) => {
                console.log(`captura_imagenes.py: ${data.toString().trim()}`);
            });

            pythonProcess.stderr.on('data', (data) => {
                console.error(`captura_imagenes.py Error: ${data.toString().trim()}`);
            });

            pythonProcess.on('error', (err) => {
                console.error('Failed to start captura_imagenes.py:', err.message);
                if (!hasResponded) {
                    hasResponded = true;
                    res.status(500).json({ 
                        success: false, 
                        message: 'Failed to spawn captura_imagenes.py process.',
                        error: err.message
                    });
                }
            });

            pythonProcess.unref();
            
            // Wait for service to be ready and then respond
            let attempts = 0;
                const maxAttempts = 30; // 30 * 500ms = 15 seconds
            const checkInterval = setInterval(async () => {
                attempts++;
                if (await checkCapturaHealth()) {
                    clearInterval(checkInterval);
                    if (!hasResponded) {
                        hasResponded = true;
                        console.log('captura_imagenes.py started and ready on port 5001.');
                        res.json({ success: true, message: 'captura_imagenes.py started on port 5001.' });
                    }
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    if (!hasResponded) {
                        hasResponded = true;
                        console.error('Timeout waiting for captura_imagenes.py to be ready');
                        res.status(500).json({ 
                            success: false, 
                            message: 'Failed to start captura_imagenes.py. Check Python dependencies.',
                            hint: 'Ensure Python packages are installed: pip install -r requirements.txt'
                        });
                    }
                }
            }, 500);
        }, 1000);
    });
});

// ============ Entrenamiento Routes ============

// Train model for a given userId
router.post('/train-model', (req, res) => {
    const userId = req.userId;
    if (!userId) {
        return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const scriptPath = path.join(__dirname, '../python/entrenamiento.py');

    const pythonProcess = spawn('python', [scriptPath, userId]);

    let output = '';
    let errorOutput = '';

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

    pythonProcess.on('close', (code) => {
        if (code === 0) {
            res.json({ success: true, message: 'Model trained successfully.', output });
        } else {
            res.status(500).json({ success: false, message: 'Training failed.', error: errorOutput });
        }
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

// Start reconocimiento.py Flask server
router.get('/start-recognition', async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        return res.status(400).send('userId query parameter is required.');
    }

    // First, check if service is already healthy
    if (await checkReconocimientoHealth()) {
        console.log('reconocimiento.py already running and responding.');
        return res.json({ success: true, message: 'reconocimiento.py already running.' });
    }

    // If not healthy, kill any existing processes and start fresh
    const killCmd = process.platform === 'win32'
        ? `taskkill /FI "COMMANDLINE eq *reconocimiento*" /IM python.exe /T /F`
        : `pkill -9 -f reconocimiento`;

    exec(killCmd, (killErr) => {
        // Delay to ensure processes are killed
        setTimeout(() => {
            const scriptPath = path.join(__dirname, '../python/reconocimiento.py');
            
            let hasResponded = false; // Track if response was sent
            
            const pythonProcess = spawn('python', [scriptPath], {
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, USER_ID: userId }
            });

            pythonProcess.stdout.on('data', (data) => {
                console.log(`reconocimiento.py: ${data.toString().trim()}`);
            });

            pythonProcess.stderr.on('data', (data) => {
                console.error(`reconocimiento.py Error: ${data.toString().trim()}`);
            });

            pythonProcess.on('error', (err) => {
                console.error('Failed to start reconocimiento.py:', err.message);
                if (!hasResponded) {
                    hasResponded = true;
                    res.status(500).json({ 
                        success: false, 
                        message: 'Failed to spawn reconocimiento.py process.',
                        error: err.message
                    });
                }
            });

            pythonProcess.unref();
            
            // Wait for service to be ready and then respond
            let attempts = 0;
                const maxAttempts = 30; // 30 * 500ms = 15 seconds
            const checkInterval = setInterval(async () => {
                attempts++;
                if (await checkReconocimientoHealth()) {
                    clearInterval(checkInterval);
                    if (!hasResponded) {
                        hasResponded = true;
                        console.log('reconocimiento.py started and ready on port 5000.');
                        res.json({ success: true, message: 'reconocimiento.py started on port 5000.' });
                    }
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    if (!hasResponded) {
                        hasResponded = true;
                        console.error('Timeout waiting for reconocimiento.py to be ready');
                        res.status(500).json({ 
                            success: false, 
                            message: 'Failed to start reconocimiento.py. Check model files and dependencies.',
                            hint: 'Ensure model files exist in backend/modelos/<userId>/ and Python dependencies are installed.'
                        });
                    }
                }
            }, 500);
        }, 1000);
    });
});

// Cargar modelo sin tocar cámara (modo navegador con getUserMedia)
router.post('/load-model', async (req, res) => {
    try {
        const userId = req.userId;
        const model = (req.query.model || req.body.model || 'user').toString().toLowerCase();
        if (!userId) {
            return res.status(400).json({ success: false, message: 'userId parameter required' });
        }

        const modelUser = model === 'base' ? 'base' : userId;
        try {
            await axios.post(`${FLASK_REC_URL}/api/load-model?userId=${modelUser}`);
            console.log(`Model loaded for user ${modelUser} (seleccion: ${model})`);
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
            console.error(`Error cargando modelo para ${modelUser}:`, loadError.response?.data || loadError.message);
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
        const body = req.body;
        if (!body || !Array.isArray(body.coords) || body.coords.length !== 21) {
            return res.status(400).json({ success: false, message: 'coords inválidas' });
        }
        const r = await axios.post(`${FLASK_REC_URL}/api/predecir`, body, { timeout: 10000 });
        res.json(r.data);
    } catch (e) {
        console.error('Error predicting:', e.message);
        res.status(503).json({ success: false, message: 'Servicio de reconocimiento no disponible.' });
    }
});

// Get last detected gesture
router.get('/last-gesture', async (req, res) => {
    try {
        const r = await axios.get(`${FLASK_REC_URL}/api/last-gesture`);
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

// Diagnostic endpoint: List all captured images
router.get('/debug/list-captured-images', (req, res) => {
    const userId = req.userId;
    if (!userId) {
        return res.status(400).json({ success: false, message: 'userId required' });
    }

    const backendDir = path.join(__dirname, '..');
    const userDir = path.join(backendDir, 'usuarios-entrenamientos', userId);

    if (!fs.existsSync(userDir)) {
        return res.json({ 
            success: false, 
            message: `User directory does not exist: ${userDir}`,
            path: userDir,
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
                    files: files,
                    path: letterDir
                };
            }
        });

        res.json({ 
            success: true, 
            userId: userId,
            userDir: userDir,
            data: result,
            totalImages: Object.values(result).reduce((sum, obj) => sum + obj.count, 0)
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message, path: userDir });
    }
});

module.exports = router;
