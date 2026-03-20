-- Script simplificado para crear solo la tabla requerida actualmente
-- Ejecutar este script en MySQL después de crear la base de datos 'usuarios'

-- IMPORTANTE: Seleccionar la base de datos primero
USE usuarios;

-- Tabla de usuarios para el sistema de autenticación (ÚNICA TABLA REQUERIDA)
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

-- Crear un usuario de ejemplo (opcional - solo para pruebas)
-- La contraseña es 'password123' hasheada con bcrypt
INSERT INTO users (usuario, email, contraseña) VALUES 
('admin', 'admin@test.com', '$2a$10$7wVHb.Td.lSkTnhyOr2MO.P1J.k3c.kJH8FzmeXWjR5mQk3vld4X.')
ON DUPLICATE KEY UPDATE usuario = VALUES(usuario);

-- Verificar que se creó correctamente
SELECT * FROM users;
DESCRIBE users;