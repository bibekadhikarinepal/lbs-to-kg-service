// Simple black-box test runner for the lbs->kg REST service.
// Usage: BASE_URL=http://localhost:3000 node test/run-tests.js

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;

function report(name, ok, detail) {
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}${detail ? ' - ' + detail : ''}`);
  if (ok) passed += 1;
  else failed += 1;
}

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    body = null;
  }
  return { status: res.status, body };
}

async function main() {
  console.log(`Running tests against ${BASE_URL}\n`);

  // /health
  {
    const { status, body } = await getJson('/health');
    report('/health returns 200', status === 200, `status=${status}`);
    report('/health returns status ok', body && body.status === 'ok', JSON.stringify(body));
  }

  // baseline stats
  const before = await getJson('/stats');
  report('/stats reachable before conversions', before.status === 200, `status=${before.status}`);
  const baseline = before.body && typeof before.body.conversions === 'number' ? before.body.conversions : 0;

  // /convert?lbs=0
  {
    const { status, body } = await getJson('/convert?lbs=0');
    report('/convert?lbs=0 returns 200', status === 200, `status=${status}`);
    report('/convert?lbs=0 kg is 0', body && body.kg === 0, JSON.stringify(body));
  }

  // /convert?lbs=150
  {
    const { status, body } = await getJson('/convert?lbs=150');
    report('/convert?lbs=150 returns 200', status === 200, `status=${status}`);
    report('/convert?lbs=150 kg is 68.039', body && body.kg === 68.039, JSON.stringify(body));
  }

  // /convert?lbs=0.1
  {
    const { status, body } = await getJson('/convert?lbs=0.1');
    report('/convert?lbs=0.1 returns 200', status === 200, `status=${status}`);
    report('/convert?lbs=0.1 kg is 0.045', body && body.kg === 0.045, JSON.stringify(body));
  }

  // /convert missing lbs
  {
    const { status } = await getJson('/convert');
    report('/convert (missing lbs) returns 400', status === 400, `status=${status}`);
  }

  // /convert?lbs=abc
  {
    const { status } = await getJson('/convert?lbs=abc');
    report('/convert?lbs=abc returns 400', status === 400, `status=${status}`);
  }

  // /convert?lbs=-5
  {
    const { status } = await getJson('/convert?lbs=-5');
    report('/convert?lbs=-5 returns 422', status === 422, `status=${status}`);
  }

  // /stats after conversions: 3 successful conversions were made above
  {
    const { status, body } = await getJson('/stats');
    const expected = baseline + 3;
    report('/stats returns 200', status === 200, `status=${status}`);
    report(
      `/stats reflects only successful conversions (expected ${expected})`,
      body && body.conversions === expected,
      JSON.stringify(body)
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
