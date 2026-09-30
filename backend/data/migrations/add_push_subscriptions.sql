-- Suscripciones Web Push (notificaciones con la app cerrada).
-- Ejecutar una vez en el SQL Editor de Supabase (proyecto de KokoMusic).
-- Un usuario puede tener varias (móvil, ordenador...). `endpoint` es único por navegador/dispositivo.

CREATE TABLE IF NOT EXISTS kokomusic.push_subscriptions (
  endpoint    text PRIMARY KEY,
  user_id     text NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON kokomusic.push_subscriptions (user_id);
