"""Proof-of-concept patch: automatic resign-to-destination-user on upload.

Context
-------
GarlicTransfer already ships a full GarlicSaves decrypt/encrypt/resign
client (electron/save_editor.cjs -> runSaveJob), but today it is only wired
into the manual "Save Editor" UI: the user has to type in a 16-hex account
ID by hand and resign one file at a time.

The normal "Upload Saves" flow (electron/renderer.js -> startUpload /
createMetadata in electron/main.cjs -> poc/dt_metadata.py) lets the user pick
a *destination* local user from a dropdown, but it never compares that
destination against the save's *original owner*, and it never calls the
resign endpoint. If the destination account differs from the save's signed
owner (the normal case when sending a save to a friend), the uploaded save
is still signed for the original account and the console will refuse it
silently, which is exactly the manual workaround this script replaces.

This module is a self-contained, drop-in proof of concept for the missing
piece: given a local metadata.db (already populated by a normal console
browse) and a destination local user ID, it

  1. Looks up the entry's current owner from the already-known metadata.db
     (poc/dt_layout.py + poc/dt_metadata.py save_identity conventions).
  2. Resolves BOTH the owner's and the destination's PSN "account ID" (the
     16-hex value GarlicSaves needs for encrypt/resign) directly from
     metadata.db's own user_info_tbl.account_id column -- no manual
     screenshot of PS4 Profiles required. (user_info_tbl.account_id is
     stored as a big-endian 64-bit integer; f"{value:016x}" is the hex
     account ID used everywhere else in this app.)
  3. If the destination already matches the owner, does nothing (no-op,
     safe to call unconditionally from the upload flow).
  4. Otherwise calls the EXISTING GarlicSaves /api/v1/jobs "resign"
     operation (same wire format as postMultipart() in save_editor.cjs) for
     every file in the entry's manifest, in place of decrypt+edit+encrypt.
  5. Registers the resigned copy as a brand-new library entry (new Saves/
     payload directory, new Transfer-Metadata/<id>/manifest.json, new row
     in metadata.db's dir_entry_info_tbl) so it shows up in the existing
     "Select saves to upload" picker (list_inventory() in dt_backend.py)
     exactly like any entry that came from a real console browse.

Suggested integration point: call auto_resign_entry_if_needed() at the top
of create_metadata() in dt_metadata.py (or from createMetadata() in
main.cjs, calling this module via the same python spawn pattern already
used for every other poc.* module), using the already-selected entry_id(s)
and the already-selected destination userId from the Upload Saves screen.
Swap in the returned entry_id before building the outgoing transfer
metadata, so the rest of the upload pipeline needs no changes at all.

Usage (standalone, for a save GarlicTransfer already downloaded):
    python3 -m poc.dt_resign \
        --library ~/TwistIt/SaveLibrary/<console-id> \
        --entry-id 117 \
        --dest-user 146def5b \
        --worker-key <your GarlicSaves worker key>
"""
import argparse
import hashlib
import io
import json
import os
import shutil
import sqlite3
import struct
import subprocess
import tempfile
import time
import zipfile
from contextlib import closing
from pathlib import Path

from poc.dt_layout import (
    profile_root, metadata_file, root_manifest, entry_manifest, manifest_ids,
    read_manifest_entry, payload_directory, existing_payload,
)
from poc.dt_metadata import save_identity, optional_save_identity

DEFAULT_SERVER_URL = "https://garlicsaves.com"


class ResignError(RuntimeError):
    pass


def _local_readable_copy(metadata_path, tmp_dir):
    """Copy metadata.db (and any stale rollback journal next to it) into a
    scratch directory where ordinary POSIX file locking is guaranteed, and
    return that copy's path. Some network-mounted filesystems don't support
    the locking SQLite's rollback journal needs, which can make even a
    *read* of a database with a leftover hot journal fail with "disk I/O
    error"; copying both files lets SQLite auto-recover the journal locally
    the normal way instead of failing outright.
    """
    local_copy = os.path.join(tmp_dir, "metadata.db")
    shutil.copyfile(metadata_path, local_copy)
    journal_src = f"{metadata_path}-journal"
    if os.path.exists(journal_src):
        shutil.copyfile(journal_src, f"{local_copy}-journal")
    return local_copy


def _robust_query(metadata_path, sql, params=()):
    """Run a read-only query, transparently recovering from a stale journal."""
    try:
        with closing(sqlite3.connect(f"file:{metadata_path}?mode=ro", uri=True)) as con:
            return con.execute(sql, params).fetchall()
    except sqlite3.OperationalError:
        with tempfile.TemporaryDirectory() as tmp:
            local_copy = _local_readable_copy(metadata_path, tmp)
            with closing(sqlite3.connect(local_copy)) as con:
                return con.execute(sql, params).fetchall()


def account_id_hex(metadata_path, local_user_id):
    """Look up the 16-hex PSN account ID for a local (8-hex) user ID."""
    local_user_id = local_user_id.lower()
    rows = _robust_query(
        metadata_path,
        "SELECT account_id FROM user_info_tbl WHERE printf('%08x', user_id) = ?",
        (local_user_id,),
    )
    row = rows[0] if rows else None
    if row is None or row[0] is None:
        raise ResignError(
            f"no account ID on file for local user {local_user_id}; "
            "browse the console at least once while that profile is active"
        )
    return f"{row[0]:016x}"


def entry_owner(metadata_path, entry_id):
    """Find the (title_id, owner, source_path) of an already-known entry."""
    rows = _robust_query(
        metadata_path,
        "SELECT path FROM dir_entry_info_tbl WHERE id = ? AND target_type = 3",
        (entry_id,),
    )
    if not rows:
        raise ResignError(f"entry {entry_id} is not a known save in {metadata_path}")
    title_id, owner, _ = save_identity(rows[0][0], is_directory=True)
    return title_id, owner, rows[0][0]


CURL_BIN = shutil.which("curl") or "curl"
# NOTE on using curl instead of Python's own http client: GarlicSaves sits
# behind Cloudflare, and Cloudflare's bot-protection blocks the TLS/HTTP
# fingerprint of Python's urllib/http.client outright (a 403 with Cloudflare
# error code 1010), even with correct headers and a valid worker key -- this
# is a widely known issue with Python's stdlib HTTP stack against Cloudflare,
# unrelated to GarlicTransfer itself. curl's fingerprint (like the existing
# Node client in save_editor.cjs) passes through fine, so the resign calls
# below shell out to curl, which ships with Windows 10/11, macOS and every
# Linux distribution GarlicTransfer targets, rather than reimplementing an
# HTTP+TLS stack. No header spoofing: these are curl's own plain defaults.


def _run_curl(args, *, check=True):
    result = subprocess.run(
        [CURL_BIN, "-sS", *args], capture_output=True, timeout=120,
    )
    if check and result.returncode != 0:
        raise ResignError(f"curl failed ({result.returncode}): {result.stderr.decode(errors='replace').strip()}")
    return result


def _multipart_resign_request(server_url, worker_key, account_id, platform, file_path):
    """POST the same multipart fields save_editor.cjs sends for resign, via curl."""
    result = _run_curl([
        "-X", "POST", f"{server_url.rstrip('/')}/api/v1/jobs",
        "-H", f"X-Worker-Key: {worker_key}",
        "-F", "operation=resign",
        "-F", f"account_id={account_id}",
        "-F", f"platform={platform}",
        "-F", f"files=@{file_path};filename={os.path.basename(file_path)}",
    ])
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ResignError(f"GarlicSaves returned an invalid response: {result.stdout[:300]!r}") from exc


def _poll_job(server_url, worker_key, job_id, timeout_s=600, interval_s=1.5):
    deadline = time.monotonic() + timeout_s
    url = f"{server_url.rstrip('/')}/api/v1/jobs/{job_id}"
    while time.monotonic() < deadline:
        result = _run_curl(["-H", f"X-Worker-Key: {worker_key}", url])
        job = json.loads(result.stdout)
        if job["status"] == "done":
            return job
        if job["status"] == "failed":
            raise ResignError(job.get("error") or "resign job failed")
        time.sleep(interval_s)
    raise ResignError(f"resign job {job_id} timed out after {timeout_s}s")


def _download_job_result(server_url, worker_key, job_id):
    url = f"{server_url.rstrip('/')}/api/v1/jobs/{job_id}/result"
    with tempfile.TemporaryDirectory() as tmp:
        out_path = os.path.join(tmp, "result")
        _run_curl(["-H", f"X-Worker-Key: {worker_key}", url, "-o", out_path])
        archive = Path(out_path).read_bytes()
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as result_zip:
            images = [item for item in result_zip.infolist() if not item.is_dir()]
            if len(images) != 1:
                raise ResignError("GarlicSaves result did not contain exactly one encrypted save image")
            image = result_zip.read(images[0])
    except (zipfile.BadZipFile, KeyError) as exc:
        raise ResignError("GarlicSaves returned an invalid result archive") from exc
    if len(image) < 0x1000 or image.startswith(b"PK"):
        raise ResignError("GarlicSaves result is not an encrypted save image")
    return image


def resign_file(server_url, worker_key, account_id, platform, file_path):
    """Resign one already-encrypted save container to a different account."""
    created = _multipart_resign_request(server_url, worker_key, account_id, platform, file_path)
    job_id = created.get("job_id")
    if not job_id:
        raise ResignError(f"GarlicSaves did not return a job ID: {created}")
    _poll_job(server_url, worker_key, job_id)
    return _download_job_result(server_url, worker_key, job_id)


def _next_synthetic_id(root, metadata_path):
    """Pick an entry ID that can never collide with a real console browse."""
    used = set(manifest_ids(root))
    used.update(row[0] for row in _robust_query(metadata_path, "SELECT id FROM dir_entry_info_tbl"))
    candidate = 100000
    while candidate in used:
        candidate += 1
    return candidate


def register_resigned_entry(root, metadata_path, entry_id, dest_user_id, resigned_bytes):
    """Write the resigned files + manifest + metadata.db row for a new entry."""
    root = profile_root(root)
    title_id, _, _ = entry_owner(metadata_path, entry_id)
    _, entry = read_manifest_entry(root, entry_id)
    new_id = _next_synthetic_id(root, metadata_path)

    dest_dir = root / "Saves" / dest_user_id / title_id
    dest_dir.mkdir(parents=True, exist_ok=True)

    items = []
    total_size = 0
    for original_item, data in zip(entry["files"], resigned_bytes):
        name = original_item["file"]
        dest_path = dest_dir / name
        dest_path.write_bytes(data)
        size = len(data)
        total_size += size
        source_path = f"/user/home/{dest_user_id}/savedata_prospero/{title_id}/{name}"

        header = bytearray(1304)
        struct.pack_into("<I", header, 0, 0x35504647)
        struct.pack_into("<I", header, 4, new_id)
        struct.pack_into("<Q", header, 0x20, size)
        struct.pack_into("<Q", header, 0xF0, size)
        struct.pack_into("<H", header, 0x110, 0x8180)
        encoded_path = source_path.encode()
        header[276:276 + len(encoded_path)] = encoded_path

        items.append({
            "path": source_path,
            "file": name,
            "size": size,
            "sha256": hashlib.sha256(data).hexdigest(),
            "header": header.hex(),
        })

    final_header = bytearray(1304)
    struct.pack_into("<I", final_header, 0, 0x35504647)
    struct.pack_into("<I", final_header, 4, new_id)
    final_header[274] = 1
    new_entry = {"files": items, "final_header": final_header.hex()}

    new_entry_dir = root / "Transfer-Metadata" / str(new_id)
    new_entry_dir.mkdir(parents=True, exist_ok=True)
    (new_entry_dir / "manifest.json").write_text(
        json.dumps({"entry_id": new_id, "files": items, str(new_id): new_entry}, indent=2) + "\n"
    )

    root_manifest_path = root_manifest(root, for_write=True)
    root_manifest_path.parent.mkdir(parents=True, exist_ok=True)
    document = json.loads(root_manifest_path.read_text()) if root_manifest_path.is_file() else {}
    document[str(new_id)] = new_entry
    tmp_path = root_manifest_path.with_name(root_manifest_path.name + f".{new_id}.tmp")
    tmp_path.write_text(json.dumps(document, indent=2) + "\n")
    os.replace(tmp_path, root_manifest_path)

    _insert_dir_entry_row(metadata_path, new_id, dest_user_id, title_id, total_size)
    return new_id


def _insert_dir_entry_row(metadata_path, new_id, dest_user_id, title_id, total_size):
    """Insert the new entry's row into dir_entry_info_tbl, robustly.

    On most filesystems a plain connect+insert+commit is all this needs.
    On some network-mounted or locking-constrained filesystems, SQLite's
    rollback-journal machinery can report a spurious "disk I/O error" on an
    in-place write even though the data itself is fine; if that happens,
    fall back to editing a local scratch copy (where normal file locking is
    available) and swap it back into place, which is the one locking
    primitive every filesystem reliably supports.
    """
    save_path = f"/user/home/{dest_user_id}/savedata_prospero/{title_id}/"
    params = (new_id, save_path, total_size, total_size, total_size)
    sql = (
        "INSERT INTO dir_entry_info_tbl "
        "(id, path, partition, target_type, target_subtype, title_id, content_id, "
        "actual_size, transfer_size, required_size, required_zone_size) "
        "VALUES (?, ?, 1, 3, 0, '', '', ?, ?, ?, 0)"
    )
    try:
        con = sqlite3.connect(metadata_path)
        try:
            con.execute(sql, params)
            con.commit()
        finally:
            con.close()
        return
    except sqlite3.OperationalError:
        pass  # fall back below

    with tempfile.TemporaryDirectory() as tmp:
        local_copy = _local_readable_copy(metadata_path, tmp)
        con = sqlite3.connect(local_copy)
        try:
            con.execute("PRAGMA journal_mode=DELETE")
            existing = con.execute(
                "SELECT id FROM dir_entry_info_tbl WHERE id = ?", (new_id,)
            ).fetchone()
            if existing is None:
                con.execute(sql, params)
                con.commit()
        finally:
            con.close()
        # Re-open fresh to confirm the local copy is valid before swapping it in.
        con = sqlite3.connect(local_copy)
        try:
            ok, = con.execute("PRAGMA integrity_check").fetchone()
            if ok != "ok":
                raise ResignError(f"local metadata.db copy failed integrity_check: {ok}")
            row = con.execute(
                "SELECT id FROM dir_entry_info_tbl WHERE id = ?", (new_id,)
            ).fetchone()
            if row is None:
                raise ResignError("insert did not take effect in local metadata.db copy")
        finally:
            con.close()
        shutil.copyfile(local_copy, metadata_path)
        journal_path = f"{metadata_path}-journal"
        if os.path.exists(journal_path):
            open(journal_path, "w").close()  # truncate; a 0-byte journal is a safe no-op to SQLite


def find_existing_resigned_entry(root, metadata_path, title_id, dest_user_id, entry_id):
    """Reuse only an existing library entry for the same save slot."""
    _, source = read_manifest_entry(root, entry_id)
    expected_names = {item["file"] for item in source["files"]}
    dest_path = f"/user/home/{dest_user_id.lower()}/savedata_prospero/{title_id}/"
    rows = _robust_query(
        metadata_path,
        "SELECT id FROM dir_entry_info_tbl WHERE target_type = 3 AND path = ?",
        (dest_path,),
    )
    matches = []
    for row in rows:
        try:
            _, candidate = read_manifest_entry(root, row[0])
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if {item["file"] for item in candidate["files"]} == expected_names:
            matches.append(row[0])
    if len(matches) == 1:
        return matches[0]
    return None


def auto_resign_entry_if_needed(root, metadata_path, entry_id, dest_user_id, server_url, worker_key):
    """The one call an upload flow needs: resign only if the owner differs.

    Returns the entry_id the upload should actually use -- unchanged if the
    destination already matches the owner, the existing resigned copy's
    entry_id if one is already registered for this (title, destination)
    pair, or a brand-new entry_id for a freshly resigned copy otherwise.
    """
    title_id, owner, _ = entry_owner(metadata_path, entry_id)
    if owner.lower() == dest_user_id.lower():
        return entry_id
    if not title_id.startswith("PPSA"):
        raise ResignError(
            f"{title_id} is not a PS5 title; GarlicSaves resign is only defined for PS5 saves here"
        )

    root = profile_root(root)
    existing = find_existing_resigned_entry(root, metadata_path, title_id, dest_user_id, entry_id)
    if existing is not None:
        return existing

    dest_account = account_id_hex(metadata_path, dest_user_id)
    _, entry = read_manifest_entry(root, entry_id)

    resigned = []
    for item in entry["files"]:
        source = existing_payload(root, entry_id, item)
        if source is None:
            raise ResignError(f"save file missing on disk: {item['file']}")
        resigned.append(resign_file(server_url, worker_key, dest_account, "ps5", source))

    return register_resigned_entry(root, metadata_path, entry_id, dest_user_id, resigned)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", required=True, help="SaveLibrary/<console-id> folder (or its Transfer-Metadata folder)")
    parser.add_argument("--entry-id", required=True, type=int)
    parser.add_argument("--dest-user", required=True, help="destination local user ID, 8 hex digits")
    parser.add_argument("--server-url", default=DEFAULT_SERVER_URL)
    parser.add_argument("--worker-key", required=True)
    args = parser.parse_args()

    root = profile_root(args.library)
    metadata_path = metadata_file(root)
    result_id = auto_resign_entry_if_needed(
        root, metadata_path, args.entry_id, args.dest_user, args.server_url, args.worker_key
    )
    if result_id == args.entry_id:
        print(f"entry {args.entry_id} is already owned by {args.dest_user}; nothing to resign")
    else:
        print(f"resigned entry {args.entry_id} for {args.dest_user} -> new entry {result_id}")


if __name__ == "__main__":
    main()
