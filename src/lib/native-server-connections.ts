import { aggregatesServers } from './environment'

export async function startNativeServerConnections(): Promise<() => void> {
  // Connection windows talk to one remote over the global transport.
  if (!aggregatesServers()) return () => undefined

  const [connections, managerModule] = await Promise.all([
    import('./remote-connections'),
    import('./server-connections'),
  ])
  const { serverConnectionManager } = managerModule

  const sync = () => {
    serverConnectionManager.sync(connections.getRemoteConnections(), undefined)
  }

  sync()
  const unsubscribe = connections.subscribeRemoteConnections(sync)
  return () => {
    unsubscribe()
    serverConnectionManager.dispose()
  }
}
