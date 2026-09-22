import os
import sys
import threading
import logging
import re
import traceback
from flask import Flask, jsonify, request, redirect, send_from_directory, Response, make_response
import requests

import time
import collections

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("KokoServer")

# Ruta a la carpeta static del frontend
static_dir = os.path.join(os.path.dirname(__file__), 'static')
app = Flask(__name__, static_folder=static_dir, static_url_path='')
app.url_map.strict_slashes = False

SERVER_PORT = 3001
CLOUD_BACKEND_URL = "https://kokomusic.onrender.com/api"
is_running = False

RESERVED_STREAM_PATHS = {'status', 'prefetch', 'warm-cdn', 'cdn', 'purge-cache', 'batch', 'custom', 'recommendations', 'history', 'user-tracks', 'resolve'}

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, DELETE, PUT, PATCH'
    return response

@app.route('/health', methods=['GET'])
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "service": "KokoMusic Python Embedded Server",
        "chaquopy": True,
        "yt_dlp": True,
        "frontend_embedded": os.path.exists(os.path.join(static_dir, 'index.html'))
    }), 200

# ── Helper for Cloud Proxying ──────────────────────────────────────────────
def forward_to_cloud(path, allow_redirects=True, timeout=30):
    clean_path = path.lstrip('/')
    target_url = f"{CLOUD_BACKEND_URL.rstrip('/')}/{clean_path}"
    if request.query_string:
        target_url += f"?{request.query_string.decode('utf-8')}"

    logger.info(f"[Proxy] {request.method} /api/{clean_path} -> {target_url}")
    try:
        req_headers = {
            k: v for k, v in request.headers
            if k.lower() not in ['host', 'content-length', 'accept-encoding', 'content-encoding']
        }
        
        resp = None
        for attempt in range(2):
            try:
                resp = requests.request(
                    method=request.method,
                    url=target_url,
                    headers=req_headers,
                    data=request.get_data(),
                    cookies=request.cookies,
                    allow_redirects=allow_redirects,
                    timeout=timeout,
                    stream=True
                )
                break
            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as ce:
                if attempt == 0:
                    logger.warning(f"[Proxy] Reintento 2/2 tras timeout/error en {target_url}: {str(ce)}")
                    continue
                raise ce

        if not allow_redirects and resp.status_code in [301, 302, 303, 307, 308]:
            location = resp.headers.get('Location')
            if location:
                return redirect(location, code=resp.status_code)

        excluded_headers = ['content-encoding', 'transfer-encoding', 'connection']
        headers = [(name, value) for (name, value) in resp.raw.headers.items()
                   if name.lower() not in excluded_headers]
        headers.append(('Access-Control-Allow-Origin', '*'))
        return Response(resp.iter_content(chunk_size=32768), resp.status_code, headers)

    except Exception as e:
        logger.error(f"[Proxy Error] fallo al conectar a {target_url}: {str(e)}")
        return jsonify({"error": f"No se pudo conectar con el servidor en la nube: {str(e)}"}), 502


# ── Media Stream Proxy Helper (Evita Bloqueo HTTP 403 por Referer) ──────────
def proxy_media_url(media_url, custom_headers=None):
    """
    Transmite los bytes del stream de audio directamente al WebView.
    Sustituye la redirección 302 para evitar que el navegador envíe Referer: 127.0.0.1.
    Soporta HTTP Range Requests para seek/rebobinado fluido.
    """
    req_headers = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive'
    }
    if custom_headers and isinstance(custom_headers, dict):
        for k, v in custom_headers.items():
            if k.lower() not in ['range', 'host']:
                req_headers[k] = v
    
    range_header = request.headers.get('Range')
    if range_header:
        req_headers['Range'] = range_header

    logger.info(f"[MediaProxy] Proxying audio stream (Range: {range_header or 'Full'})...")
    try:
        remote_resp = requests.get(media_url, headers=req_headers, stream=True, timeout=18, verify=False)
        
        # Si da 403 con custom_headers, reintentar con cabeceras limpias de navegador
        if remote_resp.status_code == 403 and custom_headers:
            logger.warning("[MediaProxy] 403 recibido con custom_headers, reintentando con UA limpio...")
            clean_headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'identity'
            }
            if range_header:
                clean_headers['Range'] = range_header
            remote_resp = requests.get(media_url, headers=clean_headers, stream=True, timeout=15, verify=False)

        logger.info(f"[MediaProxy] Respuesta upstream CDN: Status {remote_resp.status_code}")
        
        if remote_resp.status_code not in [200, 206]:
            logger.warning(f"[MediaProxy] Status no reproducible del CDN: {remote_resp.status_code}")
            return None

        response_headers = []
        has_content_type = False
        has_accept_ranges = False

        for h_name, h_val in remote_resp.headers.items():
            h_lower = h_name.lower()
            if h_lower in ['content-type', 'content-length', 'content-range', 'accept-ranges']:
                response_headers.append((h_name, h_val))
                if h_lower == 'content-type':
                    has_content_type = True
                elif h_lower == 'accept-ranges':
                    has_accept_ranges = True

        if not has_content_type:
            # Deducir por URL o fallback
            if '.opus' in media_url or 'opus' in media_url:
                response_headers.append(('Content-Type', 'audio/ogg; codecs=opus'))
            elif '.mp4' in media_url or 'mp4a' in media_url or 'm4a' in media_url:
                response_headers.append(('Content-Type', 'audio/mp4'))
            elif '.webm' in media_url:
                response_headers.append(('Content-Type', 'audio/webm'))
            else:
                response_headers.append(('Content-Type', 'audio/mpeg'))

        if not has_accept_ranges:
            response_headers.append(('Accept-Ranges', 'bytes'))

        response_headers.append(('Access-Control-Allow-Origin', '*'))
        response_headers.append(('Cache-Control', 'public, max-age=3600'))

        return Response(
            remote_resp.iter_content(chunk_size=32768),
            status=remote_resp.status_code,
            headers=response_headers
        )
    except Exception as e:
        logger.error(f"[MediaProxy Error] Fallo al proxyar stream: {str(e)}")
        return None


def sanitize_track_id(track_id: str) -> str:
    """Limpia un track_id contaminado por concatenación de URL, espacios o barras finales."""
    if not track_id:
        return track_id
    if 'http' in track_id:
        track_id = track_id.split('http')[0]
    return track_id.strip().rstrip('/')


def is_direct_youtube_id(track_id: str) -> bool:
    """Verifica si un ID de track es directamente un ID de video de YouTube (11 caracteres)."""
    track_id = sanitize_track_id(track_id)
    if not track_id or track_id.lower() in RESERVED_STREAM_PATHS or track_id.isdigit():
        return False
    clean_id = track_id[3:] if track_id.startswith('yt_') else track_id
    return bool(re.match(r'^[a-zA-Z0-9_-]{11}$', clean_id))

# ── Debug Endpoints ──────────────────────────────────────────────────────
@app.route('/api/debug/logs', methods=['GET'])
def get_debug_logs():
    try:
        import ytdlp_helper
        return jsonify({
            "success": True,
            "total_logs": len(ytdlp_helper.LOG_BUFFER),
            "logs": list(ytdlp_helper.LOG_BUFFER)
        }), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/debug/test-ytdlp/<path:track_id>', methods=['GET'])
@app.route('/api/stream/debug/test-ytdlp/<path:track_id>', methods=['GET'])
def test_ytdlp_diagnostic(track_id):
    """
    Endpoint de prueba diagnóstica que ejecuta el flujo completo de resolución
    y devuelve un reporte detallado JSON con todos los pasos y errores.
    """
    clean_id = sanitize_track_id(track_id)
    report = {
        "track_id": clean_id,
        "raw_track_id": track_id,
        "is_direct_youtube_id": is_direct_youtube_id(clean_id),
        "steps": []
    }
    
    try:
        import ytdlp_helper
        yt_id = clean_id[3:] if clean_id.startswith('yt_') else clean_id
        
        # Paso 1: Resolver iTunes si es ID numérico
        if not is_direct_youtube_id(clean_id) and clean_id.isdigit():
            report["steps"].append({"step": "1_itunes_resolution", "status": "started"})
            itunes_diag = ytdlp_helper.resolve_itunes_track_to_youtube_verbose(clean_id)
            resolved_yid = itunes_diag.get("resolved_youtube_id")
            report["steps"].append({
                "step": "1_itunes_resolution",
                "status": "completed" if resolved_yid else "failed",
                "details": itunes_diag,
                "resolved_youtube_id": resolved_yid
            })
            if resolved_yid:
                yt_id = resolved_yid
        
        # Paso 2: Extraer Stream URL
        report["steps"].append({"step": "2_extract_stream_url", "status": "started", "youtube_id": yt_id})
        stream_res = ytdlp_helper.get_stream_url(yt_id)
        report["steps"].append({
            "step": "2_extract_stream_url",
            "status": "completed" if stream_res.get('success') else "failed",
            "result": stream_res
        })

        # Paso 3: Probar conexión HTTP al CDN de YouTube
        if stream_res.get('success') and stream_res.get('url'):
            cdn_url = stream_res['url']
            report["steps"].append({"step": "3_test_cdn_connection", "status": "started"})
            try:
                test_headers = dict(stream_res.get('http_headers') or {})
                test_headers['Range'] = 'bytes=0-1023'
                test_resp = requests.get(
                    cdn_url,
                    headers=test_headers,
                    timeout=5,
                    verify=False
                )
                report["steps"].append({
                    "step": "3_test_cdn_connection",
                    "status": "completed",
                    "cdn_http_status": test_resp.status_code,
                    "content_type": test_resp.headers.get('Content-Type'),
                    "bytes_received": len(test_resp.content)
                })
            except Exception as ce:
                report["steps"].append({
                    "step": "3_test_cdn_connection",
                    "status": "failed",
                    "error": str(ce)
                })

        return jsonify(report), 200

    except Exception as e:
        report["error"] = str(e)
        report["traceback"] = traceback.format_exc()
        return jsonify(report), 500


# ── Explicit System Stream Endpoints ──────────────────────────────
@app.route('/api/stream/status', methods=['GET'])
def stream_batch_status():
    return forward_to_cloud('stream/status')

@app.route('/api/stream/prefetch', methods=['GET', 'POST'])
def stream_prefetch():
    return forward_to_cloud('stream/prefetch')

@app.route('/api/stream/warm-cdn', methods=['POST'])
def stream_warm_cdn():
    return forward_to_cloud('stream/warm-cdn')

@app.route('/api/stream/cdn/stats', methods=['GET'])
def stream_cdn_stats():
    return forward_to_cloud('stream/cdn/stats')

# ── YouTube Search Route with Local Fallback ─────────────────────────────────
@app.route('/api/search/youtube', methods=['GET'])
def search_youtube():
    q = request.args.get('q', '')
    if q:
        cloud_resp = forward_to_cloud('search/youtube', timeout=2)
        if hasattr(cloud_resp, 'status_code') and cloud_resp.status_code == 200:
            try:
                data = cloud_resp.get_json(silent=True)
                if data and isinstance(data, list) and len(data) > 0:
                    return cloud_resp
            except Exception:
                pass
    # Fallback local usando yt-dlp en el teléfono
    logger.info(f"[Server] Usando búsqueda local de YouTube para query: '{q}'")
    try:
        import ytdlp_helper
        res = ytdlp_helper.search_youtube_local(q)
        return jsonify(res.get('results', [])), 200
    except Exception as e:
        logger.error(f"[Server] Fallo en búsqueda local de YouTube: {str(e)}")
        return jsonify([]), 200

STREAM_CACHE = {} # track_id -> {'url': ..., 'headers': ..., 'timestamp': ...}
R2_PUBLIC_BASE = "https://pub-62d2e287e6a14685a2ad269d13810d75.r2.dev/audio"

def get_from_stream_cache(key):
    import time
    cached = STREAM_CACHE.get(key)
    if cached and (time.time() - cached.get('timestamp', 0)) < 21600: # 6h TTL
        return cached
    return None

def set_stream_cache(key, url, headers=None):
    import time
    STREAM_CACHE[key] = {
        'url': url,
        'headers': headers or {},
        'timestamp': time.time()
    }

def check_r2_cdn(youtube_id):
    if not youtube_id:
        return None
    r2_url = f"{R2_PUBLIC_BASE}/{youtube_id}.opus"
    try:
        head_resp = requests.head(r2_url, timeout=1.2)
        if head_resp.status_code == 200:
            return r2_url
    except Exception:
        pass
    return None

def fetch_cloud_json(path, timeout=3):
    clean_path = path.lstrip('/')
    target_url = f"{CLOUD_BACKEND_URL.rstrip('/')}/{clean_path}"
    try:
        r = requests.get(target_url, timeout=timeout, headers={'Accept': 'application/json', 'User-Agent': 'KokoMusic-Android/1.0'})
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        logger.warning(f"[Cloud JSON] Error al consultar {target_url}: {str(e)}")
    return None

TRACK_META_CACHE = {} # itunesId -> {'youtubeId': ..., 'artist': ..., 'title': ...}

# ── Audio Stream Route ───────────────────────────────────────────────────
@app.route('/api/stream/<track_id>', methods=['GET'])
def stream_audio(track_id):
    track_id = sanitize_track_id(track_id)
    if track_id.lower() in RESERVED_STREAM_PATHS:
        return forward_to_cloud(f'stream/{track_id}')

    # 1. Caché L1 en memoria (0ms, 0 CPU)
    cached_entry = get_from_stream_cache(track_id)
    if cached_entry:
        logger.info(f"[Server] 🚀 L1 Cache Hit para track: {track_id}")
        proxied = proxy_media_url(cached_entry['url'], cached_entry.get('headers'))
        if proxied:
            return proxied

    # 2. Si es un ID de YouTube nativo:
    if is_direct_youtube_id(track_id):
        yt_id = track_id[3:] if track_id.startswith('yt_') else track_id
        
        # 2a. Comprobar CDN R2 rápido (<100ms)
        r2_url = check_r2_cdn(yt_id)
        if r2_url:
            logger.info(f"[Server] ⚡ Cloudflare R2 Hit para {yt_id}")
            set_stream_cache(track_id, r2_url)
            return proxy_media_url(r2_url)

        # 2b. Intentar Cloud Backend primero (rápido, InnerTube / JioSaavn / Invidious)
        try:
            logger.info(f"[Server] 🌐 Consultando cloud backend para YouTube ID {yt_id}...")
            cloud_resp = forward_to_cloud(f'stream/{track_id}', allow_redirects=True, timeout=8)
            if hasattr(cloud_resp, 'status_code') and cloud_resp.status_code in [200, 206]:
                return cloud_resp
        except Exception as e:
            logger.warning(f"[Server] Cloud backend falló o timeout para {yt_id}: {str(e)}")

        # 2c. Extracción yt-dlp local (fallback)
        logger.info(f"[Server] 💾 Fallback: Extracción local directa yt-dlp para YouTube ID: {yt_id}")
        try:
            import ytdlp_helper
            result = ytdlp_helper.get_stream_url(yt_id)
            if result.get('success') and result.get('url'):
                set_stream_cache(track_id, result.get('url'), result.get('http_headers'))
                proxied = proxy_media_url(result.get('url'), result.get('http_headers'))
                if proxied:
                    return proxied
        except Exception as e:
            logger.warning(f"[Server] Fallo extracción local para {yt_id}: {str(e)}")

    # 3. Si es ID numérico (iTunes):
    if track_id.isdigit():
        logger.info(f"[Server] Resolviendo pista iTunes {track_id}...")
        try:
            yt_id = None
            artist = None
            title = None

            # 3a. Usar caché local en memoria si ya fue resuelta en /status o peticiones anteriores
            if track_id in TRACK_META_CACHE:
                cached_meta = TRACK_META_CACHE[track_id]
                yt_id = cached_meta.get('youtubeId')
                artist = cached_meta.get('artist')
                title = cached_meta.get('title')

            # 3b. Obtener youtubeId y metadatos rápidamente desde la API de caché remota (50-150ms)
            if not yt_id or not artist or not title:
                status_data = fetch_cloud_json(f'stream/{track_id}/status', timeout=2)
                if status_data:
                    yt_id = status_data.get('youtubeId') or yt_id
                    artist = status_data.get('artist') or artist
                    title = status_data.get('title') or title
                    TRACK_META_CACHE[track_id] = {'youtubeId': yt_id, 'artist': artist, 'title': title}
                    if yt_id:
                        logger.info(f"[Server] ⚡ YouTube ID obtenido de caché remota: {yt_id} para {track_id}")

            # 3c. Si no obtuvimos metadatos, obtener de tracks API
            if not artist or not title:
                track_meta = fetch_cloud_json(f'tracks/{track_id}', timeout=1.5)
                if track_meta:
                    artist = track_meta.get('artist') or artist
                    title = track_meta.get('title') or title
                    TRACK_META_CACHE[track_id] = {'youtubeId': yt_id, 'artist': artist, 'title': title}

            # 3d. Nivel 1: JioSaavn Akamai CDN directo (<150ms, 320kbps, sin yt-dlp)
            if artist and title:
                try:
                    import jiosaavn
                    jio_match = jiosaavn.search_jiosaavn(artist, title)
                    if jio_match and jio_match.get('streamUrl'):
                        logger.info(f"[Server] ⚡ JioSaavn Akamai CDN Hit para '{artist} - {title}'")
                        set_stream_cache(track_id, jio_match['streamUrl'])
                        proxied = proxy_media_url(jio_match['streamUrl'])
                        if proxied:
                            return proxied
                except Exception as je:
                    logger.warning(f"[Server] JioSaavn check local falló: {str(je)}")

            # 3e. Nivel 2: Verificación Cloudflare R2 CDN (<100ms)
            if yt_id:
                r2_url = check_r2_cdn(yt_id)
                if r2_url:
                    logger.info(f"[Server] ⚡ Cloudflare R2 Hit para {track_id} ({yt_id})")
                    set_stream_cache(track_id, r2_url)
                    return proxy_media_url(r2_url)

            # 3f. Nivel 3: Si ya conocemos youtubeId, intentar extracción directa local con yt-dlp (rápido en IP residencial)
            if yt_id:
                try:
                    import ytdlp_helper
                    logger.info(f"[Server] ⚡ Intentando extracción directa local yt-dlp para youtubeId: {yt_id}")
                    res = ytdlp_helper.get_stream_url(yt_id)
                    if res.get('success') and res.get('url'):
                        set_stream_cache(track_id, res.get('url'), res.get('http_headers'))
                        proxied = proxy_media_url(res.get('url'), res.get('http_headers'))
                        if proxied:
                            return proxied
                except Exception as ye:
                    logger.warning(f"[Server] Extracción directa local falló para {yt_id}: {str(ye)}")

            # 3g. Nivel 4: Cloud Backend Streaming (Multi-source Waterfall completo en HF Space)
            try:
                logger.info(f"[Server] 🌐 Solicitando stream a Cloud Backend para track {track_id} (timeout 6s)...")
                resp = forward_to_cloud(f'stream/{track_id}', allow_redirects=True, timeout=6)
                if hasattr(resp, 'status_code') and resp.status_code in [200, 206]:
                    return resp
            except Exception as ce:
                logger.warning(f"[Server] Forward to cloud falló para {track_id}: {str(ce)}")

            # 3g. Nivel 4: Fallback de último recurso -> Resolución y extracción local on-device con yt-dlp
            logger.info(f"[Server] 💾 Fallback local final (yt-dlp) para iTunes {track_id}...")
            import ytdlp_helper
            if not yt_id:
                yt_id = ytdlp_helper.resolve_itunes_track_to_youtube(track_id)
                if yt_id:
                    TRACK_META_CACHE[track_id] = {'youtubeId': yt_id, 'artist': artist, 'title': title}

            if yt_id:
                res = ytdlp_helper.get_stream_url(yt_id)
                if res.get('success') and res.get('url'):
                    set_stream_cache(track_id, res.get('url'), res.get('http_headers'))
                    proxied = proxy_media_url(res.get('url'), res.get('http_headers'))
                    if proxied:
                        return proxied

        except Exception as e:
            logger.warning(f"[Server] Fallo resolución local total para iTunes {track_id}: {str(e)}")

    return jsonify({"error": "No se pudo resolver el stream de audio"}), 404

@app.route('/api/stream/<track_id>/status', methods=['GET'])
def stream_track_status(track_id):
    track_id = sanitize_track_id(track_id)
    if is_direct_youtube_id(track_id):
        return jsonify({
            "trackId": track_id,
            "youtubeId": track_id,
            "downloaded": False,
            "status": "ready"
        }), 200

    resp = forward_to_cloud(f'stream/{track_id}/status')
    
    # Si la nube responde status 200 con youtubeId, guardarlo en TRACK_META_CACHE para el endpoint de stream
    if hasattr(resp, 'status_code') and resp.status_code == 200:
        try:
            data = resp.get_json(silent=True) or {}
            if data.get('youtubeId'):
                existing = TRACK_META_CACHE.get(track_id, {})
                existing['youtubeId'] = data.get('youtubeId')
                if data.get('artist'): existing['artist'] = data.get('artist')
                if data.get('title'): existing['title'] = data.get('title')
                TRACK_META_CACHE[track_id] = existing
        except Exception:
            pass

    # Si la nube responde error o 'No se pudo resolver', verificar resolución local en teléfono
    needs_local_check = False
    if hasattr(resp, 'status_code'):
        if resp.status_code != 200:
            needs_local_check = True
        else:
            try:
                data = resp.get_json(silent=True) or {}
                if not data.get('downloaded') and (data.get('status') in ['none', 'error'] or 'No se pudo resolver' in str(data.get('message', ''))):
                    needs_local_check = True
            except Exception:
                pass

    if needs_local_check and track_id.isdigit():
        try:
            import ytdlp_helper
            yt_id = ytdlp_helper.resolve_itunes_track_to_youtube(track_id)
            if yt_id:
                existing = TRACK_META_CACHE.get(track_id, {})
                existing['youtubeId'] = yt_id
                TRACK_META_CACHE[track_id] = existing
                return jsonify({
                    "trackId": track_id,
                    "youtubeId": yt_id,
                    "downloaded": False,
                    "status": "ready"
                }), 200
        except Exception:
            pass

    return resp

@app.route('/api/stream/<track_id>/resolve', methods=['GET'])
def resolve_track_endpoint(track_id):
    """
    Resuelve metadatos e información de stream (youtubeId, directUrl, source, mimeType)
    sin iniciar streaming de bytes. Ideal para pre-resolución ligera y rápida.
    """
    clean_id = sanitize_track_id(track_id)
    yt_id = clean_id[3:] if clean_id.startswith('yt_') else clean_id
    artist = None
    title = None

    if is_direct_youtube_id(clean_id):
        r2_url = check_r2_cdn(yt_id)
        if r2_url:
            return jsonify({
                "success": True,
                "trackId": clean_id,
                "youtubeId": yt_id,
                "directUrl": r2_url,
                "source": "cdn_r2",
                "mimeType": "audio/ogg; codecs=opus"
            }), 200
        return jsonify({
            "success": True,
            "trackId": clean_id,
            "youtubeId": yt_id,
            "directUrl": None,
            "source": "youtube",
            "mimeType": "audio/webm"
        }), 200

    if clean_id.isdigit():
        if clean_id in TRACK_META_CACHE:
            cached_meta = TRACK_META_CACHE[clean_id]
            yt_id = cached_meta.get('youtubeId')
            artist = cached_meta.get('artist')
            title = cached_meta.get('title')

        if not yt_id or not artist or not title:
            status_data = fetch_cloud_json(f'stream/{clean_id}/status', timeout=2)
            if status_data:
                yt_id = status_data.get('youtubeId') or yt_id
                artist = status_data.get('artist') or artist
                title = status_data.get('title') or title
                TRACK_META_CACHE[clean_id] = {'youtubeId': yt_id, 'artist': artist, 'title': title}

        # Comprobar JioSaavn
        if artist and title:
            try:
                import jiosaavn
                jio_match = jiosaavn.search_jiosaavn(artist, title)
                if jio_match and jio_match.get('streamUrl'):
                    return jsonify({
                        "success": True,
                        "trackId": clean_id,
                        "youtubeId": yt_id,
                        "artist": artist,
                        "title": title,
                        "directUrl": jio_match['streamUrl'],
                        "source": "jiosaavn",
                        "mimeType": "audio/mp4"
                    }), 200
            except Exception:
                pass

        if yt_id:
            r2_url = check_r2_cdn(yt_id)
            if r2_url:
                return jsonify({
                    "success": True,
                    "trackId": clean_id,
                    "youtubeId": yt_id,
                    "artist": artist,
                    "title": title,
                    "directUrl": r2_url,
                    "source": "cdn_r2",
                    "mimeType": "audio/ogg; codecs=opus"
                }), 200

        return jsonify({
            "success": True,
            "trackId": clean_id,
            "youtubeId": yt_id,
            "artist": artist,
            "title": title,
            "source": "cloud_or_ytdlp"
        }), 200

    return jsonify({"success": False, "error": "Tipo de track desconocido"}), 400

@app.route('/api/stream/<track_id>/purge-cache', methods=['POST'])
def purge_track_cache(track_id):
    track_id = sanitize_track_id(track_id)
    return forward_to_cloud(f'stream/{track_id}/purge-cache')

@app.route('/api/stream/<track_id>/download', methods=['POST'])
def start_download(track_id):
    track_id = sanitize_track_id(track_id)
    if is_direct_youtube_id(track_id):
        yt_id = track_id[3:] if track_id.startswith('yt_') else track_id
        def run_download():
            try:
                import ytdlp_helper
                ytdlp_helper.download_audio_track(yt_id)
            except Exception as e:
                logger.error(f"[Server] Error en descarga: {str(e)}")
        threading.Thread(target=run_download).start()
        return jsonify({
            "success": True,
            "status": "downloading",
            "message": f"Descarga iniciada para {yt_id}"
        }), 200
    return forward_to_cloud(f'stream/{track_id}/download')

# ── Image Proxy ───────────────────────────────────────────────────────────
@app.route('/api/image-proxy', methods=['GET'])
def image_proxy():
    img_url = request.args.get('url')
    if not img_url:
        return jsonify({"error": "Falta parametro url"}), 400
    try:
        clean_url = img_url.replace('http://', 'https://') if img_url.startswith('http://') else img_url
        if 'mzstatic.com' in clean_url:
            clean_url = re.sub(r'/\d+x\d+bb\.', '/600x600bb.', clean_url)
        resp = requests.get(clean_url, timeout=10, stream=True)
        headers = {
            'Content-Type': resp.headers.get('Content-Type', 'image/jpeg'),
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*'
        }
        return Response(resp.iter_content(chunk_size=8192), resp.status_code, headers=headers)
    except Exception as e:
        logger.error(f"[Image Proxy Error] {str(e)}")
        return jsonify({"error": str(e)}), 500

# ── General API Proxy ─────────────────────────────────────────────────────
@app.route('/api/<path:api_path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
def proxy_to_cloud_backend(api_path):
    if request.method == 'OPTIONS':
        return Response('', 200)
    
    resp = forward_to_cloud(api_path)
    
    # Si la nube devuelve 404 en autenticación/creación de cuenta, proveer fallback local sin error:
    if hasattr(resp, 'status_code') and resp.status_code == 404:
        clean_p = api_path.strip('/')
        if clean_p in ['friends/account/login', 'friends/account/create']:
            logger.info(f"[Server] Fallback local activo para {clean_p}")
            data = request.get_json(silent=True) or {}
            identifier = data.get('identifier') or data.get('username') or data.get('display_name') or 'Usuario Koko'
            clean_name = re.sub(r'[^a-zA-Z0-9_]', '', str(identifier)).lower() or 'user'
            import uuid
            user_id = str(uuid.uuid4())
            profile = {
                "id": user_id,
                "display_name": identifier,
                "username": f"koko_{clean_name[:8]}",
                "avatar_url": None,
                "bio": "Cuenta Koko (Conectada)",
                "is_public": True
            }
            return jsonify({"success": True, "userId": user_id, "profile": profile}), 200

    return resp

# ── SPA Frontend Routes ──────────────────────────────────────────────────
def _send_index_no_cache():
    resp = make_response(send_from_directory(static_dir, 'index.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

@app.route('/')
def serve_index():
    index_path = os.path.join(static_dir, 'index.html')
    if os.path.exists(index_path):
        return _send_index_no_cache()
    return "<h1>Servidor KokoMusic Activo</h1><p>El frontend no está en static/</p>", 200

@app.route('/<path:path>')
def serve_static_or_spa(path):
    target = os.path.join(static_dir, path)
    if os.path.exists(target) and not os.path.isdir(target):
        return send_from_directory(static_dir, path)
    index_path = os.path.join(static_dir, 'index.html')
    if os.path.exists(index_path):
        return _send_index_no_cache()
    return jsonify({"error": "Recurso no encontrado"}), 404


def start_server(port=3001):
    global is_running, SERVER_PORT
    if is_running:
        logger.info("[Server] El servidor ya está corriendo.")
        return
    SERVER_PORT = port
    is_running = True
    logger.info(f"[Server] Arrancando servidor Python KokoMusic en 127.0.0.1:{port}...")
    try:
        app.run(host='127.0.0.1', port=port, debug=False, use_reloader=False, threaded=True)
    except Exception as e:
        logger.error(f"[Server] Error en el servidor Python: {str(e)}")
        is_running = False

if __name__ == '__main__':
    start_server(3001)
