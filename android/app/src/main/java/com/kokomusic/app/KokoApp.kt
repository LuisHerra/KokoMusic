package com.kokomusic.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform

class KokoApp : Application() {

    companion object {
        const val CHANNEL_ID = "KokoServerChannel"
        const val CHANNEL_NAME = "KokoMusic Local Server"
    }

    override fun onCreate() {
        super.onCreate()
        
        // 1. Inicializar Chaquopy Python
        if (!Python.isStarted()) {
            Python.start(AndroidPlatform(this))
        }

        // 2. Crear canal de notificaciones para el Foreground Service
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Mantiene vivo el servidor local yt-dlp de KokoMusic"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }
}
