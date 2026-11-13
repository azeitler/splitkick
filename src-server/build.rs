//! Bakes the Splitkick release version into the binary.
//!
//! `Cargo.toml` keeps upstream's version (`0.1.73`); the Splitkick version
//! lives in `src-tauri/tauri.fork.conf.json` (set by `bun run release:cut`).
//! The server reports it, and the self-update compares it with
//! `server-latest.json`, so it must be the release version.
//! `SPLITKICK_RELEASE_VERSION` overrides it (builds without `src-tauri`).

const FORK_CONF: &str = "../src-tauri/tauri.fork.conf.json";

fn main() {
    println!("cargo:rerun-if-changed={FORK_CONF}");
    println!("cargo:rerun-if-env-changed=SPLITKICK_RELEASE_VERSION");

    let version = std::env::var("SPLITKICK_RELEASE_VERSION")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .or_else(|| {
            std::fs::read_to_string(FORK_CONF)
                .ok()
                .and_then(|conf| fork_version(&conf))
        })
        .unwrap_or_else(|| std::env::var("CARGO_PKG_VERSION").unwrap());
    println!(
        "cargo:rustc-env=SPLITKICK_RELEASE_VERSION={}",
        version.trim()
    );
}

/// The top-level `"version": "x.y.z"` of the fork config.
fn fork_version(conf: &str) -> Option<String> {
    let rest = &conf[conf.find("\"version\"")? + "\"version\"".len()..];
    let rest = &rest[rest.find('"')? + 1..];
    Some(rest[..rest.find('"')?].to_string())
}
