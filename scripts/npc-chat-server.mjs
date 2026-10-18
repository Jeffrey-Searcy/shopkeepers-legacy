/** Local Ollama bridge. It accepts speech only and returns no game actions or mutable state. */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { buildResidentMemoryPrompt, buildResidentPrompt, buildResidentScenePrompt, MAX_RESIDENT_REPLY_LENGTH,
  MAX_RESIDENT_SCENE_LINE_LENGTH, MAX_RESIDENT_SUMMARY_LENGTH, parseResidentReply, parseResidentSceneReply,
  parseResidentSummary, RESIDENT_CONDUCT_LEVELS, resolveResidentChatOutcome, buildCuddleDecisionPrompt,
  MAX_CUDDLE_REASON_LENGTH, MAX_RESIDENT_SCENE_LINES, MIN_RESIDENT_SCENE_LINES, parseCuddleDecision, buildGroupChatPrompt,
  parseGroupChatReply, MIN_GROUP_CHAT_LINES, MAX_GROUP_CHAT_LINES, MAX_GROUP_CHAT_LINE_LENGTH, RESIDENT_CHAT_PERSONAS,
  parseGroupChatLine, createGroupLineScanner, NO_RESIDENT_OFFER } from './npc-chat-supervisor.mjs';

/**
 * How long Ollama keeps the model in memory after each call.
 * why: Ollama's 5-minute default unloads the model between visits, and a cold load adds about 4-5 s
 * to the next reply. 30 minutes covers a normal play session without holding memory overnight.
 */
const OLLAMA_KEEP_ALIVE = '30m';

const allowedOrigins = new Set(['http://localhost:5273', 'http://127.0.0.1:5273', 'http://localhost:5276', 'http://127.0.0.1:5276']);

/** Validate local-only model configuration before any listening socket opens. */
function chatConfig(model, ollamaUrl) {
  if (!model) throw new Error('SHOPKEEPERS_LOCAL_MODEL is required. Tested model: gemma4:12b');
  if (!ollamaUrl) throw new Error('SHOPKEEPERS_OLLAMA_URL is required. Example: http://127.0.0.1:11434');
  if (model.length > 120) throw new Error('SHOPKEEPERS_LOCAL_MODEL is too long.');
  const ollamaEndpoint = new URL(ollamaUrl);
  if (ollamaEndpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', 'host.docker.internal'].includes(ollamaEndpoint.hostname)) {
    throw new Error('SHOPKEEPERS_OLLAMA_URL must be an HTTP localhost or Docker host address.');
  }
  return { model, ollamaEndpoint };
}

/** Write one JSON response and the narrow local-development CORS policy. */
function reply(res, status, payload, origin) {
  if (origin && allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

/** Read a bounded JSON request without accepting an oversized local payload. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '', settled = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (settled) return;
      raw += chunk;
      if (raw.length > 16_384) { settled = true; raw = ''; reject(new Error('Request is too large.')); }
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Request is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

/** Validate completed conversation exchanges and translate them into Ollama chat roles. */
function chatHistory(value, maxTurns) {
  if (!Array.isArray(value) || value.length > maxTurns || value.length % 2 !== 0) {
    throw new Error(`History must contain at most ${maxTurns / 2} completed exchanges.`);
  }
  return value.map((turn, index) => {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn) || Object.keys(turn).sort().join(',') !== 'role,text') {
      throw new Error('History contains an invalid turn.');
    }
    const expected = index % 2 === 0 ? 'player' : 'resident';
    const limit = expected === 'player' ? 120 : MAX_RESIDENT_REPLY_LENGTH;
    if (turn.role !== expected || typeof turn.text !== 'string' || !turn.text.trim()
      || turn.text.length > limit || /[\r\n]/.test(turn.text)) {
      throw new Error('History contains an invalid turn.');
    }
    return { role: expected === 'player' ? 'user' : 'assistant', content: turn.text.trim() };
  });
}

/** Handle one guarded chat turn. The local model receives no tools and cannot call game code. */
async function handleChat(req, res, origin, model, ollamaEndpoint, upstreamTimeoutMs) {
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request must be an object.');
  if (Object.keys(body).sort().join(',') !== 'context,history,message,residentId,summary') throw new Error('Request has unknown or missing fields.');
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 120) throw new Error('Message must contain 1 to 120 characters.');
  if (typeof body.summary !== 'string' || body.summary.length > MAX_RESIDENT_SUMMARY_LENGTH || /[{}\[\]\r\n]/.test(body.summary)) {
    throw new Error('Summary is invalid.');
  }
  if (!body.context || typeof body.context !== 'object' || Array.isArray(body.context)
    || typeof body.context.warningActive !== 'boolean' || typeof body.context.refusedToday !== 'boolean'
    || !Array.isArray(body.context.recentGifts)) {
    throw new Error('Boundary context is invalid.');
  }
  if (body.context.refusedToday) throw new Error('This resident has ended chat for today.');
  // buildResidentPrompt validates context.world and context.offers strictly before anything else uses them.
  const system = buildResidentPrompt(body.residentId, body.context);
  const allowedOffers = body.context.offers;
  const history = chatHistory(body.history, 6);
  const memory = body.summary.trim() ? [{ role: 'system', content: `Earlier conversation memory: ${body.summary.trim()}` }] : [];
  const response = await fetch(new URL('/api/chat', ollamaEndpoint), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(upstreamTimeoutMs),
    redirect: 'error',
    body: JSON.stringify({ model, stream: false, think: false, keep_alive: OLLAMA_KEEP_ALIVE, format: { type: 'object', additionalProperties: false,
      properties: { reply: { type: 'string', minLength: 1, maxLength: MAX_RESIDENT_REPLY_LENGTH },
        severity: { type: 'string', enum: RESIDENT_CONDUCT_LEVELS }, intimateTopic: { type: 'boolean' },
        offer: { type: 'string', enum: [NO_RESIDENT_OFFER, ...allowedOffers] } },
      required: ['reply', 'severity', 'intimateTopic', 'offer'] },
      messages: [{ role: 'system', content: system }, ...memory, ...history, { role: 'user', content: body.message.trim() }],
      options: { temperature: 0.65, num_ctx: 4096, num_predict: 240 } }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${(await response.text()).slice(0, 160)}`);
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || typeof payload.message?.content !== 'string') throw new Error('Ollama returned an invalid chat payload.');
  const parsed = parseResidentReply(payload.message.content, allowedOffers);
  const outcome = resolveResidentChatOutcome(body.message.trim(), parsed.severity, body.context.warningActive);
  // why: a resident who is warning, leaving, or calling the guard never also hands the player a reward.
  const offer = outcome === 'continue' ? parsed.offer : NO_RESIDENT_OFFER;
  reply(res, 200, { reply: parsed.reply, outcome, intimateTopic: parsed.intimateTopic, offer }, origin);
}

/** Ask one current resident for a speech-only Cuddle decision. */
async function handleCuddleDecision(req, res, origin, model, ollamaEndpoint, upstreamTimeoutMs) {
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).sort().join(',') !== 'context,dialogueRevision,history,offer,residentId') {
    throw new Error('Private-moment request has unknown or missing fields.');
  }
  if (!Number.isSafeInteger(body.dialogueRevision) || body.dialogueRevision < 1) throw new Error('Private-moment dialogue revision is invalid.');
  const history = chatHistory(body.history, 6);
  const system = buildCuddleDecisionPrompt(body.residentId, body.context, body.offer);
  const response = await fetch(new URL('/api/chat', ollamaEndpoint), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(upstreamTimeoutMs), redirect: 'error',
    body: JSON.stringify({ model, stream: false, think: false, keep_alive: OLLAMA_KEEP_ALIVE, format: { type: 'object', additionalProperties: false,
      properties: { accepted: { type: 'boolean' }, reason: { type: 'string', minLength: 1, maxLength: MAX_CUDDLE_REASON_LENGTH } },
      required: ['accepted', 'reason'] }, messages: [{ role: 'system', content: system }, ...history,
        { role: 'user', content: body.offer === 'bedroom' ? 'Should we head to the bedroom?' : 'Stay close with me right here.' }],
      options: { temperature: 0.7, num_ctx: 4096, num_predict: 140 } }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${(await response.text()).slice(0, 160)}`);
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || typeof payload.message?.content !== 'string') throw new Error('Ollama returned an invalid Cuddle payload.');
  reply(res, 200, parseCuddleDecision(payload.message.content), origin);
}

/** Compact bounded chat notes into one factual paragraph without invoking game systems. */
async function handleCompact(req, res, origin, model, ollamaEndpoint, upstreamTimeoutMs) {
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request must be an object.');
  if (Object.keys(body).sort().join(',') !== 'history,residentId,summary') throw new Error('Request has unknown or missing fields.');
  if (typeof body.summary !== 'string' || body.summary.length > MAX_RESIDENT_SUMMARY_LENGTH || /[{}\[\]\r\n]/.test(body.summary)) {
    throw new Error('Summary is invalid.');
  }
  const history = chatHistory(body.history, 40);
  if (history.length === 0) throw new Error('History is empty.');
  const transcript = history.map(turn => `${turn.role === 'user' ? 'Player' : 'Resident'}: ${turn.content}`).join('\n');
  const prior = body.summary.trim() ? `Existing memory: ${body.summary.trim()}\n` : '';
  const response = await fetch(new URL('/api/chat', ollamaEndpoint), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(upstreamTimeoutMs), redirect: 'error',
    body: JSON.stringify({ model, stream: false, think: false, keep_alive: OLLAMA_KEEP_ALIVE, format: { type: 'object', additionalProperties: false,
      properties: { summary: { type: 'string', minLength: 1, maxLength: MAX_RESIDENT_SUMMARY_LENGTH } }, required: ['summary'] },
      messages: [{ role: 'system', content: buildResidentMemoryPrompt(body.residentId) },
        { role: 'user', content: `${prior}Conversation:\n${transcript}` }],
      options: { temperature: 0.25, num_ctx: 4096, num_predict: 360 } }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${(await response.text()).slice(0, 160)}`);
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || typeof payload.message?.content !== 'string') throw new Error('Ollama returned an invalid summary payload.');
  reply(res, 200, { summary: parseResidentSummary(payload.message.content) }, origin);
}

/** Generate a 4-6 line speech-only scene for one server-allowed resident pair. The context names the opener. */
async function handleResidentScene(req, res, origin, model, ollamaEndpoint, upstreamTimeoutMs) {
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request must be an object.');
  if (Object.keys(body).sort().join(',') !== 'bondId,context,first,second') throw new Error('Request has unknown or missing fields.');
  const system = buildResidentScenePrompt(body.bondId, body.first, body.second, body.context);
  const response = await fetch(new URL('/api/chat', ollamaEndpoint), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(upstreamTimeoutMs), redirect: 'error',
    body: JSON.stringify({ model, stream: false, think: false, keep_alive: OLLAMA_KEEP_ALIVE, format: { type: 'object', additionalProperties: false,
      properties: { lines: { type: 'array', minItems: MIN_RESIDENT_SCENE_LINES, maxItems: MAX_RESIDENT_SCENE_LINES, items: { type: 'object', additionalProperties: false,
        properties: { residentId: { type: 'string', enum: [body.first, body.second] },
          text: { type: 'string', minLength: 1, maxLength: MAX_RESIDENT_SCENE_LINE_LENGTH } },
        required: ['residentId', 'text'] } } }, required: ['lines'] },
      messages: [{ role: 'system', content: system }, { role: 'user', content: 'Write this meeting now.' }],
      options: { temperature: 0.7, num_ctx: 4096, num_predict: 640 } }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${(await response.text()).slice(0, 160)}`);
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || typeof payload.message?.content !== 'string') throw new Error('Ollama returned an invalid resident scene payload.');
  reply(res, 200, parseResidentSceneReply(payload.message.content, body.bondId, body.context.opener), origin);
}

/** Most recent group turns the game may send. Trimming older turns is the game's job. */
const MAX_GROUP_HISTORY_TURNS = 8;
/** Longest player line, matching the face-to-face chat limit. */
const MAX_GROUP_PLAYER_LINE_LENGTH = 120;

/**
 * Validate the recent group transcript and render it with display names, not ids, for the model.
 * @param value array of at most 8 exact {speaker, text} turns; speaker is 'player' or a seated resident id
 * @param residentIds the seated group, already validated by buildGroupChatPrompt
 * @returns one "Name: text" line per turn, joined by newlines ('' when there is no history)
 * @throws when the list is too long or any turn is malformed
 */
function groupTranscript(value, residentIds) {
  if (!Array.isArray(value) || value.length > MAX_GROUP_HISTORY_TURNS) {
    throw new Error(`Group history must contain at most ${MAX_GROUP_HISTORY_TURNS} turns.`);
  }
  return value.map(turn => {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn) || Object.keys(turn).sort().join(',') !== 'speaker,text'
      || (turn.speaker !== 'player' && !residentIds.includes(turn.speaker))) {
      throw new Error('Group history contains an invalid turn.');
    }
    const limit = turn.speaker === 'player' ? MAX_GROUP_PLAYER_LINE_LENGTH : MAX_GROUP_CHAT_LINE_LENGTH;
    if (typeof turn.text !== 'string' || !turn.text.trim() || turn.text.length > limit || /[\r\n]/.test(turn.text)) {
      throw new Error('Group history contains an invalid turn.');
    }
    return `${turn.speaker === 'player' ? 'Shopkeeper' : RESIDENT_CHAT_PERSONAS[turn.speaker][0]}: ${turn.text.trim()}`;
  }).join('\n');
}

/** Longest group-chat model reply the bridge will read, matching parseGroupChatReply's own cap. */
const MAX_GROUP_REPLY_LENGTH = 6_000;

/**
 * Read Ollama's streamed chat reply (one JSON object per line) and hand each new piece of model text to onPiece.
 * @param response the streaming fetch response from /api/chat with stream: true
 * @param onPiece called with each new text piece, in order
 * @returns the full model text once Ollama reports done
 * @throws when a stream line is not valid JSON, Ollama reports an error, the text grows too long, or done never arrives
 */
async function readOllamaStream(response, onPiece) {
  const decoder = new TextDecoder();
  let buffered = '', content = '', done = false;
  /** Handle one complete NDJSON line from Ollama. */
  const handleLine = raw => {
    if (!raw.trim()) return;
    let event;
    try { event = JSON.parse(raw); } catch { throw new Error('Ollama returned an invalid stream line.'); }
    if (!event || typeof event !== 'object') throw new Error('Ollama returned an invalid stream line.');
    if (typeof event.error === 'string') throw new Error(`Ollama stream failed: ${event.error.slice(0, 160)}`);
    if (typeof event.message?.content !== 'string') throw new Error('Ollama returned an invalid group chat payload.');
    content += event.message.content;
    if (content.length > MAX_GROUP_REPLY_LENGTH) throw new Error('Model group chat content is invalid.');
    if (event.message.content) onPiece(event.message.content);
    if (event.done === true) done = true;
  };
  for await (const chunk of response.body) {
    buffered += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      handleLine(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
    }
  }
  buffered += decoder.decode();
  handleLine(buffered);
  if (!done) throw new Error('Ollama ended the group chat stream early.');
  return content;
}

/**
 * Generate 2-4 speech-only lines for one evening group chat of 3-5 residents with the player present.
 *
 * The reply streams to the game as NDJSON (one JSON object per line) so the first speaker can talk
 * after about 5 s instead of waiting about 20 s for the whole turn:
 *   {"line":{"residentId","text"}}  each checked line, as soon as the model finishes it
 *   {"done":true}                   the turn is complete and passed the whole-reply checks
 *   {"error":"..."}                 a failure after some lines were already sent
 * A failure before the first line still throws, so the caller answers HTTP 400 JSON as for every other route.
 */
async function handleGroupChat(req, res, origin, model, ollamaEndpoint, upstreamTimeoutMs) {
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request must be an object.');
  if (Object.keys(body).sort().join(',') !== 'context,history,playerLine,residentIds') throw new Error('Request has unknown or missing fields.');
  // why: an empty player line is the explicit "the player said nothing this turn" signal; whitespace alone is not.
  if (typeof body.playerLine !== 'string' || body.playerLine.length > MAX_GROUP_PLAYER_LINE_LENGTH || /[\r\n]/.test(body.playerLine)
    || (body.playerLine !== '' && !body.playerLine.trim())) {
    throw new Error(`Player line must be empty or contain 1 to ${MAX_GROUP_PLAYER_LINE_LENGTH} characters.`);
  }
  // The prompt builder validates residentIds first, so the transcript check can trust the group list.
  const system = buildGroupChatPrompt(body.residentIds, body.context);
  const transcript = groupTranscript(body.history, body.residentIds);
  const user = (transcript ? `Recent conversation:\n${transcript}\n` : 'The conversation is just starting.\n')
    + (body.playerLine ? `The shopkeeper says: ${body.playerLine.trim()}\n` : '')
    + 'Continue the group conversation now.';
  // why: the game pre-generates the next table turn and drops it when the keeper acts first. Stopping the
  // model call when the game hangs up frees the single local model for the turn the keeper is waiting on.
  const hungUp = new AbortController();
  res.on('close', () => { if (!res.writableEnded) hungUp.abort(); });
  const response = await fetch(new URL('/api/chat', ollamaEndpoint), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.any([AbortSignal.timeout(upstreamTimeoutMs), hungUp.signal]), redirect: 'error',
    body: JSON.stringify({ model, stream: true, think: false, keep_alive: OLLAMA_KEEP_ALIVE, format: { type: 'object', additionalProperties: false,
      properties: { lines: { type: 'array', minItems: MIN_GROUP_CHAT_LINES, maxItems: MAX_GROUP_CHAT_LINES, items: { type: 'object', additionalProperties: false,
        properties: { residentId: { type: 'string', enum: body.residentIds },
          text: { type: 'string', minLength: 1, maxLength: MAX_GROUP_CHAT_LINE_LENGTH } },
        required: ['residentId', 'text'] } } }, required: ['lines'] },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      // why: num_predict stays small because the local model writes about 15 tokens/s and 2-4 short lines fit.
      options: { temperature: 0.75, num_ctx: 4096, num_predict: 360 } }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${(await response.text()).slice(0, 160)}`);
  if (!response.body) throw new Error('Ollama returned no group chat stream.');
  const scanner = createGroupLineScanner();
  let previousSpeaker = null, sent = 0;
  /** Send one NDJSON event, opening the 200 stream on the first one. */
  const send = event => {
    if (sent === 0) {
      if (origin && allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    }
    sent++;
    res.write(`${JSON.stringify(event)}\n`);
  };
  try {
    const content = await readOllamaStream(response, piece => {
      for (const raw of scanner.push(piece)) {
        const line = parseGroupChatLine(raw, body.residentIds, previousSpeaker);
        previousSpeaker = line.residentId;
        send({ line });
      }
    });
    // why: the per-line checks cannot see the line count or extra top-level keys; the whole-reply check can.
    parseGroupChatReply(content, body.residentIds);
    send({ done: true });
    res.end();
  } catch (error) {
    // Before the first line the normal 400 JSON reply still works, so the outer handler sends it.
    if (sent === 0) throw error;
    res.end(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  }
}

/** Create a testable local bridge. Importing this module never starts a service. */
export function createNpcChatServer(options) {
  const { model, ollamaEndpoint } = chatConfig(options?.model, options?.ollamaUrl);
  const upstreamTimeoutMs = options?.upstreamTimeoutMs ?? 45_000;
  if (!Number.isInteger(upstreamTimeoutMs) || upstreamTimeoutMs < 10 || upstreamTimeoutMs > 60_000) {
    throw new Error('NPC chat upstream timeout is invalid.');
  }
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return reply(res, 403, { error: 'Origin is not allowed.' });
    if (req.method === 'OPTIONS') {
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }
    if (req.method !== 'POST' || !['/chat', '/chat/compact', '/chat/group', '/chat/scene', '/chat/cuddle'].includes(req.url)) return reply(res, 404, { error: 'Not found.' }, origin);
    try {
      if (req.url === '/chat/compact') await handleCompact(req, res, origin, model, ollamaEndpoint, upstreamTimeoutMs);
      else if (req.url === '/chat/group') await handleGroupChat(req, res, origin, model, ollamaEndpoint, upstreamTimeoutMs);
      else if (req.url === '/chat/scene') await handleResidentScene(req, res, origin, model, ollamaEndpoint, upstreamTimeoutMs);
      else if (req.url === '/chat/cuddle') await handleCuddleDecision(req, res, origin, model, ollamaEndpoint, upstreamTimeoutMs);
      else await handleChat(req, res, origin, model, ollamaEndpoint, upstreamTimeoutMs);
    }
    catch (error) { reply(res, 400, { error: error instanceof Error ? error.message : String(error) }, origin); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const model = process.env.SHOPKEEPERS_LOCAL_MODEL;
  // The browser client and origin guard share this fixed loopback port as one explicit protocol contract.
  const port = 5277;
  const host = process.env.SHOPKEEPERS_CHAT_HOST || '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '0.0.0.0') throw new Error('SHOPKEEPERS_CHAT_HOST must be 127.0.0.1 or 0.0.0.0.');
  const server = createNpcChatServer({ model, ollamaUrl: process.env.SHOPKEEPERS_OLLAMA_URL });
  server.listen(port, host, () => {
    process.stdout.write(`Shopkeepers Legacy local character chat: http://${host}:${port} using ${model}\n`);
  });
}
