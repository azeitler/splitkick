/**
 * Installing splitkick-server on another machine over SSH ("Install via SSH"
 * in Remote Connections and in the onboarding). The installer and the server
 * come from the Splitkick release of this app (`remote_install.rs`), and the
 * access token stays out of every process argument list (#105). Set this to
 * false to offer only an existing Web Access URL.
 */
export const REMOTE_INSTALL_ENABLED = true

/**
 * The onboarding's "Local or Remote" step (connect this app to a server
 * elsewhere). Set this to false to go straight to the local setup; remote
 * connections can still be added later in Server connections.
 */
export const REMOTE_SERVER_ENABLED = true
