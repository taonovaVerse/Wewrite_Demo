use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::Manager;

static BACKEND_CHILD: Mutex<Option<Child>> = Mutex::new(None);

// node.exe 是控制台程序，spawn 时不加该标志会在桌面弹一个多余的黑窗口
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct BackendState {
    port: Mutex<u16>,
}

#[tauri::command]
fn get_backend_port(state: tauri::State<BackendState>) -> u16 {
    *state.port.lock().unwrap()
}

fn find_free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

// Tauri 的 PathResolver 在 Windows 上返回 \\?\ 前缀的 verbatim 路径，
// Node.js 的模块加载器解析不了（会退化成 lstat 盘符根目录）。去掉前缀再传给 sidecar。
fn to_normal_path(p: &PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix("\\\\?\\") {
        Some(stripped) => PathBuf::from(stripped),
        None => p.clone(),
    }
}

// Windows bundle 把 resources 放进 <exe_dir>/resources/，而 resource_dir() 返回 exe_dir；
// macOS bundle 则直接放在 Contents/Resources 下。两种情况都试。
fn find_runtime_script(app: &tauri::App) -> Option<PathBuf> {
    let base = app.path().resource_dir().ok()?;
    for candidate in [
        base.join("resources").join("server-runtime").join("dist").join("index.js"),
        base.join("server-runtime").join("dist").join("index.js"),
    ] {
        if candidate.exists() {
            return Some(to_normal_path(&candidate));
        }
    }
    None
}

fn find_sidecar() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent().map(PathBuf::from)?;
    for dir in [exe_dir.clone(), exe_dir.join("binaries")] {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for entry in rd.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("wewrite-server") && name.ends_with(".exe") {
                    return Some(entry.path());
                }
            }
        }
    }
    None
}

fn wait_ready(port: u16, timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn spawn_backend(app: &tauri::App) -> Result<u16, String> {
    let port = find_free_port().map_err(|e| e.to_string())?;
    let sidecar = find_sidecar().ok_or("找不到 wewrite-server sidecar 二进制")?;

    let script = find_runtime_script(app).ok_or_else(|| {
        let base = app.path().resource_dir().map(|p| p.display().to_string()).unwrap_or_default();
        format!("服务器入口不存在（resource_dir: {}）", base)
    })?;

    let data_dir = to_normal_path(&app.path().app_data_dir().map_err(|e| e.to_string())?);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    // sidecar 的 stdout/stderr 落盘到 <data_dir>/backend.log，便于排查启动失败
    let log_file = std::fs::File::create(data_dir.join("backend.log"))
        .map_err(|e| format!("创建 backend.log 失败: {}", e))?;

    let mut cmd = Command::new(&sidecar);
    cmd.arg(&script)
        .arg("--port")
        .arg(port.to_string())
        .arg("--data-dir")
        .arg(&data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log_file));
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {} 失败: {}", sidecar.display(), e))?;

    if !wait_ready(port, Duration::from_secs(15)) {
        let _ = child.kill();
        return Err(format!("后端服务 15 秒内未就绪 (port {})", port));
    }

    *BACKEND_CHILD.lock().unwrap() = Some(child);
    Ok(port)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BackendState {
            port: Mutex::new(0),
        })
        .invoke_handler(tauri::generate_handler![get_backend_port])
        .setup(|app| {
            let port = if tauri::is_dev() {
                // dev 模式：npm run dev 已起 Express 于 4000，前端走 Vite 代理
                4000
            } else {
                spawn_backend(app).map_err(|e| {
                    std::io::Error::new(std::io::ErrorKind::Other, e)
                })?
            };
            *app.state::<BackendState>().port.lock().unwrap() = port;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(mut child) = BACKEND_CHILD.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });
}
