import io
import sqlite3
import struct
import tempfile
import unittest
from contextlib import closing, contextmanager, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from poc import dt_backend, dt_download, dt_ftp_server, dt_resign, dt_source


class SqliteLifecycleTests(unittest.TestCase):
    def check_closed(self, operation, fails):
        """Check database cleanup."""
        connect = sqlite3.connect
        opened = []

        def track(*args, **kwargs):
            db = connect(*args, **kwargs)
            opened.append(db)
            return db

        try:
            with patch("sqlite3.connect", side_effect=track):
                if fails:
                    with self.assertRaises(sqlite3.Error):
                        operation()
                else:
                    operation()
            self.assertEqual(len(opened), 1)
            for db in opened:
                with self.assertRaises(sqlite3.ProgrammingError):
                    db.execute("SELECT 1")
        finally:
            for db in opened:
                db.close()

    def check_readers(self, fails):
        """Check metadata readers."""
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            metadata = root / "metadata.db"
            with closing(sqlite3.connect(metadata)) as db, db:
                if fails:
                    db.execute("CREATE TABLE dir_entry_info_tbl (id)")
                    db.execute("CREATE TABLE user_info_tbl (user_id)")
                else:
                    db.execute("CREATE TABLE dir_entry_info_tbl (id, path, actual_size, target_type)")
                    db.execute("INSERT INTO dir_entry_info_tbl VALUES (1, '/user/app/PPSA12345/', 16, 1)")
                    db.execute("CREATE TABLE user_info_tbl (user_id, user_name, login_id, online_id)")
                    db.execute("INSERT INTO user_info_tbl VALUES (1, 'tester', 'test-login', 'tester')")

            def download():
                with patch.object(dt_backend, "launch_console", return_value=b"system-version:13600000\n"), \
                     patch.object(dt_backend, "DtChannel") as channel, \
                     patch.object(dt_backend, "download_metadata"), \
                     patch.object(dt_backend, "metadata_file", return_value=metadata):
                    try:
                        dt_backend.download({
                            "oracleHost": "127.0.0.1", "clientHost": "127.0.0.1",
                            "interface": 1, "output": folder, "skipPower": True,
                            "metadataOnly": True,
                        })
                    finally:
                        channel.return_value.close.assert_called_once_with()

            readers = [
                ("catalog", lambda: dt_ftp_server.Catalog(metadata, root)),
                ("users", lambda: dt_backend.list_users(metadata)),
                ("inventory", lambda: dt_backend.list_inventory(metadata)),
                ("browser", lambda: dt_download.browse_entries(metadata)),
                ("registry", lambda: dt_source.user_registry_value(struct.pack("<IIIIQ", 1, 0x101, 1, 0, 16))),
                ("download", download),
            ]
            with patch.object(dt_backend, "emit"), \
                 patch.object(dt_backend, "index_downloaded_manifests", return_value=set()), \
                 patch.object(dt_source, "METADATA_PATH", metadata), \
                 patch("builtins.input", return_value="q"), redirect_stdout(io.StringIO()):
                for name, operation in readers:
                    with self.subTest(reader=name):
                        self.check_closed(operation, fails)

    def test_metadata_readers_close_before_returning(self):
        self.check_readers(fails=False)

    def test_metadata_readers_close_when_queries_fail(self):
        self.check_readers(fails=True)


class ResignSqliteLifecycleTests(unittest.TestCase):
    def assert_closed(self, opened):
        """Check database cleanup."""
        for db in opened:
            with self.assertRaises(sqlite3.ProgrammingError):
                db.execute("SELECT 1")

    @contextmanager
    def tracked_connections(self, fault=lambda index, sql: None):
        """Track real resign connections."""
        connect = sqlite3.connect
        temporary_directory = tempfile.TemporaryDirectory
        local_copy = dt_resign._local_readable_copy
        opened = []

        class Connection(sqlite3.Connection):
            def execute(db, sql, *args, **kwargs):
                error = fault(db.lifecycle_index, sql)
                if error is not None:
                    raise error
                return super().execute(sql, *args, **kwargs)

        def track(*args, **kwargs):
            kwargs["factory"] = Connection
            db = connect(*args, **kwargs)
            db.lifecycle_index = len(opened)
            opened.append(db)
            return db

        @contextmanager
        def checked_temporary_directory(*args, **kwargs):
            with temporary_directory(*args, **kwargs) as folder:
                try:
                    yield folder
                finally:
                    try:
                        self.assert_closed(opened)
                    finally:
                        for db in opened:
                            db.close()

        def checked_copy(*args, **kwargs):
            self.assert_closed(opened)
            return local_copy(*args, **kwargs)

        try:
            with patch("sqlite3.connect", side_effect=track), \
                 patch("tempfile.TemporaryDirectory", side_effect=checked_temporary_directory), \
                 patch.object(dt_resign, "_local_readable_copy", side_effect=checked_copy):
                yield opened
            self.assertTrue(opened)
            self.assert_closed(opened)
        finally:
            for db in opened:
                db.close()

    def test_resign_queries_close_on_success_error_and_fallback(self):
        query = "SELECT value FROM sample"
        cases = [
            ("direct success", query, {}, None, 1),
            ("direct error", query, {0: sqlite3.DatabaseError("query failed")}, sqlite3.DatabaseError, 1),
            ("fallback success", query, {0: sqlite3.OperationalError("stale journal")}, None, 2),
            ("missing table", "SELECT value FROM missing", {}, sqlite3.OperationalError, 2),
            ("fallback error", query, {0: sqlite3.OperationalError("stale journal"),
                                       1: sqlite3.DatabaseError("fallback failed")}, sqlite3.DatabaseError, 2),
        ]
        for name, selected_query, errors, expected_error, count in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                metadata = Path(folder) / "metadata.db"
                with closing(sqlite3.connect(metadata)) as db, db:
                    db.execute("CREATE TABLE sample (value)")
                    db.execute("INSERT INTO sample VALUES (42)")

                def fault(index, sql):
                    return errors.get(index) if sql == selected_query else None

                with self.tracked_connections(fault) as opened:
                    if expected_error:
                        with self.assertRaises(expected_error):
                            dt_resign._robust_query(metadata, selected_query)
                    else:
                        self.assertEqual(dt_resign._robust_query(metadata, selected_query), [(42,)])
                    self.assertEqual(len(opened), count)


if __name__ == "__main__":
    unittest.main()
