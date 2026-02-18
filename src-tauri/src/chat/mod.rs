pub(crate) mod claude;
pub(crate) mod codex;
mod commands;
pub mod detached;
mod naming;
pub mod registry;
pub mod run_log;
pub mod storage;
pub mod tail;
pub mod types;

pub use commands::*;
pub use storage::{preserve_base_sessions, restore_base_sessions, with_sessions_mut};

use std::sync::atomic::{AtomicUsize, Ordering};

/// Global counter for active file tailers (sessions being streamed)
static ACTIVE_TAILER_COUNT: once_cell::sync::Lazy<AtomicUsize> =
    once_cell::sync::Lazy::new(|| AtomicUsize::new(0));

pub fn increment_tailer_count() {
    ACTIVE_TAILER_COUNT.fetch_add(1, Ordering::Relaxed);
}

pub fn decrement_tailer_count() {
    ACTIVE_TAILER_COUNT.fetch_sub(1, Ordering::Relaxed);
}

pub fn get_active_tailer_count() -> usize {
    ACTIVE_TAILER_COUNT.load(Ordering::Relaxed)
}
