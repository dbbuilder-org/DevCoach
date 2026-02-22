import * as vscode from 'vscode';
import { SidebarProvider } from './providers/SidebarProvider';
import { PanelProvider } from './providers/PanelProvider';

export async function activate(context: vscode.ExtensionContext) {
  const sidebarProvider = new SidebarProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('devcoach.sidebar', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Configure command: store GitHub PAT and Anthropic API key in secrets
  context.subscriptions.push(
    vscode.commands.registerCommand('devcoach.configure', async () => {
      const githubPat = await vscode.window.showInputBox({
        title: 'DevCoach: GitHub Personal Access Token',
        prompt: 'Enter your GitHub PAT (needs repo, read:org scopes)',
        password: true,
        ignoreFocusOut: true,
      });
      if (githubPat) {
        await context.secrets.store('devcoach.githubPat', githubPat);
      }

      const anthropicKey = await vscode.window.showInputBox({
        title: 'DevCoach: Anthropic API Key',
        prompt: 'Enter your Anthropic API key',
        password: true,
        ignoreFocusOut: true,
      });
      if (anthropicKey) {
        await context.secrets.store('devcoach.anthropicKey', anthropicKey);
      }

      if (githubPat || anthropicKey) {
        vscode.window.showInformationMessage('DevCoach: API keys saved securely.');
        sidebarProvider.notifySecretsUpdated();
      }
    })
  );

  // Open in floating panel (undocked)
  context.subscriptions.push(
    vscode.commands.registerCommand('devcoach.openPanel', () => {
      PanelProvider.createOrShow(context, context.extensionUri);
    })
  );

  // Start day command — forward to webview
  context.subscriptions.push(
    vscode.commands.registerCommand('devcoach.startDay', () => {
      sidebarProvider.postMessage({ type: 'startDay' });
    })
  );

  // Start work block command
  context.subscriptions.push(
    vscode.commands.registerCommand('devcoach.startWorkBlock', () => {
      sidebarProvider.postMessage({ type: 'startWorkBlock' });
    })
  );

  // End work block command
  context.subscriptions.push(
    vscode.commands.registerCommand('devcoach.endWorkBlock', () => {
      sidebarProvider.postMessage({ type: 'endWorkBlock' });
    })
  );

  // On activation, check if secrets are configured
  const hasGithubPat = !!(await context.secrets.get('devcoach.githubPat'));
  const hasAnthropicKey = !!(await context.secrets.get('devcoach.anthropicKey'));

  if (!hasGithubPat || !hasAnthropicKey) {
    const action = await vscode.window.showInformationMessage(
      'DevCoach needs API keys to work. Configure now?',
      'Configure',
      'Later'
    );
    if (action === 'Configure') {
      vscode.commands.executeCommand('devcoach.configure');
    }
  }
}

export function deactivate() {
  // Nothing to clean up — providers dispose themselves
}
