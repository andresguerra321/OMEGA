import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from release_integrity import generate, openssl_path, sign_source_tree


class ReleaseIntegrityTest(unittest.TestCase):
    def test_manifest_uses_published_asset_names_and_rejects_normalization_collisions(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'RELEASE_SIGNING_KEY': ''}):
            root = Path(directory)
            source, output = root / 'input', root / 'output'
            source.mkdir()
            (source / 'OMEGA Security.exe').write_bytes(b'installer')
            manifest = generate(source, output)
            digest, name = manifest.read_text().strip().split('  ', 1)
            self.assertEqual(name, 'OMEGA.Security.exe')
            self.assertEqual(hashlib.sha256((output / name).read_bytes()).hexdigest(), digest)
            (source / 'OMEGA.Security.exe').write_bytes(b'other installer')
            with self.assertRaises(RuntimeError):
                generate(source, output)

    def test_source_tree_manifest_embeds_public_anchor_and_detects_corpus_tampering(self):
        import base64
        import json
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'api').mkdir()
            (root / 'corpus_mvp').mkdir()
            (root / 'api/self_integrity.py').write_text("TRUSTED_PUBLIC_KEY = ''\n")
            (root / 'corpus_mvp/ioc.stix2').write_bytes(b'original')
            key = Ed25519PrivateKey.generate()
            pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
            manifest = sign_source_tree(root, pem)
            raw = manifest.read_bytes()
            key.public_key().verify(base64.b64decode((root / 'integrity-manifest.sig').read_bytes()), raw)
            public = base64.b64encode(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
            self.assertIn(public, (root / 'api/self_integrity.py').read_text())
            self.assertEqual(json.loads(raw)['files']['corpus_mvp/ioc.stix2'], hashlib.sha256(b'original').hexdigest())
            self.assertFalse(any(b'PRIVATE KEY' in item.read_bytes() for item in root.rglob('*') if item.is_file()))

    def test_all_installer_formats_are_hashed_but_not_unpacked_executables(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'RELEASE_SIGNING_KEY': ''}):
            root = Path(directory)
            for extension in ('exe', 'msi', 'dmg', 'AppImage', 'deb'):
                (root / ('OMEGA.' + extension)).write_bytes(extension.encode())
            (root / 'unpacked').mkdir()
            (root / 'unpacked/runtime.exe').write_bytes(b'not an installer')
            manifest = generate(root, root)
            lines = manifest.read_text().splitlines()
            self.assertEqual(len(lines), 5)
            for line in lines:
                digest, name = line.split('  ')
                self.assertEqual(digest, hashlib.sha256((root / name).read_bytes()).hexdigest())
            self.assertFalse((root / 'SHA256SUMS.txt.sig').exists())

    def test_empty_and_duplicate_installer_sets_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(RuntimeError):
                generate(root, root)
            for folder in ('a', 'b'):
                (root / folder).mkdir()
                (root / folder / 'same.exe').write_bytes(b'x')
            with self.assertRaises(RuntimeError):
                generate(root, root / 'output', recursive=True)

    def test_signature_verifies_and_rejects_modified_manifest_and_leaves_no_private_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            key = root / 'fixture.pem'
            executable = openssl_path()
            subprocess.run([executable, 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(key)], check=True, capture_output=True)
            (root / 'OMEGA.exe').write_bytes(b'installer fixture')
            with patch.dict(os.environ, {'RELEASE_SIGNING_KEY': key.read_text()}):
                manifest = generate(root, root / 'release')
            public = root / 'release/RELEASE_SIGNING_PUBLIC_KEY.pem'
            signature = root / 'release/SHA256SUMS.txt.sig'
            command = [executable, 'dgst', '-sha256', '-verify', str(public), '-signature', str(signature), str(manifest)]
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            manifest.write_bytes(manifest.read_bytes() + b'tampered')
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(list((root / 'release').glob('.omega-release-key-*')), [])


if __name__ == '__main__':
    unittest.main()
