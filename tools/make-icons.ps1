# 產生 PWA 圖示（PNG）：深藍底、青色對話框、白色「譯」字。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-icons.ps1
# 注意：本檔需存成 UTF-8 BOM，Windows PowerShell 5.1 才讀得懂中文。
Add-Type -AssemblyName System.Drawing
$outDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-Icon([int]$size, [string]$file, [double]$pad) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::FromArgb(15, 23, 42))          # #0f172a

  # 內容區（maskable 圖示要留安全邊界）
  $inner = $size * (1 - 2 * $pad)
  $x0 = $size * $pad
  # 對話框
  $bw = $inner * 0.78; $bh = $inner * 0.62
  $bx = $x0 + ($inner - $bw) / 2; $by = $x0 + $inner * 0.12
  $r = $bh * 0.28
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($bx, $by, 2 * $r, 2 * $r, 180, 90)
  $path.AddArc($bx + $bw - 2 * $r, $by, 2 * $r, 2 * $r, 270, 90)
  $path.AddArc($bx + $bw - 2 * $r, $by + $bh - 2 * $r, 2 * $r, 2 * $r, 0, 90)
  $path.AddLine($bx + $bw * 0.42, $by + $bh, $bx + $bw * 0.22, $by + $bh + $inner * 0.16)
  $path.AddLine($bx + $bw * 0.24, $by + $bh, $bx + $r, $by + $bh)
  $path.AddArc($bx, $by + $bh - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(34, 211, 238))), $path)   # #22d3ee

  # 「譯」字
  $font = New-Object System.Drawing.Font('Microsoft JhengHei', [single]($bh * 0.62), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF ([single]$bx), ([single]($by + $bh * 0.04)), ([single]$bw), ([single]$bh)
  $g.DrawString('譯', $font, (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(8, 47, 73))), $rect, $sf)   # #082f49

  $path.Dispose(); $font.Dispose(); $g.Dispose()
  $bmp.Save((Join-Path $outDir $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "已產生 icons/$file"
}

New-Icon 192 'icon-192.png' 0.08
New-Icon 512 'icon-512.png' 0.08
New-Icon 512 'icon-maskable-512.png' 0.18     # maskable：內容縮在中間 80% 安全區
New-Icon 180 'apple-touch-icon.png' 0.08      # iOS 加入主畫面用
