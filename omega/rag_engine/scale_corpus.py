import html
import json
import re
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
import fitz  # PyMuPDF

ROOT_DIR = Path(__file__).resolve().parent.parent
CORPUS_DIR = ROOT_DIR / "corpus_mvp"
PDFS_DIR = CORPUS_DIR / "pdfs"
IOCS_DIR = CORPUS_DIR / "iocs"
MANIFEST_PATH = CORPUS_DIR / "corpus_manifest.json"
CATALOG_PATH = Path(__file__).resolve().parent / "corpus_v1_catalog.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Omega-CTI-Academic-Research/1.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8",
}

# Catálogo semilla ampliado (Citizen Lab, Amnesty Tech, Google TAG)
DEFAULT_REPORTS_CATALOG = [
    {
        "title": "FORCEDENTRY: NSO Group iMessage Zero-Click Exploit Captured in the Wild",
        "organization": "Citizen Lab",
        "publication_date": "2021-09-13",
        "spyware_family": "Pegasus",
        "source_url": "https://citizenlab.ca/2021/09/forcedentry-nso-group-imessage-zero-click-exploit-captured-in-the-wild/",
        "local_filename": "citizenlab_2021_forcedentry.pdf",
    },
    {
        "title": "Project Torogoz: Extensive Hacking of Media & Civil Society in El Salvador with Pegasus Spyware",
        "organization": "Citizen Lab",
        "publication_date": "2022-01-12",
        "spyware_family": "Pegasus",
        "source_url": "https://citizenlab.ca/2022/01/project-torogoz-extensive-hacking-of-media-and-civil-society-in-el-salvador-with-pegasus-spyware/",
        "local_filename": "citizenlab_2022_el_salvador_pegasus.pdf",
    },
    {
        "title": "CatalanGate: Extensive Mercenary Spyware Operation against Catalans Using Pegasus and Candiru",
        "organization": "Citizen Lab",
        "publication_date": "2022-04-18",
        "spyware_family": "Pegasus / Candiru",
        "source_url": "https://citizenlab.ca/2022/04/catalangate-extensive-mercenary-spyware-operation-against-catalans-using-pegasus-candiru/",
        "local_filename": "citizenlab_2022_catalangate.pdf",
    },
    {
        "title": "Sweet QuaDreams: A First Look at Spyware Vendor QuaDream’s Exploits, Victims, and Customers",
        "organization": "Citizen Lab",
        "publication_date": "2023-04-11",
        "spyware_family": "QuaDream Reign",
        "source_url": "https://citizenlab.ca/2023/04/spyware-vendor-quadream-exploits-victims-customers/",
        "local_filename": "citizenlab_2023_quadream_endofdays.pdf",
    },
    {
        "title": "BLASTPASS: NSO Group iPhone Zero-Click, Zero-Day Exploit Captured in the Wild",
        "organization": "Citizen Lab",
        "publication_date": "2023-09-07",
        "spyware_family": "Pegasus",
        "source_url": "https://citizenlab.ca/2023/09/blastpass-nso-group-iphone-zero-click-zero-day-exploit-captured-in-the-wild/",
        "local_filename": "citizenlab_2023_blastpass.pdf",
    },
    {
        "title": "Forensic Methodology Report: How to Catch NSO Group's Pegasus",
        "organization": "Amnesty Tech",
        "publication_date": "2021-07-18",
        "spyware_family": "Pegasus",
        "source_url": "https://www.amnesty.org/en/latest/research/2021/07/forensic-methodology-report-how-to-catch-nso-groups-pegasus/",
        "local_filename": "amnesty_2021_pegasus_forensic_methodology.pdf",
    },
    {
        "title": "Predator Files: Technical deep-dive into Intellexa Alliance's surveillance products",
        "organization": "Amnesty Tech",
        "publication_date": "2023-10-09",
        "spyware_family": "Predator",
        "source_url": "https://securitylab.amnesty.org/latest/2023/10/technical-deep-dive-into-intellexa-alliance-surveillance-products/",
        "local_filename": "amnesty_2023_predator_files.pdf",
    },
    {
        "title": "Hooking Candiru: Another Mercenary Spyware Vendor Comes into Focus",
        "organization": "Citizen Lab",
        "publication_date": "2021-07-15",
        "spyware_family": "Candiru",
        "source_url": "https://citizenlab.ca/2021/07/hooking-candiru-another-mercenary-spyware-vendor-comes-into-focus/",
        "local_filename": "citizenlab_2021_hooking_candiru.pdf",
    },
    {
        "title": "Buying Spying: Insights into Commercial Surveillance Vendors",
        "organization": "Google TAG",
        "publication_date": "2024-02-06",
        "spyware_family": "Pegasus / Predator / Candiru",
        "source_url": "https://blog.google/threat-analysis-group/buying-spying-insights-into-commercial-surveillance-vendors/",
        "local_filename": "google_tag_2024_buying_spying.pdf",
    },
    {
        "title": "Protecting Android Users from 0-Day Attacks (Intellexa Predator & Cytrox)",
        "organization": "Google TAG",
        "publication_date": "2022-05-19",
        "spyware_family": "Predator",
        "source_url": "https://blog.google/threat-analysis-group/protecting-android-users-from-0-day-attacks/",
        "local_filename": "google_tag_2022_android_predator_0day.pdf",
    },
]


class ArticleTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._skip = False
        self.blocks: list[str] = []
        self._current: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "nav", "footer", "header", "aside", "noscript"}:
            self._skip = True
        elif tag in {"p", "h1", "h2", "h3", "h4", "li", "pre", "blockquote"} and not self._skip:
            self._flush()

    def handle_endtag(self, tag):
        if tag in {"script", "style", "nav", "footer", "header", "aside", "noscript"}:
            self._skip = False
        elif tag in {"p", "h1", "h2", "h3", "h4", "li", "pre", "blockquote"}:
            self._flush()

    def handle_data(self, data):
        if not self._skip:
            cleaned = " ".join(data.split())
            if cleaned:
                self._current.append(cleaned)

    def _flush(self):
        if self._current:
            paragraph = " ".join(self._current).strip()
            if len(paragraph) > 25:
                self.blocks.append(paragraph)
            self._current = []


def render_clean_pdf(title: str, org: str, pub_date: str, source_url: str, paragraphs: list[str], out_pdf: Path):
    """Genera un PDF paginado limpio para conservar citas por número de página en ingest.py."""
    safe_paragraphs = "".join(
        f"<p style='font-size:10.5pt; line-height:1.45; margin-bottom:9pt;'>{html.escape(p)}</p>"
        for p in paragraphs
    )
    html_doc = f"""
    <html>
      <body style="font-family: sans-serif; color: #111;">
        <h1 style="font-size:15pt; margin-bottom:4pt;">{html.escape(title)}</h1>
        <p style="font-size:9pt; color:#444; margin-bottom:14pt;">
          <strong>Fuente:</strong> {html.escape(org)} | <strong>Fecha:</strong> {html.escape(pub_date)} | <strong>URL:</strong> {html.escape(source_url)}
        </p>
        <hr/>
        {safe_paragraphs}
      </body>
    </html>
    """
    story = fitz.Story(html=html_doc)
    writer = fitz.DocumentWriter(str(out_pdf))
    mediabox = fitz.paper_rect("letter")
    where = mediabox + (42, 42, -42, -42)

    more = True
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(dev, where)
        writer.end_page()
    writer.close()


def sync_amnesty_stix2_feeds():
    """Descubre y descarga todos los archivos .stix2 oficiales de AmnestyTech/investigations."""
    IOCS_DIR.mkdir(parents=True, exist_ok=True)
    tree_url = "https://api.github.com/repos/AmnestyTech/investigations/git/trees/master?recursive=1"
    req = urllib.request.Request(tree_url, headers=HEADERS)

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            tree_data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        print(f"[AVISO] No se pudo consultar GitHub API para STIX2: {exc}")
        return

    stix_paths = [
        item["path"]
        for item in tree_data.get("tree", [])
        if item.get("type") == "blob" and item.get("path", "").endswith(".stix2")
    ]

    print(f"Descubiertos {len(stix_paths)} feeds STIX2 oficiales en AmnestyTech/investigations.")
    for rel_path in stix_paths:
        safe_name = rel_path.replace("/", "_")
        dest = IOCS_DIR / safe_name
        if dest.exists():
            print(f"  [OMITIDO] Ya existe: {safe_name}")
            continue

        raw_url = f"https://raw.githubusercontent.com/AmnestyTech/investigations/master/{rel_path}"
        try:
            with urllib.request.urlopen(urllib.request.Request(raw_url, headers=HEADERS), timeout=15) as r:
                dest.write_bytes(r.read())
            print(f"  [DESCARGADO] {safe_name}")
            time.sleep(0.4)
        except Exception as exc:
            print(f"  [ERROR] {rel_path}: {exc}")


def collect_reports_corpus():
    PDFS_DIR.mkdir(parents=True, exist_ok=True)

    if not CATALOG_PATH.exists():
        CATALOG_PATH.write_text(json.dumps(DEFAULT_REPORTS_CATALOG, indent=2, ensure_ascii=False), encoding="utf-8")

    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    manifest = []
    if MANIFEST_PATH.exists():
        existing_data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        manifest = existing_data if isinstance(existing_data, list) else existing_data.get("reports", [])

    manifest_by_file = {item["local_filename"]: item for item in manifest if "local_filename" in item}

    for entry in catalog:
        fname = entry["local_filename"]
        out_pdf = PDFS_DIR / fname
        manifest_by_file[fname] = entry

        if out_pdf.exists():
            print(f"[OMITIDO] PDF ya presente: {fname}")
            continue

        url = entry["source_url"]
        print(f"[DESCARGANDO] {entry['title']}...")
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                content_type = resp.headers.get("Content-Type", "").lower()
                raw_bytes = resp.read()

            if "application/pdf" in content_type or url.lower().endswith(".pdf"):
                out_pdf.write_bytes(raw_bytes)
                print(f"  [OK PDF Directo] -> {fname}")
            else:
                html_str = raw_bytes.decode("utf-8", errors="ignore")
                parser = ArticleTextExtractor()
                parser.feed(html_str)
                parser._flush()
                if len(parser.blocks) < 5:
                    print(f"  [AVISO] Contenido insuficiente extraído de {url}")
                    continue
                render_clean_pdf(
                    entry["title"],
                    entry["organization"],
                    entry["publication_date"],
                    url,
                    parser.blocks,
                    out_pdf,
                )
                print(f"  [OK HTML->PDF Paginado] ({len(parser.blocks)} bloques) -> {fname}")
            time.sleep(0.8)
        except Exception as exc:
            print(f"  [ERROR] No se pudo obtener {url}: {exc}")

    MANIFEST_PATH.write_text(
        json.dumps(list(manifest_by_file.values()), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\nManifiesto actualizado en {MANIFEST_PATH} ({len(manifest_by_file)} reportes registrados).")


if __name__ == "__main__":
    sync_amnesty_stix2_feeds()
    collect_reports_corpus()
