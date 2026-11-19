import hashlib
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

from bundle_tosu import LATEST, bundle_tosu, extract_windows, verified_download, windows_asset


def archive(entries):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as target:
        for name, content in entries.items():
            target.writestr(zipfile.ZipInfo(name), content)
    return data.getvalue()


def executable():
    data = bytearray(128)
    data[:2] = b'MZ'
    struct.pack_into('<I', data, 60, 64)
    data[64:70] = b'PE\0\0\x64\x86'
    return bytes(data)


class BundleTosuTests(unittest.TestCase):
    def test_latest_is_resolved_each_build_and_env_and_companions_survive(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            calls = []
            version = 'v1'
            commit = 'a' * 40
            payload = archive({'tosu.exe': executable(), 'static/index.html': 'fixture'})
            digest = hashlib.sha256(payload).hexdigest()

            def fetch(url):
                calls.append(url)
                if url == LATEST:
                    return json.dumps({'tag_name': version, 'assets': [{
                        'id': 1, 'name': 'tosu-windows-' + version + '.zip',
                        'browser_download_url': 'https://github.com/tosuapp/tosu/releases/download/' + version + '/tosu.zip',
                        'digest': 'sha256:' + digest}]}).encode()
                if '/commits/' in url:
                    return json.dumps({'sha': commit}).encode()
                if 'codeload' in url:
                    return archive({'tosu-' + commit + '/LICENSE': 'synthetic license'})
                return payload

            for version in ('v1', 'v2'):
                stage = root / version
                stage.mkdir()
                result = bundle_tosu(stage, root / 'cache', fetch)
                self.assertEqual(result['bundledVersion'], version)
                self.assertEqual((stage / 'tosu/static/index.html').read_text(), 'fixture')
                self.assertEqual((stage / 'tosu/tosu.env').read_bytes(), Path(__file__).with_name('tosu.env').read_bytes())
                self.assertTrue((stage / 'licenses/tosu/source.zip').is_file())
            self.assertEqual(calls.count(LATEST), 2)
            # Identical immutable bytes may be reused; the version query must not be.
            self.assertEqual(sum('/releases/download/' in url for url in calls), 1)
            payload = archive({'tosu.exe': executable(), 'tosu.env': 'CUSTOM=value\r\nSERVER_PORT=24500\r\n'})
            digest = hashlib.sha256(payload).hexdigest()
            stage = root / 'configured'
            stage.mkdir()
            bundle_tosu(stage, root / 'cache', fetch)
            self.assertEqual((stage / 'tosu/tosu.env').read_bytes(), b'CUSTOM=value\r\nSERVER_PORT=24500\r\n')

    def test_failures_never_fall_back_to_cached_release(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cached = root / 'cached.zip'
            cached.write_bytes(b'old')
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                verified_download('fixture', cached, '0' * 64, lambda _: b'corrupt')
            self.assertEqual(cached.read_bytes(), b'old')
            def failed(_):
                raise OSError('offline')
            with self.assertRaisesRegex(OSError, 'offline'):
                bundle_tosu(root, root, failed)
        for release in ({'tag_name': 'v1', 'assets': []}, {'prerelease': True, 'tag_name': 'v1'}):
            with self.assertRaises(ValueError):
                windows_asset(release)

    def test_rejects_unsafe_or_wrong_architecture_archives(self):
        for entries in ({'../outside': 'bad', 'tosu.exe': executable()},
                        {'C:/outside': 'bad'}, {'folder\\outside': 'bad'},
                        {'tosu.exe': b'MZ' + bytes(100)},
                        {'tosu.exe': executable(), 'TOSU.EXE': executable()}):
            with self.subTest(entries=list(entries)), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                source = root / 'input.zip'
                source.write_bytes(archive(entries))
                with self.assertRaises(ValueError):
                    extract_windows(source, root / 'target')


if __name__ == '__main__':
    unittest.main()
