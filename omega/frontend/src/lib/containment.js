export function containmentCandidate(finding) {
  const evidence = finding?.evidence || finding || {};
  if (finding?.persistenceType && finding.targetPath && finding.sha256 && ['Run', 'RunOnce', 'ScheduledTask', 'LaunchAgents', 'LaunchDaemons', 'Systemd'].includes(finding.persistenceType)) {
    return { actionType: 'QUARANTINE_PERSISTENCE_ITEM', target: { location: finding.location, persistenceType: finding.persistenceType, targetPath: finding.targetPath, sha256: finding.sha256 } };
  }
  const indicator = evidence.remoteIp || evidence.remote_ip || (finding?.category === 'DNS_IOC' ? evidence.indicator : null)
    || (['ip', 'ipv4', 'ipv6', 'domain'].includes(finding?.ioc_type) ? finding.ioc_value : null);
  if (indicator) return { actionType: 'BLOCK_NETWORK_INDICATOR', target: { indicator } };
  if (evidence.pid && evidence.startedAt && evidence.sha256) return { actionType: 'SUSPEND_OR_TERMINATE_PROCESS', target: { pid: evidence.pid, createTime: evidence.startedAt, sha256: evidence.sha256, mode: 'suspend' } };
  return null;
}

