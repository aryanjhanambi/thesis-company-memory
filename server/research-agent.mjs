import { randomUUID } from 'node:crypto';
import { companies } from '../src/lib/shock-data.mjs';
import {
  WATCHLIST,
  SOURCE_DOMAINS,
  sourceDocument,
  parseClaims,
  proposalFor,
  extractionPrompt,
} from './agent-domain.mjs';
import { createInferenceClient, providerJson, serviceError } from './provider-client.mjs';

export function createResearchAgent({
  env,
  store,
  fetcher = fetch,
  inference = createInferenceClient(env, fetcher),
  clock = () => Date.now(),
}) {
  const dailyLimit = Math.max(1, Math.min(100, Number(env.AGENT_MAX_SEARCHES_PER_DAY) || 12));
  const maxSources = Math.max(1, Math.min(10, Number(env.AGENT_MAX_SOURCES_PER_RUN) || 6));
  let timer, active, aborter;
  let stopping = false;
  let lastCheck = null;
  const missing = () =>
    [
      !env.API_TOKEN && 'API_TOKEN',
      !env.EXA_API_KEY && 'EXA_API_KEY',
      !env.NEO4J_URI && 'NEO4J_URI',
      !env.NEO4J_PASSWORD && 'NEO4J_PASSWORD',
      !inference.configured && 'NOSANA_API_KEY (or a custom inference endpoint/model)',
    ].filter(Boolean);
  async function search(ticker, signal) {
    await store.reserveSearch(new Date(clock()).toISOString().slice(0, 10), dailyLimit);
    const name = companies.find((c) => c.id === ticker)?.name || ticker;
    return providerJson(
      fetcher,
      'https://api.exa.ai/search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.EXA_API_KEY },
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        body: JSON.stringify({
          query: `${name} (${ticker}) AI infrastructure suppliers customers partnerships purchase contracts capital expenditure cancellations announcements`,
          type: 'auto',
          numResults: 3,
          includeDomains: SOURCE_DOMAINS,
          startPublishedDate: new Date(clock() - 90 * 86400000).toISOString(),
          endPublishedDate: new Date(clock()).toISOString(),
          contents: { text: { maxCharacters: 12000 } },
        }),
      },
      'Exa',
    );
  }
  async function processRun(run) {
    const summary = {
      status: 'completed',
      sourceCount: 0,
      proposalCount: 0,
      searchCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      error: '',
    };
    aborter = new AbortController();
    const signal = AbortSignal.any([aborter.signal, AbortSignal.timeout(480000)]);
    try {
      const current = await store.current();
      await store.event(
        run.id,
        'started',
        `Watching ${run.watchlist.join(', ')}. Official-source search; proposals require review.`,
      );
      const docs = new Map();
      for (const ticker of run.watchlist) {
        if (signal.aborted) throw serviceError('Run stopped or reached its eight-minute deadline.');
        await store.event(run.id, 'search', `Searching official sources for ${ticker}.`);
        let result;
        try {
          result = await search(ticker, signal);
          summary.searchCount++;
        } catch (error) {
          if (error.status === 429) {
            summary.status = 'partial';
            summary.error = error.message;
            await store.event(run.id, 'budget', error.message);
            break;
          }
          throw error;
        }
        if (!Array.isArray(result.results))
          throw serviceError('Exa returned an invalid search response.');
        for (const item of result.results.slice(0, 3)) {
          const doc = sourceDocument(item, new Date(clock()).toISOString());
          if (
            !doc ||
            doc.published < new Date(clock() - 90 * 86400000).toISOString().slice(0, 10)
          ) {
            summary.rejectedCount++;
            continue;
          }
          if (docs.has(doc.id)) {
            summary.duplicateCount++;
            continue;
          }
          docs.set(doc.id, doc);
        }
      }
      let attemptedSources = 0;
      for (const doc of docs.values()) {
        if (attemptedSources >= maxSources) break;
        if (await store.hasSource(doc.id)) {
          summary.duplicateCount++;
          continue;
        }
        if (signal.aborted) throw serviceError('Run stopped or reached its eight-minute deadline.');
        attemptedSources++;
        await store.event(
          run.id,
          'extract',
          `Inspecting ${doc.title}. Publication date is search metadata, subject to review.`,
        );
        const reply = await inference.complete(
          [
            extractionPrompt,
            {
              role: 'user',
              content: JSON.stringify({
                source: {
                  title: doc.title,
                  url: doc.url,
                  published: doc.published,
                  text: doc.text,
                },
                existingRelationships: [...current]
                  .sort((a, b) => b.sequence - a.sequence)
                  .slice(0, 25)
                  .map((e) => ({
                    id: e.id,
                    from: e.from,
                    to: e.to,
                    label: e.label,
                    status: e.status,
                  })),
              }),
            },
          ],
          { maxTokens: 2200, signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]) },
        );
        let claims;
        try {
          claims = parseClaims(reply.text);
        } catch {
          summary.rejectedCount++;
          summary.status = 'partial';
          await store.event(
            run.id,
            'rejected',
            'Model returned malformed extraction JSON. No source or graph change was accepted; the document can be retried.',
          );
          continue;
        }
        const proposals = new Map();
        for (const claim of claims) {
          const proposal = proposalFor(claim, doc, current, run.id);
          if (!proposal) {
            summary.rejectedCount++;
            continue;
          }
          proposals.set(proposal.id, { ...proposal, model: reply.model });
        }
        await store.saveSource(doc, [...proposals.values()], run.id);
        summary.sourceCount++;
        summary.proposalCount += proposals.size;
        await store.event(
          run.id,
          proposals.size ? 'proposal' : 'no-change',
          `${proposals.size} source-anchored proposal(s) from ${new URL(doc.url).hostname}. No graph changes applied automatically.`,
        );
      }
      await store.event(
        run.id,
        'finished',
        `${summary.sourceCount} new source snapshot(s), ${summary.proposalCount} proposal(s), ${summary.duplicateCount} duplicate(s), ${summary.rejectedCount} rejected input(s).`,
      );
    } catch (error) {
      summary.status = stopping ? 'interrupted' : 'failed';
      summary.error = error.status
        ? error.message
        : 'Research processing failed. Check Neo4j connectivity and backend logs. Completed source snapshots were preserved.';
      await store.event(run.id, 'error', summary.error).catch(() => {});
    } finally {
      await store.finish(run.id, summary);
      aborter = null;
    }
    return summary;
  }
  async function launch(trigger = 'manual') {
    if (stopping) throw serviceError('Research worker is shutting down. Retry after deployment.');
    const absent = missing();
    if (absent.length) throw serviceError(`Research agent needs: ${absent.join(', ')}.`);
    if (active) throw serviceError('A research run is already active.', 409);
    const run = await store.acquire(trigger, clock(), randomUUID());
    if (!run) return null;
    active = processRun(run)
      .catch(() => {
        console.error('Research run persistence failed; lease recovery is enabled.');
      })
      .finally(() => {
        active = null;
      });
    return { id: run.id, status: 'running' };
  }
  return {
    launch,
    async status() {
      const absent = missing();
      let state = null,
        storageError = '';
      if (env.NEO4J_URI && env.NEO4J_PASSWORD) {
        try {
          state = await store.snapshot();
        } catch {
          storageError =
            'Neo4j could not initialize. Check URI, password, database name and schema permissions.';
        }
      }
      return {
        ready: !absent.length && Boolean(state),
        missing: absent,
        storageError,
        dailyLimit,
        maxSources,
        scope: WATCHLIST,
        sourceDomains: SOURCE_DOMAINS,
        lastCheck,
        scheduleDisabledByEnvironment: env.AGENT_ENABLED === 'false',
        ...(state || {
          control: null,
          runs: [],
          candidates: [],
          events: [],
          current: [],
          searchesToday: 0,
        }),
        ...(state && env.AGENT_ENABLED === 'false'
          ? { control: { ...state.control, enabled: false } }
          : {}),
      };
    },
    async configure(input) {
      if (
        !input ||
        typeof input.enabled !== 'boolean' ||
        !Array.isArray(input.watchlist) ||
        input.watchlist.length < 1 ||
        input.watchlist.length > 6 ||
        new Set(input.watchlist).size !== input.watchlist.length ||
        input.watchlist.some((t) => !WATCHLIST.includes(t)) ||
        !Number.isInteger(input.intervalMinutes) ||
        input.intervalMinutes < 60 ||
        input.intervalMinutes > 10080
      )
        throw serviceError(
          'Choose 1–6 supported companies, an enabled flag, and an interval of 60–10,080 minutes.',
          400,
        );
      return store.configure({
        enabled: input.enabled,
        watchlist: input.watchlist,
        intervalMinutes: input.intervalMinutes,
      });
    },
    async review(id, input) {
      if (
        !/^[a-f0-9]{64}$/.test(id) ||
        !['approve', 'reject'].includes(input?.decision) ||
        typeof input.expectedVersion !== 'string' ||
        input.expectedVersion.length > 150 ||
        (input.reason !== undefined &&
          (typeof input.reason !== 'string' || input.reason.length > 500))
      )
        throw serviceError(
          'Provide a valid proposal, decision, expected version and optional review note (max 500 characters).',
          400,
        );
      return store.review(id, input.decision, input.expectedVersion, input.reason || '');
    },
    history: (id) => store.history(id),
    async check() {
      if (missing().length) throw serviceError(`Configure ${missing().join(', ')} first.`);
      await store.initialize();
      const signal = AbortSignal.timeout(60000);
      const result = await search('NVDA', signal);
      if (!Array.isArray(result.results))
        throw serviceError('Exa connectivity check returned an invalid response.');
      const reply = await inference.complete(
        [{ role: 'user', content: 'Reply with the word READY.' }],
        { maxTokens: 32, signal },
      );
      lastCheck = {
        at: new Date(clock()).toISOString(),
        neo4j: true,
        exa: true,
        nosana: true,
        model: reply.model,
      };
      return lastCheck;
    },
    start() {
      if (timer || env.AGENT_ENABLED === 'false') return;
      stopping = false;
      const tick = () => {
        if (!active && !missing().length) launch('scheduled').catch(() => {});
      };
      timer = setInterval(tick, 60000);
      timer.unref();
      tick();
    },
    async stop() {
      stopping = true;
      clearInterval(timer);
      timer = null;
      aborter?.abort();
      if (active) await active;
    },
    async idle() {
      if (active) return active;
    },
  };
}
