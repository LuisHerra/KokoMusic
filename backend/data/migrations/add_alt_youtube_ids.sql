-- Añade almacenamiento de candidatos alternativos de YouTube por track.
-- Ejecutar una vez en el SQL Editor de Supabase (proyecto de KokoMusic).
--
-- Contexto: antes solo se guardaba el video "ganador" para cada canción.
-- Si ese video dejaba de resolver (bloqueado, retirado...), no había plan B
-- guardado y la canción caía directa al fallback de YouTube Embed. Ahora se
-- guardan hasta 3 candidatos de respaldo (ya puntuados por scoreVideo) y
-- stream.ts los prueba en orden antes de rendirse.

ALTER TABLE kokomusic.youtube_resolutions
  ADD COLUMN IF NOT EXISTS alt_youtube_ids text[] DEFAULT '{}';
