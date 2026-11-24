pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // NewPipeExtractor (vídeos de YouTube extraídos en el propio móvil)
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "KokoMusicAndroid"
include(":app")
