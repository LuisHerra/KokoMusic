/** Emblemas del perfil: artistas muy escuchados y logros (GET /api/social/badges/:userId). */
import { useQuery } from '@tanstack/react-query';
import { getProfileBadges } from '../lib/api';
import { BadgeIcon } from './SocialIcons';

const TIER_LABEL = { bronze: 'Bronce', silver: 'Plata', gold: 'Oro' } as const;

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
    <div className="profile-badges" aria-label="Emblemas">
      {badges.map((b) => (
        <span key={b.id} className={`profile-badge tier-${b.tier}`} title={`${b.description} · ${TIER_LABEL[b.tier]}`}>
          <span className="profile-badge-icon"><BadgeIcon name={b.icon} /></span>{b.label}
        </span>
      ))}
    </div>
  );
}
