-- Control remoto entre dispositivos (tipo Spotify Connect) sobre playback_state.
-- Ejecutar una vez en el SQL Editor de Supabase (proyecto de KokoMusic),
-- DESPUÉS de add_playback_state.sql.
--
-- Contexto: conectarse a otro dispositivo debe compartir UNA sola sesión de
-- reproducción — el dispositivo conectado ("mando") refleja canción, cola y
-- progreso del principal, y todo lo que se pulse en él (play/pausa, saltar,
-- elegir otra canción...) se ejecuta en el principal, que es el único que
-- suena. Sin Redis ni Realtime: el mando escribe un comando en la fila del
-- principal y este lo recoge en su siguiente sondeo (~2 s).
--
-- - track / queue / queue_index: estado completo que el principal publica para
--   que el mando pueda pintar su reproductor igual.
-- - controlling_device_id: en la fila del MANDO, a qué dispositivo controla.
-- - command / command_id / command_at: en la fila del PRINCIPAL, último
--   comando recibido. command_id evita aplicarlo dos veces; command_at permite
--   descartar comandos viejos al volver a abrir la app.

ALTER TABLE kokomusic.playback_state
  ADD COLUMN IF NOT EXISTS track jsonb,
  ADD COLUMN IF NOT EXISTS queue jsonb,
  ADD COLUMN IF NOT EXISTS queue_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS controlling_device_id text,
  ADD COLUMN IF NOT EXISTS command jsonb,
  ADD COLUMN IF NOT EXISTS command_id text,
  ADD COLUMN IF NOT EXISTS command_at timestamptz;
