$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windowsPortableRegistryTrace.ps1')

foreach ($key in @(
  'HKEY_CURRENT_USER\Software\OpenTubeX',
  '\REGISTRY\USER\S-1-5-21-1-2-3-1000\Software\OpenTubeX\Settings',
  'HKEY_CURRENT_USER\Software\Classes\opentubex\shell\open\command',
  'HKEY_CURRENT_USER\Software\Classes\AppUserModelId\electron.app.OpenTubeX',
  'HKEY_CURRENT_USER\Software\Classes\AppUserModelId\io.opentubex.opentubex'
)) {
  if (-not (Test-OpenTubeXRegistryPath -Path $key)) {
    throw "Application registry key was ignored: $key"
  }
  foreach ($field in @('KeyName', 'ResolvedKeyName')) {
    $eventData = @{ Status = '0x0'; Disposition = '1'; InfoClass = '0' }
    $eventData[$field] = $key
    foreach ($eventId in @(
      $registryEventId.CreateKey, $registryEventId.SetValue,
      $registryEventId.DeleteValue, $registryEventId.DeleteKey,
      $registryEventId.Flush, $registryEventId.SetSecurity,
      $registryEventId.SetInformation
    )) {
      if (-not (Test-PortableHostRegistryMutation -EventId $eventId -EventData $eventData)) {
        throw "Application registry mutation was ignored: $eventId, $field, $key"
      }
    }
    $eventData.Status = '0xC0000022'
    if (Test-PortableHostRegistryMutation -EventId $registryEventId.SetValue -EventData $eventData) {
      throw 'A failed write was counted as a mutation'
    }
    $eventData.Status = '0x0'
    $eventData.Disposition = '2'
    if (Test-PortableHostRegistryMutation -EventId $registryEventId.CreateKey -EventData $eventData) {
      throw 'Opening an existing key was counted as a mutation'
    }
    $eventData.InfoClass = '1'
    if (Test-PortableHostRegistryMutation -EventId $registryEventId.SetInformation -EventData $eventData) {
      throw 'Runtime handle configuration was counted as a mutation'
    }
  }
}

foreach ($key in @(
  'HKEY_LOCAL_MACHINE\Software\Microsoft\SystemCertificates',
  'HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings',
  '\REGISTRY\MACHINE\SYSTEM\CurrentControlSet\Services\bam\State\UserSettings\S-1-5-21-1-2-3-1000',
  'HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache',
  'HKEY_CURRENT_USER\Software\OpenTubeXOther',
  'HKEY_CURRENT_USER\Software\OtherOpenTubeX'
)) {
  $eventData = @{
    Status = '0x0'
    KeyName = $key
    ValueName = 'C:\Portable\OpenTubeX.exe.FriendlyAppName'
    CapturedData = 'OpenTubeX'
  }
  if (Test-PortableHostRegistryMutation -EventId $registryEventId.SetValue -EventData $eventData) {
    throw "System registry activity was counted as application state: $key"
  }
}

$state = @(ConvertTo-MatchingRegistryState -Lines @(
  '',
  'HKEY_CURRENT_USER\Software\OpenTubeX',
  '    Setting    REG_SZ    OpenTubeX',
  'End of search: 1 match(es) found.'
) -Search 'OpenTubeX')
if ($state.Count -ne 2 -or
    $state[0] -ne 'HKEY_CURRENT_USER\Software\OpenTubeX' -or
    $state[1] -ne 'HKEY_CURRENT_USER\Software\OpenTubeX: Setting    REG_SZ    OpenTubeX') {
  throw 'Registry snapshot keys or values did not retain their paths'
}

Write-Output 'Windows portable registry trace policy tests passed.'
