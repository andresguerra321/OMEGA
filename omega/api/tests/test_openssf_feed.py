from openssf_feed import build_advisory_index, parse_osv_malicious_package


def test_openssf_feed_parser_and_index():
    sample = {
        "id": "MAL-2026-0001",
        "summary": "Malicious postinstall exfiltrator",
        "published": "2026-11-10T00:00:00Z",
        "affected": [
            {"package": {"ecosystem": "npm", "name": "evil-demo-pkg"}},
        ],
    }
    records = parse_osv_malicious_package(sample)
    assert len(records) == 1
    assert records[0]["advisory_id"] == "MAL-2026-0001"
    assert records[0]["ecosystem"] == "npm"

    idx = build_advisory_index([sample])
    assert ("npm", "evil-demo-pkg") in idx
    assert idx[("npm", "evil-demo-pkg")]["id"] == "MAL-2026-0001"
