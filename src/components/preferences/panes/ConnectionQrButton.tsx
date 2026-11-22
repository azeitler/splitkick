import React, { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PRODUCT_NAME } from '@/lib/build-info'

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * True for plain `http://` to a host name (not an IP, not localhost).
 * iOS App Transport Security blocks those, so the phone app cannot connect.
 */
export function isPlainHttpHostName(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:') return false
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  // URL keeps IPv6 hosts in brackets.
  return !IPV4.test(host) && !host.startsWith('[')
}

/**
 * Button that opens a dialog with a QR code of `link` (the connection link).
 * The code is made on this machine, and only when the dialog opens, because
 * the link can contain the access token (issue #150).
 */
export const ConnectionQrButton: React.FC<{ link: string; url: string }> = ({
  link,
  url,
}) => {
  const [open, setOpen] = useState(false)
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSvg(null)
      return
    }
    let cancelled = false
    QRCode.toString(link, { type: 'svg', margin: 1 })
      .then(result => {
        if (!cancelled) setSvg(result)
      })
      .catch(() => {
        if (!cancelled) setSvg(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, link])

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Show connection QR code"
            onClick={() => setOpen(true)}
          >
            <QrCode className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Show QR code for the {PRODUCT_NAME} app</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Connection QR code</DialogTitle>
            <DialogDescription>
              Scan this code with the {PRODUCT_NAME} iOS app to add this server.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center">
            {svg ? (
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
                alt="Connection link QR code"
                data-testid="connection-qr-code"
                className="size-56 rounded-md bg-white p-2"
              />
            ) : (
              <div className="size-56" />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Anyone who scans this code can use this {PRODUCT_NAME}.
          </p>
          {isPlainHttpHostName(url) && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              iOS blocks plain HTTP to host names. Use the https://…ts.net URL
              from <code>tailscale serve</code>.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
