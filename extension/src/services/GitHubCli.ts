import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

/**
 * Thin wrapper around the `gh` CLI for extension-side operations.
 * Uses execFile (not exec) to prevent shell injection.
 */
export class GitHubCli {
  /**
   * Returns the authenticated GitHub username, or null if not authenticated.
   */
  static async getCurrentUser(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('gh', ['api', 'user', '-q', '.login'], {
        timeout: 8000,
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Parses the GitHub owner/repo from the git remote of the current workspace.
   * Returns null if no workspace is open or no GitHub remote is found.
   */
  static async getWorkspaceRepo(): Promise<{ owner: string; repo: string } | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }

    const cwd = workspaceFolders[0].uri.fsPath;

    try {
      // Get remote URL using git directly (not gh) to avoid needing auth
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
        cwd,
        timeout: 5000,
      });
      return GitHubCli._parseGitHubUrl(stdout.trim());
    } catch {
      // Fallback: try gh repo view
      try {
        const { stdout } = await execFileAsync(
          'gh',
          ['repo', 'view', '--json', 'owner,name', '-q', '[.owner.login, .name] | @tsv'],
          { cwd, timeout: 8000 }
        );
        const parts = stdout.trim().split('\t');
        if (parts.length === 2 && parts[0] && parts[1]) {
          return { owner: parts[0], repo: parts[1] };
        }
      } catch {
        // ignore
      }
      return null;
    }
  }

  /**
   * Returns true if `gh auth status` exits without error.
   */
  static async isAuthenticated(): Promise<boolean> {
    try {
      await execFileAsync('gh', ['auth', 'status'], { timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parses SSH and HTTPS GitHub remote URLs into { owner, repo }.
   * Handles:
   *   git@github.com:owner/repo.git
   *   https://github.com/owner/repo.git
   *   https://github.com/owner/repo
   */
  private static _parseGitHubUrl(remoteUrl: string): { owner: string; repo: string } | null {
    // SSH format: git@github.com:owner/repo.git
    const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    // HTTPS format: https://github.com/owner/repo[.git]
    const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    return null;
  }
}
