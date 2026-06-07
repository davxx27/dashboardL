# Sync privado con Supabase (login por email)

Sincroniza tu dashboard entre Mac y iPhone. Con **autenticación**: cada usuario
solo puede leer/escribir sus propias filas (Row Level Security), así que tus
datos son privados aunque el sitio esté desplegado en una URL pública.

## 1. Crear el proyecto
1. [supabase.com](https://supabase.com) → cuenta gratis → **New project**.
2. Región cercana (p. ej. *East US*). Espera a que se aprovisione (~2 min).
3. **Project Settings → API**: copia el **Project URL** y la **anon / public key**
   (la *anon* es para cliente; **nunca** uses la *service_role* en el navegador).

## 2. Crear la tabla y las políticas
**SQL Editor → New query**, pega esto y ejecuta (RUN):

```sql
-- Estado del dashboard, una fila por (usuario, clave)
create table if not exists public.app_state (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  key        text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.app_state enable row level security;

-- Cada usuario solo accede a SUS filas
create policy "app_state select own" on public.app_state
  for select using (auth.uid() = user_id);
create policy "app_state insert own" on public.app_state
  for insert with check (auth.uid() = user_id);
create policy "app_state update own" on public.app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "app_state delete own" on public.app_state
  for delete using (auth.uid() = user_id);

-- Realtime: que los cambios salten al instante entre dispositivos
alter publication supabase_realtime add table public.app_state;
```

## 3. Crear tu usuario
**Authentication → Users → Add user** (email + contraseña), o se creará al
registrarte desde la app la primera vez. Para uso personal, en
**Authentication → Providers → Email**, puedes **desactivar "Confirm email"**
para entrar sin pasar por el correo.

## 4. Pasarme las claves
Cuando termines, mándame aquí:
- **Project URL** (`https://xxxx.supabase.co`)
- **anon key** (`eyJhbGci...`)

Con eso construyo el módulo `sync.js` (puerta de login + sincronización de todas
las páginas) y lo probamos antes de desplegar.
