// =============================================================
// sync.js — Login + sincronización privada (Supabase) para todo
// el dashboard. Inclúyelo en cada página DESPUÉS del cliente de
// Supabase:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="sync.js" defer></script>
//
// Cómo funciona:
//  - Puerta de login (email + contraseña, Supabase Auth). Nadie ve
//    tus datos sin iniciar sesión, aunque el sitio sea público.
//  - Sincroniza TODO localStorage (menos las claves de sesión sb-*)
//    como un único documento por usuario en la tabla `app_state`.
//  - Realtime: cambios en otro dispositivo se aplican y refrescan.
//  - last-write-wins (suficiente para un único usuario multi-dispositivo).
// =============================================================
(function () {
  'use strict';

  // -------- Config (anon key: pública por diseño; la privacidad la da el login + RLS) --------
  const SUPABASE_URL = 'https://vpzlpvgpnhtqnyiuyiyx.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwemxwdmdwbmh0cW55aXV5aXl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MDczNzQsImV4cCI6MjA5NjM4MzM3NH0.NkWkxhkKjHhBGbMwi-eJzkkL2hS7O4vWoGImV58YqWI';

  const ROW_KEY = 'dashboard';
  const DENY_PREFIXES = ['sb-'];          // tokens de sesión de Supabase
  const META_KEY = '__sync_client_id';

  if (SUPABASE_URL.indexOf('PASTE-') === 0) return;        // sin configurar → local
  if (!window.supabase || !window.supabase.createClient) {
    console.warn('[sync] supabase-js no está cargado; la página funcionará solo en local.');
    return;
  }

  const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // ID de cliente para ignorar los "ecos" realtime de nuestros propios pushes
  let clientId = localStorage.getItem(META_KEY);
  if (!clientId) {
    clientId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now() + Math.random());
    localStorage.setItem(META_KEY, clientId);
  }

  let session = null;
  let pushTimer = null;
  let suppress = false;   // true mientras aplicamos datos remotos (no re-empujar)

  // -------- Wrap de localStorage para detectar cambios locales --------
  const origSet = localStorage.setItem.bind(localStorage);
  const origRemove = localStorage.removeItem.bind(localStorage);

  function shouldSync(k) {
    if (!k || k === META_KEY) return false;
    for (const p of DENY_PREFIXES) if (k.indexOf(p) === 0) return false;
    return true;
  }

  localStorage.setItem = function (k, v) {
    origSet(k, v);
    try { if (!suppress && session && shouldSync(k)) schedulePush(); } catch (e) {}
  };
  localStorage.removeItem = function (k) {
    origRemove(k);
    try { if (!suppress && session && shouldSync(k)) schedulePush(); } catch (e) {}
  };

  function collect() {
    const store = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (shouldSync(k)) store[k] = localStorage.getItem(k);
    }
    return store;
  }

  function applyRemote(store) {
    suppress = true;
    try {
      // Espeja borrados: quita claves locales que ya no están en remoto.
      const localKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (shouldSync(k)) localKeys.push(k);
      }
      for (const k of localKeys) if (!(k in store)) origRemove(k);
      for (const k in store) origSet(k, store[k]);
    } finally {
      suppress = false;
    }
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 800);
  }

  async function push() {
    if (!session) return;
    const payload = { _client: clientId, store: collect() };
    try {
      await supa.from('app_state').upsert(
        {
          user_id: session.user.id,
          key: ROW_KEY,
          data: payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,key' }
      );
    } catch (e) {
      console.warn('[sync] push falló', e);
    }
  }

  async function pull() {
    if (!session) return false;
    try {
      const { data, error } = await supa
        .from('app_state')
        .select('data')
        .eq('user_id', session.user.id)
        .eq('key', ROW_KEY)
        .maybeSingle();
      if (error) throw error;

      if (data && data.data && data.data.store) {
        const remoteJson = JSON.stringify(data.data.store);
        const localJson = JSON.stringify(collect());
        if (remoteJson !== localJson) {
          applyRemote(data.data.store);
          return true; // hubo cambios → la página necesita re-render
        }
      } else {
        await push(); // primera vez: sube lo local como semilla
      }
    } catch (e) {
      console.warn('[sync] pull falló', e);
    }
    return false;
  }

  function softReload() {
    if (sessionStorage.getItem('__sync_reloading')) return;
    sessionStorage.setItem('__sync_reloading', '1');
    location.reload();
  }
  window.addEventListener('load', () => {
    setTimeout(() => sessionStorage.removeItem('__sync_reloading'), 1500);
  });

  function subscribe() {
    supa
      .channel('app_state_' + session.user.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_state', filter: 'user_id=eq.' + session.user.id },
        (payload) => {
          const row = payload.new;
          if (!row || row.key !== ROW_KEY || !row.data) return;
          if (row.data._client === clientId) return; // nuestro propio cambio
          if (row.data.store) {
            applyRemote(row.data.store);
            softReload();
          }
        }
      )
      .subscribe();
  }

  // ============================================================
  //  UI de login (overlay a pantalla completa)
  // ============================================================
  const CSS = `
.sync-gate {
  position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at 82% 14%, rgba(224,118,88,0.16), transparent 45%),
    radial-gradient(circle at 18% 90%, rgba(180,180,200,0.06), transparent 50%),
    #050506;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
}
.sync-card {
  width: 100%; max-width: 360px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 18px; padding: 26px 22px;
  backdrop-filter: blur(24px) saturate(1.2);
  box-shadow: 0 20px 60px rgba(0,0,0,0.55);
}
.sync-title {
  margin: 0 0 4px; font-size: 22px; font-weight: 700; letter-spacing: -0.02em;
  background: linear-gradient(180deg,#FFFFFF 0%,#C7C4BC 120%);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
}
.sync-sub { margin: 0 0 20px; font-size: 12.5px; color: #76746E; }
.sync-field { margin-bottom: 12px; }
.sync-label {
  display: block; font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 6px;
}
.sync-input {
  width: 100%; box-sizing: border-box; padding: 11px 13px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10);
  border-radius: 11px; color: #FAFAFA; font-family: inherit; font-size: 15px;
  outline: none; transition: border-color 0.15s;
}
.sync-input:focus { border-color: rgba(224,118,88,0.55); }
.sync-btn {
  width: 100%; margin-top: 8px; padding: 12px;
  background: linear-gradient(180deg,#FFFFFF 0%,#E8E5DD 100%);
  color: #0A0A0B; border: none; border-radius: 11px;
  font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
  transition: transform 0.1s, filter 0.15s;
}
.sync-btn:hover { filter: brightness(1.04); }
.sync-btn:active { transform: scale(0.98); }
.sync-btn[disabled] { opacity: 0.6; cursor: default; }
.sync-toggle {
  margin-top: 16px; text-align: center; font-size: 12.5px; color: #B8B6B0;
}
.sync-toggle a { color: #E07658; cursor: pointer; text-decoration: none; font-weight: 600; }
.sync-msg { margin-top: 12px; font-size: 12px; min-height: 16px; color: #FF6B6B; }
.sync-msg.ok { color: #6BE3A4; }
.sync-logout {
  position: fixed; right: 12px; bottom: 12px; z-index: 50;
  width: 34px; height: 34px; border-radius: 50%;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.10);
  color: #76746E; cursor: pointer; font-size: 15px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  font-family: -apple-system, sans-serif;
}
.sync-logout:hover { color: #FAFAFA; background: rgba(255,255,255,0.09); }
`;

  let mode = 'in'; // 'in' | 'up'
  let gateEl = null;

  function injectCss() {
    if (document.getElementById('sync-style')) return;
    const s = document.createElement('style');
    s.id = 'sync-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function showGate() {
    injectCss();
    if (gateEl) { gateEl.style.display = 'flex'; return; }
    gateEl = document.createElement('div');
    gateEl.className = 'sync-gate';
    gateEl.innerHTML = `
      <div class="sync-card">
        <h1 class="sync-title">Locked In</h1>
        <p class="sync-sub" id="syncSub">Inicia sesión para sincronizar tus datos.</p>
        <div class="sync-field">
          <label class="sync-label" for="syncEmail">Email</label>
          <input class="sync-input" id="syncEmail" type="email" autocomplete="email" inputmode="email" />
        </div>
        <div class="sync-field">
          <label class="sync-label" for="syncPass">Contraseña</label>
          <input class="sync-input" id="syncPass" type="password" autocomplete="current-password" />
        </div>
        <button class="sync-btn" id="syncSubmit">Entrar</button>
        <div class="sync-toggle" id="syncToggle">¿No tienes cuenta? <a>Crear una</a></div>
        <div class="sync-msg" id="syncMsg"></div>
        <div class="sync-toggle" style="margin-top:18px;font-size:11.5px;opacity:0.8">
          <a id="syncLocal">Usar sin sincronizar (solo este dispositivo)</a>
        </div>
      </div>`;
    document.body.appendChild(gateEl);
    document.body.style.overflow = 'hidden';

    gateEl.querySelector('#syncSubmit').addEventListener('click', onSubmit);
    gateEl.querySelector('#syncPass').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onSubmit();
    });
    gateEl.querySelector('#syncLocal').addEventListener('click', () => {
      hideGate(); // modo local: sin sesión, sin sync; los datos quedan en este dispositivo
    });
    renderMode();
  }

  function renderMode() {
    if (!gateEl) return;
    gateEl.querySelector('#syncSubmit').textContent = mode === 'in' ? 'Entrar' : 'Crear cuenta';
    gateEl.querySelector('#syncSub').textContent =
      mode === 'in' ? 'Inicia sesión para sincronizar tus datos.' : 'Crea tu cuenta (una sola vez).';
    const t = gateEl.querySelector('#syncToggle');
    t.innerHTML = mode === 'in'
      ? '¿No tienes cuenta? <a>Crear una</a>'
      : '¿Ya tienes cuenta? <a>Inicia sesión</a>';
    t.querySelector('a').addEventListener('click', () => {
      mode = mode === 'in' ? 'up' : 'in';
      setMsg('', false);
      renderMode();
    });
  }

  function hideGate() {
    if (gateEl) gateEl.style.display = 'none';
    document.body.style.overflow = '';
  }

  function setMsg(text, ok) {
    const m = gateEl && gateEl.querySelector('#syncMsg');
    if (!m) return;
    m.textContent = text;
    m.classList.toggle('ok', !!ok);
  }

  async function onSubmit() {
    const email = gateEl.querySelector('#syncEmail').value.trim();
    const pass = gateEl.querySelector('#syncPass').value;
    const btn = gateEl.querySelector('#syncSubmit');
    if (!email || !pass) { setMsg('Escribe email y contraseña.', false); return; }
    btn.disabled = true;
    setMsg('…', false);
    try {
      if (mode === 'in') {
        const { error } = await supa.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      } else {
        const { data, error } = await supa.auth.signUp({ email, password: pass });
        if (error) throw error;
        if (!data.session) {
          setMsg('Cuenta creada. Revisa tu email para confirmar y luego inicia sesión.', true);
          btn.disabled = false;
          return;
        }
      }
      // onAuthStateChange se encarga del resto
    } catch (e) {
      setMsg((e && e.message) ? e.message : 'No se pudo. Inténtalo de nuevo.', false);
      btn.disabled = false;
    }
  }

  function addLogout() {
    if (document.getElementById('syncLogout')) return;
    const b = document.createElement('button');
    b.id = 'syncLogout';
    b.className = 'sync-logout';
    b.title = 'Cerrar sesión';
    b.textContent = '⎋';
    b.addEventListener('click', async () => {
      await supa.auth.signOut();
      location.reload();
    });
    document.body.appendChild(b);
  }

  // ============================================================
  //  Arranque
  // ============================================================
  let booted = false;

  async function afterAuth() {
    hideGate();
    addLogout();
    const changed = await pull();
    subscribe();
    if (changed) softReload();
  }

  async function boot() {
    if (booted) return;
    booted = true;
    injectCss();
    const { data } = await supa.auth.getSession();
    session = data ? data.session : null;
    if (session) {
      await afterAuth();
    } else {
      showGate();
    }
  }

  supa.auth.onAuthStateChange((_event, s) => {
    session = s;
    if (s) afterAuth();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
