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

// Serve static files from the "templates" directory
app.use(express.static(path.join(__dirname, '../templates')));

// Serve static files from the "js" directory
app.use('/js', express.static(path.join(__dirname, '../js')));

// Ensure the auth route is correctly registered
app.use('/api/auth', require('./routes/auth'));

// Ensure the script route is correctly registered
app.use('/api', require('./routes/script'));

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

// Start captura_imagenes.py automatically when the Node.js server starts
const capturaImagenesPath = path.join(__dirname, '../scrips/captura_imagenes.py');
const capturaImagenesProcess = spawn('python', [capturaImagenesPath]);

capturaImagenesProcess.stdout.on('data', (data) => {
    console.log(`captura_imagenes.py: ${data.toString().trim()}`);
});

capturaImagenesProcess.stderr.on('data', (data) => {
    console.error(`captura_imagenes.py Error: ${data.toString().trim()}`);
});

capturaImagenesProcess.on('close', (code) => {
    console.log(`captura_imagenes.py exited with code ${code}`);
});

// Start reconocimiento.py automatically when the Node.js server starts
const reconocimientoPath = path.join(__dirname, '../scrips/reconocimiento.py');
const userId = 1; // Replace with the actual user ID or dynamically fetch it if needed
const reconocimientoProcess = spawn('python', [reconocimientoPath], {
    env: { ...process.env, USER_ID: userId.toString() }, // Set USER_ID environment variable
    detached: true,
    stdio: 'ignore'
});

reconocimientoProcess.unref();

reconocimientoProcess.stdout?.on('data', (data) => {
    console.log(`reconocimiento.py: ${data.toString().trim()}`);
});

reconocimientoProcess.stderr?.on('data', (data) => {
    console.error(`reconocimiento.py Error: ${data.toString().trim()}`);
});

reconocimientoProcess.on('close', (code) => {
    console.log(`reconocimiento.py exited with code ${code}`);
});

// Ruta para servir el archivo "index.html" por defecto
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../templates/index.html'));
});

// Dynamic route to serve HTML pages
app.get('/:page', (req, res) => {
    const page = req.params.page;
    res.sendFile(path.join(__dirname, '../templates', page));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to view the project.`);
});

// Remove or replace this line as it is causing the error
// const extendedObject = Object.assign(obj1, obj2);

// If you need to use Object.assign, ensure obj1 and obj2 are defined
// Example:
// const obj1 = { key1: 'value1' };
// const obj2 = { key2: 'value2' };
// const extendedObject = Object.assign(obj1, obj2);