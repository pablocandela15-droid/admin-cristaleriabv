-- Vuelta atrás de 20261125110000_quitar_extension_http.sql: vuelve a instalar la extensión http.
create extension if not exists http with schema extensions;
