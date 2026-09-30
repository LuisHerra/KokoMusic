-- BeMusic: momento de la canción elegido al publicarla (segundos desde el inicio).
-- Ejecutar una vez en el SQL Editor de Supabase (proyecto de KokoMusic).
ALTER TABLE kokomusic.koko_daily_drops
  ADD COLUMN IF NOT EXISTS start_s numeric NOT NULL DEFAULT 0;
