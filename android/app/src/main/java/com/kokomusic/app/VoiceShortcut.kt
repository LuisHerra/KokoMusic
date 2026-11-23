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

/**
 * Atajo de volumen arriba + volumen abajo para el control por voz.
 *
 * Con la app delante lo detecta MainActivity y abre la voz al momento. Con la
 * app en segundo plano lo detecta la sesión multimedia (PlaybackService, solo
 * mientras hay música): Android no deja que una app en segundo plano abra el
 * micrófono ni se ponga delante sola, así que se intenta abrir la app y, por si
 * el sistema lo bloquea, se muestra un aviso "Toca para hablar" que la abre ya
 * escuchando.
 */
object VoiceShortcut {
    const val COMBO_WINDOW_MS = 400L
    /** Tiempo máximo para la secuencia arriba-abajo-arriba (o abajo-arriba-abajo). */
    const val SEQUENCE_WINDOW_MS = 1200L

    /**
     * Detecta el atajo con las teclas de volumen. Pulsar las dos a la vez no
     * sirve: Android reserva esa combinación para el atajo de accesibilidad y
     * no llega a las apps. Por eso el atajo es una secuencia rápida alternando:
     * arriba, abajo, arriba (o abajo, arriba, abajo). Las dos primeras pulsaciones
     * se anulan entre sí y la tercera no se aplica, así que el volumen no cambia.
     */
    class Detector {
        private val presses = ArrayDeque<Pair<Int, Long>>()

        /** direction: +1 subir, -1 bajar. Devuelve true si completa el atajo. */
        fun onPress(direction: Int, now: Long): Boolean {
            presses.addLast(direction to now)
            while (presses.size > 3) presses.removeFirst()
            if (presses.size < 3) return false
            val (d1, t1) = presses[0]
            val (d2, _) = presses[1]
            val (d3, t3) = presses[2]
            val alternating = d1 == -d2 && d2 == -d3
            if (alternating && t3 - t1 <= SEQUENCE_WINDOW_MS) {
                presses.clear()
                return true
            }
            return false
        }
    }
    private const val CHANNEL_ID = "KokoVoiceChannel"
    private const val NOTIFICATION_ID = 2002

    fun launchFromBackground(context: Context) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            putExtra(MainActivity.EXTRA_START_VOICE, true)
        }
        // Puede funcionar (Android 9 o anteriores, o si el sistema lo permite)
        runCatching { context.startActivity(intent) }
            .onFailure { Log.w("VoiceShortcut", "No se pudo abrir la app desde segundo plano", it) }
        showTapToTalk(context, intent)
    }

    private fun showTapToTalk(context: Context, intent: Intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Control por voz", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Atajo de volumen arriba + volumen abajo"
                }
            )
        }
        val pending = PendingIntent.getActivity(
            context, NOTIFICATION_ID, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_koko)
            .setContentTitle("Control por voz")
            .setContentText("Toca para hablar con KokoMusic")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setTimeoutAfter(15_000)
            .setContentIntent(pending)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification) }
    }

    fun cancelNotification(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }
}
