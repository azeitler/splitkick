//! Manual harness: run the real Jean dialog MCP shim as a standalone process
//! so the real Claude CLI can drive it. Used to verify the handshake and that
//! `--permission-prompt-tool` re-enables the dialog tools.
//!
//! Not part of the test suite; see scripts/claude-dialog-rig/ for the loop test.
fn main() {
    if let Err(e) = jean_core::jean_mcp_stdio::run_stdio_server() {
        eprintln!("dialog shim exited: {e}");
        std::process::exit(1);
    }
}
