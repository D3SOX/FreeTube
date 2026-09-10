$registryEventId = @{
  CreateKey = 1
  OpenKey = 2
  DeleteKey = 3
  SetValue = 5
  DeleteValue = 6
  SetInformation = 11
  Flush = 12
  Close = 13
  SetSecurity = 15
}
$registrySuccessStatus = 0
$newRegistryKeyDisposition = 1
$keyWriteTimeInformationClass = 0

function ConvertTo-MatchingRegistryState {
  param(
    [Parameter(Mandatory)] [AllowEmptyCollection()] [AllowEmptyString()]
    [string[]] $Lines,
    [Parameter(Mandatory)] [string] $Search
  )

  $currentKey = ''
  $state = [System.Collections.Generic.List[string]]::new()
  $escapedSearch = [regex]::Escape($Search)
  foreach ($rawLine in $Lines) {
    $line = $rawLine.Trim()
    if (-not $line -or $line -match '^End of search:') {
      continue
    }
    if ($line -match '^HKEY_') {
      $currentKey = $line
      if ($line -match $escapedSearch) {
        $state.Add($line)
      }
      continue
    }
    if ($currentKey) {
      $state.Add("$currentKey`: $line")
    } else {
      $state.Add($line)
    }
  }
  return @($state | Sort-Object -Unique)
}

function Convert-RegistryEventNumber {
  param([Parameter(Mandatory)] [string] $Value)

  $trimmedValue = $Value.Trim()
  if ($trimmedValue -match '^0[xX](?<Hex>[0-9a-fA-F]+)') {
    return [Convert]::ToUInt32($Matches.Hex, 16)
  }
  if ($trimmedValue -match '^(?<Decimal>[0-9]+)') {
    return [Convert]::ToUInt32($Matches.Decimal, 10)
  }
  return $null
}

function Test-SuccessfulRegistryMutation {
  param(
    [Parameter(Mandatory)] [int] $EventId,
    [Parameter(Mandatory)] [hashtable] $EventData
  )

  if (-not $EventData.ContainsKey('Status') -or
      (Convert-RegistryEventNumber $EventData.Status) -ne $registrySuccessStatus) {
    return $false
  }

  if ($EventId -eq $registryEventId.CreateKey) {
    # CreateKey also reports ordinary opens. NewKey means that the call
    # created a key; OpenedExistingKey means that it only opened one.
    return $EventData.ContainsKey('Disposition') -and
      (Convert-RegistryEventNumber $EventData.Disposition) -eq
        $newRegistryKeyDisposition
  }

  if ($EventId -in @(
    $registryEventId.SetValue,
    $registryEventId.DeleteValue,
    $registryEventId.DeleteKey,
    $registryEventId.Flush,
    $registryEventId.SetSecurity
  )) {
    return $true
  }

  if ($EventId -eq $registryEventId.SetInformation) {
    # Only KeyWriteTimeInformation changes persisted key metadata. Other
    # information classes configure the open handle or runtime state.
    return $EventData.ContainsKey('InfoClass') -and
      ((Convert-RegistryEventNumber $EventData.InfoClass) -eq
         $keyWriteTimeInformationClass -or
       $EventData.InfoClass -eq 'KeyWriteTimeInformation')
  }

  return $false
}

# Windows may maintain its own execution history, certificates, and networking
# state. Only application-owned registry keys are part of the portable boundary.
function Test-OpenTubeXRegistryPath {
  param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Path)

  # RegLoadAppKey stores its private hive under the kernel application root.
  if ($Path.Trim() -match '^\\REGISTRY\\A\\') { return $false }

  return $Path.Trim() -match
    '(?:^|\\)(?:OpenTubeX|electron\.app\.OpenTubeX|io\.opentubex\.opentubex)(?:\\|$)'
}

function Test-PortableHostRegistryMutation {
  param(
    [Parameter(Mandatory)] [int] $EventId,
    [Parameter(Mandatory)] [hashtable] $EventData
  )

  if (-not (Test-SuccessfulRegistryMutation -EventId $EventId `
      -EventData $EventData)) {
    return $false
  }

  foreach ($field in @('KeyName', 'ResolvedKeyName')) {
    if ($EventData.ContainsKey($field) -and
        (Test-OpenTubeXRegistryPath -Path $EventData[$field])) {
      return $true
    }
  }
  return $false
}
