-- Añade identidad de artista a los perfiles de Koko.
-- Ejecutar una vez en el SQL Editor de Supabase (proyecto de KokoMusic).
--
-- Contexto: hasta ahora artist_id siempre venía de iTunes o de un hash del
-- nombre de canal de YouTube — nunca estaba ligado a una cuenta real. Esto
-- permite que un usuario se declare artista y reciba un artist_id propio,
-- estable, para subir canciones que aparezcan en el catálogo/recomendaciones
-- como cualquier otro artista.

ALTER TABLE kokomusic.koko_profiles
  ADD COLUMN IF NOT EXISTS is_artist boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS artist_id bigint;
