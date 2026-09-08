const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { check, validationResult } = require('express-validator');
const User = require('../models/User');
const rateLimit = require('../middleware/rateLimit');

const loginLimiter = rateLimit({ windowMs: 60000, max: 10 });
const registerLimiter = rateLimit({ windowMs: 60000, max: 5 });

// Ruta de inicio de sesión
router.post(
    '/login',
    loginLimiter,
    [
        check('email', 'Por favor incluye un correo electrónico válido').isEmail(),
        check('password', 'La contraseña es requerida').exists()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        try {
            let user = await User.findOneByEmail(email);
            if (!user) {
                return res.status(400).json({ msg: 'Usuario no encontrado' });
            }

            const isMatch = await bcrypt.compare(password, user.contraseña);
            if (!isMatch) {
                return res.status(400).json({ msg: 'Credenciales inválidas' });
            }

            const payload = {
                user: { id: user.id }
            };

            jwt.sign(
                payload,
                process.env.JWT_SECRET || 'secret', // Usa una variable de entorno en producción
                { expiresIn: 360000 },
                (err, token) => {
                    if (err) throw err;
                    res.json({ token, user: { id: user.id, email: user.email, username: user.usuario } });
                }
            );
        } catch (err) {
            console.error(err.message);
            res.status(500).send('Error en el servidor');
        }
    }
);

// Ruta de registro
router.post(
    '/register',
    registerLimiter,
    [
        check('username', 'Nombre de usuario es requerido').not().isEmpty(),
        check('email', 'Por favor incluye un correo electrónico válido').isEmail(),
        check('password', 'La contraseña debe tener 6 o más caracteres').isLength({ min: 6 })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { username, email, password } = req.body;

        try {
            let user = await User.findOneByEmail(email);
            if (user) {
                return res.status(400).json({ msg: 'El usuario ya existe' });
            }

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            const userId = await User.create({ username, email, password: hashedPassword });

            const payload = {
                user: { id: userId }
            };

            jwt.sign(
                payload,
                process.env.JWT_SECRET || 'secret', // Usa una variable de entorno en producción
                { expiresIn: 360000 },
                (err, token) => {
                    if (err) throw err;
                    res.json({ token, user: { id: userId, email, username } });
                }
            );
        } catch (err) {
            console.error(err.message);
            res.status(500).send('Error en el servidor');
        }
    }
);

module.exports = router;

