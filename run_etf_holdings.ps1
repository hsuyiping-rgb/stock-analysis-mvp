$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

$LogDir = Join-Path $ProjectRoot "data\etf_holdings\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }
$LogFile = Join-Path $LogDir ("run-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 開始抓取 ETF 持股快照 =====" | Out-File $LogFile -Append -Encoding utf8
node .\etf_holdings.mjs 2>&1 | Out-File $LogFile -Append -Encoding utf8
$HoldingsExit = $LASTEXITCODE
"holdings exit code: $HoldingsExit" | Out-File $LogFile -Append -Encoding utf8

# 抓完快照後產生分析報告；分析失敗不影響排程狀態（快照才是不可回補的關鍵資料）。
"----- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 產生分析報告 -----" | Out-File $LogFile -Append -Encoding utf8
node .\etf_analysis.mjs 2>&1 | Out-File $LogFile -Append -Encoding utf8
"analysis exit code: $LASTEXITCODE" | Out-File $LogFile -Append -Encoding utf8

exit $HoldingsExit
