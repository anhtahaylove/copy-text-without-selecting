const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const HOST_EXE = path.join(PROJECT_ROOT, "dist", "native", "copy-text-companion.exe");

function main() {
  if (process.platform !== "win32") {
    console.log("Windows tray smoke skipped on non-Windows platforms.");
    return;
  }

  if (!fs.existsSync(HOST_EXE)) {
    throw new Error(`Companion executable is missing. Run npm run native:build first: ${HOST_EXE}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copy-text-tray-smoke-"));
  const appDataRoot = path.join(tempRoot, "appdata");
  const scriptPath = path.join(tempRoot, "smoke-tray.ps1");
  fs.mkdirSync(appDataRoot, { recursive: true });
  fs.writeFileSync(scriptPath, createPowerShellSmoke(), "utf8");

  let primaryError = null;
  try {
    const powershellArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-ExePath",
      HOST_EXE,
      "-AppDataPath",
      appDataRoot,
    ];
    if (process.env.COPY_TEXT_TRAY_FORCE_MESSAGE_INJECTION === "1") {
      powershellArgs.push("-ForceMessageInjection");
    }
    const result = spawnSync("powershell", powershellArgs, {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    if (result.status !== 0) {
      throw new Error(`Windows tray smoke failed with exit code ${result.status}.`);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      waitForFilesystemRelease(750);
      fs.rmSync(tempRoot, {
        recursive: true,
        force: true,
        maxRetries: 40,
        retryDelay: 250,
      });
    } catch (cleanupError) {
      if (!primaryError) {
        throw cleanupError;
      }
      primaryError.message += ` Cleanup also failed for ${tempRoot}: ${cleanupError.message || cleanupError}`;
    }
  }
  if (primaryError) {
    throw primaryError;
  }
}

function waitForFilesystemRelease(delayMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function createPowerShellSmoke() {
  return String.raw`
param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,

  [Parameter(Mandatory = $true)]
  [string]$AppDataPath,

  [switch]$ForceMessageInjection
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  throw $Message
}

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class CopyTextTraySmoke {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct NOTIFYICONIDENTIFIER {
    public int cbSize;
    public IntPtr hWnd;
    public uint uID;
    public Guid guidItem;
  }

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern bool BlockInput(bool fBlockIt);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, UIntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool PostMessage(IntPtr hWnd, uint Msg, UIntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EndMenu();

  [DllImport("user32.dll", SetLastError = true)]
  public static extern int GetMenuItemCount(IntPtr hMenu);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int GetMenuString(IntPtr hMenu, uint uIDItem, StringBuilder lpString, int cchMax, uint flags);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetMenuItemRect(IntPtr hWnd, IntPtr hMenu, uint uItem, out RECT lprcItem);

  [DllImport("shell32.dll", SetLastError = true)]
  public static extern int Shell_NotifyIconGetRect(ref NOTIFYICONIDENTIFIER identifier, out RECT iconLocation);
}
"@
Add-Type -AssemblyName UIAutomationClient

[void][CopyTextTraySmoke]::SetProcessDPIAware()

$MOUSEEVENTF_LEFTDOWN = [uint32]0x0002
$MOUSEEVENTF_LEFTUP = [uint32]0x0004
$MOUSEEVENTF_RIGHTDOWN = [uint32]0x0008
$MOUSEEVENTF_RIGHTUP = [uint32]0x0010
$MN_GETHMENU = [uint32]0x01E1
$MF_BYPOSITION = [uint32]0x00000400
$TRAY_CALLBACK_MESSAGE = [uint32](0x8000 + 0x531)
$WM_COMMAND = [uint32]0x0111
$WM_LBUTTONUP = [uint32]0x0202
$WM_LBUTTONDBLCLK = [uint32]0x0203
$WM_RBUTTONUP = [uint32]0x0205
$ID_TRAY_SHOW = [uint32]1001
$ID_TRAY_MINIMIZE = [uint32]1002
$ID_TRAY_QUIT = [uint32]1003

function Invoke-MouseClick([int]$X, [int]$Y, [string]$Button, [int]$Count = 1) {
  if (-not [CopyTextTraySmoke]::SetCursorPos($X, $Y)) {
    [void][CopyTextTraySmoke]::BlockInput($false)
    Start-Sleep -Milliseconds 100
    if (-not [CopyTextTraySmoke]::SetCursorPos($X, $Y)) {
      Fail "SetCursorPos failed. Run this smoke from an interactive Windows desktop."
    }
  }
  Start-Sleep -Milliseconds 120
  for ($i = 0; $i -lt $Count; $i++) {
    if ($Button -eq "right") {
      [CopyTextTraySmoke]::mouse_event($MOUSEEVENTF_RIGHTDOWN, [uint32]$X, [uint32]$Y, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 50
      [CopyTextTraySmoke]::mouse_event($MOUSEEVENTF_RIGHTUP, [uint32]$X, [uint32]$Y, 0, [UIntPtr]::Zero)
    } else {
      [CopyTextTraySmoke]::mouse_event($MOUSEEVENTF_LEFTDOWN, [uint32]$X, [uint32]$Y, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 50
      [CopyTextTraySmoke]::mouse_event($MOUSEEVENTF_LEFTUP, [uint32]$X, [uint32]$Y, 0, [UIntPtr]::Zero)
    }
    Start-Sleep -Milliseconds 170
  }
}

function Wait-Until([scriptblock]$Check, [string]$Label, [int]$TimeoutMs = 8000) {
  $value = Wait-Optional $Check $TimeoutMs
  if ($value) {
    return $value
  }
  Fail "Timed out waiting for $Label."
}

function Wait-Optional([scriptblock]$Check, [int]$TimeoutMs = 8000) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  do {
    $value = & $Check
    if ($value) {
      return $value
    }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)
  return $null
}

function Find-ProcessWindows([int]$ProcessId) {
  $script:trayHwnd = [IntPtr]::Zero
  $script:mainHwnd = [IntPtr]::Zero
  $targetPid = [uint32]$ProcessId
  [CopyTextTraySmoke+EnumWindowsProc]$enum = {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    $windowPid = [uint32]0
    [void][CopyTextTraySmoke]::GetWindowThreadProcessId($hWnd, [ref]$windowPid)
    if ($windowPid -ne $targetPid) {
      return $true
    }
    $className = New-Object System.Text.StringBuilder 256
    [void][CopyTextTraySmoke]::GetClassName($hWnd, $className, $className.Capacity)
    $name = $className.ToString()
    if ($name -eq "CopyTextCompanionTrayWindow-$targetPid") {
      $script:trayHwnd = $hWnd
    } elseif ([CopyTextTraySmoke]::IsWindowVisible($hWnd)) {
      $script:mainHwnd = $hWnd
    }
    return $true
  }
  [void][CopyTextTraySmoke]::EnumWindows($enum, [IntPtr]::Zero)
  return @{
    Tray = $script:trayHwnd
    Main = $script:mainHwnd
  }
}

function Get-TrayIconCenter([IntPtr]$TrayHwnd) {
  $identifier = New-Object CopyTextTraySmoke+NOTIFYICONIDENTIFIER
  $identifier.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][CopyTextTraySmoke+NOTIFYICONIDENTIFIER])
  $identifier.hWnd = $TrayHwnd
  $identifier.uID = 1
  $identifier.guidItem = [Guid]::Empty
  $rect = New-Object CopyTextTraySmoke+RECT
  $hr = [CopyTextTraySmoke]::Shell_NotifyIconGetRect([ref]$identifier, [ref]$rect)
  if ($hr -ne 0) {
    Fail ("Shell_NotifyIconGetRect failed with HRESULT 0x{0:X8}. The tray icon may be hidden by notification overflow or the desktop may be non-interactive." -f ($hr -band 0xffffffff))
  }
  if ($rect.Right -le $rect.Left -or $rect.Bottom -le $rect.Top) {
    Fail "Shell returned an empty tray icon rectangle."
  }
  return @{
    X = [int](($rect.Left + $rect.Right) / 2)
    Y = [int](($rect.Top + $rect.Bottom) / 2)
    Rect = "$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)"
  }
}

function Open-HiddenIconsOverflow() {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Subtree, $buttonCondition)
  $fallback = $null
  for ($i = 0; $i -lt $buttons.Count; $i++) {
    $button = $buttons.Item($i)
    $name = $button.Current.Name
    $className = $button.Current.ClassName
    if ($className -eq "SystemTray.NormalButton" -and -not $fallback) {
      $fallback = $button
    }
    if ($name -notmatch "Hidden|Icons|Overflow") {
      continue
    }
    Write-Host "Opening tray overflow via '$name' ($className)."
    Click-AutomationElementCenter $button
    return
  }
  if ($fallback) {
    Write-Host "Opening tray overflow via fallback '$($fallback.Current.Name)' ($($fallback.Current.ClassName))."
    Click-AutomationElementCenter $fallback
    return
  }
  Fail "Could not find the Windows 'Show Hidden Icons' tray overflow button."
}

function Click-AutomationElementCenter([System.Windows.Automation.AutomationElement]$Element) {
  $rect = $Element.Current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) {
    Fail "Automation element has an empty bounding rectangle."
  }
  $x = [int](($rect.Left + $rect.Right) / 2)
  $y = [int](($rect.Top + $rect.Bottom) / 2)
  Invoke-MouseClick $x $y "left"
  Start-Sleep -Milliseconds 600
}

function Get-MenuLabels([IntPtr]$MenuHandle) {
  $labels = @()
  $count = [CopyTextTraySmoke]::GetMenuItemCount($MenuHandle)
  if ($count -lt 0) {
    return $labels
  }
  for ($i = 0; $i -lt $count; $i++) {
    $text = New-Object System.Text.StringBuilder 256
    [void][CopyTextTraySmoke]::GetMenuString($MenuHandle, [uint32]$i, $text, $text.Capacity, $MF_BYPOSITION)
    $labels += $text.ToString()
  }
  return $labels
}

function Find-PopupMenu() {
  $script:menuInfo = $null
  [CopyTextTraySmoke+EnumWindowsProc]$enum = {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if (-not [CopyTextTraySmoke]::IsWindowVisible($hWnd)) {
      return $true
    }
    $className = New-Object System.Text.StringBuilder 256
    [void][CopyTextTraySmoke]::GetClassName($hWnd, $className, $className.Capacity)
    if ($className.ToString() -ne "#32768") {
      return $true
    }
    $menuHandle = [CopyTextTraySmoke]::SendMessage($hWnd, $MN_GETHMENU, [UIntPtr]::Zero, [IntPtr]::Zero)
    if ($menuHandle -eq [IntPtr]::Zero) {
      return $true
    }
    $labels = Get-MenuLabels $menuHandle
    if ($labels -contains "Show" -and $labels -contains "Minimize" -and $labels -contains "Quit") {
      $script:menuInfo = @{
        Hwnd = $hWnd
        Handle = $menuHandle
        Labels = $labels
      }
      return $false
    }
    return $true
  }
  [void][CopyTextTraySmoke]::EnumWindows($enum, [IntPtr]::Zero)
  return $script:menuInfo
}

function Open-TrayMenu([IntPtr]$TrayHwnd) {
  $trayCenter = Get-TrayIconCenter $TrayHwnd
  Invoke-MouseClick $trayCenter.X $trayCenter.Y "right"
  $menu = Wait-Optional { Find-PopupMenu } 1800
  if ($menu) {
    return $menu
  }

  # Windows can hide new tray icons behind notification overflow. Open that
  # shell panel explicitly, then Shell_NotifyIconGetRect resolves to the real
  # icon rectangle inside the overflow panel.
  Open-HiddenIconsOverflow
  $trayCenter = Get-TrayIconCenter $TrayHwnd
  Write-Host "Retry tray icon rectangle after overflow: $($trayCenter.Rect)"
  Invoke-MouseClick $trayCenter.X $trayCenter.Y "right"
  return Wait-Until { Find-PopupMenu } "tray context menu with Show, Minimize, and Quit"
}

function Invoke-TrayRestoreClick([IntPtr]$TrayHwnd, [IntPtr]$MainHwnd, [int]$Count, [string]$Label) {
  $trayCenter = Get-TrayIconCenter $TrayHwnd
  Invoke-MouseClick $trayCenter.X $trayCenter.Y "left" $Count
  $restored = Wait-Optional { -not [CopyTextTraySmoke]::IsIconic($MainHwnd) } 1400
  if ($restored) {
    return
  }

  Open-HiddenIconsOverflow
  $trayCenter = Get-TrayIconCenter $TrayHwnd
  Write-Host "Retry tray restore rectangle after overflow: $($trayCenter.Rect)"
  Invoke-MouseClick $trayCenter.X $trayCenter.Y "left" $Count
  [void](Wait-Until { -not [CopyTextTraySmoke]::IsIconic($MainHwnd) } $Label)
}

function Click-MenuItem($MenuInfo, [string]$Label) {
  $labels = @($MenuInfo.Labels)
  $index = [Array]::IndexOf($labels, $Label)
  if ($index -lt 0) {
    Fail "Tray menu item '$Label' was not found. Labels: $($labels -join ', ')"
  }
  $rect = New-Object CopyTextTraySmoke+RECT
  if (-not [CopyTextTraySmoke]::GetMenuItemRect($MenuInfo.Hwnd, $MenuInfo.Handle, [uint32]$index, [ref]$rect)) {
    Fail "GetMenuItemRect failed for tray menu item '$Label'."
  }
  $x = [int](($rect.Left + $rect.Right) / 2)
  $y = [int](($rect.Top + $rect.Bottom) / 2)
  Invoke-MouseClick $x $y "left"
}

function Post-TrayCallback([IntPtr]$TrayHwnd, [uint32]$EventMessage) {
  if (-not [CopyTextTraySmoke]::PostMessage(
    $TrayHwnd,
    $TRAY_CALLBACK_MESSAGE,
    [UIntPtr]::Zero,
    [IntPtr][int64]$EventMessage
  )) {
    Fail "PostMessage failed for tray callback $EventMessage."
  }
}

function Post-TrayCommand([IntPtr]$TrayHwnd, [uint32]$Command) {
  if (-not [CopyTextTraySmoke]::PostMessage(
    $TrayHwnd,
    $WM_COMMAND,
    [UIntPtr][uint64]$Command,
    [IntPtr]::Zero
  )) {
    Fail "PostMessage failed for tray command $Command."
  }
}

function Test-TrayWithWindowMessages([IntPtr]$TrayHwnd, [IntPtr]$MainHwnd, $Process) {
  Post-TrayCallback $TrayHwnd $WM_RBUTTONUP
  $menu = Wait-Until { Find-PopupMenu } "tray context menu with Show, Minimize, and Quit"
  Write-Output "Tray menu labels: $(@($menu.Labels) -join ', ')"
  [void][CopyTextTraySmoke]::EndMenu()
  Start-Sleep -Milliseconds 150

  Post-TrayCommand $TrayHwnd $ID_TRAY_MINIMIZE
  [void](Wait-Until { [CopyTextTraySmoke]::IsIconic($MainHwnd) } "tray Minimize command to minimize the window")

  Post-TrayCallback $TrayHwnd $WM_LBUTTONUP
  [void](Wait-Until { -not [CopyTextTraySmoke]::IsIconic($MainHwnd) } "tray left-click callback to restore the window")
  Start-Sleep -Milliseconds 500

  Post-TrayCommand $TrayHwnd $ID_TRAY_MINIMIZE
  [void](Wait-Until { [CopyTextTraySmoke]::IsIconic($MainHwnd) } "tray Minimize before Show command")
  Post-TrayCommand $TrayHwnd $ID_TRAY_SHOW
  [void](Wait-Until { -not [CopyTextTraySmoke]::IsIconic($MainHwnd) } "tray Show command to restore the window")
  Start-Sleep -Milliseconds 500

  Post-TrayCommand $TrayHwnd $ID_TRAY_MINIMIZE
  [void](Wait-Until { [CopyTextTraySmoke]::IsIconic($MainHwnd) } "tray Minimize before double-click callback")
  Post-TrayCallback $TrayHwnd $WM_LBUTTONDBLCLK
  [void](Wait-Until { -not [CopyTextTraySmoke]::IsIconic($MainHwnd) } "tray double-click callback to restore the window")
  Start-Sleep -Milliseconds 500

  Post-TrayCommand $TrayHwnd $ID_TRAY_QUIT
  if (-not $Process.WaitForExit(6000)) {
    Fail "Tray Quit command did not exit the companion process."
  }

  Write-Output "Windows tray smoke passed with message injection: icon registered, menu labels visible, click callbacks, Show, Minimize, and Quit."
}

$existing = Get-Process copy-text-companion -ErrorAction SilentlyContinue
if ($existing) {
  Fail "copy-text-companion.exe is already running. Close it before tray smoke so the test owns the process."
}

$proc = $null
try {
  $previousAppData = [Environment]::GetEnvironmentVariable("APPDATA", "Process")
  [Environment]::SetEnvironmentVariable("APPDATA", $AppDataPath, "Process")
  try {
    $proc = Start-Process -FilePath $ExePath -PassThru
  } finally {
    [Environment]::SetEnvironmentVariable("APPDATA", $previousAppData, "Process")
  }

  Start-Sleep -Seconds 4
  $proc.Refresh()
  if ($proc.HasExited) {
    Fail "Companion exited early with code $($proc.ExitCode)."
  }

  $windows = Wait-Until {
    $found = Find-ProcessWindows $proc.Id
    if ($found.Tray -ne [IntPtr]::Zero -and $found.Main -ne [IntPtr]::Zero) {
      return $found
    }
    return $null
  } "companion tray and main windows"

  $trayCenter = Get-TrayIconCenter $windows.Tray
  Write-Output "Initial tray icon rectangle: $($trayCenter.Rect)"

  if ($ForceMessageInjection -or -not [CopyTextTraySmoke]::SetCursorPos($trayCenter.X, $trayCenter.Y)) {
    Write-Output "Physical cursor injection is unavailable; using Win32 tray message injection."
    Test-TrayWithWindowMessages $windows.Tray $windows.Main $proc
  } else {
    try {
      $menu = Open-TrayMenu $windows.Tray
      Write-Output "Tray menu labels: $(@($menu.Labels) -join ', ')"
      Click-MenuItem $menu "Minimize"
      [void](Wait-Until { [CopyTextTraySmoke]::IsIconic($windows.Main) } "tray Minimize to minimize the window")

      Invoke-TrayRestoreClick $windows.Tray $windows.Main 1 "tray left-click to restore the window"

      $menu = Open-TrayMenu $windows.Tray
      Click-MenuItem $menu "Minimize"
      [void](Wait-Until { [CopyTextTraySmoke]::IsIconic($windows.Main) } "tray Minimize before Show")

      $menu = Open-TrayMenu $windows.Tray
      Click-MenuItem $menu "Show"
      [void](Wait-Until { -not [CopyTextTraySmoke]::IsIconic($windows.Main) } "tray Show to restore the window")

      $menu = Open-TrayMenu $windows.Tray
      Click-MenuItem $menu "Minimize"
      [void](Wait-Until { [CopyTextTraySmoke]::IsIconic($windows.Main) } "tray Minimize before double-click restore")

      Invoke-TrayRestoreClick $windows.Tray $windows.Main 2 "tray double-click to restore the window"

      $menu = Open-TrayMenu $windows.Tray
      Click-MenuItem $menu "Quit"
      $exited = $proc.WaitForExit(6000)
      if (-not $exited) {
        Fail "Tray Quit did not exit the companion process."
      }

      Write-Output "Windows tray smoke passed: icon registered, menu labels visible, left-click restore, double-click restore, Show, Minimize, and Quit."
    } catch {
      $proc.Refresh()
      if ($proc.HasExited) {
        throw
      }
      Write-Output "Physical tray interaction failed: $($_.Exception.Message)"
      Write-Output "Falling back to Win32 tray message injection."
      [void][CopyTextTraySmoke]::EndMenu()
      Test-TrayWithWindowMessages $windows.Tray $windows.Main $proc
    }
  }
} finally {
  if ($proc) {
    $proc.Refresh()
    if (-not $proc.HasExited) {
      Stop-Process -Id $proc.Id -Force
      [void]$proc.WaitForExit(5000)
    }
    $proc.Dispose()
  }
}
`;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { main };
