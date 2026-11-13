#[tokio::main]
async fn main() {
    // The Splitkick release version (see build.rs), not jean-core's or the
    // Cargo version: --version, /api/auth and the self-update all read it.
    let version = env!("SPLITKICK_RELEASE_VERSION");
    jean_core::set_app_version(version);
    jean_core::set_release_version(version);
    std::env::set_var("JEAN_HEADLESS", "1");
    if let Err(error) = jean_core::run_server().await {
        eprintln!("Splitkick server failed: {error}");
        std::process::exit(1);
    }
}
