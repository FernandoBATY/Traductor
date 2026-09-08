const axios = require('axios');
const { info, warn, error } = require('../utils/logger');

const FLASK_REC_URL = process.env.FLASK_REC_URL || 'http://127.0.0.1:5000';
const FLASK_CAPTURE_URL = process.env.FLASK_CAPTURE_URL || 'http://127.0.0.1:5001';

const status = {
    reconocimiento: 'unknown',
    captura: 'unknown',
    lastCheck: null,
    lastTransition: null
};

async function checkService(name, url) {
    try {
        const r = await axios.get(url, { timeout: 3000 });
        return r.status < 500;
    } catch (e) {
        return false;
    }
}

async function checkAll() {
    const checks = [
        {
            name: 'reconocimiento',
            urls: [`${FLASK_REC_URL}/api/health`, `${FLASK_REC_URL}/health`]
        },
        {
            name: 'captura',
            urls: [`${FLASK_CAPTURE_URL}/health`]
        }
    ];

    for (const svc of checks) {
        let healthy = false;
        for (const url of svc.urls) {
            if (await checkService(svc.name, url)) { healthy = true; break; }
        }
        const prev = status[svc.name];
        status[svc.name] = healthy ? 'up' : 'down';
        status.lastCheck = new Date().toISOString();

        if (prev === 'unknown') {
            info('flask-health', { service: svc.name, state: status[svc.name] });
        } else if (prev !== status[svc.name]) {
            status.lastTransition = new Date().toISOString();
            if (healthy) {
                warn('flask-health', { service: svc.name, state: 'up', msg: `Servicio Flask ${svc.name} volvió a estar disponible` });
            } else {
                error('flask-health', { service: svc.name, state: 'down', msg: `Servicio Flask ${svc.name} CAÍDO` });
            }
        }
    }
}

function start(intervalMs = 30000) {
    checkAll();
    setInterval(checkAll, intervalMs);
}

module.exports = { start, status };