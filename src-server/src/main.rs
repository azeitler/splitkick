#[tokio::main]
async fn main() {
    // The server has its own version (src-server/Cargo.toml, 1.0.0-pre.N),
    // apart from the desktop app: --version, the `serverVersion` field of
    // /api/auth and the self-update read it. `appVersion` in /api/auth stays
    // the version of the app code the server is built from (the web build's
    // jean-build.json), so desktop clients compare like with like.
    let version = env!("CARGO_PKG_VERSION");
    jean_core::set_app_version(version);
    jean_core::set_release_version(version);
    std::env::set_var("JEAN_HEADLESS", "1");
    if let Err(error) = jean_core::run_server().await {
        eprintln!("Splitkick server failed: {error}");
        std::process::exit(1);
    }
}
