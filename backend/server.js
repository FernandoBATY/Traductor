const express = require('express');
const connectDB = require('./config/db');
const cors = require('cors');
const path = require('path');
const httpProxy = require('http-proxy');
const { spawn } = require('child_process');
const FLASK_REC_URL = process.env.FLASK_REC_URL || 'http://localhost:5000';
const FLASK_CAPTURE_URL = process.env.FLASK_CAPTURE_URL || 'http://localhost:5001';

const app = express();

// Conectar a la base de datos
connectDB();

// Middleware
app.use(express.json({ extended: false }));
app.use(cors());

// Serve static files from the "frontend/templates" directory
app.use(express.static(path.join(__dirname, '../frontend/templates')));

// Serve static files from the "frontend/js" directory  
app.use('/js', express.static(path.join(__dirname, '../frontend/js')));

// Serve static files from the "frontend/css" directory
app.use('/css', express.static(path.join(__dirname, '../frontend/css')));

// Serve static files from the "frontend/static" directory with better error handling
app.use('/static', express.static(path.join(__dirname, '../frontend/static'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
            res.setHeader('Content-Type', 'image/jpeg');
        }
    }
}));

// Ensure the auth route is correctly registered
app.use('/api/auth', require('./routes/auth'));

// Python scripts routes (capture, train, recognition).
// Nota: la ruta heredada "script.js" (ejecución de scripts arbitrarios) ya NO se monta.
app.use('/api/python', require('./routes/python-scripts'));

// Serve a placeholder favicon to avoid missing file errors
app.get('/favicon.ico', (req, res) => {
    res.status(204).send(); // Send a "No Content" response
});

// Proxy requests to /api/health to the Flask server
const proxy = httpProxy.createProxyServer();

app.get('/api/health', async (req, res) => {
    try {
        proxy.web(req, res, { target: `${FLASK_REC_URL}/health` }); // Ensure correct target
    } catch (error) {
        console.error('Error proxying health check:', error.message);
        res.status(500).send('Error proxying health check.');
    }
});

// Auto-start Python services (capture and recognition) without grabbing camera until requested
const capturaImagenesPath = path.join(__dirname, './python/captura_imagenes.py');
const reconocimientoPath = path.join(__dirname, './python/reconocimiento.py');

let capturaProc = null;
let reconocimientoProc = null;

function startPythonService(scriptPath, env = {}) {
    try {
        const proc = spawn('python', [scriptPath], {
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        proc.stdout.on('data', (d) => console.log(`${path.basename(scriptPath)}: ${d.toString().trim()}`));
        proc.stderr.on('data', (d) => console.error(`${path.basename(scriptPath)} Error: ${d.toString().trim()}`));
        return proc;
    } catch (e) {
        console.error(`Failed to start ${scriptPath}:`, e.message);
        return null;
    }
}

// Start both services on server boot (attached so they exit with Node).
// En despliegue (URLs externas configuradas) los servicios Python corren aparte.
const pythonServicesExternos = !!(process.env.FLASK_REC_URL || process.env.FLASK_CAPTURE_URL);
if (pythonServicesExternos) {
    console.log('Servicios Python externos configurados, no se propagan procesos locales.');
} else {
    capturaProc = startPythonService(capturaImagenesPath, { FLASK_CAPTURE_PORT: '5001' });
    reconocimientoProc = startPythonService(reconocimientoPath, { USER_ID: '1', FLASK_REC_PORT: '5000' });
}

async function gracefulShutdown() {
    console.log('Shutting down: stopping Python services...');
    try { capturaProc && capturaProc.kill(); } catch {}
    try { reconocimientoProc && reconocimientoProc.kill(); } catch {}
}

process.on('SIGINT', async () => { await gracefulShutdown(); process.exit(0); });
process.on('SIGTERM', async () => { await gracefulShutdown(); process.exit(0); });
process.on('exit', async () => { await gracefulShutdown(); });

// Ruta para servir el archivo "index.html" por defecto
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/templates/index.html'));
});

// Dynamic route to serve HTML pages
app.get('/:page', (req, res) => {
    const page = req.params.page;
    res.sendFile(path.join(__dirname, '../frontend/templates', page));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to view the project.`);
});
