#!/usr/bin/env node
// Run from the Personal Toolbox folder. No additional npm packages are needed.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function quotePowerShell(value) {
  return "'" + value.replace(/'/g, "''") + "'";
}

function planRepair(root, arch) {
  if (!['x64', 'arm64', 'ia32'].includes(arch)) throw new Error('Unsupported Windows architecture: ' + arch);
  const packagePath = require.resolve('electron/package.json', { paths: [root] });
  const electronDir = path.dirname(packagePath);
  const { version } = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Unexpected Electron version.');
  const asset = `electron-v${version}-win32-${arch}.zip`;
  const checksums = JSON.parse(fs.readFileSync(path.join(electronDir, 'checksums.json'), 'utf8'));
  const checksum = checksums[asset];
  if (!/^[a-f0-9]{64}$/i.test(checksum || '')) throw new Error('No trusted checksum for ' + asset);
  const url = `https://github.com/electron/electron/releases/download/v${version}/${asset}`;
  const dist = path.join(electronDir, 'dist');
  const command = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ('toolbox-electron-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir | Out-Null
try {
  $zip = Join-Path $tempDir 'electron.zip'
  Write-Host '1/3 Downloading official Electron ${version} (${arch}). This may take several minutes...'
  Invoke-WebRequest -UseBasicParsing -Uri ${quotePowerShell(url)} -OutFile $zip -TimeoutSec 600
  Write-Host '2/3 Verifying SHA-256...'
  if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne ${quotePowerShell(checksum)}) { throw 'Checksum mismatch. Nothing was installed.' }
  Write-Host '3/3 Extracting Electron...'
  Expand-Archive -LiteralPath $zip -DestinationPath ${quotePowerShell(dist)} -Force
} finally {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
`;
  return { electronDir, version, url, checksum, command };
}

function main() {
  if (process.platform !== 'win32' && !process.argv.includes('--check')) throw new Error('Run this repair on your Windows PC.');
  const plan = planRepair(process.cwd(), process.arch);
  if (process.argv.includes('--check')) {
    console.log('Repair plan valid. No changes made.');
    console.log('Download: ' + plan.url);
    console.log('SHA-256: ' + plan.checksum);
    return;
  }
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', plan.command], { stdio: 'inherit', windowsHide: true, timeout: 720000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Download or extraction failed. Copy the error above; do not reinstall npm dependencies.');
  const executable = path.join(plan.electronDir, 'dist', 'electron.exe');
  if (!fs.existsSync(executable)) throw new Error('Extraction finished but electron.exe is missing.');
  const version = fs.readFileSync(path.join(plan.electronDir, 'dist', 'version'), 'utf8').trim().replace(/^v/, '');
  if (version !== plan.version) throw new Error('Extracted Electron version does not match the installed package.');
  fs.writeFileSync(path.join(plan.electronDir, 'path.txt'), 'electron.exe', 'utf8');
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) console.log('Note: ELECTRON_OVERRIDE_DIST_PATH is set. Clear that variable before launching with npm.');
  console.log('REPAIR COMPLETE. Run: npm run dev');
}

if (require.main === module) {
  try { main(); } catch (error) { console.error('REPAIR FAILED: ' + error.message); process.exitCode = 1; }
}
module.exports = { planRepair, quotePowerShell };
