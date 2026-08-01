# 📱 Guía de Instalación y Uso en Dispositivos Móviles Reales (Sin Termux)

Esta guía paso a paso explica cómo compilar, transferir e instalar la aplicación nativa de **KokoMusic** en cualquier dispositivo móvil Android real.

---

## 📋 Requisitos Previos

1. Dispositivo Android con versión **Android 7.0 (API 24) o superior**.
2. **PC** con la carpeta del proyecto `KokoMusic` descargada.
3. **Android Studio** instalado en el PC (o acceso a la consola).

---

## 🛠️ Paso 1: Generar el archivo `.apk` en el PC

Tienes dos opciones para compilar la aplicación:

### Opción A: Desde Android Studio (Gráfico)
1. Abre **Android Studio**.
2. Selecciona **Open** y abre la carpeta `KokoMusic/android`.
3. Espera a que termine la sincronización inicial de Gradle (descargará Python y `yt-dlp` automáticamente).
4. En el menú superior, ve a:
   `Build` ➔ `Build Bundle(s) / APK(s)` ➔ `Build APK(s)`.
5. Cuando finalice la compilación, aparecerá una notificación abajo a la derecha. Haz clic en **locate**.
   *(Se abrirá la carpeta con el archivo `app-debug.apk`)*.

### Opción B: Desde la Consola / Terminal (Sin abrir Android Studio)
Abre la terminal en la carpeta `KokoMusic/android` y ejecuta:

* **En Windows (PowerShell / CMD)**:
  ```powershell
  .\gradlew.bat assembleDebug
  ```
* **En Mac / Linux**:
  ```bash
  ./gradlew assembleDebug
  ```

El archivo APK generado estará en la ruta:
`android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📲 Paso 2: Preparar el Teléfono Móvil

### 1. Activar la instalación de APKs desconocidos
Para instalar aplicaciones que no vienen de Google Play Store:
* Ve a **Ajustes** ➔ **Seguridad y Privacidad** (o **Aplicaciones**).
* Busca la opción **Instalar aplicaciones desconocidas** (o *Orígenes desconocidos*).
* Concede permiso al navegador (Chrome), WhatsApp o al explorador de archivos que vayas a usar para abrir el archivo.

---

## 📦 Paso 3: Transferir e Instalar el APK en el Móvil

Elige cualquiera de estos 3 métodos sencillos:

### Método 1: Enviar al grupo por Google Drive, WhatsApp o Telegram (El más fácil)
1. Sube `app-debug.apk` a tu cuenta de Google Drive o envíalo al grupo de WhatsApp/Telegram de tus compañeros.
2. En el móvil, abre el enlace o chat y pulsa en **Descargar**.
3. Pulsa sobre el archivo `.apk` descargado y selecciona **Instalar**.

### Método 2: Por Cable USB (Transferencia de archivos)
1. Conecta el móvil al PC mediante el cable USB.
2. En el móvil, selecciona la opción **Transferencia de archivos (MTP)** en la notificación de USB.
3. Copia el archivo `app-debug.apk` de tu PC a la carpeta **Descargas** (Downloads) del móvil.
4. En el móvil, abre la app **Mis Archivos** (o *Files*), entra a *Descargas*, pulsa en `app-debug.apk` e **Instala**.

### Método 3: Mediante Cable USB con ADB (Para desarrolladores)
Con el móvil conectado por USB y la *Depuración USB* activada:
```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 🚀 Paso 4: Primera Apertura y Permisos

1. Abre la aplicación **KokoMusic** desde el menú de aplicaciones de tu móvil.
2. **Permiso de Notificaciones (Android 13+)**:
   - Al abrirla por primera vez, te pedirá permiso para enviar notificaciones. Pulsa **Permitir**.
   - *¿Por qué es necesario?* Para mostrar la notificación del **Foreground Service** que mantiene vivo el servidor de `yt-dlp` en segundo plano sin que el móvil lo cierre.
3. **Pantalla de inicio ("Iniciando KokoMusic...")**:
   - Aparecerá una pantalla de carga verde/negra. En el primer inicio tardará unos 3 a 5 segundos mientras Chaquopy arranca el servidor Python embebido.
   - Tan pronto como el servidor esté listo, la interfaz se cargará automáticamente.

---

## 🔋 Paso 5: Ajuste Recomendado (Evitar que Android cierre la app)

Algunos fabricantes (Xiaomi/MIUI, Samsung, Huawei) cierran aplicaciones en segundo plano agresivamente. Para asegurarte de que la música no se pare al apagar la pantalla:

1. Mantén presionado el icono de **KokoMusic** en la pantalla de inicio.
2. Pulsa en **Información de la aplicación** (icono de la `i`).
3. Ve a **Batería** (o *Uso de batería*).
4. Selecciona **Sin restricciones** o **No optimizar**.

---

## 🔍 Solución de Problemas Comunes

* **"No se pudo conectar con el servidor interno"**:
  - Pulsa en el botón **Reintentar conexión**.
  - Asegúrate de que el teléfono tiene conexión a Internet activa (Wi-Fi o Datos) para resolver las canciones de YouTube.

* **La canción tarda unos segundos en empezar**:
  - La primera vez que reproduces una canción que no está en el CDN ni en la caché local, `yt-dlp` extrae el streaming en tiempo real. Las siguientes reproducciones de esa misma canción serán instantáneas.

* **Ver los logs de depuración desde el PC**:
  Si algo falla y quieres ver qué ocurre dentro de Python/Chaquopy, conecta el teléfono por USB y ejecuta:
  ```bash
  adb logcat | grep -E "KokoServer|KokoYtDlp|WebViewConsole"
  ```
