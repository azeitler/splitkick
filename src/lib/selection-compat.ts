/**
 * `Selection.getComposedRanges()` takes one options dictionary,
 * `{ shadowRoots: [...] }`, since a 2025 spec change (WebKit bug 290480). The
 * macOS 15 system WebKit (build 20621, the webview of the app) still only
 * takes the shadow roots as rest arguments and throws `TypeError: Type error`
 * for a dictionary. Pierre's editor (`@pierre/diffs`, up to 1.5.2) calls the
 * dictionary form on every selection change, so selecting text in the file
 * viewer's editor threw (#42).
 *
 * The wrapper retries a rejected dictionary with its roots as rest arguments.
 * A WebKit that takes the dictionary never reaches the retry.
 */
interface SelectionLike {
  getComposedRanges?: (...args: never[]) => unknown
}

const INSTALLED = Symbol.for('splitkick.getComposedRangesCompat')

export function installGetComposedRangesCompat(
  proto: SelectionLike | undefined = globalThis.Selection?.prototype
): void {
  const original = proto?.getComposedRanges as
    | ((...args: unknown[]) => unknown)
    | undefined
  if (!proto || typeof original !== 'function' || INSTALLED in original) {
    return
  }

  const patched = function (this: unknown, ...args: unknown[]) {
    try {
      return original.apply(this, args)
    } catch (error) {
      const options = args[0]
      const isDictionary =
        args.length === 1 &&
        typeof options === 'object' &&
        options !== null &&
        !('host' in options) // a ShadowRoot is already the old form
      if (!(error instanceof TypeError) || !isDictionary) throw error
      const roots = (options as { shadowRoots?: unknown }).shadowRoots
      return original.apply(this, Array.isArray(roots) ? roots : [])
    }
  }
  Object.defineProperty(patched, INSTALLED, { value: true })
  proto.getComposedRanges = patched as SelectionLike['getComposedRanges']
}
