# Panel de gestión · Cristalería Baix Vinalopó

Panel de administración interno de Cristalería Baix Vinalopó (Cristalería BV), hecho a partir del panel de referencia de OficiosOsIA: **el mismo login, el mismo Admin Panel y el mismo Super Admin**, sin nada de restaurante.

## Qué tiene

**Admin Panel** (lo que ve el equipo, según sus permisos):

- **Dashboard**: accesos rápidos a las secciones que puede abrir cada uno y los avisos.
- **Usuarios**: consulta de usuarios y de sus permisos por sección.
- **Nueva petición**: reportar errores, pedir mejoras o preguntar dudas, y seguir cómo van.
- **Ayuda**: guías paso a paso y recorridos guiados sobre la pantalla real.
- **Avisos** (la campana), **Mi cuenta** (datos y cambio de contraseña), aviso de versión nueva, sin conexión y sesión caducada.

**Super Admin** (`/super-admin`, solo super admins):

- **Control del Panel**: encender y apagar módulos para el equipo.
- **Usuarios**: altas, permisos por sección («Ver» / «Editar»), roles preconfigurados, contraseñas, bloquear accesos y super admins.
- **Auditoría**: todo lo que se hace en el panel (quién, qué, cuándo, desde dónde), por día o por mes, y revertir cambios.
- **Informes**: informe mensual de costes y de auditoría (PDF y CSV).
- **Tickets**: las peticiones del equipo, analizadas por la IA (y envío a Linear).
- **Gestor Gasto**: recibos de OficiosOsIA, tarifas y Excel de control.
- **Servicios**: servicios contratados, su consumo y sus costes (incluido el gasto de IA), modelos de IA y avisos por Telegram.

## Marca

Sigue el manual de identidad corporativa v1.0 (noviembre 2026):

- **Logotipo** original (sacado en vectorial del manual, sin redibujar) en `public/marca/`: horizontal en positivo y negativo y la cúpula sola. Se pone con `<Logotipo variante="…" />` (`src/components/marca/Logotipo.tsx`).
- **Colores**: azul marino `#062C4C`, crema `#F6E9C6`, azul claro `#8FC4E4` y los neutros (marfil, niebla, acero, tinta), como variables en `src/index.css` y como `marca-*` en Tailwind. Crema y azul claro, solo de fondo con texto marino encima.
- **Tipografías**: Lexend para titulares e Inter para textos, autoalojadas (`@fontsource-variable`, funcionan sin conexión).
- **Elementos gráficos**: el óculo, el reflejo y los gajos (`src/components/marca/ElementosMarca.tsx`).
- Iconos de la app (`public/icon-*.png`, `apple-touch-icon.png`, `favicon.ico`): la cúpula en crema sobre marino.

Nombre, lema y rutas del logotipo: `src/config/negocio.ts`.

## Tecnología

Vite + React + TypeScript + Tailwind/shadcn en el frontend; Supabase (Postgres con RLS, Auth, Storage, Edge Functions en Deno y pg_cron) en el backend; despliegue en Vercel.

## Puesta en marcha

1. Supabase y Vercel: sigue [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) (migración inicial, secretos, Vault, primer super admin).
2. En local:

```sh
cp .env.example .env   # rellena la URL y la clave pública de Supabase
npm ci
npm run dev            # http://localhost:8080
```

## Pruebas

```sh
npm test                    # tests unitarios y de componentes (Vitest)
npm run test:nucleo:db      # esquema de BD, RLS y vuelta atrás en Postgres en memoria (PGlite)
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

## Cómo se trabaja

Ramas, demo, releases y producción: [docs/PROCESO-DE-CAMBIOS.md](docs/PROCESO-DE-CAMBIOS.md). El nombre del negocio y su marca viven en `src/config/negocio.ts`.
