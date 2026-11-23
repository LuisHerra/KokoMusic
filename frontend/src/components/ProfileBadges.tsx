/**
 * Insignias del perfil como pines esmaltados: los de artista llevan su foto
 * (o la portada que más has escuchado suya) con borde metálico según el nivel;
 * los logros, su emblema grabado. GET /api/social/badges/:userId
 */
import { useQuery } from '@tanstack/react-query';
import { getProfileBadges, type ProfileBadge } from '../lib/api';
import { BadgeIcon } from './SocialIcons';

const TIER_LABEL = { bronze: 'Bronce', silver: 'Plata', gold: 'Oro' } as const;
const big = (u?: string | null) => (u ? u.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/, '/300x300bb.$2') : '');

function Pin({ b, i }: { b: ProfileBadge; i: number }) {
  const isArtist = b.kind === 'artist' || b.id.startsWith('artist:');
  return (
    <figure className={`pin tier-${b.tier}`} style={{ ['--tilt' as any]: `${((i * 37) % 13) - 6}deg` }} title={`${b.description} · ${TIER_LABEL[b.tier]}`}>
      <div className="pin-disc">
        {isArtist && b.image ? (
          <img src={big(b.image)} alt="" loading="lazy" />
        ) : (
          <span className="pin-emblem"><BadgeIcon name={b.icon} size={30} /></span>
        )}
        <span className="pin-shine" />
        <span className="pin-tier">{TIER_LABEL[b.tier]}</span>
      </div>
      <figcaption>
        <strong>{isArtist ? b.artist ?? b.label : b.label}</strong>
        <small>{isArtist ? b.label : b.description}</small>
      </figcaption>
    </figure>
  );
}

export default function ProfileBadges({ userId }: { userId: string }) {
  const { data } = useQuery({
    queryKey: ['profile-badges', userId],
    queryFn: () => getProfileBadges(userId),
    enabled: !!userId,
    staleTime: 10 * 60 * 1000,
  });
  const badges = data?.badges ?? [];
  if (!badges.length) return null;
  return (
    <div className="pin-board" aria-label="Insignias">
      {badges.map((b, i) => <Pin key={b.id} b={b} i={i} />)}
    </div>
  );
}
