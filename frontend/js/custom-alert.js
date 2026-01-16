// Sistema de alertas personalizadas
function showCustomAlert(message, type = 'info') {
    // Crear el contenedor si no existe
    let alertContainer = document.getElementById('customAlertContainer');
    if (!alertContainer) {
        alertContainer = document.createElement('div');
        alertContainer.id = 'customAlertContainer';
        alertContainer.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9999;
            pointer-events: none;
        `;
        document.body.appendChild(alertContainer);
    }

    // Crear el elemento de alerta
    const alertElement = document.createElement('div');
    alertElement.className = 'custom-alert';
    
    // Determinar el ícono según el tipo
    let icon = '';
    let iconColor = '';
    switch(type) {
        case 'success':
            icon = 'check_circle';
            iconColor = 'text-primary';
            break;
        case 'error':
            icon = 'error';
            iconColor = 'text-red-500';
            break;
        case 'warning':
            icon = 'warning';
            iconColor = 'text-yellow-500';
            break;
        default:
            icon = 'info';
            iconColor = 'text-blue-500';
    }

    alertElement.innerHTML = `
        <div style="
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(12px);
            border: 2px solid rgba(13, 242, 89, 0.3);
            border-radius: 16px;
            padding: 24px 32px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            gap: 16px;
            min-width: 320px;
            max-width: 480px;
            pointer-events: auto;
            animation: slideInScale 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        ">
            <span class="material-symbols-outlined ${iconColor}" style="font-size: 32px; flex-shrink: 0;">
                ${icon}
            </span>
            <p style="
                color: #0d1c12;
                font-size: 15px;
                font-weight: 500;
                line-height: 1.5;
                margin: 0;
                flex-grow: 1;
            ">
                ${message}
            </p>
        </div>
    `;

    // Añadir estilos de animación si no existen
    if (!document.getElementById('customAlertStyles')) {
        const style = document.createElement('style');
        style.id = 'customAlertStyles';
        style.textContent = `
            @keyframes slideInScale {
                0% {
                    opacity: 0;
                    transform: translateY(-20px) scale(0.9);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
            @keyframes slideOutScale {
                0% {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
                100% {
                    opacity: 0;
                    transform: translateY(-20px) scale(0.9);
                }
            }
        `;
        document.head.appendChild(style);
    }

    alertContainer.appendChild(alertElement);

    // Auto-remover después de 3 segundos
    setTimeout(() => {
        alertElement.style.animation = 'slideOutScale 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
        setTimeout(() => {
            alertElement.remove();
        }, 300);
    }, 3000);
}

// Función de compatibilidad para reemplazar alert()
window.customAlert = showCustomAlert;
