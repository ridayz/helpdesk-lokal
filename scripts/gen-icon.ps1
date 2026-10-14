# Bikin assets/icon.ico: container ICO proper + PNG 256px (logo Indonet + bg pastel).
# Jalanin: powershell -File scripts/gen-icon.ps1
Add-Type -AssemblyName System.Drawing
$size = 256
$root = Split-Path $PSScriptRoot -Parent
$assets = Join-Path $root 'assets'
New-Item -ItemType Directory -Force $assets | Out-Null
$logo = [System.Drawing.Image]::FromFile((Join-Path $assets 'logo-indonet.png'))
$out = Join-Path $assets 'icon.ico'
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.InterpolationMode = 'HighQualityBicubic'
$rect = New-Object -TypeName System.Drawing.Rectangle -ArgumentList 0, 0, $size, $size
$br = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
  [System.Drawing.ColorTranslator]::FromHtml('#1a1a1a'),
  [System.Drawing.ColorTranslator]::FromHtml('#000000'), 45)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(8, 8, 120, 120, 180, 90)
$path.AddArc(128, 8, 120, 120, 270, 90)
$path.AddArc(128, 128, 120, 120, 0, 90)
$path.AddArc(8, 128, 120, 120, 90, 90)
$path.CloseFigure()
$g.FillPath($br, $path)
$edge = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#ff7a00'), 6)
$g.DrawPath($edge, $path)
$pad = 36
$scale = [Math]::Min(($size - $pad * 2) / $logo.Width, ($size - $pad * 2) / $logo.Height)
$dw = [int]($logo.Width * $scale)
$dh = [int]($logo.Height * $scale)
$g.DrawImage($logo, [int](($size - $dw) / 2), [int](($size - $dh) / 2), $dw, $dh)
$ms = New-Object IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$fs = [IO.File]::Create($out)
$bw = New-Object IO.BinaryWriter($fs)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)
$bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$png.Length); $bw.Write([uint32]22)
$bw.Write($png)
$bw.Close(); $fs.Close()
$g.Dispose(); $bmp.Dispose(); $logo.Dispose()
Write-Output "icon OK: $out"
