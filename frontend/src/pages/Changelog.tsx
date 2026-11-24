/** Novedades de la app (datos en lib/changelog.ts). */
import { useEffect } from 'react';
import { CHANGELOG, markChangelogSeen, type ChangeKind } from '../lib/changelog';
import { ANDROID_APK_URL, canOfferAndroidApp, isInsideAndroidApp } from '../lib/androidApp';

const KIND_LABEL: Record<ChangeKind, string> = { nuevo: 'Nuevo', mejora: 'Mejora', arreglo: 'Arreglo' };
const ORDER: ChangeKind[] = ['nuevo', 'mejora', 'arreglo'];

const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

export default function Changelog() {
  useEffect(() => { markChangelogSeen(); }, []);
  const inApp = isInsideAndroidApp();
  // Desde la web (no iPhone) para instalarla; dentro de la APK para actualizarla
  const showApkButton = inApp || canOfferAndroidApp();

  return (
    <div className="changelog-page">
      <h1 className="changelog-h1">Novedades</h1>
      <p className="changelog-sub">Lo último que hemos añadido y arreglado. La web se actualiza sola; la app de Android hay que descargarla de nuevo para tener lo último.</p>

      {showApkButton && (
        <div className="changelog-apk">
          <div style={{ minWidth: 0 }}>
            <strong>{inApp ? 'Actualiza la app de Android' : 'App de Android'}</strong>
            <p>{inApp
              ? 'Algunas novedades (vídeos, atajo de voz) necesitan la última versión. Descárgala e instálala encima de la actual.'
              : 'Reproductor propio sin Chrome, menos batería, avisos de amigos y vídeos guardados en el móvil.'}</p>
          </div>
          <a className="android-app-btn" href={ANDROID_APK_URL} rel="noopener">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="5" y="2" width="14" height="20" rx="2" /><path d="M12 7v7M9 11l3 3 3-3M10 18h4" />
            </svg>
            {inApp ? 'Descargar última versión' : 'Descargar APK'}
          </a>
        </div>
      )}

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
