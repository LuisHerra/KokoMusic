plugins {
    // AGP 8.5 + Gradle 8.7 (ver gradle-wrapper.properties y .github/workflows/android.yml).
    // Ojo: NewPipeExtractor v0.27+ usa records y D8 no los convierte aquí; usamos v0.26.5.
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.22" apply false
}
