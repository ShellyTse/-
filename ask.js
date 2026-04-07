/**
 * 智者圆桌 · API 代理
 * - 支持 Claude (Anthropic) 和 DeepSeek
 * - IP 限流：每 IP 每天最多 MAX_REQUESTS_PER_IP 次
 * - 访问密码保护
 * - 流式输出透传
 */

// ── 内存限流存储（Vercel 无状态，每次冷启动重置；生产建议换 Upstash Redis）
const ipRequestMap = new Map();

function getRateLimitKey(ip) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${ip}::${today}`;
}

function checkRateLimit(ip) {
  const MAX = parseInt(process.env.MAX_REQUESTS_PER_IP || '30', 10);
  const key = getRateLimitKey(ip);
  const count = ipRequestMap.get(key) || 0;
  if (count >= MAX) return { allowed: false, count, max: MAX };
  ipRequestMap.set(key, count + 1);
  return { allowed: true, count: count + 1, max: MAX };
}

function getClientIp(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    '127.0.0.1'
  );
}

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // ── CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Access-Password',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // ── 访问密码校验
  const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;
  if (ACCESS_PASSWORD) {
    const provided = req.headers.get('x-access-password') || '';
    if (provided !== ACCESS_PASSWORD) {
      return new Response(JSON.stringify({ error: '密码错误，请联系站长获取访问密码' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // ── IP 限流
  const ip = getClientIp(req);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({
      error: `今日请求次数已达上限（${rateCheck.max}次/天），明天再来吧`
    }), {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': String(rateCheck.max),
        'X-RateLimit-Remaining': '0',
      }
    });
  }

  // ── 解析请求体
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: '请求格式错误' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const { model, system, question } = body;
  if (!question || !system) {
    return new Response(JSON.stringify({ error: '缺少必要参数' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // ── 路由到不同模型
  const modelLower = (model || 'claude').toLowerCase();

  try {
    if (modelLower.startsWith('deepseek')) {
      return await callDeepSeek({ system, question, model: modelLower, corsHeaders });
    } else {
      return await callClaude({ system, question, corsHeaders });
    }
  } catch (err) {
    console.error('API Error:', err);
    return new Response(JSON.stringify({ error: err.message || '模型调用失败' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// ── Claude (Anthropic) ──────────────────────────────────────────
async function callClaude({ system, question, corsHeaders }) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) throw new Error('服务未配置 Anthropic API Key');

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      stream: true,
      system,
      messages: [{ role: 'user', content: `问题：${question}` }],
    }),
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API ${upstream.status}`);
  }

  // 透传流
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ── DeepSeek ────────────────────────────────────────────────────
async function callDeepSeek({ system, question, corsHeaders }) {
  const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
  if (!DEEPSEEK_KEY) throw new Error('服务未配置 DeepSeek API Key');

  const upstream = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 400,
      stream: true,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `问题：${question}` },
      ],
    }),
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({}));
    throw new Error(err.error?.message || `DeepSeek API ${upstream.status}`);
  }

  // DeepSeek 用 OpenAI 兼容格式，需要转换成 Anthropic SSE 格式让前端统一处理
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (s) => new TextEncoder().encode(s);
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.enqueue(encode('data: [DONE]\n\n'));
            controller.close();
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              controller.enqueue(encode('data: [DONE]\n\n'));
              continue;
            }
            try {
              const json = JSON.parse(data);
              const text = json.choices?.[0]?.delta?.content || '';
              if (text) {
                // 转换为 Anthropic 格式
                const converted = JSON.stringify({
                  type: 'content_block_delta',
                  delta: { text }
                });
                controller.enqueue(encode(`data: ${converted}\n\n`));
              }
            } catch { /* skip malformed */ }
          }
        }
      } catch (err) {
        controller.error(err);
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
