# KokoMusic Android

App nativa mínima: un WebView a pantalla completa que carga la web publicada
(`https://kokoworks.es/kokoMusic/`) más un servicio de reproducción nativo.
Es la forma recomendada de usar KokoMusic en Android.

## Por qué gasta menos batería que Chrome

- **Sin navegador:** no hay pestañas, sincronización, prerender ni el resto
  de procesos de Chrome; solo el motor del WebView del sistema.
- **Nada corre con la música parada:** con la app en segundo plano y sin
  música, se congela todo el JavaScript del WebView (`pauseTimers`).
- **Servicio solo mientras suena:** `PlaybackService` es *foreground* solo
  mientras hay reproducción; en pausa se suelta y a los 10 minutos se cierra.
  Las versiones anteriores mantenían un servidor Python (Chaquopy + Flask +
  yt-dlp) encendido siempre y todo el audio pasaba por él.
- **Controles nativos:** notificación multimedia, pantalla de bloqueo,
  auriculares y Bluetooth vía `MediaSession`. La posición la interpola
  Android: la web solo avisa al cambiar de canción, pausar o saltar.

La web, por su parte, con la pantalla apagada actualiza la barra de progreso
cada 5 s en lugar de ~4 veces por segundo (`useAudioPlayer.ts`).

## Piezas

| Fichero | Qué hace |
|---|---|
| `MainActivity.kt` | WebView, puente `window.KokoAndroid`, congelado en segundo plano |
| `PlaybackService.kt` | MediaSession + notificación, solo mientras hay algo que controlar |
| `frontend/src/lib/androidApp.ts` | Lado web del puente (`syncAndroidPlayback`, `__kokoMediaAction`) |

## Compilar

Con el SDK de Android y JDK 17:

```bash
cd android
./gradlew assembleDebug
```

La APK queda en `app/build/outputs/apk/debug/app-debug.apk`. El CI
(`.github/workflows/android.yml`) la publica en la release `android-latest`
cuando cambia algo de `android/`; los cambios de la web no necesitan una APK
nueva.
