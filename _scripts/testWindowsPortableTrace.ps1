param([switch] $Stress)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'windowsPortableTrace.ps1')

# Replay decoded tracerpt output through the actual isolation assertion.
function tracerpt.exe { $global:LASTEXITCODE = 0 }

function New-TraceEvent {
  param([string] $Provider, [int] $Id, [int] $ProcessId, [string] $Data)
  return "<Event><System><Provider Name='$Provider'/><EventID>$Id</EventID><Execution ProcessID='$ProcessId'/></System><EventData>$Data</EventData></Event>"
}

$directory = Join-Path ([IO.Path]::GetTempPath()) "portable-trace-test-$([Guid]::NewGuid())"
New-Item $directory -ItemType Directory | Out-Null
$tracePath = Join-Path $directory 'trace.xml'
$noise = New-TraceEvent $registryProviderName $registryEventId.OpenKey 999 `
  "<Data Name='Status'>0x0</Data><Data Name='KeyObject'>noise</Data><Data Name='RelativeName'>HKEY_CURRENT_USER\Software\Other</Data><Data Name='Padding'>$('x' * 4096)</Data>"
$child = New-TraceEvent $processProviderName $processStartEventId 100 `
  "<Data Name='ProcessID'>101</Data><Data Name='ParentProcessID'>100</Data>"
$open = New-TraceEvent $registryProviderName $registryEventId.OpenKey 101 `
  "<Data Name='Status'>0x0</Data><Data Name='KeyObject'>app</Data><Data Name='RelativeName'>HKEY_CURRENT_USER\Software\OpenTubeX</Data>"
$write = New-TraceEvent $registryProviderName $registryEventId.SetValue 101 `
  "<Data Name='Status'>0x0</Data><Data Name='KeyObject'>app</Data>"
$fileName = New-TraceEvent $fileProviderName $fileEventId.NameCreate 999 `
  "<Data Name='FileKey'>file</Data><Data Name='FileName'>C:\Users\test\AppData\Roaming\OpenTubeX\settings.db</Data>"
$fileWrite = New-TraceEvent $fileProviderName $fileEventId.Write 101 `
  "<Data Name='FileKey'>file</Data>"

function Write-Fixture {
  param([string] $Events, [int] $NoiseCount = 0)
  $writer = [IO.StreamWriter]::new($tracePath)
  try {
    $writer.Write('<Events xmlns="http://schemas.microsoft.com/win/2004/08/events/event">')
    for ($i = 0; $i -lt $NoiseCount; $i++) { $writer.Write($noise) }
    $writer.Write($Events)
    $writer.Write('</Events>')
  } finally { $writer.Dispose() }
}

function Assert-Fixture {
  param([string] $ExpectedError = '')
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  $ids.Add(100) | Out-Null
  $failure = ''
  try {
    Assert-NoAppOwnedHostWrites -TraceFile 'unused.etl' -OutputFile $tracePath `
      -ProcessIds $ids -HostDirectoryTails @('\USERS\TEST\APPDATA\ROAMING\OPENTUBEX') `
      -HostFileTails @('\USERS\TEST\START MENU\OPENTUBEX.LNK')
  } catch { $failure = $_.Exception.Message }
  if ($ExpectedError) {
    if (-not $failure.Contains($ExpectedError)) {
      throw "Expected '$ExpectedError', got '$failure'"
    }
  } elseif ($failure) { throw $failure }
}

try {
  if ($Stress) {
    # About 50 MiB of XML, larger than the test process can hold as a DOM.
    # The final mutation must still be checked; truncating the trace is unsafe.
    Write-Fixture "$open$write$child" -NoiseCount 12000
    Assert-Fixture 'The portable OpenTubeX process changed application-owned host registry state'
  } else {
    Write-Fixture "$noise$child"
    Assert-Fixture
    # Process-start records may appear after their child's writes in ETW output.
    Write-Fixture "$open$write$child"
    Assert-Fixture 'The portable OpenTubeX process changed application-owned host registry state'
    Write-Fixture "$open$write"
    Assert-Fixture 'Windows changed OpenTubeX registry state outside the portable process'
    Write-Fixture "$fileName$fileWrite$child"
    Assert-Fixture 'The portable OpenTubeX process changed app-owned host files'
    Write-Fixture "$open$noise$child"
    Assert-Fixture
    Set-Content $tracePath '<Events><Event>'
    Assert-Fixture 'Unexpected end of file'
  }
  Write-Output 'Windows portable trace replay tests passed.'
} finally { Remove-Item $directory -Recurse -Force }
