import { Bug } from 'lucide-react'
import type { AppCommand } from './types'
import { notifications } from '@/lib/notifications'

export const notificationCommands: AppCommand[] = [
  {
    id: 'notification.test-toast',
    label: 'Test Toast Notification',
    description: 'Show a test toast notification',
    icon: Bug,
    group: 'debug',
    keywords: ['test', 'toast', 'notification', 'debug'],
    async execute() {
      await notifications.success('Test Toast', 'This is a test notification')
    },
    isAvailable: () => import.meta.env.DEV,
  },
]
