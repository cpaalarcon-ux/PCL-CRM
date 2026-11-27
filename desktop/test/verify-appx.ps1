$ErrorActionPreference = 'Stop'
$packages = @(Get-ChildItem 'dist-store' -Filter '*.appx')
if ($packages.Count -ne 1) { throw 'Expected one Windows Store package.' }
$archive = [IO.Compression.ZipFile]::OpenRead($packages[0].FullName)
try {
    $manifest = $archive.GetEntry('AppxManifest.xml')
    if ($null -eq $manifest) { throw 'The Windows package has no manifest.' }
    $reader = [IO.StreamReader]::new($manifest.Open())
    try { [xml]$xml = $reader.ReadToEnd() }
    finally { $reader.Dispose() }
    $identity = $xml.Package.Identity
    if ($identity.Name -cne $env:PCL_STORE_IDENTITY_NAME -or
        $identity.Publisher -cne $env:PCL_STORE_PUBLISHER -or
        $xml.Package.Properties.PublisherDisplayName -cne $env:PCL_STORE_PUBLISHER_DISPLAY_NAME -or
        $identity.ProcessorArchitecture -ne 'x64' -or
        $identity.Version -ne '1.0.0.0') {
        throw 'The Windows package identity, architecture or version did not match this release.'
    }
    if ($null -eq $archive.GetEntry('app/resources/app.asar')) {
        throw 'The Windows package does not contain the desktop app.'
    }
    Get-FileHash -LiteralPath $packages[0].FullName -Algorithm SHA256
}
finally { $archive.Dispose() }
