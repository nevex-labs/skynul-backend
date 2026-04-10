import { exec } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// ── App configs ──────────────────────────────────────────────────────────────

interface AppConfig {
  scriptLang: 'extendscript' | 'python' | 'lua';
  extensions: string[];
  run: {
    darwin?: (scriptPath: string) => string;
    win32?: (scriptPath: string) => string;
    linux?: (scriptPath: string) => string;
  };
  /** COM class name for Windows automation (Adobe apps) */
  comName?: string;
  /** If the app must be running before executing scripts */
  requiresRunning?: boolean;
}

const apps: Record<string, AppConfig> = {
  illustrator: {
    scriptLang: 'extendscript',
    extensions: ['.ai', '.eps', '.svg'],
    requiresRunning: true,
    comName: 'Illustrator.Application',
    run: {
      darwin: (s) => `osascript -e 'tell application "Adobe Illustrator" to do javascript file "${s}"'`,
    },
  },
  photoshop: {
    scriptLang: 'extendscript',
    extensions: ['.psd', '.psb'],
    requiresRunning: true,
    comName: 'Photoshop.Application',
    run: {
      darwin: (s) => `osascript -e 'tell application "Adobe Photoshop 2024" to do javascript file "${s}"'`,
    },
  },
  aftereffects: {
    scriptLang: 'extendscript',
    extensions: ['.aep'],
    requiresRunning: true,
    comName: 'AfterEffects.Application',
    run: {
      darwin: (s) => `osascript -e 'tell application "Adobe After Effects 2024" to do script file "${s}"'`,
    },
  },
  blender: {
    scriptLang: 'python',
    extensions: ['.blend'],
    requiresRunning: false,
    run: {
      darwin: (s) => `blender --background --python "${s}"`,
      win32: (s) => `blender.exe --background --python "${s}"`,
      linux: (s) => `blender --background --python "${s}"`,
    },
  },
  unreal: {
    scriptLang: 'python',
    extensions: ['.uproject'],
    requiresRunning: true,
    run: {
      // Uses Unreal's built-in Python — path varies per project
      darwin: (s) => `UnrealEditor-Cmd -ExecutePythonScript="${s}"`,
      win32: (s) => `UnrealEditor-Cmd.exe -ExecutePythonScript="${s}"`,
      linux: (s) => `UnrealEditor-Cmd -ExecutePythonScript="${s}"`,
    },
  },
};

// ── Bridge ───────────────────────────────────────────────────────────────────

export type AppName = keyof typeof apps;

export interface AppBridgeResult {
  ok: boolean;
  output: string;
  error?: string;
}

export class AppBridge {
  private platform: NodeJS.Platform;

  constructor() {
    this.platform = process.platform === 'linux' && process.env.WSL_DISTRO_NAME ? 'win32' : process.platform;
  }

  getSupportedApps(): AppName[] {
    return Object.keys(apps);
  }

  /** Execute a script in the target app */
  private async buildBridgeCmd(
    config: AppConfig,
    id: string,
    scriptFileName: string,
    scriptFile: string,
    tmpDir: string,
    isWSL: boolean,
    filesToClean: string[],
    appName: AppName
  ): Promise<string | { error: string }> {
    if (isWSL && config.comName) {
      const winScriptPath = `C:\\Temp\\${scriptFileName}`;
      const ps1Name = `skynul_${id}.ps1`;
      const ps1File = join(tmpDir, ps1Name);
      const ps1Content = `$app = New-Object -ComObject ${config.comName}\n$app.DoJavaScriptFile('${winScriptPath}')\n`;
      await writeFile(ps1File, ps1Content, 'utf-8');
      filesToClean.push(ps1File);
      return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\Temp\\${ps1Name}"`;
    }
    if (isWSL && config.run.win32) return config.run.win32(`C:\\Temp\\${scriptFileName}`);
    const runFn = config.run[this.platform as keyof typeof config.run];
    if (!runFn) return { error: `${appName} not supported on ${this.platform}` };
    return runFn(scriptFile);
  }

  private async getExtendScriptResult(
    output: string,
    tmpDir: string,
    isWSL: boolean,
    comName: string,
    filesToClean: string[]
  ): Promise<AppBridgeResult> {
    try {
      const inventory = await this.getDocInventory(tmpDir, isWSL, comName, filesToClean);
      return { ok: true, output: output + (inventory ? `\n\n[DOC STATE] ${inventory}` : '') };
    } catch {
      return { ok: true, output };
    }
  }

  private async cleanupFiles(files: string[]): Promise<void> {
    for (const f of files) await unlink(f).catch(() => {});
  }

  async run(appName: AppName, script: string): Promise<AppBridgeResult> {
    const config = apps[appName];
    if (!config) return { ok: false, output: '', error: `Unknown app: ${appName}` };

    const ext = config.scriptLang === 'python' ? '.py' : '.jsx';
    const isWSL = process.platform === 'linux' && !!process.env.WSL_DISTRO_NAME;
    const tmpDir = isWSL ? '/mnt/c/Temp' : tmpdir();
    const id = randomBytes(4).toString('hex');
    const scriptFileName = `skynul_${id}${ext}`;
    const scriptFile = join(tmpDir, scriptFileName);
    const filesToClean: string[] = [scriptFile];

    try {
      await mkdir(tmpDir, { recursive: true }).catch(() => {});
      await writeFile(scriptFile, script, 'utf-8');
      const cmdOrErr = await this.buildBridgeCmd(
        config,
        id,
        scriptFileName,
        scriptFile,
        tmpDir,
        isWSL,
        filesToClean,
        appName
      );
      if (typeof cmdOrErr === 'object') return { ok: false, output: '', error: cmdOrErr.error };
      const output = await this.exec(cmdOrErr);
      if (config.scriptLang === 'extendscript' && config.comName)
        return this.getExtendScriptResult(output, tmpDir, isWSL, config.comName, filesToClean);
      return { ok: true, output };
    } catch (err: any) {
      return { ok: false, output: '', error: err.message || String(err) };
    } finally {
      await this.cleanupFiles(filesToClean);
    }
  }

  /** Run a quick inventory script to tell the model what's in the document */
  private async getDocInventory(
    tmpDir: string,
    isWSL: boolean,
    comName: string,
    filesToClean: string[]
  ): Promise<string> {
    const invScript = `
var doc = app.activeDocument;
var out = 'Objects: ' + doc.pageItems.length;
out += ' | Layers: ' + doc.layers.length;
var items = [];
for (var i = 0; i < Math.min(doc.pageItems.length, 20); i++) {
  var it = doc.pageItems[i];
  var desc = it.typename;
  if (it.name) desc += '(' + it.name + ')';
  desc += ' @[' + Math.round(it.left) + ',' + Math.round(it.top) + ']';
  desc += ' ' + Math.round(it.width) + 'x' + Math.round(it.height);
  items.push(desc);
}
out += ' | ' + items.join('; ');
out;`;
    const id2 = randomBytes(4).toString('hex');
    const invFileName = `skynul_inv_${id2}.jsx`;
    const invFile = join(tmpDir, invFileName);
    await writeFile(invFile, invScript, 'utf-8');
    filesToClean.push(invFile);

    if (isWSL) {
      const ps1Name = `skynul_inv_${id2}.ps1`;
      const ps1File = join(tmpDir, ps1Name);
      const ps1Content = `$app = New-Object -ComObject ${comName}\n$result = $app.DoJavaScriptFile('C:\\Temp\\${invFileName}')\nWrite-Output $result\n`;
      await writeFile(ps1File, ps1Content, 'utf-8');
      filesToClean.push(ps1File);
      return await this.exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\Temp\\${ps1Name}"`, 10_000);
    }
    return '';
  }

  /** Export a low-res PNG preview of the active document and return base64 */
  async getPreview(appName: AppName): Promise<string | null> {
    const config = apps[appName];
    if (!config || config.scriptLang !== 'extendscript' || !config.comName) return null;

    const isWSL = process.platform === 'linux' && !!process.env.WSL_DISTRO_NAME;
    if (!isWSL) return null;

    const tmpDir = '/mnt/c/Temp';
    const id = randomBytes(4).toString('hex');
    const pngName = `skynul_preview_${id}.png`;
    const pngWinPath = `C:\\Temp\\${pngName}`;
    const pngWslPath = join(tmpDir, pngName);
    const jsxName = `skynul_preview_${id}.jsx`;
    const jsxFile = join(tmpDir, jsxName);
    const ps1Name = `skynul_preview_${id}.ps1`;
    const ps1File = join(tmpDir, ps1Name);

    const jsxScript = `
var doc = app.activeDocument;
var f = new File('${pngWinPath.replace(/\\/g, '/')}');
var opts = new ExportOptionsPNG24();
opts.horizontalScale = 400 / (doc.width > doc.height ? doc.width : doc.height) * 100;
opts.verticalScale = opts.horizontalScale;
opts.artBoardClipping = true;
opts.antiAliasing = true;
opts.transparency = false;
doc.exportFile(f, ExportType.PNG24, opts);
'ok';`;

    const ps1Content = `$app = New-Object -ComObject ${config.comName}\n$app.DoJavaScriptFile('C:\\Temp\\${jsxName}')\n`;

    try {
      await writeFile(jsxFile, jsxScript, 'utf-8');
      await writeFile(ps1File, ps1Content, 'utf-8');
      await this.exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\Temp\\${ps1Name}"`, 15_000);
      const buf = await readFile(pngWslPath);
      return buf.toString('base64');
    } catch {
      return null;
    } finally {
      await unlink(jsxFile).catch(() => {});
      await unlink(ps1File).catch(() => {});
      await unlink(pngWslPath).catch(() => {});
    }
  }

  private exec(cmd: string, timeoutMs = 30_000): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: timeoutMs }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout.trim());
      });
    });
  }
}
