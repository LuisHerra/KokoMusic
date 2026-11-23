-- Canción en vivo a un amigo, cápsulas del tiempo (backend/src/routes/social.ts).

-- Datos extra de un aviso (canción enviada, id de cápsula...)
alter table kokomusic.notifications add column if not exists payload jsonb;

-- Recibir canciones en vivo de amigos: activado por defecto
alter table kokomusic.koko_profiles add column if not exists allow_song_drops boolean not null default true;

create table if not exists kokomusic.time_capsules (
  id             uuid primary key default gen_random_uuid(),
  owner_id       text        not null,
  recipient_ids  text[]      not null,
  tracks         jsonb       not null,
  message        text,
  open_at        timestamptz not null,
  delivered      boolean     not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists time_capsules_owner_idx on kokomusic.time_capsules (owner_id);
create index if not exists time_capsules_recipients_idx on kokomusic.time_capsules using gin (recipient_ids);
create index if not exists time_capsules_due_idx on kokomusic.time_capsules (open_at) where not delivered;

alter table kokomusic.time_capsules enable row level security;
-- Sin políticas: solo el backend (service_role) lee y escribe.
