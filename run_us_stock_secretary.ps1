# US holdings secretary. Scheduled Mon-Fri 21:00 Taipei (before US market open).
& (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "run_stock_secretary.ps1") -Market us
exit $LASTEXITCODE
