const RATE_LIMIT = 3;
const MAX_TOKENS = 8000;
const ipStore = {};

function getRateLimitData(ip) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  if (!ipStore[ip] || now - ipStore[ip].resetAt > dayMs) {
    ipStore[ip] = { count: 0, resetAt: now };
  }
  return ipStore[ip];
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const limitData = getRateLimitData(ip);
  const remaining = RATE_LIMIT - limitData.count;
  const resetInHours = Math.ceil(((limitData.resetAt + 86400000) - Date.now()) / 3600000);

  if (remaining <= 0) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'rate_limit', message: `Napi limit elérve. Próbáld újra ${resetInHours} óra múlva.`, resetInHours }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { systemPrompt, userPrompt } = body;
  if (!systemPrompt || !userPrompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing prompts' }) };

  try {
    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      }),
    });

    const responseText = await apiResponse.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch(e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Claude API invalid response: ' + responseText.substring(0, 200) }) };
    }

    if (!apiResponse.ok) {
      return { statusCode: apiResponse.status, headers, body: JSON.stringify({ error: data.error?.message || 'Claude API hiba' }) };
    }

    const html = data.content[0].text.replace(/^```html\n?/i, '').replace(/\n?```$/i, '').trim();
    limitData.count += 1;

    return { statusCode: 200, headers, body: JSON.stringify({ html, remaining: RATE_LIMIT - limitData.count, resetInHours }) };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Szerver hiba: ' + err.message }) };
  }
};
