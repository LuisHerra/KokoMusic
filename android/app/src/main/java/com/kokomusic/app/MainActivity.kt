package com.kokomusic.app

import android.Manifest
import android.content.ComponentName
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.view.View
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import com.kokomusic.app.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * La APK es un WebView fino sobre la web publicada: sin Chrome (sin pestañas,
 * sin su proceso de navegador) y sin el servidor Python que llevaban las
 * versiones anteriores. Las actualizaciones de la web llegan sin reinstalar.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val APP_URL = "https://kokoworks.es/kokoMusic/"
        private const val APP_HOST = "kokoworks.es"
        // Acentos con icono propio (activity-alias .Icon<Acento> del manifiesto)
        private val ICON_ACCENTS = listOf("green", "cyan", "magenta", "purple", "amber", "crimson", "gold")
        private const val DEFAULT_ICON_ACCENT = "green"
    }

    private lateinit var binding: ActivityMainBinding
    /** Lo que la web dice que está sonando (ver updatePlayback). */
    @Volatile private var isPlaying = false
    private var webViewPaused = false
    /** Icono pedido por la web; se aplica al salir de la app (ver applyPendingAppIcon). */
    @Volatile private var pendingIconAccent: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        checkPermissions()
        setupWebView()

        PlaybackService.onAction = { action ->
            runOnUiThread {
                resumeWebView()
                binding.webView.evaluateJavascript(
                    "window.__kokoMediaAction && window.__kokoMediaAction(${JSONObject.quote(action)})", null
                )
            }
        }

        binding.btnRetry.setOnClickListener { loadApp() }
        loadApp()
    }

    private fun loadApp() {
        binding.btnRetry.visibility = View.GONE
        binding.progressBar.visibility = View.VISIBLE
        binding.tvStatus.text = getString(R.string.loading_desc)
        binding.loadingLayout.visibility = View.VISIBLE
        binding.webView.loadUrl(APP_URL)
    }

    private fun checkPermissions() {
        val permissionsToRequest = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.RECORD_AUDIO)
        }
        // Hasta Android 9 guardar en Música/ (descargas al dispositivo) necesita este permiso; desde Android 10 va por MediaStore sin permisos.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
        if (permissionsToRequest.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissionsToRequest.toTypedArray(), 101)
        }
    }

    private fun setupWebView() {
        binding.webView.apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.userAgentString = "${settings.userAgentString} KokoMusicAndroid"

            // window.KokoAndroid: descargas a Música y estado de la reproducción
            // (ver frontend/src/lib/androidApp.ts).
            addJavascriptInterface(KokoBridge(), "KokoAndroid")

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    // mailto:, tel:, intent:… a la app del sistema que toque.
                    if (uri.scheme != "http" && uri.scheme != "https") {
                        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                        return true
                    }
                    return false
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    if (binding.btnRetry.visibility == View.VISIBLE) return
                    binding.loadingLayout.visibility = View.GONE
                    binding.webView.visibility = View.VISIBLE
                }

                override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                    Log.e("WebView", "Error cargando ${request?.url}: ${error?.description}")
                    if (request?.isForMainFrame != true) return
                    binding.webView.visibility = View.GONE
                    binding.loadingLayout.visibility = View.VISIBLE
                    binding.progressBar.visibility = View.GONE
                    binding.tvStatus.text = getString(R.string.offline_desc)
                    binding.btnRetry.visibility = View.VISIBLE
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest?) {
                    // Micrófono (voz, Eureka) solo para la propia web de KokoMusic.
                    runOnUiThread {
                        if (request?.origin?.host?.endsWith(APP_HOST) == true) request.grant(request.resources)
                        else request?.deny()
                    }
                }
            }
        }
    }

    /**
     * Con la app en segundo plano y la música parada, se detiene todo el
     * JavaScript del WebView (temporizadores, sondeos, animaciones): es lo que
     * más batería gastaba sin aportar nada. Mientras suena sigue vivo, porque
     * la web decide la siguiente canción.
     */
    private fun pauseWebViewIfIdle() {
        if (isPlaying || webViewPaused) return
        binding.webView.onPause()
        binding.webView.pauseTimers()
        webViewPaused = true
    }

    private fun resumeWebView() {
        if (!webViewPaused) return
        binding.webView.resumeTimers()
        binding.webView.onResume()
        webViewPaused = false
    }

    override fun onResume() {
        super.onResume()
        resumeWebView()
    }

    override fun onStop() {
        super.onStop()
        applyPendingAppIcon()
        pauseWebViewIfIdle()
    }

    /**
     * El icono del lanzador sigue al acento de la app, como el logo y el acceso
     * directo de la web. Android no deja pintar el icono: se activa el
     * activity-alias de ese acento. Se hace al salir porque algunos lanzadores
     * cierran la app al cambiarlo.
     */
    private fun applyPendingAppIcon() {
        val accent = pendingIconAccent ?: return
        pendingIconAccent = null
        val pm = packageManager
        for (key in ICON_ACCENTS) {
            val component = ComponentName(packageName, "com.kokomusic.app.Icon${key.replaceFirstChar { it.uppercase() }}")
            val current = pm.getComponentEnabledSetting(component)
            val enabledNow = current == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ||
                (current == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && key == DEFAULT_ICON_ACCENT)
            if (enabledNow == (key == accent)) continue
            pm.setComponentEnabledSetting(
                component,
                if (key == accent) PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP
            )
        }
    }

    /** Puente expuesto a la web como `window.KokoAndroid`. */
    private inner class KokoBridge {
        @JavascriptInterface
        fun updatePlayback(json: String) {
            val state = runCatching {
                if (json == "null") null else JSONObject(json).let {
                    PlaybackService.State(
                        title = it.optString("title"),
                        artist = it.optString("artist"),
                        cover = it.optString("cover").takeIf { c -> c.isNotBlank() && c != "null" },
                        isPlaying = it.optBoolean("isPlaying"),
                        positionMs = (it.optDouble("positionS", 0.0) * 1000).toLong(),
                        durationMs = (it.optDouble("durationS", 0.0) * 1000).toLong(),
                    )
                }
            }.getOrNull()
            isPlaying = state?.isPlaying == true
            PlaybackService.update(applicationContext, state)
            // Se ha parado con la app ya en segundo plano (p. ej. desde la notificación)
            if (!isPlaying) runOnUiThread {
                if (!lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) pauseWebViewIfIdle()
            }
        }

        @JavascriptInterface
        fun setAppIcon(accent: String) {
            if (accent in ICON_ACCENTS) pendingIconAccent = accent
        }

        @JavascriptInterface
        fun saveAudioToMusic(requestId: String, url: String, baseName: String) {
            lifecycleScope.launch(Dispatchers.IO) {
                val result = runCatching { downloadToMusic(url, baseName) }
                result.exceptionOrNull()?.let { Log.e("AudioExport", "No se pudo guardar $url", it) }
                val ok = result.isSuccess
                val message = result.getOrElse { it.message ?: "No se pudo guardar el audio" }
                withContext(Dispatchers.Main) {
                    binding.webView.evaluateJavascript(
                        "window.__kokoAudioSaved && window.__kokoAudioSaved(" +
                            "${JSONObject.quote(requestId)}, $ok, ${JSONObject.quote(message)})",
                        null
                    )
                }
            }
        }
    }

    /** Descarga `url` y la guarda en Música/KokoMusic. Devuelve el nombre del archivo creado. */
    private fun downloadToMusic(url: String, baseName: String): String {
        val parsed = Uri.parse(url)
        require(parsed.scheme == "http" || parsed.scheme == "https") { "URL de audio no válida" }

        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 60_000
        connection.instanceFollowRedirects = true
        try {
            val code = connection.responseCode
            if (code != HttpURLConnection.HTTP_OK && code != HttpURLConnection.HTTP_PARTIAL) {
                throw IllegalStateException("Error al descargar el audio: $code")
            }
            val rawType = connection.contentType?.substringBefore(';')?.trim()?.lowercase() ?: ""
            if (rawType.contains("json") || rawType.startsWith("text/")) {
                throw IllegalStateException("No se pudo obtener el archivo de audio para esta canción")
            }
            // La colección de audio de MediaStore solo acepta audio/*: un "video/mp4" de solo audio es un m4a.
            val mime = when {
                rawType.startsWith("audio/") -> rawType
                rawType == "video/webm" -> "audio/webm"
                else -> "audio/mp4"
            }
            val ext = when (mime) {
                "audio/mpeg", "audio/mp3" -> "mp3"
                "audio/webm" -> "webm"
                "audio/ogg" -> "ogg"
                "audio/opus" -> "opus"
                "audio/aac" -> "aac"
                "audio/wav" -> "wav"
                else -> "m4a"
            }
            val safeName = baseName.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "").trim().take(120).ifEmpty { "KokoMusic" }
            val fileName = "$safeName.$ext"

            connection.inputStream.use { input ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = ContentValues().apply {
                        put(MediaStore.Audio.Media.DISPLAY_NAME, fileName)
                        put(MediaStore.Audio.Media.MIME_TYPE, mime)
                        put(MediaStore.Audio.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MUSIC}/KokoMusic")
                        put(MediaStore.Audio.Media.IS_PENDING, 1)
                    }
                    val resolver = contentResolver
                    val item = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values)
                        ?: throw IllegalStateException("No se pudo crear el archivo en Música")
                    try {
                        resolver.openOutputStream(item)?.use { output -> input.copyTo(output) }
                            ?: throw IllegalStateException("No se pudo escribir el archivo en Música")
                        values.clear()
                        values.put(MediaStore.Audio.Media.IS_PENDING, 0)
                        resolver.update(item, values, null, null)
                    } catch (e: Exception) {
                        resolver.delete(item, null, null)
                        throw e
                    }
                } else {
                    if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        throw IllegalStateException("Permite el acceso al almacenamiento en los ajustes de la app")
                    }
                    @Suppress("DEPRECATION")
                    val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC), "KokoMusic")
                    if (!dir.exists() && !dir.mkdirs()) throw IllegalStateException("No se pudo crear la carpeta Música/KokoMusic")
                    var target = File(dir, fileName)
                    var n = 1
                    while (target.exists()) {
                        target = File(dir, "$safeName ($n).$ext")
                        n++
                    }
                    target.outputStream().use { output -> input.copyTo(output) }
                    // Para que aparezca en los reproductores de música sin reiniciar.
                    MediaScannerConnection.scanFile(this, arrayOf(target.absolutePath), arrayOf(mime), null)
                }
            }
            return fileName
        } finally {
            connection.disconnect()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (binding.webView.canGoBack()) {
            binding.webView.goBack()
        } else {
            // Como cualquier reproductor: atrás manda la app al fondo sin cortar la música.
            moveTaskToBack(true)
        }
    }

    override fun onDestroy() {
        PlaybackService.onAction = null
        if (isFinishing) PlaybackService.update(applicationContext, null)
        binding.webView.destroy()
        super.onDestroy()
    }
}
