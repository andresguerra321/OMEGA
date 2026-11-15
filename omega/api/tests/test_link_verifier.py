import pytest
from link_verifier import inspect_suspicious_link


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
