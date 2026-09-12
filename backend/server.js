const express = require('express');
const crypto = require('crypto');
const db = require('./config/db');
const dbEstado = db.estado;
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const httpProxy = require('http-proxy');
const { spawn } = require('child_process');
const requestLogger = require('./middleware/requestLogger');
const { counters } = require('./middleware/requestLogger');
const healthMonitor = require('./utils/healthMonitor');
const { info, error: logError } = require('./utils/logger');
const FLASK_REC_URL = process.env.FLASK_REC_URL || 'http://localhost:5000';
const FLASK_CAPTURE_URL = process.env.FLASK_CAPTURE_URL || 'http://localhost:5001';

const app = express();

// Detrás del proxy de Render, confiar 1 salto para que req.ip use la IP real del cliente.
// Sin esto el rate-limit ve a todos los usuarios con la misma IP (la del proxy) y bloquearía globalmente.
app.set('trust proxy', 1);

// Conectar a la base de datos (pool + auto-esquema). No bloquea el arranque: si
// MySQL no responde, la app arranca igual en modo degradado y se sigue reintentando
// en segundo plano, de modo que el esquema se cree solo cuando la base vuelva.
db.connectWithRetry();

// Cabeceras de seguridad (helmet) con CSP acorde a la app: Tailwind CDN, fuentes de Google,
// MediaPipe (jsdelivr + storage.googleapis) e imágenes del diccionario (catbox.moe).
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"],
            scriptSrcAttr: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            styleSrcAttr: ["'self'", "'unsafe-inline'"],
            fontSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:", "blob:", "https://files.catbox.moe", "https://lh3.googleusercontent.com"],
            mediaSrc: ["'self'", "blob:"],
            connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://storage.googleapis.com"],
            workerSrc: ["'self'", "blob:", "https://cdn.jsdelivr.net", "https://storage.googleapis.com"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: []
        }
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' }
}));

// CORS restringido a orígenes permitidos
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,https://traductor-backend-hrdf.onrender.com')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        // Peticiones sin Origin (curl, server-to-server, misma origin) se permiten
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    }
}));

// Middleware
app.use(express.json({ extended: false, limit: '100kb' }));

// Log estructurado de cada petición (duración, estado, IP) + alerta de picos 5xx
app.use(requestLogger);

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

// Contacto/soporte (envía correo vía SMTP o fallback a mailto)
app.use('/api', require('./routes/contact'));

// Python scripts routes (capture, train, recognition).
// Nota: la ruta heredada "script.js" (ejecución de scripts arbitrarios) ya NO se monta.
app.use('/api/python', require('./routes/python-scripts'));

// Serve a placeholder favicon to avoid missing file errors
app.get('/favicon.ico', (req, res) => {
    res.status(204).send(); // Send a "No Content" response
});

// Healthz para el monitor de Render/uptime.
//
// Devuelve 503 si MySQL no responde. Antes contestaba 'ok' pase lo que pase, así que
// un monitor externo veía el servicio "sano" mientras la base estaba caída y la app
// no podía autenticar a nadie: la caída se descubrió porque un usuario se quejó.
// Con esto, cualquier monitor de uptime avisa solo. No revela ningún detalle interno.
app.get('/healthz', (req, res) => {
    if (!dbEstado.conectada) {
        return res.status(503).type('text').send('degraded');
    }
    res.type('text').send('ok');
});

// Estadísticas operativas: actividad del proceso, servicios Flask y estado de MySQL.
//
// Iba SIN autenticación y cualquiera podía leer el tráfico y el estado interno del
// servicio. Ahora exige OPS_TOKEN. No usa JWT a propósito: hace falta justamente
// cuando la base de datos está caída y no se puede validar ningún token.
const OPS_TOKEN = process.env.OPS_TOKEN;

function opsAutorizado(req) {
    if (!OPS_TOKEN) return process.env.NODE_ENV !== 'production';
    const enviado = req.get('X-Ops-Token') || req.query.token || '';
    const a = Buffer.from(String(enviado));
    const b = Buffer.from(OPS_TOKEN);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get('/api/ops/stats', (req, res) => {
    if (!opsAutorizado(req)) {
        return res.status(404).json({ msg: 'Recurso no encontrado' });
    }
    res.json({
        uptimeSec: Math.round(process.uptime()),
        requests: {
            total: counters.total,
            byStatus: counters.byStatus,
            avgMs: Math.round(counters.avgMs),
            fivexxLastMinute: counters.fivexxWindow.count,
            fivexxPeak: counters.fivexxWindow.peak
        },
        flask: healthMonitor.status,
        db: {
            conectada: dbEstado.conectada,
            ultimoError: dbEstado.ultimoError,
            ultimoIntento: dbEstado.ultimoIntento
        },
        startedAt: new Date(counters.startedAt).toISOString()
    });
});

// Proxy requests to /api/health to the Flask server.
// http-proxy notifica los fallos por EVENTO, no lanzando: sin este listener un
// ECONNREFUSED (Flask aún arrancando) emitía un 'error' sin escuchadores y eso
// tumbaba el proceso Node entero, justo en los ~30 s de cada arranque en frío.
const proxy = httpProxy.createProxyServer();

proxy.on('error', (err, req, res) => {
    logError('[proxy] fallo hablando con Flask', { message: err.message });
    if (res && !res.headersSent && typeof res.writeHead === 'function') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'unhealthy', service: 'reconocimiento' }));
    } else if (res && typeof res.end === 'function') {
        res.end();
    }
});

app.get('/api/health', (req, res) => {
    proxy.web(req, res, { target: `${FLASK_REC_URL}/health` });
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
    info('python-servicios-externos', { msg: 'no se lanzan procesos locales' });
} else {
    capturaProc = startPythonService(capturaImagenesPath, { FLASK_CAPTURE_PORT: '5001' });
    reconocimientoProc = startPythonService(reconocimientoPath, { USER_ID: '1', FLASK_REC_PORT: '5000' });
}

// Síncrono a propósito: 'exit' no espera a nada asíncrono, así que la versión
// `async` anterior no llegaba a matar los procesos Python al salir.
function gracefulShutdown() {
    console.log('Shutting down: stopping Python services...');
    try { capturaProc && capturaProc.kill(); } catch {}
    try { reconocimientoProc && reconocimientoProc.kill(); } catch {}
}

process.on('SIGINT', () => { gracefulShutdown(); process.exit(0); });
process.on('SIGTERM', () => { gracefulShutdown(); process.exit(0); });
process.on('exit', gracefulShutdown);

// Sin estos manejadores, cualquier promesa rechazada sin capturar tumbaba el
// servidor sin dejar rastro en los logs de Render.
process.on('unhandledRejection', (reason) => {
    logError('unhandledRejection', { message: reason && reason.message ? reason.message : String(reason) });
});
process.on('uncaughtException', (err) => {
    logError('uncaughtException', { message: err.message, stack: err.stack });
    // Estado ya no fiable: se cierra ordenadamente y Render levanta una instancia nueva.
    gracefulShutdown();
    process.exit(1);
});

// Ruta para servir el archivo "index.html" por defecto
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/templates/index.html'));
});

// Dynamic route to serve HTML pages
app.get('/:page', (req, res) => {
    const page = req.params.page;
    // Solo nombres de archivo HTML sencillos: evita path traversal (.., %2F, barras, etc.)
    if (!/^[A-Za-z0-9_-]+\.html$/.test(page)) {
        return res.status(400).send('Invalid page.');
    }
    res.sendFile(path.join(__dirname, '../frontend/templates', page), (err) => {
        if (err) res.status(404).send('Page not found.');
    });
});

// 404 para todo lo que no casó con ninguna ruta.
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ msg: 'Recurso no encontrado' });
    }
    res.status(404).send('Not found.');
});

// Manejador de errores final: sin esto Express respondía con el stack completo
// (rutas del servidor incluidas) y algunos fallos quedaban sin registrar.
app.use((err, req, res, next) => {
    logError('[express] error no controlado', {
        message: err.message,
        path: req.originalUrl,
        method: req.method
    });
    if (res.headersSent) return next(err);
    if (req.path.startsWith('/api/')) {
        return res.status(500).json({ msg: 'Error en el servidor' });
    }
    res.status(500).send('Error en el servidor.');
});

const PORT = process.env.PORT || 3000;

// Monitoreo de salud de los servicios Flask (logs de caída/recuperación, cada 30 s)
healthMonitor.start(30000);

app.listen(PORT, () => {
    info('server-started', { port: PORT, env: process.env.NODE_ENV || 'development' });
});
