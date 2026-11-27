#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import struct
import time
import uuid
from pathlib import Path


from poc.dt_layout import (
    profile_root, metadata_directory, root_manifest, entry_manifest, manifest_ids, read_manifest_entry, existing_payload,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = PROJECT_ROOT / "poc" / "templates" / "single-save.db"


def file_sha256(path):
    """Hash a whole file."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        while chunk := stream.read(0x200000):
            digest.update(chunk)
    return digest.hexdigest()


class DigestCache:
    """Remember save digests by size and mtime so unchanged files are not re-read.

    Listing a large library otherwise re-hashes every save on every launch.
    The cache lives beside the manifests and is only an optimisation: if it is
    missing, unreadable or stale for a file, that file is hashed as before.
    """

    NAME = "hash-cache.json"
    VERSION = 1

    def __init__(self, root):
        self.root = profile_root(root)
        self.path = metadata_directory(self.root) / self.NAME
        self.files = {}
        self.seen = set()
        self.dirty = False
        try:
            document = json.loads(self.path.read_text())
        except (OSError, ValueError):
            return
        if isinstance(document, dict) and document.get("version") == self.VERSION and isinstance(document.get("files"), dict):
            self.files = document["files"]

    def _key(self, path):
        path = Path(path).resolve()
        try:
            return path.relative_to(self.root.resolve()).as_posix()
        except ValueError:
            return str(path)

    def sha256(self, path, stat):
        """Return the file's digest, hashing only if it changed since it was cached."""
        key = self._key(path)
        self.seen.add(key)
        cached = self.files.get(key)
        if (
            isinstance(cached, dict)
            and cached.get("size") == stat.st_size
            and cached.get("mtime_ns") == stat.st_mtime_ns
            and isinstance(cached.get("sha256"), str)
            and re.fullmatch(r"[0-9a-f]{64}", cached["sha256"])
        ):
            return cached["sha256"]
        digest = file_sha256(path)
        self.files[key] = {"size": stat.st_size, "mtime_ns": stat.st_mtime_ns, "sha256": digest}
        self.dirty = True
        return digest

    def save(self, prune=False):
        """Write the cache; with prune, drop files that were not seen this run."""
        if prune:
            for key in set(self.files) - self.seen:
                del self.files[key]
                self.dirty = True
        if not self.dirty:
            return
        temporary = self.path.with_name(f"{self.path.name}.{os.getpid()}.tmp")
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_text(json.dumps({"version": self.VERSION, "files": self.files}, separators=(",", ":")))
            os.replace(temporary, self.path)
            self.dirty = False
        except OSError:
            try:
                temporary.unlink()
            except OSError:
                pass


def validate_user(user_id, user_name):
    if not re.fullmatch(r"[0-9a-fA-F]{8}", user_id):
        raise ValueError("user ID must be exactly 8 hexadecimal digits")
    if not user_name or "\0" in user_name:
        raise ValueError("user name is required")
    return user_id.lower()


def validate_payload(path, entry_id, item, digest_cache=None):
    try:
        header = bytearray.fromhex(item["header"])
    except (KeyError, ValueError) as exc:
        raise ValueError(f"save file {item.get('file', '')} has an invalid GFP5 header") from exc
    if len(header) != 1304 or struct.unpack_from("<I", header)[0] != 0x35504647:
        raise ValueError(f"save file {item['file']} has an invalid GFP5 header")
    if struct.unpack_from("<I", header, 4)[0] != entry_id:
        raise ValueError(f"save file {item['file']} has a mismatched GFP5 entry ID")
    if header[276:1300].split(b"\0", 1)[0].decode(errors="strict") != item.get("path"):
        raise ValueError(f"save file {item['file']} has mismatched manifest and GFP5 paths")
    stat = path.stat()
    actual_size = stat.st_size
    if actual_size <= 0:
        raise ValueError(f"save file {item['file']} is empty")
    manifest_size = int(item.get("size", 0))
    header_size = struct.unpack_from("<Q", header, 240)[0]
    if actual_size != manifest_size or actual_size != header_size:
        print(
            f"[metadata] {item['file']} using disk size {actual_size} "
            f"(manifest={manifest_size}, GFP5={header_size})",
            flush=True,
        )
    struct.pack_into("<Q", header, 0x20, actual_size)
    struct.pack_into("<Q", header, 0xF0, actual_size)
    item["header"] = header.hex()
    item["size"] = actual_size
    item["sha256"] = digest_cache.sha256(path, stat) if digest_cache is not None else file_sha256(path)
    return actual_size


def load_manifest(assets, entry_id=None, expected_user_id=None, digest_cache=None, documents=None):
    """Load and validate save entry."""
    assets = profile_root(assets)
    entry_id, entry = read_manifest_entry(assets, entry_id, documents)
    files = entry["files"]
    final_header = entry.get("final_header")
    if not final_header:
        raise ValueError(f"entry {entry_id} lacks a GFP5 final header; redownload it with this version")
    for item in files:
        name = Path(item.get("file", "")).name
        if not name or name != item.get("file"):
            raise ValueError(f"entry {entry_id} has an invalid save filename")
        path = existing_payload(assets, entry_id, item)
        if path is None:
            raise ValueError(f"save file for entry {entry_id} is missing: {name}")
        if not item.get("header"):
            raise ValueError(f"save file {name} lacks its GFP5 header; redownload the save")
        validate_payload(path, entry_id, item, digest_cache)
    final_bytes = bytes.fromhex(final_header)
    if len(final_bytes) != 1304 or struct.unpack_from("<I", final_bytes)[0] != 0x35504647:
        raise ValueError(f"entry {entry_id} has an invalid GFP5 final header")
    if struct.unpack_from("<I", final_bytes, 4)[0] != entry_id or not final_bytes[274]:
        raise ValueError(f"entry {entry_id} has a mismatched GFP5 final header")
    return entry_id, {"files": files, "final_header": final_header}


def write_upload_manifest(output, entries):
    output = Path(output).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({str(entry_id): entry for entry_id, entry in entries.items()}, indent=2) + "\n")


def write_json_replace(path, document):
    """Replace JSON file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".upload.tmp")
    temporary.write_text(json.dumps(document, indent=2) + "\n")
    os.replace(temporary, path)


def persist_manifest_entry(assets, entry_id, entry):
    """Refresh save manifests."""
    assets = Path(assets).expanduser()
    root_path = root_manifest(assets)
    document = json.loads(root_path.read_text()) if root_path.is_file() else {}
    document[str(entry_id)] = entry
    write_json_replace(root_path, document)

    entry_path = entry_manifest(assets, entry_id)
    document = json.loads(entry_path.read_text()) if entry_path.is_file() else {}
    document["entry_id"] = entry_id
    document["files"] = entry["files"]
    document[str(entry_id)] = entry
    write_json_replace(entry_path, document)


def backup_size(files):
    return sum(
        int(item["size"])
        for item in files
        if item.get("file", "").startswith("sdimg_sce_bu_")
        or (item.get("file", "").startswith("sce_bu_") and item.get("file", "").endswith(".bin"))
    )


def sync_upload_metadata(metadata_path, entry_id, entries):
    entry = entries[str(entry_id)]
    title_id = infer_title_id("", entry["files"])
    total_size = sum(int(item["size"]) for item in entry["files"])
    bu_size = backup_size(
        item
        for candidate in entries.values()
        for item in candidate["files"]
        if infer_title_id("", [item]) == title_id
    )
    db = sqlite3.connect(metadata_path)
    try:
        cursor = db.execute(
            "UPDATE dir_entry_info_tbl SET actual_size = ?, transfer_size = ?, required_size = ? WHERE id = ?",
            (total_size, total_size, total_size, entry_id),
        )
        if cursor.rowcount != 1:
            raise ValueError(f"metadata entry {entry_id} is missing for upload")
        db.execute(
            "UPDATE users_savedata_tbl SET "
            "size = (SELECT COALESCE(SUM(actual_size), 0) FROM dir_entry_info_tbl "
            "WHERE target_type = 3 AND path LIKE ?), bu_size = ? WHERE title_id = ?",
            (f"%/savedata_prospero/{title_id}/", bu_size, title_id),
        )
        db.commit()
    finally:
        db.close()


def sync_other_metadata(metadata_path, entry_id, entries):
    entry = entries[str(entry_id)]
    total_size = sum(int(item["size"]) for item in entry["files"])
    db = sqlite3.connect(metadata_path)
    try:
        row = db.execute(
            "SELECT path, target_type FROM dir_entry_info_tbl WHERE id = ?", (entry_id,)
        ).fetchone()
        if row is None:
            raise ValueError(f"metadata entry {entry_id} is missing for upload")
        source_path, target_type = row
        if target_type == 3:
            raise ValueError("savedata entries require savedata metadata generation")
        prefix = source_path.rstrip("/") + "/"
        for item in entry["files"]:
            if not item.get("path", "").startswith(prefix):
                raise ValueError(f"entry {entry_id} has a payload path outside {source_path}")
        db.execute(
            "UPDATE dir_entry_info_tbl SET actual_size = ?, transfer_size = ?, required_size = ? WHERE id = ?",
            (total_size, total_size, total_size, entry_id),
        )
        db.commit()
    finally:
        db.close()


def infer_title_id(title_id, files):
    if title_id:
        return title_id.upper()
    for item in files:
        parts = item.get("path", "").strip("/").split("/")
        for marker in ("savedata_prospero", "savedata"):
            if marker in parts:
                index = parts.index(marker)
                if index + 1 < len(parts) and re.fullmatch(r"[A-Za-z0-9]{9}", parts[index + 1]):
                    return parts[index + 1].upper()
    raise ValueError("title ID must be exactly 9 letters or digits")


def save_identity(path, is_directory=False):
    path = str(path)
    parts = path.strip("/").split("/")
    for marker in ("savedata_prospero", "savedata"):
        if marker not in parts:
            continue
        index = parts.index(marker)
        if index + 1 >= len(parts) or len(parts) < 3:
            break
        title_id = parts[index + 1].upper()
        if not re.fullmatch(r"[A-Z0-9]{9}", title_id):
            break
        remainder = parts[index + 2:] if is_directory or path.endswith("/") else parts[index + 2:-1]
        return title_id, parts[2].lower(), "/".join(remainder)
    raise ValueError(f"cannot determine a stable save identity from {path}")


def optional_save_identity(path, is_directory=False):
    try:
        return save_identity(path, is_directory)
    except ValueError:
        return None


def remap_upload_entry(entry, entry_id, source_id=None):
    remapped = json.loads(json.dumps(entry))
    for item in remapped["files"]:
        header = bytearray.fromhex(item["header"])
        struct.pack_into("<I", header, 4, entry_id)
        item["header"] = header.hex()
    final_header = bytearray.fromhex(remapped["final_header"])
    struct.pack_into("<I", final_header, 4, entry_id)
    remapped["final_header"] = final_header.hex()
    if source_id is not None:
        remapped["source_id"] = source_id
    return remapped


def find_downloaded_user(source_metadata, user_id):
    if not source_metadata:
        return None
    db = sqlite3.connect(source_metadata)
    try:
        return db.execute(
            "SELECT * FROM user_info_tbl WHERE user_id = ?", (int(user_id, 16),)
        ).fetchone()
    finally:
        db.close()


def create_metadata(output, user_id, title_id, entry_id, assets, user_name="user", manifest_output=None, source_metadata=None,
                    server_url=None, worker_key=None):
    """Build save catalogue."""
    user_id = validate_user(user_id, user_name)
    if server_url and worker_key and entry_id is not None and source_metadata:
        from poc.dt_resign import auto_resign_entry_if_needed
        try:
            entry_id = auto_resign_entry_if_needed(
                assets, source_metadata, entry_id, user_id, server_url, worker_key
            )
        except Exception as exc:
            raise ValueError(f"auto-resign to {user_id} failed: {exc}") from exc
    target_user = find_downloaded_user(source_metadata, user_id)
    entry_id, upload_entry = load_manifest(assets, entry_id, expected_user_id=user_id)
    persist_manifest_entry(assets, entry_id, upload_entry)
    files = upload_entry["files"]
    title_id = infer_title_id(title_id, files)
    if not re.fullmatch(r"[A-Z0-9]{9}", title_id):
        raise ValueError("title ID must be exactly 9 letters or digits")
    total_size = sum(int(item["size"]) for item in files)
    bu_size = backup_size(files)
    if total_size <= 0:
        raise ValueError("save files must not be empty")

    output = Path(output).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_metadata or TEMPLATE, output)
    db = sqlite3.connect(output)
    try:
        db.execute("DELETE FROM user_info_tbl")
        db.execute("DELETE FROM users_savedata_tbl")
        db.execute("DELETE FROM dir_entry_info_tbl")
        db.execute("DELETE FROM app_info_tbl")
        db.execute("DELETE FROM app_service_ac_tbl")
        db.execute("DELETE FROM app_service_fgc_tbl")
        db.execute("DELETE FROM capture_info_tbl")
        if target_user:
            transfer_user = list(target_user)
            transfer_user[7] = "np"
            transfer_user[8] = 1
            transfer_user[9] = 1
            transfer_user[10] = 0
            transfer_user[12] = 1
            transfer_user[13] = 1
            db.execute("INSERT INTO user_info_tbl VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", transfer_user)
        else:
            db.execute(
                "INSERT INTO user_info_tbl VALUES (?, ?, 0, 0, ?, ?, '', 'np', 1, 1, 0, ?, 1, 1)",
                (int(user_id, 16), user_name, user_name, user_name, uuid.uuid4().hex[:16]),
            )
        db.execute(
            "INSERT INTO users_savedata_tbl VALUES (?, ?, ?, ?, ?, 1, 1, 0, ?)",
            (int(user_id, 16), title_id, title_id, total_size, bu_size, int(time.time())),
        )
        save_path = f"/user/home/{user_id}/savedata_prospero/{title_id}/"
        db.execute(
            "INSERT INTO dir_entry_info_tbl VALUES (?, ?, 1, 3, 0, '', '', ?, ?, ?, 0)",
            (entry_id, save_path, total_size, total_size, total_size),
        )
        db.commit()
    finally:
        db.close()
    if manifest_output:
        write_upload_manifest(manifest_output, {entry_id: upload_entry})
    return output


def create_external_save(output, user_id, title_id, image_path, assets, user_name="user", manifest_output=None, source_metadata=None):
    """Build external-save upload."""
    user_id = validate_user(user_id, user_name)
    title_id = title_id.upper()
    if not re.fullmatch(r"[A-Z0-9]{9}", title_id):
        raise ValueError("title ID must be exactly 9 letters or digits")
    image_path = Path(image_path).expanduser()
    if image_path.is_dir():
        images = sorted(image_path.iterdir(), key=lambda item: item.name)
        if any(item.is_symlink() or not item.is_file() for item in images):
            raise ValueError("Choose a folder containing only encrypted save files, without subfolders or links")
    else:
        images = [image_path]
    if not images or any(not image.is_file() or image.stat().st_size <= 0 for image in images):
        raise ValueError("external save files are missing or empty")
    if any(image.name.lower() == "manifest.json" for image in images):
        raise ValueError("Choose only encrypted save files; manifest.json is reserved")
    if len({image.name.casefold() for image in images}) != len(images):
        raise ValueError("external save filenames must be unique ignoring case")
    entry_id = 0x10000
    assets = Path(assets).expanduser()
    entry_directory = assets / str(entry_id)
    entry_directory.mkdir(parents=True, exist_ok=True)
    items = []
    for image in images:
        destination = entry_directory / image.name
        source_path = f"/user/home/{user_id}/savedata_prospero/{title_id}/{image.name}"
        encoded_path = source_path.encode()
        if len(encoded_path) >= 1024:
            raise ValueError("external save filename is too long")
        if image.resolve() != destination.resolve():
            shutil.copyfile(image, destination)
        header = bytearray(1304)
        struct.pack_into("<I", header, 0, 0x35504647)
        struct.pack_into("<I", header, 4, entry_id)
        size = destination.stat().st_size
        struct.pack_into("<Q", header, 0x20, size)
        struct.pack_into("<Q", header, 0xF0, size)
        struct.pack_into("<H", header, 0x110, 0x8180)
        header[276:276 + len(encoded_path)] = encoded_path
        items.append({"path": source_path, "file": image.name, "size": size,
                      "sha256": "", "header": header.hex()})
    final_header = bytearray(1304)
    struct.pack_into("<I", final_header, 0, 0x35504647)
    struct.pack_into("<I", final_header, 4, entry_id)
    final_header[274] = 1
    manifest = {
        "entry_id": entry_id,
        "files": items,
        str(entry_id): {"files": items, "final_header": final_header.hex()},
    }
    (entry_directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return create_metadata(
        output, user_id, title_id, entry_id, assets, user_name, manifest_output, source_metadata
    )


def target_path(source_path, user_id):
    parts = source_path.strip("/").split("/")
    if len(parts) < 4 or parts[:2] != ["user", "home"]:
        raise ValueError(f"unsupported save path in metadata: {source_path}")
    parts[2] = user_id
    result = "/" + "/".join(parts)
    return result + "/" if source_path.endswith("/") else result


def resolve_upload_layout(row, upload_entry, user_id, candidate_rows):
    files = upload_entry["files"]
    title_id = infer_title_id("", files)
    total_size = sum(int(item["size"]) for item in files)
    if total_size <= 0:
        raise ValueError("save files must not be empty")
    row_title = infer_title_id("", [{"path": row[1]}])
    if row_title != title_id:
        matches = []
        for candidate in candidate_rows:
            parts = candidate[1].strip("/").split("/")
            if len(parts) < 3 or parts[2].lower() != user_id:
                continue
            if infer_title_id("", [{"path": candidate[1]}]) != title_id:
                continue
            matches.append(candidate)
        if len(matches) != 1:
            raise ValueError(
                f"entry {row[0]} metadata is for {row_title}, but its save payload is for {title_id}; "
                "no unique matching directory entry exists"
            )
        row = (row[0], *matches[0][1:])
    layout = list(row)
    layout[1] = target_path(layout[1], user_id)
    layout[7] = layout[8] = layout[9] = total_size
    return title_id, layout


def load_selected_manifest(assets, entry_id, source_metadata, user_id):
    """Match save to console entry."""
    if entry_id is None:
        return load_manifest(assets, None, expected_user_id=user_id)
    db = sqlite3.connect(source_metadata)
    try:
        row = db.execute(
            "SELECT path FROM dir_entry_info_tbl WHERE id = ? AND target_type = 3", (entry_id,)
        ).fetchone()
    finally:
        db.close()
    if row is None:
        return load_manifest(assets, entry_id, expected_user_id=user_id)
    identity = optional_save_identity(row[0], is_directory=True)
    if identity is None:
        return load_manifest(assets, entry_id, expected_user_id=user_id)
    assets = Path(assets).expanduser()
    matches = []
    for local_id in manifest_ids(assets):
        try:
            _, candidate = read_manifest_entry(assets, local_id)
        except (OSError, ValueError, KeyError, TypeError):
            continue
        files = candidate.get("files", [])
        if not isinstance(files, list):
            continue
        identities = {
            item_identity
            for item in files
            if isinstance(item, dict)
            and (item_identity := optional_save_identity(item.get("path", ""))) is not None
        }
        if identities == {identity}:
            matches.append(int(local_id))

    def downloaded_at(local_id):
        path = entry_manifest(assets, local_id)
        return path.stat().st_mtime_ns if path.is_file() else 0

    if matches:
        local_id = max(matches, key=lambda value: (downloaded_at(value), value))
        return load_manifest(assets, local_id, expected_user_id=user_id)
    return load_manifest(assets, entry_id, expected_user_id=user_id)


def create_filtered_metadata(
    output, source_metadata, user_id, user_name, entry_ids, assets, manifest_output=None,
    server_url=None, worker_key=None,
):
    """Build selected upload catalogue."""
    user_id = validate_user(user_id, user_name)
    if not entry_ids:
        entry_ids = [None]
    upload_entries = {}
    for entry_id in entry_ids:
        if server_url and worker_key and entry_id is not None:
            from poc.dt_resign import auto_resign_entry_if_needed
            try:
                entry_id = auto_resign_entry_if_needed(
                    assets, source_metadata, entry_id, user_id, server_url, worker_key
                )
            except Exception as exc:
                raise ValueError(f"auto-resign to {user_id} failed: {exc}") from exc
        actual_id, entry = load_selected_manifest(assets, entry_id, source_metadata, user_id)
        persist_manifest_entry(assets, actual_id, entry)
        upload_entries[actual_id] = entry
    output = Path(output).expanduser()
    source_metadata = Path(source_metadata).expanduser()
    if output.resolve() == source_metadata.resolve():
        raise ValueError("filtered metadata output must differ from the source database")
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_metadata, output)
    db = sqlite3.connect(output)
    try:
        target_user = db.execute(
            "SELECT * FROM user_info_tbl WHERE user_id = ?", (int(user_id, 16),)
        ).fetchone()
        savedata_rows = db.execute("SELECT * FROM users_savedata_tbl").fetchall()
        candidate_rows = db.execute("SELECT * FROM dir_entry_info_tbl WHERE target_type = 3").fetchall()
        matched_rows = {}
        for actual_id, entry in upload_entries.items():
            identities = {save_identity(item["path"]) for item in entry["files"]}
            if len(identities) != 1:
                raise ValueError(f"entry {actual_id} contains files from multiple save identities")
            identity = identities.pop()
            matches = [
                row for row in candidate_rows
                if optional_save_identity(row[1], is_directory=True) == identity
            ]
            if len(matches) != 1:
                raise ValueError(
                    f"{identity[0]} is absent from the current console metadata or has multiple matching entries; "
                    "browse the console again without deleting the downloaded files"
                )
            if matches[0][0] in matched_rows:
                raise ValueError(f"multiple selected saves map to metadata entry {matches[0][0]}")
            matched_rows[matches[0][0]] = (actual_id, matches[0])
        upload_entries = {
            current_id: remap_upload_entry(upload_entries[actual_id], current_id, actual_id)
            for current_id, (actual_id, _) in matched_rows.items()
        }
        rows = sorted((match for _, match in matched_rows.values()), key=lambda row: row[0])

        db.execute("DELETE FROM dir_entry_info_tbl")
        db.execute("DELETE FROM app_info_tbl")
        db.execute("DELETE FROM app_service_ac_tbl")
        db.execute("DELETE FROM app_service_fgc_tbl")
        db.execute("DELETE FROM capture_info_tbl")
        db.execute("DELETE FROM users_savedata_tbl")
        db.execute("DELETE FROM user_info_tbl")
        if target_user:
            transfer_user = list(target_user)
            transfer_user[7] = "np"
            transfer_user[8] = 1
            transfer_user[9] = 1
            transfer_user[10] = 0
            transfer_user[12] = 1
            transfer_user[13] = 1
            db.execute("INSERT INTO user_info_tbl VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", transfer_user)
        else:
            db.execute(
                "INSERT INTO user_info_tbl VALUES (?, ?, 0, 0, ?, ?, '', 'np', 1, 1, 0, ?, 1, 1)",
                (int(user_id, 16), user_name, user_name, user_name, uuid.uuid4().hex[:16]),
            )

        entries_by_title = {}
        for row in rows:
            title_id, layout = resolve_upload_layout(row, upload_entries[row[0]], user_id, candidate_rows)
            db.execute("INSERT INTO dir_entry_info_tbl VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", layout)
            entries_by_title.setdefault(title_id, []).append(layout)

        for title_id, title_rows in entries_by_title.items():
            original = next((row for row in savedata_rows if row[1].upper() == title_id), None)
            total_size = sum(int(row[7]) for row in title_rows)
            bu_size = backup_size(
                item
                for row in title_rows
                for item in upload_entries[row[0]]["files"]
            )
            db.execute(
                "INSERT INTO users_savedata_tbl VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    int(user_id, 16), title_id, title_id, total_size, bu_size,
                    original[5] if original else 1,
                    original[6] if original else 1,
                    original[7] if original else 0,
                    original[8] if original else int(time.time()),
                ),
            )
        db.commit()
    finally:
        db.close()
    write_upload_manifest(manifest_output or output.with_suffix(".manifest.json"), upload_entries)
    return output


def create_other_metadata(output, source_metadata, entry_ids, assets, manifest_output=None):
    if not entry_ids:
        raise ValueError("select at least one non-save entry to upload")
    output = Path(output).expanduser()
    source_metadata = Path(source_metadata).expanduser()
    if output.resolve() == source_metadata.resolve():
        raise ValueError("upload metadata output must differ from the source database")
    upload_entries = {}
    for entry_id in entry_ids:
        actual_id, entry = load_manifest(assets, entry_id)
        upload_entries[actual_id] = entry
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_metadata, output)
    for entry_id, entry in upload_entries.items():
        sync_other_metadata(output, entry_id, {str(entry_id): entry})
    write_upload_manifest(manifest_output or output.with_suffix(".manifest.json"), upload_entries)
    return output


def main():
    parser = argparse.ArgumentParser(description="Create filtered single-user Data Transfer metadata")
    parser.add_argument("--output", required=True)
    parser.add_argument("--source", help="downloaded metadata.db to filter")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--title-id", default="")
    parser.add_argument("--entry-id", type=int, action="append", default=[])
    parser.add_argument("--assets", required=True)
    parser.add_argument("--user-name", default="user")
    parser.add_argument("--manifest-output")
    parser.add_argument("--other", action="store_true", help="preserve non-savedata transfer entries")
    parser.add_argument("--external-image", type=Path, help="encrypted save container to import")
    parser.add_argument("--server-url", default=None, help="GarlicSaves server URL, for auto-resign on upload")
    parser.add_argument("--worker-key", default=None, help="GarlicSaves worker key, for auto-resign on upload")
    args = parser.parse_args()
    if args.external_image:
        path = create_external_save(
            args.output, args.user_id, args.title_id, args.external_image,
            args.assets, args.user_name, args.manifest_output, args.source,
        )
    elif args.other:
        if not args.source:
            parser.error("--other requires --source")
        path = create_other_metadata(
            args.output, args.source, args.entry_id, args.assets, args.manifest_output,
        )
    elif args.source:
        path = create_filtered_metadata(
            args.output, args.source, args.user_id, args.user_name,
            args.entry_id, args.assets, args.manifest_output,
            server_url=args.server_url, worker_key=args.worker_key,
        )
    else:
        if len(args.entry_id) > 1:
            parser.error("single-save metadata accepts only one --entry-id without --source")
        path = create_metadata(
            args.output, args.user_id, args.title_id,
            args.entry_id[0] if args.entry_id else None, args.assets,
            args.user_name, args.manifest_output,
            server_url=args.server_url, worker_key=args.worker_key,
        )
    print(path)


if __name__ == "__main__":
    main()
