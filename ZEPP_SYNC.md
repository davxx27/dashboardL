# Zepp / Amazfit Helio → Locked In (automático)

Pipeline: **Helio Strap → app Zepp → Apple Health → Atajo de iOS (1×/día) →
Supabase (`device_metrics`) → Locked In (Vitals)**.

Zepp no tiene API pública, así que usamos Apple Health como puente. El atajo
corre solo cada mañana y Locked In vuelca los datos en Vitals al abrirse.

---

## 1. Tabla en Supabase (una vez)

SQL Editor → New query → pega y RUN:

```sql
-- Bandeja de entrada de métricas de dispositivos (atajo iOS escribe aquí)
create table if not exists public.device_metrics (
  user_id    uuid             not null default auth.uid()
             references auth.users(id) on delete cascade,
  date       text             not null,   -- 'YYYY-MM-DD'
  type       text             not null,   -- sleep | hrv | rhr | steps
  value      double precision not null,
  created_at timestamptz      not null default now(),
  primary key (user_id, date, type)
);

alter table public.device_metrics enable row level security;

create policy "device_metrics own" on public.device_metrics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Gracias al `default auth.uid()`, el atajo **no** necesita enviar tu user_id.

## 2. Zepp → Apple Health (una vez, en el iPhone)

App **Zepp** → pestaña **Perfil** → **Añadir cuentas** (o *Servicios de
terceros*) → **Apple Health** → activa **todas** las categorías (sueño,
frecuencia cardiaca, HRV, pasos).

Comprueba en la app **Salud** que aparecen datos del Helio (Sueño, VFC, etc.).

## 3. El Atajo de iOS (una vez, ~15 min)

App **Atajos** → **+** → nómbralo `Locked In Sync`.

> Sustituye `TU-EMAIL` y `TU-CONTRASEÑA` por los de tu cuenta de Locked In.
> URL base: `https://vpzlpvgpnhtqnyiuyiyx.supabase.co`
> ANON KEY (cópiala de sync.js, constante `SUPABASE_KEY`).

### Paso A — login (token)

1. Acción **Obtener contenido de URL**:
   - URL: `https://vpzlpvgpnhtqnyiuyiyx.supabase.co/auth/v1/token?grant_type=password`
   - Método: **POST** · Cuerpo: **JSON**
     - `email` (texto): TU-EMAIL
     - `password` (texto): TU-CONTRASEÑA
   - Cabeceras: `apikey` = ANON KEY
2. Acción **Obtener valor de diccionario**: clave `access_token` (de la
   respuesta anterior). → guárdalo como variable **TOKEN**.

### Paso B — leer Apple Health

3. **Buscar muestras de salud** → Tipo: **Análisis de sueño** (valor
   *Dormido*), Fecha de inicio: **ayer 18:00** hasta **ahora**.
4. **Obtener detalles** → **Duración** de cada muestra → **Calcular
   estadística** → **Suma** → divide entre 60 si está en minutos →
   variable **SLEEP** (horas).
5. **Buscar muestras de salud** → **Variabilidad de la frecuencia cardiaca**,
   últimas 24 h → **Calcular estadística → Media** → variable **HRV**.
6. **Buscar muestras de salud** → **Frecuencia cardiaca en reposo**, hoy,
   orden *Más reciente*, límite 1 → variable **RHR**.
7. **Buscar muestras de salud** → **Pasos**, **ayer** completo →
   **Calcular estadística → Suma** → variable **STEPS**.
8. Acción **Fecha actual** → **Dar formato** `yyyy-MM-dd` → variable **HOY**.
   Otra con **ayer** → variable **AYER**.

### Paso C — enviar a Supabase

9. Acción **Texto** con este JSON (inserta las variables):

```json
[
  {"date":"HOY","type":"sleep","value":SLEEP},
  {"date":"HOY","type":"hrv","value":HRV},
  {"date":"HOY","type":"rhr","value":RHR},
  {"date":"AYER","type":"steps","value":STEPS}
]
```

10. Acción **Obtener contenido de URL**:
    - URL: `https://vpzlpvgpnhtqnyiuyiyx.supabase.co/rest/v1/device_metrics`
    - Método: **POST** · Cuerpo: **Archivo** → el Texto del paso 9
    - Cabeceras:
      - `apikey` = ANON KEY
      - `Authorization` = `Bearer TOKEN`
      - `Content-Type` = `application/json`
      - `Prefer` = `resolution=merge-duplicates`

> ⚠️ Decimales: usa **Redondear número** después de cada *Calcular estadística*
> para que HRV/RHR/STEPS sean enteros. Si alguna variable decimal (p. ej. el
> sueño) sale con coma (7,5), aplica **Reemplazar texto** (`,` → `.`) **a esa
> variable concreta** antes de insertarla — nunca al JSON completo (romperías
> las comas del propio JSON).

### Paso D — automatizarlo

**Atajos → Automatización → + → Hora del día → 9:00 → Diariamente** →
ejecuta `Locked In Sync` → desactiva **Pedir confirmación**.

## 4. Locked In hace el resto

Al abrir cualquier página con sesión iniciada, `sync.js` lee `device_metrics`,
vuelca los valores en **Vitals** (sueño, HRV, FC reposo, pasos), los sincroniza
a todos tus dispositivos y vacía la bandeja.

## Limitaciones

- El score propietario de Zepp (BioCharge/readiness) no llega a Apple Health →
  regístralo a mano en Vitals si lo quieres.
- Si NordVPN tiene *Threat Protection* activo, el atajo no podrá conectar
  (mismo DNS de siempre).
- Si cambias tu contraseña de Locked In, actualízala dentro del atajo.
