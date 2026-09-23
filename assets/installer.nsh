; Written only by NSIS, never by a ZIP/directory build or the running app.
!macro customInstall
  WriteRegStr HKCU "Software\OpenTig" "InstallLocation" "$INSTDIR"
!macroend

!macro customUnInstall
  ReadRegStr $0 HKCU "Software\OpenTig" "InstallLocation"
  ${If} $0 == $INSTDIR
    DeleteRegValue HKCU "Software\OpenTig" "InstallLocation"
    DeleteRegKey /ifempty HKCU "Software\OpenTig"
  ${EndIf}
!macroend
