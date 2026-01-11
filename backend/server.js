const express = require('express');
const connectDB = require('./config/db');
const cors = require('cors');
const path = require('path');
const httpProxy = require('http-proxy');
const { spawn } = require('child_process');
const axios = require('axios');
const util = require('util');

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

// Serve static files from the "frontend/static" directory
app.use('/static', express.static(path.join(__dirname, '../frontend/static')));

// Ensure the auth route is correctly registered
app.use('/api/auth', require('./routes/auth'));

// Ensure the script route is correctly registered
app.use('/api', require('./routes/script'));

// Python scripts routes (capture, train, recognition)
app.use('/api/python', require('./routes/python-scripts'));

// Serve a placeholder favicon to avoid missing file errors
app.get('/favicon.ico', (req, res) => {
    res.status(204).send(); // Send a "No Content" response
});

// Proxy requests to /api/video_feed and /api/health to the Flask server
const proxy = httpProxy.createProxyServer();

// Proxy requests to /api/video_feed to the Flask server
app.get('/api/video_feed', async (req, res) => {
    try {
        proxy.web(req, res, { target: 'http://localhost:5000/video_feed' }); // Ensure correct target
    } catch (error) {
        console.error('Error proxying video feed:', error.message);
        res.status(500).send('Error proxying video feed.');
    }
});

// Proxy requests to /api/health to the Flask server
app.get('/api/health', async (req, res) => {
    try {
        proxy.web(req, res, { target: 'http://localhost:5000/health' }); // Ensure correct target
    } catch (error) {
        console.error('Error proxying health check:', error.message);
        res.status(500).send('Error proxying health check.');
    }
});

// Proxy requests to /api/start-reconocim iento to the Flask server
app.get('/api/start-reconocimiento', async (req, res) => {
    try {
        const response = await axios.get('http://localhost:5000/visualize-model'); // Correctly forward to Flask
        res.send(response.data);
    } catch (error) {
        console.error('Error proxying start-reconocimiento:', error.message);
        res.status(500).send('Error starting Flask server.');
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

// Start both services on server boot (attached so they exit with Node)
capturaProc = startPythonService(capturaImagenesPath);
reconocimientoProc = startPythonService(reconocimientoPath, { USER_ID: '1' });

async function gracefulShutdown() {
    console.log('Shutting down: closing cameras and stopping Python services...');
    try { await axios.post('http://localhost:5001/camera/close'); } catch {}
    try { await axios.post('http://localhost:5000/api/camera/close'); } catch {}
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
