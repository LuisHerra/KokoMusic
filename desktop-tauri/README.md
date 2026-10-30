# KokoMusic para Windows (Tauri)

App de escritorio ligera: usa el WebView2 que ya trae Windows en lugar de
empaquetar Chromium (Electron) y no arranca ningún backend local. Carga
`https://kokoworks.es/kokoMusic/`, así que cada despliegue del frontend llega
a la app sin reinstalar.

- **Alt + V** (global, también dentro de un juego): control por voz.
- Teclas multimedia: las gestiona Windows a través de la Media Session de la web.

## Compilar

```bash
npm install
npm run build
```

El instalador queda en `target/release/bundle/nsis/` y el ejecutable suelto en
`target/release/kokomusic.exe`.

## Desarrollo

Para apuntar a otro frontend (p. ej. el de Vite en local):

```bash
KOKO_URL=http://localhost:5173 npm run dev
```
