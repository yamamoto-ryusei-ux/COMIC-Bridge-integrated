# ============================================================
# CB-Recycle Panel Auto-Opener v2 (PowerShell + COM + UIA + SendKeys)
#
# 戦略の優先順位:
#   1. COM Automation で Photoshop に接続 + JSX 多段試行（最も信頼性高）
#   2. UI Automation でメニュー走査
#   3. SendKeys (Alt+W) で物理的キー入力
#
# COM Automation は Photoshop が「完全ロード状態」を保証するため、
# UXP の遅延読込問題を緩和できる。
#
# ログ: %APPDATA%\comic-bridge\_uia_open.log
# ============================================================

[CmdletBinding()]
param(
    [int]$WaitForPhotoshopSeconds = 90,
    [int]$ComJsxAttempts = 15,
    [int]$ComJsxDelaySeconds = 2,
    [string]$LogPath = "$env:APPDATA\comic-bridge\_uia_open.log"
)

$ErrorActionPreference = "Continue"

# ============================================================
# ログ機能
# ============================================================
function Write-UiaLog {
    param([string]$Message)
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy/MM/dd HH:mm:ss"), $Message
    Write-Host $line
    try {
        $dir = Split-Path $LogPath -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
        Add-Content -Path $LogPath -Value $line -Encoding UTF8
    } catch {}
}

# ログローテーション
try {
    if ((Test-Path $LogPath) -and ((Get-Item $LogPath).Length -gt 200000)) {
        Remove-Item $LogPath -Force
    }
} catch {}

Write-UiaLog "===== Panel Opener v2 開始 ====="

# ============================================================
# 必要なアセンブリをロード
# ============================================================
try {
    Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
    Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    Write-UiaLog "アセンブリ読込完了"
} catch {
    Write-UiaLog "✗ アセンブリ読込失敗: $_"
    exit 1
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@ -ErrorAction SilentlyContinue

# ============================================================
# 戦略 1: COM Automation で JSX 多段試行
# ============================================================
function Try-ComAutomation {
    Write-UiaLog "=== 戦略 1: Photoshop COM Automation ==="
    try {
        Write-UiaLog "  COM オブジェクト作成中..."
        # Photoshop COM オブジェクト取得（既に起動中ならアタッチ、なければ起動して待機）
        $ps = New-Object -ComObject Photoshop.Application -ErrorAction Stop
        Write-UiaLog "  ✓ COM 接続成功"

        # Photoshop を表示・前面化
        try {
            $ps.Visible = $true
            $ps.BringToFront()
            Write-UiaLog "  ✓ Photoshop 前面化"
        } catch {
            Write-UiaLog "  ⚠ Photoshop 前面化警告: $_"
        }

        # UXP 読込のために少し待つ
        Start-Sleep -Seconds 3

        # 多段 JSX 試行
        $jsxScript = @'
(function() {
    var labels = [
        "リサイくるん (CB連携)",
        "リサイくるん",
        "リサイくるん 実行 (CB)",
        "cbRecycleExecute",
        "mainPanel",
        "com.risaikurun.plugin",
        "com.risaikurun.plugin.mainPanel",
        "com.risaikurun.plugin.cbRecycleExecute"
    ];
    // ワークスペース切替も試行
    try {
        var ref = new ActionReference();
        ref.putName(stringIDToTypeID("workspace"), "CB_Recycle");
        var desc = new ActionDescriptor();
        desc.putReference(charIDToTypeID("null"), ref);
        executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
    } catch(e) {}
    // 全候補で runMenuItem
    for (var i = 0; i < labels.length; i++) {
        try { app.runMenuItem(stringIDToTypeID(labels[i])); } catch(e) {}
        try {
            var ref2 = new ActionReference();
            ref2.putName(stringIDToTypeID("menuItemType"), labels[i]);
            var desc2 = new ActionDescriptor();
            desc2.putReference(charIDToTypeID("null"), ref2);
            executeAction(charIDToTypeID("slct"), desc2, DialogModes.NO);
        } catch(e) {}
    }
    return "OK";
})();
'@

        Write-UiaLog "  JSX 多段試行（$ComJsxAttempts 回 × $ComJsxDelaySeconds 秒間隔）..."
        for ($i = 1; $i -le $ComJsxAttempts; $i++) {
            try {
                # DoJavaScript(script, args, executionMode)
                # executionMode 2 = PsJavaScriptExecutionMode.psNeverShowDebugger
                $result = $ps.DoJavaScript($jsxScript, $null, 2)
                Write-UiaLog "    試行 $i/$ComJsxAttempts : $result"
            } catch {
                Write-UiaLog "    試行 $i 例外: $_"
            }

            if ($i -lt $ComJsxAttempts) {
                Start-Sleep -Seconds $ComJsxDelaySeconds
            }
        }

        # COM オブジェクトを解放
        try {
            [System.Runtime.Interopservices.Marshal]::ReleaseComObject($ps) | Out-Null
        } catch {}

        return $true
    } catch {
        Write-UiaLog "  ✗ COM Automation 失敗: $_"
        return $false
    }
}

# ============================================================
# 戦略 2: UI Automation でメニューを操作
# ============================================================
function Try-UIAutomation {
    Write-UiaLog "=== 戦略 2: UI Automation ==="
    try {
        $psProc = Get-Process -Name "Photoshop" -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $psProc -or $psProc.MainWindowHandle -eq [IntPtr]::Zero) {
            Write-UiaLog "  ✗ Photoshop プロセス未検出"
            return $false
        }

        [Win32]::ShowWindow($psProc.MainWindowHandle, 9) | Out-Null
        [Win32]::SetForegroundWindow($psProc.MainWindowHandle) | Out-Null
        Start-Sleep -Milliseconds 500

        $mainWnd = [System.Windows.Automation.AutomationElement]::FromHandle($psProc.MainWindowHandle)
        if (-not $mainWnd) {
            Write-UiaLog "  ✗ メインウィンドウ未取得"
            return $false
        }

        # メニューバー
        $menuBar = $mainWnd.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::MenuBar
            ))
        )
        if (-not $menuBar) {
            Write-UiaLog "  ✗ メニューバー未検出"
            return $false
        }

        # Window メニュー
        $windowCandidates = @("ウィンドウ(W)", "ウィンドウ", "Window(W)", "Window")
        $windowMenu = $null
        foreach ($name in $windowCandidates) {
            $cond = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::NameProperty, $name
            )
            $windowMenu = $menuBar.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
            if ($windowMenu) { Write-UiaLog "  Window メニュー: '$name'"; break }
        }
        if (-not $windowMenu) { Write-UiaLog "  ✗ Window メニュー未検出"; return $false }

        # Window メニュー展開
        try {
            $windowMenu.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
        } catch {
            try {
                $windowMenu.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            } catch {
                Write-UiaLog "  ✗ Window メニュー展開失敗"
                return $false
            }
        }
        Start-Sleep -Milliseconds 600

        # Extensions サブメニュー
        $extCandidates = @("エクステンション", "Extensions")
        $extMenu = $null
        foreach ($name in $extCandidates) {
            $cond = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::NameProperty, $name
            )
            $extMenu = $mainWnd.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
            if ($extMenu) { Write-UiaLog "  Extensions: '$name'"; break }
        }
        if (-not $extMenu) {
            Write-UiaLog "  ✗ Extensions 未検出 (メニューを閉じる)"
            [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
            return $false
        }

        try {
            $extMenu.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
        } catch {
            try {
                $extMenu.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            } catch {}
        }
        Start-Sleep -Milliseconds 600

        # パネル項目
        $panelCandidates = @("リサイくるん (CB連携)", "リサイくるん")
        foreach ($name in $panelCandidates) {
            $cond = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::NameProperty, $name
            )
            $item = $mainWnd.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
            if ($item) {
                try {
                    $item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
                    Write-UiaLog "  ✓ '$name' Invoke 成功"
                    return $true
                } catch {
                    Write-UiaLog "  '$name' Invoke 失敗: $_"
                }
            }
        }
        Write-UiaLog "  ✗ パネル項目未検出"
        [System.Windows.Forms.SendKeys]::SendWait("{ESC}{ESC}")
        return $false
    } catch {
        Write-UiaLog "  ✗ UIA 例外: $_"
        return $false
    }
}

# ============================================================
# 戦略 3: SendKeys (Alt+W → 矢印 → Enter)
# ============================================================
function Try-SendKeysNavigation {
    Write-UiaLog "=== 戦略 3: SendKeys ==="
    try {
        $psProc = Get-Process -Name "Photoshop" -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $psProc) { return $false }

        [Win32]::SetForegroundWindow($psProc.MainWindowHandle) | Out-Null
        Start-Sleep -Milliseconds 500

        # 一旦 Esc でメニューが開いていれば閉じる
        [System.Windows.Forms.SendKeys]::SendWait("{ESC}{ESC}")
        Start-Sleep -Milliseconds 200

        # Alt+W で Window メニュー
        [System.Windows.Forms.SendKeys]::SendWait("%w")
        Start-Sleep -Milliseconds 700
        Write-UiaLog "  Alt+W 送信"

        # メニューが開いた後、End キーで最下端へ
        # その後 Up キーで Extensions まで遡る（多くの場合 Extensions は下半分にある）
        # 実際には End → Up x N で正確な位置は分からないので、
        # 別アプローチ: Photoshop 日本語版では「エクステンション」メニューが Window メニュー内にある
        # 多くのバージョンでアレンジ→ワークスペース→検索→...→アクション→アジャストメント→...→
        # エクステンション の順。位置はバージョンと言語で変わる

        # SendKeys では確実な位置取得が困難なので Esc で閉じる
        [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
        Write-UiaLog "  SendKeys: Window メニュー操作は不確定のため中断"

        return $false
    } catch {
        Write-UiaLog "  ✗ SendKeys 例外: $_"
        return $false
    }
}

# ============================================================
# メイン処理
# ============================================================
$success = $false

# Photoshop プロセス検出（COM が起動するので、なくても進める）
Write-UiaLog "Photoshop プロセス確認..."
$psProc = $null
for ($i = 0; $i -lt $WaitForPhotoshopSeconds; $i++) {
    $psProc = Get-Process -Name "Photoshop" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($psProc -and $psProc.MainWindowHandle -ne [IntPtr]::Zero) {
        Write-UiaLog "  ✓ Photoshop 検出: PID=$($psProc.Id)"
        break
    }
    if ($i -eq 0) { Write-UiaLog "  Photoshop 未検出。COM で起動を試みる..." }
    Start-Sleep -Seconds 1
}

# 戦略 1: COM Automation（最重要）
if (Try-ComAutomation) {
    $success = $true
}

# 戦略 2: UIA（COM がダメだった場合）
if (-not $success) {
    Start-Sleep -Seconds 1
    if (Try-UIAutomation) {
        $success = $true
    }
}

# 戦略 3: SendKeys（位置依存のため最終手段）
# if (-not $success) {
#     if (Try-SendKeysNavigation) {
#         $success = $true
#     }
# }

Write-UiaLog "===== 終了。success=$success ====="
if ($success) { exit 0 } else { exit 3 }
