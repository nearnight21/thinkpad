[CmdletBinding()]
param(
  [string]$CanonicalBranch = 'main'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$remoteBranch = "origin/$CanonicalBranch"

function Get-GitText {
  param([Parameter(Mandatory)] [string[]]$Arguments)

  $result = & git -C $repositoryRoot @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Git command failed: git -C $repositoryRoot $($Arguments -join ' ')"
  }
  return ($result -join "`n").Trim()
}

function Invoke-Git {
  param([Parameter(Mandatory)] [string[]]$Arguments)

  & git -C $repositoryRoot @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Git command failed: git -C $repositoryRoot $($Arguments -join ' ')"
  }
}

function Test-GitAncestor {
  param(
    [Parameter(Mandatory)] [string]$Ancestor,
    [Parameter(Mandatory)] [string]$Descendant
  )

  & git -C $repositoryRoot merge-base --is-ancestor $Ancestor $Descendant
  return $LASTEXITCODE -eq 0
}

$branch = Get-GitText -Arguments @('branch', '--show-current')
if ($branch -ne $CanonicalBranch) {
  throw "Current branch is $branch; expected canonical branch $CanonicalBranch."
}

if (Get-GitText -Arguments @('status', '--porcelain')) {
  throw 'Worktree has uncommitted or untracked files. Synchronization stopped.'
}

$origin = Get-GitText -Arguments @('remote', 'get-url', 'origin')
if (-not $origin) {
  throw 'Remote origin is not configured. Synchronization stopped.'
}

Invoke-Git -Arguments @(
  'fetch', '--prune', 'origin',
  "+refs/heads/${CanonicalBranch}:refs/remotes/origin/$CanonicalBranch"
)

$localHead = Get-GitText -Arguments @('rev-parse', 'HEAD')
& git -C $repositoryRoot show-ref --verify --quiet "refs/remotes/$remoteBranch"
if ($LASTEXITCODE -ne 0) {
  throw "Remote branch $remoteBranch does not exist. Synchronization stopped."
}
$remoteHead = Get-GitText -Arguments @('rev-parse', $remoteBranch)

if ($localHead -eq $remoteHead) {
  Write-Host "Synchronization succeeded: $CanonicalBranch is current."
} elseif (Test-GitAncestor -Ancestor $localHead -Descendant $remoteHead) {
  Invoke-Git -Arguments @('merge', '--ff-only', $remoteBranch)
  Write-Host "Synchronization succeeded: $CanonicalBranch was fast-forwarded."
} else {
  $relation = if (Test-GitAncestor -Ancestor $remoteHead -Descendant $localHead) {
    'ahead of origin'
  } else {
    'diverged from origin'
  }
  throw "$CanonicalBranch is ${relation}. Synchronization stopped without changing history."
}
