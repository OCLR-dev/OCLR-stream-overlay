"""Bundle the latest official Windows tosu release; never reuse a cached version choice."""
import hashlib
import json
import re
import shutil
import stat
import struct
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

LATEST = 'https://api.github.com/repos/tosuapp/tosu/releases/latest'


def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'OCLR-Windows-packager', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def windows_asset(release):
    if release.get('draft') or release.get('prerelease') or not release.get('tag_name'):
        raise ValueError('Expected the latest official tosu release')
    assets = [a for a in release.get('assets', [])
              if re.fullmatch(r'tosu-windows(?:-x64)?-v[^/\\]+\.zip', a['name'])]
    if len(assets) != 1:
        raise ValueError('Latest tosu release must have exactly one Windows x64 archive')
    asset = assets[0]
    if not asset['browser_download_url'].startswith('https://github.com/tosuapp/tosu/releases/download/'):
        raise ValueError('Unexpected tosu asset URL')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', asset.get('digest') or ''):
        raise ValueError('Latest tosu asset is missing its GitHub SHA-256 digest')
    return asset


def verified_download(url, target, expected, fetch=download):
    # Reuse bytes only after resolving latest and verifying this exact asset's digest.
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
        return
    data = fetch(url)
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('tosu download SHA-256 mismatch')
    target.write_bytes(data)


def extract_windows(archive, target):
    with zipfile.ZipFile(archive) as source:
        names = set()
        for item in source.infolist():
            path = PurePosixPath(item.filename)
            if (path.is_absolute() or '..' in path.parts or '\\' in item.filename
                    or ':' in item.filename or stat.S_ISLNK(item.external_attr >> 16)):
                raise ValueError('Unsafe tosu archive path')
            key = item.filename.casefold().rstrip('/')
            if key in names:
                raise ValueError('Duplicate tosu archive entry')
            names.add(key)
        source.extractall(target)
    exe = target / 'tosu.exe'
    if not exe.is_file():
        raise ValueError('tosu archive is missing tosu.exe at its root')
    data = exe.read_bytes()
    # The unqualified upstream Windows archive currently contains an AMD64 PE.
    if data[:2] != b'MZ' or len(data) < 64:
        raise ValueError('tosu.exe is not a Windows executable')
    offset = struct.unpack_from('<I', data, 60)[0]
    if data[offset:offset + 6] != b'PE\0\0\x64\x86':
        raise ValueError('tosu.exe is not Windows x64')


def bundle_tosu(stage, cache, fetch=download):
    release = json.loads(fetch(LATEST))
    asset = windows_asset(release)
    digest = asset['digest'].removeprefix('sha256:')
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / (digest + '.zip')
    verified_download(asset['browser_download_url'], archive, digest, fetch)
    target = stage / 'tosu'
    target.mkdir()  # stage is fresh; never merge into someone's existing installation
    extract_windows(archive, target)
    env = target / 'tosu.env'
    if not env.exists():
        shutil.copyfile(Path(__file__).with_name('tosu.env'), env)
    # Redistribute the matching upstream source and its license alongside the binary.
    tag = urllib.parse.quote(release['tag_name'], safe='')
    commit = json.loads(fetch('https://api.github.com/repos/tosuapp/tosu/commits/' + tag))['sha']
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Invalid upstream source commit')
    source_url = 'https://codeload.github.com/tosuapp/tosu/zip/' + commit
    source_data = fetch(source_url)
    licenses = stage / 'licenses' / 'tosu'
    licenses.mkdir(parents=True)
    source_path = licenses / 'source.zip'
    source_path.write_bytes(source_data)
    with zipfile.ZipFile(source_path) as source:
        license_text = source.read('tosu-' + commit + '/LICENSE')
    (licenses / 'LICENSE').write_bytes(license_text)
    shutil.copyfile(Path(__file__).parent / 'licenses/GPL-3.0.txt', licenses / 'GPL-3.0.txt')
    manifest = {'bundledVersion': release['tag_name'], 'asset': asset['name'],
                'assetId': asset['id'], 'url': asset['browser_download_url'], 'sha256': digest,
                'sourceCommit': commit, 'sourceUrl': source_url,
                'sourceSha256': hashlib.sha256(source_data).hexdigest(),
                'note': 'Version at packaging time; tosu auto-update may change the installed version.'}
    (target / 'bundled-release.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    return manifest
