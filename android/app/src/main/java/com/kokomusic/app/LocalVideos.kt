package com.kokomusic.app

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
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

/**
 * Vídeos guardados solo en el dispositivo (Películas/KokoMusic), no en el
 * navegador: la web los pide por el puente y los reproduce desde
 * [LOCAL_PREFIX] (ver MainActivity.shouldInterceptRequest), con soporte de
 * Range para poder avanzar/retroceder.
 */
object LocalVideos {
    const val LOCAL_PREFIX = "/__koko_local_video/"
    private const val FOLDER = "KokoMusic"

    /** Descarga `url` (mp4) a Películas/KokoMusic. Devuelve el nombre del archivo. */
    fun download(context: Context, url: String, baseName: String): String {
        val parsed = Uri.parse(url)
        require(parsed.scheme == "http" || parsed.scheme == "https") { "URL de vídeo no válida" }
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 20_000
        connection.readTimeout = 120_000
        connection.instanceFollowRedirects = true
        try {
            val code = connection.responseCode
            if (code != HttpURLConnection.HTTP_OK) throw IllegalStateException("Error al descargar el vídeo: $code")
            val type = connection.contentType?.substringBefore(';')?.trim()?.lowercase() ?: ""
            if (!type.startsWith("video/") && type != "application/octet-stream") {
                throw IllegalStateException("No se pudo obtener el vídeo de esta canción")
            }
            val safe = baseName.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "").trim().take(120).ifEmpty { "KokoMusic" }
            val fileName = "$safe.mp4"
            connection.inputStream.use { input ->
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
            return fileName
        } finally {
            connection.disconnect()
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
