-- Lista de emails autorizados a registrarse en KokoMusic (app privada, sin
-- modo invitado). Ejecutar una vez en el SQL Editor de Supabase.
--
-- Uso: INSERT INTO kokomusic.access_allowlist (email) VALUES ('persona@ejemplo.com');
-- POST /api/friends/account/create rechaza cualquier registro cuyo email
-- (normalizado a minúsculas) no esté en esta tabla.

CREATE TABLE IF NOT EXISTS kokomusic.access_allowlist (
  email text PRIMARY KEY,
  added_at timestamptz DEFAULT now(),
  note text
);
