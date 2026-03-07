(function () {
  const API = '/api';
  const params = new URLSearchParams(window.location.search);

  async function fetchJSON(url, options = {}) {
    const res = await fetch(url, { ...options, credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function clearForm(form) {
    if (!form) return;
    form.reset();
    form.querySelectorAll('input').forEach((input) => {
      input.value = '';
    });
  }

  const loginForm = document.getElementById('formLogin');
  clearForm(loginForm);
  if (params.get('logout') === '1') {
    fetch(API + '/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => { });
    window.history.replaceState({}, '', window.location.pathname);
  }
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('loginError');
      const submit = document.getElementById('btnLoginSubmit');
      if (err) err.textContent = '';
      submit.disabled = true;
      submit.textContent = 'Logging in...';
      try {
        await fetchJSON(API + '/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: loginForm.email.value.trim(),
            password: loginForm.password.value
          })
        });
        window.location.href = '/app';
      } catch (error) {
        if (err) err.textContent = error.message || 'Login failed';
      } finally {
        submit.disabled = false;
        submit.textContent = 'Log In';
      }
    });
  }

  const registerForm = document.getElementById('formRegister');
  clearForm(registerForm);
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('registerError');
      const submit = document.getElementById('btnRegisterSubmit');
      if (err) err.textContent = '';
      submit.disabled = true;
      submit.textContent = 'Creating account...';
      try {
        await fetchJSON(API + '/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: registerForm.name?.value?.trim() || null,
            email: registerForm.email.value.trim(),
            password: registerForm.password.value
          })
        });
        window.location.href = '/app';
      } catch (error) {
        if (err) err.textContent = error.message || 'Registration failed';
      } finally {
        submit.disabled = false;
        submit.textContent = 'Create Account';
      }
    });
  }
})();

