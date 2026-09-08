const { info, warn } = require('../utils/logger');

// Contadores de actividad expuestos en /api/ops/stats
const counters = {
    total: 0,
    byStatus: {},
    startedAt: Date.now(),
    fivexxWindow: { start: Date.now(), count: 0, peak: 0 },
    avgMs: 0,
    samples: 0
};

function noteFivexx() {
    const now = Date.now();
    const w = counters.fivexxWindow;
    if (now - w.start > 60000) {
        w.start = now;
        w.count = 1;
    } else {
        w.count += 1;
    }
    if (w.count > w.peak) w.peak = w.count;
    if (w.count >= 10) {
        warn('ALERTA: pico de errores 5xx', {
            fivexxInLastMinute: w.count,
            peak: w.peak
        });
    }
}

function requestLogger(req, res, next) {
    const t0 = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - t0;
        const status = res.statusCode;

        counters.total += 1;
        counters.byStatus[status] = (counters.byStatus[status] || 0) + 1;
        counters.avgMs = (counters.avgMs * counters.samples + ms) / (counters.samples + 1);
        counters.samples += 1;

        info('http', {
            method: req.method,
            path: req.originalUrl,
            status,
            ms,
            ip: req.ip
        });

        if (status >= 500) noteFivexx();
    });
    next();
}

module.exports = requestLogger;
module.exports.counters = counters;