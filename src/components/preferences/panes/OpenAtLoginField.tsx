import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { invoke } from '@/lib/transport'

const QUERY_KEY = ['open-at-login']

/** The state lives in the OS, so this reads it instead of a preference. */
export function OpenAtLoginSwitch() {
  const queryClient = useQueryClient()
  const { data: enabled = false, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => invoke<boolean>('get_open_at_login'),
  })
  const change = useMutation({
    mutationFn: (next: boolean) =>
      invoke('set_open_at_login', { enabled: next }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: error => toast.error(`Could not change this setting: ${error}`),
  })

  return (
    <Switch
      aria-label="Open at login"
      checked={enabled}
      disabled={isLoading || change.isPending}
      onCheckedChange={next => change.mutate(next)}
    />
  )
}
