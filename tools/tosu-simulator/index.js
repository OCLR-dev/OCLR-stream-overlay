import { startSimulation } from './stack.js';

const options = { appPort: 3005, wsPort: 24051 };
for (let index = 2; index < process.argv.length; index += 2) {
  const option = { '--app-port': 'appPort', '--ws-port': 'wsPort' }[process.argv[index]];
  const value = Number(process.argv[index + 1]);
  if (!option || !Number.isInteger(value) || value < 1 || value > 65535) {
    console.error('Usage: npm run sim -- [--app-port 3005] [--ws-port 24051]'); process.exit(1);
  }
  options[option] = value;
}
try {
  const stack = await startSimulation(options);
  console.log(`SIMULATION ONLY\n模拟器面板: ${stack.simulatorUrl}/\n直播员控制台: ${stack.appUrl}/control\n只读输出: ${stack.appUrl}/overlay\n模拟 tosu: ${stack.simulator.wsUrl}\n临时会话: ${stack.directory}`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await stack.stop(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch (error) {
  console.error(`SIMULATION_START_FAILED: ${error.code || error.message}. Check ports and npm run build.`);
  process.exitCode = 1;
}
