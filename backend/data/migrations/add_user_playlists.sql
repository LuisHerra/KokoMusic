-- Persistencia de las playlists personales (incluida "Tus me gusta").
-- Antes vivían solo en memoria del servidor y se perdían en cada reinicio de Render.
-- Ejecutar una vez en el SQL Editor de Supabase.
--
-- key: id de la playlist (uuid) o 'liked-songs-<userId>' para los me gusta.
-- data: la playlist completa tal como la devuelve la API (nombre, portada, tracks...).

CREATE TABLE IF NOT EXISTS kokomusic.user_playlists (
  key text PRIMARY KEY,
  user_id text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_playlists_user_id_idx ON kokomusic.user_playlists (user_id);

-- Solo el backend (service_role, que ignora RLS) accede a esta tabla.
ALTER TABLE kokomusic.user_playlists ENABLE ROW LEVEL SECURITY;
GRANT ALL ON kokomusic.user_playlists TO service_role;
