"""Contratos Pydantic del microservicio forense stateless OMEGA."""

from typing import Any, Literal
from pydantic import BaseModel, Field, StrictBool


class IocMatchItem(BaseModel):
    ioc_type: str
    ioc_value: str
    match_precision: str
    artifact_origin: str
    context: str | None
    campaign: str
    spyware_family: str
    source_report: str
    organization: str
    source_url: str


class IocVerifyResponse(BaseModel):
    detected_format: str
    analyzed_indicators: int
    total_matches: int
    breakdown: dict[str, int]
    ephemeral_notice: str
    os_scope_notice: str = ""
    catalog_freshness: dict[str, Any] | None = None
    matches: list[IocMatchItem]


class IocRawRequest(BaseModel):
    indicators_text: str = Field(..., min_length=3)


class LinkCheckRequest(BaseModel):
    url: str = Field(..., min_length=4, max_length=2048)
    activeProbe: StrictBool = False


class ContainmentRequest(BaseModel):
    actionType: Literal['BLOCK_NETWORK_INDICATOR', 'SUSPEND_OR_TERMINATE_PROCESS', 'QUARANTINE_PERSISTENCE_ITEM']
    target: dict[str, Any]
    dryRun: StrictBool = True
    previewToken: str | None = Field(default=None, max_length=250000)


class LiveDeviceSnapshot(BaseModel):
    platform: str = "android"
    device: dict[str, Any]
    device_admins_raw: str = ""
    packages_text: str = ""
    processes_text: str = ""
    proc_net_raw: str = ""
    dns_resolver_raw: str = ""
    apk_hashes_raw: str = ""
    ca_certs_raw: str = ""
    proxy_raw: str = ""
    ios_profiles_raw: str = ""
    ios_unlock_token: str = ""
    ios_backup_auth: dict[str, Any] | None = None
    crashlogs: list[dict[str, Any]] = Field(default_factory=list)
    binary_artifacts: list[dict[str, Any]] = Field(default_factory=list)


class PcLiveSnapshot(BaseModel):
    platform: str = "win32"
    host: dict[str, Any] = Field(default_factory=dict)
    tcp_connections: list[dict[str, Any]] = Field(default_factory=list)
    processes: list[dict[str, Any]] = Field(default_factory=list)
    wmi_subscriptions: list[dict[str, Any]] = Field(default_factory=list)
    scheduled_tasks: list[dict[str, Any]] = Field(default_factory=list)
    startup_items: list[dict[str, Any]] = Field(default_factory=list)
    file_hashes: list[dict[str, Any]] = Field(default_factory=list)
    collection_status: dict[str, str] = Field(default_factory=dict)
    collection_errors: list[str] = Field(default_factory=list)


class MobileUsbAuditRequest(BaseModel):
    platform: str = Field(..., min_length=2, max_length=16)
    device_id: str = Field(..., min_length=1, max_length=160)
    backup_password: str | None = None
    async_mode: bool = False



class RealtimeToggleRequest(BaseModel):
    enabled: bool


class HostIocItem(BaseModel):
    ioc_type: str = Field(max_length=40)
    ioc_value: str = Field(max_length=2048)
    source: str = Field(default='', max_length=2048)


class HostIocSyncRequest(BaseModel):
    indicators: list[HostIocItem] = Field(max_length=200000)


class PersistenceFinding(BaseModel):
    id: str
    category: str
    persistenceType: str
    location: str
    targetPath: str
    sha256: str
    signatureStatus: str
    publisher: str = ''
    severity: Literal['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    userFriendlyTitle: str
    userFriendlyExplanation: str
    recommendedAction: str
    evidence: dict[str, Any]
    ctiMatches: list[dict[str, Any]] = Field(default_factory=list)


class PersistenceAuditResponse(BaseModel):
    scope: str
    platform: str
    hostname: str
    collectedAt: str
    findings: list[PersistenceFinding]
    processes: list[dict[str, Any]] = Field(default_factory=list)
    processFindings: list[dict[str, Any]] = Field(default_factory=list)
    limitations: list[str]
    complete: bool
    notice: str


class ScanFinding(BaseModel):
    """Hallazgo estático individual emitido por el futuro scanner de repositorios."""

    rule_id: str = Field(..., min_length=1, max_length=120)
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    confidence: float = Field(..., ge=0.0, le=1.0)
    evidence: str = Field(..., max_length=1000)
    location: str = Field(..., min_length=1, max_length=500)
    explanation: str = Field(..., min_length=1, max_length=1000)


class ScanRequest(BaseModel):
    """Solicitud de análisis estático de repositorio en RAM/tmpfs (Fase 0: solo contrato)."""

    tenant_id: str = Field(..., min_length=1, max_length=80)
    source_type: Literal["archive_upload", "git_snapshot"] = "archive_upload"
    ecosystems: list[Literal["npm", "pypi", "maven", "cargo", "generic"]] = Field(
        default_factory=lambda: ["npm", "pypi", "maven"]
    )
    max_files: int = Field(default=5000, ge=1, le=20000)
    max_bytes: int = Field(default=52428800, ge=1024, le=104857600)
    timeout_seconds: int = Field(default=30, ge=5, le=120)


class ScanStatus(BaseModel):
    """Estado y resultados efímeros de un escaneo de repositorio."""

    scan_id: str = Field(..., min_length=1, max_length=120)
    status: Literal["QUEUED", "RUNNING", "COMPLETED", "FAILED", "EXPIRED"]
    files_scanned: int = Field(default=0, ge=0)
    findings: list[ScanFinding] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    zero_retention_notice: str = (
        "Análisis estático en RAM/tmpfs; contenido purgado al finalizar."
    )
