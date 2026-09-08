const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { check, validationResult } = require('express-validator');
const User = require('../models/User');
const rateLimit = require('../middleware/rateLimit');
const { secret, expiresIn } = require('../config/jwt');

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
            // Normaliza el email para evitar usuarios duplicados por variaciones
            const normalizedEmail = email.trim().toLowerCase();

            let user = await User.findOneByEmail(normalizedEmail);
            if (user) {
                const isMatch = await bcrypt.compare(password, user.contraseña);
                if (!isMatch) {
                    user = null;
                }
            }

            // Mensaje genérico: no revela si el correo existe (evita enumeración de usuarios)
            if (!user) {
                return res.status(400).json({ msg: 'Credenciales inválidas' });
            }

            const payload = {
                user: { id: user.id }
            };

            jwt.sign(
                payload,
                secret,
                { expiresIn },
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
        check('username', 'El nombre de usuario no puede contener etiquetas HTML').matches(/^[^<>]+$/),
        check('email', 'Por favor incluye un correo electrónico válido').isEmail(),
        check('password', 'La contraseña debe tener 8 o más caracteres').isLength({ min: 8 })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { username, email, password } = req.body;
        const normalizedEmail = email.trim().toLowerCase();
        const trimmedUsername = String(username).trim();

        try {
            let user = await User.findOneByEmail(normalizedEmail);
            if (user) {
                return res.status(400).json({ msg: 'El usuario ya existe' });
            }

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            const userId = await User.create({
                username: trimmedUsername,
                email: normalizedEmail,
                password: hashedPassword
            });

            const payload = {
                user: { id: userId }
            };

            jwt.sign(
                payload,
                secret,
                { expiresIn },
                (err, token) => {
                    if (err) throw err;
                    res.json({ token, user: { id: userId, email: normalizedEmail, username: trimmedUsername } });
                }
            );
        } catch (err) {
            console.error(err.message);
            res.status(500).send('Error en el servidor');
        }
    }
);

module.exports = router;