// Local smoke-test agent; no network, account, or model calls.
console.error('Local test agent started.');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  if (!input.includes('DeepSchema') || !input.includes('requirements')) {
    console.error('Expected schema review context on stdin.'); process.exitCode = 1; return;
  }
  console.log('PASS — Local CLI smoke test completed.');
  console.error(`Received ${input.length} prompt characters. Working directory: ${process.cwd()}`);
});
