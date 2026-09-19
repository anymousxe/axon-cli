import http from 'node:http';

export async function startFixture() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    let body;
    try { body = JSON.parse(raw); } catch { res.writeHead(400); res.end('invalid JSON'); return; }
    requests.push({ ...body, authorization: req.headers.authorization });
    if (req.headers.authorization !== 'Bearer fixture-key') { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'invalid api key' } })); return; }
    if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return; }
    const latest = [...body.messages].reverse().find(m => m.role === 'user');
    const text = typeof latest?.content === 'string' ? latest.content : latest?.content?.filter(p => p.type === 'text').map(p => p.text).join(' ');
    const system = body.messages.find(m => m.role === 'system')?.content || '';
    if (text?.includes('FIXTURE_402')) { res.writeHead(402); res.end('wallet empty'); return; }
    if (text?.includes('FIXTURE_429') && requests.filter(r => JSON.stringify(r.messages).includes('FIXTURE_429')).length < 3) { res.writeHead(429, { 'retry-after': '0' }); res.end('slow down'); return; }
    const chunks = [];
    res.writeHead(200, { 'content-type': body.stream ? 'text/event-stream' : 'application/json' });
    const emit = object => body.stream ? res.write(`data: ${JSON.stringify(object)}\r\n\r\n`) : chunks.push(object);
    if (body.reasoning_effort) emit({ choices: [{ delta: { reasoning_content: 'I will check this carefully. ' } }] });
    const hasImage = body.messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url'));
    if (hasImage && body.model !== 'axon-1.8-flash') { emit({ error: { message: 'text-only model received image' } }); res.end(); return; }
    let answer;
    const last = body.messages.at(-1);
    if (body.tools?.length && text?.includes('FIXTURE_TOOL') && last.role !== 'tool') {
      emit({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_echo', type: 'function', function: { name: 'run_command', arguments: '{"command":' } }] } }] });
      emit({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"echo AXON_TOOL_OK"}' } }] }, finish_reason: 'tool_calls' }] });
    } else {
      if (last.role === 'tool') answer = last.content.includes('AXON_TOOL_OK') ? 'Tool verified: AXON_TOOL_OK' : 'Tool permission was denied.';
      else if (hasImage && text?.toLowerCase().includes('text-only model')) answer = 'A tiny red square on a plain background.';
      else if (hasImage) answer = 'I see a tiny red square.';
      else if (text?.includes('<image_description')) answer = 'From the image description: a tiny red square.';
      else if (text?.includes('favorite color')) answer = system.includes('favorite color is teal') ? 'Your favorite color is teal.' : 'I do not know your favorite color.';
      else if (text?.includes('previous word')) answer = JSON.stringify(body.messages).includes('ORCHID') ? 'ORCHID' : 'No previous word.';
      else if (text?.includes('Reply OK')) answer = 'OK';
      else answer = 'Axon ready. Fast, clear, and in your terminal.';
      for (const word of answer.match(/\S+\s*/g) || []) emit({ choices: [{ delta: { content: word } }] });
      emit({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    }
    emit({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
    if (body.stream) res.write('data: [DONE]\r\n\r\n');
    else {
      const message = { role: 'assistant', content: answer || null };
      if (!answer) message.tool_calls = [{ id: 'call_echo', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: 'echo AXON_TOOL_OK' }) } }];
      res.write(JSON.stringify({ choices: [{ message, finish_reason: answer ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    }
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, url: `http://127.0.0.1:${server.address().port}/api/v1`, close: () => new Promise(resolve => server.close(resolve)) };
}
