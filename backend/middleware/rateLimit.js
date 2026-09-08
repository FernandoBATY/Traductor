const buckets = new Map();

function cleanBuckets(windowMs) {
    const now = Date.now();
    for (const [key, times] of buckets) {
        const remaining = times.filter(t => now - t < windowMs);
        if (remaining.length === 0) buckets.delete(key);
        else buckets.set(key, remaining);
    }
}

setInterval(() => cleanBuckets(60000), 60000);

module.exports = function rateLimit({ windowMs = 60000, max = 10 } = {}) {
    return (req, res, next) => {
        const key = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const times = (buckets.get(key) || []).filter(t => now - t < windowMs);
        if (times.length >= max) {
            return res.status(429).json({ msg: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' });
        }
        times.push(now);
        buckets.set(key, times);
        next();
    };
};