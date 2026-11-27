"""Shared folders and legacy lookup."""
import json
import re
from pathlib import Path, PurePosixPath

METADATA = "Transfer-Metadata"
SAVES = "Saves"
OTHER_DATA = "Other Needed Data"
PROFILE_FOLDERS = (METADATA, SAVES, OTHER_DATA)
SAVE_PATH = re.compile(r"^/user/home/([0-9a-fA-F]{8})/(?:savedata_prospero|savedata)/(PPSA[0-9]{5}|CUSA[0-9]{5})(?:/|$)")


def profile_root(path):
    """Find profile folder."""
    path = Path(path).expanduser()
    return path.parent if path.name == METADATA else path


def metadata_directory(root):
    """Build metadata folder."""
    return profile_root(root) / METADATA


def _read_or_write_path(organized, legacy, for_write):
    """Choose new or legacy path."""
    return organized if for_write or organized.is_file() or not legacy.is_file() else legacy


def metadata_file(root, *, for_write=False):
    """Find or build database path."""
    root = profile_root(root)
    return _read_or_write_path(metadata_directory(root) / "metadata.db", root / "metadata.db", for_write)


def root_manifest(root, *, for_write=False):
    """Find or build index path."""
    root = profile_root(root)
    return _read_or_write_path(metadata_directory(root) / "manifest.json", root / "manifest.json", for_write)


def entry_manifest(root, entry_id, *, for_write=False):
    """Find or build entry manifest."""
    root = profile_root(root)
    name = str(int(entry_id))
    return _read_or_write_path(metadata_directory(root) / name / "manifest.json", root / name / "manifest.json", for_write)


def manifest_candidates(root, entry_id):
    """Order new and legacy manifests."""
    root = profile_root(root)
    name = str(int(entry_id))
    return (root_manifest(root, for_write=True), entry_manifest(root, entry_id, for_write=True),
            root / "manifest.json", root / name / "manifest.json")


def manifest_paths(root):
    """List individual manifests."""
    root = profile_root(root)
    paths = list(root.glob("[0-9]*/manifest.json")) + list(metadata_directory(root).glob("[0-9]*/manifest.json"))
    return sorted(path for path in paths if path.parent.name.isdigit())


def _read_document(path):
    """Read manifest object."""
    document = json.loads(path.read_text())
    if not isinstance(document, dict):
        raise ValueError("manifest must be an object")
    return document


def manifest_ids(root, warnings=None):
    """Collect available entry IDs."""
    root = profile_root(root)
    result = {int(path.parent.name) for path in manifest_paths(root)}
    for path in (root_manifest(root, for_write=True), root / "manifest.json"):
        if not path.is_file():
            continue
        try:
            result.update(int(key) for key in _read_document(path) if key.isdigit())
        except (OSError, ValueError, TypeError) as exc:
            if warnings is not None:
                warnings.append(f"root manifest {path}: {exc}")
    return sorted(result)


def read_manifest_entry(root, entry_id=None, documents=None):
    """Find entry with index fallback.

    ``documents`` is an optional dict that memoises parsed manifests for the
    duration of one batch (e.g. listing every entry), so the shared root
    manifest is parsed once instead of once per entry.
    """
    if entry_id is None:
        ids = manifest_ids(root)
        if not ids:
            raise ValueError("no downloaded saves were found; download save data before uploading")
        if len(ids) != 1:
            raise ValueError("select the save entries to upload; the manifest contains multiple saves")
        entry_id = ids[0]
    entry_id = int(entry_id)
    errors = []
    for path in manifest_candidates(root, entry_id):
        if not path.is_file():
            continue
        try:
            if documents is None:
                document = _read_document(path)
            else:
                key = str(path)
                if key not in documents:
                    documents[key] = _read_document(path)
                document = documents[key]
            entry = document.get(str(entry_id))
            if entry is None and str(document.get("entry_id", "")) == str(entry_id):
                entry = document
            if isinstance(entry, dict) and isinstance(entry.get("files"), list) and entry["files"]:
                return entry_id, entry
        except (OSError, ValueError, TypeError) as exc:
            errors.append(str(exc))
    detail = f" ({errors[0]})" if errors else ""
    raise ValueError(f"save manifest for entry {entry_id} contains no files{detail}")


def payload_directory(root, entry_id, source_path):
    """Build payload folder."""
    root = profile_root(root)
    match = SAVE_PATH.match(source_path)
    if match:
        suffix = PurePosixPath(source_path[match.end():]).parent.parts
        if any(part in ("..", ".", "/") or "\\" in part or ":" in part for part in suffix):
            raise ValueError("invalid save subdirectory")
        return (root / SAVES / match[1] / match[2]).joinpath(*suffix)
    return root / OTHER_DATA / str(int(entry_id))


def payload_candidates(root, entry_id, item):
    """Find new or legacy payloads."""
    root = profile_root(root)
    name = item["file"]
    if not name or name in (".", "..") or any(char in name for char in ("/", "\\", ":")):
        raise ValueError("invalid save filename")
    return (payload_directory(root, entry_id, item.get("path", "")) / name,
            root / str(int(entry_id)) / name, root / name)


def existing_payload(root, entry_id, item):
    """Find existing payload file."""
    return next((path for path in payload_candidates(root, entry_id, item) if path.is_file()), None)


def cached_directory(root, entry_id, source_path):
    """Find cached FTP folder."""
    root = profile_root(root)
    legacy = root / str(int(entry_id))
    if (legacy / "manifest.json").is_file() and not entry_manifest(root, entry_id, for_write=True).is_file():
        return legacy
    return payload_directory(root, entry_id, source_path.rstrip("/") + "/placeholder")
