# Daily stock secretary (holdings tracking + rule signals) + email.
# Called by run_daily_stock_secretary.ps1 (TW, Mon-Fri 08:00) and
# run_us_stock_secretary.ps1 (US, Mon-Fri 21:00 Taipei).
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads .ps1 as system ANSI (Big5),
# so UTF-8 Chinese comments get mangled and break parsing.
# -IgnoreTradingDay: manual test run on a weekend/holiday (still generates and emails).
param(
    [Parameter(Mandatory = $true)][ValidateSet("tw", "us")][string]$Market,
    [switch]$IgnoreTradingDay
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

$LogDir = Join-Path $ProjectRoot "reports\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }
$LogFile = Join-Path $LogDir ("secretary-$Market-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
function Log($text) { $text | Out-File $LogFile -Append -Encoding utf8 }

Log "===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Stock secretary ($Market) ====="
$NodeArgs = @(".\stock_secretary.mjs", ".\holdings.csv", "--market", $Market)
if (-not $IgnoreTradingDay) { $NodeArgs += "--trading-day-only" }
node @NodeArgs 2>&1 | Out-File $LogFile -Append -Encoding utf8
$NodeExit = $LASTEXITCODE
Log "secretary exit code: $NodeExit"

# Exit code 10 = not a trading day (weekend / exchange holiday): skip email, not a failure.
if ($NodeExit -eq 10) {
    Log "run result: SKIPPED (not a trading day)"
    exit 0
}

$mailOk = $true
Log "----- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Sending email report -----"
try {
    $ErrorActionPreference = "Stop"
    $cfgPath = Join-Path $ProjectRoot "config.local.json"
    $cfg = @{}
    if (Test-Path $cfgPath) {
        $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    $gmailAddr = $cfg.GMAIL_ADDRESS
    $appPass = $cfg.GMAIL_APP_PASSWORD
    $mailTo = $cfg.ETF_MAIL_TO
    if (-not $mailTo) { $mailTo = $gmailAddr }

    if ($gmailAddr -and $appPass) {
        $reportPath = Join-Path $ProjectRoot "reports\latest-$Market.html"
        $bodyPath = Join-Path $ProjectRoot "reports\latest-$Market-mail.html"
        if ((Test-Path $reportPath) -and (Test-Path $bodyPath)) {
            $today = Get-Date -Format "yyyy-MM-dd"
            $label = if ($Market -eq "tw") { "TW" } else { "US" }

            $smtp = New-Object System.Net.Mail.SmtpClient("smtp.gmail.com", 587)
            $smtp.EnableSsl = $true
            $smtp.Credentials = New-Object System.Net.NetworkCredential($gmailAddr, $appPass)
            $smtp.Timeout = 10000

            $msg = New-Object System.Net.Mail.MailMessage
            $msg.From = New-Object System.Net.Mail.MailAddress($gmailAddr, "Stock Secretary")
            foreach ($to in ($mailTo -split "[;,]")) {
                $t = $to.Trim()
                if ($t) { $msg.To.Add($t) }
            }
            $msg.Subject = "Stock Secretary $label $today"
            $msg.SubjectEncoding = [System.Text.Encoding]::UTF8
            $msg.Body = Get-Content $bodyPath -Raw -Encoding UTF8
            $msg.IsBodyHtml = $true
            $msg.BodyEncoding = [System.Text.Encoding]::UTF8

            $attach = New-Object System.Net.Mail.Attachment($reportPath)
            $attach.Name = "secretary-$Market-$today.html"
            $msg.Attachments.Add($attach)

            $smtp.Send($msg)
            Log "Email sent to: $($msg.To.ToString())"

            $attach.Dispose()
            $msg.Dispose()
            $smtp.Dispose()
        } else {
            Log "Report file not found"
            $mailOk = $false
        }
    } else {
        Log "[SKIP] Gmail credentials not configured"
    }
} catch {
    Log "[ERROR] Email failed: $_"
    $mailOk = $false
}

if ($mailOk -and $NodeExit -eq 0) {
    Log "run result: OK"
    exit 0
} else {
    Log "run result: FAILED (secretary exit $NodeExit, mail ok: $mailOk)"
    exit 1
}
