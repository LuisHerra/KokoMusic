plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.kokomusic.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.kokomusic.app"
        minSdk = 24
        targetSdk = 34
        // En el CI sube con cada build (GITHUB_RUN_NUMBER) para que Android la
        // reconozca como versión nueva; en local queda en 1.
        val runNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionCode = runNumber
        versionName = "1.0.$runNumber"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        // NewPipeExtractor necesita Java 11 y java.time (desugaring en Android < 8)
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
        isCoreLibraryDesugaringEnabled = true
    }
    kotlinOptions {
        jvmTarget = "11"
    }
    packaging {
        resources.excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*", "META-INF/*.kotlin_module")
    }
    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.webkit:webkit:1.10.0")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    // MediaSession + notificación multimedia (pantalla de bloqueo, auriculares, Bluetooth)
    implementation("androidx.media:media:1.7.0")
    // Sondeo de avisos sociales con la app cerrada (SocialNotifier)
    implementation("androidx.work:work-runtime-ktx:2.9.0")
    // Extrae el vídeo de YouTube en el móvil: desde los servidores (Render)
    // YouTube bloquea la descarga, desde la IP del usuario no.
    implementation("com.github.TeamNewPipe:NewPipeExtractor:v0.26.5")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")
}
