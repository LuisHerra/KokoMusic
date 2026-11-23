-- Registro de "Me gusta" (solo inserciones). Ver healLikedSongs en
-- backend/src/routes/playlists.ts: al cargar las playlists de un usuario se
-- reponen los likes cuyo último evento es 'like' y faltan en "Tus me gusta".
create table if not exists kokomusic.user_like_events (
  id          bigserial primary key,
  user_id     text        not null,
  track_id    text        not null,
  action      text        not null check (action in ('like', 'unlike')),
  created_at  timestamptz not null default now()
);

create index if not exists user_like_events_user_idx
  on kokomusic.user_like_events (user_id, created_at);

alter table kokomusic.user_like_events enable row level security;
-- Sin políticas: solo el backend (service_role) lee y escribe.

-- Punto de partida: los likes que hay ahora mismo cuentan como vigentes.
insert into kokomusic.user_like_events (user_id, track_id, action, created_at)
select p.user_id, t->>'trackId', 'like', coalesce((t->>'addedAt')::timestamptz, now())
from kokomusic.user_playlists p,
     jsonb_array_elements(p.data->'tracks') as t
where p.key like 'liked-songs-%'
  and not exists (select 1 from kokomusic.user_like_events e where e.user_id = p.user_id);
