# Changelog

Publicaciones en producción de admin-cristaleriabv. Cada entrada la escribe `scripts/release.mjs` al preparar la release y recoge solo los cambios incluidos en ella. La numeración empieza en 1.0.0.

## [1.2.1] - 2026-11-24

Objetivo: Arreglar el despliegue automático de Supabase (CLI 3.x) para subir las migraciones y funciones de la v1.2.0

### Cambiado
- Ci: despliegue de Supabase con la CLI 3.x ([#5](https://github.com/oficiososia/admin-cristaleriabv/pull/5))

## [1.2.0] - 2026-11-23

Objetivo: Facturas con OCR, web editable desde el panel (fotos, tarifas y contenido) y gestor de presupuestos

### Añadido
- Facturas: módulo Facturas con OCR + despliegue automático de Supabase ([#2](https://github.com/oficiososia/admin-cristaleriabv/pull/2))
- Web: web editable desde el panel (Fotos, Tarifas, Contenido) y gestor de Presupuestos ([#3](https://github.com/oficiososia/admin-cristaleriabv/pull/3))

## [1.0.0] - 2026-11-18

Objetivo: Primera versión del panel de administración de Cristalería Baix Vinalopó

### Añadido
- Panel de administración y Super Admin heredados del núcleo de admin-casatomas (el panel de referencia de OficiosOsIA), sin nada de restaurante
- Login, usuarios y permisos por sección, con roles preconfigurados, contraseñas y bloqueo de accesos
- Peticiones y tickets del equipo, con análisis por IA y envío a Linear
- Avisos en la campana y por Telegram
- Ayuda con guías paso a paso y recorridos guiados
- Auditoría de todo lo que se hace en el panel, con vuelta atrás de cambios
- Informes mensuales de costes y de auditoría (PDF y CSV)
- Servicios y costes: servicios contratados, su consumo, el gasto de IA y los modelos de IA
- Control del Panel: encender y apagar módulos para el equipo
- Base de datos consolidada en una sola migración (`20261118120000_nucleo_panel.sql`, con su vuelta atrás)
- Marca de Cristalería Baix Vinalopó: logotipo, colores y tipografías Lexend e Inter
