import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from stage_desktop_resources import stage


class DesktopPackageTest(unittest.TestCase):
    def test_ci_reuses_images_only_from_the_same_commit(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, images = root / 'source', root / 'images'
            for folder in ('api', 'backend-java', 'corpus_mvp', 'db'):
                (source / folder).mkdir(parents=True)
            for file in ('api/Dockerfile', 'backend-java/Dockerfile', 'db/init.sql', 'docker-compose.yml'):
                (source / file).write_text('fixture', encoding='utf-8')
            images.mkdir()
            (images / 'desktop-images.tar').write_bytes(b'prebuilt-images')
            manifest = images / 'desktop-release.json'
            manifest.write_text(json.dumps({'release_id': 'source-hash', 'commit': 'expected'}), encoding='utf-8')
            with patch.dict(os.environ, {'OMEGA_PREBUILT_IMAGES_DIR': str(images), 'GITHUB_SHA': 'expected'}), \
                    patch('stage_desktop_resources.subprocess.run') as docker:
                target = stage(source, root / 'bundle', with_images=True)
                docker.assert_not_called()
                self.assertEqual((target / 'desktop-images.tar').read_bytes(), b'prebuilt-images')
                manifest.write_text(json.dumps({'release_id': 'source-hash', 'commit': 'other'}), encoding='utf-8')
                with self.assertRaisesRegex(RuntimeError, 'commit'):
                    stage(source, root / 'bundle', with_images=True)

    def test_package_has_services_and_no_developer_credentials(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            for folder in ('api', 'backend-java', 'corpus_mvp', 'db'):
                (source / folder).mkdir(parents=True)
            for file in ('api/Dockerfile', 'backend-java/Dockerfile', 'db/init.sql', 'docker-compose.yml'):
                (source / file).write_text('fixture', encoding='utf-8')
            (source / 'backend-java' / '.env').write_text('SECRET=private', encoding='utf-8')
            (source / 'backend-java' / 'jdk-17').mkdir()
            with patch('stage_desktop_resources.subprocess.run') as docker:
                target = stage(source, root / 'bundle', with_images=True)
                first_release = json.loads((target / 'desktop-release.json').read_text())['release_id']
                self.assertFalse((target / 'backend-java' / '.env').exists())
                self.assertFalse((target / 'backend-java' / 'jdk-17').exists())
                calls = [call.args[0] for call in docker.call_args_list]
                self.assertTrue(any(call[1] == 'save' and 'pgvector/pgvector:pg16' in call for call in calls))
                self.assertFalse(any('up' in call for call in calls))
                target = stage(source, root / 'bundle', with_images=True)
                self.assertEqual(first_release, json.loads((target / 'desktop-release.json').read_text())['release_id'])
                (source / 'backend-java' / 'Dockerfile').write_text('changed', encoding='utf-8')
                target = stage(source, root / 'bundle', with_images=True)
                self.assertNotEqual(first_release, json.loads((target / 'desktop-release.json').read_text())['release_id'])

    def test_source_cannot_be_deleted_by_a_bad_destination(self):
        with TemporaryDirectory() as temporary:
            source = Path(temporary) / 'omega'
            source.mkdir()
            with self.assertRaises(ValueError):
                stage(source, source.parent)
            self.assertTrue(source.exists())


if __name__ == '__main__':
    unittest.main()
