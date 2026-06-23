import { Router, Request, Response } from 'express';
import { playlists } from './playlists';
import { searchTracks } from '../services/spotifyService';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// En desarrollo usamos el puerto del frontend para redireccionar, pero el callback debe venir al backend.
// Asumiendo backend en 3001 y frontend en 5173
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:3001/api/spotify/callback';
const FRONTEND_URI = process.env.FRONTEND_URI || 'http://localhost:5173';

// GET /api/spotify/login
// Inicia el flujo OAuth redirigiendo a Spotify
router.get('/login', (req: Request, res: Response) => {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Faltan credenciales de Spotify en el servidor (.env)' });
  }

  const scope = 'playlist-read-private playlist-read-collaborative user-library-read';
  const state = Math.random().toString(36).substring(7); // simple state

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('client_id', SPOTIFY_CLIENT_ID);
  authUrl.searchParams.append('scope', scope);
  authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.append('state', state);

  res.redirect(authUrl.toString());
});

// GET /api/spotify/callback
// Spotify redirige aquí con un code tras aceptar
router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string || null;
  const state = req.query.state as string || null;
  const error = req.query.error as string || null;

  if (error) {
    return res.redirect(`${FRONTEND_URI}/library?error=spotify_access_denied`);
  }

  if (!code) {
    return res.redirect(`${FRONTEND_URI}/library?error=no_code_provided`);
  }

  const authOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
    },
    body: new URLSearchParams({
      code: code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  };

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
    const data = (await response.json()) as any;

    if (data.error) {
      console.error('[Spotify OAuth] Error de Spotify:', data);
      return res.redirect(`${FRONTEND_URI}/library?error=token_exchange_failed`);
    }

    const { access_token, refresh_token, expires_in } = data;

    // Pasamos el token al frontend usando el hash o query params.
    // Usamos params seguros o hash para que no quede en los logs del servidor del frontend (aunque sea local).
    const redirectUrl = new URL(`${FRONTEND_URI}/library`);
    redirectUrl.searchParams.append('spotify_access_token', access_token);
    if (refresh_token) {
      redirectUrl.searchParams.append('spotify_refresh_token', refresh_token);
    }
    
    res.redirect(redirectUrl.toString());

  } catch (err) {
    console.error('[Spotify OAuth] Excepción en callback:', err);
    res.redirect(`${FRONTEND_URI}/library?error=internal_server_error`);
  }
});

// POST /api/spotify/refresh_token
// Intercambia el refresh token por un nuevo access token
router.post('/refresh_token', async (req: Request, res: Response) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ error: 'No refresh token provided' });
  }

  const authOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh_token
    })
  };

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
    const data = (await response.json()) as any;
    
    if (data.error) {
      return res.status(400).json({ error: data.error });
    }
    
    res.json({
      access_token: data.access_token,
      expires_in: data.expires_in
    });
  } catch (error) {
    console.error('[Spotify Refresh] Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/spotify/playlists
// Lista las playlists públicas/privadas del usuario en Spotify
router.get('/playlists', async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const response = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = (await response.json()) as any;
    if (data.error) return res.status(400).json(data);
    res.json(data.items);
  } catch (error) {
    console.error('[Spotify] Error fetching playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// POST /api/spotify/import
// Importa una playlist de Spotify a la base de datos local
router.post('/import', async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(' ')[1];
  const { playlistId } = req.body;
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    // 1. Obtener detalles de la playlist
    const plRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const plData = (await plRes.json()) as any;
    if (plData.error) return res.status(400).json(plData);

    // 2. Crear la playlist local
    const userId = (req.headers['x-user-id'] || 'default') as string;
    const localPlId = uuidv4();
    const localPl = {
      id: localPlId,
      userId,
      name: plData.name,
      description: plData.description || 'Importada desde Spotify',
      cover: plData.images?.[0]?.url || '',
      tracks: [] as any[],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    playlists.set(localPlId, localPl);

    // 3. Devolvemos respuesta rápida y procesamos en background
    res.json({ success: true, playlistId: localPlId, message: 'Importando en segundo plano...' });

    // 4. Background import
    const items = plData.tracks?.items || [];
    let position = 0;
    
    for (const item of items) {
      if (!item.track) continue;
      
      const trackName = item.track.name;
      const artistName = item.track.artists?.[0]?.name || '';
      
      try {
        const query = `${trackName} ${artistName}`;
        const results = await searchTracks(query, 1);
        
        if (results.length > 0) {
          localPl.tracks.push({
            trackId: results[0].id,
            position,
            addedAt: new Date().toISOString()
          });
          localPl.updatedAt = new Date().toISOString();
          position++;
        }
      } catch (err) {
        console.error(`[Spotify Import] Error buscando ${trackName}:`, err);
      }
      
      // Pequeña pausa para no saturar YouTube (yt-search)
      await new Promise(r => setTimeout(r, 200));
    }
    
    console.log(`[Spotify Import] Completado: ${plData.name} (${position} canciones importadas)`);

  } catch (error) {
    console.error('[Spotify Import] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

export default router;
