import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { Daytona } from '@daytonaio/sdk';
import neo4j from 'neo4j-driver';
import { extractClaims } from '../src/lib/analysis.mjs';
import { discoverReports } from './discovery.mjs';
import { createShockServices } from './shock-services.mjs';

export function validateReportUrl(raw, allowedHosts) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Enter a valid HTTPS report URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !allowedHosts.includes(url.hostname)
  )
    throw new Error(
      'This report host is not allowed. Add its exact public hostname to REPORT_HOSTS on the backend.',
    );
  return url.href;
}

export function createServices(env = process.env) {
  const allowedHosts = (
    env.REPORT_HOSTS ||
    'investor.nvidia.com,nvidianews.nvidia.com,investor.microsoft.com,www.microsoft.com,investor.apple.com,www.apple.com,www.sec.gov'
  )
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const driver =
    env.NEO4J_URI && env.NEO4J_PASSWORD
      ? neo4j.driver(
          env.NEO4J_URI,
          neo4j.auth.basic(env.NEO4J_USERNAME || 'neo4j', env.NEO4J_PASSWORD),
        )
      : null;
  const query = (text, params) =>
    driver.executeQuery(text, params, { database: env.NEO4J_DATABASE || 'neo4j' });
  let busy = false;
  return {
    shock: createShockServices({ env, driver }),
    allowedHosts,
    discover: (ticker) => discoverReports(ticker),
    async health() {
      let ready = false;
      if (driver) {
        try {
          await driver.verifyConnectivity();
          ready = true;
        } catch {
          /* No credentials or internal errors in public responses. */
        }
      }
      return {
        neo4j: ready,
        daytona: Boolean(env.DAYTONA_API_KEY),
        extraction: 'deterministic',
        model: false,
        nosana: Boolean(env.NOSANA_INFERENCE_URL && env.NOSANA_MODEL),
      };
    },
    async ingest(input) {
      if (!driver || !env.DAYTONA_API_KEY)
        throw Object.assign(
          new Error('Configure NEO4J_URI, NEO4J_PASSWORD, and DAYTONA_API_KEY on the backend.'),
          { status: 503 },
        );
      const url = validateReportUrl(input.url, allowedHosts);
      if (busy)
        throw Object.assign(new Error('Another report is processing. Try again shortly.'), {
          status: 429,
        });
      busy = true;
      let sandbox;
      let daytona;
      try {
        await driver.verifyConnectivity();
        daytona = new Daytona({ apiKey: env.DAYTONA_API_KEY });
        sandbox = await daytona.create({
          language: 'python',
          autoStopInterval: 5,
          autoDeleteInterval: 10,
        });
        await sandbox.fs.uploadFile(
          Buffer.from(await readFile(new URL('./extract-report.py', import.meta.url), 'utf8')),
          '/tmp/thesis-extract.py',
        );
        await sandbox.fs.uploadFile(
          Buffer.from(JSON.stringify({ url, allowedHosts })),
          '/tmp/thesis-job.json',
        );
        const install = await sandbox.process.executeCommand(
          'python3 -m pip install --quiet "pypdf>=6,<7"',
          undefined,
          undefined,
          90,
        );
        if (install.exitCode !== 0) throw new Error('Sandbox PDF dependency installation failed.');
        const result = await sandbox.process.executeCommand(
          'python3 /tmp/thesis-extract.py',
          undefined,
          undefined,
          120,
        );
        if (result.exitCode !== 0)
          throw new Error(
            'Sandbox could not retrieve or extract the report. Check the source URL and host allowlist.',
          );
        let extracted;
        try {
          extracted = JSON.parse(result.result.trim());
        } catch {
          throw new Error('Sandbox returned an unreadable extraction result.');
        }
        if (!extracted.text) throw new Error(extracted.error || 'Report had no readable text.');
        const report = {
          id: randomUUID(),
          title: input.title,
          period: input.period,
          date: new Date().toISOString().slice(0, 10),
          url: extracted.sourceUrl || url,
          text: extracted.text,
          imported: true,
          provenance: 'live',
        };
        const claims = extractClaims(report.text).map((c) => ({
          ...c,
          id: createHash('sha256').update(`${report.id}:${c.text}`).digest('hex'),
        }));
        // One atomic transaction: a partial extraction never appears as a saved report.
        const session = driver.session({ database: env.NEO4J_DATABASE || 'neo4j' });
        try {
          await session.executeWrite(async (tx) => {
            await tx.run(
              'MERGE (c:Company {id: $companyId}) SET c.name = $companyName MERGE (r:Report {id: $id}) SET r += $report MERGE (c)-[:HAS_REPORT]->(r)',
              { companyId: input.companyId, companyName: input.companyName, id: report.id, report },
            );
            await tx.run(
              'MATCH (r:Report {id: $reportId}) UNWIND $claims AS item CREATE (e:Evidence {id: item.id, text: item.text, category: item.category}) MERGE (r)-[:CONTAINS]->(e) MERGE (t:Topic {name: item.category}) MERGE (e)-[:ABOUT]->(t)',
              { reportId: report.id, claims },
            );
          });
        } finally {
          await session.close();
        }
        return { ...report, claims };
      } finally {
        if (sandbox) {
          try {
            await daytona.delete(sandbox);
          } catch {
            console.warn('Sandbox cleanup failed; automatic stop/delete is configured.');
          }
        }
        busy = false;
      }
    },
    async memory(companyId) {
      if (!driver) throw Object.assign(new Error('Neo4j is not configured.'), { status: 503 });
      const result = await query(
        'MATCH (c:Company {id: $id})-[:HAS_REPORT]->(r:Report) OPTIONAL MATCH (r)-[:CONTAINS]->(e:Evidence) RETURN properties(r) AS report, collect(properties(e)) AS claims ORDER BY r.date',
        { id: companyId },
      );
      return result.records.map((record) => ({
        ...record.get('report'),
        claims: record.get('claims'),
      }));
    },
    async close() {
      if (driver) await driver.close();
    },
  };
}
