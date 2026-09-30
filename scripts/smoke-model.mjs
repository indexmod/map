const stateResponse = await fetch('https://map.indexmod.press/api/load', { signal: AbortSignal.timeout(20000) });
if (!stateResponse.ok) throw new Error(`Map load HTTP ${stateResponse.status}`);
const state = await stateResponse.json();
if (state.generation !== 2) throw new Error('Map reset has not completed');
for (const slug of ['art-o-rama', 'ognennaya-lady']) {
  const response = await fetch('https://map.indexmod.press/api/analyze', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ link: `https://indexmod.press/${slug}` })
  });
  const result = await response.json();
  if (!response.ok || result.status !== 'analyzed' || !result.targetPosition) {
    throw new Error(`Model smoke test failed for ${slug}: ${result.error || result.status || response.status}`);
  }
  console.log(`Model smoke test passed for ${slug}: ${result.model}, confidence ${result.result.confidence}, evidence warnings ${result.evidenceWarnings.length}`);
}
