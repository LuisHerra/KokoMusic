-- Añade letras (con o sin timestamp) y metadatos adicionales a las canciones.
-- Ejecutar una vez en el SQL Editor de Supabase (proyecto de KokoMusic).
--
-- Contexto: los artistas que suben su propia música en el Panel de Artista no
-- podían añadir letras (las letras de la app vienen de lrclib.net, que no
-- conoce canciones autopublicadas) ni describir su canción más allá del
-- género — así que el algoritmo de recomendación solo tenía género y artista
-- como señales. `mood` y `tags` son señales adicionales, libres, que el propio
-- artista rellena y que se usan igual que genreAffinity/languageAffinity en
-- tasteProfileBuilder.ts / candidateGenerator.ts.

ALTER TABLE kokomusic.tracks_meta
  ADD COLUMN IF NOT EXISTS lyrics text,
  ADD COLUMN IF NOT EXISTS lyrics_synced text,
  ADD COLUMN IF NOT EXISTS mood text,
  ADD COLUMN IF NOT EXISTS tags text[];
