// Shared by statement matching and statement-bank preparation. No provider calls
// run in parallel on this page, including automatic background preparation.
export function curriculumError(packet = {}, status = 0, retryAfter = null) {
  const error = new Error(packet.error || 'The curriculum request could not finish. Your saved work is kept.');
  error.code = packet.code || (status === 429 ? 'rate_limit' : status >= 500 ? 'service' : 'error');
  error.retryable = packet.retryable ?? (status === 429 || status >= 500);
  error.retryAfter = Number(packet.retryAfter ?? retryAfter) || 0;
  return error;
}

export async function readCurriculumResult(response) {
  if (!response.ok || (response.headers.get('content-type') || '').includes('application/json')) {
    let packet = {};
    try { packet = await response.json(); } catch { /* never display a raw server response */ }
    throw curriculumError(packet, response.status, response.headers.get('retry-after'));
  }
  if (!response.body) throw curriculumError({code: 'incomplete', retryable: true, error: 'The AI response was interrupted. Your saved work is kept.'});
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', result = null, failure = null;
  const line = value => {
    if (!value.trim()) return;
    let packet;
    try { packet = JSON.parse(value); } catch { return; }
    if (packet.type === 'result') result = packet.result;
    else if (packet.type === 'error' || packet.ok === false) failure = packet;
  };
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
  }
  line(buffer + decoder.decode()); // the last NDJSON packet need not end in a newline
  if (failure) throw curriculumError(failure);
  if (result === null) throw curriculumError({code: 'incomplete', retryable: true, error: 'The AI response ended before the result arrived. Your saved work is kept.'});
  return result;
}

export function createCurriculumQueue({wait = ms => new Promise(resolve => setTimeout(resolve, ms)), spacing = 1500, maxAttempts = 3} = {}) {
  let tail = Promise.resolve(), first = true, blocked = null;
  const request = (task, {onWait = () => {}, shouldContinue = () => true} = {}) => {
    const run = tail.then(async () => {
      if (blocked) throw blocked;
      if (!first) await wait(spacing);
      first = false;
      for (let attempt = 1; ; attempt++) {
        if (!shouldContinue()) throw curriculumError({code: 'cancelled', error: 'Matching stopped. Completed matches are kept.'});
        try { return await task(); }
        catch (error) {
          const retryable = error.retryable === true || error instanceof TypeError;
          if (!retryable || attempt >= maxAttempts || error.retryAfter > 60) {
            if (['rate_limit', 'quota', 'settings'].includes(error.code)) blocked = error;
            throw error;
          }
          const seconds = Math.max(error.retryAfter || 0, error.code === 'rate_limit' ? 30 * attempt : 4 * attempt);
          onWait({seconds, attempt, error});
          // Short waits allow Stop and department changes to cancel a pending retry.
          for (let remaining = seconds; remaining > 0; remaining--) {
            if (!shouldContinue()) throw curriculumError({code: 'cancelled', error: 'Matching stopped. Completed matches are kept.'});
            await wait(1000);
          }
        }
      }
    });
    tail = run.catch(() => {}); // a failed unit must not poison the queue
    return run;
  };
  request.resetBlock = () => { blocked = null; };
  return request;
}
