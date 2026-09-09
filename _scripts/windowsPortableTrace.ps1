. (Join-Path $PSScriptRoot 'windowsPortableRegistryTrace.ps1')

$processStartEventId = 1
$fileEventId = @{
  NameCreate = 10
  NameDelete = 11
  Write = 16
  SetInformation = 17
  SetDelete = 18
  Rename = 19
  Flush = 21
  DeletePath = 26
  RenamePath = 27
  SetLinkPath = 28
  RenameAlternate = 29
  CreateNewFile = 30
}
$registryProviderName = 'Microsoft-Windows-Kernel-Registry'
$processProviderName = 'Microsoft-Windows-Kernel-Process'
$fileProviderName = 'Microsoft-Windows-Kernel-File'

function Get-TraceEventData {
  param([Parameter(Mandatory)] [System.Xml.XmlElement] $Event)

  $eventData = @{}
  foreach ($dataNode in $Event.SelectNodes(
    "./*[local-name()='EventData']/*[local-name()='Data']"
  )) {
    $eventData[$dataNode.GetAttribute('Name')] = $dataNode.InnerText
  }
  return $eventData
}

function Get-NormalizedTraceEvents {
  param(
    [Parameter(Mandatory)] [string] $TraceFile,
    [Parameter(Mandatory)] [string] $ProviderName
  )

  # A system-wide trace can decode to gigabytes of XML. Keep only one event in
  # memory, and let the consumer process it before reading the next event.
  $reader = [System.Xml.XmlReader]::Create($TraceFile)
  try {
    while ($reader.Read()) {
      if ($reader.NodeType -ne [System.Xml.XmlNodeType]::Element -or
          $reader.LocalName -ne 'Event') {
        continue
      }
      $subtree = $reader.ReadSubtree()
      try {
        $document = [System.Xml.XmlDocument]::new()
        $document.Load($subtree)
      } finally { $subtree.Dispose() }
      $event = $document.DocumentElement
      $system = $event.SelectSingleNode("./*[local-name()='System']")
      if (-not $system) { continue }
      $provider = $system.SelectSingleNode("./*[local-name()='Provider']")
      $eventIdNode = $system.SelectSingleNode("./*[local-name()='EventID']")
      if (-not $provider -or -not $eventIdNode -or
          $provider.GetAttribute('Name') -ne $ProviderName) {
        continue
      }
      $execution = $system.SelectSingleNode("./*[local-name()='Execution']")
      $processId = if ($execution -and $execution.HasAttribute('ProcessID')) {
        [int] $execution.GetAttribute('ProcessID')
      } else { $null }

      [PSCustomObject]@{
        ProviderName = $provider.GetAttribute('Name')
        EventId = [int] $eventIdNode.InnerText
        ProcessId = $processId
        Data = Get-TraceEventData $event
      }
    }
  } finally { $reader.Dispose() }
}

function Get-ComparablePathTail {
  param([Parameter(Mandatory)] [string] $Path)

  $normalized = $Path.Replace('/', '\').TrimEnd('\').ToUpperInvariant()
  if ($normalized -match '^[A-Z]:(?<Tail>\\.*)$') {
    return $Matches.Tail
  }
  return $normalized
}

function Test-AppOwnedHostPath {
  param(
    [Parameter(Mandatory)] [string] $Candidate,
    [Parameter(Mandatory)] [string[]] $DirectoryTails,
    [Parameter(Mandatory)] [string[]] $FileTails
  )

  $candidatePath = Get-ComparablePathTail $Candidate
  foreach ($directoryTail in $DirectoryTails) {
    if ($candidatePath.EndsWith($directoryTail) -or
        $candidatePath.Contains("$directoryTail\")) {
      return $true
    }
  }
  foreach ($fileTail in $FileTails) {
    if ($candidatePath.EndsWith($fileTail)) {
      return $true
    }
  }
  return $false
}

function Assert-NoAppOwnedHostWrites {
  param(
    [Parameter(Mandatory)] [string] $TraceFile,
    [Parameter(Mandatory)] [string] $OutputFile,
    [Parameter(Mandatory)] [System.Collections.Generic.HashSet[int]] $ProcessIds,
    [Parameter(Mandatory)] [string[]] $HostDirectoryTails,
    [Parameter(Mandatory)] [string[]] $HostFileTails
  )

  $output = & tracerpt.exe $TraceFile -of XML -o $OutputFile -y 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Could not decode the registry trace:`n$output"
  }
  Write-Host "Checking portable host writes in $((Get-Item $OutputFile).Length) bytes of trace XML."

  $appRegistryWrites = [System.Collections.Generic.List[string]]::new()
  $externalOpenTubeXRegistryWrites = [System.Collections.Generic.List[string]]::new()
  $registryKeyPaths = @{}

  $processParents = @{}
  # Read process starts first so short-lived children are known even when their
  # events precede the parent's events in tracerpt output.
  Get-NormalizedTraceEvents -TraceFile $OutputFile -ProviderName $processProviderName | ForEach-Object {
    $event = $_
    if ($event.ProviderName -ne $processProviderName -or
        $event.EventId -ne $processStartEventId) {
      return
    }

    $eventData = $event.Data
    if ($eventData.ContainsKey('ProcessID') -and
        $eventData.ContainsKey('ParentProcessID')) {
      $processParents[[int] $eventData.ProcessID] =
        [int] $eventData.ParentProcessID
    }
  }
  do {
    $addedProcess = $false
    foreach ($entry in $processParents.GetEnumerator()) {
      if ($ProcessIds.Contains($entry.Value) -and $ProcessIds.Add($entry.Key)) {
        $addedProcess = $true
      }
    }
  } while ($addedProcess)

  $filePaths = @{}
  $appHostFileWrites = [System.Collections.Generic.List[string]]::new()
  $fileMutationEventIds = @(
    $fileEventId.Write,
    $fileEventId.SetInformation,
    $fileEventId.SetDelete,
    $fileEventId.Rename,
    $fileEventId.Flush,
    $fileEventId.DeletePath,
    $fileEventId.RenamePath,
    $fileEventId.SetLinkPath,
    $fileEventId.RenameAlternate,
    $fileEventId.CreateNewFile
  )

  Get-NormalizedTraceEvents -TraceFile $OutputFile -ProviderName $fileProviderName | ForEach-Object {
    $event = $_
    if ($null -eq $event.ProcessId -or
        $event.ProviderName -ne $fileProviderName) {
      return
    }

    $eventProcessId = $event.ProcessId
    $eventId = $event.EventId
    $eventData = $event.Data
    $eventPath = if ($eventData.ContainsKey('FilePath')) {
      $eventData.FilePath.Trim()
    } elseif ($eventData.ContainsKey('FileName')) {
      $eventData.FileName.Trim()
    } else { '' }
    foreach ($objectName in @('FileObject', 'FileKey')) {
      if ($eventPath -and $eventData.ContainsKey($objectName) -and
          $eventData[$objectName]) {
        $filePaths[$eventData[$objectName].Trim()] = $eventPath
      }
    }
    if (-not $eventPath) {
      foreach ($objectName in @('FileObject', 'FileKey')) {
        if ($eventData.ContainsKey($objectName) -and $eventData[$objectName] -and
            $filePaths.ContainsKey($eventData[$objectName].Trim())) {
          $eventPath = $filePaths[$eventData[$objectName].Trim()]
          break
        }
      }
    }
    if ($ProcessIds.Contains($eventProcessId) -and
        $eventId -in $fileMutationEventIds -and $eventPath -and
        $appHostFileWrites.Count -lt 30 -and
        (Test-AppOwnedHostPath -Candidate $eventPath `
          -DirectoryTails $HostDirectoryTails -FileTails $HostFileTails)) {
      $payload = @($eventData.GetEnumerator() | Sort-Object Key |
        ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '
      $appHostFileWrites.Add(
        "event $eventId, process $eventProcessId, path $eventPath`: $payload"
      )
    }
    if ($eventId -eq $fileEventId.NameDelete -and
        $eventData.ContainsKey('FileKey') -and $eventData.FileKey) {
      $filePaths.Remove($eventData.FileKey.Trim())
    }
  }

  Get-NormalizedTraceEvents -TraceFile $OutputFile -ProviderName $registryProviderName | ForEach-Object {
    $event = $_
    if ($null -eq $event.ProcessId -or
        $event.ProviderName -ne $registryProviderName) {
      return
    }

    $eventProcessId = $event.ProcessId
    $eventId = $event.EventId
    $eventData = $event.Data
    if ($eventId -in @($registryEventId.CreateKey, $registryEventId.OpenKey) -and
        $eventData.ContainsKey('Status') -and
        (Convert-RegistryEventNumber $eventData.Status) -eq
          $registrySuccessStatus -and
        $eventData.ContainsKey('KeyObject') -and $eventData.KeyObject) {
      $basePath = if ($eventData.ContainsKey('BaseName')) {
        $eventData.BaseName.Trim()
      } else { '' }
      $baseObject = if ($eventData.ContainsKey('BaseObject')) {
        $eventData.BaseObject.Trim()
      } else { '' }
      if ($registryKeyPaths.ContainsKey($baseObject)) {
        $trackedBasePath = $registryKeyPaths[$baseObject]
        if (-not $basePath) {
          $basePath = $trackedBasePath
        } elseif ($basePath -notmatch '^(?:\\REGISTRY\\|HKEY_)') {
          $basePath = "$trackedBasePath\$basePath"
        }
      }
      $relativePath = if ($eventData.ContainsKey('RelativeName')) {
        $eventData.RelativeName.Trim()
      } else { '' }
      $keyPath = if ($basePath -and $relativePath) {
        "$basePath\$relativePath"
      } elseif ($relativePath) {
        $relativePath
      } else {
        $basePath
      }
      if ($keyPath) {
        $registryKeyPaths[$eventData.KeyObject.Trim()] = $keyPath
      }
    }
    $keyName = if ($eventData.ContainsKey('KeyName')) {
      $eventData.KeyName.Trim()
    } else { '' }
    if (-not $keyName -and
        $eventData.ContainsKey('KeyObject') -and $eventData.KeyObject -and
        $registryKeyPaths.ContainsKey($eventData.KeyObject.Trim())) {
      $eventData.ResolvedKeyName = $registryKeyPaths[$eventData.KeyObject.Trim()]
    }
    $payload = @($eventData.GetEnumerator() | Sort-Object Key |
      ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '
    $description = "event $eventId, process $eventProcessId`: $payload"
    if ($eventId -eq $registryEventId.Close -and
        $eventData.ContainsKey('KeyObject') -and $eventData.KeyObject) {
      $registryKeyPaths.Remove($eventData.KeyObject.Trim())
    }
    $isAppProcess = $ProcessIds.Contains($eventProcessId)
    if (-not (Test-PortableHostRegistryMutation -EventId $eventId `
        -EventData $eventData)) {
      return
    }
    if ($isAppProcess) {
      if ($appRegistryWrites.Count -lt 30) { $appRegistryWrites.Add($description) }
    } elseif ($externalOpenTubeXRegistryWrites.Count -lt 30) {
      $externalOpenTubeXRegistryWrites.Add($description)
    }
  }

  if ($appRegistryWrites.Count -gt 0) {
    $details = $appRegistryWrites | Select-Object -First 30 | Out-String
    throw "The portable OpenTubeX process changed application-owned host registry state:`n$details"
  }
  if ($externalOpenTubeXRegistryWrites.Count -gt 0) {
    $details = $externalOpenTubeXRegistryWrites | Select-Object -First 30 | Out-String
    throw "Windows changed OpenTubeX registry state outside the portable process:`n$details"
  }
  if ($appHostFileWrites.Count -gt 0) {
    $details = $appHostFileWrites | Select-Object -First 30 | Out-String
    throw "The portable OpenTubeX process changed app-owned host files:`n$details"
  }
}
