// KokoMusic de escritorio con Tauri: usa el WebView2 que ya trae Windows en vez
// de empaquetar un Chromium entero (Electron), y no arranca ningún backend
// local: la app carga la web publicada, que habla con el backend de Render.
// Resultado: ~5 MB de ejecutable y bastante menos RAM/CPU mientras juegas.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Se puede cambiar con la variable de entorno KOKO_URL (p. ej. http://localhost:5173 en desarrollo).
const DEFAULT_URL: &str = "https://kokoworks.es/kokoMusic/";

/// La web detecta la app de escritorio por `window.electronAPI` (ver
/// isDesktopApp() en frontend/src/lib/api.ts); se mantiene esa interfaz.
const BRIDGE: &str = r#"
window.electronAPI = {
  onMediaKey: function (callback) { window.__kokoMediaKey = callback; }
};
"#;

// Los flags por defecto de Tauri más: no frenar temporizadores con la ventana
// minimizada (la cola y las transiciones dependen de ellos) y teclas multimedia.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
--enable-features=HardwareMediaKeyHandling --disable-background-timer-throttling";

fn send_media_key(app: &tauri::AppHandle, action: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(&format!(
            "window.__kokoMediaKey && window.__kokoMediaKey('{action}')"
        ));
    }
}

fn main() {
    let url = std::env::var("KOKO_URL").unwrap_or_else(|_| DEFAULT_URL.to_string());
    // Alt+V global: activa el control por voz aunque estés dentro de un juego.
    let voice = Shortcut::new(Some(Modifiers::ALT), Code::KeyV);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && shortcut == &voice {
                        send_media_key(app, "toggle-voice");
                    }
                })
                .build(),
        )
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("KokoMusic")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .initialization_script(BRIDGE)
                .additional_browser_args(BROWSER_ARGS)
                .build()?;
            if let Err(err) = app.global_shortcut().register(voice) {
                eprintln!("[KokoMusic] No se pudo registrar Alt+V global: {err}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al arrancar KokoMusic");
}
