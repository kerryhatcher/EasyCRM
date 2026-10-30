"""Build the shareable EasyCRM plugin without including repository/private files."""

import argparse
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "easycrm"
FILES = (
    "plugin.json",
    "mcp.json",
    "assets/icon.svg",
    "skills/manage-crm/SKILL.md",
    "README.md",
    "LICENSE",
)


def validate(source: Path) -> None:
    for name in FILES:
        path = source / name
        if path.is_symlink() or any(p.is_symlink() for p in path.parents):
            raise ValueError(f"Symlinks are not allowed: {name}")
        if not path.is_file():
            raise ValueError(f"Required file missing: {name}")
    manifest = json.loads((source / "plugin.json").read_text())
    assert manifest["$schema"] == (
        "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
    )
    assert manifest["name"] == source.name == "easycrm"
    assert re.fullmatch(r"\d+\.\d+\.\d+", manifest["version"])
    assert not {"skills", "mcpServers", "apps", "interface"} & manifest.keys()
    interface = manifest["extensions"]["com.openai"]["interface"]
    assert 0 < len(interface["shortDescription"]) <= 30
    assert isinstance(interface["capabilities"], list)
    for key in ("logo", "composerIcon"):
        asset = (source / interface[key]).resolve()
        assert asset.is_relative_to(source.resolve()) and asset.is_file()
        assert asset.relative_to(source.resolve()).as_posix() in FILES
    connection = json.loads((source / "mcp.json").read_text())
    assert connection["$schema"] == (
        "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
    )
    server = connection["mcpServers"]["easycrm"]
    assert server["type"] == "streamable-http"
    assert server["url"] == ("https://crm-api.kerryhatcher.com/functions/v1/crm-mcp")
    auth = server["extensions"]["com.openai"]["auth"]
    assert auth["type"] == "oauth"
    assert set(auth["defaultScopes"]) == {"openid", "email", "offline_access"}
    assert not {"headers", "env"} & server.keys()
    if "client" in auth:
        client = auth["client"]
        assert client["mode"] == "provided" and client["clientId"].strip()
        assert client["tokenEndpointAuthMethod"] == "none"
    skill = (source / "skills/manage-crm/SKILL.md").read_text()
    frontmatter = skill.split("---", 2)
    assert len(frontmatter) == 3 and not frontmatter[0]
    assert "name: manage-crm\n" in frontmatter[1]
    assert re.search(r"^description: .+", frontmatter[1], re.MULTILINE)
    assert len(skill.encode()) <= 1024 * 1024


def build(output: Path, source: Path = PLUGIN) -> Path:
    validate(source)
    output = output.resolve()
    if output.is_relative_to(source.resolve()):
        raise ValueError("Write the archive outside the plugin directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            entry = zipfile.ZipInfo(f"easycrm/{name}", date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, (source / name).read_bytes())
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert sorted(archive.namelist()) == sorted(f"easycrm/{p}" for p in FILES)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(build(parser.parse_args().output))
