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

/// Ajustes de WebView2 que Tauri no expone.
#[cfg(windows)]
mod webview2 {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{take_pwstr, PermissionRequestedEventHandler};
    use windows_core::{Interface, PWSTR};

    /// Concede el micrófono a KokoMusic sin diálogo: con Alt+V dentro de un
    /// juego el aviso de permiso quedaría escondido y la voz no arrancaría.
    pub fn allow_microphone(window: &tauri::WebviewWindow) {
        let _ = window.with_webview(|wv| unsafe {
            let Ok(core) = wv.controller().CoreWebView2() else { return };
            let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                let uri = take_pwstr(uri);
                let ours = uri.starts_with("https://kokoworks.es/") || uri.starts_with("http://localhost");
                if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE && ours {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_PermissionRequested(&handler, &mut token);
        });
    }

    /// En segundo plano (jugando) WebView2 libera toda la memoria que pueda;
    /// la música sigue sonando. Al volver a la ventana recupera el modo normal.
    pub fn set_low_memory(window: &tauri::WebviewWindow, low: bool) {
        let _ = window.with_webview(move |wv| unsafe {
            let Ok(core) = wv.controller().CoreWebView2() else { return };
            let Ok(core19) = core.cast::<ICoreWebView2_19>() else { return };
            let _ = core19.SetMemoryUsageTargetLevel(if low {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            });
        });
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
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("KokoMusic")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .initialization_script(BRIDGE)
                .additional_browser_args(BROWSER_ARGS)
                .build()?;
            #[cfg(windows)]
            {
                webview2::allow_microphone(&window);
                let handle = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(focused) = event {
                        webview2::set_low_memory(&handle, !focused);
                    }
                });
            }
            if let Err(err) = app.global_shortcut().register(voice) {
                eprintln!("[KokoMusic] No se pudo registrar Alt+V global: {err}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al arrancar KokoMusic");
}
