$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windowsPortableTrace.ps1')
& (Join-Path $PSScriptRoot 'testWindowsPortableRegistryTrace.ps1')
& node --test (Join-Path $PSScriptRoot '../tests/unit/windows-portable-trace.test.mjs')
if ($LASTEXITCODE -ne 0) {
  throw 'The Windows portable trace replay tests failed'
}

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class WindowsPortableSmoke
{
    private const int ShowWindowMinimize = 6;

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    public static IntPtr[] GetVisibleWindows(uint processId)
    {
        var windows = new List<IntPtr>();
        EnumWindows((window, parameter) =>
        {
            GetWindowThreadProcessId(window, out uint ownerProcessId);
            if (ownerProcessId == processId && IsWindowVisible(window))
                windows.Add(window);
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static void MinimizeVisibleWindows(uint processId)
    {
        foreach (var window in GetVisibleWindows(processId))
            ShowWindow(window, ShowWindowMinimize);
    }

}
'@

function Get-MatchingRegistryState {
  param(
    [Parameter(Mandatory)] [string] $Root,
    [Parameter(Mandatory)] [string] $Search
  )

  $result = & reg.exe query $Root /s /f $Search 2>$null
  if ($LASTEXITCODE -ne 0) {
    return @()
  }
  return @(ConvertTo-MatchingRegistryState -Lines @($result) -Search $Search)
}

function Get-HostState {
  $programsDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  $paths = @(
    (Join-Path $env:APPDATA 'OpenTubeX'),
    (Join-Path $env:LOCALAPPDATA 'OpenTubeX')
  )
  $state = [System.Collections.Generic.List[string]]::new()
  foreach ($item in $paths) {
    if (Test-Path $item) {
      $pathItem = Get-Item $item
      $state.Add("$($pathItem.FullName)|$($pathItem.LastWriteTimeUtc.Ticks)")
      if ($pathItem -is [System.IO.DirectoryInfo]) {
        Get-ChildItem $item -Recurse | ForEach-Object {
          $state.Add("$($_.FullName)|$($_.LastWriteTimeUtc.Ticks)")
          if ($_ -isnot [System.IO.DirectoryInfo]) {
            $state.Add("$($_.FullName)|$((Get-FileHash -LiteralPath $_.FullName).Hash)")
          }
        }
      } else {
        $state.Add("$($pathItem.FullName)|$((Get-FileHash -LiteralPath $pathItem.FullName).Hash)")
      }
    }
  }
  if (Test-Path $programsDirectory) {
    Get-ChildItem $programsDirectory -Filter '*OpenTubeX*.lnk' -Recurse |
      ForEach-Object { $state.Add($_.FullName) }
  }
  foreach ($root in @('HKCU\Software')) {
    foreach ($line in @(Get-MatchingRegistryState -Root $root -Search 'OpenTubeX')) {
      $snapshotLine = "$root`: $line"
      if (Test-OpenTubeXRegistryPath -Path $line.Split(':', 2)[0]) {
        $state.Add($snapshotLine)
      }
    }
  }
  return @($state | Sort-Object -Unique)
}

function Update-AppProcessIds {
  param(
    [Parameter(Mandatory)] [int] $RootProcessId,
    [Parameter(Mandatory)] [AllowEmptyCollection()]
    [System.Collections.Generic.HashSet[int]] $ProcessIds
  )

  $ProcessIds.Add($RootProcessId) | Out-Null
  $processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  do {
    $added = $false
    foreach ($process in $processes) {
      if ($ProcessIds.Contains([int] $process.ParentProcessId) -and
          $ProcessIds.Add([int] $process.ProcessId)) {
        $added = $true
      }
    }
  } while ($added)
}

function Wait-ForMainWindow {
  param(
    [Parameter(Mandatory)] [int] $ProcessId,
    [int] $TimeoutSeconds = 45
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if ([WindowsPortableSmoke]::GetVisibleWindows($ProcessId).Count -gt 0) {
      return
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for the packaged OpenTubeX window from process $ProcessId"
}

function Get-PortableDiagnostics {
  param(
    [Parameter(Mandatory)] [string] $Shortcut,
    [Parameter(Mandatory)] [string] $DataDirectory,
    [Parameter(Mandatory)] [int] $RootProcessId,
    [Parameter(Mandatory)] [System.Collections.Generic.HashSet[int]] $ProcessIds
  )

  Update-AppProcessIds -RootProcessId $RootProcessId -ProcessIds $ProcessIds
  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.Add("Root process: $RootProcessId")
  foreach ($trackedId in $ProcessIds) {
    $process = Get-Process -Id $trackedId -ErrorAction SilentlyContinue
    if ($process) {
      $lines.Add("Process $trackedId is running: $($process.ProcessName)")
    } else {
      $lines.Add("Process $trackedId has exited")
    }
  }
  $lines.Add("Shortcut exists: $(Test-Path $Shortcut)")
  $lines.Add('Portable data files:')
  if (Test-Path $DataDirectory) {
    Get-ChildItem $DataDirectory -Recurse | ForEach-Object {
      $lines.Add($_.FullName)
    }
  }
  return $lines -join "`n"
}

function Stop-RegistryTrace {
  param([Parameter(Mandatory)] [string] $SessionName)

  $output = & logman.exe stop $SessionName -ets 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Could not stop the registry trace:`n$output"
  }
}

$portableDirectory = Resolve-Path 'build\win-unpacked'
$executable = Join-Path $portableDirectory 'OpenTubeX.exe'
$marker = Join-Path $portableDirectory 'portable.marker'
$dataDirectory = Join-Path $portableDirectory 'OpenTubeX-data'
$shortcut = Join-Path $dataDirectory 'OpenTubeX.lnk'
$appProcess = $null
$appProcessIds = [System.Collections.Generic.HashSet[int]]::new()
$traceId = [Guid]::NewGuid().ToString('N')
$traceDirectory = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$traceSession = "OpenTubeX-portable-$traceId"
$traceFile = Join-Path $traceDirectory "$traceSession.etl"
$traceOutputFile = Join-Path $traceDirectory "$traceSession.xml"
$traceProvidersFile = Join-Path $traceDirectory "$traceSession-providers.txt"
$kernelRegistryProvider = '{70EB4F03-C1DE-4F73-A051-33D13D5413BD}'
$kernelProcessProvider = '{22FB2CD6-0E7B-422B-A0C7-2FAD1FD0E716}'
$kernelFileProvider = '{EDD08927-9CC4-4E65-B970-C2560FB5C289}'
$allRegistryKeywords = '0xffff'
$processStartKeywords = '0x10'
$fileMutationKeywords = '0x1e30'
$verboseTraceLevel = 5
$traceStarted = $false
$hostDirectoryTails = @(
  (Get-ComparablePathTail (Join-Path $env:APPDATA 'OpenTubeX')),
  (Get-ComparablePathTail (Join-Path $env:LOCALAPPDATA 'OpenTubeX'))
)
$hostFileTails = @(
  (Get-ComparablePathTail (Join-Path $env:APPDATA `
    'Microsoft\Windows\Start Menu\Programs\OpenTubeX.lnk'))
)
$traceProviders = @(
  "$kernelRegistryProvider $allRegistryKeywords $verboseTraceLevel",
  "$kernelProcessProvider $processStartKeywords $verboseTraceLevel",
  "$kernelFileProvider $fileMutationKeywords $verboseTraceLevel"
)
Set-Content $traceProvidersFile -Value $traceProviders -Encoding ascii

foreach ($requiredFile in @(
  $executable, $marker,
  (Join-Path $portableDirectory 'version.dll'),
  (Join-Path $portableDirectory '.interposer/Config.yml')
)) {
  if (-not (Test-Path $requiredFile)) {
    throw "The Windows portable package is missing $requiredFile"
  }
}

$hostStateBefore = @(Get-HostState)
if (Test-Path $dataDirectory) {
  Remove-Item $dataDirectory -Recurse -Force
}
New-Item $dataDirectory -ItemType Directory | Out-Null

try {
  $traceOutput = & logman.exe start $traceSession -pf $traceProvidersFile `
    -o $traceFile -ets 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Could not start the registry trace:`n$traceOutput"
  }
  $traceStarted = $true

  $appProcess = Start-Process $executable -PassThru -ArgumentList @(
    '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'
  )
  Wait-ForMainWindow -ProcessId $appProcess.Id
  Update-AppProcessIds -RootProcessId $appProcess.Id -ProcessIds $appProcessIds

  [WindowsPortableSmoke]::MinimizeVisibleWindows($appProcess.Id)
  & node (Join-Path $PSScriptRoot 'testWindowsPortableNetwork.mjs') $dataDirectory
  if ($LASTEXITCODE -ne 0) {
    throw 'The packaged Windows portable application failed its network checks'
  }
  Update-AppProcessIds -RootProcessId $appProcess.Id -ProcessIds $appProcessIds
}
catch {
  if ($appProcess) {
    Write-Output (Get-PortableDiagnostics -Shortcut $shortcut -DataDirectory $dataDirectory `
      -RootProcessId $appProcess.Id `
      -ProcessIds $appProcessIds)
  }
  throw
}
finally {
  if ($appProcess) {
    Update-AppProcessIds -RootProcessId $appProcess.Id -ProcessIds $appProcessIds
  }
  if ($appProcess -and -not $appProcess.HasExited) {
    foreach ($trackedId in $appProcessIds) {
      Stop-Process -Id $trackedId -Force -ErrorAction SilentlyContinue
    }
    $appProcess.WaitForExit()
  }
  if ($traceStarted) {
    Stop-RegistryTrace -SessionName $traceSession
  }
}

try {
  Assert-NoAppOwnedHostWrites -TraceFile $traceFile -OutputFile $traceOutputFile `
    -ProcessIds $appProcessIds -HostDirectoryTails $hostDirectoryTails `
    -HostFileTails $hostFileTails
}
catch {
  Write-Output (Get-PortableDiagnostics -Shortcut $shortcut -DataDirectory $dataDirectory `
    -RootProcessId $appProcess.Id `
    -ProcessIds $appProcessIds)
  throw
}
$hostStateAfter = @(Get-HostState)
$hostChanges = @(Compare-Object $hostStateBefore $hostStateAfter)
if ($hostChanges.Count -gt 0) {
  throw "The portable package changed app-owned host state:`n$($hostChanges | Out-String)"
}

Write-Output 'Windows portable network and application data isolation checks passed.'
exit 0
