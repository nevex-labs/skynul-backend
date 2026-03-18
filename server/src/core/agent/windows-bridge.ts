import { type ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { access, mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'

/**
 * Persistent PowerShell process that provides screenshot capture and
 * input automation on the Windows host from WSL2.
 *
 * Protocol: JSON lines delimited by a unique marker. Each command is sent
 * as a PowerShell script block that writes a JSON result followed by the
 * marker to stdout.
 */

const MARKER = '___SKYNUL_END___'

/** C# source written to a temp file, then loaded via Add-Type -Path.
 *  This avoids PowerShell heredoc (@"..."@) issues when piped through stdin. */
const CSHARP_SOURCE = `
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class SkynulInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);

    public const byte VK_LWIN = 0x5B;
    public const uint KEYEVENTF_KEYUP = 0x0002;

    public const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP     = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
    public const uint MOUSEEVENTF_WHEEL      = 0x0800;

    public static void Click(int x, int y, string button) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(50);
        uint down, up;
        switch (button) {
            case "right":  down = MOUSEEVENTF_RIGHTDOWN;  up = MOUSEEVENTF_RIGHTUP;  break;
            case "middle": down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; break;
            default:       down = MOUSEEVENTF_LEFTDOWN;   up = MOUSEEVENTF_LEFTUP;   break;
        }
        mouse_event(down, 0, 0, 0, IntPtr.Zero);
        System.Threading.Thread.Sleep(30);
        mouse_event(up, 0, 0, 0, IntPtr.Zero);
    }

    public static void DoubleClick(int x, int y) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, IntPtr.Zero);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, IntPtr.Zero);
        System.Threading.Thread.Sleep(60);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, IntPtr.Zero);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, IntPtr.Zero);
    }

    public static void Move(int x, int y) {
        SetCursorPos(x, y);
    }

    public static void Scroll(int x, int y, int clicks) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, clicks * 120, IntPtr.Zero);
    }

    public static void PressWinKey() {
        keybd_event(VK_LWIN, 0, 0, IntPtr.Zero);
        System.Threading.Thread.Sleep(50);
        keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, IntPtr.Zero);
    }

    public static string CaptureScreen(string path) {
        var bounds = Screen.PrimaryScreen.Bounds;
        using (var bmp = new Bitmap(bounds.Width, bounds.Height)) {
            using (var g = Graphics.FromImage(bmp)) {
                g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
            }
            bmp.Save(path, ImageFormat.Png);
        }
        return path;
    }
}
`.trim()

// Map friendly key combos to SendKeys sequences
const SENDKEYS_MAP: Record<string, string> = {
  ctrl: '^',
  alt: '%',
  shift: '+',
  enter: '{ENTER}',
  tab: '{TAB}',
  escape: '{ESC}',
  esc: '{ESC}',
  backspace: '{BACKSPACE}',
  delete: '{DELETE}',
  del: '{DELETE}',
  home: '{HOME}',
  end: '{END}',
  pageup: '{PGUP}',
  pagedown: '{PGDN}',
  up: '{UP}',
  down: '{DOWN}',
  left: '{LEFT}',
  right: '{RIGHT}',
  space: ' ',
  f1: '{F1}',
  f2: '{F2}',
  f3: '{F3}',
  f4: '{F4}',
  f5: '{F5}',
  f6: '{F6}',
  f7: '{F7}',
  f8: '{F8}',
  f9: '{F9}',
  f10: '{F10}',
  f11: '{F11}',
  f12: '{F12}'
}

function comboToSendKeys(combo: string): string {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
  let prefix = ''
  let key = ''

  for (const p of parts) {
    if (p === 'ctrl' || p === 'alt' || p === 'shift') {
      prefix += SENDKEYS_MAP[p]
    } else {
      key = SENDKEYS_MAP[p] ?? p
    }
  }

  if (prefix && key.length === 1) {
    return `${prefix}(${key})`
  }
  return `${prefix}${key}`
}

export type BridgeResult = {
  ok: boolean
  data?: string
  error?: string
}

/** Timeout defaults in ms */
const INIT_TIMEOUT = 30_000
const ACTION_TIMEOUT = 15_000
const SCREENSHOT_TIMEOUT = 20_000

/** Cached DLL path on the Windows side — survives across tasks in the same session. */
const CSHARP_HASH = createHash('sha256').update(CSHARP_SOURCE).digest('hex').slice(0, 12)
const DLL_WIN_PATH = `C:\\Temp\\skynul_input_${CSHARP_HASH}.dll`
const DLL_WSL_PATH = `/mnt/c/Temp/skynul_input_${CSHARP_HASH}.dll`

export class WindowsBridge {
  private proc: ChildProcessWithoutNullStreams | null = null
  private initialized = false
  private buffer = ''
  private stderrBuffer = ''
  private pending: {
    resolve: (r: BridgeResult) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null
  private destroyed = false

  /** Collected stderr for diagnostics. */
  get lastStderr(): string {
    return this.stderrBuffer
  }

  async init(): Promise<void> {
    if (this.initialized) return

    const wslTmpDir = '/mnt/c/Temp'
    try {
      await mkdir(wslTmpDir, { recursive: true })
    } catch {
      // might already exist
    }

    // Check if we already have a cached DLL for this version of the C# source
    let dllExists = false
    try {
      await access(DLL_WSL_PATH)
      dllExists = true
    } catch {
      // DLL not cached yet — need to compile from source
    }

    let csWslPath: string | null = null
    let csWinPath: string | null = null
    if (!dllExists) {
      const csFileName = `skynul_input_${randomBytes(4).toString('hex')}.cs`
      csWslPath = `${wslTmpDir}/${csFileName}`
      csWinPath = `C:\\Temp\\${csFileName}`
      await writeFile(csWslPath, CSHARP_SOURCE, 'utf8')
    }

    // Spawn persistent PowerShell
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    this.proc.stdout.setEncoding('utf8')
    this.proc.stderr.setEncoding('utf8')

    this.proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      this.tryResolve()
    })

    this.proc.stderr.on('data', (chunk: string) => {
      this.stderrBuffer += chunk
      if (this.stderrBuffer.length > 8000) {
        this.stderrBuffer = this.stderrBuffer.slice(-4000)
      }
    })

    this.proc.on('exit', (code) => {
      if (!this.destroyed) {
        const stderr = this.stderrBuffer.slice(-500)
        this.rejectPending(
          new Error(`PowerShell exited with code ${code}${stderr ? `: ${stderr}` : ''}`)
        )
      }
    })

    this.proc.on('error', (err) => {
      this.rejectPending(new Error(`PowerShell spawn error: ${err.message}`))
    })

    // Smoke test
    try {
      await this.exec('$null', 10_000)
    } catch (e) {
      this.destroy()
      throw new Error(`PowerShell not responding: ${e instanceof Error ? e.message : String(e)}`)
    }

    // Load referenced assemblies so PowerShell scripts can use types like
    // [System.Windows.Forms.Screen] directly (not just through our C# class).
    // This is needed regardless of DLL cache because Add-Type -Path doesn't
    // auto-load referenced assemblies into the PS session.
    try {
      await this.exec(
        `Add-Type -AssemblyName System.Drawing; Add-Type -AssemblyName System.Windows.Forms`,
        INIT_TIMEOUT
      )
    } catch {
      // Non-fatal — the assemblies might already be loaded
    }

    // Load required .NET assemblies — needed both by the C# class and screenshot scripts
    try {
      this.stderrBuffer = ''
      await this.exec(
        `Add-Type -AssemblyName System.Drawing; Add-Type -AssemblyName System.Windows.Forms`,
        INIT_TIMEOUT
      )
    } catch (e) {
      const stderr = this.stderrBuffer.slice(-500)
      this.destroy()
      throw new Error(
        `Failed to load .NET assemblies: ${e instanceof Error ? e.message : String(e)}` +
          (stderr ? `\nPowerShell stderr: ${stderr}` : '')
      )
    }

    // Load C# types — either from cached DLL or compile from source
    try {
      this.stderrBuffer = ''
      if (dllExists) {
        // Fast path: load pre-compiled DLL directly (~200ms vs ~5-15s)
        await this.exec(`Add-Type -Path '${DLL_WIN_PATH}'`, INIT_TIMEOUT)
      } else {
        // First run: compile from source and cache the DLL for next time
        await this.exec(
          `Add-Type -Path '${csWinPath}' -ReferencedAssemblies System.Drawing,System.Windows.Forms -OutputAssembly '${DLL_WIN_PATH}'`,
          INIT_TIMEOUT
        )
        // Load the compiled DLL (OutputAssembly doesn't auto-load it)
        await this.exec(`Add-Type -Path '${DLL_WIN_PATH}'`, INIT_TIMEOUT)
      }
    } catch (e) {
      const stderr = this.stderrBuffer.slice(-500)
      this.destroy()
      throw new Error(
        `Failed to load C# input types: ${e instanceof Error ? e.message : String(e)}` +
          (stderr ? `\nPowerShell stderr: ${stderr}` : '')
      )
    }

    // Clean up temp .cs file if we wrote one
    if (csWslPath) {
      void unlink(csWslPath).catch(() => {})
    }

    this.initialized = true
  }

  private tryResolve(): void {
    const idx = this.buffer.indexOf(MARKER)
    if (idx === -1) return

    const raw = this.buffer.slice(0, idx).trim()
    this.buffer = this.buffer.slice(idx + MARKER.length)

    if (!this.pending) return

    const { resolve, timer } = this.pending
    clearTimeout(timer)
    this.pending = null

    try {
      const result = JSON.parse(raw) as BridgeResult
      resolve(result)
    } catch {
      resolve({ ok: true, data: raw })
    }
  }

  private rejectPending(err: Error): void {
    if (this.pending) {
      const { reject, timer } = this.pending
      clearTimeout(timer)
      this.pending = null
      reject(err)
    }
  }

  /**
   * Detect if a script is "complex" (contains braces/blocks that would
   * confuse PowerShell's try/catch wrapper when piped through stdin).
   */
  private isComplexScript(script: string): boolean {
    return script.includes('{') || script.includes('}') || script.split('\n').length > 3
  }

  /**
   * Write a script to a temp .ps1 file and return the Windows path.
   * The caller is responsible for cleanup.
   */
  private async writeScriptFile(content: string): Promise<{ wslPath: string; winPath: string }> {
    const name = `skynul_ps_${randomBytes(4).toString('hex')}.ps1`
    const wslPath = `/mnt/c/Temp/${name}`
    const winPath = `C:\\Temp\\${name}`
    await writeFile(wslPath, content, 'utf8')
    return { wslPath, winPath }
  }

  private exec(script: string, timeoutMs: number = ACTION_TIMEOUT): Promise<BridgeResult> {
    if (!this.proc || this.destroyed) {
      return Promise.reject(new Error('Bridge is not initialized or destroyed'))
    }

    // For complex scripts, write to a temp .ps1 file to avoid parser issues
    if (this.isComplexScript(script)) {
      return this.execViaFile(script, false, timeoutMs)
    }

    return this.execInline(script, false, timeoutMs)
  }

  /**
   * Execute a simple script inline via stdin (no braces/blocks).
   */
  private execInline(script: string, withData: boolean, timeoutMs: number): Promise<BridgeResult> {
    return new Promise<BridgeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null
        const stderr = this.stderrBuffer.slice(-300)
        reject(
          new Error(
            `PowerShell command timed out after ${timeoutMs}ms` +
              (stderr ? `\nstderr: ${stderr}` : '')
          )
        )
      }, timeoutMs)

      this.pending = { resolve, reject, timer }

      let wrapped: string
      if (withData) {
        wrapped = `
try {
  $__result = (${script})
  $__json = $__result -replace '"', '\\"'
  Write-Host "{\\"ok\\":true,\\"data\\":\\"$__json\\"}" -NoNewline
} catch {
  $msg = $_.Exception.Message -replace '"', '\\"'
  Write-Host "{\\"ok\\":false,\\"error\\":\\"$msg\\"}" -NoNewline
}
Write-Host '${MARKER}'
`
      } else {
        wrapped = `
try {
  ${script}
  Write-Host '{"ok":true}' -NoNewline
} catch {
  $msg = $_.Exception.Message -replace '"', '\\"'
  Write-Host "{\\"ok\\":false,\\"error\\":\\"$msg\\"}" -NoNewline
}
Write-Host '${MARKER}'
`
      }
      this.proc!.stdin.write(wrapped + '\n')
    })
  }

  /**
   * Execute a complex script by writing it to a temp .ps1 file first.
   * This avoids PowerShell parser issues with braces inside try/catch wrappers.
   */
  private async execViaFile(
    script: string,
    withData: boolean,
    timeoutMs: number
  ): Promise<BridgeResult> {
    // Build the full .ps1 content with try/catch and JSON output
    let ps1Content: string
    if (withData) {
      ps1Content = `try {
  $__result = (
${script}
  )
  $__json = $__result -replace '"', '\\"'
  Write-Host "{\`"ok\`":true,\`"data\`":\`"$__json\`"}" -NoNewline
} catch {
  $msg = $_.Exception.Message -replace '"', '\\"'
  Write-Host "{\`"ok\`":false,\`"error\`":\`"$msg\`"}" -NoNewline
}
Write-Host '${MARKER}'
`
    } else {
      ps1Content = `try {
${script}
  Write-Host '{"ok":true}' -NoNewline
} catch {
  $msg = $_.Exception.Message -replace '"', '\\"'
  Write-Host "{\`"ok\`":false,\`"error\`":\`"$msg\`"}" -NoNewline
}
Write-Host '${MARKER}'
`
    }

    const { wslPath, winPath } = await this.writeScriptFile(ps1Content)

    try {
      return await new Promise<BridgeResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = null
          const stderr = this.stderrBuffer.slice(-300)
          reject(
            new Error(
              `PowerShell command timed out after ${timeoutMs}ms` +
                (stderr ? `\nstderr: ${stderr}` : '')
            )
          )
        }, timeoutMs)

        this.pending = { resolve, reject, timer }

        // Invoke the temp file — no braces in this command, so it's safe inline
        this.proc!.stdin.write(`& '${winPath}'\n`)
      })
    } finally {
      // Clean up temp .ps1 file
      void unlink(wslPath).catch(() => {})
    }
  }

  /**
   * Capture a screenshot of the primary display.
   * If maxWidth/maxHeight given, the image is resized before sending to the model,
   * but we also return the scale factors so click coordinates can be mapped back
   * to native screen coordinates.
   */
  async captureScreen(opts?: { maxWidth?: number; maxHeight?: number }): Promise<{
    buffer: Buffer
    scaleX: number
    scaleY: number
    nativeWidth: number
    nativeHeight: number
  }> {
    const id = randomBytes(8).toString('hex')
    const winTmp = tmpdir().startsWith('/tmp') ? 'C:\\Temp' : tmpdir()
    const winPath = `${winTmp}\\skynul_ss_${id}.png`
    // Write native dims to a sidecar file so we know the original resolution
    const dimsPath = `${winTmp}\\skynul_dims_${id}.txt`
    const wslDimsPath = dimsPath.replace(/^C:\\/, '/mnt/c/').replace(/\\/g, '/')

    await this.exec(
      `if (!(Test-Path 'C:\\Temp')) { New-Item -ItemType Directory -Path 'C:\\Temp' | Out-Null }`,
      5000
    )

    if (opts?.maxWidth || opts?.maxHeight) {
      const mw = opts.maxWidth ?? 9999
      const mh = opts.maxHeight ?? 9999
      const script = `
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$g.Dispose()
$sw = $bounds.Width; $sh = $bounds.Height
[System.IO.File]::WriteAllText('${dimsPath}', "$sw,$sh")
$tw = ${mw}; $th = ${mh}
$ratio = [Math]::Min($tw / $sw, $th / $sh)
if ($ratio -lt 1) {
  $nw = [int]($sw * $ratio); $nh = [int]($sh * $ratio)
  $resized = New-Object System.Drawing.Bitmap($nw, $nh)
  $g2 = [System.Drawing.Graphics]::FromImage($resized)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
  $g2.DrawImage($bmp, 0, 0, $nw, $nh)
  $g2.Dispose()
  $bmp.Dispose()
  $bmp = $resized
}
$bmp.Save('${winPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()`
      const result = await this.exec(script, SCREENSHOT_TIMEOUT)
      if (!result.ok) throw new Error(result.error ?? 'Screenshot failed')
    } else {
      const result = await this.exec(
        `$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; [System.IO.File]::WriteAllText('${dimsPath}', "$($b.Width),$($b.Height)"); [SkynulInput]::CaptureScreen('${winPath}') | Out-Null`,
        SCREENSHOT_TIMEOUT
      )
      if (!result.ok) throw new Error(result.error ?? 'Screenshot failed')
    }

    const wslPath = winPath.replace(/^C:\\/, '/mnt/c/').replace(/\\/g, '/')
    const [buf, dimsRaw] = await Promise.all([
      readFile(wslPath),
      readFile(wslDimsPath, 'utf8').catch(() => '')
    ])
    void unlink(wslPath).catch(() => {})
    void unlink(wslDimsPath).catch(() => {})

    // Parse native dims and compute scale factors
    const parts = dimsRaw.trim().split(',')
    const nativeWidth = parseInt(parts[0] ?? '0', 10) || 0
    const nativeHeight = parseInt(parts[1] ?? '0', 10) || 0

    // Get actual image dimensions from the PNG header (bytes 16-24)
    const scaledWidth = buf.readUInt32BE(16)
    const scaledHeight = buf.readUInt32BE(20)

    const scaleX = nativeWidth > 0 && scaledWidth > 0 ? nativeWidth / scaledWidth : 1
    const scaleY = nativeHeight > 0 && scaledHeight > 0 ? nativeHeight / scaledHeight : 1

    return { buffer: buf, scaleX, scaleY, nativeWidth, nativeHeight }
  }

  async click(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
    const result = await this.exec(`[SkynulInput]::Click(${x}, ${y}, '${button}')`)
    if (!result.ok) throw new Error(result.error ?? 'Click failed')
  }

  async doubleClick(x: number, y: number): Promise<void> {
    const result = await this.exec(`[SkynulInput]::DoubleClick(${x}, ${y})`)
    if (!result.ok) throw new Error(result.error ?? 'Double click failed')
  }

  async moveMouse(x: number, y: number): Promise<void> {
    const result = await this.exec(`[SkynulInput]::Move(${x}, ${y})`)
    if (!result.ok) throw new Error(result.error ?? 'Move failed')
  }

  async type(text: string): Promise<void> {
    const escaped = text.replace(/[+^%~{}[\]()]/g, '{$&}').replace(/'/g, "''")
    const result = await this.exec(`[System.Windows.Forms.SendKeys]::SendWait('${escaped}')`)
    if (!result.ok) throw new Error(result.error ?? 'Type failed')
  }

  async keyCombo(combo: string): Promise<void> {
    const lower = combo.toLowerCase()

    // Windows/Meta key — SendKeys can't do this, use keybd_event via C#
    if (lower === 'meta' || lower === 'win' || lower === 'super') {
      const result = await this.exec(`[SkynulInput]::PressWinKey()`)
      if (!result.ok) throw new Error(result.error ?? 'Win key failed')
      return
    }

    // Win+key combos (e.g. meta+e for File Explorer)
    if (lower.startsWith('meta+') || lower.startsWith('win+') || lower.startsWith('super+')) {
      const key = combo.split('+').slice(1).join('+').trim()
      const sendKey = SENDKEYS_MAP[key.toLowerCase()] ?? key
      const escaped = sendKey.replace(/'/g, "''")
      // Hold Win, press key via SendKeys, release Win
      const result = await this.exec(
        `[SkynulInput]::keybd_event(0x5B, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 50; [System.Windows.Forms.SendKeys]::SendWait('${escaped}'); Start-Sleep -Milliseconds 50; [SkynulInput]::keybd_event(0x5B, 0, 2, [IntPtr]::Zero)`
      )
      if (!result.ok) throw new Error(result.error ?? 'Win+key combo failed')
      return
    }

    const seq = comboToSendKeys(combo)
    const escaped = seq.replace(/'/g, "''")
    const result = await this.exec(`[System.Windows.Forms.SendKeys]::SendWait('${escaped}')`)
    if (!result.ok) throw new Error(result.error ?? 'Key combo failed')
  }

  async scroll(x: number, y: number, clicks: number = -3): Promise<void> {
    const result = await this.exec(`[SkynulInput]::Scroll(${x}, ${y}, ${clicks})`)
    if (!result.ok) throw new Error(result.error ?? 'Scroll failed')
  }

  async launchApp(name: string): Promise<void> {
    const escaped = name.replace(/'/g, "''")

    // First check if the app is already running and bring it to front
    const focused = await this.tryFocusApp(escaped)
    if (focused) return

    // For UWP/Store apps (WhatsApp, Telegram, etc.), Start-Process by name won't work.
    // Use the Start Menu search which handles both classic and UWP apps reliably.
    await this.keyCombo('meta')
    await this.sleep(500)
    await this.type(name)
    await this.sleep(800)
    await this.keyCombo('enter')
    await this.sleep(2000)

    // Try to focus the newly launched app
    await this.tryFocusApp(escaped)
  }

  /**
   * Try to find a running process matching `name` and bring its window to front.
   * Searches by ProcessName AND MainWindowTitle (UWP apps often have non-obvious process names).
   * Returns true if an existing window was focused, false otherwise.
   */
  private async tryFocusApp(name: string): Promise<boolean> {
    const script = `
$proc = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like '*${name}*' -or $_.MainWindowTitle -like '*${name}*')
} | Select-Object -First 1
if ($proc) {
  $sig = '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'
  Add-Type -MemberDefinition $sig -Name WinFocus -Namespace SkynulFocus -ErrorAction SilentlyContinue
  [SkynulFocus.WinFocus]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
  [SkynulFocus.WinFocus]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
  'focused'
} else {
  'not_found'
}`
    try {
      const result = await this.execViaFile(script, true, ACTION_TIMEOUT)
      return result.ok && result.data === 'focused'
    } catch {
      return false
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async wait(ms: number): Promise<void> {
    await this.exec(
      `Start-Sleep -Milliseconds ${Math.max(0, Math.round(ms))}`,
      Math.max(ms + 5000, ACTION_TIMEOUT)
    )
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.exec('$null', 5000)
      return result.ok
    } catch {
      return false
    }
  }

  destroy(): void {
    this.destroyed = true
    this.rejectPending(new Error('Bridge destroyed'))
    if (this.proc) {
      try {
        this.proc.stdin.end()
        this.proc.kill()
      } catch {
        // ignore
      }
      this.proc = null
    }
  }

  get isAlive(): boolean {
    return !this.destroyed && this.proc !== null
  }
}
