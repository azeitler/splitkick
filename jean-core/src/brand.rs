//! Splitkick brand values.
//!
//! Splitkick is built on Jean (coollabsio/jean, Apache 2.0). Every value that
//! keeps a Splitkick install apart from a Jean install on the same machine
//! lives here, so an upstream merge only has to touch this file and the few
//! use sites. Internal identifiers that users never see (crate names,
//! `JEAN_MCP_*` env vars, localStorage keys) stay as upstream has them.

/// Product name shown to users.
pub const PRODUCT_NAME: &str = "Splitkick";

/// Directory Splitkick keeps its data in, under the platform data directory.
/// Equal to the bundle identifier, so it never shares Jean's `com.jean.desktop`.
pub const DATA_DIR_NAME: &str = "app.splitkick.desktop";

/// Bundle identifier and data directory of the development build.
pub const DEV_IDENTIFIER: &str = "app.splitkick.desktop.dev";

/// Env var that overrides the data directory (an isolated profile).
pub const DATA_DIR_ENV: &str = "SPLITKICK_DATA_DIR";

/// Upstream's override, still honored.
pub const LEGACY_DATA_DIR_ENV: &str = "JEAN_DATA_DIR";

/// Data directory of an upstream Jean (and JeanZ) install: the import source.
pub const JEAN_DATA_DIR_NAME: &str = "com.jean.desktop";

/// Default folder under the home directory for new worktrees.
pub const WORKTREES_DIR_NAME: &str = "splitkick";

/// Per-project config file. The legacy name is read when this one is missing,
/// so a repository shared with Jean users keeps working.
pub const PROJECT_CONFIG_FILE: &str = "splitkick.json";
pub const LEGACY_PROJECT_CONFIG_FILE: &str = "jean.json";

/// MCP server names written into the agent CLIs' configs. Distinct from
/// Jean's `jean` / `jean-dev` / `jean-dialog`, so both apps can be registered.
pub const MCP_SERVER_NAME: &str = "splitkick";
pub const MCP_SERVER_NAME_DEV: &str = "splitkick-dev";
pub const MCP_DIALOG_SERVER_NAME: &str = "splitkick-dialog";

/// Default Web Access port. Jean uses 3456; both can run at the same time.
pub const DEFAULT_HTTP_PORT: u16 = 3460;

/// Desktop release feed, the same one the native updater reads
/// (`src-tauri/tauri.fork.conf.json`).
pub const DESKTOP_MANIFEST_URL: &str =
    "https://github.com/azeitler/splitkick/releases/latest/download/latest.json";
