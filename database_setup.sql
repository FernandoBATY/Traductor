-- Script para crear la tabla de usuarios en Aiven MySQL (defaultdb)
-- La conexion ya apunta a la base 'defaultdb' (configurada via DB_NAME).
-- Ejecutar este script en la consola SQL de Aiven/auth localmente con SSL.
-- No usar 'USE usuarios;' aqui: Aiven entrega 'defaultdb'.

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    contraseña VARCHAR(255) NOT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN DEFAULT TRUE,
    INDEX idx_email (email),
    INDEX idx_usuario (usuario)
);

-- Usuario de ejemplo (opcional, solo pruebas) - contrasena 'password123' con bcrypt
INSERT INTO users (usuario, email, contraseña) VALUES
('admin', 'admin@test.com', '$2a$10$7wVHb.Td.lSkTnhyOr2MO.P1J.k3c.kJH8FzmeXWjR5mQk3vld4X.')
ON DUPLICATE KEY UPDATE usuario = VALUES(usuario);