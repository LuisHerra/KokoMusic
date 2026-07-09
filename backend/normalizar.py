import json
import ijson  # pip install ijson
from datetime import datetime
import argparse
import sys
import urllib.request
import urllib.error

# --- Configuración por defecto ---
DEFAULT_INPUT_FILE = "spotify_history.json"
DEFAULT_OUTPUT_FILE = "spotify_history_clean.jsonl"
DEFAULT_API_URL = "http://localhost:3001"

MIN_MS_PLAYED = 5000  # descartamos reproducciones de menos de 5 segundos (ruido)


def clean_record(record: dict) -> dict | None:
    # Descartamos podcasts (nos quedamos solo con música)
    if record.get("spotify_track_uri") is None:
        return None

    ms_played = record.get("ms_played") or 0
    if ms_played < MIN_MS_PLAYED:
        return None

    cleaned = {
        "ts": record.get("ts"),
        "track_name": record.get("master_metadata_track_name"),
        "artist_name": record.get("master_metadata_album_artist_name"),
        "album_name": record.get("master_metadata_album_album_name"),
        "track_uri": record.get("spotify_track_uri"),
        "ms_played": ms_played,
        "reason_start": record.get("reason_start"),
        "reason_end": record.get("reason_end"),
        "shuffle": record.get("shuffle"),
        "skipped": record.get("skipped"),
    }

    try:
        # Intentar parsear el timestamp de Spotify (por ejemplo "2026-07-09T11:03:16Z" o "2026-07-09 11:03:16")
        ts_str = cleaned["ts"]
        if "T" in ts_str:
            dt = datetime.strptime(ts_str.replace("Z", ""), "%Y-%m-%dT%H:%M:%S")
        else:
            dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
        cleaned["hour_of_day"] = dt.hour
        cleaned["day_of_week"] = dt.weekday()  # 0 = lunes
    except (ValueError, TypeError):
        cleaned["hour_of_day"] = None
        cleaned["day_of_week"] = None

    return cleaned


def clean_dataset_streaming(input_path: str, output_path: str):
    """Procesa el JSON en streaming (item a item) para no cargar
    todo el archivo en memoria. Escribe en formato JSONL."""
    total = 0
    kept = 0

    print(f"Iniciando limpieza: {input_path} -> {output_path}")

    try:
        with open(input_path, "r", encoding="utf-8") as f_in, \
             open(output_path, "w", encoding="utf-8") as f_out:

            # ijson.items recorre el array raíz elemento por elemento
            for record in ijson.items(f_in, "item"):
                total += 1
                cleaned = clean_record(record)
                if cleaned:
                    f_out.write(json.dumps(cleaned, ensure_ascii=False) + "\n")
                    kept += 1
                if total % 10000 == 0:
                    print(f"Procesados: {total} filas...")

        print(f"\n--- Limpieza Completada ---")
        print(f"Total procesados: {total}")
        print(f"Total conservados (útiles): {kept}")
        print(f"Guardado en: {output_path}")
        return True
    except FileNotFoundError:
        print(f"Error: No se pudo encontrar el archivo de entrada '{input_path}'")
        return False
    except Exception as e:
        print(f"Error inesperado al limpiar el historial: {e}")
        return False


def upload_to_kokomusic(jsonl_path: str, api_url: str, user_id: str, batch_size: int = 1000):
    """Sube el archivo limpio .jsonl al backend de KokoMusic en lotes.
    Usa la librería estándar de Python (urllib) para no requerir dependencias externas."""
    print(f"\nSubiendo {jsonl_path} a {api_url} para el usuario '{user_id}' en lotes de {batch_size}...")

    # Cargar registros desde JSONL
    records = []
    try:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
    except FileNotFoundError:
        print(f"Error: No se encontró el archivo limpio '{jsonl_path}'. Por favor, límpialo primero.")
        return

    total_records = len(records)
    if total_records == 0:
        print("No hay registros limpios para subir.")
        return

    # Endpoint URL
    url = f"{api_url.rstrip('/')}/api/import/spotify-history"
    headers = {
        "Content-Type": "application/json",
        "x-user-id": user_id
    }

    successful_plays = 0
    unique_tracks = 0
    tracks_resolved = 0
    batches_count = (total_records + batch_size - 1) // batch_size

    for idx, i in enumerate(range(0, total_records, batch_size)):
        batch = records[i : i + batch_size]
        payload = json.dumps({"history": batch}).encode("utf-8")
        
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                if res_data.get("success"):
                    successful_plays += res_data.get("totalPlaysImported", 0)
                    unique_tracks += res_data.get("uniqueTracksImported", 0)
                    tracks_resolved += res_data.get("tracksResolved", 0)
                    print(f"Lote {idx + 1}/{batches_count} subido: +{len(batch)} items")
                else:
                    print(f"Lote {idx + 1}/{batches_count} falló: {res_data.get('error', 'Desconocido')}")
        except urllib.error.HTTPError as e:
            print(f"HTTP Error en lote {idx + 1}: {e.code} - {e.reason}")
            try:
                error_body = e.read().decode("utf-8")
                print(f"Detalle del servidor: {error_body}")
            except Exception:
                pass
        except Exception as e:
            print(f"Error subiendo lote {idx + 1}: {e}")

    print("\n--- Resumen de Subida ---")
    print(f"Total registros subidos: {total_records}")
    print(f"Total reproducciones importadas: {successful_plays}")
    print(f"Total tracks únicos guardados: {unique_tracks}")
    print(f"Total tracks resueltos (iTunes): {tracks_resolved}")


def upload_to_huggingface(jsonl_path: str, repo_id: str, token: str = None):
    """Sube el .jsonl como dataset a tu repo de Hugging Face.
    Requiere: pip install datasets huggingface_hub
    """
    try:
        from huggingface_hub import HfApi
        api = HfApi(token=token)
        api.upload_file(
            path_or_fileobj=jsonl_path,
            path_in_repo=jsonl_path.split("/")[-1],
            repo_id=repo_id,
            repo_type="dataset",
        )
        print(f"Subido con éxito a Hugging Face: https://huggingface.co/datasets/{repo_id}")
    except ImportError:
        print("Error: Se requiere 'huggingface_hub' instalado para subir a Hugging Face.")
        print("Ejecuta: pip install huggingface_hub")
    except Exception as e:
        print(f"Error al subir a Hugging Face: {e}")


def main():
    parser = argparse.ArgumentParser(description="Limpiador e importador del historial de Spotify para KokoMusic.")
    parser.add_argument("-i", "--input", default=DEFAULT_INPUT_FILE, help="Archivo JSON raw de Spotify")
    parser.add_argument("-o", "--output", default=DEFAULT_OUTPUT_FILE, help="Archivo JSONL limpio de salida")
    parser.add_argument("-u", "--upload", action="store_true", help="Dispara la subida al servidor al finalizar")
    parser.add_argument("--url", default=DEFAULT_API_URL, help=f"URL del servidor backend (default: {DEFAULT_API_URL})")
    parser.add_argument("--user-id", help="UUID de usuario de KokoMusic para subir el historial")
    parser.add_argument("--huggingface", help="Repo ID de Hugging Face para subir (ej: usuario/dataset)")
    parser.add_argument("--hf-token", help="Token de Hugging Face (opcional)")
    parser.add_argument("--batch-size", type=int, default=1000, help="Tamaño de lote para la subida (default: 1000)")

    args = parser.parse_args()

    # 1. Limpieza
    success = clean_dataset_streaming(args.input, args.output)
    if not success:
        sys.exit(1)

    # 2. Subida a KokoMusic
    if args.upload:
        if not args.user_id:
            print("Error: Se requiere '--user-id' para subir el historial al backend.")
            sys.exit(1)
        upload_to_kokomusic(args.output, args.url, args.user_id, args.batch_size)

    # 3. Subida a HuggingFace
    if args.huggingface:
        upload_to_huggingface(args.output, args.huggingface, args.hf_token)


if __name__ == "__main__":
    main()