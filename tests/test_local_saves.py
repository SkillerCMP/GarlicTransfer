import hashlib
import json
import os
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from poc.dt_local_saves import export_save, import_save, local_inventory, local_profiles


class LocalSaveTests(unittest.TestCase):
    def make_case(self, root):
        entry_id = 150
        assets = root / "assets"
        (assets / str(entry_id)).mkdir(parents=True)
        source_path = "/user/home/18c60ea2/savedata_prospero/PPSA24003/sdimg_DATA"
        header = bytearray(1304)
        struct.pack_into("<I", header, 0, 0x35504647)
        struct.pack_into("<I", header, 4, entry_id)
        struct.pack_into("<Q", header, 240, 8)
        header[276:276 + len(source_path)] = source_path.encode()
        final_header = bytearray(1304)
        struct.pack_into("<I", final_header, 0, 0x35504647)
        struct.pack_into("<I", final_header, 4, entry_id)
        final_header[274] = 1
        item = {
            "path": source_path,
            "file": "sdimg_DATA",
            "size": 8,
            "sha256": "stale",
            "header": header.hex(),
        }
        manifest = {
            "entry_id": entry_id,
            "files": [item],
            str(entry_id): {"files": [item], "final_header": final_header.hex()},
        }
        (assets / "manifest.json").write_text(json.dumps({str(entry_id): manifest[str(entry_id)]}))
        (assets / str(entry_id) / "manifest.json").write_text(json.dumps(manifest))
        (assets / str(entry_id) / "sdimg_DATA").write_bytes(b"old-save")
        return assets, entry_id

    def test_inventory_hashes_actual_file(self):
        with tempfile.TemporaryDirectory() as folder:
            assets, entry_id = self.make_case(Path(folder))
            entries = local_inventory(assets)
            self.assertEqual(entries[0]["id"], entry_id)
            self.assertEqual(entries[0]["title"], "PPSA24003")
            self.assertEqual(
                entries[0]["files"][0]["sha256"],
                hashlib.sha256(b"old-save").hexdigest(),
            )

    def test_export_copies_file(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets, entry_id = self.make_case(root)
            destination = root / "export"
            destination.mkdir()
            output = export_save(assets, entry_id, "sdimg_DATA", destination)
            self.assertEqual(output.read_bytes(), b"old-save")
            self.assertEqual((assets / str(entry_id) / "sdimg_DATA").read_bytes(), b"old-save")

    def test_import_replaces_file_and_regenerates_both_manifests(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets, entry_id = self.make_case(root)
            source = root / "replacement"
            payload = b"new-save"
            source.write_bytes(payload)
            with patch("poc.dt_local_saves.os.fsync", side_effect=lambda descriptor: os.write(descriptor, b"")):
                import_save(assets, entry_id, "sdimg_DATA", source)

            target = assets / str(entry_id) / "sdimg_DATA"
            self.assertEqual(target.read_bytes(), payload)
            self.assertEqual(source.read_bytes(), payload)
            expected_hash = hashlib.sha256(payload).hexdigest()
            for manifest_path in (assets / "manifest.json", target.parent / "manifest.json"):
                document = json.loads(manifest_path.read_text())
                item = document[str(entry_id)]["files"][0]
                self.assertEqual(item["size"], len(payload))
                self.assertEqual(item["sha256"], expected_hash)
                self.assertEqual(struct.unpack_from("<Q", bytes.fromhex(item["header"]), 240)[0], len(payload))
    def test_local_profiles_include_console_users_and_save_count(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets, entry_id = self.make_case(root / "console-a")
            result = local_profiles(root / "console-a")
            self.assertEqual(result["profiles"], [{
                "id": assets.name,
                "name": "",
                "path": str(assets),
                "users": ["18c60ea2"],
                "save_count": 1,
            }])

    def test_local_profiles_use_saved_console_name(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets, entry_id = self.make_case(root / "console-a")
            (root / "console-a" / "console-names.json").write_text(json.dumps({
                assets.name: {"name": "fert", "firmware": "13.60"},
            }))
            profile = local_profiles(root / "console-a")["profiles"][0]
            self.assertEqual(profile["name"], "fert")

    def test_empty_inventory_is_not_an_error(self):
        with tempfile.TemporaryDirectory() as folder:
            assets = Path(folder) / "missing"
            self.assertEqual(local_inventory(assets), [])
            self.assertEqual(local_inventory(assets, include_warnings=True), {"entries": [], "warnings": []})

    def test_inventory_skips_invalid_manifest_and_reports_warning(self):
        with tempfile.TemporaryDirectory() as folder:
            assets, entry_id = self.make_case(Path(folder))
            invalid = assets / "39"
            invalid.mkdir()
            (invalid / "manifest.json").write_text(json.dumps({
                "entry_id": 39,
                "files": [],
                "39": {"files": [], "final_header": ""},
            }))
            result = local_inventory(assets, include_warnings=True)
            self.assertEqual(len(result["entries"]), 1)
            self.assertEqual(result["entries"][0]["id"], entry_id)
            self.assertEqual(len(result["warnings"]), 1)
            self.assertIn("entry 39", result["warnings"][0])
            self.assertIn("contains no files", result["warnings"][0])

    def cache_path(self, assets):
        return assets / "Transfer-Metadata" / "hash-cache.json"

    def test_inventory_reuses_cached_digest_for_unchanged_file(self):
        with tempfile.TemporaryDirectory() as folder:
            assets, _ = self.make_case(Path(folder))
            expected = hashlib.sha256(b"old-save").hexdigest()
            self.assertEqual(local_inventory(assets)[0]["files"][0]["sha256"], expected)
            self.assertTrue(self.cache_path(assets).is_file())
            with patch("poc.dt_metadata.file_sha256", side_effect=AssertionError("unchanged file was re-hashed")):
                self.assertEqual(local_inventory(assets)[0]["files"][0]["sha256"], expected)

    def test_inventory_rehashes_file_changed_in_place(self):
        with tempfile.TemporaryDirectory() as folder:
            assets, entry_id = self.make_case(Path(folder))
            local_inventory(assets)
            payload = assets / str(entry_id) / "sdimg_DATA"
            before = payload.stat().st_mtime_ns
            payload.write_bytes(b"new-save")  # same size as before
            os.utime(payload, ns=(before + 1_000_000_000, before + 1_000_000_000))
            self.assertEqual(
                local_inventory(assets)[0]["files"][0]["sha256"],
                hashlib.sha256(b"new-save").hexdigest(),
            )

    def test_inventory_ignores_corrupt_digest_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            assets, _ = self.make_case(Path(folder))
            self.cache_path(assets).parent.mkdir(parents=True, exist_ok=True)
            self.cache_path(assets).write_text("{not json")
            self.assertEqual(
                local_inventory(assets)[0]["files"][0]["sha256"],
                hashlib.sha256(b"old-save").hexdigest(),
            )
            self.assertEqual(json.loads(self.cache_path(assets).read_text())["version"], 1)

    def test_inventory_prunes_digests_of_removed_files(self):
        with tempfile.TemporaryDirectory() as folder:
            assets, _ = self.make_case(Path(folder))
            local_inventory(assets)
            document = json.loads(self.cache_path(assets).read_text())
            document["files"]["999/sdimg_GONE"] = {"size": 1, "mtime_ns": 1, "sha256": "0" * 64}
            self.cache_path(assets).write_text(json.dumps(document))
            local_inventory(assets)
            self.assertNotIn("999/sdimg_GONE", json.loads(self.cache_path(assets).read_text())["files"])

    def test_upload_validation_still_hashes_without_cache(self):
        from poc.dt_metadata import load_manifest
        with tempfile.TemporaryDirectory() as folder:
            assets, entry_id = self.make_case(Path(folder))
            local_inventory(assets)
            with patch("poc.dt_metadata.file_sha256", return_value="f" * 64) as hashed:
                _, entry = load_manifest(assets, entry_id)
            hashed.assert_called_once()
            self.assertEqual(entry["files"][0]["sha256"], "f" * 64)


if __name__ == "__main__":
    unittest.main()
