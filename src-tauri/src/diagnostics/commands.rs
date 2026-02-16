use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sysinfo::{ProcessRefreshKind, RefreshKind, System};
use tauri::State;

use crate::background_tasks::BackgroundTaskManager;
use crate::chat::registry::get_process_registry_snapshot;

static SYSTEM: once_cell::sync::Lazy<Mutex<System>> = once_cell::sync::Lazy::new(|| {
    Mutex::new(System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    ))
});

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub session_id: String,
    pub cpu_usage: f32,
    pub memory_mb: u64,
    pub uptime_seconds: u64,
}

/// Jean's own process and its child processes (WebKit renderer, helpers)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_usage: f32,
    pub memory_mb: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollingStatus {
    pub is_focused: bool,
    pub active_worktree_id: Option<String>,
    pub git_poll_interval_secs: u64,
    pub remote_poll_interval_secs: u64,
    pub last_local_poll_ago_secs: Option<u64>,
    pub last_remote_poll_ago_secs: Option<u64>,
    pub pr_sweep_count: usize,
    pub git_sweep_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub app_processes: Vec<AppProcessInfo>,
    pub app_total_cpu: f32,
    pub app_total_memory_mb: u64,
    pub running_processes: Vec<ProcessInfo>,
    pub cli_total_cpu: f32,
    pub cli_total_memory_mb: u64,
    pub polling_status: PollingStatus,
    pub active_tailer_count: usize,
}

#[tauri::command]
pub fn get_diagnostics_snapshot(
    bg_tasks: State<'_, BackgroundTaskManager>,
) -> Result<DiagnosticsSnapshot, String> {
    let registry = get_process_registry_snapshot();
    let my_pid = sysinfo::Pid::from_u32(std::process::id());

    // Refresh all processes
    let mut sys = SYSTEM.lock().map_err(|e| format!("Lock error: {e}"))?;
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cpu()
            .with_memory(),
    );

    // Collect Jean app processes (self + children like WebKit renderer)
    let mut app_processes = Vec::new();
    let mut app_total_cpu: f32 = 0.0;
    let mut app_total_memory: u64 = 0;

    // Add Jean's own process
    if let Some(me) = sys.process(my_pid) {
        let cpu = me.cpu_usage();
        let mem = me.memory() / 1_048_576;
        app_processes.push(AppProcessInfo {
            pid: std::process::id(),
            name: "Jean (main)".to_string(),
            cpu_usage: cpu,
            memory_mb: mem,
        });
        app_total_cpu += cpu;
        app_total_memory += mem;
    }

    // Find child processes (WebKit renderer, helpers)
    // Collect registry PIDs to exclude Claude CLI processes from children
    let cli_pids: std::collections::HashSet<u32> =
        registry.iter().map(|(_, pid)| *pid).collect();

    for (pid, process) in sys.processes() {
        if process.parent() == Some(my_pid) && !cli_pids.contains(&pid.as_u32()) {
            let cpu = process.cpu_usage();
            let mem = process.memory() / 1_048_576;
            let name = process.name().to_string_lossy().to_string();
            let label = if name.contains("WebKit") || name.contains("Web Content") {
                format!("WebKit renderer ({})", pid.as_u32())
            } else {
                format!("{name} ({})", pid.as_u32())
            };
            app_processes.push(AppProcessInfo {
                pid: pid.as_u32(),
                name: label,
                cpu_usage: cpu,
                memory_mb: mem,
            });
            app_total_cpu += cpu;
            app_total_memory += mem;
        }
    }

    // Collect Claude CLI processes
    let mut running_processes = Vec::new();
    let mut cli_total_cpu: f32 = 0.0;
    let mut cli_total_memory: u64 = 0;

    for (session_id, pid) in &registry {
        if let Some(process) = sys.process(sysinfo::Pid::from_u32(*pid)) {
            let cpu = process.cpu_usage();
            let memory_mb = process.memory() / 1_048_576;
            let uptime = process.run_time();

            running_processes.push(ProcessInfo {
                pid: *pid,
                session_id: session_id.clone(),
                cpu_usage: cpu,
                memory_mb,
                uptime_seconds: uptime,
            });

            cli_total_cpu += cpu;
            cli_total_memory += memory_mb;
        }
    }

    // Get polling status
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let active_worktree_id = bg_tasks.get_active_worktree_id();
    let last_local = bg_tasks.get_last_local_poll_time(&active_worktree_id);
    let last_remote = bg_tasks.get_last_remote_poll_time(&active_worktree_id);

    let polling_status = PollingStatus {
        is_focused: bg_tasks.is_focused(),
        active_worktree_id,
        git_poll_interval_secs: bg_tasks.get_poll_interval(),
        remote_poll_interval_secs: bg_tasks.get_remote_poll_interval(),
        last_local_poll_ago_secs: last_local.map(|t| now.saturating_sub(t)),
        last_remote_poll_ago_secs: last_remote.map(|t| now.saturating_sub(t)),
        pr_sweep_count: bg_tasks.get_pr_sweep_count(),
        git_sweep_count: bg_tasks.get_git_sweep_count(),
    };

    Ok(DiagnosticsSnapshot {
        app_processes,
        app_total_cpu: app_total_cpu,
        app_total_memory_mb: app_total_memory,
        running_processes,
        cli_total_cpu: cli_total_cpu,
        cli_total_memory_mb: cli_total_memory,
        polling_status,
        active_tailer_count: crate::chat::get_active_tailer_count(),
    })
}
