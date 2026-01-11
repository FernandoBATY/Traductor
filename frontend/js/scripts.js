const signUpButton = document.getElementById('signUp');
const signInButton = document.getElementById('signIn');
const container = document.getElementById('container');

signUpButton.addEventListener('click', () => {
    container.classList.add("right-panel-active");
});

signInButton.addEventListener('click', () => {
    container.classList.remove("right-panel-active");
});

async function register() {
    const username = document.getElementById('username').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    // Validaciones básicas
    if (!username || !email || !password) {
        alert('Por favor, complete todos los campos.');
        return;
    }

    if (!validateEmail(email)) {
        alert('Por favor, ingrese un correo electrónico válido.');
        return;
    }

    if (!validatePassword(password)) {
        alert('La contraseña debe tener al menos 6 caracteres e incluir números y letras.');
        return;
    }

    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();
        if (response.status === 200) {
            alert('Usuario registrado con éxito');
            // Redirigir a la página de inicio de sesión
            container.classList.remove("right-panel-active");
        } else {
            alert(data.msg);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error registrando el usuario. Por favor, intente de nuevo.');
    }
}

async function login() {
    const email = document.getElementById('emailLogin').value;
    const password = document.getElementById('passwordLogin').value;

    if (!email || !password) {
        alert('Por favor, complete todos los campos.');
        return;
    }

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
            const errorData = await response.json();
            alert(errorData.msg || 'Error al iniciar sesión');
            return;
        }

        const data = await response.json();
        if (data.token) {
            alert('Inicio de sesión exitoso');
            localStorage.setItem('userId', data.user.id);
            window.location.href = 'dashboard.html';
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al iniciar sesión. Por favor, intente de nuevo.');
    }
}

// Validación de correo electrónico
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
}

// Validación de contraseña
function validatePassword(password) {
    const re = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/; // Al menos 6 caracteres, una letra y un número
    return re.test(password);
}

// Función para visualizar la contraseña
function togglePasswordVisibility(fieldId) {
    const passwordField = document.getElementById(fieldId);
    if (passwordField.type === "password") {
        passwordField.type = "text";
    } else {
        passwordField.type = "password";
    }
}

// Evento para toggle password en los campos de contraseña
document.querySelectorAll('.toggle-password').forEach(button => {
    button.addEventListener('click', (e) => {
        const targetId = e.target.getAttribute('data-target');
        togglePasswordVisibility(targetId);
    });
});
