package com.kokomusic.app

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.chaquo.python.Python

class KokoServerService : Service() {

    private var serverThread: Thread? = null
    private var isServerStarted = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundServiceNotification()
        startPythonServer()
        return START_STICKY
    }

    private fun startForegroundServiceNotification() {
        val notificationIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification: Notification = NotificationCompat.Builder(this, KokoApp.CHANNEL_ID)
            .setContentTitle("Servidor KokoMusic Activo")
            .setContentText("yt-dlp embebido ejecutándose localmente")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        startForeground(NOTIFICATION_ID, notification)
    }

    private fun startPythonServer() {
        if (isServerStarted) return
        isServerStarted = true

        serverThread = Thread {
            try {
                Log.i(TAG, "Iniciando servidor Python desde Kotlin Foreground Service...")
                val python = Python.getInstance()
                val serverModule = python.getModule("server")
                serverModule.callAttr("start_server", 3001)
            } catch (e: Exception) {
                Log.e(TAG, "Error iniciando el servidor Python: ${e.message}", e)
            }
        }
        serverThread?.isDaemon = true
        serverThread?.start()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Log.i(TAG, "Task removed by user. Stopping server service and terminating process...")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        android.os.Process.killProcess(android.os.Process.myPid())
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.i(TAG, "Deteniendo KokoServerService...")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        android.os.Process.killProcess(android.os.Process.myPid())
    }

    companion object {
        private const val TAG = "KokoServerService"
        private const val NOTIFICATION_ID = 1001
    }
}

