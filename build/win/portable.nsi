# CDPlayer's portable .exe: electron-builder's own launcher (templates/nsis/portable.nsi) unpacks the whole app into a
# new folder in TEMP on every start — some 300 MB, each file looked over by the antivirus — and deletes it on quitting,
# so the window took ten seconds and more to come up. This one unpacks a version once, into
# %LOCALAPPDATA%\CDPlayer\app\<version>, and from then on starts it from there at once. A version's folder counts only
# once it was unpacked to the end (.unpacked, written last); the versions unpacked before are removed when a new one
# is (one still running stays, as it can't be removed). Put in place of electron-builder's by build/before-pack.js.
!include "common.nsh"
!include "extractAppPackage.nsh"

# https://github.com/electron-userland/electron-builder/issues/3972#issuecomment-505171582
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

Var appRoot
Var found
Var entry

Function .onInit
  SetSilent silent
  !insertmacro check64BitAndSetRegView
FunctionEnd

Section
  InitPluginsDir
  StrCpy $appRoot "$LOCALAPPDATA\${PRODUCT_NAME}\app"
  StrCpy $INSTDIR "$appRoot\${VERSION}"

  ${IfNot} ${FileExists} "$INSTDIR\.unpacked"
  ${OrIfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    RMDir /r $INSTDIR
    SetOutPath $INSTDIR
    !insertmacro extractEmbeddedAppPackage
    FileOpen $0 "$INSTDIR\.unpacked" w
    FileWrite $0 "${VERSION}"
    FileClose $0
    FindFirst $found $entry "$appRoot\*"
    ${DoWhile} $entry != ""
      ${If} $entry != "."
      ${AndIf} $entry != ".."
      ${AndIf} $entry != "${VERSION}"
        RMDir /r "$appRoot\$entry"
      ${EndIf}
      FindNext $found $entry
    ${Loop}
    FindClose $found
  ${EndIf}

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0

  SetOutPath $INSTDIR
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0' $0
  SetErrorLevel $0
  SetOutPath $EXEDIR
SectionEnd
