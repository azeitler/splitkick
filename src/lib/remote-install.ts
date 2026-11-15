/**
 * Installing splitkick-server on another machine over SSH ("Install via SSH"
 * in Remote Connections and in the onboarding). The installer and the server
 * come from the Splitkick release of this app (`remote_install.rs`), and the
 * access token stays out of every process argument list (#105). Set this to
 * false to offer only an existing Web Access URL.
 *
 * Off in the app: the server ships on its own pre-release track
 * (1.0.0-pre.N) and is not tested enough for the app to install it.
 * Before turning this on: `remote_install.rs` still fetches the installer
 * from the desktop tag (`splitkick-v<app version>`) and passes the app
 * version as `--version`, but server releases are `splitkick-server-v<server
 * version>` now, so that install would fail.
 */
export const REMOTE_INSTALL_ENABLED = false

/**
 * The onboarding's "Local or Remote" step (connect this app to a server
 * elsewhere). Set this to false to go straight to the local setup; remote
 * connections can still be added later in Server connections.
 */
export const REMOTE_SERVER_ENABLED = false
