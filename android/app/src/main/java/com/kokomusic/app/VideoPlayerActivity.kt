package com.kokomusic.app

import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.MediaController
import android.widget.TextView
import android.widget.VideoView
import androidx.appcompat.app.AppCompatActivity

/**
 * Reproductor de los vídeos guardados ("Mis vídeos") DENTRO de KokoMusic.
 * El <video> de la web no podía leer el archivo que servía la APK; aquí se
 * reproduce con el reproductor nativo de Android, a pantalla completa, sin
 * salir de la app. Atrás vuelve a "Mis vídeos".
 */
class VideoPlayerActivity : AppCompatActivity() {

    companion object {
        private const val EXTRA_ID = "video_id"
        private const val EXTRA_TITLE = "video_title"
        private const val STATE_POS = "pos"

        fun start(context: Context, id: Long, title: String) {
            context.startActivity(
                Intent(context, VideoPlayerActivity::class.java)
                    .putExtra(EXTRA_ID, id)
                    .putExtra(EXTRA_TITLE, title)
            )
        }
    }

    private lateinit var video: VideoView
    private var resumeAt = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val id = intent.getLongExtra(EXTRA_ID, -1)
        if (id < 0) { finish(); return }
        resumeAt = savedInstanceState?.getInt(STATE_POS) ?: 0

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        video = VideoView(this)
        root.addView(video, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER
        ))
        val error = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 15f
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            visibility = View.GONE
        }
        root.addView(error, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ))
        setContentView(root)
        title = intent.getStringExtra(EXTRA_TITLE) ?: "Vídeo"
        hideSystemBars()

        val controller = MediaController(this).apply { setAnchorView(video) }
        video.setMediaController(controller)
        video.setVideoURI(ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id))
        video.setOnPreparedListener {
            if (resumeAt > 0) video.seekTo(resumeAt)
            video.start()
            controller.show(3000)
        }
        video.setOnCompletionListener { finish() }
        video.setOnErrorListener { _, _, _ ->
            error.text = "No se pudo reproducir este vídeo. Puede que el archivo esté incompleto: bórralo y vuelve a descargarlo."
            error.visibility = View.VISIBLE
            true
        }
        // Tocar la pantalla muestra/oculta los controles
        root.setOnClickListener { if (controller.isShowing) controller.hide() else controller.show(3000) }
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::video.isInitialized) outState.putInt(STATE_POS, video.currentPosition)
    }

    override fun onPause() {
        super.onPause()
        if (::video.isInitialized) {
            resumeAt = video.currentPosition
            video.pause()
        }
    }
}
