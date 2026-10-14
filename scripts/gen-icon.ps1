# Bikin assets/icon.ico dari logo Indonet resmi + background pastel.
# Jalanin: powershell -File scripts/gen-icon.ps1
Add-Type -AssemblyName System.Drawing
$size = 256
$root = Split-Path $PSScriptRoot -Parent
$assets = Join-Path $root 'assets'
$logoPath = Join-Path $assets 'logo-indonet.png'
$out = Join-Path $assets 'icon.ico'
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.InterpolationMode = 'HighQualityBicubic'
# background pastel rounded square
$rect = New-Object -TypeName System.Drawing.Rectangle -ArgumentList 0, 0, $size, $size
$br = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
  [System.Drawing.ColorTranslator]::FromHtml('#e0f2fe'),
  [System.Drawing.ColorTranslator]::FromHtml('#bae6fd'), 45)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(8, 8, 120, 120, 180, 90)
$path.AddArc(128, 8, 120, 120, 270, 90)
$path.AddArc(128, 128, 120, 120, 0, 90)
$path.AddArc(8, 128, 120, 120, 90, 90)
$path.CloseFigure()
$g.FillPath($br, $path)
# logo di tengah dengan padding
$logo = [System.Drawing.Image]::FromFile($logoPath)
$pad = 36
$maxW = $size - ($pad * 2)
$maxH = $size - ($pad * 2)
$scale = [Math]::Min($maxW / $logo.Width, $maxH / $logo.Height)
$dw = [int]($logo.Width * $scale)
$dh = [int]($logo.Height * $scale)
$dx = [int](($size - $dw) / 2)
$dy = [int](($size - $dh) / 2)
$g.DrawImage($logo, $dx, $dy, $dw, $dh)
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Icon)
$g.Dispose(); $bmp.Dispose(); $logo.Dispose()
Write-Output "icon OK: $out"
