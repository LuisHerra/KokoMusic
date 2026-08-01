plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.chaquo.python")
}

android {
    namespace = "com.kokomusic.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.kokomusic.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }

        chaquopy {
            defaultConfig {
                pip {
                    // urllib3 sin pin — el pin v1.x rompe TLS 1.3 en Android moderno
                    install("requests")
                    // yt-dlp SIN pin de versión: YouTube cambia su protocolo con frecuencia
                    // y versiones antiguas (ej. 2023.12.30) son bloqueadas por YouTube en 2025/2026
                    install("yt-dlp")
                    install("flask==3.0.0")
                }
            }
        }
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

    // Coroutines para manejo asíncrono del servidor local
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}
