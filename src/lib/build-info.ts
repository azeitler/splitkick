export interface JeanWebBuildInfo {
  webBuildId: string
  appVersion: string
  gitSha?: string
  builtAt?: string
}

export const CLIENT_BUILD_INFO: JeanWebBuildInfo = __JEAN_WEB_BUILD_INFO__

/**
 * The product name this build ships: 'Jean', or 'JeanZ' for the fork flavor.
 * Use it instead of hardcoding the name in user-visible text.
 */
export const PRODUCT_NAME: string = __JEAN_PRODUCT_NAME__
export const CLIENT_WEB_BUILD_ID = CLIENT_BUILD_INFO.webBuildId
