# Promo voice-over: Windows' built-in voice, pushed to a livelier read with SSML
# (faster pace, raised pitch, emphasis on key words).
Add-Type -AssemblyName System.Speech
$dir = $PSScriptRoot
$out = Join-Path $dir 'out'
New-Item -ItemType Directory -Force $out | Out-Null
$lines = Get-Content -Raw -Encoding UTF8 (Join-Path $dir 'voice.json') | ConvertFrom-Json
foreach ($p in $lines.PSObject.Properties) {
  $text = [System.Security.SecurityElement]::Escape($p.Value) -replace '\*(.+?)\*', '<emphasis level="strong">$1</emphasis>'
  $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='Microsoft Zira Desktop'><prosody rate='+14%' pitch='+3st' volume='loud'>$text</prosody></voice></speak>"
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SetOutputToWaveFile((Join-Path $out "$($p.Name).wav")); $s.SpeakSsml($ssml); $s.Dispose()
}
"ok"
