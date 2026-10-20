; Beim Deinstallieren das Rechtsklick-Menü (nur für den eigenen Benutzer) wieder entfernen
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\SlimKit"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\SlimKit"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\SlimKit"
  Delete "$APPDATA\Microsoft\Windows\SendTo\SlimKit.lnk"
!macroend
