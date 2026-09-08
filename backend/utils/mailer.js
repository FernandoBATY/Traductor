const nodemailer = require('nodemailer');

let transporter = null;

if (process.env.SMTP_HOST) {
    try {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT, 10) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: process.env.SMTP_USER
                ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                : undefined
        });
    } catch (e) {
        console.error('[mailer] SMTP mal configurado:', e.message);
        transporter = null;
    }
}

function mailerConfigured() {
    return !!transporter;
}

async function sendPasswordReset(email, resetLink) {
    if (!transporter) return false;
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    await transporter.sendMail({
        from,
        to: email,
        subject: 'Restablecer contraseña - Traductor de Lengua de Señas',
        html: `<p>Recibimos una solicitud para restablecer tu contraseña.</p>
               <p>Haz clic en el siguiente enlace (válido por 30 minutos):</p>
               <p><a href="${resetLink}">${resetLink}</a></p>
               <p>Si no la solicitaste, ignora este correo.</p>`
    });
    return true;
}

module.exports = { mailerConfigured, sendPasswordReset };