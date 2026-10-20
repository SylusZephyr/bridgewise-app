# Generates the walkthrough voice-over with Windows' built-in speech voices.
# One WAV per narration line: walkthrough/voice/<id>.wav (+ <id>-zh.wav for Chinese).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/walkthrough-voice.ps1
Add-Type -AssemblyName System.Speech
$root = Split-Path -Parent $PSScriptRoot
$narration = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'walkthrough-narration.json') | ConvertFrom-Json
$out = Join-Path $root 'walkthrough\voice'
New-Item -ItemType Directory -Force $out | Out-Null

function Say([string]$voice, [string]$text, [string]$file, [int]$rate) {
  # A livelier read than the default: faster, a little higher, louder.
  $lang = if ($voice -like '*Huihui*') { 'zh-CN' } else { 'en-US' }
  $t = [System.Security.SecurityElement]::Escape($text)
  $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='$lang'><voice name='$voice'><prosody rate='+12%' pitch='+2st' volume='loud'>$t</prosody></voice></speak>"
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SetOutputToWaveFile($file)
  $s.SpeakSsml($ssml)
  $s.Dispose()
}

foreach ($p in $narration.PSObject.Properties) {
  Say 'Microsoft Zira Desktop' $p.Value.say (Join-Path $out "$($p.Name).wav") 0
  if ($p.Value.sayZh) { Say 'Microsoft Huihui Desktop' $p.Value.sayZh (Join-Path $out "$($p.Name)-zh.wav") -1 }
}
Write-Output "voice written to $out"
