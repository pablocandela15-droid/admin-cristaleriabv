-- ============================================================================
-- Quitar la extensión http
-- ----------------------------------------------------------------------------
-- Se instaló a mano y de forma temporal durante la puesta en marcha del
-- proyecto. El panel no la usa: las llamadas salientes de la base de datos
-- (tareas programadas → Edge Functions) van por pg_net. Se quita para no dejar
-- funciones de red innecesarias en la base de datos.
-- Vuelta atrás: supabase/rollbacks/20261125110000_quitar_extension_http_ROLLBACK.sql
-- ============================================================================
drop extension if exists http;
