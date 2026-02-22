import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { GitHubCli } from '../services/GitHubCli';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _webviewContext: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      async (message: { type: string; [key: string]: unknown }) => {
        switch (message.type) {
          case 'ready':
            await this._sendInitData(webviewView.webview);
            break;

          case 'getSecrets':
            await this._sendSecrets(webviewView.webview);
            break;

          case 'configure':
            vscode.commands.executeCommand('devcoach.configure');
            break;

          case 'showError':
            vscode.window.showErrorMessage(String(message.message ?? 'Unknown error'));
            break;

          case 'showInfo':
            vscode.window.showInformationMessage(String(message.message ?? ''));
            break;

          case 'openUrl':
            if (typeof message.url === 'string') {
              vscode.env.openExternal(vscode.Uri.parse(message.url));
            }
            break;
        }
      },
      undefined,
      this._context.subscriptions
    );
  }

  public postMessage(message: unknown) {
    this._view?.webview.postMessage(message);
  }

  public notifySecretsUpdated() {
    if (this._view) {
      this._sendSecrets(this._view.webview);
    }
  }

  private async _sendInitData(webview: vscode.Webview) {
    const config = vscode.workspace.getConfiguration('devcoach');
    const backendUrl = config.get<string>('backendUrl', 'http://localhost:8000');
    const defaultRepo = config.get<string>('defaultRepo', '');

    // Try to detect repo from workspace
    let detectedRepo: { owner: string; repo: string } | null = null;
    try {
      detectedRepo = await GitHubCli.getWorkspaceRepo();
    } catch {
      // Non-fatal — user may not have gh CLI installed
    }

    webview.postMessage({
      type: 'init',
      data: {
        backendUrl,
        defaultRepo: defaultRepo || (detectedRepo ? `${detectedRepo.owner}/${detectedRepo.repo}` : ''),
        detectedOwner: detectedRepo?.owner ?? null,
        detectedRepo: detectedRepo?.repo ?? null,
      },
    });
  }

  private async _sendSecrets(webview: vscode.Webview) {
    const githubPat = (await this._context.secrets.get('devcoach.githubPat')) ?? null;
    const anthropicKey = (await this._context.secrets.get('devcoach.anthropicKey')) ?? null;

    webview.postMessage({
      type: 'secrets',
      data: { githubPat, anthropicKey },
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'index.js')
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'styles.css')
    );

    const nonce = crypto.randomBytes(16).toString('hex');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'nonce-${nonce}';
    style-src ${webview.cspSource} 'unsafe-inline';
    img-src ${webview.cspSource} https: data:;
    font-src ${webview.cspSource};
    connect-src http://localhost:* https://api.github.com;
  " />
  <title>DevCoach</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
