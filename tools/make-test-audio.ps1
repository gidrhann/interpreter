# 用 Windows 內建語音合成（SAPI）產生測試音檔：16kHz、16-bit、mono 的 WAV。
# 需要已安裝 zh-TW 和 en-US 語音（Windows 預設是 Hanhan 和 Zira）。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-test-audio.ps1
Add-Type -AssemblyName System.Speech
$outDir = Join-Path $PSScriptRoot 'audio'
New-Item -ItemType Directory -Force $outDir | Out-Null

$items = @(
  @{ File = 'zh.wav'; Culture = 'zh-TW'; Text = '你好，我是醫師。請問你哪裡不舒服？發燒幾天了？' },
  @{ File = 'en.wav'; Culture = 'en-US'; Text = 'Hello doctor. I have had a fever and a sore throat for three days.' }
)
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

foreach ($it in $items) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq $it.Culture } | Select-Object -First 1
  if (-not $voice) { Write-Error "找不到 $($it.Culture) 語音"; continue }
  $synth.SelectVoice($voice.VoiceInfo.Name)
  $path = Join-Path $outDir $it.File
  $synth.SetOutputToWaveFile($path, $fmt)
  $synth.Speak($it.Text)
  $synth.Dispose()
  Write-Output "已產生 $path（$($voice.VoiceInfo.Name)）"
}
