# 📱 KokoMusic Android (App Nativa con yt-dlp Embebido vía Chaquopy)

Esta carpeta contiene la implementación nativa para **Android (Kotlin + Chaquopy)** que embebe `yt-dlp` y el servidor HTTP directamente dentro de la aplicación Android, eliminando la necesidad de usar **Termux** o consolas visibles para el usuario.

---

## 🎯 Arquitectura Técnica Confirmada

### Comparativa de Enfoques Evaluados:

1. **Enfoque A: Servidor 100% Python WSGI en Chaquopy**
   - *Pros*: Portabilidad directa de código Python.
   - *Contras*: Consumo alto de RAM en la JVM y arranque más lento.
2. **Enfoque B: Servidor NanoHTTPD Kotlin + Chaquopy Async Call (Híbrido Recomendado)**
   - *Pros*: Servidor web ultrarrápido (<50ms startup), gestión del ciclo de vida 100% nativa con Android Foreground Service, 0 consumo innecesario de batería.
   - *Contras*: Requiere mappear los endpoints REST en Kotlin.
3. **Enfoque C: Micro Servidor Flask en Chaquopy + Kotlin Foreground Service Wrapper (Implementado)**
   - *Pros*: Reutilización directa del backend en Python, fácil mantenimiento para el grupo, soporta streaming y descargas background vía `yt-dlp`.
   - *Contras*: Requiere Splash Screen con reintentos para dar tiempo al inicio de Chaquopy (2-3 segundos en la primera apertura).

---

## 🚀 Componentes Principales

1. **Chaquopy Plugin (`com.chaquo.python`)**:
   - Integra un intérprete de Python 3.10 embebido en el APK.
   - Descarga e instala automáticamente `yt-dlp`, `requests` y `flask` vía pip durante la compilación de Gradle.

2. **KokoServerService (`Foreground Service`)**:
   - Mantiene vivo el servidor Python (`server.py`) en `127.0.0.1:3001` con una notificación persistente (`POST_NOTIFICATIONS` / `FOREGROUND_SERVICE_MEDIA_PLAYBACK`).
   - Evita que el sistema operativo mate el proceso cuando la app se minimiza o la pantalla se apaga.

3. **WebView a Pantalla Completa (`MainActivity.kt`)**:
   - Configurado con `domStorageEnabled = true`, `javaScriptEnabled = true` y `mediaPlaybackRequiresUserGesture = false`.
   - Carga `http://127.0.0.1:3001` una vez el servidor confirma salud vía polling a `/health`.

4. **Network Security Config (`network_security_config.xml`)**:
   - Permite tráfico cleartext (HTTP no cifrado) a `127.0.0.1` y `localhost` (bloqueado por defecto a partir de Android 9).

---

## 🛠️ Cómo Compilar y Generar el APK de Debug

### Requisitos previos:
- **Android Studio** (Hedgehog, Iguana, Ladybug o superior) con SDK 34 instalado.
- JDK 17 o JDK 11 configurado en Android Studio (`Settings -> Build, Execution, Deployment -> Build Tools -> Gradle -> Gradle JDK`).

### Pasos:

1. **Abrir el proyecto en Android Studio**:
   - En Android Studio, selecciona **Open** y navega a la carpeta `KokoMusic/android`.
   - Espera a que Gradle sincronice las dependencias (`yt-dlp` y paquetes de Chaquopy se descargarán automáticamente en la primera sincronización).

2. **Generar APK de Debug**:
   - En el menú superior de Android Studio, ve a:
     `Build -> Build Bundle(s) / APK(s) -> Build APK(s)`
   - El APK resultante se guardará en:
     `android/app/build/outputs/apk/debug/app-debug.apk`

3. **Instalar en Dispositivo Real / Emulador**:
   - Conecta el móvil por USB con **Depuración USB** activada.
   - Ejecuta en la terminal:
     ```bash
     adb install app/build/outputs/apk/debug/app-debug.apk
     ```

---

## 🔍 Depuración y Logs (ADB Logcat)

Para ver los logs del servidor Python embebido y Chaquopy en tiempo real:

```bash
# Ver logs de Python y WebView
adb logcat | grep -E "KokoServer|KokoYtDlp|WebViewConsole"
```

---

## 💡 Ventajas frente a Termux

| Característica | Termux | App Nativa Chaquopy |
| :--- | :--- | :--- |
| **Experiencia de Usuario** | Requiere abrir terminal, ejecutar scripts, ingresar IP | Un solo icono, abre e inicia automáticamente |
| **Persistencia** | Android destruye la sesión si no se deshabilita optimización de batería | **Foreground Service** con notificación persistente |
| **Seguridad de Rendimiento** | Requiere Node + Python instalados manualmente | Todo empaquetado dentro del APK nativo |
