"""Build a Windows x64 ZIP with the embedded Wails launcher and Node service."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
import zipfile
from bundle_tosu import bundle_tosu

ROOT = Path(__file__).resolve().parents[2]
NODE_VERSION = '22.23.4'
NODE_SHA256 = 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20'
NODE_URL = f'https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-win-x64.zip'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--node-archive', type=Path)
    parser.add_argument('--go', default='go')
    args = parser.parse_args()
    subprocess.run(['npm.cmd' if os.name == 'nt' else 'npm', 'run', 'build'], cwd=ROOT, check=True)
    subprocess.run(['npm.cmd' if os.name == 'nt' else 'npm', 'run', 'build:launcher'], cwd=ROOT, check=True)
    out = ROOT / 'release'
    out.mkdir(exist_ok=True)
    archive = args.node_archive or out / f'node-v{NODE_VERSION}-win-x64.zip'
    if not archive.exists():
        urllib.request.urlretrieve(NODE_URL, archive)
    if sha(archive) != NODE_SHA256:
        raise RuntimeError('Official Windows Node archive SHA256 mismatch')
    stage = out / 'OCLR-Windows-x64'
    if stage.resolve().parent != out.resolve():
        raise RuntimeError('Package staging directory escaped release/')
    if stage.exists():
        shutil.rmtree(stage)
    app = stage / 'app'
    app.mkdir(parents=True)
    tosu = bundle_tosu(stage, out / 'tosu-cache')
    for folder in ['dist', 'server', 'src']:
        shutil.copytree(ROOT / folder, app / folder)
    shutil.copytree(ROOT / 'node_modules/rosu-pp-js', app / 'node_modules/rosu-pp-js')
    (app / 'package.json').write_text('{"type":"module","private":true,"license":"MIT"}\n', encoding='utf-8')
    digest = hashlib.sha256()
    inputs = sorted(p for p in app.rglob('*') if p.is_file())
    launcher_dir = ROOT / 'tools/windows-launcher'
    inputs += sorted(launcher_dir.glob('*.go'))
    inputs += sorted(launcher_dir.glob('*.syso'))
    inputs += [launcher_dir / 'go.mod', launcher_dir / 'go.sum']
    inputs += sorted(p for p in (launcher_dir / 'frontend/dist').rglob('*') if p.is_file())
    for path in inputs:
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    digest.update(NODE_SHA256.encode())
    digest.update(json.dumps(tosu, sort_keys=True).encode())
    build = digest.hexdigest()
    (app / 'portable-build.json').write_text(json.dumps({'build': build, 'node': NODE_VERSION, 'architecture': 'x64'}, indent=2)+'\n')
    runtime = stage / 'runtime'
    runtime.mkdir()
    with zipfile.ZipFile(archive) as source:
        prefix = f'node-v{NODE_VERSION}-win-x64/'
        for name in ['node.exe', 'LICENSE']:
            (runtime / name).write_bytes(source.read(prefix + name))
    env = dict(os.environ, GOOS='windows', GOARCH='amd64', CGO_ENABLED='0')
    env.setdefault('GOCACHE', str(out / '.go-cache'))
    subprocess.run([args.go, 'build', '-mod=readonly', '-tags', 'desktop,production', '-trimpath', '-ldflags', f'-H=windowsgui -s -w -X main.buildID={build}',
                    '-o', str(stage / 'OCLR.exe'), '.'], cwd=ROOT / 'tools/windows-launcher', env=env, check=True)
    shutil.copyfile(ROOT / 'docs/windows-portable.md', stage / '使用说明.txt')
    shutil.copyfile(ROOT / 'docs/verification/desktop-control/README.md', stage / '验证状态.txt')
    shutil.copyfile(ROOT / 'LICENSE', stage / 'LICENSE')
    shutil.copyfile(ROOT / 'THIRD_PARTY_NOTICES.md', stage / 'THIRD_PARTY_NOTICES.md')
    license_dir = stage / 'licenses'
    license_dir.mkdir(exist_ok=True)
    for path in (ROOT / 'tools/packaging/licenses').glob('*'):
        shutil.copyfile(path, license_dir / path.name)
    shutil.copyfile(ROOT / 'node_modules/vue/LICENSE', license_dir / 'Vue-LICENSE')
    shutil.copyfile(ROOT / 'node_modules/@lucide/vue/LICENSE', license_dir / 'Lucide-LICENSE')
    shutil.copyfile(ROOT / 'node_modules/rosu-pp-js/LICENSE', license_dir / 'rosu-pp-js-LICENSE')
    # The Go runtime is statically linked; include its redistribution license.
    goroot = subprocess.check_output([args.go, 'env', 'GOROOT'], text=True).strip()
    shutil.copyfile(Path(goroot) / 'LICENSE', license_dir / 'Go-LICENSE')
    # Include all locked Go modules' redistribution notices, including Wails
    # and WebView2 loader dependencies; fail rather than silently omit one.
    subprocess.run([args.go, 'mod', 'download', 'all'], cwd=launcher_dir, env=env, check=True)
    modules = subprocess.check_output([args.go, 'list', '-m', '-mod=readonly', '-json', 'all'],
                                     cwd=launcher_dir, env=env, text=True)
    decoder = json.JSONDecoder()
    inventory = []
    while modules.strip():
        module, end = decoder.raw_decode(modules.lstrip())
        modules = modules.lstrip()[end:]
        if module.get('Main'):
            continue
        source = Path(module['Dir'])
        notices = [p for p in source.iterdir() if p.is_file() and
                   p.name.upper().startswith(('LICENSE', 'COPYING', 'NOTICE'))]
        if not notices:
            raise RuntimeError(f"Missing license for {module['Path']}")
        target = license_dir / 'go' / module['Path'].replace('/', '_')
        target.mkdir(parents=True)
        for notice in notices:
            shutil.copyfile(notice, target / notice.name)
        inventory.append({'module': module['Path'], 'version': module['Version']})
    (license_dir / 'go-modules.json').write_text(json.dumps(inventory, indent=2)+'\n')
    manifest = {str(p.relative_to(stage)).replace('\\', '/'): sha(p) for p in sorted(stage.rglob('*')) if p.is_file()}
    (stage / 'SHA256SUMS.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
    result = out / 'OCLR-Windows-x64.zip'
    with zipfile.ZipFile(result, 'w', zipfile.ZIP_DEFLATED) as target:
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                target.write(path, str(path.relative_to(out)))
    (out / 'OCLR-Windows-x64.zip.sha256').write_text(f'{sha(result)}  {result.name}\n')
    print(json.dumps({'zip': str(result), 'bytes': result.stat().st_size, 'sha256': sha(result), 'build': build}, indent=2))


if __name__ == '__main__':
    main()
