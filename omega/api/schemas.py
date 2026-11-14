"""Contratos Pydantic del microservicio forense stateless OMEGA."""

from typing import Any
from pydantic import BaseModel, Field


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


class LinkCheckRequest(BaseModel):
    url: str = Field(..., min_length=4, max_length=2048)


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
