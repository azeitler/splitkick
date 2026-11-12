/**
 * Installing jean-server on another machine over SSH ("Install via SSH" in
 * Remote Connections and in the onboarding) is turned off for now: only an
 * existing Web Access URL can be added. The install code stays; set this to
 * true to offer it again.
 */
export const REMOTE_INSTALL_ENABLED = false

/**
 * The onboarding's "Local or Remote" step (connect this app to a server
 * elsewhere) is turned off for now: the onboarding goes straight to the local
 * setup. Remote connections can still be added later in Server connections.
 */
export const REMOTE_SERVER_ENABLED = false
