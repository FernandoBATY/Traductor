// Logs estructurados en JSON a stdout (Parseable en Render y otros servicios)
function log(level, msg, meta = {}) {
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        svc: 'node',
        msg,
        ...meta
    });
    if (level === 'error') console.error(line);
    else console.log(line);
}

module.exports = {
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta)
};