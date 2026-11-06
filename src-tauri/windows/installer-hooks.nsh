; Splitkick NSIS installer hooks (bundle.windows.nsis.installerHooks).
;
; The installer uses installMode "both": the user picks "only for me"
; (%LOCALAPPDATA%\Splitkick) or "all users" (Program Files). Tauri includes
; this file before its MultiUser.nsh settings, so the defines below apply.
;
; Stock MultiUser.nsh picks "all users" for admins unless HKCU has the value
; "CurrentUser" under the uninstall key. Splitkick 1.5.0 installed per user
; without that value, so its first passive update would install a second copy
; into Program Files. Defaulting to "only for me" keeps those installs in place.
!define MULTIUSER_INSTALLMODE_DEFAULT_CURRENTUSER

; With the default above, MultiUser.nsh switches to "all users" only when HKLM
; has the value "CurrentUser" under the uninstall key (Tauri itself writes
; "AllUsers" there). Write that marker for per-machine installs, so updates and
; the uninstaller find them. The uninstaller deletes the key with the marker.
!macro NSIS_HOOK_POSTINSTALL
  ${If} $MultiUser.InstallMode == "AllUsers"
    WriteRegStr HKLM "${UNINSTKEY}" "CurrentUser" 1
  ${EndIf}
!macroend
