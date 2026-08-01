package com.kokomusic.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
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

