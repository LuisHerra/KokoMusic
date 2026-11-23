-- Índices para que la sección de Amigos cargue rápido. Las consultas filtran
-- por estos ids; sin índice Postgres recorre la tabla entera en cada carga.

-- Amistades: "mis amigos" busca por requester_id O addressee_id + status
create index if not exists friendships_requester_idx on kokomusic.friendships (requester_id, status);
create index if not exists friendships_addressee_idx on kokomusic.friendships (addressee_id, status);

-- Mensajes: conversación entre dos usuarios y contador de no leídos
create index if not exists messages_pair_idx on kokomusic.messages (sender_id, receiver_id, created_at desc);
create index if not exists messages_unread_idx on kokomusic.messages (receiver_id, sender_id) where not is_read;

-- B-Music: el del día de cada usuario y sus comentarios
create index if not exists daily_drops_user_date_idx on kokomusic.koko_daily_drops (user_id, drop_date desc);
create index if not exists daily_drops_date_idx on kokomusic.koko_daily_drops (drop_date);
create index if not exists daily_drop_comments_drop_idx on kokomusic.koko_daily_drop_comments (drop_id);

-- Avisos de la campana (se consultan cada 10 s)
create index if not exists notifications_user_created_idx on kokomusic.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on kokomusic.notifications (user_id) where not is_read;

-- Escuchas por usuario (emblemas, estadísticas)
create index if not exists play_events_user_idx on kokomusic.play_events (user_id);
