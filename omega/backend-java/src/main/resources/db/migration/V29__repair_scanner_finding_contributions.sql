-- The static scanner reports per-finding weights in the scan's flat score_breakdown.
-- Repair only previously missing contributions; immutable exported reports are left intact.
WITH repaired AS (
    UPDATE omega_rag.dev_findings f SET score_points=LEAST(100,GREATEST(0,(item->>'points')::double precision))
    FROM omega_rag.dev_scans s CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(s.score_breakdown_json::jsonb)='array' THEN s.score_breakdown_json::jsonb ELSE '[]'::jsonb END
    ) item
    WHERE s.id=f.scan_id AND s.tenant_id=f.tenant_id AND f.score_points=0
      AND item->>'rule_id'=f.rule_id AND COALESCE(item->>'location','')=COALESCE(f.location,'')
      AND item->>'points' ~ '^[0-9]+([.][0-9]+)?$'
    RETURNING f.id,f.scan_id,f.score_points
)
UPDATE omega_rag.dev_scans s SET effective_score=GREATEST(0,s.score-COALESCE((
    SELECT SUM(COALESCE(r.score_points,f.score_points)) FROM omega_rag.dev_findings f
    LEFT JOIN repaired r ON r.id=f.id
    WHERE f.tenant_id=s.tenant_id AND f.scan_id=s.id AND f.triage_status IN ('FALSE_POSITIVE','ACCEPTED','RESOLVED')
),0)) WHERE s.id IN (SELECT scan_id FROM repaired);
