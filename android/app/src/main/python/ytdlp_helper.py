import os
import sys
import json
import logging
import traceback
import collections
import requests
import yt_dlp

# Buffer circular en memoria para capturar los últimos 200 logs
LOG_BUFFER = collections.deque(maxlen=200)

class LogBufferHandler(logging.Handler):
    def emit(self, record):
        try:
            msg = self.format(record)
            LOG_BUFFER.append({
                'level': record.levelname,
                'name': record.name,
                'message': msg
            })
        except Exception:
            pass

# Configuración de logging principal
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("KokoYtDlp")
buffer_handler = LogBufferHandler()
buffer_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] [%(name)s]: %(message)s'))
logger.addHandler(buffer_handler)

# Clase Logger personalizada para yt-dlp
class YtdlpLogger:
    def debug(self, msg):
        if not msg.startswith('[debug] '):
            logger.debug(f"[yt-dlp debug] {msg}")

    def info(self, msg):
        logger.info(f"[yt-dlp info] {msg}")

    def warning(self, msg):
        logger.warning(f"[yt-dlp warning] {msg}")

    def error(self, msg):
        logger.error(f"[yt-dlp error] {msg}")

AUDIO_CACHE_DIR = "/sdcard/Android/data/com.kokomusic.app/files/audio_cache"

def ensure_cache_dir(custom_path=None):
    path = custom_path or AUDIO_CACHE_DIR
    if not os.path.exists(path):
        try:
            os.makedirs(path, exist_ok=True)
        except Exception as e:
            logger.warning(f"No se pudo crear carpeta de cache en {path}: {str(e)}")
            path = "/tmp/audio_cache"
            os.makedirs(path, exist_ok=True)
    return path

def get_stream_url(youtube_id):
    """
    Extrae la URL directa de streaming de audio de YouTube usando yt-dlp.
    Usa selectores de formato nativos para evitar depender de ffmpeg.
    """
    yt_url = f"https://www.youtube.com/watch?v={youtube_id}"
    logger.info(f"Iniciando extracción de stream URL para YouTube ID: {youtube_id}")

    ydl_opts = {
        'format': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
        'quiet': False,
        'no_warnings': False,
        'logger': YtdlpLogger(),
        'nocheckcertificate': True,
        'extractor_args': {
            'youtube': {
                'player_client': ['ios', 'android'],
            }
        },
        'force_ipv4': True,
        'legacy_server_connect': True,
        'http_headers': {
            'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(yt_url, download=False)
            url = info.get('url')
            ext = info.get('ext', 'webm')
            mime = 'audio/webm' if ext == 'webm' else ('audio/mp4' if ext == 'm4a' else 'audio/mpeg')
            
            logger.info(f"Extracción exitosa para {youtube_id}. Formato: {ext}, MIME: {mime}")
            return {
                'success': True,
                'url': url,
                'title': info.get('title'),
                'duration': info.get('duration'),
                'ext': ext,
                'mime': mime
            }
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Error extrayendo URL para {youtube_id}: {str(e)}\n{tb}")
        return {
            'success': False,
            'error': str(e),
            'traceback': tb
        }

def download_audio_track(youtube_id, output_dir=None):
    """
    Descarga el audio de YouTube directamente al almacenamiento local en Android.
    """
    target_dir = ensure_cache_dir(output_dir)
    yt_url = f"https://www.youtube.com/watch?v={youtube_id}"
    output_template = os.path.join(target_dir, f"{youtube_id}.%(ext)s")

    ydl_opts = {
        'format': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
        'outtmpl': output_template,
        'quiet': False,
        'no_warnings': False,
        'logger': YtdlpLogger(),
        'nocheckcertificate': True,
        'extractor_args': {
            'youtube': {
                'player_client': ['tv_embedded', 'ios', 'web_creator', 'android_vr'],
            }
        },
        'force_ipv4': True,
        'http_headers': {
            'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([yt_url])
            logger.info(f"Descarga completada para {youtube_id} en {output_template}")
            return {
                'success': True,
                'youtube_id': youtube_id,
                'path': output_template
            }
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Error descargando {youtube_id}: {str(e)}\n{tb}")
        return {
            'success': False,
            'error': str(e),
            'traceback': tb
        }

def search_youtube_local(query, max_results=5):
    """
    Realiza una búsqueda de videos/canciones en YouTube usando yt-dlp directamente desde el teléfono.
    """
    if not query:
        return {'success': True, 'results': []}
    
    logger.info(f"Ejecutando búsqueda local de YouTube para query: '{query}'")
    search_spec = f"ytsearch{max_results}:{query}"
    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': False,
        'no_warnings': False,
        'skip_download': True,
        'extract_flat': True,
        'logger': YtdlpLogger(),
        'nocheckcertificate': True,
        'extractor_args': {
            'youtube': {
                'player_client': ['ios', 'android'],
            }
        },
        'force_ipv4': True,
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            res = ydl.extract_info(search_spec, download=False)
            entries = res.get('entries', []) if res else []
            results = []
            for entry in entries:
                if not entry:
                    continue
                yid = entry.get('id')
                if not yid:
                    continue
                results.append({
                    'id': f"yt_{yid}",
                    'youtubeId': yid,
                    'title': entry.get('title') or 'Sin título',
                    'artist': entry.get('uploader') or entry.get('channel') or 'YouTube',
                    'cover': f"https://i.ytimg.com/vi/{yid}/hqdefault.jpg",
                    'duration': int((entry.get('duration') or 0) * 1000),
                    'source': 'youtube'
                })
            logger.info(f"Búsqueda exitosa. Resultados encontrados: {len(results)}")
            return {'success': True, 'results': results}
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Error en búsqueda local de YouTube para '{query}': {str(e)}\n{tb}")
        return {'success': False, 'error': str(e), 'traceback': tb, 'results': []}

def resolve_itunes_track_to_youtube_verbose(track_id):
    """
    Obtiene metadatos de iTunes y busca en YouTube devolviendo un diccionario con detalles diagnósticos.
    """
    diag = {
        "track_id": track_id,
        "itunes_status": None,
        "title": None,
        "artist": None,
        "youtube_search_success": False,
        "resolved_youtube_id": None,
        "error": None
    }
    try:
        import certifi
        ca_bundle = certifi.where()
    except Exception:
        ca_bundle = None

    diag["ssl_mode"] = "certifi" if ca_bundle else "unverified"
    try:
        url = f"https://itunes.apple.com/lookup?id={track_id}"
        try:
            resp = requests.get(url, timeout=7, headers={'User-Agent': 'KokoMusic/1.0'}, verify=ca_bundle or True)
        except Exception as ssl_ex:
            logger.warning(f"iTunes lookup con SSL estándar falló ({ssl_ex}), reintentando con verify=False")
            diag["ssl_mode"] = "fallback_unverified"
            resp = requests.get(url, timeout=7, headers={'User-Agent': 'KokoMusic/1.0'}, verify=False)

        diag["itunes_status"] = resp.status_code
        if resp.status_code == 200:
            data = resp.json()
            if data.get('resultCount', 0) > 0:
                item = data['results'][0]
                diag["title"] = item.get('trackName', '')
                diag["artist"] = item.get('artistName', '')
                if diag["title"] and diag["artist"]:
                    search_res = search_youtube_local(f"{diag['artist']} {diag['title']}", max_results=1)
                    diag["youtube_search_success"] = search_res.get('success', False)
                    if search_res.get('success') and search_res.get('results'):
                        diag["resolved_youtube_id"] = search_res['results'][0]['youtubeId']
                    elif search_res.get('error'):
                        diag["error"] = f"YouTube search error: {search_res['error']}"
            else:
                diag["error"] = f"iTunes lookup devolvió 0 resultados para ID {track_id}"
        else:
            diag["error"] = f"iTunes lookup HTTP {resp.status_code}"
    except Exception as e:
        diag["error"] = str(e)
        diag["traceback"] = traceback.format_exc()
    return diag

def resolve_itunes_track_to_youtube(track_id):
    """
    Obtiene los metadatos de un track de iTunes por ID y busca el video correspondiente en YouTube.
    """
    res = resolve_itunes_track_to_youtube_verbose(track_id)
    return res.get("resolved_youtube_id")
