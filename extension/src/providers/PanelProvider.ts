import * as vscode from 'vscode';
import * as crypto from 'crypto';

export class PanelProvider {
  private static _currentPanel: PanelProvider | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._context = context;

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the panel webview
    this._panel.webview.onDidReceiveMessage(
      async (message: { type: string; [key: string]: unknown }) => {
        switch (message.type) {
          case 'ready':
            await this._sendInitData();
            break;

          case 'getSecrets':
            await this._sendSecrets();
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
      null,
      this._disposables
    );
  }

  public static createOrShow(context: vscode.ExtensionContext, extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (PanelProvider._currentPanel) {
      PanelProvider._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'devcoach.panel',
      'DevCoach',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    PanelProvider._currentPanel = new PanelProvider(panel, extensionUri, context);
  }

  public postMessage(message: unknown) {
    this._panel.webview.postMessage(message);
  }

  public dispose() {
    PanelProvider._currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }

  private async _sendInitData() {
    const config = vscode.workspace.getConfiguration('devcoach');
    const backendUrl = config.get<string>('backendUrl', 'http://localhost:8000');
    const defaultRepo = config.get<string>('defaultRepo', '');

    this._panel.webview.postMessage({
      type: 'init',
      data: { backendUrl, defaultRepo },
    });
  }

  private async _sendSecrets() {
    const githubPat = (await this._context.secrets.get('devcoach.githubPat')) ?? null;
    const anthropicKey = (await this._context.secrets.get('devcoach.anthropicKey')) ?? null;

    this._panel.webview.postMessage({
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
