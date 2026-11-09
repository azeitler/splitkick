//! Memory numbers for the periodic memory log line and Help → Copy Memory
//! Report (issue #97).
//!
//! Two parts: the footprint of one process (by pid), and counts of the
//! in-memory structures that could grow without bound. Both are cheap — a
//! syscall per process and a few mutex-guarded `len()` calls — so they can
//! run every few minutes.

use serde::Serialize;

use crate::AppHandle;

/// Above this, the memory log line is a warning.
pub const MEMORY_WARN_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemory {
    /// macOS `phys_footprint` (what Activity Monitor shows as "Memory").
    /// Resident set size on other systems.
    pub footprint_bytes: u64,
    pub resident_bytes: u64,
    /// Highest footprint since the process started, also between samples.
    /// Zero where the system does not tell.
    pub peak_footprint_bytes: u64,
}

/// Memory of process `pid`, or `None` when the system does not tell.
///
/// macOS: `proc_pid_rusage(RUSAGE_INFO_V4)`. It works for any process of the
/// same user without extra rights, which covers WebKit's content process.
#[cfg(target_os = "macos")]
pub fn process_memory(pid: u32) -> Option<ProcessMemory> {
    let mut info = std::mem::MaybeUninit::<libc::rusage_info_v4>::zeroed();
    // SAFETY: the buffer is a properly sized `rusage_info_v4` for flavor V4.
    let result = unsafe {
        libc::proc_pid_rusage(
            pid as libc::c_int,
            libc::RUSAGE_INFO_V4,
            info.as_mut_ptr().cast::<libc::rusage_info_t>(),
        )
    };
    if result != 0 {
        return None;
    }
    // SAFETY: the call succeeded and filled the struct.
    let info = unsafe { info.assume_init() };
    Some(ProcessMemory {
        footprint_bytes: info.ri_phys_footprint,
        resident_bytes: info.ri_resident_size,
        peak_footprint_bytes: info.ri_lifetime_max_phys_footprint,
    })
}

/// Linux: `VmRSS` from `/proc/<pid>/status`.
#[cfg(target_os = "linux")]
pub fn process_memory(pid: u32) -> Option<ProcessMemory> {
    let status = std::fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
    let kib = status
        .lines()
        .find_map(|line| line.strip_prefix("VmRSS:"))?
        .trim()
        .trim_end_matches("kB")
        .trim()
        .parse::<u64>()
        .ok()?;
    let bytes = kib * 1024;
    Some(ProcessMemory {
        footprint_bytes: bytes,
        resident_bytes: bytes,
        peak_footprint_bytes: 0,
    })
}

/// Windows: private bytes and working set of a process this user can open.
#[cfg(windows)]
pub fn process_memory(pid: u32) -> Option<ProcessMemory> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    // SAFETY: plain Win32 calls; the handle is closed before returning.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut counters: PROCESS_MEMORY_COUNTERS_EX = std::mem::zeroed();
        let size = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
        let ok = GetProcessMemoryInfo(
            handle,
            (&mut counters as *mut PROCESS_MEMORY_COUNTERS_EX).cast::<PROCESS_MEMORY_COUNTERS>(),
            size,
        );
        CloseHandle(handle);
        if ok == 0 {
            return None;
        }
        Some(ProcessMemory {
            footprint_bytes: counters.PrivateUsage as u64,
            resident_bytes: counters.WorkingSetSize as u64,
            peak_footprint_bytes: counters.PeakPagefileUsage as u64,
        })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub fn process_memory(_pid: u32) -> Option<ProcessMemory> {
    None
}

#[cfg(target_os = "macos")]
fn child_pids(pid: u32) -> Option<Vec<u32>> {
    let mut pids = vec![0 as libc::pid_t; 1024];
    let bytes = (pids.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int;
    // SAFETY: the buffer holds `bytes` bytes of pid_t.
    let count =
        unsafe { libc::proc_listchildpids(pid as libc::pid_t, pids.as_mut_ptr().cast(), bytes) };
    (count >= 0).then(|| {
        pids.into_iter()
            .take(count as usize)
            .map(|child| child as u32)
            .collect()
    })
}

/// Direct child processes of `pid` (CLI runs, terminals, MCP servers, …).
/// Only macOS can list them cheaply; elsewhere this is `None`.
#[cfg(target_os = "macos")]
pub fn child_process_count(pid: u32) -> Option<usize> {
    child_pids(pid).map(|children| children.len())
}

#[cfg(not(target_os = "macos"))]
pub fn child_process_count(_pid: u32) -> Option<usize> {
    None
}

/// Summed footprint of the direct child processes of `pid`.
#[cfg(target_os = "macos")]
pub fn child_process_bytes(pid: u32) -> Option<u64> {
    Some(
        child_pids(pid)?
            .into_iter()
            .filter_map(process_memory)
            .map(|memory| memory.footprint_bytes)
            .sum(),
    )
}

#[cfg(not(target_os = "macos"))]
pub fn child_process_bytes(_pid: u32) -> Option<u64> {
    None
}

/// Sizes of the in-memory structures that could leak.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InMemoryCounts {
    /// Session summaries cached from `metadata.json`.
    pub cached_sessions: usize,
    /// Native CLI history cache entries.
    pub native_history_entries: usize,
    /// Run-log tailers streaming a session's output.
    pub run_log_tailers: usize,
    /// CLI runs in the process registry.
    pub cli_runs: usize,
    /// Terminal PTYs.
    pub terminals: usize,
    /// Backend event listeners on the runtime context.
    pub event_listeners: usize,
    /// Connected WebSocket (Web Access / remote) clients.
    pub ws_clients: usize,
    /// Events held in the WebSocket replay buffers.
    pub ws_replay_events: usize,
    /// Bytes held in the terminal replay buffers.
    pub ws_terminal_replay_bytes: usize,
}

pub fn in_memory_counts(app: &AppHandle) -> InMemoryCounts {
    let (ws_clients, ws_replay_events, ws_terminal_replay_bytes) = app
        .try_state::<crate::http_server::WsBroadcaster>()
        .map(|ws| ws.memory_stats())
        .unwrap_or_default();
    InMemoryCounts {
        cached_sessions: crate::chat::storage::session_summary_cache_len(),
        native_history_entries: crate::chat::native_history_cache_len(),
        run_log_tailers: crate::chat::active_tailer_count(),
        cli_runs: crate::chat::registry::registered_process_count(),
        terminals: crate::terminal::terminal_count(),
        event_listeners: app.listener_count(),
        ws_clients,
        ws_replay_events,
        ws_terminal_replay_bytes,
    }
}

/// `1.23 GB`, `456 MB`, `12 KB`.
pub fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let value = bytes as f64;
    if value >= GB {
        format!("{:.2} GB", value / GB)
    } else if value >= MB {
        format!("{:.0} MB", value / MB)
    } else {
        format!("{:.0} KB", value / KB)
    }
}

impl InMemoryCounts {
    /// `cachedSessions=12 runLogTailers=1 …` for the log line.
    pub fn log_fields(&self) -> String {
        format!(
            "cachedSessions={} nativeHistory={} runLogTailers={} cliRuns={} terminals={} \
             eventListeners={} wsClients={} wsReplayEvents={} wsTerminalReplay={}",
            self.cached_sessions,
            self.native_history_entries,
            self.run_log_tailers,
            self.cli_runs,
            self.terminals,
            self.event_listeners,
            self.ws_clients,
            self.ws_replay_events,
            format_bytes(self.ws_terminal_replay_bytes as u64),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_bytes_in_readable_units() {
        assert_eq!(format_bytes(12 * 1024), "12 KB");
        assert_eq!(format_bytes(456 * 1024 * 1024), "456 MB");
        assert_eq!(format_bytes(MEMORY_WARN_BYTES), "4.00 GB");
    }

    #[cfg(any(target_os = "macos", target_os = "linux", windows))]
    #[test]
    fn reads_own_process_memory() {
        let memory = process_memory(std::process::id()).expect("own process memory");
        assert!(memory.footprint_bytes > 0);
        assert!(memory.resident_bytes > 0);
    }

    #[test]
    fn unknown_process_has_no_memory() {
        // Pids are far below this on every supported system.
        assert_eq!(process_memory(999_999_999), None);
    }

    #[test]
    fn log_fields_name_every_count() {
        let fields = InMemoryCounts {
            cached_sessions: 3,
            ws_clients: 2,
            ..Default::default()
        }
        .log_fields();
        assert!(fields.starts_with("cachedSessions=3 "), "{fields}");
        assert!(fields.contains(" wsClients=2 "), "{fields}");
    }
}
