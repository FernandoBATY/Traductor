const jwt = require('jsonwebtoken');

module.exports = function auth(req, res, next) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
        return res.status(401).json({ msg: 'No hay token, autorización denegada' });
    }
    try {
        const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET || 'secret');
        req.user = payload.user;
        req.userId = payload.user.id;
        next();
    } catch (err) {
        return res.status(401).json({ msg: 'Token inválido o expirado' });
    }
};