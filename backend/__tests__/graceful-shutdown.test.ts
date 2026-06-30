import { spawn } from 'child_process';
import http from 'http';

describe('Graceful Shutdown Integration', () => {
  it('should process in-flight requests before exiting on SIGTERM', async () => {
    const port = 3001;
    
    // Start the server
    const serverProcess = spawn('npx', ['tsx', 'server.ts'], {
      cwd: __dirname + '/..',
      env: { ...process.env, PORT: String(port), ADD_DELAY_ROUTE: '2000' }
    });

    let serverReady = false;
    let processExited = false;
    let exitCode: number | null = null;
    let output = '';
    
    serverProcess.on('exit', (code) => {
      processExited = true;
      exitCode = code;
    });

    // Wait for the server to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server start timeout')), 10000);
      serverProcess.stdout?.on('data', (data) => {
        output += data.toString();
        if (data.toString().includes(`Server running on port ${port}`)) {
          clearTimeout(timeout);
          serverReady = true;
          resolve();
        }
      });
      serverProcess.stderr?.on('data', (data) => {
        console.error('Server stderr:', data.toString());
      });
    });

    expect(serverReady).toBe(true);

    // Send a slow request
    const requestPromise = new Promise((resolve, reject) => {
      const req = http.get(`http://localhost:${port}/delay`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
    });

    // Wait slightly to ensure request reaches the server
    await new Promise(resolve => setTimeout(resolve, 500));

    // Trigger SIGTERM
    serverProcess.kill('SIGTERM');

    // Wait for the request to complete
    const response = await requestPromise;
    expect(response).toEqual({ ok: true });

    // Wait for the process to exit
    await new Promise<void>((resolve, reject) => {
      if (processExited) return resolve();
      const timeout = setTimeout(() => reject(new Error('Process exit timeout')), 5000);
      serverProcess.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    expect(exitCode).toBe(0);
    
    // Optional: could check output for logs
    expect(output).toContain('[Shutdown] Received SIGTERM');
    expect(output).toContain('[Shutdown] HTTP server closed');
  }, 15000); // 15 seconds timeout
});
