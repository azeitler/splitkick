import { isNativeApp } from './environment'

export async function startNativeServerConnections(): Promise<() => void> {
  if (!isNativeApp()) return () => undefined

  const [connections, managerModule, transport] = await Promise.all([
    import('./remote-connections'),
    import('./server-connections'),
    import('./transport'),
  ])
  const { serverConnectionManager } = managerModule

  const sync = () => {
    const activeServerId = connections.getActiveConnectionId()
    serverConnectionManager.sync(
      connections.getRemoteConnections(),
      activeServerId === connections.LOCAL_CONNECTION_ID
        ? undefined
        : {
            serverId: activeServerId,
            adapter: transport.getLegacyWsTransport(),
          }
    )
  }

  sync()
  const unsubscribe = connections.subscribeRemoteConnections(sync)
  return () => {
    unsubscribe()
    serverConnectionManager.dispose()
  }
}
