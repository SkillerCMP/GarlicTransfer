import io
import json
import shutil
import sqlite3
import struct
import tempfile
import unittest
import zipfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from poc.dt_resign import ResignError, _download_job_result, auto_resign_entry_if_needed


SOURCE_USER = "18c60ea2"
DEST_USER = "146def5b"
TITLE_ID = "PPSA01547"
ENTRY_ID = 137


class ResignTests(unittest.TestCase):
    def make_library(self, root):
        metadata_dir = root / "Transfer-Metadata"
        metadata_dir.mkdir(parents=True)
        template = Path(__file__).resolve().parent.parent / "poc" / "templates" / "single-save.db"
        metadata = metadata_dir / "metadata.db"
        shutil.copyfile(template, metadata)
        with closing(sqlite3.connect(metadata)) as db, db:
            source_account = int("3e338f700e51db91", 16)
            db.execute("UPDATE user_info_tbl SET user_id = ?, account_id = ?", (int(SOURCE_USER, 16), source_account))
            row = db.execute("SELECT * FROM user_info_tbl").fetchone()
            dest = list(row)
            dest[0] = int(DEST_USER, 16)
            dest[1] = int("51c1cfeb6bbf5547", 16)
            db.execute("INSERT INTO user_info_tbl VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", dest)
            db.execute("DELETE FROM dir_entry_info_tbl")
            db.execute(
                "INSERT INTO dir_entry_info_tbl VALUES (?, ?, 1, 3, 0, '', '', ?, ?, ?, 0)",
                (ENTRY_ID, f"/user/home/{SOURCE_USER}/savedata_prospero/{TITLE_ID}/", 8, 8, 8),
            )
        source_path = f"/user/home/{SOURCE_USER}/savedata_prospero/{TITLE_ID}/sdimg_TEST"
        payload = root / "Saves" / SOURCE_USER / TITLE_ID / "sdimg_TEST"
        payload.parent.mkdir(parents=True)
        payload.write_bytes(b"original-save")
        header = bytearray(1304)
        struct.pack_into("<I", header, 0, 0x35504647)
        struct.pack_into("<I", header, 4, ENTRY_ID)
        struct.pack_into("<Q", header, 240, payload.stat().st_size)
        header[276:276 + len(source_path)] = source_path.encode()
        final = bytearray(1304)
        struct.pack_into("<I", final, 0, 0x35504647)
        struct.pack_into("<I", final, 4, ENTRY_ID)
        final[274] = 1
        item = {"path": source_path, "file": payload.name, "size": payload.stat().st_size, "header": header.hex()}
        entry = {"files": [item], "final_header": final.hex()}
        manifest = {"entry_id": ENTRY_ID, "files": [item], str(ENTRY_ID): entry}
        entry_dir = metadata_dir / str(ENTRY_ID)
        entry_dir.mkdir()
        (entry_dir / "manifest.json").write_text(json.dumps(manifest))
        (metadata_dir / "manifest.json").write_text(json.dumps({str(ENTRY_ID): entry}))
        return metadata

    def test_result_zip_is_unpacked_to_encrypted_image(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            image = b"X" * 0x1000
            archive_bytes = io.BytesIO()
            with zipfile.ZipFile(archive_bytes, "w") as archive:
                archive.writestr("sdimg_TEST", image)

            def fake_curl(args, check=True):
                output = args[args.index("-o") + 1]
                Path(output).write_bytes(archive_bytes.getvalue())
                return None

            with patch("poc.dt_resign._run_curl", side_effect=fake_curl):
                self.assertEqual(_download_job_result("https://example.test", "key", "job"), image)

    def test_invalid_result_archive_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            archive_bytes = io.BytesIO()
            with zipfile.ZipFile(archive_bytes, "w") as archive:
                archive.writestr("one", b"one")
                archive.writestr("two", b"two")

            def fake_curl(args, check=True):
                Path(args[args.index("-o") + 1]).write_bytes(archive_bytes.getvalue())
                return None

            with patch("poc.dt_resign._run_curl", side_effect=fake_curl):
                with self.assertRaisesRegex(ResignError, "exactly one"):
                    _download_job_result("https://example.test", "key", "job")

    def test_repeated_resign_reuses_same_slot_entry(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            metadata = self.make_library(root)
            resigned_image = b"R" * 0x1000
            with patch("poc.dt_resign.resign_file", return_value=resigned_image) as resign:
                first = auto_resign_entry_if_needed(root, metadata, ENTRY_ID, DEST_USER, "https://example.test", "key")
                second = auto_resign_entry_if_needed(root, metadata, ENTRY_ID, DEST_USER, "https://example.test", "key")
            self.assertEqual(first, second)
            self.assertEqual(resign.call_count, 1)
            with closing(sqlite3.connect(metadata)) as db:
                rows = db.execute("SELECT id, path FROM dir_entry_info_tbl WHERE id >= 100000").fetchall()
            self.assertEqual(len(rows), 1)
            output = root / "Saves" / DEST_USER / TITLE_ID / "sdimg_TEST"
            self.assertEqual(output.read_bytes(), resigned_image)

    def test_same_owner_is_a_noop(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            metadata = self.make_library(root)
            with patch("poc.dt_resign.resign_file") as resign:
                result = auto_resign_entry_if_needed(root, metadata, ENTRY_ID, SOURCE_USER, "https://example.test", "key")
            self.assertEqual(result, ENTRY_ID)
            resign.assert_not_called()


if __name__ == "__main__":
    unittest.main()
