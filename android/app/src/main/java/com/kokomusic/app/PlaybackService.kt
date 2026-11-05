package com.kokomusic.app

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.session.MediaButtonReceiver
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Notificación multimedia + pantalla de bloqueo + botones de auriculares.
 *
 * El audio lo reproduce la web dentro del WebView; este servicio solo existe
 * mientras hay algo que controlar y solo es "foreground" (lo que impide que
 * Android congele la app) mientras suena. En pausa se suelta y, pasado un
 * rato, se cierra: nada queda gastando batería con la música parada.
 * La versión anterior mantenía un servidor Python permanente.
 */
class PlaybackService : Service() {

    data class State(
        val title: String,
        val artist: String,
        val cover: String?,
        val isPlaying: Boolean,
        val positionMs: Long,
        val durationMs: Long,
    )

    companion object {
        private const val TAG = "PlaybackService"
        private const val NOTIFICATION_ID = 1001
        private const val ACTION_UPDATE = "com.kokomusic.app.UPDATE"
        private const val ACTION_STOP = "com.kokomusic.app.STOP"
        // En pausa, la notificación se queda este tiempo para poder reanudar.
        private const val IDLE_STOP_MS = 10 * 60 * 1000L

        @Volatile private var running = false
        @Volatile private var pending: State? = null

        /** MainActivity lo asigna: reenvía "play", "pause", "next", "prev" o "seek:<s>" a la web. */
        @Volatile var onAction: ((String) -> Unit)? = null

        fun update(context: Context, state: State?) {
            if (state == null) {
                if (running) context.startService(Intent(context, PlaybackService::class.java).setAction(ACTION_STOP))
                return
            }
            // Arrancarlo en pausa no aporta nada (y desde segundo plano Android no lo permite).
            if (!running && !state.isPlaying) return
            pending = state
            val intent = Intent(context, PlaybackService::class.java).setAction(ACTION_UPDATE)
            try {
                if (state.isPlaying) ContextCompat.startForegroundService(context, intent)
                else context.startService(intent)
            } catch (e: Exception) {
                Log.w(TAG, "No se pudo actualizar el servicio de reproducción", e)
            }
        }
    }

    private lateinit var session: MediaSessionCompat
    private val handler = Handler(Looper.getMainLooper())
    private val artworkLoader = Executors.newSingleThreadExecutor()
    private var state: State? = null
    private var artworkUrl: String? = null
    private var artwork: Bitmap? = null
    private val stopWhenIdle = Runnable { stopSelf() }

    override fun onCreate() {
        super.onCreate()
        running = true
        session = MediaSessionCompat(this, "KokoMusic").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = send("play")
                override fun onPause() = send("pause")
                override fun onSkipToNext() = send("next")
                override fun onSkipToPrevious() = send("prev")
                // Notificación descartada (solo se puede en pausa): cerrar del todo.
                override fun onStop() = stopSelf()
                override fun onSeekTo(pos: Long) = send("seek:${pos / 1000.0}")
            })
            setSessionActivity(openAppIntent())
            isActive = true
        }
    }

    private fun send(action: String) {
        onAction?.invoke(action) ?: Log.w(TAG, "Acción $action sin la app abierta")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_UPDATE -> pending?.let { apply(it) }
            // Botones de la notificación, auriculares y Bluetooth
            else -> {
                if (state == null) {
                    // Arrancado por un botón de auriculares sin nada que controlar:
                    // Android exige startForeground igualmente antes de cerrarlo.
                    startForegroundCompat(
                        NotificationCompat.Builder(this, KokoApp.CHANNEL_ID)
                            .setSmallIcon(R.drawable.ic_launcher_foreground)
                            .setContentTitle(getString(R.string.app_name))
                            .setSilent(true)
                            .build()
                    )
                    stopSelf()
                    return START_NOT_STICKY
                }
                MediaButtonReceiver.handleIntent(session, intent)
            }
        }
        // Si Android lo mata, no tiene sentido revivirlo sin la web que suena.
        return START_NOT_STICKY
    }

    private fun apply(newState: State) {
        state = newState
        session.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, newState.title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, newState.artist)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, newState.durationMs)
                .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork.takeIf { artworkUrl == newState.cover })
                .build()
        )
        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
                        PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or PlaybackStateCompat.ACTION_SEEK_TO
                )
                // Con posición + velocidad, Android avanza la barra solo: la web no
                // tiene que mandar la posición cada segundo.
                .setState(
                    if (newState.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                    newState.positionMs,
                    if (newState.isPlaying) 1f else 0f,
                    SystemClock.elapsedRealtime()
                )
                .build()
        )

        val notification = buildNotification(newState)
        handler.removeCallbacks(stopWhenIdle)
        if (newState.isPlaying) {
            startForegroundCompat(notification)
        } else {
            // Deja de ser foreground (Android puede congelar la app) pero la
            // notificación se queda para reanudar.
            stopForeground(STOP_FOREGROUND_DETACH)
            getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification)
            handler.postDelayed(stopWhenIdle, IDLE_STOP_MS)
        }

        if (newState.cover != artworkUrl) loadArtwork(newState.cover)
    }

    private fun buildNotification(s: State): Notification {
        val playPause = if (s.isPlaying) {
            NotificationCompat.Action(android.R.drawable.ic_media_pause, "Pausa",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PAUSE))
        } else {
            NotificationCompat.Action(android.R.drawable.ic_media_play, "Reproducir",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PLAY))
        }
        return NotificationCompat.Builder(this, KokoApp.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(s.title)
            .setContentText(s.artist)
            .setLargeIcon(artwork.takeIf { artworkUrl == s.cover })
            .setContentIntent(openAppIntent())
            .setDeleteIntent(MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_STOP))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setOngoing(s.isPlaying)
            .addAction(android.R.drawable.ic_media_previous, "Anterior",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
            .addAction(playPause)
            .addAction(android.R.drawable.ic_media_next, "Siguiente",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
            .setStyle(MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
            .build()
    }

    /** Descarga la portada reducida (una sola a la vez) y repinta la notificación. */
    private fun loadArtwork(url: String?) {
        artworkUrl = url
        artwork = null
        if (url.isNullOrBlank() || !url.startsWith("http")) return
        artworkLoader.execute {
            val bitmap = runCatching {
                val connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 8_000
                connection.readTimeout = 8_000
                try {
                    val bytes = connection.inputStream.use { it.readBytes() }
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    var sample = 1
                    while (bounds.outWidth / (sample * 2) >= 256) sample *= 2
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                } finally {
                    connection.disconnect()
                }
            }.getOrNull()
            handler.post {
                if (artworkUrl != url || bitmap == null) return@post
                artwork = bitmap
                state?.let { apply(it.copy()) }
            }
        }
    }

    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun openAppIntent(): PendingIntent =PendingIntent.getActivity(
        this, 0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        running = false
        handler.removeCallbacksAndMessages(null)
        artworkLoader.shutdownNow()
        session.isActive = false
        session.release()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
