import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReviewerProvider, ReviewerConfigSchema } from '@oracle-gate/adapters';
import { validSpec } from './helpers.js';
import type { Interpretation } from '@oracle-gate/core';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const interpretation = {
  requirementId: 'DISCOUNT-001',
  operator: '>',
  unit: 'cents',
  threshold: 10000,
  assumptions: [],
  uncertainty: [],
  proposedCases: validSpec.cases,
} satisfies Interpretation;
const stage1 = {
  requirementId: 'DISCOUNT-001',
  requirement: 'Original authoritative text',
  definitions: [],
};
async function server(handler: (req: IncomingMessage, res: ServerResponse) => unknown) {
  const instance = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => instance.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    instance.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      instance.close((error) => (error ? reject(error) : resolve()))
    );
  });
  const address = instance.address();
  if (!address || typeof address === 'string') throw new Error('No server port');
  return `http://127.0.0.1:${address.port}/v1`;
}
async function body(req: IncomingMessage) {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  return JSON.parse(text);
}
function complete(res: ServerResponse, content: unknown, finish = 'stop') {
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      choices: [
        { finish_reason: finish, message: { role: 'assistant', content: JSON.stringify(content) } },
      ],
    })
  );
}

describe('OpenAI-compatible reviewer over real HTTP', () => {
  it('fingerprints actual prompt/schema and transport format separately from input', () => {
    const json = createReviewerProvider({
      type: 'openai-compatible',
      baseUrl: 'http://localhost:1/v1',
      model: 'model',
    });
    const text = createReviewerProvider({
      type: 'openai-compatible',
      baseUrl: 'http://localhost:1/v1',
      model: 'model',
      responseFormat: 'text',
    });
    expect(json.promptDigest?.('interpretation')).toMatch(/^[a-f0-9]{64}$/);
    expect(json.promptDigest?.('interpretation')).not.toBe(text.promptDigest?.('interpretation'));
  });
  it('uses two stateless JSON requests, Bearer env secret and configured base path', async () => {
    const requests: unknown[] = [];
    const baseUrl = await server(async (req, res) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/v1/chat/completions');
      expect(req.headers.authorization).toBe('Bearer unit-review-key');
      const request = await body(req);
      requests.push(request);
      expect(request.model).toBe('configured-model');
      expect(request.stream).toBe(false);
      expect(request.messages).toHaveLength(2);
      expect(request.tools).toBeUndefined();
      const envelope = JSON.parse(request.messages[1].content);
      expect(JSON.stringify(request.messages)).not.toContain('unit-review-key');
      if (envelope.stage === 'interpretation') {
        expect(Object.keys(envelope.input).sort()).toEqual([
          'definitions',
          'requirement',
          'requirementId',
        ]);
        complete(res, interpretation);
      } else complete(res, { differences: [], uncertainty: [] });
    });
    const provider = createReviewerProvider(
      { type: 'openai-compatible', baseUrl, model: 'configured-model', apiKeyEnv: 'REVIEW_KEY' },
      { environment: { REVIEW_KEY: 'unit-review-key' } }
    );
    expect(await provider.interpret(stage1)).toEqual(interpretation);
    expect(
      await provider.review({
        interpretation,
        candidateArtifacts: [{ path: 'source.ts', content: 'candidate' }],
      })
    ).toEqual({ differences: [], uncertainty: [] });
    expect(requests).toHaveLength(2);
  });
  it.each([401, 403, 429, 500])(
    'fails closed on HTTP %s without leaking provider response',
    async (status) => {
      const baseUrl = await server((_req, res) => {
        res.statusCode = status;
        res.end('sensitive-provider-response');
      });
      const provider = createReviewerProvider({
        type: 'openai-compatible',
        baseUrl,
        model: 'model',
      });
      await expect(provider.interpret(stage1)).rejects.toThrow(/Reviewer/);
      await provider
        .interpret(stage1)
        .catch((error) => expect(error.message).not.toContain('sensitive-provider-response'));
    }
  );
  it('rejects missing secrets without making requests', async () => {
    const provider = createReviewerProvider(
      {
        type: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:1/v1',
        model: 'model',
        apiKeyEnv: 'MISSING',
      },
      { environment: {} }
    );
    await expect(provider.interpret(stage1)).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' });
  });
  it('bounds response size and timeout', async () => {
    const large = await server((_req, res) => res.end('x'.repeat(10000)));
    await expect(
      createReviewerProvider({
        type: 'openai-compatible',
        baseUrl: large,
        model: 'model',
        maxOutputBytes: 100,
      }).interpret(stage1)
    ).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
    const hanging = await server(() => {});
    await expect(
      createReviewerProvider({
        type: 'openai-compatible',
        baseUrl: hanging,
        model: 'model',
        timeoutMs: 50,
      }).interpret(stage1)
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
  it.each(['length', 'tool_calls', 'content_filter'])(
    'rejects unfinished/refused completion %s',
    async (finish) => {
      const baseUrl = await server((_req, res) => complete(res, interpretation, finish));
      await expect(
        createReviewerProvider({ type: 'openai-compatible', baseUrl, model: 'model' }).interpret(
          stage1
        )
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  );
  it('rejects malformed model JSON and malformed structured interpretation', async () => {
    const baseUrl = await server((_req, res) => complete(res, { passed: true }));
    await expect(
      createReviewerProvider({ type: 'openai-compatible', baseUrl, model: 'model' }).interpret(
        stage1
      )
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('does not follow redirects with credentials', async () => {
    let hits = 0;
    const destination = await server((_req, res) => {
      hits++;
      complete(res, interpretation);
    });
    const baseUrl = await server((_req, res) => {
      res.statusCode = 307;
      res.setHeader('location', destination + '/chat/completions');
      res.end();
    });
    await expect(
      createReviewerProvider(
        { type: 'openai-compatible', baseUrl, model: 'model', apiKeyEnv: 'KEY' },
        { environment: { KEY: 'private-key' } }
      ).interpret(stage1)
    ).rejects.toThrow();
    expect(hits).toBe(0);
  });
  it('redacts an echoed credential from structured findings', async () => {
    const baseUrl = await server((_req, res) =>
      complete(res, {
        differences: [
          {
            requirementId: 'DISCOUNT-001',
            location: 'file:1',
            description: 'echo unit-review-key',
          },
        ],
        uncertainty: [],
      })
    );
    const provider = createReviewerProvider(
      { type: 'openai-compatible', baseUrl, model: 'model', apiKeyEnv: 'KEY' },
      { environment: { KEY: 'unit-review-key' } }
    );
    const result = await provider.review({ interpretation, candidateArtifacts: [] });
    expect(JSON.stringify(result)).not.toContain('unit-review-key');
  });
  it('supports providers without response_format and rejects insecure remote URLs', () => {
    expect(
      ReviewerConfigSchema.safeParse({
        type: 'openai-compatible',
        baseUrl: 'http://public.example/v1',
        model: 'model',
      }).success
    ).toBe(false);
    expect(
      ReviewerConfigSchema.safeParse({
        type: 'openai-compatible',
        baseUrl: 'https://example.invalid/v1?key=bad',
        model: 'model',
      }).success
    ).toBe(false);
    expect(
      ReviewerConfigSchema.safeParse({
        type: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'local',
        responseFormat: 'text',
      }).success
    ).toBe(true);
  });
});

describe('local command reviewer with real subprocesses', () => {
  async function program(code: string) {
    const root = await mkdtemp(join(tmpdir(), 'oracle-reviewer-test-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const file = join(root, 'agent.mjs');
    await writeFile(file, code);
    return { root, file };
  }
  it('uses literal argv, fresh empty cwd and an environment allowlist', async () => {
    const logRoot = await program('');
    const log = join(logRoot.root, 'audit.jsonl');
    const { file } = await program(
      `import {readFileSync,appendFileSync,readdirSync} from 'node:fs';const request=JSON.parse(readFileSync(0,'utf8'));appendFileSync(process.argv[2],JSON.stringify({cwd:process.cwd(),files:readdirSync('.'),arg:process.argv[3],key:process.env.TEST_REVIEW_KEY,other:process.env.NOT_ALLOWED,stage:request.stage})+'\\n');console.log(JSON.stringify(request.stage==='interpretation'?${JSON.stringify(interpretation)}:{differences:[],uncertainty:[]}));`
    );
    const provider = createReviewerProvider(
      {
        type: 'command',
        executable: process.execPath,
        args: [file, log, 'literal ; & argument'],
        model: 'local-agent',
        passEnv: ['TEST_REVIEW_KEY'],
      },
      { environment: { TEST_REVIEW_KEY: 'allowed', NOT_ALLOWED: 'hidden' } }
    );
    await provider.interpret(stage1);
    await provider.review({ interpretation, candidateArtifacts: [] });
    const rows = (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows[0].files).toEqual([]);
    expect(rows[0].arg).toBe('literal ; & argument');
    expect(rows[0].key).toBe('allowed');
    expect(rows[0].other).toBeUndefined();
    expect(rows[0].cwd).not.toBe(rows[1].cwd);
  });
  it('extracts a native CLI result envelope and can send a prompt', async () => {
    const { file } = await program(
      `import{readFileSync}from'node:fs';if(!readFileSync(0,'utf8').includes('JSON'))process.exit(2);console.log(JSON.stringify({result:JSON.stringify(${JSON.stringify(interpretation)})}));`
    );
    const provider = createReviewerProvider({
      type: 'command',
      executable: process.execPath,
      args: [file],
      inputFormat: 'prompt',
      responsePath: ['result'],
    });
    expect(await provider.interpret(stage1)).toEqual(interpretation);
  });
  it('reports unavailable command, malformed output and timeout safely', async () => {
    await expect(
      createReviewerProvider({ type: 'command', executable: 'oracle-no-reviewer' }).interpret(
        stage1
      )
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const bad = await program('console.log("candidate secret log");');
    await expect(
      createReviewerProvider({
        type: 'command',
        executable: process.execPath,
        args: [bad.file],
      }).interpret(stage1)
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const slow = await program('setInterval(()=>{},1000);');
    await expect(
      createReviewerProvider({
        type: 'command',
        executable: process.execPath,
        args: [slow.file],
        timeoutMs: 100,
      }).interpret(stage1)
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
