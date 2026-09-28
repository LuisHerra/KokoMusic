-- Sincronización de reproducción entre dispositivos (tipo "Spotify Connect").
-- Ejecutar una vez en el SQL Editor de Supabase (proyecto de KokoMusic).
--
-- Contexto: koko_device_id se usa hoy como identidad de CUENTA (se sobreescribe
-- con el user_id al iniciar sesión), no como identidad de DISPOSITIVO físico —
-- así que no distingue "tu móvil" de "tu ordenador" bajo la misma cuenta. El
-- frontend genera ahora un id de dispositivo aparte (ver useDeviceSync.ts) y
-- cada instalación escribe aquí su estado de reproducción cada pocos segundos;
-- las demás lo leen por polling. Sin Redis ni Supabase Realtime: solo lectura/
-- escritura directa, adecuado dado el techo de usuarios bajo de la app.
--
-- `is_active` marca qué dispositivo "manda" la reproducción de esta cuenta —
-- solo uno a la vez debería estar a true (lo garantiza la capa de aplicación,
-- no una constraint). Cuando un dispositivo pulsa "reproducir aquí", el
-- backend pone is_active=false en el resto; en el siguiente sondeo, el
-- dispositivo que lo tenía se pausa solo al ver que ya no es el activo.

CREATE TABLE IF NOT EXISTS kokomusic.playback_state (
  user_id      text NOT NULL,
  device_id    text NOT NULL,
  device_name  text,
  track_id     text,
  title        text,
  artist       text,
  cover        text,
  position_s   numeric NOT NULL DEFAULT 0,
  duration_s   numeric NOT NULL DEFAULT 0,
  is_playing   boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS playback_state_user_id_idx ON kokomusic.playback_state (user_id);

ALTER TABLE kokomusic.playback_state ENABLE ROW LEVEL SECURITY;
GRANT ALL ON kokomusic.playback_state TO service_role;
