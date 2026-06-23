import { exec } from 'child_process';

export interface TestRunResult {
  passed: boolean;
  output: string;
}

export function runTests(workspaceRoot: string, command: string, installFirst = true): Promise<TestRunResult> {
  const fullCommand = installFirst ? `npm install --no-audit --no-fund && ${command}` : command;
  return new Promise((resolve) => {
    exec(fullCommand, { cwd: workspaceRoot, timeout: 120000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`;
      resolve({ passed: !error, output });
    });
  });
}
