# TW holdings secretary. Scheduled Mon-Fri 08:00 (before TW market open).
& (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "run_stock_secretary.ps1") -Market tw
exit $LASTEXITCODE
