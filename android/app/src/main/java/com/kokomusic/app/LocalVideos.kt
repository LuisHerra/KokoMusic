package com.kokomusic.app

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.WebResourceResponse
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer

/**
 * Vídeos guardados solo en el dispositivo (Películas/KokoMusic), no en el
 * navegador: la web los pide por el puente y los reproduce desde
 * [LOCAL_PREFIX] (ver MainActivity.shouldInterceptRequest), con soporte de
 * Range para poder avanzar/retroceder.
 */
object LocalVideos {
    const val LOCAL_PREFIX = "/__koko_local_video/"
    private const val FOLDER = "KokoMusic"

    /**
     * Descarga a Películas/KokoMusic. `source` es `yt:<videoId>`: el vídeo se
     * extrae en el móvil (YouTubeVideoResolver), se bajan por separado la pista
     * de vídeo y la de audio y se unen en un mp4 con MediaMuxer.
     * También acepta una URL http(s) directa de un mp4 (APKs/webs antiguas).
     * Devuelve el nombre del archivo.
     */
    fun download(context: Context, source: String, baseName: String): String {
        val safe = baseName.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "").trim().take(120).ifEmpty { "KokoMusic" }
        val fileName = "$safe.mp4"
        val work = File(context.cacheDir, "video_${System.currentTimeMillis()}").apply { mkdirs() }
        try {
            val result = File(work, "out.mp4")
            if (source.startsWith("yt:")) {
                val streams = YouTubeVideoResolver.resolveStreams(source.removePrefix("yt:"))
                val videoFile = File(work, "video.mp4")
                val audioFile = File(work, "audio.m4a")
                downloadChunked(streams.videoUrl, videoFile)
                downloadChunked(streams.audioUrl, audioFile)
                mux(videoFile, audioFile, result)
            } else {
                val parsed = Uri.parse(source)
                require(parsed.scheme == "http" || parsed.scheme == "https") { "URL de vídeo no válida" }
                downloadChunked(source, result)
            }
            if (result.length() == 0L) throw IllegalStateException("No se pudo obtener el vídeo de esta canción")
            FileInputStream(result).use { saveToMovies(context, it, fileName, safe) }
            return fileName
        } finally {
            work.deleteRecursively()
        }
    }

    /**
     * Descarga por trozos con Range: YouTube limita mucho la velocidad de las
     * descargas de un solo golpe y corta las conexiones largas.
     */
    private fun downloadChunked(url: String, out: File) {
        val chunk = 4L * 1024 * 1024
        var pos = 0L
        var total = -1L
        out.outputStream().use { output ->
            while (total < 0 || pos < total) {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 20_000
                conn.readTimeout = 60_000
                conn.instanceFollowRedirects = true
                conn.setRequestProperty("Range", "bytes=$pos-${pos + chunk - 1}")
                try {
                    val code = conn.responseCode
                    if (code != HttpURLConnection.HTTP_PARTIAL && code != HttpURLConnection.HTTP_OK) {
                        throw IllegalStateException("Error al descargar el vídeo: $code")
                    }
                    val type = conn.contentType?.lowercase() ?: ""
                    if (type.contains("json") || type.startsWith("text/")) {
                        throw IllegalStateException("No se pudo obtener el vídeo de esta canción")
                    }
                    if (code == HttpURLConnection.HTTP_OK) {
                        // El servidor ignoró el Range: viene el archivo entero
                        conn.inputStream.use { it.copyTo(output) }
                        return
                    }
                    total = conn.getHeaderField("Content-Range")?.substringAfter('/')?.toLongOrNull() ?: Long.MAX_VALUE
                    val read = conn.inputStream.use { it.copyTo(output) }
                    if (read <= 0L) break
                    pos += read
                } finally {
                    conn.disconnect()
                }
            }
        }
    }

    /** Une la pista de vídeo (mp4) y la de audio (m4a) en un único mp4. */
    private fun mux(videoFile: File, audioFile: File, out: File) {
        val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val videoEx = MediaExtractor().apply { setDataSource(videoFile.absolutePath) }
        val audioEx = MediaExtractor().apply { setDataSource(audioFile.absolutePath) }
        try {
            val vTrack = (0 until videoEx.trackCount).firstOrNull {
                videoEx.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
            } ?: throw IllegalStateException("El vídeo descargado no es válido")
            val aTrack = (0 until audioEx.trackCount).firstOrNull {
                audioEx.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: throw IllegalStateException("El audio descargado no es válido")
            videoEx.selectTrack(vTrack)
            audioEx.selectTrack(aTrack)
            val outV = muxer.addTrack(videoEx.getTrackFormat(vTrack))
            val outA = muxer.addTrack(audioEx.getTrackFormat(aTrack))
            muxer.start()
            val buffer = ByteBuffer.allocate(2 * 1024 * 1024)
            val info = MediaCodec.BufferInfo()
            for ((ex, outTrack) in listOf(videoEx to outV, audioEx to outA)) {
                while (true) {
                    info.offset = 0
                    info.size = ex.readSampleData(buffer, 0)
                    if (info.size < 0) break
                    info.presentationTimeUs = ex.sampleTime
                    info.flags = if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
                    muxer.writeSampleData(outTrack, buffer, info)
                    ex.advance()
                }
            }
            muxer.stop()
        } finally {
            runCatching { muxer.release() }
            videoEx.release()
            audioEx.release()
        }
    }

    /** Guarda el mp4 en Películas/KokoMusic (MediaStore en Android 10+). */
    private fun saveToMovies(context: Context, input: InputStream, fileName: String, safe: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, fileName)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/$FOLDER")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val item = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("No se pudo crear el archivo en Películas")
            try {
                resolver.openOutputStream(item)?.use { out -> input.copyTo(out) }
                    ?: throw IllegalStateException("No se pudo escribir el vídeo")
                values.clear()
                values.put(MediaStore.Video.Media.IS_PENDING, 0)
                resolver.update(item, values, null, null)
            } catch (e: Exception) {
                resolver.delete(item, null, null)
                throw e
            }
        } else {
            val dir = legacyDir()
            if (!dir.exists() && !dir.mkdirs()) throw IllegalStateException("No se pudo crear Películas/KokoMusic")
            var target = File(dir, fileName)
            var n = 1
            while (target.exists()) { target = File(dir, "$safe ($n).mp4"); n++ }
            target.outputStream().use { out -> input.copyTo(out) }
            MediaScannerConnection.scanFile(context, arrayOf(target.absolutePath), arrayOf("video/mp4"), null)
        }
    }

    @Suppress("DEPRECATION")
    private fun legacyDir() = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), FOLDER)

    /** JSON: [{id, name, size, durationMs, addedAt}] de los vídeos de la carpeta. */
    fun list(context: Context): String {
        val out = JSONArray()
        val projection = arrayOf(
            MediaStore.Video.Media._ID, MediaStore.Video.Media.DISPLAY_NAME, MediaStore.Video.Media.SIZE,
            MediaStore.Video.Media.DURATION, MediaStore.Video.Media.DATE_ADDED,
        )
        val (selection, args) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            "${MediaStore.Video.Media.RELATIVE_PATH} LIKE ?" to arrayOf("${Environment.DIRECTORY_MOVIES}/$FOLDER%")
        } else {
            @Suppress("DEPRECATION")
            "${MediaStore.Video.Media.DATA} LIKE ?" to arrayOf("${legacyDir().absolutePath}%")
        }
        context.contentResolver.query(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI, projection, selection, args,
            "${MediaStore.Video.Media.DATE_ADDED} DESC"
        )?.use { c ->
            while (c.moveToNext()) {
                out.put(JSONObject().apply {
                    put("id", c.getLong(0))
                    put("name", c.getString(1)?.removeSuffix(".mp4") ?: "Vídeo")
                    put("size", c.getLong(2))
                    put("durationMs", c.getLong(3))
                    put("addedAt", c.getLong(4) * 1000)
                })
            }
        }
        return out.toString()
    }

    fun delete(context: Context, id: Long): Boolean = runCatching {
        context.contentResolver.delete(ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id), null, null) > 0
    }.getOrDefault(false)

    /** Respuesta para el <video> de la web, con Range (206) para poder saltar. */
    fun response(context: Context, id: Long, rangeHeader: String?): WebResourceResponse? {
        val uri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id)
        val fd = runCatching { context.contentResolver.openFileDescriptor(uri, "r") }.getOrNull() ?: return null
        val total = fd.statSize
        val stream: InputStream = FileInputStream(fd.fileDescriptor)
        val headers = mutableMapOf("Accept-Ranges" to "bytes", "Access-Control-Allow-Origin" to "*")
        val match = rangeHeader?.let { Regex("bytes=(\\d*)-(\\d*)").find(it) }
        if (match == null || total <= 0) {
            if (total > 0) headers["Content-Length"] = total.toString()
            return WebResourceResponse("video/mp4", null, 200, "OK", headers, stream)
        }
        val start = match.groupValues[1].toLongOrNull() ?: 0L
        val end = (match.groupValues[2].toLongOrNull() ?: (total - 1)).coerceAtMost(total - 1)
        if (start >= total || start > end) {
            stream.close()
            return WebResourceResponse("video/mp4", null, 416, "Range Not Satisfiable",
                headers + ("Content-Range" to "bytes */$total"), null)
        }
        stream.skip(start)
        val length = end - start + 1
        headers["Content-Range"] = "bytes $start-$end/$total"
        headers["Content-Length"] = length.toString()
        return WebResourceResponse("video/mp4", null, 206, "Partial Content", headers, BoundedStream(stream, length))
    }

    private class BoundedStream(private val inner: InputStream, private var remaining: Long) : InputStream() {
        override fun read(): Int {
            if (remaining <= 0) return -1
            val b = inner.read()
            if (b >= 0) remaining--
            return b
        }
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (remaining <= 0) return -1
            val n = inner.read(b, off, minOf(len.toLong(), remaining).toInt())
            if (n > 0) remaining -= n
            return n
        }
        override fun close() = inner.close()
    }
}
