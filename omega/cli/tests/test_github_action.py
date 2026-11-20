from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
ACTION_YML = ROOT / ".github" / "actions" / "omega-scan" / "action.yml"
EXAMPLE_WF = ROOT / "docs" / "examples" / "omega-repo-scan.yml"

USES_RE = re.compile(r"uses:\s*([^\s#]+)")
SHA_PIN_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}$")


def test_third_party_actions_are_pinned_by_full_40_char_sha():
    for path in (ACTION_YML, EXAMPLE_WF):
        text = path.read_text(encoding="utf-8")
        for match in USES_RE.findall(text):
            if match.startswith("./"):
                continue
            assert SHA_PIN_RE.match(match), f"Acción sin SHA completo en {path}: {match}"


def test_action_passes_token_via_env_and_never_cli_flag():
    text = ACTION_YML.read_text(encoding="utf-8")
    assert "OMEGA_API_TOKEN: ${{ inputs.api-token }}" in text
    assert "--token " not in text
    assert "using: \"composite\"" in text


def test_example_workflow_uses_minimal_explicit_permissions():
    text = EXAMPLE_WF.read_text(encoding="utf-8")
    assert "contents: read" in text
    assert "security-events: write" in text
    assert "write-all" not in text
    assert "secrets.OMEGA_API_TOKEN" in text
