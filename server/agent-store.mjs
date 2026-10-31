import { companies, relationships } from '../src/lib/shock-data.mjs';
import { projectVersions } from './agent-domain.mjs';
import { serviceError } from './provider-client.mjs';

function native(value) {
  if (value?.toNumber) return value.toNumber();
  if (Array.isArray(value)) return value.map(native);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, native(v)]));
  return value;
}
const first = (result, key) => (result.records[0] ? native(result.records[0].get(key)) : null);
const rows = (result, key) => result.records.map((r) => native(r.get(key)));

export function createAgentStore(driver, env = process.env) {
  let initialized;
  const database = { database: env.NEO4J_DATABASE || 'neo4j' };
  const query = (q, p = {}) => driver.executeQuery(q, p, database);
  const transaction = async (fn) => {
    const session = driver.session(database);
    try {
      return await session.executeWrite(fn);
    } finally {
      await session.close();
    }
  };
  async function initialize() {
    if (!driver)
      throw serviceError(
        'Add NEO4J_URI and NEO4J_PASSWORD to persist research runs and graph history.',
      );
    if (!initialized)
      initialized = (async () => {
        await driver.verifyConnectivity();
        for (const label of [
          'ResearchControl',
          'ResearchRun',
          'ResearchSource',
          'ResearchProposal',
          'ExposureVersion',
          'ResearchBudget',
          'MarketCompany',
        ]) {
          await query(
            `CREATE CONSTRAINT thesis_${label.toLowerCase()}_id IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`,
          );
        }
        const stamp = new Date().toISOString();
        await transaction(async (tx) => {
          await tx.run(
            'MERGE (c:ResearchControl {id:"main"}) ON CREATE SET c.enabled=$enabled,c.watchlist=$watchlist,c.intervalMinutes=$interval,c.nextRunAt=0,c.nextAllowedAt=0,c.leaseUntil=0,c.sequence=0',
            {
              enabled: env.AGENT_ENABLED !== 'false',
              watchlist: ['MSFT', 'NVDA', 'TSM', 'DELL', 'SMCI'],
              interval: Math.max(60, Math.min(10080, Number(env.AGENT_INTERVAL_MINUTES) || 1440)),
            },
          );
          await tx.run(
            'UNWIND $nodes AS n MERGE (c:MarketCompany {id:n.id}) ON CREATE SET c.name=n.name,c.role=n.role',
            { nodes: companies },
          );
          for (const e of relationships) {
            const version = {
              ...e,
              logicalId: e.id,
              id: `seed:${e.id}`,
              versionId: `seed:${e.id}`,
              status: e.kind,
              effectiveDate: e.published,
              discoveredAt: stamp,
              reviewedAt: stamp,
              sequence: 0,
              provenance: 'curated baseline',
              quote: '',
            };
            await tx.run(
              'MATCH (a:MarketCompany {id:$from}),(b:MarketCompany {id:$to}) MERGE (v:ExposureVersion {id:$id}) ON CREATE SET v += $version MERGE (a)-[:HAS_EXPOSURE_VERSION]->(v) MERGE (v)-[:TO_COMPANY]->(b)',
              { from: e.from, to: e.to, id: version.id, version },
            );
          }
        });
      })().catch((error) => {
        initialized = null;
        throw error;
      });
    return initialized;
  }
  const latestQuery =
    'MATCH (v:ExposureVersion) WITH v ORDER BY v.sequence DESC WITH v.logicalId AS logicalId,head(collect(v)) AS latest RETURN properties(latest) AS version';
  return {
    initialize,
    async control() {
      await initialize();
      return first(
        await query('MATCH (c:ResearchControl {id:"main"}) RETURN properties(c) AS control'),
        'control',
      );
    },
    async configure(config) {
      await initialize();
      await query(
        'MATCH (c:ResearchControl {id:"main"}) SET c.enabled=$enabled,c.watchlist=$watchlist,c.intervalMinutes=$intervalMinutes,c.nextRunAt=0',
        config,
      );
      return this.control();
    },
    async acquire(trigger, now, runId) {
      await initialize();
      return transaction(async (tx) => {
        const control = first(
          await tx.run(
            'MATCH (c:ResearchControl {id:"main"}) SET c.gate=coalesce(c.gate,0)+1 RETURN properties(c) AS control',
          ),
          'control',
        );
        if (control.leaseUntil > now)
          throw serviceError('A research run is already active. Wait for it to finish.', 409);
        const abandoned = Boolean(control.owner && control.leaseUntil <= now);
        if (
          trigger === 'scheduled' &&
          (!control.enabled || (!abandoned && control.nextRunAt > now))
        )
          return null;
        if (control.nextAllowedAt > now)
          throw serviceError('Research scans have a one-minute cooldown.', 429);
        const stamp = new Date(now).toISOString();
        await tx.run(
          'MATCH (r:ResearchRun {status:"running"}) SET r.status="interrupted",r.finishedAt=$stamp,r.error="Previous worker stopped before completing; completed sources were preserved."',
          { stamp },
        );
        await tx.run(
          'MATCH (c:ResearchControl {id:"main"}) SET c.owner=$id,c.leaseUntil=$lease,c.nextRunAt=$next,c.nextAllowedAt=$cooldown CREATE (r:ResearchRun {id:$id,status:"running",startedAt:$stamp,trigger:$trigger,watchlist:$watchlist,sourceCount:0,proposalCount:0,searchCount:0})',
          {
            id: runId,
            stamp,
            trigger,
            watchlist: control.watchlist,
            lease: now + 900000,
            next: now + control.intervalMinutes * 60000,
            cooldown: now + 60000,
          },
        );
        return { id: runId, watchlist: control.watchlist, startedAt: stamp };
      });
    },
    async reserveSearch(day, limit) {
      await initialize();
      return transaction(async (tx) => {
        const result = await tx.run(
          'MERGE (b:ResearchBudget {id:$day}) SET b.gate=coalesce(b.gate,0)+1 WITH b WHERE coalesce(b.searches,0)<$limit SET b.searches=coalesce(b.searches,0)+1 RETURN b.searches AS used',
          { day, limit },
        );
        if (!result.records.length)
          throw serviceError('Daily Exa search allowance reached. It resets at 00:00 UTC.', 429);
        return first(result, 'used');
      });
    },
    async event(runId, kind, message) {
      await query(
        'MATCH (r:ResearchRun {id:$runId}) CREATE (e:ResearchEvent {id:randomUUID(),runId:$runId,at:$at,kind:$kind,message:$message}) MERGE (r)-[:HAS_EVENT]->(e)',
        { runId, at: new Date().toISOString(), kind, message: message.slice(0, 500) },
      );
    },
    async hasSource(id) {
      return Boolean(
        first(await query('MATCH (s:ResearchSource {id:$id}) RETURN s.id AS id', { id }), 'id'),
      );
    },
    async current() {
      await initialize();
      return rows(await query(latestQuery), 'version').map((v) => ({ ...v, id: v.logicalId }));
    },
    async saveSource(doc, proposals, owner) {
      return transaction(async (tx) => {
        const control = first(
          await tx.run(
            'MATCH (c:ResearchControl {id:"main"}) SET c.gate=coalesce(c.gate,0)+1 RETURN properties(c) AS control',
          ),
          'control',
        );
        if (control.owner !== owner || control.leaseUntil <= Date.now())
          throw serviceError('Research lease expired; stale results were not written.', 409);
        await tx.run('MERGE (s:ResearchSource {id:$id}) ON CREATE SET s += $doc', {
          id: doc.id,
          doc,
        });
        for (const proposal of proposals)
          await tx.run(
            'MATCH (s:ResearchSource {id:$sourceId}) MERGE (p:ResearchProposal {id:$id}) ON CREATE SET p += $proposal MERGE (p)-[:CITES]->(s)',
            { sourceId: doc.id, id: proposal.id, proposal },
          );
      });
    },
    async finish(runId, summary) {
      await transaction(async (tx) => {
        await tx.run(
          'MATCH (c:ResearchControl {id:"main",owner:$id}),(r:ResearchRun {id:$id}) SET r += $summary,c.leaseUntil=0,c.owner=""',
          { id: runId, summary: { ...summary, finishedAt: new Date().toISOString() } },
        );
      });
    },
    async snapshot() {
      const control = await this.control();
      const [runs, candidates, events, usage] = await Promise.all([
        query(
          'MATCH (r:ResearchRun) RETURN properties(r) AS run ORDER BY r.startedAt DESC LIMIT 15',
        ),
        query(
          'MATCH (p:ResearchProposal) OPTIONAL MATCH (before:ExposureVersion {versionId:p.reviewedAgainst}) RETURN properties(p) AS proposal,properties(before) AS before ORDER BY CASE p.status WHEN "pending" THEN 0 ELSE 1 END,p.discoveredAt DESC LIMIT 100',
        ),
        query('MATCH (e:ResearchEvent) RETURN properties(e) AS event ORDER BY e.at DESC LIMIT 100'),
        query('MATCH (b:ResearchBudget {id:$day}) RETURN coalesce(b.searches,0) AS used', {
          day: new Date().toISOString().slice(0, 10),
        }),
      ]);
      const current = await this.current();
      return {
        control,
        runs: rows(runs, 'run'),
        candidates: candidates.records.map((record) => {
          const p = native(record.get('proposal'));
          return {
            ...p,
            before:
              p.status === 'pending'
                ? current.find((e) => e.id === p.logicalId) || null
                : native(record.get('before')),
          };
        }),
        events: rows(events, 'event'),
        searchesToday: first(usage, 'used') || 0,
        current,
      };
    },
    async graph(asOf, mode = 'known') {
      await initialize();
      const result = await query(
        'MATCH (v:ExposureVersion) WHERE v.published <= $asOf AND (v.status="announced" OR v.effectiveDate <= $asOf) AND ($mode="published" OR (v.discoveredAt <= $cutoff AND v.reviewedAt <= $cutoff)) WITH v ORDER BY v.sequence DESC WITH v.logicalId AS logicalId,head(collect(v)) AS latest RETURN properties(latest) AS version',
        { asOf, cutoff: `${asOf}T23:59:59.999Z`, mode },
      );
      return projectVersions(rows(result, 'version'), asOf, mode)
        .filter((v) => v.status !== 'ended')
        .map((v) => ({ ...v, kind: v.status }));
    },
    async history(logicalId) {
      await initialize();
      return rows(
        await query(
          'MATCH (v:ExposureVersion {logicalId:$id}) RETURN properties(v) AS version ORDER BY v.sequence DESC',
          { id: logicalId },
        ),
        'version',
      );
    },
    async review(id, decision, expectedVersion, reason) {
      await initialize();
      return transaction(async (tx) => {
        const control = first(
          await tx.run(
            'MATCH (c:ResearchControl {id:"main"}) SET c.gate=coalesce(c.gate,0)+1 RETURN properties(c) AS control',
          ),
          'control',
        );
        const p = first(
          await tx.run('MATCH (p:ResearchProposal {id:$id}) RETURN properties(p) AS proposal', {
            id,
          }),
          'proposal',
        );
        if (!p) throw serviceError('Research proposal not found.', 404);
        const status = decision === 'approve' ? 'approved' : 'rejected';
        if (p.status === status) return { id, status, alreadyReviewed: true };
        if (p.status !== 'pending')
          throw serviceError('This proposal has already been reviewed.', 409);
        const stamp = new Date().toISOString();
        if (decision === 'approve') {
          const latest = first(
            await tx.run(
              'MATCH (v:ExposureVersion {logicalId:$logicalId}) RETURN properties(v) AS version ORDER BY v.sequence DESC LIMIT 1',
              { logicalId: p.logicalId },
            ),
            'version',
          );
          if ((latest?.versionId || '') !== expectedVersion)
            throw serviceError(
              'The relationship changed since you opened this comparison. Refresh the queue and review the new before/after.',
              409,
            );
          const sequence = control.sequence + 1;
          const version = {
            id: `approved:${p.id}`,
            versionId: `approved:${p.id}`,
            logicalId: p.logicalId,
            from: p.from,
            to: p.to,
            label: p.label,
            note: p.note,
            quote: p.quote,
            source: p.source,
            published: p.published,
            discoveredAt: p.discoveredAt,
            reviewedAt: stamp,
            effectiveDate: p.effectiveDate,
            status: p.kind,
            sequence,
            provenance: 'agent proposal, human approved',
            proposalId: p.id,
            reviewReason: reason,
            previousVersion: latest?.versionId || '',
          };
          await tx.run(
            'MATCH (a:MarketCompany {id:$from}),(b:MarketCompany {id:$to}),(c:ResearchControl {id:"main"}),(p:ResearchProposal {id:$proposalId}) CREATE (v:ExposureVersion) SET v += $version,c.sequence=$sequence MERGE (a)-[:HAS_EXPOSURE_VERSION]->(v) MERGE (v)-[:TO_COMPANY]->(b) MERGE (v)-[:BASED_ON]->(p)',
            { from: p.from, to: p.to, version, sequence, proposalId: p.id },
          );
        }
        await tx.run(
          'MATCH (p:ResearchProposal {id:$id}) SET p.status=$status,p.reviewedAt=$stamp,p.reviewReason=$reason,p.reviewedAgainst=$against',
          { id, status, stamp, reason, against: expectedVersion || p.baselineVersion || '' },
        );
        await tx.run(
          'MATCH (r:ResearchRun {id:$runId}) CREATE (e:ResearchEvent {id:randomUUID(),runId:$runId,at:$stamp,kind:$status,message:$message}) MERGE (r)-[:HAS_EVENT]->(e)',
          {
            runId: p.runId,
            stamp,
            status,
            message: `${p.from} → ${p.to}: proposal ${status}; ${decision === 'approve' ? 'new graph version committed, history preserved' : 'graph unchanged'}.`,
          },
        );
        return { id, status };
      });
    },
  };
}
