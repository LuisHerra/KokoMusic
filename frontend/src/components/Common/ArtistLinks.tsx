import { Link } from 'react-router-dom';

/**
 * Divide un string de artista en colaboradores individuales, cada uno como su
 * propio enlace navegable — "Jay Wheeler, Omar Courtz" ya no es un único
 * artista sin sentido, son dos enlaces distintos a /artist/Jay%20Wheeler y
 * /artist/Omar%20Courtz. Solo el PRIMER nombre puede usar el `artistId` real
 * (el único que tenemos, viene de iTunes); el resto navega por nombre.
 */
const SPLIT_RE = /\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bx\b)\s*/i;

export function splitArtistNames(artist: string): string[] {
  return artist
    .split(SPLIT_RE)
    .map((n) => n.trim())
    .filter(Boolean);
}

interface ArtistLinksProps {
  artist: string;
  artistId?: number;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  /** Se llama con cada click de enlace — útil para stopPropagation en filas clicables. */
  onLinkClick?: (e: React.MouseEvent) => void;
}

export default function ArtistLinks({ artist, artistId, className, style, title, onLinkClick }: ArtistLinksProps) {
  const names = splitArtistNames(artist);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onLinkClick?.(e);
  };

  if (names.length <= 1) {
    return (
      <Link
        to={artistId && artistId !== 0 ? `/artist/${artistId}` : `/artist/${encodeURIComponent(artist)}`}
        className={className}
        style={{ textDecoration: 'none', ...style }}
        title={title}
        onClick={handleClick}
      >
        {artist}
      </Link>
    );
  }

  return (
    <span className={className} style={style} title={title}>
      {names.map((name, i) => (
        <span key={`${name}-${i}`}>
          <Link
            to={i === 0 && artistId && artistId !== 0 ? `/artist/${artistId}` : `/artist/${encodeURIComponent(name)}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
            onClick={handleClick}
          >
            {name}
          </Link>
          {i < names.length - 1 && ', '}
        </span>
      ))}
    </span>
  );
}
