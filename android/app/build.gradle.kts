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
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
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
}
