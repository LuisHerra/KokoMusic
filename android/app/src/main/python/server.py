import os
import sys
import threading
import logging
import re
import traceback
from flask import Flask, jsonify, request, redirect, send_from_directory, Response, make_response
import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("KokoServer")

# Ruta a la carpeta static del frontend
static_dir = os.path.join(os.path.dirname(__file__), 'static')
app = Flask(__name__, static_folder=static_dir, static_url_path='')
app.url_map.strict_slashes = False

SERVER_PORT = 3001
CLOUD_BACKEND_URL = "https://lherraa-kokomusic.hf.space/api"
is_running = False

RESERVED_STREAM_PATHS = {'status', 'prefetch', 'warm-cdn', 'cdn', 'purge-cache', 'batch', 'custom', 'recommendations', 'history', 'user-tracks'}

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

        excluded_headers = ['content-encoding', 'content-length', 'transfer-encoding', 'connection']
        headers = [(name, value) for (name, value) in resp.raw.headers.items()
                   if name.lower() not in excluded_headers]
        return Response(resp.iter_content(chunk_size=16384), resp.status_code, headers)

    except Exception as e:
        logger.error(f"[Proxy Error] fallo al conectar a {target_url}: {str(e)}")
        return jsonify({"error": f"No se pudo conectar con el servidor en la nube: {str(e)}"}), 502


# ── Media Stream Proxy Helper (Evita Bloqueo HTTP 403 por Referer) ──────────
def proxy_media_url(media_url):
    """
    Transmite los bytes del stream de YouTube/googlevideo directamente al WebView.
    Sustituye la redirección 302 para evitar que el navegador envíe Referer: 127.0.0.1 (que causa 403).
    Soporta HTTP Range Requests para seek/rebobinado.
    """
    req_headers = {
        'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive'
    }
    
    range_header = request.headers.get('Range')
    if range_header:
        req_headers['Range'] = range_header

    logger.info(f"[MediaProxy] Proxying bytes desde YouTube CDN (Range: {range_header or 'Full'})...")
    try:
        remote_resp = requests.get(media_url, headers=req_headers, stream=True, timeout=15, verify=False)
        logger.info(f"[MediaProxy] Respuesta YouTube CDN: Status {remote_resp.status_code}")
        
        response_headers = []
        for h_name in ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']:
            if h_name in remote_resp.headers:
                response_headers.append((h_name, remote_resp.headers[h_name]))

        response_headers.append(('Access-Control-Allow-Origin', '*'))
        response_headers.append(('Cache-Control', 'no-cache'))

        return Response(
            remote_resp.iter_content(chunk_size=32768),
            status=remote_resp.status_code,
            headers=response_headers
        )
    except Exception as e:
        logger.error(f"[MediaProxy Error] Fallo al proxyar stream: {str(e)}")
        return jsonify({"error": f"Error al transmitir stream de audio: {str(e)}"}), 502


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
                test_resp = requests.get(
                    cdn_url,
                    headers={
                        'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
                        'Range': 'bytes=0-1023'
                    },
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

# ── Audio Stream Route ───────────────────────────────────────────────────
@app.route('/api/stream/<track_id>', methods=['GET'])
def stream_audio(track_id):
    track_id = sanitize_track_id(track_id)
    # Si es una palabra clave reservada de la API de streaming, redirigir al cloud backend
    if track_id.lower() in RESERVED_STREAM_PATHS:
        return forward_to_cloud(f'stream/{track_id}')

    # Si es un ID de YouTube nativo, intentar extracción local rápida vía yt-dlp en el teléfono
    if is_direct_youtube_id(track_id):
        yt_id = track_id[3:] if track_id.startswith('yt_') else track_id
        logger.info(f"[Server] Extracción local de stream yt-dlp para YouTube ID: {yt_id}")
        try:
            import ytdlp_helper
            result = ytdlp_helper.get_stream_url(yt_id)
            if result.get('success') and result.get('url'):
                return proxy_media_url(result.get('url'))
        except Exception as e:
            logger.warning(f"[Server] Fallo extracción local para {yt_id}, usando fallback cloud: {str(e)}")

    # Intentar obtener stream desde la nube sin seguir redirecciones automáticas
    resp = forward_to_cloud(f'stream/{track_id}', allow_redirects=False)
    
    # Si la nube devolvió una redirección 302 a un CDN público, proxyar la media directamente
    if hasattr(resp, 'status_code') and resp.status_code in [301, 302]:
        location = resp.headers.get('Location')
        if location:
            logger.info(f"[Server] Proxyando redirección Cloud CDN para {track_id}...")
            return proxy_media_url(location)

    # Verificar si la nube falló (404, 500, o respuesta JSON sin audio)
    should_fallback_local = False
    if not hasattr(resp, 'status_code') or resp.status_code not in [200, 206, 302]:
        should_fallback_local = True

    if should_fallback_local:
        logger.info(f"[Server] Stream {track_id} no disponible en cloud (status {getattr(resp, 'status_code', 'N/A')}), intentando resolución local iTunes->YouTube...")
        try:
            import ytdlp_helper
            yt_id = track_id[3:] if track_id.startswith('yt_') else track_id
            if not is_direct_youtube_id(track_id) and track_id.isdigit():
                yt_id = ytdlp_helper.resolve_itunes_track_to_youtube(track_id)
            
            if yt_id:
                logger.info(f"[Server] Track {track_id} resuelto localmente a YouTube ID: {yt_id}")
                res = ytdlp_helper.get_stream_url(yt_id)
                if res.get('success') and res.get('url'):
                    return proxy_media_url(res.get('url'))
        except Exception as e:
            logger.error(f"[Server] Error en resolución local para {track_id}: {str(e)}")

    return resp

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
                return jsonify({
                    "trackId": track_id,
                    "youtubeId": yt_id,
                    "downloaded": False,
                    "status": "ready"
                }), 200
        except Exception:
            pass

    return resp

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
    
    # Interceptar peticiones de debug locales para evitar reenviarlas a la nube
    if api_path.startswith('debug/') or api_path.startswith('stream/debug/'):
        return jsonify({"error": f"Endpoint local de debug '/api/{api_path}' no encontrado"}), 404

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
