
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { getCustomTracks, addCustomTrack, deleteCustomTrack, CustomTrack } from '../services/customTracksService';


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.resolve('data/uploads');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = uuidv4();
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ storage });
import { Router, Request, Response } from 'express';
import { getTrackById } from '../services/metadataService';
import { cache } from '../services/cacheService';
import { audioExists } from '../services/ytdlpService';
import { logTrackPlay, readHistory, saveSessionMinutes, HistoryEntry, getHistoryForUser } from '../services/historyService';
import { setUserRegion } from '../services/regionService';
import { getRecommendations } from '../services/recommendationService';

const router = Router();

// GET /api/tracks/recommendations
router.get('/recommendations', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const userId = (req.headers['x-user-id'] || req.query.userId || '') as string;
    const region = (req.headers['x-user-region'] || req.query.userRegion || '') as string;
    if (userId && region) {
      setUserRegion(userId, region);
    }
    const mood = req.query.mood as string | undefined;
    const seedTrackId = req.query.seedTrackId as string | undefined;
    const recommendations = await getRecommendations(limit, userId, mood, seedTrackId);
    return res.json(recommendations);
  } catch (error) {
    console.error('[Tracks] Error al obtener recomendaciones:', error);
    return res.status(500).json({ error: 'Error al obtener recomendaciones' });
  }
});

// POST /api/tracks/history/session — save accumulated listening minutes on app exit
router.post('/history/session', async (req: Request, res: Response) => {
  const { sessions } = req.body;
  const { userId, deviceId } = req.query as { userId?: string; deviceId?: string };
  if (!Array.isArray(sessions)) {
    return res.status(400).json({ error: 'sessions debe ser un array' });
  }
  try {
    await saveSessionMinutes(sessions, userId, deviceId);
    return res.json({ success: true });
  } catch (error) {
    console.error('[Session] Error guardando sesión:', error);
    return res.status(500).json({ error: 'Error guardando sesión' });
  }
});

// GET /api/tracks/history/stats — Detailed Stats for User Dashboard
router.get('/history/stats', async (req: Request, res: Response) => {
  const { start, end, userId } = req.query;

  // Parse time periods
  const hasDateRange = !!(start || end);
  const endDate = end ? new Date(end as string) : new Date();
  const startDate = start ? new Date(start as string) : new Date(0); // epoch = all time

  const periodDuration = endDate.getTime() - startDate.getTime();
  // Previous period = same duration before startDate (only meaningful when hasDateRange)
  const prevStartDate = hasDateRange
    ? new Date(startDate.getTime() - periodDuration)
    : new Date(0);
  const prevEndDate = hasDateRange ? startDate : new Date(0);

  // Fetch from Supabase (primary) or local JSON fallback.
  // We want to fetch the union of [prevStartDate, endDate] so both periods are covered.
  const history = await getHistoryForUser(
    userId as string | undefined,
    prevStartDate,
    endDate
  );
  // 1. Calculate play counts for current and previous period
  let currentPeriodPlaysCount = 0;
  let prevPeriodPlaysCount = 0;
  const artistCounts: Record<string, number> = {};
  const prevArtistCounts: Record<string, number> = {};
  const trackPlayCounts: Record<string, { count: number; track: HistoryEntry }> = {};
  const genreCounts: Record<string, number> = {};
  const dayOfWeekCounts: Record<number, number> = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
  const hourCounts: Record<number, number> = {};
  
  // Initialize hours
  for (let i = 0; i < 24; i++) hourCounts[i] = 0;

  // Function to guess genres for YouTube songs
  const guessGenre = (title: string, artist: string): string => {
    const normArtist = artist.toLowerCase();
    const normTitle = title.toLowerCase();
    
    if (
      normArtist.includes('bunny') || 
      normArtist.includes('towers') || 
      normArtist.includes('carrion') || 
      normArtist.includes('ozuna') || 
      normArtist.includes('jhay') || 
      normArtist.includes('karol g') || 
      normArtist.includes('reggaeton') ||
      normArtist.includes('reggaetón') ||
      normArtist.includes('urbano') ||
      normArtist.includes('danyl') ||
      normArtist.includes('gims') ||
      normArtist.includes('alzo') ||
      normArtist.includes('vegedream') ||
      normTitle.includes('reggaeton') ||
      normTitle.includes('reggaetón')
    ) {
      return 'Urban/Latino';
    }
    
    if (
      normArtist.includes('weeknd') || 
      normArtist.includes('mika') || 
      normArtist.includes('jackson') || 
      normArtist.includes('shakira') || 
      normArtist.includes('pop') ||
      normTitle.includes('pop') ||
      normTitle.includes('remix')
    ) {
      return 'Pop';
    }
    
    if (
      normArtist.includes('secretos') || 
      normArtist.includes('rock') || 
      normArtist.includes('metal') || 
      normArtist.includes('punk') ||
      normTitle.includes('rock') ||
      normTitle.includes('metal')
    ) {
      return 'Rock/Alternative';
    }
    
    if (
      normArtist.includes('rap') || 
      normArtist.includes('hip hop') || 
      normArtist.includes('hip-hop') || 
      normArtist.includes('samurai jay') ||
      normArtist.includes('italianhype') ||
      normArtist.includes('young kingz') ||
      normTitle.includes('rap') ||
      normTitle.includes('hiphop')
    ) {
      return 'Hip-Hop/Rap';
    }
    
    if (
      normArtist.includes('simonsen') || 
      normArtist.includes('classical') || 
      normArtist.includes('clásico') ||
      normArtist.includes('clasico') ||
      normArtist.includes('piano') ||
      normArtist.includes('orchestra')
    ) {
      return 'Clásico';
    }
    
    return 'Otros';
  };

  // Process history play logs
  for (const entry of history) {
    const plays = entry.plays || (entry.lastPlayed ? [entry.lastPlayed] : []);
    
    // For each individual play timestamp
    for (const p of plays) {
      const playTime = new Date(p).getTime();
      
      // Current period
      if (playTime >= startDate.getTime() && playTime <= endDate.getTime()) {
        currentPeriodPlaysCount++;
        
        // Track stats
        if (!trackPlayCounts[entry.trackId]) {
          trackPlayCounts[entry.trackId] = { count: 0, track: entry };
        }
        trackPlayCounts[entry.trackId].count++;
        
        // Artist stats
        if (entry.artist) {
          artistCounts[entry.artist] = (artistCounts[entry.artist] || 0) + 1;
        }

        // Highlights computations: Day of Week & Hour
        const dateObj = new Date(p);
        const day = dateObj.getDay(); // 0 is Sunday
        const hour = dateObj.getHours();
        dayOfWeekCounts[day]++;
        hourCounts[hour]++;
      } 
      // Previous period
      else if (playTime >= prevStartDate.getTime() && playTime < prevEndDate.getTime()) {
        prevPeriodPlaysCount++;
        if (entry.artist) {
          prevArtistCounts[entry.artist] = (prevArtistCounts[entry.artist] || 0) + 1;
        }
      }
    }
  }

  // Unique artists counts
  const currentUniqueArtists = Object.keys(artistCounts).length;
  const prevUniqueArtists = Object.keys(prevArtistCounts).length;
  
  // Calculate trend percentages
  let trendPercentage = 0;
  if (prevPeriodPlaysCount > 0) {
    trendPercentage = Math.round(((currentPeriodPlaysCount - prevPeriodPlaysCount) / prevPeriodPlaysCount) * 100);
  } else {
    trendPercentage = currentPeriodPlaysCount > 0 ? 100 : 0;
  }

  const newArtistsCount = Math.max(0, currentUniqueArtists - prevUniqueArtists);

  // Top Tracks
  const topTracks = Object.values(trackPlayCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(({ count, track }) => ({
      trackId: track.trackId,
      title: track.title,
      artist: track.artist,
      cover: track.cover,
      playCount: count,
    }));

  const mostPlayedTrackCover = topTracks[0]?.cover || '';

  // Top Artists
  const topArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => {
      // Find a cover representing this artist
      const artistTrack = history.find(h => h.artist === name);
      return {
        name,
        count,
        image: artistTrack?.cover || '',
      };
    });

  const artistAvatars = topArtists.slice(0, 5).map(a => a.image).filter(Boolean);
  const artistAvatarsExtra = Math.max(0, currentUniqueArtists - artistAvatars.length);

  // Find top revelation artist (has plays now, but 0 in previous period)
  let topRevelationArtist = '';
  let maxRevelationPlays = 0;
  for (const [artistName, plays] of Object.entries(artistCounts)) {
    const prevPlays = prevArtistCounts[artistName] || 0;
    if (prevPlays === 0 && plays > maxRevelationPlays) {
      maxRevelationPlays = plays;
      topRevelationArtist = artistName;
    }
  }

  let revelationArtistImage = '';
  if (topRevelationArtist) {
    const artistTrack = history.find(h => h.artist === topRevelationArtist);
    revelationArtistImage = artistTrack?.cover || '';
  }
  if (!revelationArtistImage && topArtists.length > 0) {
    revelationArtistImage = topArtists[0]?.image || '';
  }

  // Get genres and build genre distribution
  let resolvedGenresCount = 0;
  for (const trackId of Object.keys(trackPlayCounts)) {
    const playCount = trackPlayCounts[trackId].count;
    const cacheKey = `track:${trackId}`;
    const cached = cache.get(cacheKey);
    let genre = '';

    if (cached) {
      genre = JSON.parse(cached).genre || '';
    } else {
      const track = history.find(h => h.trackId === trackId);
      if (track && (track as any).genre) genre = (track as any).genre;
    }

    if (!genre) {
      const track = history.find(h => h.trackId === trackId);
      if (track) {
        genre = guessGenre(track.title, track.artist);
      }
    }

    if (genre) {
      genreCounts[genre] = (genreCounts[genre] || 0) + playCount;
      resolvedGenresCount += playCount;
    }
  }

  // Sort genres
  const sortedGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      name,
      count,
      percentage: resolvedGenresCount > 0 ? Math.round((count / resolvedGenresCount) * 100) : 100
    }));

  const genreDistribution = sortedGenres.slice(0, 3);

  const topGenreObj = genreDistribution[0];
  const topGenre = topGenreObj?.name || '-';
  const topGenrePercentage = topGenreObj?.percentage || 0;
  
  // Find the artist with the most plays in topGenre
  const genreArtistCounts: Record<string, number> = {};
  if (topGenre !== '-') {
    for (const entry of history) {
      const cacheKey = `track:${entry.trackId}`;
      const cached = cache.get(cacheKey);
      let genre = cached ? JSON.parse(cached).genre : (entry as any).genre || '';
      if (!genre) {
        genre = guessGenre(entry.title, entry.artist);
      }
      
      if (genre === topGenre && entry.artist) {
        const plays = entry.plays || (entry.lastPlayed ? [entry.lastPlayed] : []);
        let currentPlays = 0;
        for (const p of plays) {
          const playTime = new Date(p).getTime();
          if (playTime >= startDate.getTime() && playTime <= endDate.getTime()) {
            currentPlays++;
          }
        }
        if (currentPlays > 0) {
          genreArtistCounts[entry.artist] = (genreArtistCounts[entry.artist] || 0) + currentPlays;
        }
      }
    }
  }

  let topGenreArtist = '';
  let maxGenreArtistPlays = 0;
  for (const [artistName, plays] of Object.entries(genreArtistCounts)) {
    if (plays > maxGenreArtistPlays) {
      maxGenreArtistPlays = plays;
      topGenreArtist = artistName;
    }
  }

  let topGenreCover = '';
  if (topGenreArtist) {
    const artistTrack = history.find(h => h.artist === topGenreArtist);
    topGenreCover = artistTrack?.cover || '';
  }
  if (!topGenreCover && topGenre !== '-') {
    const topGenreTrack = history.find(h => {
      const cacheKey = `track:${h.trackId}`;
      const cached = cache.get(cacheKey);
      let genre = cached ? JSON.parse(cached).genre : (h as any).genre || '';
      if (!genre) {
        genre = guessGenre(h.title, h.artist);
      }
      return genre === topGenre;
    });
    topGenreCover = topGenreTrack?.cover || '';
  }

  // Evolution of listening (X points grouped by date)
  // Let's divide the current period into 5 intervals/ticks for rendering a nice chart
  const listeningEvolution: { date: string; count: number }[] = [];
  const intervalMs = periodDuration / 4;
  for (let i = 0; i < 5; i++) {
    const tickTime = new Date(startDate.getTime() + i * intervalMs);
    const dateLabel = tickTime.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    
    // Count plays in this interval
    let tickCount = 0;
    const startRange = startDate.getTime() + (i - 0.5) * intervalMs;
    const endRange = startDate.getTime() + (i + 0.5) * intervalMs;
    
    for (const entry of history) {
      const plays = entry.plays || [entry.lastPlayed];
      for (const p of plays) {
        const t = new Date(p).getTime();
        if (t >= startRange && t < endRange) {
          tickCount++;
        }
      }
    }
    listeningEvolution.push({ date: dateLabel, count: tickCount });
  }

  // Moods mapping
  const moodMap: Record<string, string[]> = {
    'Enérgico': ['Pop', 'Dance', 'Electronic', 'Hip-Hop/Rap', 'EDM', 'House', 'Urban/Latino'],
    'Chill': ['R&B/Soul', 'Jazz', 'Reggae', 'Easy Listening', 'Ambient', 'Lounge', 'Clásico'],
    'Intense': ['Rock', 'Metal', 'Alternative', 'Punk', 'Hard Rock', 'Rock/Alternative'],
    'Emotional': ['Singer/Songwriter', 'Folk', 'Country', 'Blues', 'Classical', 'Clásico'],
    'Urban': ['Hip-Hop/Rap', 'Rap', 'Trap', 'Reggaeton', 'Latin', 'Urban/Latino'],
    'Party': ['Dance', 'Reggaeton', 'Pop Latino', 'Party', 'EDM', 'Pop', 'Urban/Latino'],
  };

  const moodScores: Record<string, number> = {};
  let totalMoodScore = 0;
  for (const [mood, moodGenres] of Object.entries(moodMap)) {
    let score = 0;
    for (const gd of genreDistribution) {
      if (moodGenres.some(mg => gd.name.toLowerCase().includes(mg.toLowerCase()))) {
        score += gd.count;
      }
    }
    if (score > 0) {
      moodScores[mood] = score;
      totalMoodScore += score;
    }
  }

  const moods = Object.entries(moodScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, score]) => ({
      name,
      percentage: totalMoodScore > 0 ? Math.round((score / totalMoodScore) * 100) : 0,
      color: name === 'Enérgico' ? '#1DB954' : name === 'Urban' ? '#9F7AEA' : '#D69E2E'
    }));

  // Highlights: favorite day
  const daysOfWeek = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  let maxDayIndex = -1;
  let maxDayCount = 0;
  let totalHighlightPlays = 0;
  
  for (let i = 0; i < 7; i++) {
    totalHighlightPlays += dayOfWeekCounts[i];
    if (dayOfWeekCounts[i] > maxDayCount) {
      maxDayCount = dayOfWeekCounts[i];
      maxDayIndex = i;
    }
  }
  const favoriteDay = maxDayIndex !== -1 ? daysOfWeek[maxDayIndex] : '-';
  const favoriteDayPercentage = totalHighlightPlays > 0 ? Math.round((maxDayCount / totalHighlightPlays) * 100) : 0;

  // Favorite hour
  let maxHour = -1;
  let maxHourCount = 0;
  for (let i = 0; i < 24; i++) {
    if (hourCounts[i] > maxHourCount) {
      maxHourCount = hourCounts[i];
      maxHour = i;
    }
  }
  const favoriteHour = maxHour !== -1 ? `${maxHour.toString().padStart(2, '0')}:00` : '-';

  // Streak calculations (longest consecutive days playing music)
  let longestStreak = 0;
  const playDates = new Set<string>();
  for (const entry of history) {
    const plays = entry.plays || [entry.lastPlayed];
    for (const p of plays) {
      const playTime = new Date(p).getTime();
      if (playTime >= startDate.getTime() && playTime <= endDate.getTime()) {
        playDates.add(new Date(p).toDateString());
      }
    }
  }
  
  if (playDates.size > 0) {
    const sortedDates = Array.from(playDates).map(d => new Date(d)).sort((a,b) => a.getTime() - b.getTime());
    let currentStreak = 1;
    longestStreak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const diffTime = Math.abs(sortedDates[i].getTime() - sortedDates[i-1].getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        currentStreak++;
      } else if (diffDays > 1) {
        longestStreak = Math.max(longestStreak, currentStreak);
        currentStreak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, currentStreak);
  }

  // Recent Activity Feed
  const recentActivity: any[] = [];
  
  // 1. Recent playlist additions
  const { playlists: playlistsMap } = require('./playlists');
  if (playlistsMap) {
    const allPlaylists = Array.from(playlistsMap.values()) as any[];
    for (const pl of allPlaylists) {
      if (pl.userId && pl.userId !== userId) continue;
      for (const trackInfo of (pl.tracks || [])) {
        const tr = history.find(h => h.trackId === trackInfo.trackId);
        if (tr) {
          const addedTime = new Date(trackInfo.addedAt);
          if (addedTime.getTime() >= startDate.getTime() && addedTime.getTime() <= endDate.getTime()) {
            recentActivity.push({
              type: 'playlist_add',
              text: `Añadiste ${tr.title} a tu playlist ${pl.name}`,
              timestamp: addedTime.getTime(),
              time: formatTimeAgo(addedTime),
              image: tr.cover
            });
          }
        }
      }
    }
  }

  // 2. Recent song plays
  const playedSorted = history
    .filter(h => h.lastPlayed)
    .sort((a, b) => new Date(b.lastPlayed).getTime() - new Date(a.lastPlayed).getTime());

  for (const tr of playedSorted) {
    const plays = tr.plays || [tr.lastPlayed];
    for (const p of plays) {
      const playTime = new Date(p).getTime();
      if (playTime >= startDate.getTime() && playTime <= endDate.getTime()) {
        recentActivity.push({
          type: 'play',
          text: `Escuchaste ${tr.title}`,
          timestamp: playTime,
          time: formatTimeAgo(new Date(p)),
          image: tr.cover
        });
      }
    }
  }

  // Sort consolidated activity and take top 3
  const consolidatedActivity = recentActivity
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3);

  // Total minutes listened in the current period
  // Primary: sum real session seconds (recorded via saveSessionMinutes / sendBeacon)
  // Fallback: estimate 3 min per play (for users that never closed app cleanly)
  let totalSecondsListened = 0;
  let hasSomeSessionData = false;
  for (const entry of history) {
    if (entry.minutesBySession && entry.minutesBySession.length > 0) {
      hasSomeSessionData = true;
      for (const session of entry.minutesBySession) {
        const sessionTime = new Date(session.date).getTime();
        if (sessionTime >= startDate.getTime() && sessionTime <= endDate.getTime()) {
          totalSecondsListened += session.seconds;
        }
      }
    }
  }

  let totalMinutes: number;
  if (hasSomeSessionData) {
    totalMinutes = Math.round(totalSecondsListened / 60);
  } else {
    // Estimate: average track ~3 minutes
    totalMinutes = currentPeriodPlaysCount * 3;
  }

  return res.json({
    totalPlays: currentPeriodPlaysCount,
    totalMinutes,
    trendPercentage,
    uniqueArtists: currentUniqueArtists,
    newArtistsCount,
    artistAvatars,
    artistAvatarsExtra,
    topGenre,
    topGenrePercentage,
    topGenreCover,
    revelationArtistImage,
    mostPlayedTrackCover,
    genreDistribution,
    listeningEvolution,
    moods,
    topTracks,
    topArtists,
    highlights: {
      favoriteDay,
      favoriteDayPercentage,
      favoriteHour,
      longestStreak
    },
    recentActivity: consolidatedActivity
  });
});

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffMins < 60) return `Hace ${diffMins} minutos`;
  if (diffHours < 24) return `Hace ${diffHours} horas`;
  return 'Ayer';
}

// GET /api/tracks/taste-profile — Taste Profile (#14): genre/mood breakdown
router.get('/taste-profile', async (req: Request, res: Response) => {
  try {
    const history = readHistory();
    if (history.length === 0) {
      return res.json({ genres: [], topMoods: [], totalTracks: 0 });
    }

    // Function to guess genres for YouTube songs
    const guessGenre = (title: string, artist: string): string => {
      const normArtist = artist.toLowerCase();
      const normTitle = title.toLowerCase();
      
      if (
        normArtist.includes('bunny') || 
        normArtist.includes('towers') || 
        normArtist.includes('carrion') || 
        normArtist.includes('ozuna') || 
        normArtist.includes('jhay') || 
        normArtist.includes('karol g') || 
        normArtist.includes('reggaeton') ||
        normArtist.includes('reggaetón') ||
        normArtist.includes('urbano') ||
        normArtist.includes('danyl') ||
        normArtist.includes('gims') ||
        normArtist.includes('alzo') ||
        normArtist.includes('vegedream') ||
        normTitle.includes('reggaeton') ||
        normTitle.includes('reggaetón')
      ) {
        return 'Urban/Latino';
      }
      
      if (
        normArtist.includes('weeknd') || 
        normArtist.includes('mika') || 
        normArtist.includes('jackson') || 
        normArtist.includes('shakira') || 
        normArtist.includes('pop') ||
        normTitle.includes('pop') ||
        normTitle.includes('remix')
      ) {
        return 'Pop';
      }
      
      if (
        normArtist.includes('secretos') || 
        normArtist.includes('rock') || 
        normArtist.includes('metal') || 
        normArtist.includes('punk') ||
        normTitle.includes('rock') ||
        normTitle.includes('metal')
      ) {
        return 'Rock/Alternative';
      }
      
      if (
        normArtist.includes('rap') || 
        normArtist.includes('hip hop') || 
        normArtist.includes('hip-hop') || 
        normArtist.includes('samurai jay') ||
        normArtist.includes('italianhype') ||
        normArtist.includes('young kingz') ||
        normTitle.includes('rap') ||
        normTitle.includes('hiphop')
      ) {
        return 'Hip-Hop/Rap';
      }
      
      if (
        normArtist.includes('simonsen') || 
        normArtist.includes('classical') || 
        normArtist.includes('clásico') ||
        normArtist.includes('clasico') ||
        normArtist.includes('piano') ||
        normArtist.includes('orchestra')
      ) {
        return 'Clásico';
      }
      
      return 'Otros';
    };

    // Aggregate genres from track metadata
    const genreCounts: Record<string, number> = {};
    const artistGenres: Record<string, string> = {};
    let resolved = 0;

    // Attempt to get genre from cache/DB for each track
    for (const h of history) {
      const id = Number(h.trackId);
      let genre = '';

      if (!isNaN(id) && id !== 0) {
        const cacheKey = `track:${h.trackId}`;
        const cached = cache.get(cacheKey);

        if (cached) {
          const parsed = JSON.parse(cached);
          genre = parsed.genre || '';
        } else {
          // Try DB lookup
          try {
            const track = await getTrackById(h.trackId);
            if (track?.genre) genre = track.genre;
          } catch {}
        }
      }

      if (!genre) {
        genre = guessGenre(h.title, h.artist);
      }

      if (genre) {
        genreCounts[genre] = (genreCounts[genre] || 0) + h.playCount;
        resolved += h.playCount;
      }
    }

    // Sort genres by play count
    const genres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    const total = genres.reduce((sum, g) => sum + g.count, 0);

    // Map genres to moods for visualization
    const moodMap: Record<string, string[]> = {
      'Enérgico': ['Pop', 'Dance', 'Electronic', 'Hip-Hop/Rap', 'EDM', 'House', 'Urban/Latino'],
      'Chill': ['R&B/Soul', 'Jazz', 'Reggae', 'Easy Listening', 'Ambient', 'Lounge', 'Clásico'],
      'Intense': ['Rock', 'Metal', 'Alternative', 'Punk', 'Hard Rock', 'Rock/Alternative'],
      'Emotional': ['Singer/Songwriter', 'Folk', 'Country', 'Blues', 'Classical', 'Clásico'],
      'Urban': ['Hip-Hop/Rap', 'Rap', 'Trap', 'Reggaeton', 'Latin', 'Urban/Latino'],
      'Party': ['Dance', 'Reggaeton', 'Pop Latino', 'Party', 'EDM', 'Pop', 'Urban/Latino'],
    };

    const moodScores: Record<string, number> = {};
    for (const [mood, moodGenres] of Object.entries(moodMap)) {
      let score = 0;
      for (const g of genres) {
        if (moodGenres.some(mg => g.name.toLowerCase().includes(mg.toLowerCase()))) {
          score += g.count;
        }
      }
      if (score > 0) moodScores[mood] = score;
    }

    const topMoods = Object.entries(moodScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count, percentage: total > 0 ? Math.round((count / total) * 100) : 0 }));

    return res.json({
      genres: genres.slice(0, 15).map(g => ({
        ...g,
        percentage: total > 0 ? Math.round((g.count / total) * 100) : 0
      })),
      topMoods,
      totalTracks: history.length,
      resolvedTracks: resolved,
    });
  } catch (error) {
    console.error('[Tracks] Error en taste-profile:', error);
    return res.status(500).json({ error: 'Error generando taste profile' });
  }
});

// GET /api/tracks/:id

// GET /api/tracks/custom - Obtener lista de tracks customizados o alias
router.get('/custom', (req: Request, res: Response) => {
  try {
    const list = getCustomTracks();
    return res.json(list);
  } catch (error) {
    console.error('[Tracks] Error al obtener tracks custom:', error);
    return res.status(500).json({ error: 'Error al obtener tracks custom' });
  }
});

// POST /api/tracks/upload - Crear track customizado o alias
router.post('/upload', upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]), async (req: Request, res: Response) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const { title, artist, album, sourceType, youtubeId, originalTrackId, duration, isPublic } = req.body;

    if (!title || !artist || !sourceType) {
      return res.status(400).json({ error: 'title, artist y sourceType son requeridos' });
    }

    const id = `custom_${uuidv4()}`;
    let finalCover = '/uploads/default_cover.png';
    let audioPath;
    let audioUrl;

    const isPublicBool = isPublic === 'true' || isPublic === true;

    // Procesar audio si es upload
    if (sourceType === 'upload') {
      const audioFile = files?.audio?.[0];
      if (!audioFile) {
        return res.status(400).json({ error: 'Se requiere un archivo de audio para el sourceType upload' });
      }
      
      // Comprimir audio a Opus de alta eficiencia
      const { compressAudio } = require('../services/audioCompressionService');
      const compressedPath = await compressAudio(audioFile.path);
      audioPath = compressedPath;

      // Subir a CDN si es público
      if (isPublicBool) {
        const { uploadToCDN } = require('../services/cdnService');
        const cdnUrl = await uploadToCDN(id, compressedPath, true); // true para borrar local
        if (cdnUrl) {
          audioPath = undefined;
          audioUrl = cdnUrl;
        }
      }
    } else if (sourceType === 'youtube_alias') {
      if (!youtubeId) {
        return res.status(400).json({ error: 'youtubeId es requerido para el sourceType youtube_alias' });
      }
    } else {
      return res.status(400).json({ error: 'sourceType no soportado' });
    }

    // Procesar cover
    const coverFile = files?.cover?.[0];
    if (coverFile) {
      finalCover = `/uploads/${coverFile.filename}`;
    } else if (sourceType === 'youtube_alias') {
      finalCover = `https://img.youtube.com/vi/${youtubeId}/0.jpg`;
    }

    const durationMs = duration ? parseInt(duration, 10) : 180000;

    const newTrack = {
      id,
      title,
      artist,
      album: album || '',
      cover: finalCover,
      audioPath,
      audioUrl,
      sourceType,
      youtubeId: sourceType === 'youtube_alias' ? youtubeId : undefined,
      originalTrackId: originalTrackId || undefined,
      duration: durationMs,
      isPublic: isPublicBool,
      createdAt: new Date().toISOString()
    };

    addCustomTrack(newTrack);

    return res.status(201).json(newTrack);
  } catch (error) {
    console.error('[Tracks] Error al subir track custom:', error);
    return res.status(500).json({ error: 'Error al procesar el track' });
  }
});

// DELETE /api/tracks/custom/:id - Eliminar track custom
router.delete('/custom/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const success = deleteCustomTrack(id);
    if (success) {
      return res.json({ success: true, message: 'Track eliminado exitosamente' });
    } else {
      return res.status(404).json({ error: 'Track no encontrado' });
    }
  } catch (error) {
    console.error('[Tracks] Error al eliminar track custom:', error);
    return res.status(500).json({ error: 'Error al eliminar track custom' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const cacheKey = `track:${id}`;
  const cached = cache.get(cacheKey);

  if (cached) {
    const track = JSON.parse(cached);
    return res.json({ ...track, audioReady: audioExists(id) });
  }

  try {
    const track = await getTrackById(id);
    if (!track) return res.status(404).json({ error: 'Track no encontrado' });

    cache.setex(cacheKey, 86400, JSON.stringify(track)); // 24h
    return res.json({ ...track, audioReady: audioExists(id) });
  } catch (err) {
    console.error('[Tracks] Error:', err);
    return res.status(500).json({ error: 'Error al obtener track' });
  }
});

// Función para limpiar metadatos de YouTube para mejor coincidencia en letras
function cleanMetadataForLyrics(title: string, author: string) {
  let artist = author;
  let trackName = title;

  // Si el título contiene " - ", probablemente sea "Artista - Canción"
  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    artist = parts[0].trim();
    trackName = parts[1].trim();
  }

  // Quitar VEVO, Topic, etc. del artista
  artist = artist
    .replace(/\b(vevo|topic|official|music|records|group)\b/gi, '')
    .trim();

  // Quitar etiquetas comunes en YouTube de la canción
  trackName = trackName
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\b(official|video|audio|lyric|lyrics|hq|hd|music|remix|cover|feat\.?|ft\.?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { artist, title: trackName };
}

import { searchYtdlp } from '../services/ytdlpSearchService';

function stringToSafeIntegerHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash % 4503599627370495);
}

// GET /api/tracks/:id/video — Obtener video de YouTube y videos relacionados
router.get('/:id/video', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    let trackMeta = null;
    const trackCache = cache.get(`track:${id}`);
    if (trackCache) {
      trackMeta = JSON.parse(trackCache);
    } else {
      trackMeta = await getTrackById(id);
    }

    if (!trackMeta) {
      return res.status(404).json({ error: 'Track no encontrado' });
    }

    let youtubeId: string | null = null;
    if (trackMeta.itunesId === 0 || !trackMeta.itunesId) {
      // Es un video de YouTube directo
      const cachedRes = cache.get(`yt-res:${trackMeta.id}`);
      if (cachedRes) {
        youtubeId = cachedRes;
      } else {
        const hashedId = stringToSafeIntegerHash(trackMeta.id);
        const { getYouTubeResolution } = await import('../services/supabaseService');
        const overridden = await getYouTubeResolution(hashedId);
        youtubeId = overridden || trackMeta.id;
        cache.setex(`yt-res:${trackMeta.id}`, 86400 * 30, youtubeId);
      }
    } else {
      // Es un track de iTunes, resolver
      const { resolveYoutubeId } = await import('../services/ytResolverService');
      youtubeId = await resolveYoutubeId(trackMeta.itunesId, trackMeta.artist, trackMeta.title);
    }

    // Buscar videos musicales relacionados via yt-dlp
    let relatedVideos: any[] = [];
    try {
      const query = `${trackMeta.artist} ${trackMeta.title}`;
      const results = await searchYtdlp(query, 10);
      relatedVideos = results
        .filter((v: any) => v.videoId && v.videoId !== youtubeId)
        .slice(0, 6)
        .map((v: any) => ({
          id: v.videoId,
          title: v.title,
          artist: v.author?.name || trackMeta.artist,
          thumbnail: v.thumbnail || `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
          views: v.views,
          duration: v.duration?.seconds
            ? `${Math.floor(v.duration.seconds / 60)}:${String(v.duration.seconds % 60).padStart(2, '0')}`
            : ''
        }));
    } catch (err) {
      console.error('[Video] Error buscando videos relacionados:', err);
    }

    return res.json({ youtubeId, relatedVideos });
  } catch (error) {
    console.error('[Video] Error en GET /:id/video:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/tracks/:id/lyrics
router.get('/:id/lyrics', async (req: Request, res: Response) => {
  const { id } = req.params;
  const cacheKey = `lyrics:${id}`;
  
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json(JSON.parse(cached));
  }

  try {
    // 1. Obtener metadatos de la canción
    let trackMeta = null;
    const trackCache = cache.get(`track:${id}`);
    if (trackCache) {
      trackMeta = JSON.parse(trackCache);
    } else {
      trackMeta = await getTrackById(id);
    }

    if (!trackMeta) {
      return res.status(404).json({ error: 'Track no encontrado para obtener letras' });
    }

    // 2. Limpiar artista y título
    const { artist, title } = cleanMetadataForLyrics(trackMeta.title, trackMeta.artist);
    console.log(`[Lyrics] Buscando en lrclib para: "${artist}" - "${title}" (Original: "${trackMeta.artist}" - "${trackMeta.title}")`);

    // 3. Consultar lrclib.net (primero exacto)
    let response = await fetch(
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`
    );

    let data = null;

    if (response.ok) {
      data = await response.json();
    } else {
      // Fallback: Usar buscador de lrclib
      console.log(`[Lyrics] Fallback de búsqueda para: "${artist}" - "${title}"`);
      const searchResp = await fetch(
        `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`
      );
      if (searchResp.ok) {
        const results = await searchResp.json();
        if (Array.isArray(results) && results.length > 0) {
          data = results[0];
          console.log(`[Lyrics] Fallback exitoso encontrado: "${data.artistName}" - "${data.trackName}"`);
        }
      }
    }

    if (!data) {
      return res.status(404).json({ error: 'Letras no encontradas para esta canción' });
    }
    
    // Guardar en caché por 7 días ya que las letras no cambian
    cache.setex(cacheKey, 604800, JSON.stringify(data));
    
    return res.json(data);
  } catch (error) {
    console.error('[Lyrics] Error obteniendo letras:', error);
    return res.status(500).json({ error: 'Error al conectar con el servidor de letras' });
  }
});

// POST /api/tracks/:id/play
router.post('/:id/play', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, artist, cover } = req.body;
  const { userId, deviceId } = req.query as { userId?: string; deviceId?: string };

  if (!title || !artist) {
    return res.status(400).json({ error: 'Faltan title o artist en el body' });
  }

  try {
    const entry = logTrackPlay(id, { title, artist, cover: cover || '' }, userId, deviceId);
    return res.json({ success: true, entry });
  } catch (error) {
    console.error('[Tracks] Error al registrar reproducción:', error);
    return res.status(500).json({ error: 'Error al guardar en el historial' });
  }
});

// PUT /api/tracks/:itunesId/resolve - Forzar un video de YouTube específico para un track de iTunes o YouTube ID directo
router.put('/:itunesId/resolve', async (req: Request, res: Response) => {
  const rawId = req.params.itunesId;
  const { youtubeId } = req.body;

  console.log('[Tracks] Request to resolve track:', { rawId, youtubeId, body: req.body });
  
  if (!rawId || !youtubeId) {
    return res.status(400).json({ error: 'itunesId y youtubeId requeridos' });
  }

  let itunesId = Number(rawId);
  if (isNaN(itunesId) || itunesId === 0) {
    itunesId = stringToSafeIntegerHash(rawId);
    
    // Para tracks de YouTube directos, asegurar que exista el registro correspondiente en tracks_meta
    // para no violar la clave foránea en youtube_resolutions.
    try {
      const { getTrackFromDB, upsertTracks } = await import('../services/supabaseService');
      const exists = await getTrackFromDB(itunesId);
      if (!exists) {
        const trackMeta = await getTrackById(rawId);
        if (trackMeta) {
          await upsertTracks([{
            itunes_id: itunesId,
            title: trackMeta.title,
            artist: trackMeta.artist,
            artist_id: 0,
            album: trackMeta.album || 'YouTube',
            cover_url: trackMeta.cover || null,
            duration_ms: trackMeta.duration || null,
            genre: trackMeta.genre || null,
            release_date: null
          }]);
        }
      }
    } catch (dbErr) {
      console.error('[Tracks] Error guardando metadatos para FK:', dbErr);
    }
  }

  try {
    const { upsertYouTubeResolution } = await import('../services/supabaseService');
    cache.setex(`yt-res:${rawId}`, 86400 * 30, youtubeId);
    await upsertYouTubeResolution(itunesId, youtubeId);
    return res.json({ success: true, itunesId, youtubeId });
  } catch (error) {
    console.error('[Tracks] Error forzando resolución de YouTube:', error);
    return res.status(500).json({ error: 'Error al actualizar' });
  }
});

export default router;
