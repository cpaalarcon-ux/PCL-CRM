$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Bitmap]::new((Join-Path $PSScriptRoot 'icon.png'))
$icon = [System.Drawing.Bitmap]::new(256, 256)
$canvas = [System.Drawing.Graphics]::FromImage($icon)
try {
    $canvas.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $canvas.DrawImage($source, 0, 0, 256, 256)
    $icon.Save((Join-Path $PSScriptRoot 'win-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $canvas.Dispose()
    $icon.Dispose()
    $source.Dispose()
}
