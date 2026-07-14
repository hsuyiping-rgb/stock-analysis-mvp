$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

$LogDir = Join-Path $ProjectRoot "data\etf_holdings\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }
$LogFile = Join-Path $LogDir ("run-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 開始抓取 ETF 持股快照 =====" | Out-File $LogFile -Append -Encoding utf8
node .\etf_holdings.mjs 2>&1 | Out-File $LogFile -Append -Encoding utf8
"exit code: $LASTEXITCODE" | Out-File $LogFile -Append -Encoding utf8
exit $LASTEXITCODE
