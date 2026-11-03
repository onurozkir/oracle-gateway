const http = require('node:http');
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url.split('?')[0] !== '/v1/chat/completions') {
    res.writeHead(501);
    res.end('Not modeled');
    return;
  }
  try {
    let request = req.body;
    if (!request) {
      let raw = '';
      for await (const chunk of req) raw += String(chunk);
      request = JSON.parse(raw);
    }
    if (
      !request.model ||
      request.stream !== false ||
      !Array.isArray(request.messages) ||
      request.messages.length !== 2
    ) {
      res.writeHead(400);
      res.end('Contract violation');
      return;
    }
    const injected = Number(String(request.model).replace('sim-', ''));
    if ([401, 403, 429, 500].includes(injected)) {
      res.writeHead(injected);
      res.end('simulated provider error');
      return;
    }
    if (request.model === 'sim-timeout') return;
    const envelope = JSON.parse(request.messages[1].content);
    const result =
      envelope.stage === 'interpretation'
        ? {
            requirementId: envelope.input.requirementId,
            operator: '>',
            unit: 'cents',
            threshold: 10000,
            assumptions: [],
            uncertainty: [],
            proposedCases: [
              { id: 'boundary', input: { amountCents: 10000 }, expected: { totalCents: 10000 } },
            ],
          }
        : { differences: [], uncertainty: [] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: JSON.stringify(result) },
          },
        ],
      })
    );
  } catch {
    res.writeHead(400);
    res.end('Contract violation');
  }
});
server.listen(process.env.PORT || 4500);
