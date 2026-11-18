"""Validate every member, including ones the forensic parser would otherwise skip."""
import io
import gzip
import stat
import tarfile
import zipfile

MAX_ENTRIES = 500
MAX_FILE = 25 * 1024 * 1024
MAX_TOTAL = 100 * 1024 * 1024
MAX_RATIO = 100


class BoundedArchiveReader:
    def __init__(self, stream, limit):
        self.stream, self.remaining = stream, limit

    def read(self, size=-1):
        data = self.stream.read(min(self.remaining + 1, size) if size >= 0 else self.remaining + 1)
        self.remaining -= len(data)
        if self.remaining < 0:
            raise ValueError('Archivo bloqueado: expansión TAR excesiva')
        return data


def safe_member(name):
    parts = name.replace('\\', '/').split('/')
    if not name or name.startswith(('/', '\\')) or ':' in name or '\x00' in name or '..' in parts or len(parts) > 16:
        raise ValueError('Archivo bloqueado: ruta insegura o profundidad excesiva')


def validate_archive(name, raw):
    lower = name.lower()
    total = count = 0
    def check(member_name, size):
        nonlocal total, count
        safe_member(member_name)
        total += size
        count += 1
        if size < 0 or size > MAX_FILE or total > MAX_TOTAL or count > MAX_ENTRIES or total > max(1, len(raw)) * MAX_RATIO:
            raise ValueError('Archivo bloqueado: bomba de descompresión')
    if lower.endswith('.zip') or raw.startswith(b'PK\x03\x04'):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            for item in archive.infolist():
                check(item.filename, item.file_size)
                mode = item.external_attr >> 16
                if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)) or item.flag_bits & 1:
                    raise ValueError('Archivo bloqueado: enlace, tipo especial o cifrado')
                if item.file_size > max(1, item.compress_size) * MAX_RATIO:
                    raise ValueError('Archivo bloqueado: ratio de compresión')
                with archive.open(item) as stream:
                    size = 0
                    while chunk := stream.read(65536):
                        size += len(chunk)
                        if size > item.file_size or size > MAX_FILE:
                            raise ValueError('Archivo bloqueado: expansión inesperada')
    elif lower.endswith(('.tar', '.tgz', '.tar.gz')):
        source = io.BytesIO(raw)
        compressed = raw.startswith(b'\x1f\x8b')
        stream = gzip.GzipFile(fileobj=source) if compressed else source
        bounded = BoundedArchiveReader(stream, min(MAX_TOTAL, max(1, len(raw)) * MAX_RATIO))
        with stream, tarfile.open(fileobj=bounded, mode='r|') as archive:
            for item in archive:
                check(item.name, item.size)
                if not (item.isfile() or item.isdir()):
                    raise ValueError('Archivo bloqueado: enlace o entrada especial TAR')
