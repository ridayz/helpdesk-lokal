# Bikin assets/icon.ico: badge biru awan + emoji karcis. Jalanin: powershell -File scripts/gen-icon.ps1
Add-Type -AssemblyName System.Drawing
$size = 256
$root = Split-Path $PSScriptRoot -Parent
$assets = Join-Path $root 'assets'
New-Item -ItemType Directory -Force $assets | Out-Null
$out = Join-Path $assets 'icon.ico'
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
# background gradient biru awan
$rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
$br = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
  [System.Drawing.ColorTranslator]::FromHtml('#0284c7'),
  [System.Drawing.ColorTranslator]::FromHtml('#075985'), 45)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(8, 8, 120, 120, 180, 90)
$path.AddArc($size - 128, 8, 120, 120, 270, 90)
$path.AddArc($size - 128, $size - 128, 120, 120, 0, 90)
$path.AddArc(8, $size - 128, 120, 120, 90, 90)
$path.CloseFigure()
$g.FillPath($br, $path)
$pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#bae6fd'), 10)
$g.DrawPath($pen, $path)
# glyph karcis (fallback huruf H)
$style = [System.Drawing.FontStyle]::Bold
$font = New-Object System.Drawing.Font('Segoe UI Emoji', 150, $style)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = 'Center'
$sf.LineAlignment = 'Center'
$box = New-Object -TypeName System.Drawing.RectangleF -ArgumentList 0, 10, 256, 246
try {
  $g.DrawString([char]::ConvertFromUtf32(0x1F39B), $font, [System.Drawing.Brushes]::White, $box, $sf)
} catch {
  $fb = New-Object System.Drawing.Font('Arial', 170, $style)
  $g.DrawString('H', $fb, [System.Drawing.Brushes]::White, $box, $sf)
}
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Icon)
$g.Dispose(); $bmp.Dispose()
Write-Output "icon OK: $out"
