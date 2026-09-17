"""Verify the actual Maven packages, not just project-to-project dependencies."""

import json
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
version = (root / "VERSION").read_text().strip()
repository = root / "native/android/build/verification-repository/dev/respondkit"
ns = {"m": "http://maven.apache.org/POM/4.0.0"}

for module, packaging in [("core", "jar"), ("compose", "aar")]:
    artifact = f"respondkit-{module}"
    folder = repository / artifact / version
    prefix = f"{artifact}-{version}"
    pom = ET.parse(folder / f"{prefix}.pom").getroot()
    for name, expected in [("groupId", "dev.respondkit"), ("artifactId", artifact), ("version", version)]:
        assert pom.findtext(f"m:{name}", namespaces=ns) == expected, (artifact, name)
    for field in ["name", "description", "url", "licenses/license/name", "developers/developer/name", "scm/url"]:
        assert pom.findtext("/".join(f"m:{part}" for part in field.split("/")), namespaces=ns), (artifact, field)
    if module == "compose":
        dependency = next(d for d in pom.findall("m:dependencies/m:dependency", ns)
                          if d.findtext("m:artifactId", namespaces=ns) == "respondkit-core")
        assert dependency.findtext("m:version", namespaces=ns) == version
        assert dependency.findtext("m:scope", namespaces=ns) == "compile"
    metadata = json.loads((folder / f"{prefix}.module").read_text())
    assert metadata["component"]["version"] == version
    with ZipFile(folder / f"{prefix}.{packaging}") as binary:
        assert "META-INF/LICENSE" in binary.namelist(), artifact
    with ZipFile(folder / f"{prefix}-sources.jar") as sources:
        assert any(name.endswith(".kt") for name in sources.namelist()), artifact
    with ZipFile(folder / f"{prefix}-javadoc.jar") as docs:
        assert "index.html" in docs.namelist(), artifact
    print(f"Verified dev.respondkit:{artifact}:{version} ({packaging}, metadata, sources, API docs, license)")
