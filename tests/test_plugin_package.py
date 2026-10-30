import importlib.util
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "package_plugin", ROOT / "scripts/package_plugin.py"
)
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)


class PluginPackageTests(unittest.TestCase):
    def test_archive_is_reproducible_and_excludes_unrelated_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "easycrm"
            shutil.copytree(package.PLUGIN, source)
            (source / ".env").write_text("SECRET=never-package-this")
            first = package.build(root / "first.zip", source)
            second = package.build(root / "second.zip", source)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                self.assertNotIn("easycrm/.env", archive.namelist())
                self.assertIn("easycrm/mcp.json", archive.namelist())

    def test_rejects_symlinked_components(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "easycrm"
            shutil.copytree(package.PLUGIN, source)
            icon = source / "assets/icon.svg"
            icon.unlink()
            icon.symlink_to(package.PLUGIN / "assets/icon.svg")
            with self.assertRaisesRegex(ValueError, "Symlinks"):
                package.build(root / "plugin.zip", source)

    def test_rejects_archive_inside_source(self):
        with self.assertRaisesRegex(ValueError, "outside"):
            package.build(package.PLUGIN / "plugin.zip")
