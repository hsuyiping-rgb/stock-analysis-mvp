# Daily institutional (foreign/investment-trust) hot-stock + cost-line snapshot & email.
# Scheduled by Windows Task Scheduler (Mon-Fri 18:30, staggered after the ETF job).
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads .ps1 as system ANSI (Big5),
# so UTF-8 Chinese comments get mangled and break parsing.

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

$LogDir = Join-Path $ProjectRoot "data\institutional\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }
$LogFile = Join-Path $LogDir ("run-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Fetching institutional flows =====" | Out-File $LogFile -Append -Encoding utf8
node .\institutional_flows.mjs 2>&1 | Out-File $LogFile -Append -Encoding utf8
"flows exit code: $LASTEXITCODE" | Out-File $LogFile -Append -Encoding utf8

"----- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Generating analysis report -----" | Out-File $LogFile -Append -Encoding utf8
node .\institutional_analysis.mjs 2>&1 | Out-File $LogFile -Append -Encoding utf8
"analysis exit code: $LASTEXITCODE" | Out-File $LogFile -Append -Encoding utf8

# Email the report. Exit code reflects whether the email was sent.
$mailOk = $true
"----- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Sending email report -----" | Out-File $LogFile -Append -Encoding utf8
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
        $reportPath = Join-Path $ProjectRoot "reports\institutional-analysis-latest.html"
        $summaryPath = Join-Path $ProjectRoot "reports\institutional-analysis-summary.txt"

        if (Test-Path $reportPath) {
            $summary = ""
            if (Test-Path $summaryPath) { $summary = Get-Content $summaryPath -Raw -Encoding UTF8 }

            Add-Type -AssemblyName System.Web
            $encodedSummary = [System.Web.HttpUtility]::HtmlEncode($summary)
            $today = Get-Date -Format "yyyy-MM-dd"

            $bodyHtml = "<div style=`"font-family:Arial,sans-serif;line-height:1.6;`"><p>Institutional Hot Stocks + Cost Lines for $today</p><pre style=`"font-size:12px;background:#f5f5f5;padding:10px;`">$encodedSummary</pre></div>"

            $smtp = New-Object System.Net.Mail.SmtpClient("smtp.gmail.com", 587)
            $smtp.EnableSsl = $true
            $smtp.Credentials = New-Object System.Net.NetworkCredential($gmailAddr, $appPass)
            $smtp.Timeout = 10000

            $msg = New-Object System.Net.Mail.MailMessage
            $msg.From = New-Object System.Net.Mail.MailAddress($gmailAddr, "Institutional Report")
            foreach ($to in ($mailTo -split "[;,]")) {
                $t = $to.Trim()
                if ($t) { $msg.To.Add($t) }
            }
            $msg.Subject = "Institutional Hot Stocks $today"
            $msg.SubjectEncoding = [System.Text.Encoding]::UTF8
            $msg.Body = $bodyHtml
            $msg.IsBodyHtml = $true
            $msg.BodyEncoding = [System.Text.Encoding]::UTF8

            $attach = New-Object System.Net.Mail.Attachment($reportPath)
            $attach.Name = "institutional-analysis-$today.html"
            $msg.Attachments.Add($attach)

            $smtp.Send($msg)
            "Email sent to: $($msg.To.ToString())" | Out-File $LogFile -Append -Encoding utf8

            $attach.Dispose()
            $msg.Dispose()
            $smtp.Dispose()
        } else {
            "Report file not found" | Out-File $LogFile -Append -Encoding utf8
            $mailOk = $false
        }
    } else {
        "[SKIP] Gmail credentials not configured" | Out-File $LogFile -Append -Encoding utf8
    }
} catch {
    "[ERROR] Email failed: $_" | Out-File $LogFile -Append -Encoding utf8
    $mailOk = $false
}

if ($mailOk) {
    "run result: OK" | Out-File $LogFile -Append -Encoding utf8
    exit 0
} else {
    "run result: FAILED (email did not complete)" | Out-File $LogFile -Append -Encoding utf8
    exit 1
}
