from typing import Any, Literal
from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatContextState(BaseModel):
    family: str | None = Field(default=None, max_length=120)
    os: str | None = Field(default=None, max_length=60)
    cve: str | None = Field(default=None, max_length=40)


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=2000)
    history: list[ChatTurn] = Field(default_factory=list)
    top_k: int = Field(default=6, ge=1, le=12)
    source_filter: str | None = Field(default=None, max_length=120)
    pinned_context: ChatContextState | None = None


class CitationItem(BaseModel):
    index: int
    report_id: str
    title: str
    organization: str
    page: int
    source_url: str
    snippet: str
    similarity: float
    retrieval_method: str


class ChatResponse(BaseModel):
    answer: str
    standalone_query: str
    citations: list[CitationItem]
    model: str
    analysis: dict[str, Any] | None = None
    resolved_context: ChatContextState | None = None
    rewritten_query: str | None = None


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
    matches: list[IocMatchItem]


class IocRawRequest(BaseModel):
    indicators_text: str = Field(..., min_length=3)


# --- Requerimientos OSINT Defensivo (RF8, RNF8) ---

class OsintAssetCreate(BaseModel):
    asset_type: Literal["domain", "institutional_email", "organization"]
    asset_value: str = Field(..., min_length=3, max_length=255)
    explicit_consent: bool


class OsintAssetOut(BaseModel):
    id: str
    asset_type: str
    asset_value: str
    explicit_consent: bool
    consented_at: str
    last_checked_at: str | None


class OsintExposureReport(BaseModel):
    asset_id: str
    asset_type: str
    asset_value: str
    checked_at: str
    exposed_subdomains: list[str]
    dns_posture: dict
    email_breaches: dict | None = None
    cti_ioc_matches: list[dict]
    ethical_notice: str
