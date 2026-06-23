import fs from 'fs';
import path from 'path';

export interface CustomTrack {
  id: string;          // "custom_" + uuid
  title: string;       // nombre libre del usuario
  artist: string;
  album: string;
  cover: string;       // URL de portada subida o seleccionada
  audioPath?: string;   // ruta local al archivo subido
  audioUrl?: string;    // URL pública si se subió a Supabase/CDN
  sourceType: 'upload' | 'youtube_alias';
  youtubeId?: string;  // solo si sourceType = 'youtube_alias'
  originalTrackId?: string; // referencia al track base si es alias
  duration: number;    // ms
  isPublic?: boolean;
  createdAt: string;
}

const DATA_DIR = path.resolve('data');
const UPLOADS_DIR = path.resolve('data/uploads');
const FILE_PATH = path.join(DATA_DIR, 'custom_tracks.json');

// Asegurar que las carpetas existen
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export function getCustomTracks(): CustomTrack[] {
  try {
    if (!fs.existsSync(FILE_PATH)) {
      return [];
    }
    const content = fs.readFileSync(FILE_PATH, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('[customTracksService] Error leyendo custom_tracks.json:', error);
    return [];
  }
}

export function saveCustomTracks(tracks: CustomTrack[]): void {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(tracks, null, 2), 'utf8');
  } catch (error) {
    console.error('[customTracksService] Error guardando custom_tracks.json:', error);
  }
}

export function getCustomTrackById(id: string): CustomTrack | null {
  const tracks = getCustomTracks();
  return tracks.find(t => t.id === id) || null;
}

export function addCustomTrack(track: CustomTrack): void {
  const tracks = getCustomTracks();
  tracks.push(track);
  saveCustomTracks(tracks);
}

export function deleteCustomTrack(id: string): boolean {
  const tracks = getCustomTracks();
  const index = tracks.findIndex(t => t.id === id);
  if (index === -1) return false;

  const track = tracks[index];
  
  // Si tiene un archivo de audio local, eliminarlo
  if (track.audioPath && fs.existsSync(track.audioPath)) {
    try {
      fs.unlinkSync(track.audioPath);
    } catch (e) {
      console.error('[customTracksService] Error eliminando archivo de audio:', e);
    }
  }

  // Si la portada es local (comienza con /uploads/), eliminarla
  if (track.cover && track.cover.startsWith('/uploads/')) {
    const filename = path.basename(track.cover);
    const coverPath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(coverPath)) {
      try {
        fs.unlinkSync(coverPath);
      } catch (e) {
        console.error('[customTracksService] Error eliminando archivo de portada:', e);
      }
    }
  }

  tracks.splice(index, 1);
  saveCustomTracks(tracks);
  return true;
}
