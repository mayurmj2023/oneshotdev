import * as vscode from 'vscode';
import { AIProvider } from './providers/provider';
import { ClaudeProvider } from './providers/claude-provider';
import { OpenAIProvider } from './providers/openai-provider';
import { GeminiProvider } from './providers/gemini-provider';
import { buildInitialPrompt, buildFixPrompt, parseGenerationResponse, GeneratedFile } from './pipeline/prompts';
import { writeFiles } from './pipeline/file-writer';
import { runTests } from './pipeline/test-runner';
import { deployToAppRunner } from './deploy/aws-deploy';

function getProvider(): AIProvider {
  const config = vscode.workspace.getConfiguration('oneshotdev');
  const choice = config.get<string>('provider', 'claude');

  if (choice === 'openai') {
    const key = config.get<string>('openaiApiKey', '');
    if (!key) throw new Error('Set oneshotdev.openaiApiKey in settings.');
    return new OpenAIProvider(key);
  }
  if (choice === 'gemini') {
    const key = config.get<string>('geminiApiKey', '');
    if (!key) throw new Error('Set oneshotdev.geminiApiKey in settings.');
    return new GeminiProvider(key);
  }
  const key = config.get<string>('claudeApiKey', '');
  if (!key) throw new Error('Set oneshotdev.claudeApiKey in settings.');
  return new ClaudeProvider(key);
}

function getWorkspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) throw new Error('Open a folder/workspace first.');
  return folders[0].uri.fsPath;
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('OneShotDev');

  context.subscriptions.push(
    vscode.commands.registerCommand('oneshotdev.run', async () => {
      output.show(true);
      try {
        const prompt = await vscode.window.showInputBox({
          prompt: 'Describe what to build (one prompt — code, tests, and deploy will follow automatically)',
          placeHolder: 'e.g. A REST API with a /users endpoint backed by an in-memory store, with tests',
        });
        if (!prompt) return;

        const workspaceRoot = getWorkspaceRoot();
        const config = vscode.workspace.getConfiguration('oneshotdev');
        const provider = getProvider();
        const testCommand = config.get<string>('testCommand', 'npm test');
        const maxAttempts = config.get<number>('maxFixAttempts', 4);

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'OneShotDev', cancellable: false },
          async (progress) => {
            progress.report({ message: `Generating code with ${provider.name}...` });
            output.appendLine(`[generate] using ${provider.name}`);
            const raw = await provider.complete(
              'You are a senior software engineer. You write complete, runnable, well-tested code.',
              buildInitialPrompt(prompt),
            );
            let result = parseGenerationResponse(raw);
            writeFiles(workspaceRoot, result.files);
            output.appendLine(`[generate] wrote ${result.files.length} files. ${result.notes}`);

            let attempt = 0;
            let passed = false;
            let lastOutput = '';

            while (attempt < maxAttempts) {
              progress.report({ message: `Running tests (attempt ${attempt + 1}/${maxAttempts})...` });
              const testResult = await runTests(workspaceRoot, testCommand, attempt === 0);
              lastOutput = testResult.output;
              output.appendLine(`[test attempt ${attempt + 1}] ${testResult.passed ? 'PASSED' : 'FAILED'}`);
              output.appendLine(testResult.output.slice(0, 2000));

              if (testResult.passed) {
                passed = true;
                break;
              }

              attempt++;
              if (attempt >= maxAttempts) break;

              progress.report({ message: `Fixing failures with ${provider.name} (attempt ${attempt + 1})...` });
              const fixRaw = await provider.complete(
                'You are a senior software engineer fixing failing tests. Return the full corrected project.',
                buildFixPrompt(prompt, result.files, testResult.output),
              );
              result = parseGenerationResponse(fixRaw);
              writeFiles(workspaceRoot, result.files);
            }

            if (!passed) {
              vscode.window.showWarningMessage(
                `OneShotDev: tests still failing after ${maxAttempts} attempts. See output panel. Not deploying.`,
              );
              return;
            }

            const deploy = await vscode.window.showInformationMessage(
              'Tests passed! Deploy to AWS App Runner now?',
              'Deploy',
              'Skip',
            );
            if (deploy !== 'Deploy') return;

            const ecrAccessRoleArn = config.get<string>('ecrAccessRoleArn', '');
            if (!ecrAccessRoleArn) {
              vscode.window.showErrorMessage(
                'Set oneshotdev.ecrAccessRoleArn in settings before deploying (see README for the one-time AWS setup).',
              );
              return;
            }

            progress.report({ message: 'Deploying to AWS App Runner...' });
            const url = await deployToAppRunner({
              workspaceRoot,
              region: config.get<string>('awsRegion', 'us-east-1'),
              ecrRepoName: config.get<string>('ecrRepoName', 'oneshotdev-app'),
              serviceName: config.get<string>('appRunnerServiceName', 'oneshotdev-service'),
              containerPort: config.get<number>('containerPort', 3000),
              ecrAccessRoleArn,
              onProgress: (msg) => output.appendLine(`[deploy] ${msg}`),
            });
            vscode.window.showInformationMessage(`Deployed! URL: ${url}`);
            output.appendLine(`[deploy] done -> ${url}`);
          },
        );
      } catch (err: any) {
        output.appendLine(`[error] ${err.message}`);
        vscode.window.showErrorMessage(`OneShotDev: ${err.message}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('oneshotdev.deployOnly', async () => {
      output.show(true);
      try {
        const workspaceRoot = getWorkspaceRoot();
        const config = vscode.workspace.getConfiguration('oneshotdev');
        const ecrAccessRoleArn = config.get<string>('ecrAccessRoleArn', '');
        if (!ecrAccessRoleArn) {
          vscode.window.showErrorMessage('Set oneshotdev.ecrAccessRoleArn in settings first (see README).');
          return;
        }
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'OneShotDev: Deploying', cancellable: false },
          async () => {
            const url = await deployToAppRunner({
              workspaceRoot,
              region: config.get<string>('awsRegion', 'us-east-1'),
              ecrRepoName: config.get<string>('ecrRepoName', 'oneshotdev-app'),
              serviceName: config.get<string>('appRunnerServiceName', 'oneshotdev-service'),
              containerPort: config.get<number>('containerPort', 3000),
              ecrAccessRoleArn,
              onProgress: (msg) => output.appendLine(`[deploy] ${msg}`),
            });
            vscode.window.showInformationMessage(`Deployed! URL: ${url}`);
          },
        );
      } catch (err: any) {
        output.appendLine(`[error] ${err.message}`);
        vscode.window.showErrorMessage(`OneShotDev: ${err.message}`);
      }
    }),
  );
}

export function deactivate() {}
