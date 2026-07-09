# 📱 Guía de Instalación y Despliegue de KokoMusic en Móviles (Termux)

Esta guía explica paso a paso cómo instalar, ejecutar y actualizar **KokoMusic** directamente en tu dispositivo Android usando Termux de forma fácil y estable, evitando problemas comunes de compatibilidad, versiones y memoria.

---

## 🚀 Paso 1: Preparación del Entorno (Termux)

> [!IMPORTANT]
> **No instales Termux de Google Play Store**, ya que esa versión está desactualizada y no recibe soporte. Instala la versión de **F-Droid**.

1. Descarga e instala **Termux** desde F-Droid: [Termux F-Droid](https://f-droid.org/es/packages/com.termux/).
2. Abre Termux y otorga permisos de almacenamiento para que la aplicación pueda usar el sistema de archivos de tu móvil:
   ```bash
   termux-setup-storage
   ```
   *(Acepta el mensaje emergente en tu móvil)*.

---

## 📦 Paso 2: Instalación Automática (Recomendado)

Hemos optimizado el script `setup.sh` para que configure de forma automática e inteligente todo el backend, instale las versiones de paquetes adecuadas, evite diálogos interactivos molestos de actualización y configure `yt-dlp` sin que falle.

Para ejecutar la instalación automatizada, ejecuta este único comando en Termux:

```bash
curl -sL https://raw.githubusercontent.com/LuisHerra/KokoMusic/main/scripts/termux/setup.sh | bash
```

> [!TIP]
> **Token de Instalación**: El script te pedirá el token enviado por tu administrador para sincronizar de forma segura las variables de entorno de Supabase, Spotify y demás API keys.

---

## ⚡ Paso 3: ¿Cómo Iniciar y Parar KokoMusic en tu Móvil?

Una vez completado el instalador automático, tendrás un script optimizado en tu carpeta personal:

* **Para Iniciar KokoMusic**:
  ```bash
  bash ~/start-kokomusic.sh
  ```
  Una vez iniciado, abre **Google Chrome** en tu móvil y navega a:
  ```
  http://localhost:3001
  ```

* **Para Detener la Aplicación**:
  Presiona `Ctrl + C` en la terminal de Termux.

---

## 💻 Paso 4: ¿Cómo Pasar las Modificaciones del PC al Móvil?

Cuando haces cambios de código en tu PC (tanto en el backend como en el frontend) y quieres verlos reflejados en tu móvil, no es necesario hacer commits y git pull constantemente. Puedes sincronizarlos directamente:

### 1. Compila el Frontend en tu PC
En la terminal de tu PC (en la raíz del proyecto `KokoMusic`), ejecuta la compilación optimizada en modo local:
```bash
npm run build:local
```
Esto generará los assets del frontend sin base path en la carpeta `frontend/dist`.

### 2. Transfiere los Archivos al Móvil
Puedes copiar las carpetas modificadas utilizando herramientas de red local:

#### Opción A: Usando SFTP/SSH en Termux (La más recomendada y rápida)
1. Instala SSH en Termux (en el móvil):
   ```bash
   pkg install openssh
   sshd
   whoami     # Te dirá tu nombre de usuario de Termux (ej. u0_a123)
   passwd     # Ponle una contraseña temporal
   ```
2. Desde la terminal de tu PC, sincroniza el `dist` compilado y el backend con `rsync` o `scp` a la IP de tu móvil (puedes ver la IP de tu móvil en la configuración de Wi-Fi, ej: `192.168.1.15`):
   ```bash
   # En Windows usando SCP para transferir la carpeta dist:
   scp -r -P 8022 ./frontend/dist u0_a123@192.168.1.15:~/KokoMusic/frontend/
   
   # O para transferir los archivos modificados del backend:
   scp -P 8022 ./backend/dist/routes/stream.js u0_a123@192.168.1.15:~/KokoMusic/backend/dist/routes/
   ```

#### Opción B: Usando un Servidor Web Temporal
1. En la raíz de tu PC, abre una terminal y arranca un servidor HTTP rápido de Python:
   ```bash
   python -m http.server 8000
   ```
2. En tu móvil (Termux), entra al directorio correspondiente y descarga el archivo usando `curl` o `wget`:
   ```bash
   cd ~/KokoMusic/backend/dist/routes/
   curl -O http://192.168.1.XX:8000/backend/dist/routes/stream.js
   ```

---

## 🛠️ Solución de Problemas Comunes

### 1. Fallo al Compilar en Móviles (Error de Memoria / Out of Memory)
Si al instalar dependencias u organizar código de TypeScript el proceso se queda congelado en el móvil, es porque Node.js agota la memoria RAM física de tu teléfono.
* **Solución**: Hemos añadido límites de espacio de memoria automáticos en el setup. Si lo haces a mano, añade siempre `NODE_OPTIONS="--max-old-space-size=1024"` antes de compilar o instalar:
  ```bash
  NODE_OPTIONS="--max-old-space-size=1024" npm install --omit=dev
  ```

### 2. La Barra Inferior (Bottom Navigation) no Aparece en Chrome
* **Causa**: Las barras del navegador móvil o las barras del sistema a veces ocultan elementos inferiores si la altura se define con `100vh`.
* **Solución**: Hemos modificado el layout del reproductor a `100dvh` (Dynamic Viewport Height) en `index.css`. Asegúrate de que tienes esta última versión del CSS en tu `dist`.

### 3. Las Canciones no se Descargan Offline en el Servidor Local
* **Causa**: Anteriormente, la descarga local de tracks de iTunes dependía de que el CDN estuviera activado.
* **Solución**: Hemos reestructurado la lógica de descargas en `stream.ts`. Ahora, si la aplicación no detecta la configuración del CDN, guardará de forma persistente y local el track resuelto de YouTube en la carpeta `audio_cache` de tu móvil de manera automática.
