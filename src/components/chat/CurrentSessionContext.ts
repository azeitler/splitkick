import { createContext } from 'react'

/**
 * Id of the session whose chat is on screen. Lets deep chat rows (tool calls)
 * compare a linked session with the current one without prop drilling (#62).
 */
export const CurrentSessionContext = createContext<string | null>(null)
