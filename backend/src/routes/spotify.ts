import { Router, Request, Response } from 'express';
import { playlists } from './playlists';
import { searchTracks } from '../services/spotifyService';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../services/supabaseService';
import { seedInitialProfile } from '../services/tasteProfileBuilder';

const router = Router();

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:3001/api/spotify/callback';
const FRONTEND_URI = process.env.FRONTEND_URI || 'http://localhost:5173';

// GET /api/spotify/status
// Verifica si Spotify OAuth está configurado en el servidor
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    configured: Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET),
    redirectUri: REDIRECT_URI,
  });
});

// GET /api/spotify/login
// Inicia el flujo OAuth redirigiendo a Spotify (admite popup o redirección directa)
router.get('/login', (req: Request, res: Response) => {
  const mode = req.query.mode === 'redirect' ? 'redirect' : 'popup';
  const origin = (req.query.origin as string) || 'profile';

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    // Si no está configurado, mostramos una pantalla estilizada y amigable
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Spotify OAuth no configurado</title>
        <style>
          body {
            background: #121212;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
          }
          .card {
            background: #181818;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 20px;
            padding: 32px;
            max-width: 460px;
            width: 100%;
            text-align: center;
            box-shadow: 0 16px 40px rgba(0,0,0,0.6);
          }
          .icon {
            width: 52px;
            height: 52px;
            color: #1DB954;
            margin-bottom: 16px;
          }
          h2 { margin: 0 0 10px; font-size: 20px; font-weight: 700; }
          p { font-size: 13px; color: #a1a1aa; line-height: 1.5; margin: 0 0 18px; }
          .guide {
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 14px;
            text-align: left;
            font-size: 12px;
            margin-bottom: 22px;
            color: #e4e4e7;
          }
          .guide code {
            color: #1DB954;
            font-family: monospace;
          }
          button {
            background: #1DB954;
            color: #000;
            font-weight: 700;
            font-size: 13px;
            border: none;
            border-radius: 24px;
            padding: 12px 28px;
            cursor: pointer;
            transition: transform 0.15s, opacity 0.15s;
          }
          button:hover {
            opacity: 0.9;
            transform: scale(1.02);
          }
        </style>
      </head>
      <body>
        <div class="card">
          <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.5 17.3a.75.75 0 01-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 01-.34-1.46c4.58-1.04 8.52-.6 11.67 1.33.35.21.46.68.25 1.04zm1.47-3.26a.94.94 0 01-1.29.31c-3.23-1.99-8.15-2.56-11.97-1.4a.94.94 0 01-.55-1.8c4.37-1.33 9.8-.69 13.5 1.59.4.25.53.78.31 1.3zm.13-3.39c-3.87-2.3-10.26-2.51-13.97-1.38a1.13 1.13 0 01-.66-2.16c4.27-1.3 11.33-1.04 15.8 1.61a1.13 1.13 0 01-1.17 1.93z"/>
          </svg>
          <h2>Spotify OAuth Pendiente</h2>
          <p>Para activar el login y la sincronización automática de gustos con Spotify, añade tus credenciales en <code>backend/.env</code>:</p>
          <div class="guide">
            1. Entra en <code>developer.spotify.com/dashboard</code><br>
            2. Agrega Redirect URI: <code>${REDIRECT_URI}</code><br>
            3. Coloca <code>SPOTIFY_CLIENT_ID</code> y <code>SPOTIFY_CLIENT_SECRET</code> en el archivo <code>.env</code>
          </div>
          <button onclick="window.close()">Volver a KokoMusic</button>
        </div>
      </body>
      </html>
    `);
  }

  const scope = [
    'user-read-private',
    'user-read-email',
    'user-top-read',
    'user-read-recently-played',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-library-read',
  ].join(' ');

  const statePayload = JSON.stringify({ mode, origin, nonce: Math.random().toString(36).substring(7) });
  const state = Buffer.from(statePayload).toString('base64url');

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('client_id', SPOTIFY_CLIENT_ID);
  authUrl.searchParams.append('scope', scope);
  authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.append('state', state);

  res.redirect(authUrl.toString());
});

// GET /api/spotify/callback
// Spotify redirige aquí con un code tras autorizar
router.get('/callback', async (req: Request, res: Response) => {
  const code = (req.query.code as string) || null;
  const state = (req.query.state as string) || null;
  const error = (req.query.error as string) || null;

  let mode = 'popup';
  let origin = 'profile';

  if (state) {
    try {
      const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
      if (parsed.mode) mode = parsed.mode;
      if (parsed.origin) origin = parsed.origin;
    } catch {
      // Ignorar error de parsing de state
    }
  }

  const sendResponse = (success: boolean, data: any) => {
    if (mode === 'popup') {
      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <title>${success ? 'Spotify Conectado' : 'Error en Conexión'}</title>
          <style>
            body {
              background: #121212;
              color: #fff;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              text-align: center;
            }
            .spinner {
              width: 36px;
              height: 36px;
              border: 3px solid rgba(255,255,255,0.1);
              border-top-color: #1DB954;
              border-radius: 50%;
              animation: spin 0.8s linear infinite;
              margin: 0 auto 16px;
            }
            @keyframes spin { to { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div>
            ${success ? '<div class="spinner"></div>' : ''}
            <h3 style="margin: 0 0 6px;">${success ? '¡Conexión exitosa con Spotify!' : 'No se pudo conectar'}</h3>
            <p style="color: #888; font-size: 13px; margin: 0;">${success ? 'Configurando tus gustos musicales...' : (data.error || 'Error de autorización')}</p>
          </div>
          <script>
            const message = ${JSON.stringify({ type: success ? 'SPOTIFY_AUTH_SUCCESS' : 'SPOTIFY_AUTH_ERROR', ...data })};
            if (window.opener) {
              window.opener.postMessage(message, "*");
              setTimeout(() => window.close(), 350);
            } else {
              localStorage.setItem('koko_spotify_auth_result', JSON.stringify(message));
              window.location.href = "${FRONTEND_URI}/${origin}?spotify_done=1";
            }
          </script>
        </body>
        </html>
      `);
    } else {
      if (success) {
        return res.redirect(`${FRONTEND_URI}/${origin}?spotify_token=${encodeURIComponent(data.accessToken || '')}&spotify_user=${encodeURIComponent(data.user?.id || '')}`);
      } else {
        return res.redirect(`${FRONTEND_URI}/${origin}?error=${encodeURIComponent(data.error || 'spotify_error')}`);
      }
    }
  };

  if (error || !code) {
    return sendResponse(false, { error: error || 'no_code_provided' });
  }

  try {
    const authOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64'),
      },
      body: new URLSearchParams({
        code: code,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    };

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', authOptions);
    const tokenData = (await tokenRes.json()) as any;

    if (tokenData.error) {
      console.error('[Spotify OAuth] Error al canjear token:', tokenData);
      return sendResponse(false, { error: tokenData.error_description || tokenData.error });
    }

    const { access_token, refresh_token, expires_in } = tokenData;

    // 1. Obtener perfil de Spotify (/v1/me)
    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const meData = (await meRes.json()) as any;

    // 2. Obtener top artistas de Spotify (/v1/me/top/artists)
    let topArtists: Array<{ name: string; genres: string[]; image?: string }> = [];
    let topGenres: string[] = [];
    try {
      const topArtistsRes = await fetch('https://api.spotify.com/v1/me/top/artists?limit=25&time_range=medium_term', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const topArtistsData = (await topArtistsRes.json()) as any;
      if (Array.isArray(topArtistsData.items)) {
        topArtists = topArtistsData.items.map((a: any) => ({
          name: a.name,
          genres: a.genres || [],
          image: a.images?.[0]?.url,
        }));

        const genreCounts: Record<string, number> = {};
        topArtists.forEach((a) => {
          a.genres.forEach((g) => {
            genreCounts[g] = (genreCounts[g] || 0) + 1;
          });
        });
        topGenres = Object.entries(genreCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([g]) => g);
      }
    } catch (err) {
      console.warn('[Spotify OAuth] Advertencia al obtener top artistas:', err);
    }

    // 3. Obtener top tracks de Spotify (/v1/me/top/tracks)
    let topTracks: Array<{ title: string; artist: string; cover?: string }> = [];
    try {
      const topTracksRes = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=25&time_range=medium_term', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const topTracksData = (await topTracksRes.json()) as any;
      if (Array.isArray(topTracksData.items)) {
        topTracks = topTracksData.items.map((t: any) => ({
          title: t.name,
          artist: t.artists?.[0]?.name || '',
          cover: t.album?.images?.[0]?.url,
        }));
      }
    } catch (err) {
      console.warn('[Spotify OAuth] Advertencia al obtener top tracks:', err);
    }

    // 4. Enlazar o crear usuario en Supabase / Local
    let userId = uuidv4();
    let profile: any = {
      id: userId,
      display_name: meData.display_name || meData.id || 'Usuario Spotify',
      username: (meData.id || 'spotify_user').toLowerCase().replace(/[^a-z0-9_]/g, ''),
      avatar_url: meData.images?.[0]?.url || null,
      bio: 'Melómano en KokoMusic • Conectado con Spotify',
      is_public: true,
    };

    if (supabase) {
      try {
        const { data: existingUser } = await supabase
          .schema('kokomusic')
          .from('koko_profiles')
          .select('*')
          .ilike('username', profile.username)
          .maybeSingle();

        if (existingUser) {
          userId = existingUser.id;
          const updates: any = {};
          if (!existingUser.avatar_url && profile.avatar_url) updates.avatar_url = profile.avatar_url;
          if (Object.keys(updates).length > 0) {
            await supabase.schema('kokomusic').from('koko_profiles').update(updates).eq('id', userId);
          }
          profile = { ...existingUser, ...updates };
        } else {
          const { data: newProfile } = await supabase
            .schema('kokomusic')
            .from('koko_profiles')
            .insert({
              id: userId,
              display_name: profile.display_name,
              username: profile.username,
              avatar_url: profile.avatar_url,
              bio: profile.bio,
              is_public: true,
            })
            .select()
            .single();

          if (newProfile) profile = newProfile;
        }

        // Sembrar perfil de gustos instantáneamente (Zero Cold-Start)
        if (topArtists.length > 0 || topGenres.length > 0) {
          await seedInitialProfile(
            userId,
            topGenres,
            topArtists.map((a) => a.name)
          );
        }
      } catch (dbErr) {
        console.warn('[Spotify OAuth] No se pudo persistir en Supabase, usando perfil local:', dbErr);
      }
    }

    sendResponse(true, {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      userId,
      profile,
      topArtists: topArtists.map((a) => a.name),
      topArtistsDetails: topArtists,
      topGenres,
      topTracks,
    });
  } catch (err: any) {
    console.error('[Spotify OAuth] Excepción en callback:', err);
    sendResponse(false, { error: err.message || 'internal_server_error' });
  }
});

// POST /api/spotify/sync-taste
// Permite sincronizar o refrescar gustos usando un access_token activo
router.post('/sync-taste', async (req: Request, res: Response) => {
  const { accessToken, userId } = req.body;
  if (!accessToken) {
    return res.status(400).json({ error: 'accessToken es requerido' });
  }

  try {
    const topArtistsRes = await fetch('https://api.spotify.com/v1/me/top/artists?limit=25&time_range=medium_term', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const topArtistsData = (await topArtistsRes.json()) as any;

    const topArtists = Array.isArray(topArtistsData.items)
      ? topArtistsData.items.map((a: any) => ({
          name: a.name,
          genres: a.genres || [],
          image: a.images?.[0]?.url,
        }))
      : [];

    const genreCounts: Record<string, number> = {};
    topArtists.forEach((a: any) => {
      a.genres.forEach((g: string) => {
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      });
    });
    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([g]) => g);

    const artistNames = topArtists.map((a: any) => a.name);

    if (userId && (artistNames.length > 0 || topGenres.length > 0)) {
      await seedInitialProfile(userId, topGenres, artistNames);
    }

    res.json({
      success: true,
      topArtists: artistNames,
      topGenres,
      count: artistNames.length,
    });
  } catch (err: any) {
    console.error('[Spotify SyncTaste] Error:', err);
    res.status(500).json({ error: err.message || 'Error al sincronizar gustos' });
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
