/** Novedades de la app (datos en lib/changelog.ts). */
import { useEffect } from 'react';
import { CHANGELOG, markChangelogSeen, type ChangeKind } from '../lib/changelog';

const KIND_LABEL: Record<ChangeKind, string> = { nuevo: 'Nuevo', mejora: 'Mejora', arreglo: 'Arreglo' };
const ORDER: ChangeKind[] = ['nuevo', 'mejora', 'arreglo'];

const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

export default function Changelog() {
  useEffect(() => { markChangelogSeen(); }, []);

  return (
    <div className="changelog-page">
      <h1 className="changelog-h1">Novedades</h1>
      <p className="changelog-sub">Lo último que hemos añadido y arreglado. La app se actualiza sola, no tienes que hacer nada.</p>

      <ol className="changelog-list">
        {CHANGELOG.map((entry, i) => (
          <li key={entry.id} className={`changelog-entry ${i === 0 ? 'is-latest' : ''}`}>
            <div className="changelog-date">{fmt(entry.date)}{i === 0 && <span className="changelog-latest">Última versión</span>}</div>
            <h2 className="changelog-title">{entry.title}</h2>
            {ORDER.map((kind) => {
              const items = entry.changes.filter((c) => c.kind === kind);
              if (!items.length) return null;
              return (
                <div key={kind} className="changelog-group">
                  <span className={`changelog-kind kind-${kind}`}>{KIND_LABEL[kind]}</span>
                  <ul>{items.map((c, j) => <li key={j}>{c.text}</li>)}</ul>
                </div>
              );
            })}
          </li>
        ))}
      </ol>
    </div>
  );
}
