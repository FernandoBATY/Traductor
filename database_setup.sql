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

-- NO se crea ningun usuario de ejemplo. Antes este script insertaba 'admin@test.com'
-- con un hash bcrypt visible en el repositorio, es decir, una cuenta con contrasena
-- conocida por cualquiera que leyera el codigo. Si ese INSERT llego a ejecutarse
-- alguna vez contra la base de datos de produccion, hay que borrar la cuenta:
--
--   SELECT id, usuario, email FROM users WHERE email = 'admin@test.com';
--   DELETE FROM users WHERE email = 'admin@test.com';
--
-- Para crear usuarios, usar el registro de la aplicacion.