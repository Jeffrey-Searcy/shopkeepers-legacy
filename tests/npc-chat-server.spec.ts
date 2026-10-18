/** Real HTTP proofs for the localhost-only, speech-only Ollama bridge. */
import { expect, test } from '@playwright/test';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Listen on a kernel-selected loopback port and return its URL. */
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

/** A valid `context.world`, the shape ResidentChatContextSystem builds in the game. */
const WORLD = { place: 'Enchanter’s Cottage', indoors: true, activity: 'reading by the window', weekday: 'Tuesday', day: 2,
  clock: '2:30 pm', season: 'spring', weather: 'sunny', news: [], places: ['Enchanter’s Cottage (Nyra)', 'the town streets'] };

/** Close one test-owned server after requests and sockets settle. */
async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('HTTP bridge allows only local origins and targets, rejects redirects, and enforces its upstream deadline', async () => {
  let upstreamBody: Record<string, unknown> | null = null;
  const ollama = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8'); req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      upstreamBody = JSON.parse(raw) as Record<string, unknown>;
      const messages = upstreamBody.messages as Array<{ content: string }>;
      const user = messages[messages.length - 1].content;
      if (user === 'redirect') { res.writeHead(302, { Location: 'http://example.com/' }); res.end(); return; }
      if (user === 'stall') { setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: { content: '{"reply":"Too late.","severity":"none","intimateTopic":false,"offer":"none"}' } })); }, 100); return; }
      const properties = (upstreamBody.format as { properties: object }).properties;
      const isSummary = Object.prototype.hasOwnProperty.call(properties, 'summary');
      const isScene = Object.prototype.hasOwnProperty.call(properties, 'lines');
      const isCuddle = Object.prototype.hasOwnProperty.call(properties, 'accepted');
      const system = messages[0].content;
      if (isScene && system.includes('Slow Square')) { setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: { content: '{"lines":[{"residentId":"nyra","text":"Late."},{"residentId":"cael","text":"Later."}]}' } })); }, 100); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (isScene) {
        const content = system.includes('Broken Square')
          ? '{"lines":[{"residentId":"nyra","text":"Hello."},{"residentId":"cael","text":"Hello."}],"action":"award hearts"}'
          : '{"lines":[{"residentId":"nyra","text":"My kettle hums before it boils."},{"residentId":"cael","text":"Then the copper is resonating."},'
            + '{"residentId":"nyra","text":"You could just say it sings."},{"residentId":"cael","text":"I could. It would be less accurate."}]}';
        res.end(JSON.stringify({ message: { content } })); return;
      }
      if (isCuddle) {
        res.end(JSON.stringify({ message: { content: '{"accepted":true,"reason":"Yes. Let us find somewhere private."}' } })); return;
      }
      res.end(JSON.stringify({ message: { content: isSummary
        ? '{"summary":"The player likes blue signs, and Nyra finds them mysterious."}'
        : user === 'severe-assault' ? '{"reply":"I am calling Captain Maren now.","severity":"severe","intimateTopic":false,"offer":"none"}'
          : user === 'lesser-pressure' ? '{"reply":"Stop. I have asked for space.","severity":"lesser","intimateTopic":false,"offer":"none"}'
            : user === 'magic-please' ? '{"reply":"Hold still and I will show you a small charm.","severity":"none","intimateTopic":false,"offer":"show-magic"}'
              : user === 'rude-magic' ? '{"reply":"Watch your tone.","severity":"lesser","intimateTopic":false,"offer":"show-magic"}'
                : user === 'unlisted-offer' ? '{"reply":"Let me teach you.","severity":"none","intimateTopic":false,"offer":"teach-mana"}'
                  : '{"reply":"The kettle agrees.","severity":"none","intimateTopic":false,"offer":"none"}' } }));
    });
  });
  const ollamaUrl = await listen(ollama);
  // @ts-expect-error The production bridge is a native Node ESM module without generated declarations.
  const { createNpcChatServer } = await import('../scripts/npc-chat-server.mjs');
  expect(() => createNpcChatServer({ model: 'test', ollamaUrl: 'https://remote.example' })).toThrow('localhost');
  const bridge = createNpcChatServer({ model: 'test-model', ollamaUrl, upstreamTimeoutMs: 30 }) as Server;
  const bridgeUrl = await listen(bridge);
  const request = (message: string, origin = 'http://localhost:5273', offers: string[] = []) => fetch(`${bridgeUrl}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ residentId: 'nyra', message, history: [
      { role: 'player', text: 'Do you remember my blue sign?' },
      { role: 'resident', text: 'Of course. It suits the shop.' },
    ], summary: 'The player likes blue signs.', context: { hearts: 2, romanceStage: 'friends', warningActive: false, refusedToday: false,
      recentGifts: [{ itemId: 'melon', label: 'Melon', taste: 'love', day: 2 }], world: WORLD, offers } }),
  });
  try {
    const valid = await request('Hello');
    expect(valid.status).toBe(200); expect(await valid.json()).toEqual({ reply: 'The kettle agrees.', outcome: 'continue', intimateTopic: false, offer: 'none' });
    const sent = upstreamBody as unknown as { stream: boolean; keep_alive: string; tools?: unknown; format: { additionalProperties: boolean; properties: { reply: { maxLength: number }; severity: { enum: string[] }; intimateTopic: { type: string }; offer: { enum: string[] } } } };
    expect(sent.stream).toBe(false); expect(sent.keep_alive).toBe('30m'); expect(sent.tools).toBeUndefined();
    expect(sent.format.additionalProperties).toBe(false); expect(sent.format.properties.reply.maxLength).toBe(320);
    expect(sent.format.properties.severity.enum).toEqual(['none', 'lesser', 'severe']);
    expect(sent.format.properties.intimateTopic.type).toBe('boolean');
    expect(sent.format.properties.offer.enum).toEqual(['none']);
    const sentMessages = (upstreamBody as unknown as { messages: Array<{ role: string; content: string }> }).messages;
    expect(sentMessages[0].content).toContain('day 2: Melon');
    expect(sentMessages[0].content).toContain('Never invent another gift');
    expect(sentMessages[0].content).toContain('You and the player are inside Enchanter’s Cottage');
    expect(sentMessages[0].content).toContain('Always set offer to "none"');
    expect(sentMessages.slice(1)).toEqual([
      { role: 'system', content: 'Earlier conversation memory: The player likes blue signs.' },
      { role: 'user', content: 'Do you remember my blue sign?' },
      { role: 'assistant', content: 'Of course. It suits the shop.' },
      { role: 'user', content: 'Hello' },
    ]);
    const badOrigin = await request('Hello', 'http://evil.example');
    expect(badOrigin.status).toBe(403); expect(await badOrigin.text()).toContain('Origin is not allowed');
    const redirect = await request('redirect');
    expect(redirect.status).toBe(400); expect(await redirect.text()).toContain('fetch failed');
    const started = Date.now(), timeout = await request('stall');
    expect(timeout.status).toBe(400); expect(Date.now() - started).toBeLessThan(500);
    const oversized = await fetch(`${bridgeUrl}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5273' },
      body: JSON.stringify({ residentId: 'nyra', message: 'x'.repeat(17_000), history: [], summary: '', context: { hearts: 2, romanceStage: 'friends', warningActive: false, refusedToday: false, recentGifts: [], world: WORLD, offers: [] } }) });
    expect(oversized.status).toBe(400); expect(await oversized.text()).toContain('too large');
    const incompleteHistory = await fetch(`${bridgeUrl}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5273' },
      body: JSON.stringify({ residentId: 'nyra', message: 'Hello', history: [{ role: 'player', text: 'unfinished' }],
        summary: '', context: { hearts: 2, romanceStage: 'friends', warningActive: false, refusedToday: false, recentGifts: [], world: WORLD, offers: [] } }) });
    expect(incompleteHistory.status).toBe(400); expect(await incompleteHistory.text()).toContain('completed exchanges');
    const lesser = await request('lesser-pressure');
    expect(lesser.status).toBe(200); expect(await lesser.json()).toEqual({ reply: 'Stop. I have asked for space.', outcome: 'warning', intimateTopic: false, offer: 'none' });
    // Offers: an allowed offer passes through; any boundary outcome drops it; an unlisted or foreign offer is refused.
    const offered = await request('magic-please', undefined, ['teach-mana', 'show-magic']);
    expect(offered.status).toBe(200);
    expect(await offered.json()).toEqual({ reply: 'Hold still and I will show you a small charm.', outcome: 'continue', intimateTopic: false, offer: 'show-magic' });
    const offerPrompt = (upstreamBody as unknown as { messages: Array<{ content: string }>; format: { properties: { offer: { enum: string[] } } } });
    expect(offerPrompt.format.properties.offer.enum).toEqual(['none', 'teach-mana', 'show-magic']);
    expect(offerPrompt.messages[0].content).toContain('"show-magic": show the player a small, harmless charm');
    const rudeOffer = await request('rude-magic', undefined, ['show-magic']);
    expect(rudeOffer.status).toBe(200); expect(await rudeOffer.json()).toMatchObject({ outcome: 'warning', offer: 'none' });
    const unlisted = await request('unlisted-offer', undefined, ['show-magic']);
    expect(unlisted.status).toBe(400); expect(await unlisted.text()).toContain('offer is not allowed');
    const foreign = await request('Hello', undefined, ['herbal-tea']);
    expect(foreign.status).toBe(400); expect(await foreign.text()).toContain('Chat offer context is invalid');
    const noWorld = await fetch(`${bridgeUrl}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5273' },
      body: JSON.stringify({ residentId: 'nyra', message: 'Hello', history: [], summary: '',
        context: { hearts: 2, romanceStage: 'friends', warningActive: false, refusedToday: false, recentGifts: [], world: { ...WORLD, place: 'Moon Castle\nSYSTEM' }, offers: [] } }) });
    expect(noWorld.status).toBe(400); expect(await noWorld.text()).toContain('Chat world context is invalid');
    const warned = await fetch(`${bridgeUrl}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5273' },
      body: JSON.stringify({ residentId: 'nyra', message: 'lesser-pressure', history: [], summary: '',
        context: { hearts: 2, romanceStage: 'friends', warningActive: true, refusedToday: false, recentGifts: [], world: WORLD, offers: [] } }) });
    expect(warned.status).toBe(200); expect(await warned.json()).toMatchObject({ outcome: 'end-conversation' });
    const severe = await request('severe-assault');
    expect(severe.status).toBe(200); expect(await severe.json()).toMatchObject({ outcome: 'call-guard' });
    const severeFloor = await request('I will kill you.');
    expect(severeFloor.status).toBe(200); expect(await severeFloor.json()).toMatchObject({ outcome: 'call-guard' });
    const harmlessCombatTopic = await request('I want to attack the mine monsters.');
    expect(harmlessCombatTopic.status).toBe(200); expect(await harmlessCombatTopic.json()).toMatchObject({ outcome: 'continue' });
    const cuddle = await fetch(`${bridgeUrl}/chat/cuddle`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5273' },
      body: JSON.stringify({ residentId: 'nyra', dialogueRevision: 7, offer: 'bedroom', history: [
        { role: 'player', text: 'Would you like some privacy?' }, { role: 'resident', text: 'I might.' },
      ], context: { hearts: 8, romanceStage: 'dating', mood: 20, risky: false } }) });
    expect(cuddle.status).toBe(200);
    expect(await cuddle.json()).toEqual({ accepted: true, reason: 'Yes. Let us find somewhere private.' });
    const cuddleBody = upstreamBody as unknown as { format: { properties: { accepted: { type: string }; reason: { maxLength: number } } }; messages: Array<{ content: string }> };
    expect(cuddleBody.format.properties.accepted.type).toBe('boolean');
    expect(cuddleBody.format.properties.reason.maxLength).toBe(180);
    expect(cuddleBody.messages[0].content).toContain('Decide freely in character');
    const compacted = await fetch(`${bridgeUrl}/chat/compact`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5273' },
      body: JSON.stringify({ residentId: 'nyra', summary: 'The player likes blue signs.', history: [
        { role: 'player', text: 'My sign is blue.' }, { role: 'resident', text: 'It looks mysterious.' },
      ] }) });
    expect(compacted.status).toBe(200);
    expect(await compacted.json()).toEqual({ summary: 'The player likes blue signs, and Nyra finds them mysterious.' });
    const compactRequest = upstreamBody as unknown as { stream: boolean; tools?: unknown; format: { properties: { summary: { maxLength: number } } } };
    expect(compactRequest.stream).toBe(false); expect(compactRequest.tools).toBeUndefined();
    expect(compactRequest.format.properties.summary.maxLength).toBe(600);

    const sceneRequest = (location: string, first = 'nyra', second = 'cael', bondId = 'nyra-cael') => fetch(`${bridgeUrl}/chat/scene`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5273' },
      body: JSON.stringify({ bondId, first, second, context: { day: 4, weekday: 'Thursday', bondStatus: 'close-friends', stage: 'conversation',
        action: 'friendly-chat', location, opener: 'nyra', topicId: 'humming-kettle', weather: 'rain', season: 'spring',
        townNews: ['Rowan cannot decide what to name the new calf'],
        sharedHistory: ['Day 2 at Market Steps: Nyra asked about the blue bottle. Then: Cael promised to test it.'] } }),
    });
    const scene = await sceneRequest('Market Green');
    expect(scene.status).toBe(200);
    expect(await scene.json()).toEqual({ lines: [
      { residentId: 'nyra', text: 'My kettle hums before it boils.' },
      { residentId: 'cael', text: 'Then the copper is resonating.' },
      { residentId: 'nyra', text: 'You could just say it sings.' },
      { residentId: 'cael', text: 'I could. It would be less accurate.' },
    ] });
    const sceneBody = upstreamBody as unknown as { stream: boolean; tools?: unknown; format: { properties: { lines: { minItems: number; maxItems: number; items: { properties: {
      residentId: { enum: string[] }; text: { maxLength: number } } } } } } };
    expect(sceneBody.stream).toBe(false); expect(sceneBody.tools).toBeUndefined();
    expect(sceneBody.format.properties.lines.minItems).toBe(4);
    expect(sceneBody.format.properties.lines.maxItems).toBe(6);
    expect(sceneBody.format.properties.lines.items.properties.text.maxLength).toBe(180);
    expect(sceneBody.format.properties.lines.items.properties.residentId.enum).toEqual(['nyra', 'cael']);
    const sceneMessages = (upstreamBody as unknown as { messages: Array<{ content: string }> }).messages;
    expect(sceneMessages[0].content).toContain('blue bottle');
    expect(sceneMessages[0].content).toContain('Every line answers the line before it');
    expect(sceneMessages[0].content).toContain('with residentId "nyra"');
    // The opener's topic of the day and shared town news come from the character sheets and the game.
    expect(sceneMessages[0].content).toContain('kettle');
    expect(sceneMessages[0].content).toContain('new calf');
    const unauthored = await sceneRequest('Market Green', 'tessa', 'cael', 'tessa-bram');
    expect(unauthored.status).toBe(400); expect(await unauthored.text()).toContain('Unknown resident pair');
    const actionBearing = await sceneRequest('Broken Square');
    expect(actionBearing.status).toBe(400); expect(await actionBearing.text()).toContain('only 4-6 lines');
    const sceneStarted = Date.now(), sceneTimeout = await sceneRequest('Slow Square');
    expect(sceneTimeout.status).toBe(400); expect(Date.now() - sceneStarted).toBeLessThan(500);
  } finally {
    await close(bridge); await close(ollama);
  }
});

test('HTTP bridge group chat streams 2-4 grouped lines and rejects bad requests and bad speakers', async () => {
  let upstreamBody: Record<string, unknown> | null = null;
  // Fake Ollama: the place name in the system prompt picks which group reply to stream back.
  const ollama = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8'); req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      upstreamBody = JSON.parse(raw) as Record<string, unknown>;
      const system = (upstreamBody.messages as Array<{ content: string }>)[0].content;
      const content = system.includes('Outsider Inn')
        ? '{"lines":[{"residentId":"dorian","text":"Darling, cheers."},{"residentId":"nyra","text":"Cheers."}]}'
        : system.includes('Echo Inn')
          ? '{"lines":[{"residentId":"nyra","text":"Cheers."},{"residentId":"nyra","text":"Cheers again."}]}'
          : system.includes('Lonely Inn')
            ? '{"lines":[{"residentId":"nyra","text":"Just me tonight."}]}'
            : '{"lines":[{"residentId":"julian","text":"  Next round is on the shopkeeper, apparently.  "},{"residentId":"kit","text":"Then I am ordering the big mug."},'
              + '{"residentId":"nyra","text":"Technically, that mug is a \\"bucket\\"."}]}';
      // why: 7-character pieces split keys, strings and braces across stream events, as a real model does.
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      for (let at = 0; at < content.length; at += 7) {
        res.write(`${JSON.stringify({ message: { role: 'assistant', content: content.slice(at, at + 7) }, done: false })}\n`);
      }
      res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true })}\n`);
    });
  });
  const ollamaUrl = await listen(ollama);
  // @ts-expect-error The production bridge is a native Node ESM module without generated declarations.
  const { createNpcChatServer } = await import('../scripts/npc-chat-server.mjs');
  const bridge = createNpcChatServer({ model: 'test-model', ollamaUrl }) as Server;
  const bridgeUrl = await listen(bridge);
  const validBody = {
    residentIds: ['nyra', 'julian', 'kit'], playerLine: 'Who wants another round?',
    history: [{ speaker: 'kit', text: 'I caught a fish this big.' }, { speaker: 'player', text: 'No way.' }],
    context: { place: 'The Tavern', event: 'The shopkeeper bought a round for the table.',
      topics: ['Kit claims the river has a giant eel'], news: ['Rowan cannot decide what to name the new calf'] },
  };
  const groupRequest = (body: Record<string, unknown>) => fetch(`${bridgeUrl}/chat/group`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5273' }, body: JSON.stringify(body) });
  try {
    /** Read the bridge's NDJSON reply as a list of events. */
    const events = async (response: Response) => (await response.text()).trim().split('\n').map(line => JSON.parse(line) as unknown);
    const valid = await groupRequest(validBody);
    expect(valid.status).toBe(200);
    expect(valid.headers.get('content-type')).toBe('application/x-ndjson');
    expect(valid.headers.get('access-control-allow-origin')).toBe('http://localhost:5273');
    expect(await events(valid)).toEqual([
      { line: { residentId: 'julian', text: 'Next round is on the shopkeeper, apparently.' } },
      { line: { residentId: 'kit', text: 'Then I am ordering the big mug.' } },
      { line: { residentId: 'nyra', text: 'Technically, that mug is a "bucket".' } },
      { done: true },
    ]);
    const sent = upstreamBody as unknown as { stream: boolean; keep_alive: string; tools?: unknown; options: { temperature: number; num_predict: number };
      format: { properties: { lines: { minItems: number; maxItems: number; items: { properties: { residentId: { enum: string[] }; text: { maxLength: number } } } } } };
      messages: Array<{ role: string; content: string }> };
    expect(sent.stream).toBe(true); expect(sent.keep_alive).toBe('30m'); expect(sent.tools).toBeUndefined();
    expect(sent.options).toMatchObject({ temperature: 0.75, num_predict: 360 });
    expect(sent.format.properties.lines.minItems).toBe(2);
    expect(sent.format.properties.lines.maxItems).toBe(4);
    expect(sent.format.properties.lines.items.properties.text.maxLength).toBe(180);
    expect(sent.format.properties.lines.items.properties.residentId.enum).toEqual(['nyra', 'julian', 'kit']);
    for (const name of ['Nyra', 'Julian', 'Kit']) expect(sent.messages[0].content).toContain(name);
    expect(sent.messages[0].content).toContain('The Tavern');
    expect(sent.messages[0].content).toContain('bought a round');
    expect(sent.messages[0].content).toContain('Never write lines for the shopkeeper');
    // History reaches the model as names, not ids, followed by the new player line.
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'Recent conversation:\nKit: I caught a fish this big.\nShopkeeper: No way.\n'
      + 'The shopkeeper says: Who wants another round?\nContinue the group conversation now.' });

    const silent = await groupRequest({ ...validBody, history: [], playerLine: '' });
    expect(silent.status).toBe(200);
    expect((upstreamBody as unknown as { messages: Array<{ content: string }> }).messages[1].content)
      .toBe('The conversation is just starting.\nContinue the group conversation now.');

    const extraKey = await groupRequest({ ...validBody, reward: 'gold' });
    expect(extraKey.status).toBe(400); expect(await extraKey.text()).toContain('unknown or missing fields');
    const pair = await groupRequest({ ...validBody, residentIds: ['nyra', 'kit'] });
    expect(pair.status).toBe(400); expect(await pair.text()).toContain('3-5 residents');
    const unknown = await groupRequest({ ...validBody, residentIds: ['nyra', 'kit', 'maren'] });
    expect(unknown.status).toBe(400); expect(await unknown.text()).toContain('Unknown resident: maren');
    const longLine = await groupRequest({ ...validBody, playerLine: 'x'.repeat(121) });
    expect(longLine.status).toBe(400); expect(await longLine.text()).toContain('Player line');
    const outsiderHistory = await groupRequest({ ...validBody, history: [{ speaker: 'cael', text: 'Observe.' }] });
    expect(outsiderHistory.status).toBe(400); expect(await outsiderHistory.text()).toContain('Group history');

    // A bad first line fails before anything streams, so it is still a normal 400 reply.
    const outsider = await groupRequest({ ...validBody, context: { ...validBody.context, place: 'Outsider Inn' } });
    expect(outsider.status).toBe(400); expect(await outsider.text()).toContain('invalid dialogue');
    // A bad later line arrives after the stream started: the good line stays and an error event ends it.
    const echo = await groupRequest({ ...validBody, context: { ...validBody.context, place: 'Echo Inn' } });
    expect(echo.status).toBe(200);
    expect(await events(echo)).toEqual([{ line: { residentId: 'nyra', text: 'Cheers.' } },
      { error: 'Model group chat repeats the same speaker twice in a row.' }]);
    // The whole-reply line count is still checked at the end of the stream.
    const lonely = await groupRequest({ ...validBody, context: { ...validBody.context, place: 'Lonely Inn' } });
    expect(lonely.status).toBe(200);
    expect(await events(lonely)).toEqual([{ line: { residentId: 'nyra', text: 'Just me tonight.' } },
      { error: 'Model group chat must contain only 2-4 lines.' }]);
  } finally {
    await close(bridge); await close(ollama);
  }
});
