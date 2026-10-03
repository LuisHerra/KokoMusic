package com.kokomusic.app

import android.Manifest
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
import androidx.lifecycle.lifecycleScope
import com.kokomusic.app.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val serverUrl = "http://127.0.0.1:3001"
    private val healthUrl = "http://127.0.0.1:3001/health"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        checkPermissions()
        setupWebView()
        startKokoServerService()

        binding.btnRetry.setOnClickListener {
            binding.btnRetry.visibility = View.GONE
            binding.progressBar.visibility = View.VISIBLE
            binding.tvStatus.text = getString(R.string.server_starting_desc)
            pollServerHealth()
        }

        pollServerHealth()
    }

    private fun startKokoServerService() {
        val intent = Intent(this, KokoServerService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
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
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

            // Descargas "a mi dispositivo": un blob: del WebView no llega al gestor
            // de descargas, así que la web pide aquí que se descargue y se guarde
            // como archivo de audio (ver frontend/src/lib/deviceDownload.ts).
            addJavascriptInterface(AudioExportBridge(), "KokoAndroid")

            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    binding.loadingLayout.visibility = View.GONE
                    binding.webView.visibility = View.VISIBLE
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    Log.e("WebView", "Error cargando URL: ${error?.description}")
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest?) {
                    runOnUiThread {
                        request?.grant(request.resources)
                    }
                }

                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                    Log.d("WebViewConsole", "${consoleMessage?.message()} -- From line ${consoleMessage?.lineNumber()} of ${consoleMessage?.sourceId()}")
                    return true
                }
            }
        }
    }

    private fun pollServerHealth() {
        lifecycleScope.launch(Dispatchers.IO) {
            var attempts = 0
            var serverReady = false

            while (attempts < 20 && !serverReady) {
                attempts++
                try {
                    val connection = URL(healthUrl).openConnection() as HttpURLConnection
                    connection.connectTimeout = 1000
                    connection.readTimeout = 1000
                    connection.requestMethod = "GET"
                    val responseCode = connection.responseCode

                    if (responseCode == 200) {
                        serverReady = true
                        Log.i("MainActivity", "Servidor embebido listo en el intento $attempts")
                    }
                } catch (e: Exception) {
                    Log.d("MainActivity", "Esperando servidor... intento $attempts: ${e.message}")
                }

                if (!serverReady) {
                    delay(1000)
                }
            }

            withContext(Dispatchers.Main) {
                if (serverReady) {
                    binding.webView.loadUrl(serverUrl)
                } else {
                    binding.progressBar.visibility = View.GONE
                    binding.btnRetry.visibility = View.VISIBLE
                    binding.tvStatus.text = "No se pudo conectar con el servidor interno. Presiona reintentar."
                }
            }
        }
    }

    /** Puente expuesto a la web como `window.KokoAndroid`. */
    private inner class AudioExportBridge {
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

    override fun onBackPressed() {
        if (binding.webView.canGoBack()) {
            binding.webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) {
            val intent = Intent(this, KokoServerService::class.java)
            stopService(intent)
        }
    }
}

