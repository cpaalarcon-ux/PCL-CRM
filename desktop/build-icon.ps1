param([switch] $StoreAssets)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Write-Icon($Source, [int] $Width, [int] $Height, [string] $Path) {
    $icon = [System.Drawing.Bitmap]::new($Width, $Height)
    $canvas = [System.Drawing.Graphics]::FromImage($icon)
    try {
        $canvas.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $size = [Math]::Min($Width, $Height)
        $x = [int](($Width - $size) / 2)
        $y = [int](($Height - $size) / 2)
        $canvas.DrawImage($Source, $x, $y, $size, $size)
        $icon.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $canvas.Dispose()
        $icon.Dispose()
    }
}

$source = [System.Drawing.Bitmap]::new((Join-Path $PSScriptRoot 'icon.png'))
try {
    Write-Icon $source 256 256 (Join-Path $PSScriptRoot 'win-icon.png')
    if ($StoreAssets) {
        $assets = Join-Path $PSScriptRoot 'store-assets/appx'
        New-Item -ItemType Directory -Force $assets | Out-Null
        Write-Icon $source 50 50 (Join-Path $assets 'StoreLogo.png')
        Write-Icon $source 44 44 (Join-Path $assets 'Square44x44Logo.png')
        Write-Icon $source 150 150 (Join-Path $assets 'Square150x150Logo.png')
        Write-Icon $source 310 150 (Join-Path $assets 'Wide310x150Logo.png')
    }
}
finally {
    $source.Dispose()
}
