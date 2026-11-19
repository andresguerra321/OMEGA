use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalPdfSourceRecord {
    pub document_id: String,
    pub sha256: String,
    pub local_path: String,
    pub filename: String,
    pub registered_at_epoch_sec: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPdfSource {
    pub found: bool,
    pub file_exists: bool,
    pub document_id: String,
    pub sha256: String,
    pub local_path: Option<String>,
    pub page: Option<u32>,
    pub notice: String,
}

fn index_file_path(base_dir: &Path) -> PathBuf {
    base_dir.join("pdf_vault_index.json")
}

pub fn load_index(base_dir: &Path) -> BTreeMap<String, LocalPdfSourceRecord> {
    let path = index_file_path(base_dir);
    let Ok(raw) = fs::read_to_string(&path) else {
        return BTreeMap::new();
    };
    serde_json::from_str::<BTreeMap<String, LocalPdfSourceRecord>>(&raw).unwrap_or_default()
}

pub fn save_index(
    base_dir: &Path,
    records: &BTreeMap<String, LocalPdfSourceRecord>,
) -> Result<(), String> {
    fs::create_dir_all(base_dir)
        .map_err(|e| format!("No se pudo crear directorio local del índice PDF: {e}"))?;
    let json = serde_json::to_string_pretty(records)
        .map_err(|e| format!("Error serializando índice PDF local: {e}"))?;
    fs::write(index_file_path(base_dir), json)
        .map_err(|e| format!("Error guardando índice PDF local: {e}"))
}

pub fn register_pdf_source(
    base_dir: &Path,
    document_id: String,
    sha256: String,
    local_path: String,
) -> Result<LocalPdfSourceRecord, String> {
    let clean_id = document_id.trim().to_string();
    let clean_sha = sha256.trim().to_ascii_lowercase();
    let clean_path = local_path.trim().to_string();
    if clean_id.is_empty() || clean_sha.is_empty() || clean_path.is_empty() {
        return Err("documentId, sha256 y localPath son obligatorios.".to_string());
    }

    let filename = Path::new(&clean_path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "documento.pdf".to_string());

    let epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let record = LocalPdfSourceRecord {
        document_id: clean_id.clone(),
        sha256: clean_sha,
        local_path: clean_path,
        filename,
        registered_at_epoch_sec: epoch,
    };

    let mut index = load_index(base_dir);
    index.insert(clean_id, record.clone());
    save_index(base_dir, &index)?;
    Ok(record)
}

pub fn resolve_pdf_source(
    base_dir: &Path,
    document_id: &str,
    sha256: &str,
    page: Option<u32>,
) -> ResolvedPdfSource {
    let index = load_index(base_dir);
    let clean_sha = sha256.trim().to_ascii_lowercase();

    let found_record = index.get(document_id.trim()).cloned().or_else(|| {
        if clean_sha.is_empty() {
            None
        } else {
            index.values().find(|r| r.sha256 == clean_sha).cloned()
        }
    });

    match found_record {
        Some(rec) => {
            let exists = Path::new(&rec.local_path).is_file();
            ResolvedPdfSource {
                found: true,
                file_exists: exists,
                document_id: rec.document_id,
                sha256: rec.sha256,
                local_path: Some(rec.local_path),
                page,
                notice: if exists {
                    "Copia original localizada en tu equipo para consulta de cita o reindexación en 1 clic.".to_string()
                } else {
                    "El PDF original fue movido o eliminado de su ruta local; vuelve a vincular tu copia para reindexar.".to_string()
                },
            }
        }
        None => ResolvedPdfSource {
            found: false,
            file_exists: false,
            document_id: document_id.to_string(),
            sha256: clean_sha,
            local_path: None,
            page,
            notice: "Sin copia local registrada para este documento (política Zero-Retention: el servidor nunca guarda el PDF).".to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_resolves_and_lists_local_pdf_sources() {
        let tmp = std::env::temp_dir().join(format!(
            "omega_pdf_vault_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let fake_pdf = tmp.join("informe_pericial.pdf");
        fs::write(&fake_pdf, b"%PDF-1.7 test").unwrap();

        let rec = register_pdf_source(
            &tmp,
            "doc-123".to_string(),
            "AABBCC112233".to_string(),
            fake_pdf.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(rec.sha256, "aabbcc112233");

        let by_id = resolve_pdf_source(&tmp, "doc-123", "", Some(7));
        assert!(by_id.found);
        assert!(by_id.file_exists);
        assert_eq!(by_id.page, Some(7));

        let by_sha = resolve_pdf_source(&tmp, "unknown-id", "aabbcc112233", Some(3));
        assert!(by_sha.found);
        assert!(by_sha.file_exists);

        let _ = fs::remove_dir_all(&tmp);
    }
}
