const express = require('express');
const router = express.Router();
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const httpProxy = require('http-proxy');

// Create a proxy to forward requests to the Flask server
const proxy = httpProxy.createProxyServer();

router.get('/run-script', (req, res) => {
    const script = req.query.script;
    const userId = req.query.userId; // Obtener el ID del usuario
    const userDir = path.join(__dirname, `../../proyecto/${userId}`);

    // Crear el directorio del usuario si no existe
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }

    const scriptPath = path.join(userDir, script);

    const pythonProcess = spawn('python', [scriptPath]);

    pythonProcess.stdout.on('data', (data) => {
        res.write(data);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`Error: ${data}`);
        res.write(`Error: ${data}`);
    });

    pythonProcess.on('close', (code) => {
        res.end(`Process exited with code ${code}`);
    });
});

router.get('/run-capture-script', (req, res) => {
    const userId = req.query.userId; // Obtener el ID del usuario
    if (!userId) {
        res.status(400).send('User ID is required.');
        return;
    }

    const scriptPath = path.join(__dirname, '../../scrips/captura_imagenes.py');

    // Start the Flask server for the video feed
    const pythonProcess = spawn('python', [scriptPath, userId], { detached: true, stdio: 'ignore' });

    pythonProcess.unref(); // Allow the process to continue running after the request ends

    res.send('Flask server for video feed started.');
});

router.post('/capture-image', (req, res) => {
    const letter = req.query.letter; // Get the letter from the query parameter
    const userId = req.query.userId; // Get the user ID from the query parameter

    if (!letter || !userId) {
        res.status(400).json({ success: false, message: 'Letter and User ID are required.' });
        return;
    }

    const scriptPath = path.join(__dirname, '../../scrips/captura_imagenes.py');

    // Start the Python script to capture the image
    const pythonProcess = spawn('python', [scriptPath, userId, letter]);

    pythonProcess.stdout.on('data', (data) => {
        console.log(`captura_imagenes.py: ${data.toString()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`captura_imagenes.py Error: ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
        if (code === 0) {
            res.json({ success: true, message: `Image for letter "${letter}" captured successfully.` });
        } else {
            res.status(500).json({ success: false, message: `Failed to capture image for letter "${letter}".` });
        }
    });
});

// Proxy route to forward video feed requests to the Flask server
router.get('/video_feed', async (req, res) => {
    const proxy = require('http-proxy').createProxyServer();
    const scriptPath = path.join(__dirname, '../../scrips/reconocimiento.py');

    try {
        // Check if the Flask server is running
        const axios = require('axios');
        await axios.get('http://127.0.0.1:5000/start-reconocimiento'); // Updated port to 5000

        // Proxy the request to the Flask server
        proxy.web(req, res, { target: 'http://127.0.0.1:5000/video_feed' }, (error) => { // Updated port to 5000
            console.error('Error proxying video feed:', error);
            res.status(500).send('Error proxying video feed.');
        });
    } catch (error) {
        console.error('Flask server is not running. Attempting to start it...');

        // Start reconocimiento.py if it is not running
        const pythonProcess = spawn('python', [scriptPath], { detached: true, stdio: 'ignore' });
        pythonProcess.unref();

        // Wait a moment to allow the Flask server to start
        setTimeout(() => {
            proxy.web(req, res, { target: 'http://127.0.0.1:5000/video_feed' }, (error) => { // Updated port to 5000
                if (error) {
                    console.error('Error proxying video feed after starting Flask server:', error);
                    res.status(500).send('Error proxying video feed after starting Flask server.');
                }
            });
        }, 5000); // Wait 5 seconds before retrying
    }
});

router.get('/run-reconocimiento', (req, res) => {
    const scriptPath = path.join(__dirname, '../../scrips/reconocimiento.py');

    // Check if reconocimiento.py is already running
    const isRunningCommand = process.platform === 'win32'
        ? `tasklist /FI "IMAGENAME eq python.exe"`
        : `pgrep -f ${scriptPath}`;

    exec(isRunningCommand, (err, stdout) => {
        if (err) {
            console.error('Error checking if reconocimiento.py is running:', err);
            // Assume the script is not running if the check fails
            startReconocimiento(scriptPath, res);
        } else if (stdout.includes('python')) {
            console.log('reconocimiento.py ya está en ejecución.');
            res.send('reconocimiento.py ya está en ejecución.');
        } else {
            startReconocimiento(scriptPath, res);
        }
    });
});

router.get('/start-reconocimiento', (req, res) => {
    const scriptPath = path.join(__dirname, '../../scrips/reconocimiento.py');

    const isRunningCommand = process.platform === 'win32'
        ? `tasklist /FI "IMAGENAME eq python.exe"`
        : `pgrep -f ${scriptPath}`;

    exec(isRunningCommand, (err, stdout) => {
        if (err || !stdout.includes('python')) {
            const pythonProcess = spawn('python', [scriptPath], { detached: true, stdio: 'ignore' });
            pythonProcess.unref();
            console.log('reconocimiento.py iniciado.');
            res.send('reconocimiento.py iniciado.');
        } else {
            console.log('reconocimiento.py ya está en ejecución.');
            res.send('reconocimiento.py ya está en ejecución.');
        }
    });
});

function startReconocimiento(scriptPath, res) {
    // Start reconocimiento.py
    const pythonProcess = spawn('python', [scriptPath], { detached: true, stdio: 'ignore' });
    pythonProcess.unref(); // Allow the process to continue running after the request ends
    console.log('reconocimiento.py iniciado.');
    res.send('reconocimiento.py iniciado.');
}

module.exports = router;
