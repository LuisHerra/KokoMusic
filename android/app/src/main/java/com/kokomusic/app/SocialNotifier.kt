package com.kokomusic.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * Notificaciones sociales (mensajes de amigos, invitaciones, lanzamientos...).
 *
 * El WebView no soporta Web Push ni service workers con notificaciones, por eso
 * en la APK solo aparecían en la campana. Aquí la app consulta el mismo
 * endpoint que la campana (/artist/notifications) y publica una notificación
 * Android por cada aviso nuevo sin leer:
 *  - cada 30 s mientras la app está en segundo plano con el proceso vivo
 *    (MainActivity), y
 *  - cada 15 min con WorkManager cuando el sistema ha matado el proceso.
 */
object SocialNotifier {
    const val CHANNEL_ID = "KokoSocialChannel"
    private const val PREFS = "koko_social_notifier"
    private const val WORK_NAME = "koko_social_poll"
    private const val MAX_SEEN = 300

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL_ID, "Amigos y avisos", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Mensajes de amigos, invitaciones y novedades"
            enableVibration(true)
        }
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    /** La web indica a qué backend y usuario preguntar. */
    fun configure(context: Context, apiBase: String, userId: String) {
        if (!apiBase.startsWith("https://") && !apiBase.startsWith("http://")) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val changed = prefs.getString("userId", null) != userId
        prefs.edit().apply {
            putString("apiBase", apiBase.trimEnd('/'))
            putString("userId", userId)
            // Al cambiar de cuenta no se notifica el histórico de la nueva
            if (changed) putBoolean("primed", false)
        }.apply()
        schedulePeriodic(context)
    }

    private fun schedulePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<PollWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /**
     * Consulta el backend. Con `notify = false` (app en primer plano) solo marca
     * los avisos como vistos: el usuario ya los tiene en la campana.
     */
    fun poll(context: Context, notify: Boolean) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val apiBase = prefs.getString("apiBase", null) ?: return
        val userId = prefs.getString("userId", null)?.takeIf { it.isNotBlank() } ?: return
        val items = runCatching { fetch(apiBase, userId) }
            .onFailure { Log.w("SocialNotifier", "No se pudieron leer los avisos: ${it.message}") }
            .getOrNull() ?: return

        val seen = prefs.getString("seen", "")!!.split(',').filter { it.isNotEmpty() }.toMutableList()
        val primed = prefs.getBoolean("primed", false)
        val fresh = items.filter { !it.optBoolean("isRead") && it.optString("id") !in seen }

        if (notify && primed && canPost(context)) {
            // Del más antiguo al más reciente, como llegaron
            fresh.reversed().forEach { show(context, it) }
        }
        items.forEach { val id = it.optString("id"); if (id.isNotEmpty() && id !in seen) seen.add(id) }
        prefs.edit()
            .putString("seen", seen.takeLast(MAX_SEEN).joinToString(","))
            .putBoolean("primed", true)
            .apply()
    }

    private fun fetch(apiBase: String, userId: String): List<JSONObject> {
        val url = URL("$apiBase/artist/notifications?userId=${URLEncoder.encode(userId, "UTF-8")}")
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        conn.setRequestProperty("x-user-id", userId)
        try {
            if (conn.responseCode != HttpURLConnection.HTTP_OK) return emptyList()
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val arr = JSONObject(body).optJSONArray("notifications") ?: return emptyList()
            return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
        } finally {
            conn.disconnect()
        }
    }

    private fun canPost(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun titleFor(n: JSONObject): String {
        val sender = n.optString("senderName").takeIf { it.isNotBlank() && it != "null" }
        val artist = n.optString("artistName").takeIf { it.isNotBlank() && it != "null" }
        return when {
            sender != null -> sender
            artist != null -> artist
            else -> "KokoMusic"
        }
    }

    private fun show(context: Context, n: JSONObject) {
        val id = n.optString("id")
        val message = n.optString("message").ifBlank { n.optString("trackName") }.ifBlank { "Tienes un aviso nuevo" }
        val open = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_OPEN_NOTIFICATIONS, true)
        }
        val pending = PendingIntent.getActivity(
            context, id.hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_koko)
            .setContentTitle(titleFor(n))
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        try {
            NotificationManagerCompat.from(context).notify("social", id.hashCode(), notification)
        } catch (e: SecurityException) {
            Log.w("SocialNotifier", "Sin permiso de notificaciones", e)
        }
    }

    class PollWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
        override fun doWork(): Result {
            poll(applicationContext, notify = true)
            return Result.success()
        }
    }
}
