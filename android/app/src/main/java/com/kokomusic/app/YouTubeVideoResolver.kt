package com.kokomusic.app

import org.schabi.newpipe.extractor.MediaFormat
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.net.HttpURLConnection
import java.net.URL

/**
 * Obtiene en el propio móvil las URLs del videoclip de YouTube. Desde los
 * servidores de KokoMusic (Render) YouTube bloquea la descarga; desde la
 * conexión del usuario no. Usa NewPipeExtractor.
 *
 * YouTube ya no ofrece vídeo y audio juntos: se devuelven por separado
 * (vídeo H.264 en mp4 hasta 720p + audio AAC en m4a) y LocalVideos los une.
 */
object YouTubeVideoResolver {
    private const val MAX_HEIGHT = 720
    @Volatile private var initialized = false

    data class Streams(val videoUrl: String, val audioUrl: String, val height: Int)

    private fun ensureInit() {
        if (initialized) return
        synchronized(this) {
            if (!initialized) {
                NewPipe.init(SimpleDownloader)
                initialized = true
            }
        }
    }

    fun resolveStreams(videoId: String): Streams {
        require(Regex("^[A-Za-z0-9_-]{11}$").matches(videoId)) { "Vídeo no válido" }
        ensureInit()
        val info = StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$videoId")

        // H.264 (avc1) en mp4: lo que MediaMuxer sabe meter en un mp4 y reproduce cualquier móvil
        val video = info.videoOnlyStreams
            .filter { it.isUrl && it.format == MediaFormat.MPEG_4 && it.codec?.startsWith("avc1") == true }
            .map { it to height(it.resolution) }
            .filter { it.second in 1..MAX_HEIGHT }
            .maxByOrNull { it.second }
            ?: throw IllegalStateException("Este vídeo no tiene una versión descargable")

        val audio = info.audioStreams
            .filter { it.isUrl && it.format == MediaFormat.M4A }
            .maxByOrNull { it.averageBitrate }
            ?: throw IllegalStateException("Este vídeo no tiene audio descargable")

        return Streams(video.first.content, audio.content, video.second)
    }

    private fun height(resolution: String?): Int = resolution?.takeWhile { it.isDigit() }?.toIntOrNull() ?: 0

    /** Cliente HTTP mínimo que pide NewPipeExtractor. */
    private object SimpleDownloader : Downloader() {
        private const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"

        override fun execute(request: Request): Response {
            val conn = URL(request.url()).openConnection() as HttpURLConnection
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.requestMethod = request.httpMethod()
            conn.setRequestProperty("User-Agent", UA)
            request.headers().forEach { (name, values) ->
                values.forEach { conn.addRequestProperty(name, it) }
            }
            request.dataToSend()?.let { body ->
                conn.doOutput = true
                conn.outputStream.use { it.write(body) }
            }
            try {
                val code = conn.responseCode
                if (code == 429) throw ReCaptchaException("YouTube pide verificación", request.url())
                val stream = if (code >= 400) conn.errorStream else conn.inputStream
                val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
                val headers = conn.headerFields.filterKeys { it != null }
                return Response(code, conn.responseMessage, headers, body, conn.url.toString())
            } finally {
                conn.disconnect()
            }
        }
    }
}
