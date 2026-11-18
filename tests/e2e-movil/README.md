# e2e móvil del panel (desbordes y solapes)

Recorre todas las pantallas del panel en 8 tamaños de móvil/tablet con un **Supabase falso** (`supabase-falso.mjs`): ninguna
petición sale a Supabase ni a Internet, y los datos son sintéticos (`datos-sinteticos.mjs`). No necesita cuenta de pruebas.

No toca la configuración del producto (ni `package.json` ni `vite.config.ts`) y **no entra en `npm test`** (los ficheros se llaman
`*.e2e.mjs` para que Vitest no los recoja). Tampoco está en el CI todavía.

```bash
# 1. Build con una URL de Supabase ficticia (el cliente exige la variable; el mock intercepta *.supabase.co)
VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npm run build

# 2. Navegador de Playwright (una vez)
npx playwright install chromium

# 3. Pruebas (sirve `dist` con `vite preview` en el 4173)
npx playwright test -c tests/e2e-movil/playwright.config.mjs
npx playwright test -c tests/e2e-movil/playwright.config.mjs --project=375x812 -g "Servicios"
```

Variables: `E2E_BASE_URL` (servidor ya levantado), `E2E_SUPABASE_URL` (la que se usó en el build), `E2E_WORKERS` (2 por defecto).

Los defectos conocidos se marcan con `test.fail(...)` (función `conocido`): mientras sigan rotos la prueba pasa en verde; cuando
alguien los arregle, la prueba avisará («expected to fail, but passed») y habrá que quitar la marca. Hoy no hay ninguno marcado.

Otros scripts de esta carpeta (no son pruebas: no entran en `npm test`), con el mismo build y `vite preview`:

- **Barrido visual**: `node tests/e2e-movil/barrido-fase3.mjs <url> <carpeta> [--anchos 375,1366] [--rutas /dashboard,/peticiones]`. Recorre todas las pantallas del panel (también Super Admin) en 320, 375, 430, 768, 1024, 1366 y 1920 px y deja `resultados.json` y capturas en 375, 768 y 1366 px. En cada pantalla mide el desborde horizontal, los elementos fuera de pantalla, las pestañas cortadas, los contadores ocultos, los objetivos táctiles de menos de 24 px, la letra de menos de 12 px y los errores de consola.
- **Servicios** (Estado y Costes): `node tests/e2e-movil/servicios.capturas.mjs [carpeta]`. Móvil (375×812) y escritorio (1280×800) de cada pestaña y la página entera; avisa si algo se desborda.
- **Gestor Gasto** (recibos, pago mensual, vista previa del PDF y Control Excel): `node tests/e2e-movil/gestor-gasto.capturas.mjs [carpeta]`. Sale con código 1 si algo se desborda o si el recibo enseña un dato fiscal.
- **Informes** (lista, informe mensual de auditoría y de costes): `node tests/e2e-movil/informes.capturas.mjs [carpeta]`.

`scripts/capturas-release.mjs` usa el mismo Supabase falso y los mismos datos para las capturas antes/después de una release.
