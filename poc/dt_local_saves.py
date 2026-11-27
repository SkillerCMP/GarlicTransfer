#!/usr/bin/env python3
import argparse
import json
import os
import shutil
from pathlib import Path

from poc.dt_layout import PROFILE_FOLDERS, profile_root, metadata_file, manifest_ids, existing_payload
from poc.dt_metadata import DigestCache, infer_title_id, load_manifest, persist_manifest_entry


def public_entry(entry_id, entry):
    """Build public save details."""
    files = [
        {
            "file": item["file"],
            "path": item["path"],
            "size": item["size"],
            "sha256": item["sha256"],
        }
        for item in entry["files"]
    ]
    owner = files[0]["path"].strip("/").split("/")[2] if files else ""
    return {
        "id": entry_id,
        "title": infer_title_id("", entry["files"]),
        "owner": owner,
        "files": files,
    }


def local_inventory(assets, include_warnings=False):
    """List downloaded saves."""
    assets = profile_root(Path(assets).expanduser())
    warnings = []
    entry_ids = manifest_ids(assets, warnings)
    entries = []
    # Listing runs on every launch; reuse digests of files that have not changed.
    digest_cache = DigestCache(assets)
    documents = {}  # parse the shared root manifest once, not once per entry
    complete = True
    for entry_id in sorted(entry_ids):
        try:
            actual_id, entry = load_manifest(assets, entry_id, digest_cache=digest_cache, documents=documents)
            entries.append(public_entry(actual_id, entry))
        except (OSError, ValueError, KeyError, TypeError) as exc:
            complete = False
            warnings.append(f"entry {entry_id}: {exc}")
    digest_cache.save(prune=complete)
    if include_warnings:
        return {"entries": entries, "warnings": warnings}
    return entries


def local_profiles(root):
    """List console profiles."""
    root = Path(root).expanduser()
    try:
        names = json.loads((root / "console-names.json").read_text())
    except (OSError, ValueError, TypeError):
        names = {}
    candidates = [root] + [path for path in root.iterdir() if path.is_dir()] if root.is_dir() else []
    profiles = []
    for assets in candidates:
        if assets.name in PROFILE_FOLDERS:
            continue
        if not manifest_ids(assets) and not metadata_file(assets).is_file():
            continue
        inventory = local_inventory(assets, include_warnings=True)
        entries = inventory["entries"]
        if not entries and not metadata_file(assets).is_file():
            continue
        profiles.append({
            "id": assets.name,
            "name": names.get(assets.name, {}).get("name", ""),
            "path": str(assets),
            "users": sorted({entry["owner"] for entry in entries if entry["owner"]}),
            "save_count": sum(len(entry["files"]) for entry in entries),
        })
    profiles.sort(key=lambda profile: profile["id"])
    return {"profiles": profiles}


def selected_file(assets, entry_id, filename):
    """Find selected payload."""
    actual_id, entry = load_manifest(assets, entry_id)
    for item in entry["files"]:
        if item["file"] == filename:
            path = existing_payload(assets, entry_id, item)
            if path is None:
                raise ValueError(f"save file {filename} is missing")
            return actual_id, entry, item, path
    raise ValueError(f"save file {filename} is not present in entry {entry_id}")


def export_save(assets, entry_id, filename, destination):
    """Copy selected save."""
    _, _, _, source = selected_file(Path(assets).expanduser(), entry_id, filename)
    destination = Path(destination).expanduser()
    if not destination.is_dir():
        raise ValueError("select an existing export directory")
    target = destination / source.name
    if source.resolve() == target.resolve():
        raise ValueError("the export destination is the same as the source file")
    shutil.copyfile(source, target)
    return target



def import_save(assets, entry_id, filename, source):
    """Replace selected save."""
    assets = profile_root(Path(assets).expanduser())
    _, _, _, target = selected_file(assets, entry_id, filename)
    source = Path(source).expanduser()
    if not source.is_file() or source.stat().st_size <= 0:
        raise ValueError("the import image is missing or empty")
    if source.resolve() == target.resolve():
        raise ValueError("the import source and destination are the same file")
    temporary = target.with_name(target.name + ".import.tmp")
    shutil.copyfile(source, temporary)
    try:
        with temporary.open("r+b") as stream:
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        actual_id, entry = load_manifest(assets, entry_id)
        persist_manifest_entry(assets, actual_id, entry)
        return public_entry(actual_id, entry)
    finally:
        if temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description="Manage downloaded GarlicTransfer save files")
    subparsers = parser.add_subparsers(dest="command", required=True)
    list_parser = subparsers.add_parser("list")
    list_parser.add_argument("assets")
    profiles_parser = subparsers.add_parser("profiles")
    profiles_parser.add_argument("assets")
    for name in ("export", "import"):
        command = subparsers.add_parser(name)
        command.add_argument("assets")
        command.add_argument("entry_id", type=int)
        command.add_argument("filename")
        command.add_argument("destination")
    args = parser.parse_args()
    try:
        if args.command == "list":
            result = local_inventory(args.assets, include_warnings=True)
        elif args.command == "profiles":
            result = local_profiles(args.assets)
        elif args.command == "export":
            destination = export_save(args.assets, args.entry_id, args.filename, args.destination)
            result = {"destination": str(destination)}
        else:
            entry = import_save(args.assets, args.entry_id, args.filename, args.destination)
            result = {"entry": entry}
        print(json.dumps(result), flush=True)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
