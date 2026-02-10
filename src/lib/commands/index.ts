// Command system exports
export * from './registry'
export * from '../../hooks/use-command-context'
import { appearanceCommands } from './appearance-commands'
import { notificationCommands } from './notification-commands'
import { projectCommands } from './project-commands'
import { registerCommands } from './registry'

/**
 * Initialize the command system by registering all commands.
 * This should be called once during app initialization.
 */
export function initializeCommandSystem(): void {
  registerCommands(appearanceCommands)
  registerCommands(notificationCommands)
  registerCommands(projectCommands)

  if (import.meta.env.DEV) {
    console.log('Command system initialized')
  }
}

export { appearanceCommands, notificationCommands, projectCommands }
