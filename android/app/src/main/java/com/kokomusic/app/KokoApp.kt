package com.kokomusic.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class KokoApp : Application() {

    companion object {
        const val CHANNEL_ID = "KokoPlaybackChannel"
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.playback_channel),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Controles de la canción que suena"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java) ?: return
            manager.createNotificationChannel(channel)
            // Canal del antiguo servidor Python embebido (versiones anteriores de la APK)
            manager.deleteNotificationChannel("KokoServerChannel")
        }
    }
}
