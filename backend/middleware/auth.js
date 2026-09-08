const jwt = require('jsonwebtoken');
const { secret } = require('../config/jwt');
const User = require('../models/User');

module.exports = async function auth(req, res, next) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
        return res.status(401).json({ msg: 'No hay token, autorización denegada' });
    }

    let payload;
    try {
        payload = jwt.verify(header.slice(7), secret);
    } catch (err) {
        return res.status(401).json({ msg: 'Token inválido o expirado' });
    }

    try {
        const ver = await User.getTokenVersion(payload.user.id);
        if (ver === -1) {
            return res.status(401).json({ msg: 'Usuario no existe' });
        }
        if (ver !== (payload.ver || 0)) {
            return res.status(401).json({ msg: 'Sesión revocada. Vuelve a iniciar sesión.' });
        }
        req.user = payload.user;
        req.userId = payload.user.id;
        req.ver = payload.ver || 0;
        return next();
    } catch (err) {
        // Degradado: si la BD no está disponible no se puede verificar la versión,
        // se deja pasar con advertencia para no tumbar la API entera.
        console.error('[auth] BD no disponible al verificar token:', err.message);
        req.user = payload.user;
        req.userId = payload.user.id;
        req.ver = payload.ver || 0;
        return next();
    }
};